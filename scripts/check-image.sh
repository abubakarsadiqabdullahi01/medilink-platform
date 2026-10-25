#!/usr/bin/env bash
# Starts the production image the way a deployment does and shows that it does its job.
#
#   scripts/check-image.sh medilink:ci
#
# The `image` job in ci.yml used to build the image and look for nine named files in it. That caught
# the omission somebody had already thought of and nothing else: a worker file left out of the image
# passed it, and nothing noticed that the scheduled jobs exist only if the seed has run. This runs
# what the image is for, against a real database, with nothing from the checkout:
#
#   migrate         prisma migrate deploy
#   seed            tsx prisma/seed.ts          the only thing that creates the scheduled jobs
#   administrator   tsx scripts/create-first-administrator.ts
#   worker          every scheduled job runs once, and succeeds
#   web             serves, with its security headers, and passes its own healthcheck
#
# Needs docker, and an empty Postgres on localhost:5432 where the user, the password and the database
# are all `medilink` (the service the other jobs use). The image is `docker run` with --network host.
set -euo pipefail

IMAGE="${1:?usage: scripts/check-image.sh <image>}"
WORKER=medilink-ci-worker
WEB=medilink-ci-web

ENVS=(
  -e "DATABASE_URL=postgresql://medilink:medilink@localhost:5432/medilink?schema=public"
  -e "APP_URL=http://localhost:3000"
  -e "SESSION_SECRET=ci-session-secret-value-at-least-32-chars"
  -e "STORAGE_ENDPOINT=http://localhost:9000"
  -e "STORAGE_BUCKET=medilink-documents"
  -e "STORAGE_ACCESS_KEY_ID=medilink"
  -e "STORAGE_SECRET_ACCESS_KEY=medilink-secret"
)

step() { printf '\n== %s\n' "$*"; }

# Says what failed, and shows what the long-running containers had to say about it.
fail() {
  echo "::error title=production image::$*"
  local name
  for name in "$WORKER" "$WEB"; do
    if docker inspect "$name" >/dev/null 2>&1; then
      echo "--- log of $name"
      docker logs "$name" 2>&1 | tail -40
    fi
  done
  exit 1
}

cleanup() { docker rm -f "$WORKER" "$WEB" >/dev/null 2>&1 || true; }
trap cleanup EXIT

# One command in a throwaway container, started as the image is: through its entrypoint.
run() { docker run --rm --network host "${ENVS[@]}" "$@"; }

# One query, asked from inside the image (it carries psql), so the runner needs nothing installed.
sql() {
  docker run --rm --network host -e PGPASSWORD=medilink --entrypoint psql "$IMAGE" \
    -h localhost -U medilink -d medilink -At -c "$1"
}

step "migrate"
run "$IMAGE" node_modules/.bin/prisma migrate deploy || fail "the migrations did not apply from the image"

step "seed"
run "$IMAGE" node_modules/.bin/tsx prisma/seed.ts || fail "the seed did not run from the image"
jobs="$(sql "select count(*) from audit.scheduled_jobs")" || fail "could not read the scheduled jobs"
[ "$jobs" -gt 0 ] || fail "the seed created no scheduled jobs, so the worker would run no sweep"
echo "$jobs scheduled jobs"

step "first administrator"
password="$(head -c 24 /dev/urandom | base64 | tr -d '/+=')Aa1"
created="$(run -e "FIRST_ADMIN_PASSWORD=$password" "$IMAGE" node_modules/.bin/tsx \
  scripts/create-first-administrator.ts --phone 08031234567 --name "Image Check")" \
  || fail "the first-administrator command did not run from the image"
echo "$created" | grep -q "Created a super administrator" \
  || fail "the first-administrator command did not say it created one: $created"
echo "$created" | head -1

step "worker: every scheduled job runs once"
docker run -d --name "$WORKER" --network host "${ENVS[@]}" "$IMAGE" \
  node_modules/.bin/tsx src/worker/index.ts >/dev/null
deadline=$((SECONDS + 120))
until [ "$(sql "select count(*) from audit.scheduled_jobs where enabled and run_count = 0")" = "0" ]; do
  [ "$(docker inspect -f '{{.State.Running}}' "$WORKER")" = "true" ] || fail "the worker stopped"
  [ "$SECONDS" -lt "$deadline" ] || fail "scheduled jobs had still not run after two minutes"
  sleep 3
done
unwell="$(sql "select key || ': ' || coalesce(last_status::text, 'never') || ' ' || coalesce(last_error, '') from audit.scheduled_jobs where enabled and last_status is distinct from 'SUCCEEDED'")"
[ -z "$unwell" ] || fail "scheduled jobs that did not succeed: $unwell"
[ "$(docker inspect -f '{{.State.Running}}' "$WORKER")" = "true" ] || fail "the worker stopped"
errors="$(docker logs "$WORKER" 2>&1 | grep -c '"level":"error"' || true)"
[ "$errors" = "0" ] || fail "the worker logged $errors error(s)"
echo "all $jobs jobs ran and succeeded"

step "web: serves, with its headers, and passes its own healthcheck"
docker run -d --name "$WEB" --network host -e RUN_MIGRATIONS=true "${ENVS[@]}" "$IMAGE" >/dev/null
deadline=$((SECONDS + 90))
until curl -fsS -o /dev/null http://localhost:3000/api/v1/health 2>/dev/null; do
  [ "$(docker inspect -f '{{.State.Running}}' "$WEB")" = "true" ] || fail "the web process stopped"
  [ "$SECONDS" -lt "$deadline" ] || fail "the web process was not healthy after 90 seconds"
  sleep 2
done
docker logs "$WEB" 2>&1 | grep -q "Applying migrations" || fail "RUN_MIGRATIONS=true did not run the migrations"
body="$(curl -fsS http://localhost:3000/api/v1/health)"
echo "$body" | grep -q '"database":"ok"' || fail "the health route does not report the database ok: $body"
headers="$(curl -sS -D - -o /dev/null http://localhost:3000/api/v1/health)"
# The headers are written into .next at build time, so this shows the build's headers are being served;
# it cannot show that next.config.mjs is in the image (take it out and they are still served). The
# `image` job's list of files does that.
echo "$headers" | grep -qi '^x-frame-options: deny' || fail "the web process does not send X-Frame-Options: DENY"
echo "$headers" | grep -qi '^content-security-policy:' || fail "the web process does not send a Content-Security-Policy"
# The command the image's own HEALTHCHECK runs, as the user the image runs as.
docker exec "$WEB" curl -fsS -o /dev/null http://localhost:3000/api/v1/health \
  || fail "the image's healthcheck command fails inside the container"
echo "healthy, with its security headers"

echo
echo "The image migrates, seeds, creates the first administrator, runs every scheduled job and serves."
