# The operations console

The first interface in the repository. Before it, all seventy-five endpoints
were reachable only by `curl` or `scripts/e2e.py`, and the landing page still
said "Stage 4 machinery only" — which had been untrue for four stages.

**http://localhost:3000/admin**, after signing in at `/login`.

## What it covers

One console, for the people who work queues: operations and compliance.

| Page | Module | What it does |
| --- | --- | --- |
| Overview | — | Counts every queue the viewer may work |
| Credentials | 3 | Approve, reject, or ask for more |
| Facilities | 4 | Verify or reject, filtered by status |
| Incidents | 15 | Take a case, close it with an outcome |
| Disputes | 14 | Take, uphold or dismiss |
| Unhonoured shifts | 13 | Record fault against a shift nobody attended |
| Suggestions | 18 | Triage the pilot log, with counts by area |
| Audit trail | 17 | Read-only |

**Not covered:** the practitioner and facility journeys. Availability,
service requests, matching, attendance and timesheets all have working APIs
and no screens. A practitioner still cannot see a shift and a facility still
cannot publish one from a browser.

## Decisions

**The menu is built from permissions, not roles.** Every nav entry and every
overview tile names the permission it needs and is hidden without it — the
same question the guard asks. A menu built from role names would drift from
the guard the first time a bundle changed.

Hiding is a courtesy, never a control. Every endpoint refuses the call on its
own; nothing in the browser is load-bearing for security.

**Consequences are on the buttons.** "Uphold — send the figures back" and
"Dismiss — restore the record" rather than two identical buttons; the three
fault options each carry a line saying what they do, because only one of them
marks somebody's record. An officer working a queue at speed should not have
to remember which.

**Mandatory reasons are enforced twice.** The API refuses a rejection without
one, and the button stays disabled until it is typed. The same rule stated in
both places, deliberately — discovering it only after a server round trip is
how a form teaches people to write "asdf".

**`SYSTEM_ISSUE` is first in the incident outcome list**, as it is in the
enum. It is the commonest true answer to a clinical incident and the one a
blame-first process never reaches; suspension is near the bottom because it
should be the unusual answer rather than the one the cursor lands on.

**No filter by actor on the audit trail.** It exists to answer "what happened
to this record". A console that made it easy to answer "what has this person
been doing all week" is a surveillance tool wearing a compliance badge.

**Plain components, not a design system.** `src/components/ui/primitives.tsx`
is about a hundred lines, because all seven queues are the same shape: a list
of things with a status and two buttons. shadcn can replace them later without
touching a page.

## A bug it found immediately

The compliance officer's role bundle had `facility.verify` and **not**
`facility.read`. They could approve a facility and could not list the ones
waiting — a queue they were unable to open.

No test caught it because no test ever needed to *see* a queue before working
it; every integration test knows the id it is acting on. The first time
anybody had to find the work rather than be handed it, the API returned 403
and the tile showed a dash. `facility.read` is now in the bundle.

## Running it

```bash
docker compose exec web pnpm tsx scripts/seed-demo.ts
```

Then sign in at http://localhost:3000/login with `+2348031200003` (compliance),
`+2348031200002` (operations) or `+2348031200001` (everything), password
`Medilink-demo-2026`. The seed prints the whole login sheet when it finishes,
facility and practitioner accounts included, and a number works in either form
— `+2348031200003` or `0803 120 0003`.

`scripts/bootstrap-demo.ts` is a different thing and is not needed here. It
makes the three bare accounts `scripts/e2e.py` needs, on the `+23480311000xx`
block, and builds no history for any of them to work on.

A compliance officer sees fewer entries in the menu than an administrator —
which is the permission filtering working, not a page failing to load. The
count is deliberately not written down here: it has gone stale twice already,
once per console that landed.

**New route segments need `docker compose restart web`** before the dev
server serves them. This is the same trap `docs/end-to-end.md` describes.
