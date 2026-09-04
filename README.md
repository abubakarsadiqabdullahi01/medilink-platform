# Medilink

Verified healthcare workforce and locum management for the Nigerian market.
Companion documents: **System Documentation v2.9** and **Implementation Plan v1.2**.

This repository is the Stage 4 (Foundations) scaffold. It contains the
cross-cutting machinery every later module depends on and no business
journeys yet — deliberately, because authorisation, audit and the outbox
cannot be retrofitted.

## Stack

| Layer | Choice |
| --- | --- |
| Application | Next.js (App Router), React, TypeScript |
| Database | PostgreSQL — the single primary datastore |
| Data access | Prisma (typed migrations and queries) |
| Object storage | Tigris (S3-compatible); MinIO locally |
| Background work | PostgreSQL transactional outbox plus a worker process |
| UI | Tailwind CSS, shadcn/ui conventions, Radix primitives, lucide-react, Framer Motion |
| Validation | Zod at every input boundary |
| Testing | Vitest, Testing Library, Playwright |
| Mobile | PWA first; Flutter client (Android first) after the API stabilises |

MongoDB is not part of the design. It would only be revisited as a secondary
store for a genuinely document-shaped, non-transactional feature, and never
for identity, assignment, timesheet, ledger or audit data.

## Quick start (Docker — nothing else to install)

```bash
cp .env.example .env          # PowerShell: Copy-Item .env.example .env
docker compose up -d
docker compose exec web pnpm prisma migrate dev --name init
docker compose exec web pnpm db:seed
```

| Service | URL |
| --- | --- |
| Application | http://localhost:3000 |
| Health check | http://localhost:3000/api/v1/health |
| MinIO console (stands in for Tigris) | http://localhost:9001 — medilink / medilink-secret |
| Mailpit (captured email) | http://localhost:8025 |
| PostgreSQL | localhost:5432 — medilink / medilink |

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
pnpm verify        # lint, typecheck, unit tests — run before every push
pnpm test:e2e      # Playwright, needs the app running
pnpm db:updown     # migrate down and up again on an empty database
```

## Layout

```
prisma/schema.prisma      identity, audit, config and storage schemas
prisma/seed.ts            controlled vocabularies, each with a named owner
src/app/                  routes; API under src/app/api/v1
src/modules/<module>/      one folder per specification module (Section 8.1)
src/lib/authz/            permissions and the permission-plus-scope guard
src/lib/audit.ts          the audited-write helper
src/lib/outbox.ts         transactional event publishing
src/lib/storage/tigris.ts signed upload and download URLs
src/worker/               outbox worker and event handlers
docs/adr/                 the decisions and why they were made
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
