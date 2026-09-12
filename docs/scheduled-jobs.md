# Scheduled jobs

Recurring work — expiry sweeps, sanctions screening, eligibility
recomputation. Nothing in this codebase could run any of it before this, which
is what blocked steps 5.6 and 5.9, and what Stage 7 will need too.

## Where it runs

The same worker process as the outbox. `src/worker/index.ts` runs an outbox
pass and then a scheduled-job pass; neither is expensive when idle, and one
process is one thing to deploy, watch and restart.

No new dependency. The stack decision is "Postgres outbox plus worker;
Redis/BullMQ only if needed" (Implementation Plan §2.9), and this needs
neither — `src/worker/scheduler.ts` borrows the outbox's own mechanics.

## The model

`audit.scheduled_jobs`, one row per job: `key`, `intervalSeconds`, `enabled`,
`nextRunAt`, and the outcome of the last run. Rows come from `JOB_DEFINITIONS`
in `src/worker/jobs.ts` through the seed, so code and rows cannot drift — a
test asserts every definition has a handler and every handler has a
definition.

`enabled` is an operator's off switch: a sweep misbehaving in production is
stopped by one row, without a deploy. The seed deliberately does **not**
include `enabled` in its `update`, so a deploy cannot switch a disabled job
back on behind an operator's back.

## Decisions worth knowing

**The next run is `now() + interval`, not `nextRunAt + interval`.** After an
outage the latter would still be in the past, and a daily sweep down for a
week would run seven times in a row to "catch up" — which for an expiry sweep
means doing the same work repeatedly. Missed windows are skipped.

**The run is counted before the handler starts**, in the same statement that
takes the lock — exactly the reasoning `claimDueEvents` uses. A handler that
hangs rather than throwing must not be claimed again by the next pass.

**A failure is recorded and left until the next interval**, not retried
immediately. These are sweeps; one that failed because the database was
struggling should not then hammer it. `failureCount` is what an alert watches
— a sweep failing repeatedly is the signal, a single blip is not.

**One failing sweep does not stop the others in the same pass.**

**A row whose handler has been removed is logged at error level** and recorded
as failed. It means a deploy dropped the code but not the row, and the sweep
it names is silently not happening — which is precisely the failure that would
otherwise go unnoticed for months.

## A trap worth knowing

The worker container keeps its **own** `node_modules` volume. Running
`prisma migrate dev` inside `web` regenerates *web's* client, not the
worker's — so after a migration adds a model, every sweep touching it fails
with `Cannot read properties of undefined (reading 'findMany')` until you run

```bash
docker compose exec worker pnpm prisma generate
docker compose restart worker
```

This is not hypothetical: `service_request.expiry_sweep` failed exactly this
way on its first real run, while the four older sweeps carried on succeeding
because they only touch models the worker's client already knew.

## Not in this stage

- **No alerting.** `failureCount` and `lastError` are recorded and nothing
  watches them. The observability baseline in §2.8 of the plan covers this
  along with outbox dead-letter alerts, which are also still outstanding.
- **No sub-minute intervals**, and no cron expressions — a fixed interval is
  what every sweep here needs. A job that must run at a particular hour would
  need one.
- **No manual "run now"** for an operator. Setting `nextRunAt` to the past
  does it.

## Verifying it

```
docker compose exec web pnpm test:integration
```

`tests/integration/scheduler.test.ts` asserts claiming, the skip-don't-catch-up
rule, that a disabled job is never claimed, that a failure is recorded and
retried at the next interval, that one failing sweep does not block another,
and that two concurrent workers run each job exactly once.

Remember that the worker does **not** hot-reload: `docker compose restart
worker` after changing a handler.
