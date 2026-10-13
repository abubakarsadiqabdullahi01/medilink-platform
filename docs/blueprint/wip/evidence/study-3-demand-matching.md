# Study 3 — Demand side and the marketplace core (facilities, service-requests, availability, matching, scheduling)

Repo: `/home/user/medilink-platform`, HEAD `5c199c1` ("Tooling: scripts, dependencies and configuration"). Read-only static study; nothing was run, so every "CONFIRMED" below means "read in the code at HEAD", not "observed at runtime". Paths are relative to the repo root unless they start with `/`. Line numbers are HEAD line numbers.

Legend. As-built facts are stated flatly. **GAP** marks something absent or wrong. Verdicts: CONFIRMED / ALREADY FIXED / PARTLY / NOT FOUND (section 11). Spec verdicts: IMPLEMENTED / PARTLY / MISSING / DIVERGES (section 15).

---

## 0. The one-page picture

A Gombe hospital or PHC registers itself (or operations registers it). It sits `PENDING` until a platform administrator clicks Verify. Then a facility user drafts-and-publishes a shift (profession, optional specialty, DAY/NIGHT, window, headcount, one hourly rate in kobo, urgency, free-text cancellation terms). On the shift page a facility user clicks "Find candidates"; a pure engine ranks every practitioner of that profession (hard exclusions, then a 100-point score). The facility ticks names and clicks "Offer". The practitioner sees the offer only by opening the app (no message is sent). They accept or decline (decline needs a reason). The facility sees the acceptance (page polls every 15 s) and clicks Confirm. Confirm takes a Postgres advisory lock **on the practitioner**, checks, writes the assignment, and when the count reaches headcount flips the request to FILLED and withdraws the other offers. Both parties then get an SMS through the notification adapter (times printed in UTC). Attendance, timesheet, invoice and payout follow in other modules (out of scope here).

There is **no** professional level/cadre/seniority, no per-person rate, no counter-offer, no practitioner-initiated application, no priced availability listing, no direct/instant booking, no shift board visible to practitioners (section 10).

---

## 1. Actors, roles, permissions, scopes

Five roles exist (`src/lib/authz/permissions.ts`, `ROLE_PERMISSIONS`); older role names are retired and mapped (`RETIRED_ROLES`, permissions.ts:230). Authorisation is always permission + scope, checked by `handleGuardedRequest` before any DB read (`src/lib/http/guarded-handler.ts`). A `PLATFORM` grant satisfies any `FACILITY`/`SELF` check on the same permission (guard rule, cited in `docs/stage-5-10-facility-verification.md`).

| Role | Scope | Permissions that matter to this slice |
|---|---|---|
| `practitioner` (auto-granted to every registrant, `src/worker/handlers.ts:42-51`) | SELF | `availability.read/write`, `service_request.read` (used for offers and own assignments), `attendance.record`, `timesheet.submit` |
| `facility_administrator` | FACILITY:<id> | `facility.read`, `facility.write`, `facility.user.manage` (no route uses it), `service_request.read/publish`, `assignment.confirm`, `assignment.cancel`, `attendance.record`, `timesheet.approve`, `invoice.read`, `payout.manage`, `incident.report`, `availability.read` |
| `facility_owner` | FACILITY:<id> | everything above plus `role.grant` (step-up) and `dispute.manage`; this is the staff-management key (`src/app/facility/staff/page.tsx:3-9`) |
| `administrator` (platform ops, compliance, finance merged) | PLATFORM | `facility.read/write/verify`, `service_request.read`, `assignment.confirm`, `assignment.cancel`, `availability.read`, `role.grant`, `audit.read`. **Not** `service_request.publish`, so ops cannot publish or cancel a facility's request |
| `super_administrator` | PLATFORM | all, including `config.manage` (rate floors) |

Per-route permission and scope (all `src/app/api/v1/**`, tables in each module's `routes.ts`):

- Facilities: `POST /facilities` `facility.write`@PLATFORM (`src/app/api/v1/facilities/route.ts:19-28`); `POST /facilities/register` authenticated only, no permission (`.../register/route.ts:27-62`); `GET /facilities` `facility.read`@PLATFORM or FACILITY (`route.ts:30-40`); `GET|PATCH /facilities/:id` read/write@FACILITY; `POST .../licence-upload-url` write@FACILITY; `POST .../licence-url` read@FACILITY (logs a `security_events` row, `src/modules/facilities/application/facility.ts:552`); `POST .../verify` `facility.verify`@PLATFORM only (`.../verify/route.ts:20-21`). Table: `src/modules/facilities/routes.ts:18-41`.
- Service requests: create/publish/cancel `service_request.publish`@FACILITY; list/get `service_request.read`@FACILITY or PLATFORM (`src/modules/service-requests/routes.ts:22-59`). `facilityId` is required in every body/query because it is the authorisation scope (`presentation/schemas.ts:20-63`).
- Matching and assignments: `match`, `invite`, `confirm` need `assignment.confirm`@FACILITY; `GET match-runs/:id` and `GET invitations` (per request) need `service_request.read`@FACILITY; practitioner side `GET /invitations`, `POST /invitations/:id/respond` need `service_request.read`@SELF; `GET /assignments` read@SELF or FACILITY; `POST /assignments/:id/cancel` `assignment.cancel`@FACILITY (`src/modules/matching/routes.ts:13-69`).
- Availability: reads SELF or PLATFORM, all writes SELF only (`src/modules/availability/routes.ts:19-52`; a test asserts no write ever gains wider scope, `tests/integration/availability.test.ts:309`).
- Scheduling: no routes, no permissions (`src/modules/scheduling/routes.ts:13` `ROUTES = []`, `permissions.ts:5` `[]`).

---

## 2. End-to-end flow AS IMPLEMENTED

1. **Facility registers.**
   - Self-service: `/facility/register` (`src/app/facility/register/page.tsx`) -> `POST /api/v1/facilities/register`. One PENDING facility per user (`register/route.ts:37-46`). `createFacility` (`src/modules/facilities/application/facility.ts:177-254`) validates type, state, LGA-in-state, representative, creates the row (`status` default PENDING, `prisma/schema.prisma:578`) and, in the same transaction, grants the registrant `facility_owner` at FACILITY scope (`facility.ts:194, 224-232`). The registrant can immediately act as owner of an unverified facility.
   - Operations: `POST /api/v1/facilities` names a representative; no admin UI creates facilities (only an API; `src/app/admin/facilities/page.tsx` lists/verifies).
2. **Verified.** Admin opens `/admin/facilities`, detail card (`src/app/admin/facilities/facility-detail.tsx`), clicks Verify or Reject (reject needs notes, `presentation/schemas.ts:144-153`). `verifyFacility` (`facility.ts:399-464`) refuses own facility (407-409), refuses non-PENDING (410), conditional update (418-427), audits at FACILITY scope (434-444), emits `facility.verified` only on approval (449-460). No licence is required for approval (no check anywhere in 399-464).
3. **Publishes a request.** `/facility/shifts` -> `NewShiftDialog` creates a DRAFT (`POST /service-requests`) then immediately publishes (`POST .../publish`) (`src/app/facility/shifts/new-shift-dialog.tsx:72-93`). `createServiceRequest` (`src/modules/service-requests/application/request.ts:126-196`) only calls `getFacility` (404 if missing), validates window (<=24 h), category, specialty-in-category, rate floor; it does **not** require the facility to be verified (so unverified owners can create drafts). `publishServiceRequest` (215-285) loads facility, re-checks floor, builds `publishBlockers` (`domain/request.ts:66-77`), refuses with `facility_cannot_publish` listing every facility blocker, `below_rate_floor`, `starts_in_the_past`, `not_a_draft`, compare-and-set DRAFT->PUBLISHED (252-256), audit, emits `service_request.published` (271-281). A failed publish leaves an orphan DRAFT; the shifts page has a per-row Publish retry for this (`src/app/facility/shifts/page.tsx:381-391`).
4. **Matcher ranks.** Shift detail page -> "Find candidates" -> `POST /service-requests/:id/match` -> `runMatch` (`src/modules/matching/application/match.ts:63-244`). Section 6.
5. **Invites.** Facility ticks ranked names -> `POST .../invite` -> `invitePractitioners` (`src/modules/matching/application/assignment.ts:91-202`): requires request PUBLISHED (96), default expiry now+24 h (98-100), per-user create or reopen, audit scoped to the practitioner (SELF), emits `shift.invited` (190-195). No notification goes out.
6. **Practitioner accepts.** `/practitioner/offers` lists invitations with facility name, profession, shift type, times, rate, urgency, answer-by (`src/app/practitioner/offers/page.tsx:122-153`). `respondToInvitation` (211-276): ownership folded into lookup, open check (217), compare-and-set (223-231), decline reason mandatory (`presentation/schemas.ts:405-416`) and copied to the suggestion log (252-257), emits `shift.accepted` on accept only (261-272).
7. **Facility confirms.** "Ready to confirm" card -> `POST .../confirm` -> `confirmAssignment` (404-518). Section 6.4.
8. **Assignment.** Row in `matching.assignments` (CONFIRMED) + `assignment_status_history` row + audit + `assignment.confirmed` event (444-514). Worker handler `notifyAssignmentConfirmed` sends one SMS to the practitioner and one to `facility.representativeUserId` only (`src/modules/notifications/application/handlers.ts:33-81`, `src/worker/handlers.ts:20-22`).

**Walk-through "PHC needs a verified nurse tonight" and where it stalls.** (a) The PHC cannot publish until an administrator verifies it, and nobody is told when that happens (`facility.verified` has no handler). (b) Publishing "tonight" is possible (only `starts_in_the_past` blocks) but URGENCY changes nothing: no auto-invite, no broadcast, no shorter offer expiry (`urgency` is read nowhere in `engine.ts`/`match.ts`). (c) A practitioner is only offered the shift if they pre-entered a weekly availability pattern whose slots cover the whole shift (default-deny, `engine.ts:148-149`); the practitioner UI cannot enter a one-off "free tonight" slot (section 5). (d) The nurse is not messaged; she must open the app. (e) The facility must still Confirm after she accepts. (f) The default offer lifetime is 24 h, longer than "tonight".

---

## 3. Module: facilities

### 3.1 Purpose
Gives a hospital/PHC/clinic an identity the platform can gate on: `canPublish` is the single decision that "unverified work never reaches anyone" (`src/modules/facilities/domain/facility.ts:58-61`), consumed by service-requests at publish time.

### 3.2 Entities
`facilities.facilities` (`prisma/schema.prisma:561-614`): `name`, `facilityTypeId`, `cacNumber` (non-null, globally `@unique`, 567), `stateId`, `lgaId?`, `addressLine`, `contactPhone`, `contactEmail?`, `representativeUserId` (Restrict FK, 576, 607), `status`, `licenceNumber?`, `licenceObjectKey?`, `licenceExpiresAt?` (580-584), `verifiedBy/At`, `reviewNotes`, soft-delete `deletedAt`. Types (`config.facility_types`, schema 392-404; seeded `prisma/seed.ts:194-203`): teaching_hospital, general_hospital, private_hospital, primary_health_centre, clinic, diagnostic_laboratory, imaging_centre. No ownership type, no coordinates, no branch/department tables, no staff table (staff = `identity.user_roles` grants), no billing contact or supervisor concept, no facility documents table other than one `licenceObjectKey` pointing at `storage.stored_objects` with purpose `facility_licence` (`facility.ts:111-127, 480-525`).
- Branches and departments: not built. `BRANCH`/`DEPARTMENT`/`FACILITY_GROUP` exist only as `ScopeType` values (`schema.prisma:140-147`) and the guard's `ancestors` hook (`src/lib/authz/guard.ts:15, 57`); no route resolves them.
- Staff and roles: owner adds staff from `/facility/staff` via `POST /api/v1/grants` (step-up, `role.grant`) offering only `facility_administrator` and `facility_owner` (`src/app/facility/staff/page.tsx:12-25`). Staff must already have an account (lookup by phone, `src/app/api/v1/grants/find/route.ts`).

### 3.3 State machine (facility)
States: `PENDING` (default), `VERIFIED`, `REJECTED`, `SUSPENDED` (`domain/facility.ts:16`, schema 616-626). `deletedAt` is orthogonal and no code sets it.

| Transition | Code that enforces it |
|---|---|
| (create) -> PENDING | `createFacility` `facility.ts:198-212` (column default) |
| PENDING -> VERIFIED / REJECTED | `verifyFacility` `facility.ts:399-464`; `facility.verify`@PLATFORM (`verify/route.ts:20-21`); not own facility (407-409); `status !== 'PENDING'` -> `alreadyVerified` (410); compare-and-set `updateMany where status PENDING` (418-427); reject requires notes (`schemas.ts:144-153`) |
| VERIFIED -> PENDING | `updateFacility` when any of `licenceNumber`, `licenceObjectKey`, `licenceExpiresAt` is supplied while status is VERIFIED (`facility.ts:333, 351-352, 366-368`); clears `verifiedBy/At/reviewNotes`; audit action `facility.licence_replaced` (377) |
| REJECTED -> anything | none. `resetForReview` requires `existing.status === 'VERIFIED'` (352) and `verifyFacility` requires PENDING (410) |
| anything -> SUSPENDED | none. No code writes SUSPENDED (grep of `facility.create/update/updateMany` finds only `facility.ts:198, 355, 418`) |
| VERIFIED -> REJECTED/SUSPENDED by ops | none (verify refuses non-PENDING, 410) |

Derived, not stored: `canPublish` = status VERIFIED and not deleted and `licenceExpiresAt` null or in the future (`domain/facility.ts:34-56`), computed on read in `toView` (`facility.ts:93-94`). Blockers: `deleted`, `suspended`, `not_verified`, `licence_expired`.

### 3.4 CAC and licence handling
- CAC is required and unique. Ops path normalises via schema transform (upper-case, strip whitespace, regex `^[A-Z0-9]{4,20}$`, `presentation/schemas.ts:24-32, 62-74`). The **self-registration** schema does not (`schemas.ts:91` `z.string().trim().min(3).max(40)`) and `createFacility` stores `input.cacNumber` raw (`facility.ts:202`), so `rc 123456` and `RC123456` are different rows. Duplicate refused by the DB unique constraint (`facility.ts:246-252` P2002 -> `duplicate_cac_number`).
- There is no CAC registry lookup and no stored retrieval evidence. Verification is a human click.
- Licence: number (optional), expiry (optional), object key (optional, set only by PATCH after a signed-URL upload, `confirmLicenceReference` `facility.ts:111-127`). Self-registration UI sends licence number only (`register/page.tsx:60`); the API accepts `licenceExpiresAt` (`schemas.ts:98`) but no UI sends it, and no facility-side screen uploads the document (grep for `licence-upload-url` finds only API/test code). Admin sees "No licence document was uploaded. Verifying without one means the check happened somewhere this record cannot show" and can still Verify (`facility-detail.tsx:208-211, 243-281`).
- Name, address and contact edits do not reset verification (`facility.ts:344-352`).

### 3.5 Routes, sweeps, events
Routes in 1. No facility sweep exists: `src/worker/jobs.ts:31-68` lists six jobs (screening, credential expiry, registration expiry, activation, request expiry, unhonoured) and none touches facilities. Event: `facility.verified` (approval only, `facility.ts:449-460`); **no handler**; rejection emits nothing (comment `facility.ts:446-448`).

### 3.6 UI
`/facility` dashboard banner for PENDING/REJECTED/SUSPENDED (`src/app/facility/page.tsx:159-181`; the REJECTED text tells the owner to "reply to Medilink with the corrected documents", for which no mechanism exists). `/facility/register`. Admin list filters PENDING/VERIFIED/REJECTED only (`src/app/admin/facilities/page.tsx:42`). There is no facility profile/edit page, no licence upload, no representative change.

### 3.7 Tests
Unit: `src/modules/facilities/domain/facility.test.ts` (publishBlockers incl. all-blockers, expiry inclusive, `normaliseCacNumber`). Integration: `tests/integration/facility-verification.test.ts` (creation + owner grant, CAC normalised on the ops path, duplicate CAC, LGA-in-state, 403 matrix, tenant isolation, verify flows, own-facility refusal, double review, licence upload/refusal/access log, licence swap sends back to PENDING, lapsed licence cannot publish, route table). **No test covers `POST /facilities/register`, REJECTED handling, SUSPENDED, or approval-without-licence.** `tests/e2e/multisite.spec.ts` covers the two-hospital switcher.

---

## 4. Module: service-requests

### 4.1 Purpose
A facility's stated need for a shift, floor-checked and gated on facility verification. Serves "we need two nurses on Saturday night at a stated rate".

### 4.2 Entity (`prisma/schema.prisma:922-967`) and what a request carries
`facilityId`, `professionalCategoryId`, `specialtyId?`, `shiftType` DAY|NIGHT, `startsAt`, `endsAt` (<=24 h, `MAX_SHIFT_HOURS` `domain/request.ts:16`), `headcount` 1-50 (`MAX_HEADCOUNT` line 14, `presentation/schemas.ts:27`), `hourlyRateKobo` (int > 0, `schemas.ts:29`), `currency` NGN, `urgency` ROUTINE|URGENT|EMERGENCY, `cancellationTerms` (required free text, 10-2000 chars, `schemas.ts:33`), `notes?` (free text, the only place for ward/contact/what to bring), `status`, `createdBy`, `publishedBy/At`, `cancelledAt`, `cancellationReason`, soft delete. **Not present:** branch, department, responsibilities as structure, minimum experience, per-request required credentials, allowances/transport/accommodation, application deadline, level/cadre/supervision, per-person rate, rate unit other than hourly, recurrence, a status-history table. Rate floors: `config.rate_floors` (schema 421-435) resolved by `resolveRateFloor` (`domain/rate-floor.ts:42`) and `checkAgainstFloor` (78); specialty floor beats `*`, latest `effectiveFrom` at the shift date wins.

### 4.3 State machine (service request)
`DRAFT, PUBLISHED, FILLED, CANCELLED, EXPIRED` (`domain/request.ts:5-10`). Table `TRANSITIONS` (32-40): DRAFT->{PUBLISHED, CANCELLED}; PUBLISHED->{FILLED, CANCELLED, EXPIRED}; FILLED->{CANCELLED}; CANCELLED, EXPIRED terminal.

| Transition | Code |
|---|---|
| DRAFT -> PUBLISHED | `publishServiceRequest` `request.ts:215-285`, compare-and-set 252-256, `publishBlockers` `domain/request.ts:66-77` |
| DRAFT/PUBLISHED/FILLED -> CANCELLED | `cancelServiceRequest` `request.ts:294-333`, guarded by `canTransition` (299); the write at 306 is `update where id` with **no status condition** (race with confirm) |
| PUBLISHED -> FILLED | `confirmAssignment` `matching/application/assignment.ts:479-483` (`updateMany where status PUBLISHED`) |
| **FILLED -> PUBLISHED (reopen)** | `cancelAssignment` `assignment.ts:555-560`. **Not in `TRANSITIONS`** (FILLED only allows CANCELLED) and `canTransition` is not called there: the domain table and the code disagree |
| PUBLISHED -> EXPIRED | `expireStartedRequests` `service-requests/application/expiry.ts:25-40` (hourly sweep, `src/worker/jobs.ts:56-61, 71-73`) |

### 4.4 Behaviour worth stating
- No edit/update route exists at all (documented intent: cancel and republish, `docs/stage-6-1-service-requests.md`; dialog text `new-shift-dialog.tsx:124-125`). No clone/repeat.
- `GET /service-requests` is facility- or platform-scoped only; practitioners hold `service_request.read` at SELF so **cannot list open requests** (they see only invitations and own assignments).
- List adds `confirmedCount` from `bookedCountsFor` = assignments with status != CANCELLED (`src/app/api/v1/service-requests/route.ts:41-44`; `assignment.ts:607-615`), whereas confirm counts only CONFIRMED (`assignment.ts:420`): two definitions of "filled".
- Cancel withdraws outstanding invitations (INVITED, and ACCEPTED without assignment) via `withdrawOutstandingInvitations` (`request.ts:311-317`; `assignment.ts:297-351`). It does **not** touch assignments (see 11 #5).
- Sweep: `expireStartedRequests` selects `status PUBLISHED, startsAt <= now` (expiry.ts:26), conditional update (37-40), withdraws invitations with `actorType 'system'` (42-48), audit (52-60). It returns `expired: due.length`, not the number actually updated (67, 72).

### 4.5 Events
`service_request.published` (`request.ts:271-281`), no handler. No event on cancel, fill, expire.

### 4.6 Tests
`src/modules/service-requests/domain/request.test.ts` (floor resolution, `canTransition`, `publishBlockers`); `tests/integration/service-requests.test.ts` (floor at/below, publish gate for unverified facility, past start, validation, cancel never revives, listing filters, authorisation incl. 404-not-other-facility, route table); expiry cases are in `tests/integration/assignments.test.ts:770-857`. Not tested: a **half-filled** request at expiry, cancel of a FILLED request with live assignments, cancel/confirm race.

---

## 5. Module: availability

### 5.1 Purpose
A practitioner's statement of when they can work, used by the matcher as a hard filter ("does this person offer the whole shift?"). Serves "I work nights Monday and Thursday".

### 5.2 Entities
`availability.availability_slots` (`schema.prisma:863-889`): `kind` RECURRING_WEEKLY | ONE_OFF; recurring: `dayOfWeek` (0=Sun), `startMinute`, `endMinute` (minutes since midnight **WAT**, UTC+1), optional `effectiveFrom/Until`; one-off: `startsAt/endsAt`; soft delete. `availability.blocked_periods` (901-916): `startsAt`, `endsAt`, `reason` (required, free text). No rate, level, visibility, status, area, minimum notice, day/night/weekend/holiday preference, on-call flag, max-hours field.

### 5.3 Logic (`src/modules/availability/domain/availability.ts`)
- WAT offset constant (15); `expandRecurring` starts a day early so Monday's night slot covers Tuesday's small hours (60-89); an end <= start means the slot wraps past midnight (75-79); `mergeWindows` joins touching windows (104-118); `availabilityFor` returns `blocked` (any overlap with a block, checked first, 141-143), else `available` only if a merged window covers the **whole** shift (145-154), else `not_offered`. Zero-length window is `not_offered` (137-139).
- Application (`application/availability.ts`): add/remove slot and block with audit scoped SELF; `emptySlot` refuses start == end (103-105); `availabilityForWindowBatch` loads **all** non-deleted slots and **all** blocks (past ones included) for the whole id list in two queries (277-280).
- All-day: API accepts `endMinute` up to 1440 (`presentation/schemas.ts:22-23`, comment 11-21; unit tests `domain/availability.test.ts:209-250`). UI cannot produce it (see 11 #18).

### 5.4 Routes, UI, tests
Routes in 1. UI is one tab inside My profile (`src/app/practitioner/profile/availability-section.tsx`; `/practitioner/availability` redirects there). It adds only **recurring weekly** slots (93-98) with `<input type="time">` (153-168); blocks via `datetime-local`. **No UI for one-off slots or `effectiveFrom/Until`**, though the API supports both. The empty state says "Without one the matcher has nothing to check a shift against, so you will not be offered work" (187). Tests: `domain/availability.test.ts` (WAT, wrap, merge, block beats slot, 24:00), `tests/integration/availability.test.ts` (validation, matcher view, SELF-only, 404 on others' slots, PLATFORM read).

---

## 6. Module: matching (ranking, invitations, assignments)

### 6.1 Purpose
Turns a published request into a ranked, explained shortlist, lets a person choose, lets the practitioner say yes, lets the facility make it final. "Never first to click" is a design rule (`docs/stage-6-5-6-6-6-7-assignments.md`).

### 6.2 The algorithm, precisely
Pool (`src/modules/practitioners/application/candidates.ts:46-85`): every `PractitionerProfile` with the request's `professionalCategoryId` and `deletedAt null` (no pagination, no geography filter, no status filter), minus anyone whose latest consent record for `PROFILE_VISIBILITY` or `CREDENTIAL_SHARING` is withdrawn (`audit-compliance/application/consent.ts:167, 178-194`; silently dropped, not listed as excluded, not counted in `consideredCount`). Eligibility per candidate comes from the pure Stage-5 function `eligibilityBlockers` (`practitioners/domain/eligibility.ts:52-103`): account ACTIVE or UNDER_REVIEW, profile exists, identity verified and name matches, registration present/active/evidence not stale, required credentials verified and not expired, screening CLEAR. The matcher receives only the boolean.

Hard exclusions, all collected not just the first (`matching/domain/engine.ts:127-161`):
1. `not_eligible` (135).
2. `category_mismatch` (137-139). Unreachable in the wired path because the pool is already filtered by category.
3. `specialty_mismatch`: only when the request names a specialty and the candidate's specialty differs or is null (144-146). A request without specialty accepts anyone.
4. `blocked`: any blocked period overlaps any part of the shift (148); `unavailable` (`not_offered`): slots do not cover the whole shift, including "no slots at all" (149).
5. `already_assigned`: a CONFIRMED assignment overlaps the window (151; query `match.ts:93-102`). Back-to-back is not a clash (`domain/assignment.ts:30-32`). ACCEPTED-but-unconfirmed offers are ignored.
6. `travel_preference`: preference SAME_LGA and proximity tier != SAME_LGA, or preference SAME_STATE and tier == ELSEWHERE; ANYWHERE never excludes (153-158). Default preference is SAME_STATE (`schema.prisma:479`).

Score (max 100, weights fixed in code `engine.ts:31-36`, stored per run `match.ts:186-190`):
- **Experience 30**: `min(yearsOfExperience, 10) / 10` (46, 174-175). Years are the self-declared integer on the profile (`candidates.ts:55`).
- **Proximity 35**: tier from `proximityTier` (260-274): same LGA 1.0 (needs both LGA ids non-null and equal), same state 0.6, else 0.2 (65-69). A practitioner with no home state/LGA is ELSEWHERE.
- **Fatigue 20**: `1 - min(hours, 48)/48`, where hours = summed duration of the practitioner's **CONFIRMED** assignments whose `startsAt` is in `[shiftStart - 168 h, shiftStart)` (`match.ts:35, 79, 103-119`; `engine.ts:49, 179-181`). COMPLETED assignments no longer count; nothing looks forward; there is no minimum-rest or max-consecutive rule.
- **Reliability 15**: if completed assignments < 5 then neutral 0.5 (`engine.ts:52, 63, 183-186`); else `completed / (completed + noShow)` (`matching/domain/reliability.ts:27-31`; counts from `assignmentOutcomesFor`, `assignment.ts:732-755`, COMPLETED and NO_SHOW only, so facility cancels and excused absences are invisible).
- Each factor returns `raw`, `points`, and a readable `detail` (94-102, 188-219). Score rounded to 2 dp. Ties break on `userId` ascending (246), deterministic but arbitrary.
- Rate, urgency, headcount, notice, language, facility preferences and past pairing do not enter ranking.

Returned to the caller (`match.ts:37-55, 157-179, 234-243`): `{id, serviceRequestId, consideredCount, rankedCount, ranked[], excluded[], createdAt}`. Each ranked entry has `userId, rank, score, factors[]` plus **`practitionerName` and `practitionerPhone`**; each **excluded** entry has `userId, reasons[]` plus the same **name and full unmasked phone** (names/phones fetched from `identity.users`, 161-179; fallback "Unknown practitioner"/empty). The shift page displays name and score for ranked, name and reason badges for excluded (`src/app/facility/shifts/[id]/page.tsx:339-429`), but the API payload carries the phones regardless. Factor `detail` strings expose years of experience, proximity tier and hours committed this week.

Persistence: one `matching.match_runs` row (weights JSON) and one `match_candidates` row for **every** pool member, ranked or excluded (`match.ts:181-218`); one audit row `matching.run` (220-232). `getMatchRun` returns ids only (259-288). Any number of runs may be made; each writes a row per practitioner in the category.

### 6.3 Invitation state machine
Enum `INVITED, ACCEPTED, DECLINED, EXPIRED, WITHDRAWN` (`schema.prisma:1066-1077`; domain type `domain/assignment.ts:4-9`). One row per (request, user): `@@unique` (1060). The model has **no foreign keys** to user, request or match run (1046-1064).

| Transition | Code |
|---|---|
| none -> INVITED | `invitePractitioners` `assignment.ts:168-176`; requires request PUBLISHED (96); default lifetime `DEFAULT_INVITATION_HOURS = 24` (`domain/assignment.ts:15`), override `expiresInHours` 1-168 via API only (`presentation/schemas.ts:395`); UI never sends it |
| INVITED -> ACCEPTED / DECLINED | `respondToInvitation` 211-276; open = INVITED and `expiresAt > now` (`domain/assignment.ts:34-37`); compare-and-set (223-231) |
| INVITED, or ACCEPTED-without-assignment -> WITHDRAWN | `withdrawOutstandingInvitations` 297-351; called on fill (485-489), request cancel (`request.ts:312`), request expiry (`expiry.ts:42`) |
| WITHDRAWN / EXPIRED / lapsed INVITED -> INVITED | re-invite reopens the same row (122-166) |
| DECLINED, live INVITED, ACCEPTED -> (re-invite) | silent no-op that returns the existing row (128-131); the facility UI still toasts "Offered to N" (`shifts/[id]/page.tsx:176`) |
| -> EXPIRED | **never written** (grep: only read at `assignment.ts:125`); a lapsed offer stays `INVITED` in the DB until the request closes |
| ACCEPTED expiry | none: an accepted offer never goes stale |

### 6.4 Confirmation and locks
`confirmAssignment` (`assignment.ts:404-518`): load request by (id, facilityId) (405-408); open a transaction (default isolation, no options, line 410); `lockPractitioner` = `pg_advisory_xact_lock(hashtextextended(userId, 0))` (393-395, 411). **That is the only lock.** Inside it, four reads (415-432): this user's invitation status, count of CONFIRMED assignments **for the request**, whether this user is already CONFIRMED on it, count of this user's CONFIRMED assignments overlapping the window. `confirmBlockers` (`domain/assignment.ts:80-90`): `request_not_published`, `request_full`, `invitation_not_accepted`, `already_assigned`, `conflicting_assignment`. Then create assignment (startsAt/endsAt copied from request; **no rate copied**), history row, audit scoped SELF, and if `confirmedCount + 1 >= headcount` set FILLED and withdraw remaining offers (479-500), then event (502-514).

What is not locked or checked: the `service_requests` row; any DB constraint on headcount; any DB time-range exclusion (comment 379-392 rejects it; indexes only `@@index([userId, startsAt, endsAt])` `schema.prisma:1104`); the practitioner's eligibility, category, consent, user status or availability blocks; the facility's `canPublish`/status; whether `startsAt` has passed. Different practitioners on the same request take different locks, so two can run concurrently, each read `confirmedCount = 0`, and both insert (details in 11 #2).

### 6.5 Assignment state machine
`CONFIRMED, CANCELLED, COMPLETED, NO_SHOW` (`schema.prisma:1117-1125`); `ASSIGNMENT_TRANSITIONS` CONFIRMED->{CANCELLED, COMPLETED, NO_SHOW}, others terminal (`domain/assignment.ts:41-47`). `@@unique([serviceRequestId, userId])` (`schema.prisma:1101`).
- CONFIRMED -> CANCELLED by the facility: `cancelAssignment` `assignment.ts:527-576`; `assignment.cancel`@FACILITY; reads status first (534) but the write (539) is an unconditional update; reopens FILLED->PUBLISHED (555-560); no event, no notification, no time guard, no check for attendance/timesheet/invoice. **No screen in the repo calls `/api/v1/assignments/:id/cancel`** (grep of `src/app`, `src/components`).
- CONFIRMED -> COMPLETED: `markAssignmentCompleted` (658-708), called from the approved-timesheet path (timesheets slice).
- CONFIRMED -> NO_SHOW or CANCELLED: `settleUnhonouredAssignment` (1016-1079) after an officer decides fault (`cancellations-sanctions/application/fault.ts:220`); NO_SHOW emits `no_show.recorded` (1063-1075).
- Every change writes `assignment_status_history` (actor and reason are NOT NULL columns, `schema.prisma:1130-1144`).
- Practitioner cannot cancel or withdraw from a confirmed assignment in this module (only the excusal path elsewhere).

### 6.6 Reads
`listInvitationsFor` (`assignment.ts:783-827`) gives the practitioner: facility name, category, specialty, shift type, rate, urgency, start/end, answer-by. It does **not** include cancellation terms, notes, facility address/LGA or headcount. `listInvitationsForRequest` (846-874) gives the facility each invitation plus `practitionerName` and, via `toInvitationView`, the **`declineReason`** (59, 62-73). `listAssignments` (913-969) returns for FACILITY scope the practitioner's name and phone and supports search by name/phone within own roster.

### 6.7 Tests
Unit: `engine.test.ts` (weights sum 100, each exclusion, every factor, cold start, ranking, ties, snapshot, `proximityTier`), `assignment.test.ts` (overlap, `isInvitationOpen`, transitions, `confirmBlockers`), `reliability.test.ts`. Integration: `matching.test.ts` (rank/explain, names for ranked and excluded, ineligible, blocked, no availability, specialty, proximity, reproducible, cold start, stored run with weights, authorisation) and `assignments.test.ts` (gate flow, multi-place, overlaps incl. **same-practitioner** race at 304-339, different practitioners not blocking each other at 341-367, history, reopen, withdrawals, notification idempotency, expiry cases, schedule lists, offers read). `tests/e2e/staffing.spec.ts` walks publish -> rank/offer -> accept -> confirm. **Untested:** two practitioners racing for the last place; invite/confirm of an ineligible or non-category user; match on a non-published request or unverified facility; absence of phone in the payload; rebooking after cancel; `expiresInHours`; shift-type/time mismatch.

---

## 7. Module: scheduling
Empty stub: directory placeholders only; `routes.ts:13` `ROUTES = []`; `permissions.ts:5` `[]`. "Schedule" is the assignment list inside matching (`GET /assignments`), rendered as `/practitioner/shifts` (tabs CONFIRMED/COMPLETED/NO_SHOW/CANCELLED, `src/app/practitioner/shifts/page.tsx:35`) and `/facility/roster` (paged table, `src/app/facility/roster/page.tsx`). `docs/module-map.md` states this on purpose. No calendar, recurrence, rota template, swap, replacement request, reminder, calendar export.

---

## 8. UI inventory for this slice
Facility console (`src/app/facility/console-layout.tsx:30-84`): Dashboard (`page.tsx`), Shifts (`shifts/page.tsx` list/publish/cancel; `shifts/new-shift-dialog.tsx`; `shifts/[id]/page.tsx` find/offer/confirm), Roster, Timesheets, Invoices, Rates and allowances, Report an incident, Staff; plus `/facility/register` (outside the guard). Cancel button only for PUBLISHED/DRAFT (`shifts/page.tsx:408`) although the API allows FILLED; the dialog says confirmed people "keep their assignment — cancel that separately" (473-475) while no screen can cancel an assignment.
Practitioner console (`src/app/practitioner/console-layout.tsx:27-70`): Overview (eligibility blockers, offers waiting, next shift, `page.tsx`), Offers (`offers/page.tsx`), My shifts, Timesheets, Earnings, My profile (details, availability, privacy, credentials tabs). Offers page tells a lapsed offer "The sweep will withdraw it shortly" (`offers/page.tsx:155-161`) but no invitation-expiry sweep exists, and tells decliners the reason "reaches the platform without your name" (84, 169) while the facility API returns the reason beside the name (6.6).
Defaults worth knowing: `rateNaira` initial `'5000'` for every profession (`new-shift-dialog.tsx:55`); `shiftType` initial DAY chosen by hand (50, 186-197); cancellation terms pre-filled with a 24-hour sentence (56-58).

---

## 9. Events and sweeps

| Event | Emitted | Handler? |
|---|---|---|
| `facility.verified` | `facility.ts:449-460` (approve only) | none (processor marks it processed, `src/worker/processor.ts:75-80`) |
| `service_request.published` | `request.ts:271-281` | none |
| `shift.invited` | `assignment.ts:157-162` (reopen), `190-195` (new) | none: practitioner is not notified of an offer |
| `shift.accepted` | `assignment.ts:261-272` | none: facility is not notified |
| `assignment.confirmed` | `assignment.ts:502-514` | `src/worker/handlers.ts:20-22` -> `notifyAssignmentConfirmed` (`notifications/application/handlers.ts:33-81`): SMS to the practitioner and to `representativeUserId` only; times formatted in UTC (21-27); idempotent via `alreadyNotified` |
| `no_show.recorded` | `assignment.ts:1063-1075` | none |
| no event at all | facility rejection, request cancelled/filled/expired, invitation declined/withdrawn, assignment cancelled/completed | audit rows only |

Sweeps relevant here (`src/worker/jobs.ts`): `service_request.expiry_sweep` hourly (`expireStartedRequests`); `assignment.unhonoured_sweep` hourly reads `listEndedConfirmedAssignments` (`assignment.ts:1000-1006`). None for invitation lapse, facility licence expiry, stale drafts, reminders.

---

## 10. EXISTS vs DOES NOT EXIST (explicit)

| Concept | State | Evidence |
|---|---|---|
| Profession category + optional specialty on request | EXISTS | `schema.prisma:925-926`; validated `request.ts:139-151` |
| Shift type DAY/NIGHT | EXISTS, hand-picked | `presentation/schemas.ts:24`; UI default DAY `new-shift-dialog.tsx:50`; no function derives it from the times |
| Window, headcount, one hourly rate (kobo), urgency | EXISTS | schema 928-941 |
| Urgency changing behaviour | NOT PRESENT (display only) | not read in `engine.ts` or `match.ts` |
| Professional level / cadre / seniority / grade | NOT PRESENT | grep of schema and the five modules finds none |
| Supervision requirement or supervisor role on a shift | NOT PRESENT | (`SUPERVISOR_CODE` is a check-in method only, `schema.prisma:1261`) |
| Per-person rate on assignment | NOT PRESENT | `Assignment` has no rate (`schema.prisma:1079-1115`); timesheets read `request.hourlyRateKobo` at compute time (`timesheets/application/timesheet.ts:122, 142`) |
| Counter-offer / negotiation | NOT PRESENT | no entity; invitations carry no terms |
| Practitioner-initiated application | NOT PRESENT | no route, table or UI; `shift_applications` of v2.9 does not exist |
| Practitioner browse of open shifts | NOT PRESENT | list route is facility/platform scoped |
| Practitioner availability LISTING with price/visibility | NOT PRESENT | slots carry only time windows |
| Direct / instant booking | NOT PRESENT | assignment only via accepted invitation + facility confirm |
| Facility-level pay multipliers (night, holiday, overtime, on-call) | EXISTS elsewhere | `RateCard` `schema.prisma:1793-1801` (billing slice) |
| Rate floors per category/specialty/shift type | EXISTS | `config.rate_floors`, `domain/rate-floor.ts` |

---

## 11. VERIFICATION AT HEAD of the claimed issues

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 1 | Matching returns name+phone for all candidates, incl. excluded | **CONFIRMED** | Types `match.ts:37-45`; built 170-179; users fetched 160-166. Test asserts names for excluded (`tests/integration/matching.test.ts:263-285`); nothing asserts phones are absent |
| 2 | Confirm locks only the practitioner so two practitioners can fill the last slot | **CONFIRMED** | Lock keyed on `userId` only (`assignment.ts:393-395, 411`); `confirmedCount` read inside the lock but from a table nobody locked (420); default isolation, no row lock, no DB cap (schema 1079-1115). Two different users -> two different locks -> both read the same count -> both `tx.assignment.create` (444). Consequence beyond overbooking (inferred from code, untested): with headcount 2 and two concurrent confirms, each sees `0 + 1 >= 2` false (479) so the request is **never set FILLED**, stays PUBLISHED at 2/2, and the sweep later marks it EXPIRED. The test at `assignments.test.ts:341-367` runs this exact two-practitioner concurrent case but asserts only that both succeed |
| 3 | Invites/confirms don't re-check eligibility/category/consent | **CONFIRMED** | `invitePractitioners` 91-202 and `confirmAssignment` 404-518 and `respondToInvitation` 211-276 contain no eligibility, category, consent, user-status or facility-status check (grep for eligib/consent/category in the file returns only list-view fields at 764-818). Invitation has no FKs, so any UUID can be invited (schema 1046-1064) |
| 4 | Matching doesn't require a published request or verified facility | **CONFIRMED** | `runMatch` calls `getServiceRequest` (`match.ts:64`, which does not look at status, `request.ts:198-207, 335-340`) then reads the facility columns only (69-72). A DRAFT can be created by an unverified owner (`request.ts:126-196` calls `getFacility` for existence only), and the shift page shows "Find candidates" for any status (`shifts/[id]/page.tsx:312-321`). A lapsed or suspended facility's already PUBLISHED request also stays matchable/inviteable/confirmable |
| 5 | Cancelling a filled request leaves assignments live | **CONFIRMED** | `cancelServiceRequest` withdraws invitations only (`request.ts:305-317`); no assignment write. The UI dialog says so (`shifts/page.tsx:473-475`). UI hides Cancel for FILLED (408) although `TRANSITIONS` allows it (`domain/request.ts:37`) |
| 6 | Shift type is manually picked, not derived from times | **CONFIRMED** | `shiftType: z.enum(['DAY','NIGHT'])` (`presentation/schemas.ts:24`), UI Select (`new-shift-dialog.tsx:186-197`); floor lookup keys on it (`request.ts:84-109`). Billing separately classifies minutes by walking the clock (other slice) |
| 7 | Expiry sweep marks a half-filled request EXPIRED | **CONFIRMED** | A request stays PUBLISHED until the count reaches headcount (`assignment.ts:479-483`); sweep picks every PUBLISHED with `startsAt <= now` (`expiry.ts:26`) and sets EXPIRED (37-40). Assignments already confirmed are untouched and the request's status then misreads as "unfilled". The integration test covers only 0-filled and fully-filled (`assignments.test.ts:770-857`) |
| 8 | Invitation expiry is a flat 24 h and 'expired' is never written | **PARTLY** | 24 h default is flat (`domain/assignment.ts:15`, `assignment.ts:98-100`), not tied to shift start or urgency; but the API accepts `expiresInHours` 1-168 (`presentation/schemas.ts:395`; UI never sends it). `EXPIRED` is never written (only read, `assignment.ts:125`); lapse is evaluated at read time (`isInvitationOpen`), so lapsed rows sit as INVITED until the request closes. ACCEPTED offers never expire |
| 9 | Uniqueness (request,user) blocks rebooking after cancel | **CONFIRMED** | `@@unique([serviceRequestId, userId])` on Assignment (`schema.prisma:1101`); `alreadyAssigned` counts only CONFIRMED (`assignment.ts:421-423`) so the blockers pass and `tx.assignment.create` (444) hits P2002, which no code catches; `handleError` maps non-HttpError to a 500 `internal_error` (`src/lib/http/responses.ts:30-38`). Re-inviting such a person is a no-op because their invitation is still ACCEPTED (`assignment.ts:122-131`) |
| 10 | REJECTED facility is a dead end | **CONFIRMED** | No transition out (3.3). Licence change resets only VERIFIED (`facility.ts:352`); verify requires PENDING (410); `cacNumber` is not editable (`updateFacilitySchema`, `schemas.ts:117-132`); re-registering with the same CAC hits the unique constraint -> `duplicate_cac_number` (`facility.ts:246-252`). `docs/stage-5-10-facility-verification.md` ("no route back except by changing the licence") is wrong for REJECTED |
| 11 | CAC not normalised at self-registration | **CONFIRMED** | `registerFacilitySchema.cacNumber` has no transform (`presentation/schemas.ts:91`) vs the ops schema (24-32); stored raw (`facility.ts:202`); no test hits the register route |
| 12 | No screen uploads a facility licence; approval allowed without one | **CONFIRMED** | API exists (`licence-upload-url` route, `facility.ts:480-525`); no UI references it (grep `src/app src/components` finds only the admin *download* at `facility-detail.tsx:205`). `verifyFacility` has no licence check (`facility.ts:399-464`); admin UI warns but allows (`facility-detail.tsx:208-211`; the Decide card at 243 shows for any PENDING facility) |
| 13 | No facility suspend action or licence-expiry sweep | **CONFIRMED** | No writer of SUSPENDED (3.3); `src/worker/jobs.ts:31-68` has no facility job. Only the read-time `licence_expired` blocker exists (`domain/facility.ts:51`), and it is inert for UI-registered facilities because no UI sends `licenceExpiresAt` |
| 14 | CAC mandatory though government hospitals/PHCs have none | **CONFIRMED** | Column NOT NULL + unique (`schema.prisma:567`); self-register schema `min(3)` (`schemas.ts:91`), UI requires >= 3 chars (`register/page.tsx:82`) |
| 15 | No pharmacy/maternity-home facility type | **CONFIRMED** | Seven seeded types only (`prisma/seed.ts:194-203`); no migration adds others (`prisma/migrations/` has five folders) |
| 16 | Last owner can revoke themselves | **CONFIRMED** | `assertMayRevoke` returns immediately for non-PLATFORM scopes (`src/modules/auth/application/grants.ts:246`); `assertNotTheLastWhoCanAppoint` likewise (291). Also `revokeGrant` looks the grant up by id only (313-318) and the route takes scope from the body (`src/app/api/v1/grants/[id]/revoke/route.ts:25`), so the scope the guard approves is never compared to the grant's own scope: a facility owner could revoke another facility's grant by UUID (same finding as redesign item 1; code-reading only) |
| 17 | Matching reads the facility table directly | **CONFIRMED** | `prisma.facility.findUniqueOrThrow` in `match.ts:69-72`. Same pattern elsewhere: `notifications/application/handlers.ts:44-51` reads `facility` and `assignment`; `assignment.ts:92, 405` read `serviceRequest` directly and 790-803 join `facility`. Plus a circular import: `request.ts:7` and `expiry.ts:4` import matching; `match.ts:4` imports service-requests |
| 18 | Availability "all day" impossible (23:59 gap) | **ALREADY FIXED at the API, still true in the UI (PARTLY)** | API: `endMinute` max 1440 (`availability/presentation/schemas.ts:22-23`, rationale 11-21), covered by `availability.test.ts:209-250`; display code renders "All day" for 0..1440 (`availability-section.tsx:203-204`). UI: only `<input type="time">` (153-168) and `toMinute` (51-54), which cannot yield 24:00; 00:00 to 00:00 is refused as empty (`availability.ts:103-105`); 00:00 to 23:59 leaves the one-minute hole. No "all day"/"every weekday" shortcut |
| 19 | Availability has no rate/level/visibility/expiry | **PARTLY** | No rate, level, visibility, status (schema 863-889). Recurring slots do have `effectiveFrom/Until` (873-874, domain 82-83) but only the API sets them; one-off slots exist but no UI creates them. Nothing prunes old slots or blocks |
| 20 | Whole category loaded into memory per matching run | **CONFIRMED** | `listMatchCandidates` unpaginated (`candidates.ts:49-60`); eligibility and consent batched over all ids (65-68); `availabilityForWindowBatch` loads every slot and every block of every id (`availability.ts:277-280`); assignments queried for all ids (`match.ts:86-111`); all N written back per run (194-217). The 6.3 doc admits it ("Paging the candidate pool", `docs/stage-6-3-6-4-matching.md`) |

---

## 12. Gaps in this slice that `docs/redesign-recommendations-2026-10-13.md` did NOT mention

(Checked by keyword search of the redesign doc and by reading its facilities/service-requests/availability/matching sections, lines 330-365. Items it covers only in passing are marked "adjacent".)

1. **The overbooking race also prevents FILLED** at headcount > 1 (11 #2), so a fully staffed shift later shows EXPIRED. Doc says only "overbooking".
2. **Match payload leaks more than name and phone.** Excluded rows carry named reasons such as `blocked`, `unavailable`, `already_assigned`, `not_eligible`, which reveal a named person's calendar, other commitments and verification state to any facility holder; factor `detail` reveals years of experience, home proximity tier and hours worked this week (`engine.ts:94-102, 194-217`; `match.ts:170-179`).
3. **Decline reasons are not anonymous at the API.** `GET /service-requests/:id/invitations` returns `declineReason` beside `practitionerName` (`assignment.ts:59, 62-73, 870-873`), while the practitioner UI promises the reason "reaches the platform without your name" (`offers/page.tsx:84, 169`). (The facility page does not render it, but the data is delivered. The redesign doc calls decline anonymisation "good", line 428.)
4. **Practitioner decides blind on contract terms.** The offer card omits cancellation terms, notes (ward/instructions), facility address/LGA and headcount (`assignment.ts:762-771, 790-803`), though the dialog calls the terms "what a dispute turns on" (`new-shift-dialog.tsx:237-242`). Doc mentions only premiums.
5. **No screen can cancel an individual assignment** (route exists, `assignments/[id]/cancel/route.ts`), and the cancel-shift dialog tells users to do exactly that. Cancelling an assignment emits no event and notifies nobody; it has no time guard and an unconditional write (`assignment.ts:530-543`). Adjacent to doc item 16 (cascade).
6. **Confirm and invite ignore the clock.** Nothing checks `startsAt > now` after publish, so a started shift can be invited, accepted and confirmed until the hourly sweep (`assignment.ts:96, 404-442`; `domain/assignment.ts:80-90` has no time blocker). Adjacent to "offers must expire before the shift".
7. **An accepted offer never goes stale and is not re-validated.** Confirm days later ignores blocks added after acceptance, availability changes, credential expiry and user suspension; only overlap with other CONFIRMED assignments is checked (`assignment.ts:415-442`).
8. **Travel-preference exclusion can be silent and total.** A SAME_LGA practitioner can never match a facility with no LGA (LGA optional at registration, `schema.prisma:570`, `register/page.tsx:174`; `proximityTier` `engine.ts:260-274`), and the default SAME_STATE preference excludes every practitioner who left `homeStateId` empty (optional, `practitioners/presentation/schemas.ts:34`; default `schema.prisma:479`), under the reason `travel_preference`.
9. **Availability is default-deny and the UI only builds weekly patterns.** A practitioner with no pattern is never offered anything; "I am free tonight" (ONE_OFF) is API-only (`availability-section.tsx:93-98`). Doc says "one slot per day per request" but not the one-off gap.
10. **Facility renaming after verification needs no review** (`facility.ts:344-352`), yet practitioners identify the facility by `name` in offers (`assignment.ts:802, 816`). A verified facility can present itself under another institution's name.
11. **`representativeUserId` is immutable and is the only notification target** (`handlers.ts:44-47, 72-80`, comment "once staff management lands"). Staff management has landed (grants), so other owners/administrators are never told; revoking the representative's grant leaves them as the recipient. No route changes the representative.
12. **Facility audit visibility.** Invitations, confirmations and assignment cancellations are audited at SELF scope of the practitioner (`assignment.ts:178-188, 467-475, 562-572`), so a facility reading its own FACILITY-scoped trail sees `service_request.*` and `matching.run` but not its own invitations/confirmations/cancellations. Deliberate for the practitioner's benefit, with that consequence.
13. **Domain table vs code disagreement** on FILLED->PUBLISHED (4.3), and two different "filled" counts (4.4).
14. **Re-inviting a decliner (or an accepted-then-cancelled person) is a silent no-op** while the UI reports success (`assignment.ts:128-131`, `shifts/[id]/page.tsx:176`).
15. **UI promises a sweep that does not exist** ("The sweep will withdraw it shortly", `offers/page.tsx:159`); the only thing that withdraws a lapsed offer is the request closing.
16. **Licence expiry is never captured by the self-registration UI**, so the existing `licence_expired` blocker cannot fire for those facilities; and a lapse never touches already PUBLISHED requests (11 #4, #13).
17. **Ops cannot publish or cancel a request on a facility's behalf** (`administrator` lacks `service_request.publish`, permissions.ts `ADMINISTRATOR`) but can run match, invite and confirm for any facility (names/phones platform-wide).
18. **Self-registration throttle is weak**: one PENDING per user only (`register/route.ts:37-46`); unlimited REJECTED/VERIFIED registrations and free-text CAC numbers.
19. **No test covers self-registration at all**, nor the two-practitioner race at headcount 1.

---

## 13. Documentation drift (code is the truth)
- `docs/stage-5-10-facility-verification.md`: "there is no self-service facility signup" (false: `register/route.ts`); "no route back to PENDING except by changing the licence" (false for REJECTED); "operations_officer gained facility.write" (role retired); staff management "not in this cut" (grants and `/facility/staff` exist). Same stale comment in `src/modules/facilities/permissions.ts:5-7`.
- `docs/stage-6-1`: FILLED and EXPIRED "nothing reaches them yet" (both reachable now). `docs/stage-6-3-6-4`: reliability "nothing completes an assignment until Stage 7" (Stage 7 exists). `docs/stage-6-5-6-6-6-7`: "A user interface: not in this stage" (UI exists).
- `docs/stage-9-5-suggestion-log.md`: grants `suggestion.submit`/`triage` to `operations_officer` (retired; now `administrator`).

---

## 14. Tests present (summary)
Unit: `src/modules/facilities/domain/facility.test.ts`; `src/modules/service-requests/domain/request.test.ts`; `src/modules/availability/domain/availability.test.ts`; `src/modules/matching/domain/{engine,assignment,reliability}.test.ts` (+ snapshot `__snapshots__/engine.test.ts.snap`). Integration (real DB): `tests/integration/{facility-verification,service-requests,availability,matching,assignments}.test.ts`, plus `expiry.test.ts` (credentials/registrations, not requests). E2E: `tests/e2e/{staffing,multisite}.spec.ts`. Gaps listed in 3.7, 4.6, 6.7.

---

## 15. v2.9 spec vs code
Spec file: `/tmp/claude-0/-home-user-medilink-platform/b230a556-c6b8-540a-a669-4d8b20a4f1a2/scratchpad/v29/v29.md` (cited as `spec:LINE`). Verdicts: IMPLEMENTED / PARTLY / MISSING / DIVERGES.

### Module 4 — Healthcare Facility Management (spec:420-444)
| Spec requirement | Verdict | Evidence |
|---|---|---|
| Legal/trading names, CAC registration, facility licence (spec:424) | PARTLY | single `name` (no legal vs trading); CAC number only, unverified text; licence number/expiry/one document; `schema.prisma:561-584` |
| Facility type, ownership type, state/LGA, physical address (426) | PARTLY | type, state, LGA (optional), address present; **no ownership type** (grep finds none); `schema.prisma:564-571` |
| Multiple branches and departments (428) | MISSING | no tables; `BRANCH`/`DEPARTMENT` scope values unused, no route resolves them (`schema.prisma:144-145`; `docs/stage-5-10-...`) |
| Authorised representatives, billing contacts, shift supervisors (430) | PARTLY | exactly one `representativeUserId` (`schema.prisma:576`); extra staff via `facility_owner`/`facility_administrator` grants (`staff/page.tsx:12-25`); no billing-contact or supervisor role (old scheduler/finance roles retired, `permissions.ts` `RETIRED_ROLES`) |
| Facility verification, suspension, risk flags (432) | PARTLY | verification yes (`facility.ts:399-464`); SUSPENDED state exists but nothing writes it; no risk flags |
| CAC checked against CAC public search with result and retrieval date stored as evidence (434) | MISSING | no lookup, no evidence columns; verification is an unrecorded human check (`docs/stage-5-10-...` "CAC registry lookup ... deferred") |
| Licence uploaded and reviewed by compliance; no publish until both checks pass (436) | DIVERGES | upload is API-only with no UI (11 #12); approval permitted without a licence (`facility.ts:399-464`); the gate is one `VERIFIED` flag, not two checks (`domain/facility.ts:34-56`) |
| At least one representative verified by NIN and phone (438) | MISSING | representative is any registered user; no NIN check on facility reps; self-registrant is auto-owner while PENDING (`facility.ts:194, 224-232`); deferred per `docs/stage-5-10-...` |
| Physical address confirmed at first engagement by first practitioner (440) | MISSING | no field, flow or screen (grep for first-engagement/address-confirm finds nothing) |
| Data tables facility_branches, departments, facility_users, facility_documents, facility_verifications (444) | MISSING | only `facilities` plus `stored_objects`; verifier/date/notes are columns on the facility row (`schema.prisma:589-591`) |

### Module 5 — Practitioner Availability (spec:446-460)
| Requirement | Verdict | Evidence |
|---|---|---|
| Available dates/times, recurring availability, blocked periods (450) | IMPLEMENTED (UI PARTLY) | slots and blocks `schema.prisma:863-916`, logic `domain/availability.ts`; UI builds weekly slots and blocks only, no one-off (`availability-section.tsx:93-98`) |
| Preferred states, LGAs (452) | PARTLY | one home state/LGA only (`schema.prisma:474-475`), no preferred list |
| Maximum travel distance (452) | DIVERGES | three tiers SAME_LGA/SAME_STATE/ANYWHERE, no distance (`schema.prisma:844-851`; `engine.ts:20-21`; "Travel radius in kilometres" deferred, `docs/stage-6-2-availability.md`) |
| Day, night, weekend, public-holiday preferences (454) | MISSING | no fields; only raw time windows; holidays exist as config (`schema.prisma:406-417`) but are not used by availability or matching |
| On-call availability (456) | MISSING | none in slots; on-call exists only as a pay multiplier and timesheet minutes (`schema.prisma:1312, 1801`) |
| Calendar conflict detection (456) | PARTLY | conflict is checked against CONFIRMED assignments at match and confirm (`match.ts:93-102`; `assignment.ts:424-431`), not within availability; overlapping own slots simply merge |
| Maximum working-hours controls (458) | MISSING | no practitioner-set cap; platform fatigue is a soft score only (`engine.ts:179-181`) |
| Data availability_rules, location_preferences (460) | MISSING | only `availability_slots` and `blocked_periods` |

### Module 6 — Service Request and Shift Management (spec:462-478)
| Requirement | Verdict | Evidence |
|---|---|---|
| Facility, category, specialty (466) | IMPLEMENTED | `schema.prisma:924-926`; specialty-in-category check `request.ts:144-151` |
| Branch, department (466) | MISSING | no columns (`schema.prisma:922-967`) |
| Number required, shift date/time (468) | IMPLEMENTED | `headcount` 1-50, window <= 24 h (`domain/request.ts:14-16`) |
| Responsibilities (468) | PARTLY | only free-text `notes` (`schema.prisma:942`) |
| Minimum experience (470) | MISSING | no field; experience is a ranking factor only (`engine.ts:174-175`) |
| Required credentials per request (470) | MISSING | credential requirements are per professional category (`config.credential_requirements`), not per request |
| Rate (472) | PARTLY | one hourly kobo rate, floor-checked at create and publish (`request.ts:153-164, 223-229`); no daily/fixed-shift unit |
| Allowances, accommodation/transport (472) | MISSING | not on request; facility `RateCard` multipliers cover night/holiday/overtime/on-call only (`schema.prisma:1798-1801`) |
| Cancellation terms (474) | IMPLEMENTED | required text (`presentation/schemas.ts:33`); not shown to practitioners (`assignment.ts:762-771`) |
| Application deadline (474) | MISSING | no field; only per-offer `expiresAt` and the shift start |
| Urgency level (474) | PARTLY | stored and badged; changes no behaviour (not read in matching) |
| Statuses Draft, Published, Matching, Partially filled, Filled, In progress, Completed, Cancelled, Disputed (476) | DIVERGES | code has DRAFT, PUBLISHED, FILLED, CANCELLED, EXPIRED (`schema.prisma:986-996`); no Matching, Partially filled, In progress, Completed, Disputed; EXPIRED is an addition; partial fill is only a derived count (`service-requests/route.ts:41-44`) |
| Data shift_positions, shift_requirements, shift_rates, request_status_history (478) | MISSING | one `service_requests` row; no history table (audit rows only); `assignment_status_history` exists for assignments (`schema.prisma:1130-1144`) |

### Module 7 — Matching and Assignment (spec:480-494)
| Requirement | Verdict | Evidence |
|---|---|---|
| Filter: active licence | IMPLEMENTED | `eligibilityBlockers` `practitioners/domain/eligibility.ts:52-103`, applied in `candidates.ts:83` |
| Filter: category, specialty | IMPLEMENTED | `engine.ts:137-146`; pool pre-filter `candidates.ts:49-52` |
| Filter: experience | DIVERGES | scored (30 pts, cap 10 y) not filtered; no minimum (`engine.ts:174-175`) |
| Filter: availability | IMPLEMENTED | `engine.ts:148-149`; whole-shift cover `domain/availability.ts:145-154` |
| Filter: location/travel time | PARTLY | tier proxy and travel-preference exclusion; no travel time (`engine.ts:153-158, 260-274`) |
| Working-hour and fatigue limits (486) | PARTLY | soft 20-pt score over trailing 168 h of CONFIRMED hours; no hard limit, no rest rule (`match.ts:35, 103-119`) |
| Facility preferences (486) | MISSING | no facility-side preference input to ranking |
| Prior reliability (486) | IMPLEMENTED | `reliabilityFrom` + 15-pt factor (`reliability.ts:27-31`; `engine.ts:183-186`) |
| Cold start: neutral until five completed assignments (488) | IMPLEMENTED | `COLD_START_ASSIGNMENTS = 5`, `NEUTRAL_RELIABILITY = 0.5` (`engine.ts:52, 63`); tests `engine.test.ts:179-227` |
| Reliability always displayed with the number it rests on (490) | PARTLY | factor detail shows completed count, e.g. "neutral: 2 of 5 assignments completed" or "N assignments completed" (`engine.ts:214-218`), truncated in the UI with tooltip (`shifts/[id]/page.tsx:381-383`); the no-show count/denominator is not shown, and the ratio itself is not displayed |
| Workflow: identify -> invite -> practitioners apply/accept -> facility reviews -> confirms -> final confirmation (492) | PARTLY | identify (`match.ts`), invite, accept, confirm all exist; **"apply" is absent**; final confirmation is an SMS via the outbox (`handlers.ts:20-22`), invitation itself sends nothing |
| "Never simply the first to click accept" (482) | IMPLEMENTED | accepting creates no assignment; `invitation_not_accepted` blocker and facility confirm (`domain/assignment.ts:80-90`; `assignment.ts:259-261`); invitations are hand-chosen (84-90). (But the facility may still confirm in click order; nothing compares to rank) |
| Data match_results, shift_invitations, assignments, assignment_status_history (494) | IMPLEMENTED (names differ) | `match_runs`/`match_candidates`, `invitations`, `assignments`, `assignment_status_history` (`schema.prisma:1004-1144`) |
| Data shift_applications (494) | MISSING | no table |
| §9.15 acceptance (spec:866): confirm only if facility active and verified | MISSING | confirm never consults the facility (`assignment.ts:404-442`) |
| §9.15: practitioner eligible at confirm | MISSING | eligibility evaluated only at match time |
| §9.15: no schedule conflict | IMPLEMENTED | `assignment.ts:424-431` under the practitioner lock |
| §9.15: rate and terms accepted | DIVERGES | accepting an offer is the only acceptance; terms are not shown to the practitioner and no acceptance of terms is recorded |
| §9.15: notifications queued, audit event written | IMPLEMENTED | `publishEvent` and `recordAudit` inside the confirm transaction (`assignment.ts:467-514`) |

### Module 8 — Scheduling and Calendar (spec:496-508)
| Requirement | Verdict | Evidence |
|---|---|---|
| Practitioner and facility calendars with recurring shifts (500) | MISSING | scheduling module is empty (`scheduling/routes.ts:13`); schedules are lists (`practitioner/shifts/page.tsx`, `facility/roster/page.tsx`); recurring shifts deferred (`docs/stage-6-1`: "Every Saturday night is six separate requests") |
| Conflict detection (502) | PARTLY | transactional per practitioner at confirm only (`assignment.ts:393-442`); no calendar-level detection |
| Rescheduling (502) | MISSING | requests are immutable once published; no move/reschedule route |
| Replacement requests (502) | MISSING | no entity; a facility cancel reopens FILLED->PUBLISHED, an implicit re-fill (`assignment.ts:555-560`) |
| Shift reminders (504) | MISSING | no reminder job or handler (`src/worker/jobs.ts`, `src/worker/handlers.ts`) |
| Calendar export (504) | MISSING | no .ics or feed (grep) |
| Nigerian public-holiday configuration (506) | PARTLY | `config.public_holidays` seeded with six fixed 2026 dates (`prisma/seed.ts:253-262`); used only by timesheets/pricing, not scheduling |
| WAT default display, UTC stored (506) | PARTLY | storage UTC and display `Africa/Lagos` (`src/components/app/format.ts:7-17`); but SMS confirmations print UTC (`notifications/application/handlers.ts:21-27`) and `datetime-local` inputs follow the browser time zone (`new-shift-dialog.tsx:79-80`) |
| Data schedules, schedule_occurrences, schedule_changes, reminders (508) | MISSING | none |

### §8.7 Configurable workflow engine (spec:276-284)
| Requirement | Verdict | Evidence |
|---|---|---|
| Allowed transitions stored in configuration | DIVERGES | transitions are hard-coded constants (`domain/request.ts:32-40`; `domain/assignment.ts:41-47`); no workflow table |
| Standard doctor shift: Published -> Applied -> Facility Approved -> Confirmed | DIVERGES | built flow is Published -> Invited -> Accepted -> Confirmed; no Applied/application step |
| Emergency shift: Published -> Automatically Matched -> Practitioner Confirmed | MISSING | no automatic matching (human review is mandatory by design, `docs/stage-6-3-6-4-matching.md` "Automatic matching" not built); EMERGENCY urgency has no distinct path |
| Long-term contract: Application -> Interview -> Compliance Review -> Contract -> Confirmed | MISSING | no such flow; `rates-contracts` holds rate cards only |

### §9.16 Matching controls (spec:878)
| Control | Verdict | Evidence |
|---|---|---|
| Distance and travel-time calculation | DIVERGES | LGA/state tier proxy, no coordinates or travel time (`engine.ts:255-274`; `docs/stage-6-3-6-4-matching.md` "Real distances" deferred) |
| Location privacy | PARTLY | only coarse home state/LGA is stored (`schema.prisma:474-475`) and no location is returned; but proximity tier and name/phone leak in the payload (`match.ts:170-179`) |
| Recurring availability expansion | IMPLEMENTED | `expandRecurring`, `mergeWindows` (`domain/availability.ts:60-118`), WAT-aware, tested |
| Transactional conflict detection | IMPLEMENTED | advisory lock + in-transaction overlap count (`assignment.ts:393-432`); concurrent same-practitioner test `assignments.test.ts:304-339` |
| Race handling when two facilities select the same practitioner | PARTLY | confirm is serialised per practitioner so one wins and the other gets `conflicting_assignment`; invitations are not exclusive, no soft hold, loser's accepted offer stays ACCEPTED and nobody is told. The other race (two practitioners, one slot) is unhandled (11 #2) |
| PostgreSQL time-range exclusion constraints | MISSING | explicitly declined (`assignment.ts:379-392`); only a btree index (`schema.prisma:1104`) |
| Ranking reasons | IMPLEMENTED | per-factor `raw/points/detail` returned and stored (`engine.ts:94-102`; `match.ts:194-208`; `getMatchRun` 259-288) |
| Eligibility-exclusion reasons | PARTLY | named exclusion reasons returned and stored (`engine.ts:11-18`; `match.ts:210-217`), but eligibility collapses to one `not_eligible`; the specific blockers (`identity_unverified`, `credential_expired`, ...) are not carried into the run |
| Practitioner appeal route for inaccurate reliability data | MISSING | no appeal entity, route or screen (grep for "appeal" finds only data-subject-request comments) |
| Fatigue rules for overnight/consecutive shifts | PARTLY | soft score only; back-to-back allowed by design (`domain/assignment.ts:25-32`; `assignments.test.ts:278-302`); no minimum rest, no forward look, COMPLETED hours drop out (`match.ts:103-107`) |

### §11.1 Launch operating model (spec:950-958)
| Requirement | Verdict | Evidence |
|---|---|---|
| Launch in one state first | PARTLY | operational choice; all 36 states, the FCT and 774 LGAs are seeded (`prisma/seed.ts:214-229`); no state gating (no feature-flag/state switch in code) |
| Recruit and verify practitioners before facilities; >= 50 verified across 2-3 specialties | MISSING in code | operational target; no readiness dashboard or counter exists (admin dashboard shows queue counts and registration growth only, `src/app/admin/page.tsx:61-67, 180-182`; `platform-summary.ts:42`) |
| First fifty engagements hand-matched by operations staff | DIVERGES | the platform never invites automatically (`assignment.ts:84-90`; invite route doc), but the person choosing is the facility's own user holding `assignment.confirm`, not operations staff; no "first 50" counter or enforcement |
| Do not open a second state until fill rate is sustained >= ~70% (published requests that result in an attended shift) | MISSING | no platform fill-rate metric; the facility chart shows needed vs confirmed per week (`src/modules/audit-compliance/application/facility-summary.ts:22, 60`), not attended; `/admin/performance` reports route latency only (`src/app/api/v1/admin/performance/route.ts`) |
| First-month signals: fill rate; publish-to-confirmed time; approval-to-paid time; verification turnaround; second-shift practitioners; repeat facilities | MISSING | none of these are computed anywhere (grep for fill rate/turnaround finds nothing); `createdAt/publishedAt` and assignment `createdAt` exist, so the data is derivable |
