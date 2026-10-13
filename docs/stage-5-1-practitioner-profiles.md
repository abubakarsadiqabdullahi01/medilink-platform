# Stage 5.1 — practitioner profiles

Implements module 2 of the specification: a practitioner's own profile,
self-service, guarded by permission and scope like everything else.

## Model

One profile per user (`practitioners.practitioner_profiles`, `user_id`
unique). A required professional category, an optional specialty
constrained to that category, years of experience, a bio, an optional home
state, and an optional profile photo referenced by object key.

Identity and licence verification — NIN, MDCN practising licence,
qualification certificates — are not here. They are `CredentialType` rows
and belong to the credentials module (Stage 5, module 3), which does not
exist yet. This table holds only what a practitioner chooses to present
about themselves.

## Flow

1. `POST /api/v1/practitioners/me` — creates the profile. A second POST is
   refused; POST is not idempotent by convention, and a fully-specified 409
   beats blurring create and update audit semantics.
2. `GET /api/v1/practitioners/me` — reads it back. 404 (`profile_not_found`)
   until the first POST — a normal state for a freshly registered
   practitioner, not an error to hide behind a 200.
3. `PATCH /api/v1/practitioners/me` — partial update. Never upserts: 404 if
   no profile exists yet. Omitting a nullable field leaves it unchanged;
   passing `null` clears it.
4. `POST /api/v1/practitioners/me/photo-upload-url` — a signed Tigris PUT
   URL. The client uploads directly; the app never sees the bytes. The
   returned `objectKey` is passed to POST or PATCH to attach the photo, which
   confirms the upload actually landed before trusting the reference.

5. `POST /api/v1/practitioners/me/submit` — "I am done, review me" (added
   2026-10-12). Stamps `submitted_for_review_at` on the profile. See
   "Submitting for approval" below.

Registration (Stage 4.2) already ends by publishing
`EVENTS.PractitionerRegistered`. Its handler
(`src/worker/handlers.ts`) now also grants the practitioner the
`practitioner` role at `SELF` scope — see "the gap this closes" below.

## Policy

| Control | Value | Where |
| --- | --- | --- |
| Years of experience | 0–60 | `domain/profile.ts` |
| Bio length | 1000 characters | `BIO_MAX_LENGTH` |
| Photo content types | pdf, jpeg, png, webp, heic | `lib/storage/tigris.ts` |
| Photo size | 10 MB | `MAX_UPLOAD_BYTES` |

## Submitting for approval

Between registering and being offered work there are three things that are the
practitioner's to do — their details, when they can work, and the documents
their profession requires — and then a fourth that is nobody's but a compliance
officer's: checking all of it. Until the practitioner says they are done there
is nothing for the officer to check, so "done" is an explicit act:
`POST /api/v1/practitioners/me/submit`.

- **The server refuses an early one.** `application_incomplete` (422) names what
  is missing. The page shows the same checklist and disables its button, but the
  page is a courtesy — somebody calling the API directly must not put a
  half-finished application in front of an officer looking complete. A document
  still *waiting* for review counts as supplied (supplying is theirs, judging is
  the officer's); a rejected one does not.
- **Idempotent.** A second press changes nothing and writes no second audit row;
  the timestamp orders the officer's queue, so a retry must not reorder it.
- **SELF only.** The route names no user; the scope is the caller's own id.
- **Not an eligibility blocker, on purpose.** Only an officer's verification
  gates matching. Making submission a blocker would silently make every existing
  practitioner ineligible until they pressed a button. The UI treats anybody who
  is already eligible as approved.
- **What it changes for the officer.** `GET /api/v1/practitioners` takes
  `application=waiting|draft`. The admin Practitioners page opens on *Waiting for
  approval*, longest-waiting first, with *Not submitted yet* (including people
  with no profile) and *Everyone* beside it. Nothing stops an officer opening
  someone who has not submitted; they are simply not what the queue is made of.
- **Where it lives.** Pure rules in `domain/application-review.ts` (gaps and
  state: DRAFT → READY → WAITING → APPROVED); the write in
  `application/application-review.ts`. Availability belongs to another module,
  so the route asks it and hands the answer in.

## The gap this closes

Nothing before this granted any role to a newly registered user.
`practitioner.profile.write` was already bundled into the `practitioner`
role at `SELF` scope in the seed, but `identity.user_roles` stayed empty for
every practitioner forever — the permission existed on paper and nothing
ever handed it out. `grantPractitionerRoleOnRegistration`
(`src/modules/practitioners/application/role-grants.ts`) closes this by
reacting to the same event the worker already had a stub handler for.

It finds the existing grant before creating one, rather than a blind
upsert: `UserRole` has no `updatedAt` to tell "just created" apart from
"already existed" after the fact, and that distinction is what decides
whether the audit row gets written. The outbox delivers at least once, so a
retried delivery must find the earlier grant and write nothing a second
time — proven by `tests/integration/worker-handlers.test.ts`, which rewinds
and reprocesses the same event and asserts the grant and its audit row are
still exactly one each.

## Decisions worth knowing

**Self-access goes through the same permission+scope guard as everything
else, not a bypass.** `GET /api/v1/auth/session` and `POST
/api/v1/auth/logout` check the session cookie directly, with no permission
involved, because owning a session is authentication, not authorisation.
Owning a profile is different: `practitioner.profile.read`/`.write` and the
`SELF` scope type already existed for exactly this case, and the alternative
— bypass the guard here too — would leave that grant meaningless and put the
same question back on the table for every later module where a practitioner
acts on their own record (timesheets, availability, credentials). The guard
is unconditional about `SELF`: a request for `{ type: 'SELF', id }` where
`id` is not the caller's own is refused even for a PLATFORM-scoped grant, so
every route here is scoped to `session.userId` and nothing else.

**A photo's confirmation gets its own audit row, not a borrowed one.**
Stage 4.5's audit-coverage harness matches by table across a whole test
window; an OTP's issuance and consumption lean on that coarseness
deliberately (see `docs/stage-4-5-audit-coverage.md`). A photo confirmation
can happen in an unrelated later request — the upload-url request and the
profile write that confirms it are not even guaranteed to be minutes apart —
so relying on the upload-url request's row to cover it would be fragile
rather than merely imprecise. `practitioner.photo_confirmed` names the
`storage.stored_objects` write on its own.

**`HttpError` moved to `src/lib/http/errors.ts`.** `handleGuardedRequest`
used to import `AuthError` from the auth module specifically to recognise
it. That was harmless while auth was the only caller; this module is the
first other one needing its own typed 404/409/422s, and shared platform code
should not depend on one peer module's internals to work. `AuthError` now
extends the shared `HttpError`; nothing about its public shape changed.

## Not in this stage

- **Cross-practitioner reads.** `practitioner.profile.read` is granted to
  `operations_officer` and `compliance_officer` at whatever scope they hold,
  but there is no route here that lets them use it. The guard's `SELF`
  strictness (above) means a PLATFORM grant cannot reach another user's
  profile through a `SELF`-typed request; a lookup-by-user-id route is a
  different module's decision to make, likely alongside credential review.
- **NIN, licence numbers, credential documents.** The credentials module's
  job, not built yet.
- **A "profile complete" event.** Nothing consumes one yet. Publishing it
  now would be the same mistake `processEvent` already tolerates for an
  event type with no handler — attempts and dead-lettering for having no
  audience — just self-inflicted instead of accepted.
- **Editing after credential review begins.** No review-status gate exists
  on this table yet.
- **A config lookup endpoint** for populating category/specialty/state
  choices client-side. No `config` module or routes exist at all yet.
- **Recreating a soft-deleted profile.** `deletedAt` exists for schema
  consistency; nothing sets it, so the plain unique constraint on `user_id`
  blocking recreation-after-delete is real but unreachable today.

## Verifying it locally

```
docker compose exec web pnpm test
docker compose exec web pnpm test:integration
```

Register, verify and set a password through the Stage 4.2 endpoints, then:

```
curl -X POST http://localhost:3000/api/v1/practitioners/me \
  -H 'content-type: application/json' \
  -b cookies.txt \
  -d '{"professionalCategoryId":"<a config.professional_categories id>","yearsOfExperience":5}'
```
