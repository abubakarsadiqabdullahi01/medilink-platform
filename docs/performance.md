# Performance

What is measured, what the budgets are, and how to check them again. For running
the product fast in front of an audience, see [running-a-demo.md](running-a-demo.md):
that is a production build on the demo data. This page is about whether the
system stays fast when it is *large*.

## Budgets

| Measure | Budget |
| --- | --- |
| Normal API route, 95th percentile | under 300 ms |
| Aggregation route (dashboards, finance summary), 95th percentile | under 750 ms |
| API requests to open a dashboard | at most 5 |
| Any route fetched more than twice by one page | none (that is a request per row) |
| Navigation visible, empty cache, Slow 4G with the CPU slowed 4x | under 2 s |

Measured on production-sized data, against a production build. Against
`next dev` the numbers describe the compiler, not the system.

## The three checks

All three run against the `medilink_perf` database, which never touches the demo
data.

```bash
# 1. Create it and load the volumes below (about five seconds).
docker compose exec db psql -U medilink -d postgres -c "CREATE DATABASE medilink_perf"
docker compose exec web sh -c 'export DATABASE_URL=$(echo "$DATABASE_URL" | sed "s#/medilink?#/medilink_perf?#");
  pnpm prisma migrate deploy && pnpm db:seed && pnpm tsx scripts/seed-performance.ts'

# 2. API latency (scripts/load-test.ts): start a production server on that database and drive it.
docker compose exec -d web sh -c 'export NODE_ENV=production NEXT_DIST_DIR=.next-e2e \
  DATABASE_URL=$(echo "$DATABASE_URL" | sed "s#/medilink?#/medilink_perf?#"); pnpm exec next start -p 3200'
docker compose exec web sh -c 'BASE_URL=http://localhost:3200 pnpm tsx scripts/load-test.ts'

# 3. What a first visit costs in a browser (scripts/page-budget.mjs).
E2E_DATABASE_URL='postgresql://medilink:medilink@db:5432/medilink_perf?schema=public' \
  docker compose --profile e2e up -d --force-recreate e2e
node scripts/page-budget.mjs
docker compose --profile e2e up -d --force-recreate e2e   # back to the dev database
```

Both scripts exit non-zero when a budget is broken, so they can gate a release.
`scripts/seed-performance.ts` refuses to run on any database not named `*_perf`.

Record each accepted run below with the commit, machine/profile, volumes and
complete command output. A result on `next dev`, a partially seeded database or
an unrecorded machine profile is diagnostic only and cannot close a release
gate.

Volumes: 100 facilities, 1,000 practitioners, 4,000 shifts, 12,000 assignments,
10,000 invoices with a line each, 100,000 audit entries. The first facility is a
large hospital (a quarter of the shifts, about 3,000 assignments, 2,000
invoices), because the slow cases are always the busiest account.

## Where the time goes: `/admin/performance`

Every guarded request records its route, status, total time, how much of that was
the database, how many queries it ran and how large the response was
(`src/lib/http/timing.ts`). The same figures:

- come back on every response as a `Server-Timing` header, visible in the
  browser's network panel;
- are logged as a `slow request` warning past `SLOW_REQUEST_MS` (default 500);
- are aggregated per route at **Performance** in the operations console
  (`GET /api/v1/admin/performance`, `audit.read`), slowest 95th percentile first.

Read the shape: a high query count with a small time per query is a loop that
should be one query; few queries and a long time is a missing index. The
aggregate lives in memory, per process, and resets on restart; it is a
diagnostic for whoever is running the pilot, not a metrics pipeline.
`handleGuardedRequest` and the three dashboards (which cannot use it because
they answer to several permissions) share one wrapper, `timed()`. About a dozen
auth routes do not go through either and are not timed.

## Recorded runs

### 16 October 2026 — local G0 validation

The G0 validation branch, based on `main` at `71b5901`, passed both read-side
budgets on Docker Desktop for Windows with PostgreSQL 16 and Chrome. The data
was freshly migrated and reseeded at the volumes above.

| Check | Result |
| --- | --- |
| API latency | All 15 routes passed, 40 requests per route at concurrency 4 |
| Normal-route p95 | 39–83 ms (budget: under 300 ms) |
| Dashboard p95 | 44–141 ms (budget: under 750 ms) |
| Browser pages | All 11 passed on Slow 4G, CPU slowed 4x, empty cache |
| Navigation visible | 331–484 ms (budget: under 2 s) |
| API calls per page | 2–4; no route repeated (budgets: at most 5 and at most 2) |

The browser check was repeated because the first pass ran immediately after the
Docker image build and three facility navigations took 2.103–2.202 seconds with
no API request started. The immediate repeat produced the figures above and all
11 pages passed. Keep that first pass as local-host contention evidence rather
than treating one warm result as proof of production capacity.

This closes the recorded dashboard/browser part of `X02-09`, not the whole
task. Matching writes, concurrent offer acceptance, notification fan-out and
settlement still need production-volume write and contention tests. Keep
failures as well as passes: they are evidence of the curve the next change is
meant to improve.

## What changed, and what it bought

**One request per list, not one per row.** `GET /api/v1/assignments` takes
`include=attendance,timesheet` and joins them in one to three batch queries.
Facility Timesheets, Practitioner Timesheets, the Roster and My Shifts used to
fetch attendance or a timesheet for every row.

**One request per dashboard.** `/api/v1/dashboard/{platform,facility,finance,practitioner}`
return every number and chart series the page draws. Each section is computed
only if the caller holds its permission (a summary is a second door onto the same
data); the practitioner overview seeds the cache keys the profile and offers
pages already use.

**Paged, not whole.** The platform-wide invoice table is
`GET /api/v1/finance/invoices` (cursor, status, facility search). A facility's
own `GET /api/v1/invoices` is now paged and returns all-time `totals` alongside,
because a sum over the rows on screen changes as someone pages. At 2,000
invoices it was a 2.3 MB, 584 ms response; it is 24 KB and 56 ms.

**The shell no longer waits for a round trip.** The three console layouts look
the session up on the server (`modules/auth/application/session-state.ts`, the
same function behind `GET /api/v1/auth/session`) and put it in the first HTML. The
navigation arrives with the page instead of after the scripts load, hydrate and
ask. Navigation visible went from about 2.3 s to about 0.4 s on the throttled
profile, and every page lost a request. A missing session is passed as `null`, not
redirected on the server: the client provider already turns a 401 into the sign-in
page, and one place deciding that keeps them from disagreeing.

**Charts load after the page.** Recharts is a separate chunk
(`app/admin/growth-chart.tsx`, `components/app/money-charts.tsx`) loaded with
`next/dynamic` once the tiles have drawn. First-load JavaScript: Admin dashboard
237 to 135 kB, Admin Finance 266 to 163 kB, Facility dashboard 262 to 160 kB.

**Indexes** (migration `20261013090000_scale_indexes`), each checked with
`EXPLAIN ANALYZE` on the data above:

| Index | Serves | Buffers read |
| --- | --- | --- |
| `assignments (facility_id, status, starts_at, id)` | roster filtered by status | 230 to 15 |
| `assignments (user_id, status, starts_at, id)` | a practitioner's shifts by status | 14 to 11 |
| `service_requests (facility_id, status, starts_at, id)` replaces `(facility_id, status)` | a facility's shifts by status, in order | 27 to 21 |
| `invoices (facility_id, period_start, status)` replaces `(facility_id, status)` | statements and spend by period | 201 to 115 |

`assignments (facility_id, starts_at)` was **not** replaced, although the plan
called for it. The unfiltered roster, the default, needs it: without it that query
reads and sorts all 3,000 of the large facility's rows to return a page (0.12 ms
to 3.6 ms, growing with history). `assignments (user_id, starts_at, ends_at)` stays
because the overlap checks need `ends_at`.

At this size every one of these queries was already under a millisecond: the
tables fit in cache. The indexes are about the curve, not today's number. The
buffer counts are the figures that do not move with the machine.

## The worker

The outbox is polled every 2 s while work is arriving and for a minute after,
then every 5 s (`src/worker/polling.ts`). The scheduled-job table, whose jobs
recur hourly at the shortest, is checked every 30 s instead of every pass. The
idle ceiling is 5 s rather than 15 s on purpose: a practitioner who has just
signed up is waiting for the event that grants their role, and the sign-up screen
waits about eight seconds for it, so a longer ceiling would make nearly every
sign-up (they are sparse, so they land in the slow state) time out. Moving to
`LISTEN/NOTIFY` would remove the polling altogether; it needs a Postgres driver
that supports it and none is installed.

## Known limits

- "Invoiced" and "Platform fees" on the finance console sum every invoice,
  drafts and voided ones included. That is what the page did before the summary
  moved to SQL and the summary reproduces it. Whether they should is a product
  decision.
- The browser budget runs Chrome over HTTP/1.1 to a local server, which limits
  parallel script downloads more than a CDN would. It is a stricter test than
  production, not a looser one.
- The page budget covers the admin, facility-owner and practitioner consoles on
  eleven pages. The remaining screens have not been measured at volume.
