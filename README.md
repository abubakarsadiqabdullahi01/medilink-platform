# Medilink

Verified healthcare workforce and locum management for the Nigerian market.
Companion documents: **System Documentation v2.9** and **Implementation Plan v1.2**.

Every module in the specification now has an implementation and an interface:
eighteen modules under `src/modules/`, three consoles under `src/app/`, and
the cross-cutting machinery they all sit on — authorisation, audit, the
outbox — in `src/lib/`. That machinery was built first and before any business
journey, in Stage 4, because none of it can be retrofitted.

What is deferred rather than built — the payment gateway, offline capture —
is listed in [docs/interfaces.md](docs/interfaces.md). The module-by-module
state is in [docs/module-map.md](docs/module-map.md).

## Stack

| Layer           | Choice                                                                             |
| --------------- | ---------------------------------------------------------------------------------- |
| Application     | Next.js (App Router), React, TypeScript                                            |
| Database        | PostgreSQL — the single primary datastore                                          |
| Data access     | Prisma (typed migrations and queries)                                              |
| Object storage  | Tigris (S3-compatible); MinIO locally                                              |
| Background work | PostgreSQL transactional outbox plus a worker process                              |
| UI              | Tailwind CSS, shadcn/ui conventions, Radix primitives, lucide-react, Framer Motion |
| Validation      | Zod at every input boundary                                                        |
| Testing         | Vitest, Testing Library, Playwright                                                |
| Mobile          | PWA first; Flutter client (Android first) after the API stabilises                 |

MongoDB is not part of the design. It would only be revisited as a secondary
store for a genuinely document-shaped, non-transactional feature, and never
for identity, assignment, timesheet, ledger or audit data.

## Quick start (Docker — nothing else to install)

```bash
cp .env.example .env          # PowerShell: Copy-Item .env.example .env
docker compose up -d
docker compose exec web pnpm prisma migrate dev --name init
docker compose exec web pnpm db:seed
docker compose exec web pnpm tsx scripts/seed-demo.ts
```

`pnpm db:seed` loads the controlled vocabularies and no people, which is right
for a production database and leaves a local one with nothing to sign in as.
`scripts/seed-demo.ts` fills that in: a simulated pilot — five facilities,
thirty-nine practitioners, sixteen weeks of shifts, invoices and payouts —
built through the application layer rather than by inserting rows, with the
login sheet printed at the end. It refuses to run unless `APP_ENV=local`,
because it creates accounts with a known password.

`docs/demo-walkthrough.md` is the guided tour of what it builds: which account
to sign in as to see each part of the product, and what each part is there to
demonstrate. `docs/testing-by-role.md` is the checklist version — what to do as
each role and what you should see — including where to read the one-time codes
during registration, since local development has no SMS gateway.

| Service                              | URL                                                |
| ------------------------------------ | -------------------------------------------------- |
| Application                          | http://localhost:3000                              |
| Health check                         | http://localhost:3000/api/v1/health                |
| MinIO console (stands in for Tigris) | http://localhost:9001 — medilink / medilink-secret |
| Mailpit (captured email)             | http://localhost:8025                              |
| PostgreSQL                           | localhost:5432 — medilink / medilink               |

## Quick start (host Node)

```bash
corepack enable pnpm          # if corepack is blocked: npm i -g pnpm
pnpm install
docker compose up -d db storage storage-init mail
pnpm prisma migrate dev --name init
pnpm db:seed
pnpm dev
```

## Verification commands

```bash
pnpm verify            # lint, typecheck, unit tests — run before every push
pnpm test:integration  # one suite per module, against a real database
pnpm test:e2e          # Playwright, needs the app running
pnpm db:updown         # migrate down and up again on an empty database
```

`pnpm test:integration` creates and migrates `medilink_test`, separate from the
development database because it truncates between cases. Run it inside the
container — `docker compose exec web pnpm test:integration` — unless the host
can reach PostgreSQL directly.

## Layout

```
prisma/schema.prisma      nineteen namespaced schemas, identity and audit
                          through to timesheets, rates and billing
prisma/seed.ts            controlled vocabularies, each with a named owner
src/app/                  routes; API under src/app/api/v1
src/modules/<module>/      one folder per specification module (Section 8.1)
src/lib/authz/            permissions and the permission-plus-scope guard
src/lib/http/             request context, responses, the guarded-route handler
src/lib/audit.ts          the audited-write helper
src/lib/audit-coverage.ts which tables must be audited, and the test harness
src/lib/outbox.ts         transactional event publishing
src/lib/storage/tigris.ts signed upload and download URLs
src/worker/processor.ts   claim, dispatch, retry, dead-letter
src/worker/               outbox worker loop and event handlers
docs/adr/                 the decisions and why they were made
tests/integration/        one suite per module, against a real database
tests/                    unit setup, e2e specs
```

Every module follows the same internal shape: `domain/`, `application/`,
`infrastructure/`, `presentation/`, plus `permissions.ts`, `routes.ts` and
`tests/`. Modules talk through domain events, never by reading each other's
tables.

## Rules that are not negotiable

1. Authorisation is enforced server-side by permission **and** scope, never by role alone.
2. Every state change writes an audit row in the same transaction.
3. Money is stored as an integer number of kobo. Never a float.
4. No binary file is stored in PostgreSQL; only the Tigris object key and metadata.
5. No practitioner is matched to work before identity and licence verification pass.
6. Migrations are backward-compatible for one release and must roll back.
