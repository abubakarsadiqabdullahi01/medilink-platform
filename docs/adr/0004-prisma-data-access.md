# ADR 0004 — Prisma as the typed database layer

**Status:** accepted · **Date:** 2026-09-04

## Context

The Implementation Plan required choosing Prisma or Drizzle before
implementation begins, and choosing one only.

## Decision

Prisma.

## Rationale

* Migration tooling with a clear up/down story, which the Stage 4 gate tests
  directly.
* A single schema file that doubles as readable documentation of the data
  model across four PostgreSQL schemas.
* Strong typed-client ergonomics for a team moving quickly through sixteen
  modules.

## Consequences

* Reporting, reconciliation and ledger queries that Prisma expresses awkwardly
  are written as reviewed raw SQL through `$queryRaw`, as the outbox worker
  already does with `FOR UPDATE SKIP LOCKED`.
* `previewFeatures = ["multiSchema"]` is required for the schema separation.
