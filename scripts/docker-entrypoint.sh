#!/bin/sh
# Starts whichever of web, worker or migrate the container was asked to be.
#
# Migrations run first only when RUN_MIGRATIONS=true, and that belongs on one
# service (the web process, or a one-off `migrate` job), not on every replica:
# `prisma migrate deploy` takes an advisory lock so concurrent runs are safe,
# but nothing is gained by having every worker wait on one.
set -e

if [ "$RUN_MIGRATIONS" = "true" ]; then
  echo "Applying migrations..."
  node_modules/.bin/prisma migrate deploy
fi

exec "$@"
