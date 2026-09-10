# Stage 5.2 — credential verification

Implements module 3 of the specification: a practitioner submits evidence
for a credential type, a compliance officer reviews it. This is the first
module where one user acts on another user's resource — everything in
Stage 5.1 was SELF-only.

## Model

Many rows per user, not 1:1 like the practitioner profile: a practitioner
holds several credential types over time and may resubmit after a
rejection. Each submission (`credentials.credential_submissions`) names a
`CredentialType` (already seeded — MDCN licence, NIN, MBBS certificate,
NYSC certificate, good standing, indemnity cover) and carries either a
reference number or an uploaded document, whichever that type's
`verificationMethod` calls for. A submission is `PENDING`, `VERIFIED` or
`REJECTED`; a `REJECTED` row does not block a fresh submission of the same
type.

## Flow

1. `POST /api/v1/credentials/document-upload-url` — a signed Tigris PUT URL,
   only needed for document-evidence types.
2. `POST /api/v1/credentials` — submit. Requires `credential.submit`, SELF
   scope, fixed to the caller.
3. `GET /api/v1/credentials` — list. Requires `credential.document.read`;
   the caller states `scopeType=SELF` for their own history or
   `scopeType=PLATFORM` for a reviewer's queue (optionally narrowed to one
   practitioner via `scopeId`).
4. `POST /api/v1/credentials/:id/review` — approve or reject. Requires
   `credential.review`, PLATFORM scope only — there is no SELF-scoped
   review.
5. `POST /api/v1/credentials/:id/document-url` — a signed Tigris GET URL for
   the submission's document. SELF for the owner, PLATFORM for a reviewer.

## Policy

| Control | Value | Where |
| --- | --- | --- |
| Reference number length | 100 characters | `REFERENCE_NUMBER_MAX_LENGTH` |
| Review notes length | 1000 characters | `REVIEW_NOTES_MAX_LENGTH` |
| Reference-number methods | `nimc_verification`, `mdcn_status_check` | `requiredEvidenceFor` |
| Everything else | requires a document | `requiredEvidenceFor` |
| Document content types / size | same as practitioner photos | `lib/storage/tigris.ts` |

## The gap this closes

`credential.document.read` was defined and bundled into both the
`practitioner` and `compliance_officer` roles since Stage 4, and had zero
enforcement anywhere — as dead as the role-granting gap Stage 5.1 closed.
This module is what actually exercises it, on both the list endpoint and
the document-download endpoint.

A second, narrower gap was found and closed while designing this: nothing
stopped a user holding both `practitioner` and `compliance_officer` from
approving their own submission. `reviewCredential` now refuses that
explicitly (`cannot_review_own_submission`, 403) rather than leaving it as
a documented-but-open loophole in a regulated marketplace.

## Decisions worth knowing

**Listing and document access are the first endpoints where the caller
states the scope, not just the record.** Every Stage 5.1 endpoint fixed its
own scope to SELF; a compliance officer reviewing someone else's submission
cannot be framed that way at all — `isAuthorized` refuses `{type: 'SELF',
id}` unconditionally when `id` is not the caller's own, regardless of
grants. The list and document-url endpoints instead reuse the pattern
`GET /api/v1/audit` already established: the caller names `scopeType` in
the request, and the same value drives both the permission check and the
database filter, so authorising one scope and querying a wider one is not a
shape the code can express.

**The review audit row is scoped to the practitioner, not the reviewer.**
`recordAudit`'s `scopeType`/`scopeId` describe whose record this is about,
not who acted — `actorId` is that. A `credential.verified` row tagged
`SELF`/reviewer-id would be invisible to the practitioner's own SELF-scoped
audit history, which defeats the point: the person the review is about must
be able to see it happened to them.

**`reviewedBy` is a bare column, not a Prisma relation.** It mirrors the
existing `audit.security_events.user_id` — nullable, no `@relation`, no
back-relation on `User`, no database-level foreign key. The audit row
`reviewCredential` writes in the same transaction is the system of record
for who reviewed something; this column is a denormalised convenience for
reading a submission back without a join.

**No partial unique index for "one active submission per (user, credential
type)."** Prisma's schema DSL cannot express a filtered/partial index, and
hand-writing one into a migration would drift the next time anyone runs
`prisma migrate dev` for something unrelated — Prisma would see an index it
does not know about and offer to drop it. The duplicate check is an
application-level pre-check only, stated plainly as best-effort rather than
a guarantee: a genuinely concurrent double-submit of the same type can
still race past it, and the worst case is a reviewer seeing two `PENDING`
rows and rejecting the extra one.

**`handleGuardedRequest` takes an optional third `routeParams` argument.**
Nothing before this module used a dynamic route segment. `[id]/review` and
`[id]/document-url` pass Next.js's `params` through; it is merged into the
parsed input after the query/body, so the URL always wins over a
same-named field — the path is authoritative for identity. All seven
pre-existing call sites are untouched.

## Step 5.7 — requesting more information

A reviewer's third option, added after this module first shipped. `decision:
'request_info'` moves the submission to `MORE_INFO_REQUESTED` rather than
deciding it, and requires a note saying what is missing — a request that does
not say what it wants is worse than no request.

From there, and **only** from there, the practitioner may `PATCH
/api/v1/credentials/:id` to supply what was asked for, which returns the row
to `PENDING`. `reviewedBy`, `reviewedAt` and `reviewNotes` are cleared on
resupply, because they described the request and the request has been
answered; what was asked survives on the `credential.info_requested` audit row.

A submission awaiting information counts as active, so it still blocks a
second submission of the same credential type: the practitioner should answer
on the existing row rather than open one the reviewer has to reconcile.

## Not in this stage

- **NIMC or MDCN API verification.** `verificationMethod` is stored and
  returned but does not change the code path: every submission, regardless
  of method, goes through the same manual review. Building either
  integration needs real provider credentials this project does not have —
  the same reasoning that deferred Stage 4.7's SMS gateway. No Docker-mocked
  provider API either: it would prove the plumbing pattern works, which the
  SMS adapter already does, not anything about NIMC's or MDCN's actual
  contract.
- **Automatic `UserStatus` activation.** Nothing in the codebase transitions
  a user from `UNDER_REVIEW` to `ACTIVE`, or checks for `ACTIVE` at all — a
  gap that predates this module. The natural trigger would be "every
  mandatory credential for this practitioner's professional category is
  verified," but `CredentialType` has no relationship to
  `ProfessionalCategory` — it is a flat list. `isMandatory: true` currently
  includes `mdcn_practising_licence` and `mbbs_certificate`, which are
  doctor-specific; applying that flag globally would mean a nurse or
  pharmacist appears to need a doctor's licence to activate. Building
  auto-activation on the current schema would be actively wrong, not just
  incomplete, so it needs a schema decision (most likely a category ↔
  credential-type mapping) before it can be built at all.
- **Expiry sweep.** `expiresAt` is computed and stored at verification time
  from `credentialType.reviewDays`, but nothing reads it — there is no
  cron or scheduled-job mechanism anywhere in this codebase. `EVENTS.
  CredentialExpired` is declared in the event vocabulary but not published
  by anything in this cut.
- **Editing a `PENDING` submission.** Still deliberately absent: a reviewer
  must never be looking at one version while the practitioner replaces it
  underneath them. A practitioner who mistypes a reference number waits for
  the reviewer to reject it or to ask for more information.

  Step 5.7 has since added the second of those — see below.

## Verifying it locally

```
docker compose exec web pnpm test
docker compose exec web pnpm test:integration
```

Submit as a practitioner, review as a compliance officer:

```
curl -X POST http://localhost:3000/api/v1/credentials \
  -H 'content-type: application/json' -b cookies.txt \
  -d '{"credentialTypeId":"<a config.credential_types id>","referenceNumber":"A12345678"}'

curl -X POST http://localhost:3000/api/v1/credentials/<submission id>/review \
  -H 'content-type: application/json' -b officer_cookies.txt \
  -d '{"decision":"approve"}'
```
