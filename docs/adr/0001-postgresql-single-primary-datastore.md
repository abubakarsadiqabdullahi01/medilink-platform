# ADR 0001 — PostgreSQL as the single primary datastore

**Status:** accepted · **Date:** 2026-09-04

## Context

The original draft paired MongoDB with AWS RDS, which is itself a relational
service — an inconsistency. Medilink's core workflows are staffing approvals,
attendance, timesheets, a financial ledger and an audit trail.

## Decision

PostgreSQL is the only primary datastore. MongoDB is not adopted.

## Rationale

* Assignment, timesheet, invoice and ledger operations need multi-row
  transactions with foreign-key integrity. Getting these wrong means paying
  the wrong practitioner the wrong amount.
* Audit and dispute evidence must be append-only and provably complete.
* One engine means one migration story, one backup and restore path, and one
  set of skills to hire for.

## Consequences

* Document-shaped data is modelled with `jsonb` columns where genuinely needed.
* MongoDB would only be revisited later as a **secondary** store for a
  document-shaped, non-transactional feature, and never for identity,
  assignment, timesheet, ledger or audit data.
