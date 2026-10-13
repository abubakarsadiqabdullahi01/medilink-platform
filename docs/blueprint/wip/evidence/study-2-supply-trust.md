# Study 2 — Supply-side trust (practitioners, credentials, clinical-incidents / suspension)

Repo: `/home/user/medilink-platform`, HEAD `5c199c1` ("Tooling: scripts, dependencies and configuration"), working tree clean at start.
Method: read-only code study. Nothing was run (no node_modules, no database). "CONFIRMED" below means read in the code at HEAD, not observed at runtime. Items marked **[code-read]** are consequences I derived by reading and for which no test exists.
Path convention: `file:line` is per-file. `schema` = `prisma/schema.prisma`. `seed` = `prisma/seed.ts`.

Contents: 0 Top findings · 1 practitioners · 2 credentials · 3 clinical-incidents + suspension · 4 Cross-cutting (jobs, events, seed, providers, tests) · 5 Data-model questions (level, cadre, experience, specialty) · 6 Claim verification at HEAD · 7 Gaps not in the redesign doc · 8 v2.9 spec vs code · 9 Stale docs and open questions

---

## 0. Top findings (read this first)

1. **Eligibility is one pure function** (`src/modules/practitioners/domain/eligibility.ts:52-100`) with 10 hard-block reasons. It is read live at match time (`practitioners/application/candidates.ts:65-83`) and is not re-checked at invite or confirm (the only callers of `getEligibility*` are candidates.ts, the eligibility route and the practitioner dashboard route).
2. **Nurses, pharmacists, lab scientists and radiographers are gated by identity + a regulator registration + screening only.** They have zero credential requirements (`seed:127-149`) and no regulator-specific credential types (`seed:99-107`). The one-click registration confirm exists only through the doctor-labelled type `mdcn_practising_licence` (`seed:101`; `confirm-from-submission.ts:130`).
3. **NEW (not in redesign doc): renewing an expired credential never clears `credential_expired`.** The old EXPIRED row is never removed and the rule flags any EXPIRED required type even when a newer VERIFIED row exists (`domain/eligibility.ts:89-91`; loader `application/eligibility.ts:85-88,164-170`). Every doctor whose first MDCN licence credential lapses would stay blocked after renewing. No test covers renewal. **[code-read]**
4. **NEW: credential lapse is enforced only after the daily sweep.** The eligibility loader reads `status` only, never `credential_submissions.expires_at` (`application/eligibility.ts:85-88`). Comments and docs claim the rule enforces it "from the moment the expiry passes" (`credentials/application/expiry.ts:15-21`; `docs/stage-5-8-5-9-eligibility-and-expiry.md`). That is true only for registrations (`domain/verification.ts:94-102`).
5. **Years of experience, specialty and category are self-declared and editable after approval with no re-review** (`profile.ts:235-290`; test `tests/integration/application-review.test.ts:266`). No level, cadre, grade, practising-since, competency set, supervision requirement or subspecialty exists anywhere in the schema (section 5).
6. **The sanctions list ships empty** (`seed:165-178`) and nothing in app code can write to it. Screening is therefore "CLEAR" for everyone until compliance inserts rows by SQL.
7. **Only one event in this slice has a handler** (`practitioner.registered`). `credential.submitted|verified|expired`, `sanction.applied` and `clinical_incident.reported` are published and dropped (`worker/handlers.ts:15-52`; `worker/processor.ts:79-86`). Practitioners are told of a rejection only if they open the app.
8. **Incident subject is unconstrained** when no assignment is given, and even when one is given an explicit subject overrides the assignment's practitioner (`clinical-incidents/application/incident.ts:143-150`). There is no FK on `subject_user_id`. Suspension is only reachable through closing an incident and is platform-wide (`incident.ts:261,281`; `suspension.ts:95-101`).
9. **Spec v2.9 divergences that matter most** (section 8): no facility-facing verification panel; no evidence-tier / three-claim-kinds; NIN is typed by the practitioner as free text and read from a photograph rather than checked through a provider; the confirm path reads a photographed licence, not the register; credential statuses and tables differ from spec; no auto-suspension on expiry (deliberate); opening an incident does not restrict matching; no legal hold; only facilities can report.

---

## 1. Module `practitioners`

### 1.1 Purpose and user need
- Clinician side: a Nigerian practitioner states who they are (profile), says when they can work, supplies documents, and is then checked by a Medilink officer. The product's promise to them is "you can be offered shifts as soon as it is done" (`profile/setup-wizard.tsx` ReviewStep).
- Facility side: "safe to deploy" means only practitioners with no eligibility blockers are ranked by matching (`candidates.ts:65-83`; `matching/domain/engine.ts:135` excludes `not_eligible`). Facilities are shown no verification information about the person (see 8, Module 2).

### 1.2 Actors, permissions, scopes
Permission catalogue: `src/lib/authz/permissions.ts:6-58`. Role bundles: `permissions.ts:116-122` (practitioner), `140-147` (facility_administrator), `172-183` (administrator), `219` (super_administrator = all).

| Actor (role) | Holds in this slice | Scope it is granted at |
|---|---|---|
| practitioner | `practitioner.profile.read/write`, `credential.submit`, `credential.document.read`, `availability.read/write` (+ non-slice keys) (`permissions.ts:116-122`) | SELF; granted by event handler `role-grants.ts:19-63` |
| administrator (compliance/ops merged) | `practitioner.profile.read`, `credential.review`, `credential.document.read`, `user.read`, `user.suspend`, `sanction.apply`, `incident.manage` (`permissions.ts:172-183`) | PLATFORM |
| facility_administrator / facility_owner | **none** of the practitioner/credential keys; `incident.report` only (`permissions.ts:140-147,199`) | FACILITY |
| super_administrator | all keys (`permissions.ts:219`) | PLATFORM |

Guard rules relevant here: SELF scope id must equal caller (docs/stage-5-1 "Decisions"); a reviewer cannot review their own submission (`credentials/application/submission.ts:357`; `confirm-from-submission.ts:65`; review route `credentials/[id]/review/route.ts:35-37`). No trust decision here is a step-up permission: `STEP_UP_PERMISSIONS` is only `payout.account.change` and `role.grant` (`permissions.ts:77-83`). There is no second-approver anywhere in the supply-side trust chain.

### 1.3 Entities and tables (schema, with state machines)

| Table (schema) | Model:lines | Key fields | Uniqueness / constraints |
|---|---|---|---|
| `practitioners.practitioner_profiles` | `PractitionerProfile` 466-497 | `professionalCategoryId` (req), `specialtyId?` (single), `yearsOfExperience` Int (req), `bio?`, `photoObjectKey?`, `homeStateId?`, `homeLgaId?`, `travelPreference` (SAME_LGA/SAME_STATE/ANYWHERE, 845-851), `submittedForReviewAt?` (484), `deletedAt?` (never set by code) | `user_id` unique (baseline migration:449); no index on category |
| `practitioners.identity_verifications` | `IdentityVerification` 672-691 | `ninHash` (HMAC-SHA256 keyed with `SESSION_SECRET`), `ninLast4`, `nameMatch` bool, `method` MANUAL/NIMC (693-700), `verifiedBy`, `verifiedAt`, `evidenceRetrievedAt` | `user_id` unique, `nin_hash` unique (migration:645-648); no raw-NIN column (test `identity-verification.test.ts:334`) |
| `practitioners.professional_registrations` | `ProfessionalRegistration` 706-731 | `regulator` (free `String`), `folioNumber`, `practiceType?` (free text, unused), `registrationStatus` (ACTIVE/SUSPENDED/EXPIRED/STRUCK_OFF/UNKNOWN, 733-743), `location?`, `evidenceRetrievedAt`, `expiresAt?`, `source` MANUAL/REGULATOR_API (745-750), `recordedBy` | `folio_number` **globally unique** (710; migration:651); `(user_id, regulator)` unique (726) |
| `practitioners.screening_results` | `ScreeningResult` 786-807 | `status` PENDING/CLEAR/FLAGGED (809-817; **no code ever writes PENDING**), `matchedEntryId?`, `matchedOn` name/folio, `screenedAt`, `clearedBy?`, `notes?` | `user_id` unique |
| `config.sanctioned_entries` | `SanctionedEntry` 755-775 | `sourceList` MDCN_QUACK_LIST / MDCN_SANCTIONS / INTERNAL (777-784), `fullName`, `normalisedName`, `folioNumber?`, `reason`, `listedAt`, `owner` | indexes only |
| `config.credential_requirements` | `CredentialRequirement` 827-842 | category x credential type, `isMandatory` | `(category, type)` unique |
| `config.professional_categories` | 307-323 | `key`, `name`, `regulator` (string), `isActive` | |
| `config.specialties` | 325-340 | `categoryId` (required FK), `key`, `name`, `isActive` | |
| `identity.users` | `User` 25-62 | `status` PENDING_VERIFICATION / UNDER_REVIEW / ACTIVE / SUSPENDED / DEACTIVATED (64-72), `phone` unique (28) | |

State machines (all states + allowed transitions as built):

**Application** — derived, not stored. Domain states DRAFT -> READY -> WAITING -> APPROVED (`domain/application-review.ts:51-71`); the UI adds CHANGES_NEEDED (`src/lib/ui/practitioner.ts:29,186-194`). Only persisted fact: `submittedForReviewAt`.
- DRAFT: gaps exist (no profile / no availability / a required credential type has no live submission) (`application-review.ts:40-49`).
- READY: no gaps, not submitted. WAITING: `submittedForReviewAt` set and not eligible. APPROVED: eligible (whether or not they ever pressed submit).
- Transitions: submit (`application/application-review.ts:27-96`) stamps `submittedForReviewAt` once, idempotent (65, 73-74), refused with 422 `application_incomplete` if gaps (domain errors). Rejection of a **required** credential clears it (`returnApplicationForChanges`, `application-review.ts:117-150`, called from `credentials/application/submission.ts:400-407`) -> CHANGES_NEEDED until a replacement is live and they submit again. Nothing else clears it (an expired credential, a mismatch, a category change do not).

**Credential submission** (section 2.3). **Identity**: no status; one row per user, `upsert` (`verification.ts:114-136`); `nameMatch=false` is stored and blocks. **Registration**: any status can be written over any other by an officer at any time (`verification.ts:272-307`, no transition guard); sweep moves ACTIVE -> EXPIRED once `expiresAt <= now` (`application/expiry.ts:22-35`).

**Screening**: no row -> CLEAR or FLAGGED at registration (`worker/handlers.ts:42-51`); nightly sweep re-evaluates everyone with a profile (`screening.ts:173-192`): CLEAR -> FLAGGED on a new match; FLAGGED -> CLEAR by officer note (`clearScreeningFlag`, `screening.ts:246-`, note >= 20 chars `schemas.ts:157`) or if no longer matched; an officer clearance of entry X survives re-sweeps of X but not a different entry (`screening.ts:93-98`).

**User status**: PENDING_VERIFICATION (`auth/application/registration.ts:69`) -> UNDER_REVIEW at set-password (`registration.ts:193`) -> ACTIVE by daily activation sweep when eligible (`eligibility.ts:242-268`) -> SUSPENDED by incident closure (`suspension.ts:99`) -> ACTIVE by reinstatement (`suspension.ts:174`). ACTIVE is never demoted by code when a credential lapses. DEACTIVATED is never set by any code path. `UNDER_REVIEW` and `ACTIVE` are treated identically by eligibility (`domain/eligibility.ts:60`), so the activation sweep changes a label, not behaviour.

### 1.4 The onboarding flow as implemented (step by step)

Practitioner:
1. Register by phone (auth module): user row `PENDING_VERIFICATION` (`registration.ts:69`), verify OTP, set password -> `UNDER_REVIEW` and event `practitioner.registered` (`registration.ts:193-232`). Optional consent boxes at sign-up.
2. Worker handler grants the `practitioner` role at SELF (`role-grants.ts:19-63`) then screens the name (`handlers.ts:42-51`) -> ScreeningResult CLEAR (list empty).
3. `/practitioner/profile` opens a 4-step wizard (`profile/setup-wizard.tsx`): (a) details: profession (all 5 categories), specialty (optional, filtered to category), years (number input, `min=0` only, `profile-form.tsx:169-176`), bio, home state/LGA, travel preference, photo -> `POST /api/v1/practitioners/me`; (b) availability, at least one slot; (c) documents: a checklist of what the profession requires, then a form listing **every** credential type for every profession (`credentials-section.tsx:93-103,153-163`); NIN and licence numbers are typed into a text box with a photograph required while no provider is on (`profile/evidence-fields.tsx:36-72,156-164`); (d) review and `POST /practitioners/me/submit`. For a nurse "No documents are required for your profession right now" (`setup-wizard.tsx` RequiredDocuments).
4. After submitting they can keep editing; "an officer reviews what is on file" (`profile/page.tsx:115-125`).
5. If an officer rejects a required document they see a red "your application was sent back" card with the reviewer's note (`profile/returned-notice.tsx`, overview `practitioner/page.tsx:176-178`); a "more info" request shows the note and a resupply form (`credentials-section.tsx:246-256,298-350`). No SMS/e-mail/in-app push.

Officer (administrator):
1. `/admin/practitioners` opens on "Waiting for approval", longest-waiting first (`directory.ts:78-81,111-114`; `admin/practitioners/page.tsx` QUEUES). The directory is defined as "holds practitioner role at SELF", not "has a profile" (`directory.ts:73`). Shows name and phone (`directory.ts:119-120,145-146`).
2. Open the person -> "Submitted by the practitioner" (`admin/practitioners/evidence-review.tsx`): the photograph loads only on click (access logged as `credential.document_accessed`, `submission.ts:669-676`).
   - **Identity card**: officer reads NIN slip photo, picks "Matches / Does not match" (no default here, `evidence-review.tsx:278`) -> `POST /practitioners/verification/confirm {kind:'identity'}` -> `confirmIdentityFromSubmission` (`confirm-from-submission.ts:73-120`): records identity (hash + last4, MANUAL), then `reviewCredential` approve -> VERIFIED and masks the stored number (`:112-118`); on mismatch records `nameMatch=false`, sets the submission MORE_INFO_REQUESTED with a canned note, does **not** mask (`:96-109`).
   - **Registration card**: officer reads licence photo, picks status (ACTIVE/SUSPENDED/EXPIRED/STRUCK_OFF) and optionally the printed expiry date (`evidence-review.tsx:475-500`) -> `confirmRegistrationFromSubmission` (`confirm-from-submission.ts:122-175`): regulator is taken from the practitioner's category (`:146`), folio = the submitted licence number, status as chosen; if not ACTIVE the submission is REJECTED with a canned reason and the application is returned (`:157-165`).
   - Both writes are **three separate commits** (record, review, mask) (`verification.ts:114`, `submission.ts:365,560`), retry-safe but not atomic.
3. Document-reviewed credentials (MBBS, NYSC, good standing, indemnity): approve / reject / request more in one click from the credentials tab or `/admin/credentials`; reject and request_info require a note (`credentials/presentation/schemas.ts:76-87`). A plain approve of a NIN/licence type is refused with `confirm_through_practitioner` (`credentials/[id]/review/route.ts:30-39`).
4. Sanctions card: shows the matched entry and clears with a >= 20 char reason (`admin/practitioners/standing-panel.tsx:75-182`). Suspension card: reinstate with a >= 20 char reason (`:184-267`).
5. "Record by hand" (no submission): free-text regulator input (uppercased in the UI only, `page.tsx:571`), folio, status (**defaults pre-selected to "matches" `useState('true')` at `page.tsx:196` and status `'ACTIVE'` at `page.tsx:200`**), optional expiry. Server accepts `regulator` as any 2-20 char string (`presentation/schemas.ts:97`).

What becomes "eligible": every blocker in 1.7 empty. This is computed live; the practitioner sees "Can be offered shifts" at once (`lib/ui/practitioner.ts:186`). The daily activation sweep later flips `users.status` UNDER_REVIEW -> ACTIVE (`jobs.ts:51-54`).

### 1.5 API routes (practitioners)
Route table: `src/modules/practitioners/routes.ts`. Handlers in `src/app/api/v1/practitioners/**`.

| Method + path | Permission | Scope | Notes |
|---|---|---|---|
| GET `/practitioners` | `practitioner.profile.read` | PLATFORM only | officer directory; filters `application=waiting|draft`, search, userId, cursor (`route.ts:14-20`) |
| GET/POST/PATCH `/practitioners/me` | read/write | SELF | POST 409 if exists; PATCH never upserts |
| POST `/practitioners/me/photo-upload-url`, `/photo-url` | write / read | SELF | photo readable by self only (`profile.ts:354-374`) |
| POST `/practitioners/me/submit` | `practitioner.profile.write` | SELF | route composes availability (`me/submit/route.ts`) |
| GET `/practitioners/verification` | `practitioner.profile.read` | SELF or PLATFORM | returns last4, never the NIN |
| POST `/practitioners/verification/identity` | `credential.review` | PLATFORM | manual form; NIN must be 11 digits (`schemas.ts:75-91`) |
| POST `/practitioners/verification/registration` | `credential.review` | PLATFORM | manual form |
| POST `/practitioners/verification/confirm` | `credential.review` | PLATFORM | discriminated union identity / registration |
| GET/POST `/practitioners/screening` | `credential.review` | PLATFORM | read match / clear flag |
| GET `/practitioners/eligibility` | `practitioner.profile.read` | SELF or PLATFORM | read-only; never activates |
| GET `/users/find` | `user.read` | PLATFORM | listed here for the officer workflow |
| GET `/api/v1/reference` | session only | none | categories, specialties, credentialTypes + `requiredForCategoryIds`, states, LGAs, `verification` switches (`config/reference.ts:47-101`); does not filter `isActive` |

No route can edit another practitioner's profile; there is no sweep trigger route.

### 1.6 Sweeps and schedules (all in `src/worker/jobs.ts`, run by the worker process)
All four are DAILY (`jobs.ts:29`); next run = now + interval, missed windows skipped (`scheduler.ts:25-50`); the table is checked every 30 s (`polling.ts` `JOB_CHECK_MS`); `enabled` is an operator switch (schema 633-654).

| Job key (`jobs.ts`) | Function | Effect |
|---|---|---|
| `screening.sweep` (33-37) | `screenAllPractitioners` `screening.ts:173-192` | re-screens every practitioner **with a profile**; sequential; no paging |
| `credential.expiry_sweep` (39-43) | `expireCredentials` `credentials/application/expiry.ts:27-70` | VERIFIED with `expiresAt <= now` -> EXPIRED, audit + `credential.expired` event; **does not suspend** (comment `expiry.ts:15-21`) |
| `registration.expiry_sweep` (45-49) | `expireRegistrations` `practitioners/application/expiry.ts` | ACTIVE with `expiresAt <= now` -> EXPIRED + audit; no event |
| `practitioner.activation_sweep` (51-55) | `activateEligiblePractitioners` `eligibility.ts:286-302` | UNDER_REVIEW -> ACTIVE when eligible; conditional update, one audit row |

Not scheduled: expiry warnings (30/7 days), evidence-stale re-check reminders, renewal prompts, re-screening on folio recording. Registration of a folio does not trigger a screen (`verification.ts` imports no screening) so a listed folio is first checked at the next nightly sweep **[code-read]**.

### 1.7 The exact eligibility rule (every hard block)
`eligibilityBlockers(input, now)` returns **all** reasons (not the first): `src/modules/practitioners/domain/eligibility.ts:52-100`; eligible = zero blockers (`:103-105`). Blocker type list `:15-25`.

| # | Blocker | Condition | file:line | Practitioner-facing wording |
|---|---|---|---|---|
| 1 | `account_not_usable` | `users.status` not ACTIVE and not UNDER_REVIEW (so PENDING_VERIFICATION, SUSPENDED, DEACTIVATED) | `domain/eligibility.ts:60-62` | `lib/ui/practitioner.ts:274` |
| 2 | `profile_incomplete` | no (non-deleted) profile row | `:64` | `:241` |
| 3 | `identity_unverified` | no identity_verifications row | `:66-67` | `:256` |
| 4 | `identity_name_mismatch` | identity row has `nameMatch=false` | `:68-71` | `:259` |
| 5 | `registration_missing` | no registration row whose `regulator` string equals the category's `regulator` string exactly (`application/eligibility.ts:111,120-121,149-153`) | `:74-75` | `:262` |
| 6 | `registration_not_active` | `isRegistrationUsable` false: deleted, status != ACTIVE (UNKNOWN counts as not active), or `expiresAt <= now` | `:77`; `domain/verification.ts:94-102` | `:265` |
| 7 | `registration_evidence_stale` | `evidenceRetrievedAt` missing or >= 365 days old (`DEFAULT_REGISTRATION_REVIEW_DAYS`, `:43`; passed at `application/eligibility.ts:180`; `domain/verification.ts:69-77` inclusive) | `:78-84` | `:268` |
| 8 | `credential_expired` | any required type id appears among the user's EXPIRED submissions (**regardless of a newer VERIFIED row**) | `:89-91` | `:251` |
| 9 | `credential_missing` | any required type id not among VERIFIED submissions | `:92-94` | `:246` |
| 10 | `screening_not_clear` | screening row absent or status != CLEAR | `:97-98`; `domain/screening.ts:112-113` | `:271` |

Inputs are assembled in a fixed number of queries in `application/eligibility.ts:48-188`. Required credentials come from `credential_requirements` where `isMandatory`, by category (`:103-108,162`); the legacy `CredentialType.isMandatory` column (schema 347) is no longer read by any code. Credential rows considered: `status IN (VERIFIED, EXPIRED)`, `deletedAt null` (`:85-88`) — **`expires_at` is not selected**. A deleted account is reported as `['account_not_usable']` (`:207-210`). Property test over 5000 random inputs: `domain/eligibility.test.ts:239`.
Not in the rule: consent/visibility withdrawal (applied separately in `candidates.ts:71-75`), availability, indemnity, level, scope of practice, incident history, facility-specific restrictions.

### 1.8 What `practitioners` exposes to other modules
- `listMatchCandidates` (`candidates.ts:211`-): `userId, professionalCategoryId, specialtyId, yearsOfExperience, homeStateId, homeLgaId, travelPreference, eligible` — **no name, no phone** (`candidates.ts:17-24,76-84`). Consent-withdrawn practitioners are dropped entirely (`:71-75`).
- `getEligibility`, `getEligibilityFor` (to the dashboard route and candidates).
- `returnApplicationForChanges` is imported *by credentials* and `getSubmissionForVerification`/`reviewCredential` are imported *by practitioners* — a two-way import between the two modules (`credentials/application/submission.ts:2`; `confirm-from-submission.ts:2-10`).
- PLATFORM-only name + phone: directory (`directory.ts:119-120`), credential queue (`submission.ts:311-318`), incident detail subject (`api/v1/incidents/[id]/route.ts:33-39`). The leak to facilities is **added in matching**, not here (`matching/application/match.ts:161-179`, select at `:163`).

### 1.9 Tests (this module)
Unit: `domain/eligibility.test.ts` (18 cases + 5000-profile property), `verification.test.ts` (19), `screening.test.ts` (17), `application-review.test.ts` (10), `profile.test.ts` (4). Integration (need Postgres; not run): `eligibility.test.ts` (14), `identity-verification.test.ts` (20), `application-review.test.ts` (19), `confirm-from-submission.test.ts` (16), `practitioner-profile.test.ts` (16), `screening.test.ts` (14), `worker-handlers.test.ts` (1), `scheduler.test.ts` (11, shared). E2E: `tests/e2e/onboarding.spec.ts` (12). Counts are line-start `it(/test(` greps.
Not covered by any test I found: renewal after expiry; credential lapse before the sweep; regulator typed in a different case; folio collision across regulators; category change after approval; same NIN claimed by a mismatched record; screening-by-folio before the nightly sweep.

---

## 2. Module `credentials`

### 2.1 Purpose and user need
A practitioner submits documentary or numeric evidence per credential type; an officer decides. It exists so a clinician can prove licence/qualification/identity, and so a facility is only ever shown people whose required evidence an officer has seen.

### 2.2 Actors and permissions
`credential.submit` (practitioner, SELF), `credential.document.read` (practitioner SELF for own list/documents; administrator PLATFORM), `credential.review` (administrator PLATFORM only). `src/modules/credentials/permissions.ts`; routes `routes.ts`. Document downloads create a `credential.document_accessed` security event (`submission.ts:669-676`). Not-owner access is 404, not 403 (`submission.ts:643-649`).

### 2.3 Entity and state machine
`credentials.credential_submissions` (`CredentialSubmission`, schema 505-537): `credentialTypeId`, `status`, `referenceNumber?`, `documentObjectKey?`, `reviewedBy?`, `reviewedAt?`, `reviewNotes?`, `expiresAt?`, `deletedAt?` (never set by code). Index only on `(user_id, credential_type_id)` and `status` — **no unique "one live submission per type"** (comment `submission.ts:181-186`; concurrent double-submit can race).
`config.credential_types` (schema 342-359): `key, name, issuer, isMandatory (dead), expires, reviewDays, verificationMethod` (`mdcn_status_check`, `nimc_verification`, anything else = `document_review`, `domain/submission.ts:4-23`).

States (schema 539-553) and transitions as built:

| From | Action | To | Where |
|---|---|---|---|
| (none) | practitioner submits | PENDING | `submission.ts:165-241` (blocked if a PENDING / MORE_INFO_REQUESTED / VERIFIED row exists for the type, 409 `duplicate_active_submission`, `:187-198`) |
| PENDING | officer approve | VERIFIED (`expiresAt = review date + reviewDays` if type `expires`, `:363`; `computeExpiresAt` `domain/submission.ts:50-58`); emits `credential.verified` (`:411-422`) | `reviewCredential` `:349-426` |
| PENDING | officer reject (note required) | REJECTED; for a *required* type also clears `submittedForReviewAt` (`:400-407`); **no event** (`:409-410`) | same |
| PENDING | officer request_info (note required) | MORE_INFO_REQUESTED; no event | same |
| MORE_INFO_REQUESTED | practitioner resupply (only from here) | PENDING; `reviewedBy/At/Notes` cleared | `resupplyCredential` `:449-506` |
| VERIFIED | daily sweep when `expiresAt <= now` | EXPIRED; emits `credential.expired` | `credentials/application/expiry.ts:27-70` |
| REJECTED, EXPIRED | — terminal; a **new** row may be submitted | | active set excludes both (`:194`) |
There is **no revoke**: only PENDING can be decided (`:358`), so a VERIFIED row can never be un-verified, withdrawn, superseded (no link) or deleted. Self-review refused (`:357`).

### 2.4 Evidence rules
- `reference_number` types (NIN, MDCN licence) need a number (`domain/submission.ts:16-18`); the UI additionally requires a photograph while no provider is on (`evidence-fields.tsx:50,68`), but the **API only requires "number or document"** (`presentation/schemas.ts:18-28`).
- Everything else requires a document; allowed: pdf, jpeg, png, webp, heic, <= 10 MB (`lib/storage/tigris.ts:61-69`); bytes go direct to Tigris by signed URL; ownership confirmed with a HEAD (`submission.ts:120-135`). No malware scan, no compression, no retention rule.
- NIN handling: audit rows carry only the masked number (`submission.ts:79-82`); after a successful identity confirmation the stored `reference_number` is overwritten with a mask (`:548-576`, called only on the CONFIRMED path `confirm-from-submission.ts:118`). A NIN left in a submission that is rejected, queried or never confirmed stays in clear in `credential_submissions.reference_number` **[code-read]**.

### 2.5 API routes
`POST /credentials` (submit), `GET /credentials` (SELF own / PLATFORM queue with search by name or phone, returns `practitionerName`, `practitionerPhone`, signed photo URL, `submission.ts:259-326`), `POST /credentials/document-upload-url`, `PATCH /credentials/:id` (resupply), `POST /credentials/:id/review`, `POST /credentials/:id/document-url`. Sweep: `credential.expiry_sweep` (daily).

### 2.6 Events
Published: `credential.submitted` (`submission.ts:228-237`), `credential.verified` (`:411`), `credential.expired` (`expiry.ts:55`). Handlers for all three: **none**. Not published: rejection, info request, resupply, identity/registration recorded, reference masked.

### 2.7 Tests
`domain/submission.test.ts` (10), `tests/integration/credential-verification.test.ts` (28), `confirm-from-submission.test.ts` (16), `expiry.test.ts` (5: credential expire, leave unexpired, ignore REJECTED, registration expire, leave SUSPENDED). No test of a renewal after EXPIRED.

---

## 3. Module `clinical-incidents` (practitioner-suspension side)

### 3.1 Purpose and user need
Facilities report patient-safety events; compliance decides; a suspension takes a practitioner out of matching and out of the app. Governing principle "a report is not an accusation" (`domain/incident.ts:1-10`; `docs/stage-5-clinical-incidents.md`).

### 3.2 Actors and permissions
- `incident.report` at FACILITY: facility_administrator, facility_owner (`permissions.ts:140-147,199`). **Practitioners do not hold it** (`:116-122`); administrator holds `incident.manage` but not `incident.report` (`:172-183`), so only super_administrator could also file.
- `incident.manage` at PLATFORM: administrator, super_administrator. Suspension is authorised by `incident.manage`; `user.suspend` is deliberately not used (`clinical-incidents/permissions.ts` comment). Routes: `routes.ts` (POST/GET `/incidents` FACILITY; GET `/incidents/queue`, GET `/incidents/:id`, POST `/incidents/:id/review`, POST `/incidents/:id/close`, POST `/users/:id/reinstate`, GET `/users/:id/suspensions` PLATFORM). No PATCH/DELETE (asserted `tests/integration/incidents.test.ts:666`). **No route suspends an account directly.**

### 3.2b Entities
`clinical_incidents.clinical_incidents` (schema 1559-1604): `facilityId` (FK), `assignmentId?` (FK, SET NULL), `subjectUserId?` (**no relation / no FK** in migration baseline:1390-1393), `reportedBy` (no FK), `occurredAt`, `severity` NEAR_MISS..DEATH (1606-1616), `category` (1618-1629), `summary` text, `status`, `outcome?` (1639-1650), `closedBy/At`, `closureNotes`. `incident_attachments` (1654-1669): **nothing writes it** (docs: "Not in this module"). `account_suspensions` (1677-1702): `userId, reason, suspendedBy, suspendedAt, incidentId?, liftedBy/At/Reason` — no type (pending-investigation vs sanction), no scope (facility vs platform), no end date, no notice/appeal fields.

### 3.3 State machines
- Incident: REPORTED -> UNDER_REVIEW (`beginIncidentReview`, `incident.ts:194-225`, idempotent) -> CLOSED (`closeIncident`, `:248-304`). REPORTED -> CLOSED directly is allowed except SEVERE/DEATH (`domain/incident.ts:110-125`: blockers `already_closed`, `outcome_missing`, `notes_missing` (< 20 chars), `not_reviewed`). CLOSED is terminal; nothing is editable.
- Closing with outcome `PRACTITIONER_SUSPENDED` suspends in the same transaction (`incident.ts:280-288`; requires a subject, `:261`).
- Suspension: user -> SUSPENDED + open `account_suspensions` row (`suspension.ts:80-125`, reason >= 20 chars, 88); reinstate closes the row and sets the user **to ACTIVE regardless of prior status** (`:148-190`, update at 174). Lifting needs a reason >= 20 chars.
- A suspended user's session is refused immediately (`auth/application/session-service.ts:92`) and login returns the generic "This account cannot sign in. Contact support." (`auth/domain/errors.ts:51-52`; `login.ts:81-84`); password reset is also refused (`recovery.ts`). They cannot see the reason, upload anything or file an appeal.

### 3.4 Flow as implemented
1. Facility staff open the report dialog: pick one of the facility's recent shifts or "Not about a particular shift or person" (`facility/incidents/report-incident-dialog.tsx:190-207`); summary >= 20 chars; no guidance about patient identifiers.
2. `POST /incidents`: summary >= 20 chars, occurredAt not in future (`domain/incident.ts:81-`); if `assignmentId` is given it must be the facility's (`incident.ts:147`) and the practitioner is taken from it **unless the request also names a subject, which wins** (`:143,149`); with no assignment any UUID is accepted as `subjectUserId` (`schemas.ts:16`). Facility verification status is not checked. Emits `clinical_incident.reported` (`:176-187`; no handler).
3. Compliance queue ordered most serious first (`incident.ts:367-408`); case view shows the subject's name, phone, status and every other report naming them (`api/v1/incidents/[id]/route.ts:27-50`).
4. Officer takes it (REPORTED -> UNDER_REVIEW), then closes with an outcome from SYSTEM_ISSUE, NO_ACTION, ADVICE_GIVEN, TRAINING_REQUIRED, PRACTITIONER_SUSPENDED, REFERRED_TO_REGULATOR (the last records a decision only; no regulator, reference or date).
5. Facility can read back its own reports **including outcome, closure notes and subject id** (`incident.ts:87-105`; `facility/incidents/incident-detail-dialog.tsx:68-79`).
6. Opening an incident has no effect on matching; nothing outside the module reads incidents or suspensions (grep: only the incident/user routes import the module).

### 3.5 Events and sweeps
Emits `clinical_incident.reported` only; no handler; no event for review start, closure, suspension or reinstatement. No sweep, no deadline, no SLA clock.

### 3.6 Tests
`domain/incident.test.ts` (16), `tests/integration/incidents.test.ts` (23: report-from-shift, no-shift/no-subject, event + audit, wrong facility, future date, queue scoping and ordering, closing rules, suspend-in-same-transaction, ineligible after suspension, reinstate, history, route table). **No test that an arbitrary `subjectUserId` is refused** (it is accepted).

---

## 4. Cross-cutting

### 4.1 Events in this slice and handlers

| Event | Emitted by | Handler? |
|---|---|---|
| `practitioner.registered` | `auth/application/registration.ts` (~230) | **Yes** — role grant + first screening (`worker/handlers.ts:42-51`). Comment says "send the welcome message" but only logs (`:43-45`) |
| `credential.submitted` | `submission.ts:228` | No |
| `credential.verified` | `submission.ts:411` | No |
| `credential.expired` | `credentials/application/expiry.ts:55` | No |
| `sanction.applied` | `screening.ts:139-146` on FLAGGED | No |
| `clinical_incident.reported` | `incident.ts:176` | No |
Unhandled events are marked PROCESSED silently (`worker/processor.ts:77-86`). Only other handlers in the codebase: `assignment.confirmed` (SMS) and `shift.completed` (timesheet). The only `notify()` callers are in `notifications/application/handlers.ts:61,73`.

### 4.2 What is actually seeded (production seed `prisma/seed.ts`)
- **Categories (5)** (`seed:36-42`): `doctor` MDCN, `nurse` "Nurse / Midwife" NMCN, `pharmacist` PCN, `lab_scientist` "Medical Laboratory Scientist" MLSCN, `radiographer` RRBN. Not seeded: dentist, physiotherapist, community health practitioner, optometrist, medical records (spec lists dentists, physiotherapists, CHPs).
- **Specialties (15)** (`seed:67-80`): doctor x12: general_practice, internal_medicine, paediatrics, obstetrics_gynaecology, general_surgery, anaesthesia, emergency_medicine, family_medicine, radiology, pathology, psychiatry, ophthalmology; nurse x3: general_nursing, perioperative_nursing, midwifery. None for pharmacist, lab scientist, radiographer. No subspecialties.
- **Credential types (6)** (`seed:99-107`): `mdcn_practising_licence` (issuer MDCN, expires, 365 d, `mdcn_status_check`), `nin_slip` (NIMC, no expiry, `nimc_verification`), `mbbs_certificate` (document_review, no expiry), `nysc_certificate` (optional), `good_standing` (MDCN, expires 365 d), `indemnity_cover` (insurer, expires 365 d). No NMCN, PCN, MLSCN or RRBN type; no nursing/pharmacy/lab/radiography qualification type; no fellowship/postgraduate type.
- **Credential requirements (3)** (`seed:127-149`): doctor x {mdcn_practising_licence, nin_slip, mbbs_certificate}. Nothing for the other four. `nysc_certificate`, `good_standing`, `indemnity_cover` are optional for everyone.
- **Regulators modelled**: only as strings on `ProfessionalCategory.regulator` (`MDCN, NMCN, PCN, MLSCN, RRBN`), `FacilityType.regulator` (`FMoH, State MoH, NPHCDA, MLSCN`, `seed:196-202`) and `CredentialType.issuer`. There is no regulator table, no per-regulator verification adapter and no validation of `ProfessionalRegistration.regulator` against anything.
- **Sanctioned entries**: `entries = []` (`seed:165-178`). Demo script `scripts/seed-demo.ts:520-540,1776` inserts two fictional rows; the demo (not the seed) also records registrations for all five professions by hand, e.g. nurse folio `RN/...` (`seed-demo.ts:949-962`).
- Rate floors only for doctor and nurse (`seed:273-299`); scheduled jobs from `JOB_DEFINITIONS` (`seed:180-192`).

### 4.3 Stubbed vs live
| Capability | Status | Evidence |
|---|---|---|
| NIN check through NIMC | **Stub, off by default.** `NIN_VERIFICATION_PROVIDER` `none` (`lib/env.ts:52`); with `sandbox` or `live` the adapter is `unimplemented` and throws `VerificationNotConfiguredError` (`lib/verification/index.ts:99-133`). No sandbox adapter exists (docs/verification-providers.md:88-92) |
| Regulator register check | **Stub.** One env var `MDCN_VERIFICATION_PROVIDER` serves every regulator (`index.ts:139-149`); same throw. No NMCN/PCN/MLSCN/RRBN path |
| Manual officer verification | **Live and the only real path.** Officer reads a photograph and states a result; `source`/`method` = MANUAL |
| NIN storage | Live: keyed HMAC + last4 (`domain/verification.ts:36-45`) |
| BVN | Not modelled anywhere (only a key in the audit redaction list, `lib/audit.ts:33`) |
| Sanctions / quack list data | Mechanism live; **data empty**; no write route, no feed (`docs/stage-5-6-screening.md` "Not in this stage") |
| Document storage | Live design (Tigris signed URLs); no malware scan |
| SMS/notifications | Console adapter only; only one handler exists (outside slice) |
| Account-recovery by officer, bank-account reuse check, DOB/selfie cross-match | Not present |

### 4.4 Docs in the slice
`docs/stage-5-1-practitioner-profiles.md`, `stage-5-2-credential-verification.md` (incl. 5.7), `stage-5-3-5-4-5-5-identity-and-registration.md`, `stage-5-6-screening.md`, `stage-5-8-5-9-eligibility-and-expiry.md`, `stage-5-clinical-incidents.md`, `verification-providers.md`, `scheduled-jobs.md`. Several statements are stale or wrong (section 9).

---

## 5. Data-model questions answered

| Concept | Exists? | Evidence |
|---|---|---|
| **Level** (house officer / consultant / senior) | **No.** Not on profile, request, rate floor, credential, or engine | schema 466-497, 926, 421-435; grep of schema for level/cadre/grade/seniority returns nothing relevant |
| **Cadre** | **No** | same |
| **Grade** | **No** | same |
| **Registration category** (provisional vs full, intern, etc.) | **No structured field.** Only `ProfessionalRegistration.practiceType`, a free-text 100-char string, settable only through the API (the admin form does not send it, `page.tsx` registration form), never read by the eligibility rule, matching or any screen (`schemas.ts:102`; `verification.ts:248`) | schema 711 |
| **Supervision requirement** | **No.** (The only "supervisor" in the schema is a check-in method, schema 1260-1261) | |
| **Competency / skill set / procedures** | **No.** Only one optional `specialtyId` | schema 470 |
| **Practising-since / registration date / graduation year / issue date** | **No.** Only `yearsOfExperience`; credentials have `expiresAt` but no issue date; registrations have `evidenceRetrievedAt` and optional `expiresAt` | schema 471, 525, 714-715 |
| **Fields for experience** | `yearsOfExperience Int` required, validated 0-60 (`domain/profile.ts:7-8`; `presentation/schemas.ts:19-23`; UI `<input type=number min=0>` with no max `profile-form.tsx:169-176`), self-declared and never evidenced; `bio` free text <= 1000 (`profile.ts` BIO_MAX_LENGTH `domain/profile.ts:9`). No employment history, no qualifications table, no per-post dates. The match score uses `min(years, 10)/10` for 30 of 100 points (`matching/domain/engine.ts:46,174-175`) | |
| **Specialty single or multi** | **Single, optional** `specialtyId` on the profile (schema 470); must belong to the profile's category (`domain/profile.ts:16-21`; `profile.ts:65-88`). A request with a specialty hard-excludes anyone whose single specialty differs **including people with none** (`matching/domain/engine.ts:143-146`). Specialties exist only for doctor (12) and nurse (3) | |
| **Subspecialty** | No | |
| **Languages, qualifications, employment history, indemnity fields, procedures** | No (only a document-type `indemnity_cover` and `mbbs_certificate`) | `seed:103,106` |
| **Preferences** | `travelPreference` (3 tiers) and home state/LGA only; no shift-type or rate expectation (`schema` 474-479; availability slots carry no rate/shift type, 863-899) | |

---

## 6. Verification of the redesign claims at HEAD

Status key: CONFIRMED / ALREADY FIXED / NOT FOUND / PARTLY.

| # | Claim | Status | Evidence and nuance |
|---|---|---|---|
| 1 | Matching / practitioner reads leak name + phone | **CONFIRMED (in matching, not practitioners)** | `matching/application/match.ts:161-179` selects `fullName, phone` and returns `practitionerName/practitionerPhone` for ranked and excluded candidates (`:38-44,172-178`). The practitioners module's own candidate function does not carry them (`candidates.ts:17-24`). Practitioners exposes name+phone only to PLATFORM readers: directory `directory.ts:119-120,145-146`, credential queue `submission.ts:311-318`, incident subject `incidents/[id]/route.ts:219-225` |
| 2 | No level in the data | **CONFIRMED** | section 5 |
| 3 | Years of experience self-declared and capped at 10 | **PARTLY** | Self-declared: confirmed, no evidence field (`profile-form.tsx:169-176`). Stored range is 0-60 (`domain/profile.ts:7-8`); the **cap of 10 exists only in the match score** (`engine.ts:46,174`) |
| 4 | Folio number unique across all regulators | **CONFIRMED** | `schema:710` `@unique` plus `@@unique([userId, regulator])` 726; `migration:651,660`; error `duplicate_folio_number` `verification.ts:311-314` |
| 5 | Regulator is free text on the manual record | **CONFIRMED** for the manual form/API | `presentation/schemas.ts:97` (2-20 chars, no enum, no category check); UI uppercases only (`page.tsx:571`); lookup is exact string equality with the category's regulator (`application/eligibility.ts:120-121,152`), so a typo/other case yields `registration_missing`. The **confirm** path avoids it by taking the regulator from the category (`confirm-from-submission.ts:146`) |
| 6 | Edits after approval need no re-review | **CONFIRMED** (with a side effect) | `profile.ts:235-290` updates category/specialty/years/bio/location/photo with no reset of `submittedForReviewAt`; test `application-review.test.ts:266`. Changing *category* incidentally makes the practitioner ineligible (new regulator has no registration; new category's required credentials missing) because the rule is live; specialty, years, bio, home area, travel changes have no effect on verification |
| 7 | Credential requirements seeded for doctors only | **CONFIRMED** | `seed:127-149` (3 rows, doctor) |
| 8 | No NMCN/PCN/MLSCN/RRBN credential types | **CONFIRMED** | `seed:99-107`. Workaround that exists: confirm derives the regulator from category, so a nurse can submit the doctor-labelled MDCN licence type and have it recorded against NMCN (`confirm-from-submission.ts:130,146`; the credential form offers all types to all professions, `credentials-section.tsx:93-103`), or an officer uses the by-hand form |
| 9 | Licence expiry = verification date + 365 days, not printed expiry | **PARTLY** | Credential row: confirmed (`submission.ts:363`; `domain/submission.ts:50-58`; seed `reviewDays 365` `seed:101`); that date is what the practitioner is shown (`credentials-section.tsx:229`). But the officer **can** record the printed date on the registration record (optional field `evidence-review.tsx:489-500` -> `confirm-from-submission.ts:122-175` -> `registration.expiresAt`), and eligibility enforces that live (`domain/verification.ts:100`). If left blank the only limit is evidence age 365 d from the confirm date (`domain/eligibility.ts:78-84`). So there are two inconsistent expiry clocks |
| 10 | Verified credential blocks resubmission so renewal cannot be pre-sent | **CONFIRMED** | `submission.ts:187-198` (VERIFIED in the active set); the UI greys the type out (`credentials-section.tsx:88-92,156`). After the sweep marks EXPIRED a new submission is allowed (`:194`), but see gap G1 |
| 11 | No expiry reminders | **CONFIRMED** | no job, no handler for `credential.expired`; only 4 sweeps, none warn (`jobs.ts:31-56`); `notify` has one caller kind (`notifications/application/handlers.ts:61,73`) |
| 12 | Practitioners not told of rejection | **PARTLY** | In-app only: rejected required doc -> "application was sent back" card with reviewer's note (`returned-notice.tsx`; `practitioner/page.tsx:176-178`); any note shows on the credentials tab (`credentials-section.tsx:235-244`). No SMS/e-mail and no event for reject/info-request (`submission.ts:409-410`). They learn only when they open the app |
| 13 | Sanctions list seeded empty so screening is vacuously clear | **CONFIRMED** | `seed:165-178`; no app write path (grep: only seed, demo script, test fixture); screening writes CLEAR for everyone (`screening.ts:98`) |
| 14 | Incident can name any practitioner when no shift attached | **CONFIRMED (and worse)** | `incident.ts:143-150`, schema `schemas.ts:16`; no FK (`migration:1390-1393`); explicit subject overrides the assignment's practitioner (`:149`); subject need not be a practitioner (suspension has no role check, `suspension.ts:95-101`); facility need not be VERIFIED. The UI itself offers only shifts (`report-incident-dialog.tsx:190-207`), so the hole is API-level. Closing as suspended still needs a compliance decision (`incident.ts:248-304`) |
| 15 | Suspension has no notice / hearing / appeal | **CONFIRMED** | no notice event or message in `suspension.ts` (no `publishEvent`/`notify`); no appeal field or route (`routes.ts`); user is locked out with a generic message (`errors.ts:51-52`, `session-service.ts:92`); no facility-specific or pending-review suspension type (`schema` 1677-1702) |

---

## 7. Gaps found that `docs/redesign-recommendations-2026-10-13.md` did not mention

| ID | Gap | Evidence | Severity (my view) |
|---|---|---|---|
| G1 | **Renewal never clears `credential_expired`**: EXPIRED rows persist and the rule ignores a newer VERIFIED row | `domain/eligibility.ts:89-91`; `application/eligibility.ts:85-88,164-170`; no code deletes/soft-deletes submissions (`deletedAt` never set); no test | High **[code-read]** |
| G2 | **Credential lapse is enforced only by the daily sweep** (loader never reads `expires_at`), contradicting comments/docs; registrations are live | `application/eligibility.ts:85-88`; claim at `credentials/application/expiry.ts:15-21` | Medium |
| G3 | **Two expiry clocks** (credential row = verification + 365 d, shown to practitioner; registration = printed date, optional): the redesign proposes "capture the printed expiry" but the officer field already exists on the registration record | `evidence-review.tsx:489-500`; `credentials-section.tsx:229` | Medium |
| G4 | **Confirm-from-submission is three commits**, described in docs as "in one act" | `verification.ts:114`; `submission.ts:365,560`; `confirm-from-submission.ts:83-118` | Low (retry-safe) |
| G5 | **A name-mismatch record still reserves the NIN hash** (unique `nin_hash`), so a later confirmation of the real owner would hit `duplicate_nin` with no release path **[code-read]** | `verification.ts:110-136,153-159`; schema 675 | Medium |
| G6 | **Raw NIN stays in clear in `credential_submissions.reference_number`** for any submission not confirmed (rejected, queried, mismatch) — masking is only on the CONFIRMED path | `confirm-from-submission.ts:96-118`; `submission.ts:548-576` | Medium |
| G7 | **NIN HMAC key is `SESSION_SECRET`** with no key id/version; rotating it silently breaks duplicate-NIN detection for existing rows | `verification.ts:110`; schema comment 663-671 | Medium |
| G8 | **Screening by folio waits for the nightly sweep**: recording a registration does not call screening | `verification.ts` (no import of screening); `screening.ts:173-192` | Medium |
| G9 | **Sanctioned-entry folios are compared raw**; only the practitioner side is normalised, and there is no write path that normalises the entry | `domain/screening.ts:81-87`; seed/demo/fixture each build rows themselves | Low |
| G10 | **No revoke / withdraw / supersede** for a VERIFIED credential; no way to un-verify a forged certificate other than editing the registration status or suspending the user | `submission.ts:358` | Medium |
| G11 | **No four-eyes or step-up on any trust decision** (identity confirm, registration confirm, clearing a sanctions flag, reinstatement) — only a self-review ban | `permissions.ts:77-83`; `submission.ts:357` | Medium |
| G12 | **Manual "Record by hand" form pre-selects "name matches" and "ACTIVE"**, against the stated no-default principle | `admin/practitioners/page.tsx:196,200` vs `errors.ts` nameMatchRequired comment | Low |
| G13 | **The confirm path reads a photographed licence, not the register**; the form label is "What the licence shows" and the register-lookup language appears only on the by-hand form | `evidence-review.tsx:80,475`; `page.tsx:587` | Medium (design) |
| G14 | **The licence "number" is stored as `folioNumber` and used for uniqueness and sanctions matching**; whether the annual licence number equals the register folio is not established in code **[Unverified]** | `evidence-fields.tsx` (label "number on your annual practising licence"); `confirm-from-submission.ts:146-150` | Open question |
| G15 | **Credential form lists every credential type to every profession**, so a nurse is offered "MDCN Annual Practising Licence" | `credentials-section.tsx:93-103,153-163` | Medium |
| G16 | **Practitioners stay "Waiting for approval" when their own credential has expired or after category change**, because only a rejection clears `submittedForReviewAt`; officers see them in the "waiting" queue | `lib/ui/practitioner.ts:186-194`; `application-review.ts:117-150`; `directory.ts:78-81` | Low |
| G17 | **Incident explicit subject overrides the assignment's practitioner**; `subject_user_id` and `reported_by` have no FK; facility verification not required to report | `incident.ts:143,149`; `migration:1390-1396` | High (extends redesign #4) |
| G18 | **Closure outcome and notes, plus the subject id, are returned to the reporting facility** (e.g. "Suspend the practitioner" and the officer's reasoning) | `incident.ts:87-105`; `facility/incidents/incident-detail-dialog.tsx:68-79` | Medium (privacy) |
| G19 | **No guidance or redaction against patient identifiers** in the free-text incident summary (<= 4000 chars); attachment table exists, unused | `domain/incident.ts:51`; `report-incident-dialog.tsx` | Medium |
| G20 | **A suspended person is locked out with a generic message mid-session**; they cannot see the reason or reach any appeal channel | `session-service.ts:92`; `errors.ts:51-52` | Medium (detail of redesign finding) |
| G21 | **Reinstatement sets ACTIVE unconditionally** (even if never ACTIVE before); only live eligibility protects matching | `suspension.ts:174` | Low |
| G22 | **`DEACTIVATED` is never set by any code**; `ProfessionalCategory.isActive` and `Specialty.isActive` are enforced for writes (`profile.ts:73,82`) but not filtered in `/reference` | grep; `config/reference.ts:50-57` | Low |
| G23 | **Activation sweep is cosmetic**: UNDER_REVIEW and ACTIVE are treated identically, and a daily lag exists between eligibility and the ACTIVE label | `domain/eligibility.ts:60`; `jobs.ts:51-54` | Low |
| G24 | **Facility sees nothing about a practitioner's verification** (no badge, no licence date, no evidence age); the only trust signal is being ranked at all | grep of `src/app/facility` | Medium (see spec) |
| G25 | **Eligibility is not asserted at invite/accept/confirm**, only at match run (consistent with redesign #7 but verified from the practitioners side: the only consumers are candidates + dashboard + eligibility route) | grep `getEligibility*` | High (cross-slice) |
| G26 | **Credentials <-> practitioners import each other** (module-rule breach) | `submission.ts:2`; `confirm-from-submission.ts:2-10` | Low |
| G27 | **No DB constraint for one live submission per (user, type)**; `reviewedBy/At/Notes` are overwritten on resupply so review history lives only in the audit log | `submission.ts:181-186,474-487` | Low |
| G28 | **Sweeps are all-or-nothing per run and unpaged** (one thrown row fails the job until tomorrow) | `credentials/application/expiry.ts:33-66`; `screening.ts:173-192` | Low (redesign mentions per-row isolation generally) |

---

## 8. Spec v2.9 vs code

Source: `.../scratchpad/v29/v29.md` (read as data). Marks: IMPLEMENTED / PARTLY / MISSING / DIVERGES. One line each.

### 8.1 Module 2 — Practitioner management (spec lines 328-358)

| Spec requirement | Mark | Evidence |
|---|---|---|
| Personal, contact, state/LGA and current-location data | PARTLY | contact on `User` (schema 25-33); home state/LGA (schema 474-475); no current-location field |
| Professional category, specialty and subspecialty | PARTLY | category + one optional specialty (schema 466-471); no subspecialty |
| Years of experience and work history | PARTLY | `yearsOfExperience` (schema 471); no work history entity |
| Preferred locations, shift types, rate expectations | PARTLY | only `travelPreference` + home area (schema 474-479); no shift-type or rate preference anywhere (availability slots carry neither, schema 863-899) |
| Verification panel shown to facilities (MDCN status + date, licence expiry, NIN yes/no, evidence tier) | MISSING | facility roles hold no practitioner/credential permission (`permissions.ts:140-147`); `/practitioners/verification` is SELF or PLATFORM only (`routes.ts`); facility UI shows only name/phone/score from matching (`match.ts:161-179`); "evidence tier" is defined nowhere in code or spec |
| Qualifications: degree, institution, year, housemanship, fellowships, each with document | PARTLY | only a document-type `mbbs_certificate` (`seed:103`); no institution/year/housemanship/fellowship structure |
| Employment history with scope-of-practice description | MISSING | only a 1000-char `bio` (schema 473; `domain/profile.ts:9`) |
| Procedures and competencies, by category, filterable | MISSING | no entity; only single specialty hard-filter (`engine.ts:143-146`) |
| Languages spoken | MISSING | no field |
| Platform record (shifts completed, facilities worked, reliability, N), not editable | PARTLY | completions and reliability are computed from assignments and shown per match with the count, e.g. "N assignments completed" (`engine.ts:209-218`, `match.ts:140-141`); not a profile record, no "facilities worked", not shown outside a match run |
| Indemnity cover: provider, policy number, expiry, renewal reminder | PARTLY | credential type `indemnity_cover`, optional, document + optional number (`seed:106`); expiry = review date + 365 d; no provider/policy fields; no reminder; not in eligibility |
| Every claim is verified / evidenced / stated, and the profile says which | MISSING | no per-claim marker; the only provenance flags are `registration.source` and `identity.method` (schema 693-750), invisible to facilities |
| Configurable categories: doctors, dentists, nurses/midwives, pharmacists, lab scientists, radiographers, physiotherapists, CHPs | PARTLY | 5 of 8 seeded (`seed:36-42`); categories are rows but no admin route edits config (`config.manage` has no route in this slice) |
| Data: practitioner_profiles, specialties, practitioner_specialties, work_experiences, professional_categories, practitioner_preferences | DIVERGES | profiles, specialties, categories exist; no practitioner_specialties (single FK), work_experiences or practitioner_preferences |

### 8.2 Module 3 — Credential and compliance verification (spec lines 360-418)

| Spec requirement | Mark | Evidence |
|---|---|---|
| Identity assurance precedes credential; ineligible until both pass | IMPLEMENTED | blockers 3-4 and 5-9 (`domain/eligibility.ts:66-94`) |
| MDCN confirm-doctor-status check "runs at registration" | DIVERGES | no registration-time check; the officer reviews at onboarding from a photographed licence (`evidence-review.tsx:80,475`) |
| Lookup done by a compliance officer, stored as evidence with retrieval date (no scraping) | PARTLY | `evidenceRetrievedAt` stored (schema 714; `verification.ts:251`); but the officer reads a licence photo, not the portal, and no register response/snapshot or screenshot is kept (status, practiceType, location only) |
| Provider adapter so an official API can be substituted later | PARTLY | interface and switches exist (`lib/verification/index.ts:52-61,135-157`); every non-`none` setting throws (`:99-133`) |
| Sanctioned and quack lists screened at registration and on a schedule | PARTLY | mechanism IMPLEMENTED (`handlers.ts:42-51`; `jobs.ts:33-37`; `screening.ts`); list data empty and no maintenance path (`seed:165-178`) |
| Report-a-quack / report-a-deceased outbound channels | MISSING | no code |
| Certificate of Good Standing accepted as evidence if held | IMPLEMENTED | optional type `good_standing` (`seed:105`) |
| DataFlow primary-source verification out of Phase 1 | IMPLEMENTED | not present (as specified) |
| Track verification turnaround from week one | MISSING | no metric; submitted/decided timestamps exist (`submittedForReviewAt`, `reviewedAt`) but nothing aggregates them |
| MDCN folio for doctors/dentists; equivalent regulator ID for other cadres | PARTLY | `folioNumber` stored for any regulator (schema 706-731) but only the doctor flow is wired (`seed:101`); dentists not a category |
| NIN verified through an authorised NIMC provider, never free-text | DIVERGES | practitioner types it into a text box (`evidence-fields.tsx:156-164`), stored in clear until confirmed (`submission.ts:548-576`), then checked by an officer reading a slip; provider not implemented (`index.ts:99-133`) |
| Certificate/folio checked against regulator register, response + retrieval date stored | PARTLY | retrieval date yes; the register response is not stored; MANUAL source flag only |
| Name, DOB and photo cross-matched across regulator, ID and licence; mismatch holds account in Under review | PARTLY | name only, as one officer-asserted boolean (`verification.ts:79-108`); no DOB field, no photo comparison, regulator-record name not captured; mismatch becomes blocker `identity_name_mismatch` (`domain/eligibility.ts:68-71`); "Under review" is the default state for everyone until eligible (no distinct hold state) |
| No live photo/liveness required | IMPLEMENTED | none collected |
| One verified NIN and one regulator ID = one active account | PARTLY | unique `nin_hash` and unique `folio_number` (schema 675,710) enforced when the officer records; the second claimant is not refused at submission; folio uniqueness is global across regulators |
| DB-level uniqueness on verified NIN, folio, verified phone | IMPLEMENTED | `identity_verifications_nin_hash_key` (migration:648), `professional_registrations_folio_number_key` (:651), `users_phone_key` (:321) — phone unique whether or not verified |
| Account recovery through a compliance officer, recorded | MISSING | recovery is phone-OTP only (`auth/application/recovery.ts` header) |
| Bank-account reuse check across accounts | MISSING | no bank-account model in the schema; `payouts` carry no destination |
| No NIN: held, not refused; officer decides on remaining evidence | PARTLY | held (stays UNDER_REVIEW with `identity_unverified`) yes; no officer-decision path because `identity_verifications.nin_hash` is required and the manual form requires 11 digits (`schemas.ts:75-91`; schema 675) |
| Annual practising licence and qualification documents | IMPLEMENTED | `seed:101,103` |
| Government ID and professional indemnity information | PARTLY | NIN slip photo (`seed:102`); indemnity as an optional document (`seed:106`) |
| Certificate expiry tracking with automated renewal notifications | PARTLY | tracking yes (`expiresAt` + daily sweep); no notifications (no handler for `credential.expired`, no reminder job) |
| Manual and automated verification with compliance review queue | PARTLY | manual queue IMPLEMENTED (`admin/credentials/page.tsx`, directory "waiting"); automated not implemented |
| Rejection/resubmission workflow | IMPLEMENTED | REJECTED then new submission (`submission.ts:194`); request_info/resupply (`:449-506`); application returned (`application-review.ts:117-150`) |
| Automatic suspension on expiry | DIVERGES | deliberately not done: expiry makes them ineligible, never suspended (`credentials/application/expiry.ts:15-21`; `practitioners/application/expiry.ts`) |
| Statuses Draft, Submitted, Under review, Verified, Rejected, Expired, Suspended | DIVERGES | credential: PENDING, MORE_INFO_REQUESTED, VERIFIED, REJECTED, EXPIRED (schema 539-553) — no Draft, no Suspended, no separate Under review; registration: ACTIVE/SUSPENDED/EXPIRED/STRUCK_OFF/UNKNOWN (733-743) |
| Data: credentials, credential_types, credential_documents, verification_reviews, verification_sources, compliance_flags | DIVERGES | one table `credential_submissions` with embedded document key and review columns (schema 505-537) plus `credential_types`; no documents/reviews/sources/flags tables; review history only in audit_log |

### 8.3 Module 14 — Clinical incident reporting (spec lines 604-622)

| Spec requirement | Mark | Evidence |
|---|---|---|
| Either party may report against a specific assignment: facility, practitioner or Medilink officer | PARTLY | facility only; practitioners lack `incident.report` (`permissions.ts:116-122`); administrators lack it (`:172-183`) |
| Report is tied to an assignment | DIVERGES | `assignmentId` optional (`schemas.ts:15`); subject can be any UUID (`incident.ts:143-150`) |
| Records what/when/which assignment; no patient identifiers or clinical detail | PARTLY | what/when/assignment recorded; nothing prevents or warns about identifiers in a 4000-char summary (`domain/incident.ts:51`); attachment table exists (schema 1654-1669), unused |
| Opening an incident suspends the practitioner from new matching at that facility pending review | MISSING | opening does nothing; matching reads no incident data |
| Officer decides within a defined period: platform-wide, lifted, or facility-specific | DIVERGES | suspension only at closure and only platform-wide (`incident.ts:261,281`; `suspension.ts:95-101`); no deadline, no SLA, no sweep, no facility-specific suspension |
| Suspension pending investigation is "not a finding", recorded as such; separate from Module 12 ladder | PARTLY | separate tables from the unhonoured/fault ladder; `account_suspensions` has no pending-vs-sanction type and records only a free-text reason (schema 1677-1702) |
| Reported to MDCN complaint channel and recorded | PARTLY | outcome `REFERRED_TO_REGULATOR` (schema 1647; `incident-detail.tsx:66`) records a decision; no regulator, reference or date; no `incident_referrals` |
| All related records under legal hold until matter closes | MISSING | no legal-hold concept in code or schema (grep) |
| Production of records to court/coroner/Council, each logged | MISSING | no production route; no logging concept |
| Data: clinical_incidents, incident_reports, incident_suspensions, incident_referrals, legal_holds | DIVERGES | `clinical_incidents`, `incident_attachments`, `account_suspensions` only |
| §9.15 serious incident: preserve records, temporary matching restriction, notify officer, start investigation deadline, audit event, restrict access | PARTLY | audit event yes (`incident.ts:166-174`); records not editable/deletable (`routes.ts`); restriction, notification (no handler), deadline all MISSING; facility sees closure notes (`incident-detail-dialog.tsx:68-79`) |

### 8.4 §9.8 Clinical governance and scope of practice

| Spec requirement | Mark | Evidence |
|---|---|---|
| Clinical safety lead / advisory committee appointed | MISSING (organisational) | gate item 3.6 "Not started" (`docs/stage-3-gate-checklist.md:14`) |
| Structured scope-of-practice records and declared competencies | MISSING | section 5 |
| Evidence level on a practitioner | MISSING | no tier field |
| Facility requirements for competency / minimum qualification per assignment type | MISSING | request carries category and one optional specialty only (schema 926) |
| Supervision requirement (interns, residents, locums, newly qualified) | MISSING | no field |
| Indemnity status in matching | MISSING | `indemnity_cover` optional and not read by eligibility or the engine |
| Restrictions on unfamiliar or high-risk work | MISSING | none |
| Request outside verified competence blocked or routed to governance review | PARTLY | the single specialty hard-exclusion (`engine.ts:143-146`) is the only control; no governance routing |

### 8.5 §9.9 Identity, credential and privacy model

| Spec requirement | Mark | Evidence |
|---|---|---|
| Raw NIN stored only where necessary; tokens / salted hashes / encrypted values with documented key management | PARTLY | keyed HMAC + last4 (`domain/verification.ts:36-45`), audit masked (`submission.ts:79-82`); not salted per record, key is `SESSION_SECRET` with no versioning (G7); raw NIN transiently held in `reference_number` (G6) |
| Raw NIN and credential numbers not exposed to facilities | IMPLEMENTED | no facility route returns them; verification read is SELF/PLATFORM (`routes.ts`) |
| Facility users see status, evidence tier, regulator, expiry, restrictions | MISSING | no facility-facing view (see 8.1) |
| Credential model fields: type | IMPLEMENTED | `credentialTypeId` (schema 507) |
| ... issuing authority | PARTLY | `CredentialType.issuer` per type only (schema 346) |
| ... credential-number token | PARTLY | `referenceNumber` plain for non-NIN; NIN masked after use; identity hash separate |
| ... subject user | IMPLEMENTED | `userId` |
| ... issue and expiry dates | PARTLY | expiry derived (`expiresAt`); no issue date field |
| ... verification status | IMPLEMENTED | `status` |
| ... verification method | PARTLY | per type (`verificationMethod`), plus identity `method` / registration `source`; not per submission |
| ... verification time and verifier | IMPLEMENTED | `reviewedAt`, `reviewedBy` (cleared on resupply) |
| ... source reference | MISSING | no register reference/response id |
| ... evidence document | IMPLEMENTED | `documentObjectKey` |
| ... review notes | IMPLEMENTED | `reviewNotes` |
| ... superseded credential | MISSING | no link; old EXPIRED/REJECTED rows persist and (EXPIRED) keep blocking (G1) |
| Procedures: name changes, marriage-related record differences | MISSING | identity can be re-recorded by upsert (`verification.ts:115-136`) but no procedure |
| Procedures: phone loss, account recovery | MISSING | phone-OTP recovery only |
| Procedures: deceased, suspended or retired practitioners | PARTLY | suspension exists via incident; no deceased/retired handling |
| Procedures: duplicate-account review | PARTLY | DB uniqueness only; no review queue |
| Procedures: credential expiry | PARTLY | sweep + ineligibility; no notice |
| Preservation of evidence when an external source changes | PARTLY | registration row is overwritten in place; only audit before/after keeps history (`verification.ts:289-304`) |

### 8.6 Extra spec criterion touching this slice (§9.15)
"A practitioner must not appear in matching unless identity verified, required credentials verified and unexpired, required documents approved, no active platform-wide suspension, and category plus scope of practice satisfy the request": identity IMPLEMENTED (`domain/eligibility.ts:66-71`); credentials verified/unexpired PARTLY (sweep lag G2, renewal bug G1); suspension IMPLEMENTED (`:60-62`); category IMPLEMENTED (`engine.ts:137-139`); scope of practice MISSING beyond the single specialty.

---

## 9. Stale docs and open questions

Stale or wrong in slice docs (code is truth):
- `docs/stage-5-2-credential-verification.md` "Not in this stage": says no expiry sweep, no scheduler, no activation — all built later (`jobs.ts`).
- `docs/stage-5-8-5-9-eligibility-and-expiry.md`: says an expired credential/registration is refused "the moment the expiry passes" — true for registrations only (G2).
- `docs/stage-5-1-practitioner-profiles.md` "Not in this stage" still lists cross-practitioner reads, NIN and credential documents as unbuilt.
- `src/modules/practitioners/domain/profile.ts` comment "only doctors have any seeded [specialties] yet" — nurses now have three (`seed:73`).
- `docs/stage-5-10-facility-verification.md` references retired roles (`operations_officer`).
- `CredentialType.isMandatory` still seeded (`seed:101-106`) though unread.

Open questions for compliance / the founder (not answerable from code):
1. Is the annual practising licence number the same identifier as the register folio? It is stored and sanctions-matched as `folioNumber` (G14).
2. Who maintains `config.sanctioned_entries`, and how (SQL, an admin tool, a feed)?
3. What does the clinical safety lead (gate 3.6) decide for competencies, supervision and facility-specific restrictions?
4. Should the officer's evidence source be the licence photograph or the MDCN confirm-doctor-status portal (spec says the latter)?
