#!/usr/bin/env sh
# A backup is only as good as the last time somebody restored it.
#
# Dumps the database the way a nightly backup would (pg_dump, custom format),
# restores it into a scratch database beside it, and checks the copy:
#
#   1. every table in every application schema came back,
#   2. no table came back with more rows than the source has now — and any
#      that came back with fewer are named, because only append-only tables
#      written to during the dump (the audit log, the outbox) may differ,
#   3. Prisma agrees the restored schema is fully migrated.
#
# Then drops the scratch database and the dump. Changes nothing in the
# source. Runs against the local compose stack:
#
#   sh scripts/backup-drill.sh
#
# Against a real server, the same three commands — pg_dump -Fc, createdb,
# pg_restore --no-owner — are the restore runbook; docs/backup-and-restore.md
# says how often and who.
set -eu

SOURCE=${SOURCE_DB:-medilink}
DRILL=${DRILL_DB:-medilink_restore_drill}
DUMP=/tmp/medilink-drill.dump
PSQL="docker compose exec -T db psql -U medilink -v ON_ERROR_STOP=1 -At"

started=$(date +%s)
echo "Backing up $SOURCE..."
docker compose exec -T db pg_dump -U medilink -d "$SOURCE" -Fc -f "$DUMP"
size=$(docker compose exec -T db sh -c "wc -c < $DUMP" | tr -d '[:space:]')
echo "  dump is $size bytes"

echo "Restoring into $DRILL..."
$PSQL -d postgres -c "DROP DATABASE IF EXISTS $DRILL" >/dev/null
$PSQL -d postgres -c "CREATE DATABASE $DRILL" >/dev/null
docker compose exec -T db pg_restore -U medilink -d "$DRILL" --no-owner --exit-on-error "$DUMP"
restored=$(date +%s)
echo "  backup and restore took $((restored - started))s"

# Every base table outside the system schemas, with its row count.
COUNTS="SELECT table_schema || '.' || table_name || ' ' ||
  (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I',
    table_schema, table_name), false, true, '')))[1]::text
FROM information_schema.tables
WHERE table_type = 'BASE TABLE'
  AND table_schema NOT IN ('pg_catalog', 'information_schema')
ORDER BY 1"

$PSQL -d "$SOURCE" -c "$COUNTS" > /tmp/drill-source.txt
$PSQL -d "$DRILL" -c "$COUNTS" > /tmp/drill-restored.txt

tables=$(wc -l < /tmp/drill-source.txt | tr -d ' ')
restored_tables=$(wc -l < /tmp/drill-restored.txt | tr -d ' ')
failed=0

if [ "$tables" != "$restored_tables" ]; then
  echo "FAIL: $tables tables in the source, $restored_tables restored."
  failed=1
fi

identical=0
while read -r table count; do
  copy=$(grep "^$table " /tmp/drill-restored.txt | cut -d' ' -f2)
  if [ -z "$copy" ]; then
    echo "FAIL: $table did not come back."
    failed=1
  elif [ "$copy" -gt "$count" ]; then
    echo "FAIL: $table came back with $copy rows; the source has $count."
    failed=1
  elif [ "$copy" -lt "$count" ]; then
    echo "  $table: $copy restored, $count now — written to since the dump"
  else
    identical=$((identical + 1))
  fi
done < /tmp/drill-source.txt
echo "  $identical of $tables tables identical"

echo "Checking the restored schema is fully migrated..."
if docker compose exec -T \
  -e DATABASE_URL="postgresql://medilink:medilink@db:5432/$DRILL?schema=public" \
  web pnpm prisma migrate status 2>&1 | grep -q "Database schema is up to date"; then
  echo "  up to date"
else
  echo "FAIL: prisma migrate status does not report the restored schema up to date."
  failed=1
fi

$PSQL -d postgres -c "DROP DATABASE $DRILL" >/dev/null
docker compose exec -T db rm -f "$DUMP"
rm -f /tmp/drill-source.txt /tmp/drill-restored.txt

if [ "$failed" -ne 0 ]; then
  echo "Backup drill FAILED."
  exit 1
fi
echo "Backup drill passed."
