# Local database refresh - 7 October 2026

The Docker development database `db:5432/medilink` was backed up and reset.
The 23 previous migrations were consolidated in order into
`20261007000000_baseline`, preserving their hand-written constraints and
data transformations. `20261007010000_query_indexes` adds indexes for global
audit pagination, scoped audit pagination, and notification duplicate lookups.
Existing indexes and the partial unique live-role-grant index are retained.

This is a fresh-database migration history. Do not apply it directly to an
existing deployed database with the old history; that database needs a separate
baseline reconciliation, without resetting its data.

The previous database dump and migration files are saved at:
`C:\Users\user\AppData\Local\Temp\medilink-refresh-20261007-143217`.

Reference data is loaded by `pnpm db:seed`. Realistic synthetic data is loaded
by `pnpm tsx scripts/seed-demo.ts` and covers the five current roles, hospital
onboarding, credential reviews, shifts, attendance, timesheets, disputes,
incidents, invoices and simulated payouts. No real payments are made.

Local demo sign-in: http://localhost:3000/login
Shared demo password: `Medilink-demo-2026`.
See `docs/demo-walkthrough.md` for scenarios and role accounts.

Indexes support the observed query patterns; this refresh is not a production
load-test result. Profile representative traffic before selecting further indexes.
