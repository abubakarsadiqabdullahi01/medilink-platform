# Running a demo that does not wait

The development server is for writing code. For showing the product, use the
production build. The difference is not small: opening the operations dashboard
took **10.5 s cold and 3.5 s warm** on the development server, and **0.9 s and
0.8 s** on a production build, on the same data and the same machine.

## Why the development server is slow here

- `next dev` compiles each page and each API route **the first time somebody opens
  it**. Every screen in a presentation is somebody's first visit.
- The project lives on a Windows folder mounted into Docker. Every file the
  compiler reads crosses that boundary, which is much slower than a Linux
  filesystem, and file-change events do not cross it at all (which is why a
  restart is needed after an edit).

A production build compiles everything once, up front, and then serves it.

## To present

```powershell
scripts\demo.ps1 on        # stops the dev server, builds, serves http://localhost:3000
scripts\demo.ps1 status    # which one is running
scripts\demo.ps1 off       # back to the dev server, with hot reload
```

The first `on` takes a minute or two (it is building). After that it is instant.
**Code changes are not picked up in demo mode**; run `off` to work, `on` to show.
The worker, database, storage and mail containers are shared and keep running.

Fill the data first, then switch on: `docker compose exec web pnpm tsx scripts/seed-demo.ts`
(timed shifts are relative to when it runs, so seed within the hour).

## Working faster day to day (optional)

Keeping the repository inside WSL (`\wsl$\...` or `~/medilink` in an Ubuntu
shell) and running Docker from there removes the slow mount entirely: compiles
are several times quicker and edits are noticed without a restart. It is a
one-time move; the commands in this repository are unchanged.

## What the dashboards do now

Both dashboards load from **one request each**, computed in the database:

- `GET /api/v1/dashboard/platform` — queue counts and oldest dates, incident
  severity, the growth chart by month, and the latest activity.
- `GET /api/v1/dashboard/facility?facilityId=` — published shifts, the roster,
  timesheets awaiting approval, weekly fulfilment and monthly spend.

They used to download whole queues to count them, page through the audit trail
200 rows at a time (up to twenty round trips) for the growth chart, and fetch
one timesheet per confirmed shift. Each section appears only if the caller holds
its permission; see `tests/integration/dashboard-summary.test.ts`.

The session is also kept on screen through a failed background refresh. Only a
401 (really signed out) sends somebody to the login page; a slow or failed
response shows "Could not reach Medilink" with a retry, instead of bouncing them.

How the system behaves when it is large, and the budgets and scripts that check it: [performance.md](performance.md).

The accounts in the demonstration are synthetic and local-only. Their intended
roles, public demo password and the checks that keep them out of real
environments are recorded in [test-and-demo-access.md](test-and-demo-access.md).
