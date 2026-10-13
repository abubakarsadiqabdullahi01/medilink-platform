# Running the whole thing end to end

The URL is **http://localhost:3000** once the stack is up, and there are three
consoles behind it — `/admin`, `/facility` and `/practitioner`. This page is
about the other way to exercise the product: the script below walks one shift
from a facility that does not exist yet to a timesheet that has been disputed,
upheld, corrected and approved, then reports a clinical incident and suspends
somebody for it, entirely over HTTP and without loading a page.

If what you want is a demo to look at rather than a walk to run, you want
`scripts/seed-demo.ts` and the login sheet it prints — see "Running it" in
`docs/interfaces.md`.

```bash
docker compose up -d
```

```bash
docker compose exec web pnpm prisma migrate deploy && docker compose exec web pnpm db:seed
```

```bash
docker compose exec web pnpm tsx scripts/bootstrap-demo.ts
```

```bash
python scripts/e2e.py
```

45 checks, and it prints which one failed.

## Why a script and not the test suite

The integration suite imports the application layer directly. It never loads a
route, never parses a cookie, and never sees Next at all — so it cannot tell
you that a route file compiles, that the guard is wired to it, that Zod
rejects the body, or that the session cookie survives a round trip. This does
all of that, against the real server, over HTTP.

It is also the only check that catches the trap in
`docs/scheduled-jobs.md`: **a new route segment needs
`docker compose restart web`** before the dev server will serve it. Every
route in this walk 404'd the first time for exactly that reason.

## What the bootstrap is for

`prisma/seed.ts` loads controlled vocabularies and no people, which is right —
a production database should not ship with accounts. But that leaves an
end-to-end run unable to start: a practitioner can register through the API
and a compliance officer cannot, because nothing grants a `PLATFORM` role and
granting one is precisely what a `PLATFORM` role is for.

Somebody has to be the first administrator. On a real system that is
`scripts/create-first-administrator.ts`, which is safe to run in production: it
asks for the password at the terminal and never prints it, refuses once a super
administrator exists, will not touch an account that is already there, and
writes an audit row saying it was run. `--additional` is the deliberate way
round the second refusal, for when every administrator has lost access.

For local work, `scripts/bootstrap-demo.ts` is
that somebody, for local only — it refuses to run unless `APP_ENV=local`,
because a script that creates administrators with a known password has no
business near production. It is idempotent, so run it as often as you like.

| Account | Phone | Role |
| --- | --- | --- |
| Operations | `+2348031100001` | `administrator` at PLATFORM |
| Compliance | `+2348031100002` | `administrator` at PLATFORM |
| Super administrator | `+2348031100003` | everything, at PLATFORM |

Password for all three: `Medilink-demo-2026`. Not a secret and not meant to be.

These three belong to this walk and exist only once the bootstrap has run. They
are not the accounts to sign in with in a browser: `scripts/seed-demo.ts`
builds a whole simulated pilot on the `+2348031200xxx` block — fifty-three
accounts across four platform roles, four facility roles and ten named
practitioners — and prints its own login sheet when it finishes.

The two scripts share no phone number, no CAC number and no email address, so
running either leaves the other's world alone.

The two scripts do share their scaffolding, though — the demo password, the
local-only refusal, the argon2 hash and the role sync all live in
`scripts/support/demo.ts` and `src/lib/authz/sync-roles.ts`. They used to be
copied into each script, and the copies had drifted far enough to undo each
other: both reset every role's name to its slug, and neither removed a
permission that had left a bundle, so a bootstrapped database granted
whatever any previous version of the code had granted. What differs between
the two scripts is the world each builds, which is the part worth having
twice. That also means the bootstrap's
accounts outlive a `seed-demo` re-run: `seed-demo` recognises its own work by
email domain and CAC prefix, and the bootstrap writes neither. It is deliberate,
because this walk needs them between runs — but a database that has seen both
scripts carries a super administrator the login sheet does not list, and a
sixth facility the pilot does not explain.

## What the walk covers

1. **Health, and the demo actors.**
2. **Authentication** — a practitioner registers, the one-time code is read out
   of the web container's log (which is what the console SMS adapter is for),
   the phone verifies, a password is set, they sign in. The session endpoint
   returns permissions rather than roles.
3. **A facility** created by operations and verified by compliance — and the
   same verify call refused, 403, for the practitioner. The scope boundary on
   a real endpoint.
4. **A shift** drafted, published, offered, accepted and confirmed.
5. **Attendance** by the manual fallback, because a token round trip would
   stamp the clock twice in a second and a shift of nought minutes tests no
   arithmetic.
6. **A timesheet** — eight hours at the agreed rate, ₦40,000 in kobo; a
   rejection with no reason refused; approval carrying the assignment to
   `COMPLETED`.
7. **A dispute, all the way round** — opened, the shift moves to `DISPUTED`,
   resolving with no reason refused, upheld, the figures go back to
   `SUBMITTED`, the facility corrects to ten hours at revision 2, **the
   original eight is still readable in the revision**, resubmitted, approved.
8. **A clinical incident** — reported as `SEVERE`, refused a close before
   anybody opened it, then closed with a suspension. The suspended
   practitioner's own session stops working on the next request, and the
   suspension record says who and why.
9. **The suggestion log** and **the audit trail**.

## If it fails

- `the app answers` fails → the stack is not up, or port 3000 is taken.
- Anything 404s with an HTML body → a new route segment; `docker compose
  restart web`.
- `bootstrap failed` with a reference-data error → `docker compose exec web
  pnpm db:seed`.
- A sweep-related failure → the worker keeps its **own** `node_modules`, so
  after a migration it needs `docker compose exec worker pnpm prisma generate`
  and a restart.

## What it does not cover

- **Anything a browser does.** This script drives the API directly and never
  renders a page. The browser journeys below do.
- **File upload.** Credential documents, facility licences and dispute
  evidence all go to a signed Tigris URL, and the walk does not push bytes.
  The onboarding journey does, for a credential document.
- **The scheduled sweeps.** They run hourly in the worker; `docs/scheduled-
  jobs.md` covers forcing one.
- **Taking an actual payment.** Modules 11 and 12 are built — rate cards,
  invoices, a double-entry ledger and payouts — but the gateway is a stub that
  refuses to run outside `local`, so this walk stops at a payment recorded
  rather than a payment taken. `scripts/seed-demo.ts` carries invoices and
  payouts through every state if you want to look at them.

## The browser journeys

`pnpm test:e2e` drives the three consoles in a real browser with Playwright:
the same stories as the walk above, but through the pages a person uses.

Run them against the built app, not the dev server. The `e2e` service builds
and serves the app the way production does, on port 3100, into its own
`.next-e2e` — so nothing done to `web` in the meantime (a restart, a build)
can pull the app out from under a run, and no route is compiled on its first
request. The whole suite takes under a minute that way, against ten or more
on `next dev`.

```bash
docker compose up -d
```

```bash
docker compose --profile e2e up -d e2e
```

```bash
APP_URL=http://localhost:3100 E2E_SERVICE=e2e E2E_BROWSER_CHANNEL=chrome pnpm test:e2e
```

The service borrows `web`'s image and installed `node_modules`, so starting it
needs no network. It builds once when it starts; after changing code,
`docker compose --profile e2e restart e2e` rebuilds. Against the dev server
instead, leave out `APP_URL` and `E2E_SERVICE`.

`E2E_BROWSER_CHANNEL=chrome` (or `msedge`) uses the browser already on the
machine; leave it out to use Playwright's own Chromium after
`pnpm exec playwright install chromium`. CI does the latter.

| File | The story |
| --- | --- |
| `auth.spec.ts` | Sign up through the three-step form with the real one-time code; each role's sign-in lands in its own console; a wrong code, a wrong password and a signed-out visitor are refused. |
| `staffing.spec.ts` | A scheduler publishes a shift, ranks candidates, offers it; the nurse accepts; the scheduler confirms her. |
| `attendance.spec.ts` | The ward reads out a check-in code, the nurse types it in, then the same for check-out; a wrong code changes nothing. |
| `after-the-shift.spec.ts` | A shift recorded by hand, priced by the worker, submitted, approved, disputed, and decided by an administrator. |
| `onboarding.spec.ts` | A newcomer builds a profile, submits a credential by number and one by uploaded document; an administrator verifies one and asks for more on the other. |
| `oversight.spec.ts` | An administrator verifies a waiting facility; a ward reports an incident and an administrator closes it with a finding. |
| `money.spec.ts` | An administrator invoices approved work and issues it; the hospital sees what it owes; payment is recorded; the nurse sees what she is owed, and is paid. |
| `multisite.spec.ts` | Somebody at two hospitals chooses which one the facility console acts for, and every page follows. |
| `mobile.spec.ts` | Every practitioner page at phone size, with no sideways scroll, and the menu working. |

**Their world.** Global setup runs `scripts/e2e-world.ts`, which wipes what
the previous run left and builds a small known starting point: an
administrator, a verified hospital with its owner and scheduler, a hospital
waiting for verification, a nurse cleared to work, one who has only just
signed up, a scheduler at both hospitals, and three of the nurse's shifts —
one worked and approved yesterday, one nearly over, one about to start. Everything it makes is tagged — the
`e2e.medilink.test` email domain, the `RC99` CAC prefix, phones on
`+23480399000NN` — so it shares nothing with the demo seed or the bootstrap,
and the demo data a local run shares the database with is left alone.
Locally it runs inside the `web` container, because a native PostgreSQL on
some Windows machines answers port 5432 before Docker does.

**One-time codes.** The journeys sign up through the real form, so they need
the code it sent. `SMS_CONSOLE_OUTBOX` makes the console SMS adapter append
each message to `.e2e/sms-outbox.jsonl` as well as printing it;
`docker-compose.yml` sets it for `web` and `worker`, and the console adapter
refuses to run outside `local` either way.

**The worker has to be running.** The practitioner grant after sign-up and
every timesheet arrive through the outbox; global setup refuses to start if an
event has been waiting more than 90 seconds.

**If a journey fails against the dev server**, it is usually `next dev`
compiling a route on its first request. Global setup requests every page and
route the journeys use before they run, but a restart in the middle of a run
undoes that. A `Cannot find module './NNNN.js'` or a missing
`routes-manifest.json` in the `web` log means something ran `pnpm build` into
the dev server's `.next`; clear it and restart:

```bash
docker compose exec web sh -c "rm -rf /app/.next/*" && docker compose restart web
```

Run `pnpm build` on the host, or in a separate container, never inside `web`.
