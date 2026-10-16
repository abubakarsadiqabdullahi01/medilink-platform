#!/usr/bin/env sh
# Proves that the production runner image is operational, not merely complete.
#
# The drill is isolated: it creates a disposable Docker network and PostgreSQL
# container, migrates and seeds that database from the runner image, starts the
# web and worker commands from the same image, waits for the health endpoint,
# and proves that the worker completes one scheduled job. Everything it creates
# is removed on exit. It never connects to the development, demo or production
# database.
#
# CI builds medilink:ci first:
#   sh scripts/smoke-production-image.sh
#
# A developer can ask the script to build the image too:
#   BUILD_IMAGE=true IMAGE=medilink:smoke sh scripts/smoke-production-image.sh
set -eu

IMAGE=${IMAGE:-medilink:ci}
BUILD_IMAGE=${BUILD_IMAGE:-false}
PORT=${PORT:-3210}
PREFIX="medilink-image-smoke-$$"
NETWORK="$PREFIX-network"
DATABASE="$PREFIX-db"
WEB="$PREFIX-web"
WORKER="$PREFIX-worker"

show_logs() {
  echo "--- production web log ---"
  docker logs "$WEB" 2>&1 || true
  echo "--- production worker log ---"
  docker logs "$WORKER" 2>&1 || true
  echo "--- PostgreSQL log ---"
  docker logs "$DATABASE" 2>&1 || true
}

cleanup() {
  result=$?
  if [ "$result" -ne 0 ]; then
    show_logs
  fi
  docker rm -f "$WEB" "$WORKER" "$DATABASE" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
  exit "$result"
}
trap cleanup EXIT INT TERM

if [ "$BUILD_IMAGE" = "true" ]; then
  docker build --target runner -t "$IMAGE" .
fi

docker image inspect "$IMAGE" >/dev/null
docker network create "$NETWORK" >/dev/null
docker run -d --name "$DATABASE" --network "$NETWORK" --network-alias database \
  -e POSTGRES_USER=medilink \
  -e POSTGRES_PASSWORD=medilink \
  -e POSTGRES_DB=medilink \
  postgres:16-alpine >/dev/null

database_ready=false
for _ in $(seq 1 60); do
  if docker exec "$DATABASE" pg_isready -U medilink -d medilink >/dev/null 2>&1; then
    database_ready=true
    break
  fi
  sleep 1
done
if [ "$database_ready" != "true" ]; then
  echo "PostgreSQL did not become ready."
  exit 1
fi

# Deliberately local application configuration: this is a production *build*
# smoke test with disposable data, not a staging system and not a provider test.
# APP_ENV is explicit so the production boot guard cannot silently default.
run_image() {
  docker run --rm --network "$NETWORK" \
    -e NODE_ENV=production \
    -e APP_ENV=local \
    -e APP_URL=http://localhost:3210 \
    -e DATABASE_URL=postgresql://medilink:medilink@database:5432/medilink?schema=public \
    -e SESSION_SECRET=production-image-smoke-session-secret-32-chars \
    -e STORAGE_ENDPOINT=http://storage.invalid:9000 \
    -e STORAGE_PUBLIC_ENDPOINT=http://storage.invalid:9000 \
    -e STORAGE_REGION=auto \
    -e STORAGE_BUCKET=medilink-smoke \
    -e STORAGE_ACCESS_KEY_ID=smoke \
    -e STORAGE_SECRET_ACCESS_KEY=smoke-only \
    -e STORAGE_FORCE_PATH_STYLE=true \
    -e SMS_PROVIDER=console \
    -e PAYMENT_PROVIDER=none \
    "$IMAGE" "$@"
}

echo "Applying migrations from $IMAGE..."
run_image node_modules/.bin/prisma migrate deploy
echo "Registering reference data and scheduled jobs from $IMAGE..."
run_image node_modules/.bin/tsx prisma/seed.ts

# Make exactly one harmless sweep due. The worker's first pass must claim and
# finish it; the other jobs stay out of the proof and cannot make it flaky.
docker exec "$DATABASE" psql -U medilink -d medilink -v ON_ERROR_STOP=1 -c \
  "UPDATE audit.scheduled_jobs SET next_run_at = now() + interval '1 day';
   UPDATE audit.scheduled_jobs SET next_run_at = now() WHERE key = 'retention.purge_sweep';" >/dev/null

docker run -d --name "$WEB" --network "$NETWORK" -p "127.0.0.1:$PORT:3000" \
  -e NODE_ENV=production \
  -e APP_ENV=local \
  -e APP_URL="http://localhost:$PORT" \
  -e DATABASE_URL=postgresql://medilink:medilink@database:5432/medilink?schema=public \
  -e SESSION_SECRET=production-image-smoke-session-secret-32-chars \
  -e STORAGE_ENDPOINT=http://storage.invalid:9000 \
  -e STORAGE_PUBLIC_ENDPOINT=http://storage.invalid:9000 \
  -e STORAGE_REGION=auto \
  -e STORAGE_BUCKET=medilink-smoke \
  -e STORAGE_ACCESS_KEY_ID=smoke \
  -e STORAGE_SECRET_ACCESS_KEY=smoke-only \
  -e STORAGE_FORCE_PATH_STYLE=true \
  -e SMS_PROVIDER=console \
  -e PAYMENT_PROVIDER=none \
  "$IMAGE" node_modules/.bin/next start >/dev/null

docker run -d --name "$WORKER" --network "$NETWORK" \
  -e NODE_ENV=production \
  -e APP_ENV=local \
  -e APP_URL="http://localhost:$PORT" \
  -e DATABASE_URL=postgresql://medilink:medilink@database:5432/medilink?schema=public \
  -e SESSION_SECRET=production-image-smoke-session-secret-32-chars \
  -e STORAGE_ENDPOINT=http://storage.invalid:9000 \
  -e STORAGE_PUBLIC_ENDPOINT=http://storage.invalid:9000 \
  -e STORAGE_REGION=auto \
  -e STORAGE_BUCKET=medilink-smoke \
  -e STORAGE_ACCESS_KEY_ID=smoke \
  -e STORAGE_SECRET_ACCESS_KEY=smoke-only \
  -e STORAGE_FORCE_PATH_STYLE=true \
  -e SMS_PROVIDER=console \
  -e PAYMENT_PROVIDER=none \
  "$IMAGE" node_modules/.bin/tsx src/worker/index.ts >/dev/null

web_ready=false
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$PORT/api/v1/health" >/dev/null 2>&1; then
    web_ready=true
    break
  fi
  sleep 1
done
if [ "$web_ready" != "true" ]; then
  echo "The web process did not become healthy."
  exit 1
fi

job_status=''
for _ in $(seq 1 60); do
  job_status=$(docker exec "$DATABASE" psql -U medilink -d medilink -At -c \
    "SELECT coalesce(last_status::text, '') FROM audit.scheduled_jobs WHERE key = 'retention.purge_sweep';")
  if [ "$job_status" = "SUCCEEDED" ]; then
    break
  fi
  sleep 1
done
if [ "$job_status" != "SUCCEEDED" ]; then
  echo "The worker did not complete retention.purge_sweep; last status: ${job_status:-none}."
  exit 1
fi

if [ "$(docker inspect -f '{{.State.Running}}' "$WEB")" != "true" ] || \
   [ "$(docker inspect -f '{{.State.Running}}' "$WORKER")" != "true" ]; then
  echo "The web or worker process exited during the smoke test."
  exit 1
fi

echo "Production image smoke passed: migrations and seed ran; web is healthy; worker completed retention.purge_sweep."
