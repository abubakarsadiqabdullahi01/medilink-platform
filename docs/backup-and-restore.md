# Backup and restore runbook

A backup is usable only after a restore has proved it. This runbook separates
the local drill that engineering can repeat from the production policy and
infrastructure decisions the system owner must approve.

## What must be protected

PostgreSQL is the primary structured record: identity, permissions,
verification decisions, bookings, attendance, timesheets, ledger and audit.
Object storage holds uploaded evidence and must be backed up/versioned under a
separate provider policy. Restoring only one of the two can leave database rows
whose evidence no longer exists.

Secrets are not database data. Keep session, payout-encryption, storage and
provider keys in the environment’s secret manager and recovery procedure, not
inside a database dump.

## Local restore drill

With the development Compose database running:

```bash
sh scripts/backup-drill.sh
```

The script:

1. writes a PostgreSQL custom-format dump inside the database container;
2. creates the scratch database `medilink_restore_drill`;
3. restores with `pg_restore --no-owner --exit-on-error`;
4. compares every application table and row count;
5. confirms Prisma reports the restored schema fully migrated; and
6. removes the scratch database and dump.

It never writes to the source database. Do not set `DRILL_DB` to an existing or
important database: the script drops that exact scratch database before and
after the drill.

### Recorded local drill

On 17 October 2026, on the G0 validation branch based on `main` at `71b5901`,
the drill produced a 1,279,100-byte dump, restored it in 6 seconds, matched all
66 application tables and confirmed all 23 migrations were applied. The
scratch database and container-side dump were removed by the script.

This proves the local PostgreSQL procedure, not the production backup service,
object-storage recovery, RPO or RTO. Those remain release decisions below.

## Production procedure

The production operator must replace the Compose commands with the provider’s
authenticated connection and recovery controls, but the sequence stays the
same:

1. Record incident/recovery ticket, operator, source backup identifier and target.
2. Restore into a new isolated database; never restore over the current primary.
3. Restore the corresponding object-storage version/snapshot into an isolated bucket.
4. Run `prisma migrate status` against the restored database.
5. Compare table inventory, row counts, latest audit/outbox timestamps and ledger balance.
6. Sample signed object access for credential, facility, dispute and incident files.
7. Start one web and one worker process against the isolated restore with external messages and payments disabled.
8. Run health and critical read-only journey checks.
9. Have engineering and operations sign the evidence before any traffic switch.
10. Retain or destroy the recovery copy according to the approved incident and privacy procedure.

Never use a production restore as demonstration data.

## Evidence to retain

For each drill record:

- date, environment, operator and reviewer;
- backup/snapshot identifiers and encryption status;
- start, restore and verification times;
- table counts and migration result;
- object sample result;
- web/worker smoke result;
- failures, remediation owner and repeat date; and
- measured recovery time and recoverable-data age.

## Decisions still required

The repository does not choose production infrastructure. Before a Gombe pilot,
the owners and operator must approve:

- recovery-time objective (RTO) and recovery-point objective (RPO);
- backup frequency, retention and geographic/account separation;
- PostgreSQL point-in-time recovery;
- object-storage versioning/replication;
- encryption keys and who can invoke a restore;
- monitoring for failed or stale backups; and
- drill frequency and the named on-call owner.

Until those decisions are implemented and a production-like timed restore
passes, `PLT-05` and the G1 backup gate remain open.
