# The audit trail's nightly digest

**What it is for.** The audit table cannot be updated or deleted from: a database trigger refuses
both (migration `20261016130000_audit_log_append_only`). That stops a careless change. It does not stop
somebody who owns the table, who can switch the trigger off, edit a row and switch it back on, after
which nothing would show it. The digest is how that would show.

**What it does.** Once a day the job `audit.digest_sweep` (in `src/worker/jobs.ts`):

1. Recomputes every day already sealed and compares it with what was stored.
2. Seals each finished day not yet sealed: the number of rows it held, and a hash of all of them
   (every column of every row, in order), chained to the digest of the day before.
3. Fails, naming the day, if any sealed day no longer matches.

A day is sealed only two hours after it ends, so a transaction that began on it and committed late is
in the figures. A day with no rows is sealed too (empty), so nothing can be written into it later
without that showing. A day is a UTC day.

## When it fails

The job's last error is on the System health screen, and the log line is
`audit_digest_mismatch` with `day`, `cause` and `daysInDoubt` (never a row's content):

- `cause: changed` — a row on that day was edited, removed or added, or its stored digest was edited.
  Every sealed day after it chains from it and is in doubt too (`daysInDoubt` counts them).
- `cause: missing_day` — a stored digest is missing from the middle of the run.

Work out first whether somebody changed the trail on purpose: a migration or a repair that touched
`audit.audit_log` will do this, and the digest is right to say so. If nobody did, treat it as an
incident: the logs for that day (`audit_digest_sealed` lines, request logs, database logs) say what
the trail held when it was sealed and who had access since. The failure repeats every night until
somebody decides what to do about it; sealed digests are never rewritten by the job.

## What it does not cover

- **A change by the database's owner who also rewrites the digests**, or deletes the latest ones so
  they are sealed again from the changed rows. The check that survives that is a copy held where the
  owner cannot reach. Each sealing is logged as `audit_digest_sealed` with the day, the count and the
  digest, which is a line a log service can keep; keeping those lines off the database host is the
  step that makes the digest a defence against that person, and nothing here does it.
- **Today's rows, and yesterday's until the delay has passed.** A day is vouched for only once sealed.
- **`TRUNCATE`.** Emptying the table changes every sealed day and would be noticed; the trigger does
  not refuse it, because the test suite and the local reset script do it on purpose.
- **Cost.** The check recomputes every sealed day in one scan of the table each night. That is fine
  at a pilot's size; at tens of millions of rows it should become a rolling window with a full check
  weekly.

## Changing it

`DIGESTED_COLUMNS` in `src/modules/audit-compliance/domain/audit-digest.ts` names every column of an
audit row. It is a list and not read from the table so that adding a column does not quietly change
what every sealed day says; an integration test fails when the table and the list differ, and adding a
column means deciding what happens to the days already sealed.
