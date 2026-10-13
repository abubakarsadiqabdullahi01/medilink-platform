# Study 4 — Delivery and trust after the shift (fact sheet)

Slice: attendance, timesheets, cancellations-sanctions, disputes, clinical-incidents (reporting/closure side), suggestions.
Repo: /home/user/medilink-platform at HEAD `5c199c1`. Read-only study. Nothing was run (no tests, no app, no database): "CONFIRMED" means "read in the code at HEAD", not "observed at runtime". Where a conclusion rests on reasoning over two code paths (a race, a state combination) it is marked **by reading**.

Conventions: `file:line` paths are relative to the repo root. `as built` = what the code does. `gap` = what it does not do. Module numbers in code comments (Module 9 attendance, 10 timesheets, 13 cancellations, 14 disputes, 15 incidents, 18 suggestions) follow an older spec numbering; the v2.9 spec numbers differ (see section 8).

---

## 0. Cross-cutting facts that every module below relies on

### 0.1 Authorisation shape
- Every route goes through `handleGuardedRequest` (`src/lib/http/guarded-handler.ts:150-156`): session -> zod parse (route params merged last, so the URL id wins, `:67-71`) -> step-up check -> `requirePermission(userId, permission, scope(input))` -> action.
- `isAuthorized` (`src/lib/authz/guard.ts:45-71`): a PLATFORM grant satisfies any requested scope (`:55`); a SELF request is refused unless `requested.id === actingUserId` (`:62`); a FACILITY-scoped grant can never satisfy a SELF request.
- **Consequence 1:** the guard proves the scope the caller *claims*. A SELF route that passes `scope: (_, session) => SELF(session.userId)` always passes the guard. Whether the record in the path belongs to the caller is a separate, per-function check. Some functions do it (`submitTimesheet` `timesheet.ts:188`, `reviewTimesheet` `:247`, `correctTimesheet` `:344`, `requestExcusal` `excusal.ts:66`, `getAssignmentInScope` `matching/application/assignment.ts:633-651` used by the two read routes), some do not (see 3 and 5).
- **Consequence 2:** facility staff hold their grants at FACILITY scope only (`src/modules/facilities/application/facility.ts:224-231`). Any route declared SELF-scoped is unreachable for them unless they also hold a SELF grant (practitioner role) or PLATFORM.

### 0.2 Permission bundles (`src/lib/authz/permissions.ts`)
| Permission | Practitioner (`:116-122`) | facility_administrator (`:140-147`) | facility_owner (`:199`) | administrator (`:172-183`) | super_administrator (`:219`) |
|---|---|---|---|---|---|
| attendance.record | yes | yes | yes | no | yes |
| timesheet.submit | yes | no | no | no | yes |
| timesheet.approve | no | yes | yes | no | yes |
| dispute.manage | yes | no | **yes** | yes | yes |
| sanction.apply | no | no | no | yes | yes |
| incident.report | **no** | yes | yes | no | yes |
| incident.manage | no | no | no | yes | yes |
| suggestion.submit | yes | yes | yes | yes | yes |
| suggestion.triage | no | no | no | yes | yes |
| assignment.cancel | no | yes | yes | yes | yes |
| user.suspend | no | no | no | yes | yes (no code behind it except via incident close, see 6) |

Roles `compliance_officer`, `operations_officer`, `finance_officer` were retired into `administrator` (`permissions.ts:230-236`). There is no separate compliance-officer authority.

### 0.3 Events emitted by this slice and who consumes them
Handler registry: `src/worker/handlers.ts:15-52` has exactly three keys: `assignment.confirmed`, `shift.completed`, `practitioner.registered`. `processEvent` marks an event with no handler PROCESSED and logs a warning (`src/worker/processor.ts:77-86`).
| Event (`src/lib/events.ts`) | Emitted at | Handler |
|---|---|---|
| shift.started | `attendance.ts:308-318` (token check-in) | none |
| shift.completed | `attendance.ts:308-318` (token check-out) and `:405-414` (manual record) | `handlers.ts:38-40` -> `computeAndSaveTimesheet` |
| timesheet.submitted | `timesheet.ts:217-226` | none |
| timesheet.approved | `timesheet.ts:285-296` | none (billing is a manual button, not a subscriber) |
| no_show.recorded | `matching/application/assignment.ts:1063-1075` | none |
| dispute.opened | `disputes/application/dispute.ts:208-220` | none |
| clinical_incident.reported | `clinical-incidents/application/incident.ts:176-187` | none |
| sanction.applied | only by sanctions-list screening `practitioners/application/screening.ts:140`, not by this slice | none |
Emitted by nothing: timesheet rejected, timesheet corrected, dispute reviewed/resolved/withdrawn, incident reviewed/closed, suspension/reinstatement, excusal requested/decided, unhonoured flagged, assignment cancelled (`assignment.ts:527-576` publishes nothing), suggestion submitted/triaged.

### 0.4 Scheduled jobs touching this slice
`src/worker/jobs.ts:31-68` defines six jobs; one belongs here: `assignment.unhonoured_sweep`, `intervalSeconds: HOURLY` (`:28`, `:62-67`), handler `:74-76` -> `sweepUnhonouredAssignments`. The runner checks the table every 30 s (`src/worker/polling.ts:40`), claims with `FOR UPDATE SKIP LOCKED`, sets `next_run_at = now() + interval` (`scheduler.ts:36-55`). There is no sweep for: stuck CHECK_IN_PENDING / CHECKED_IN / CHECKED_OUT, unsubmitted or unreviewed timesheets, dispute age, incident age, suggestion age, suspension expiry.

### 0.5 UI inventory for the slice
| Screen | Does | Source |
|---|---|---|
| facility Roster, per-row `AttendancePanel` | issue check-in/check-out code (digits shown once), record by hand | `src/app/facility/roster/attendance-panel.tsx` |
| facility Timesheets | approve / reject (reason >= 10) / correct hours; two tabs: CONFIRMED ("awaiting decision"), COMPLETED ("approved") | `src/app/facility/timesheets/page.tsx` |
| facility Incidents | report (shift picker optional), list own, read-only detail incl. outcome and closure notes | `src/app/facility/incidents/*` |
| practitioner My shifts | enter code to check in/out (opens 3 h before start), explain an absence (excusal) after the shift | `src/app/practitioner/shifts/*` |
| practitioner Timesheets | submit; open a dispute (14-day text) on APPROVED/REJECTED | `src/app/practitioner/timesheets/page.tsx` |
| admin Unhonoured | queue + decide fault + decide excusals | `src/app/admin/unhonoured/*` |
| admin Disputes | queue, evidence tab (download), history, start review, uphold/dismiss | `src/app/admin/disputes/*` |
| admin Incidents | queue, take case, close with outcome (incl. suspend) | `src/app/admin/incidents/*` |
| admin Practitioners > standing panel | reinstate a suspended account, suspension history | `src/app/admin/practitioners/standing-panel.tsx:191-198` |
| admin Suggestions | triage + summary by area | `src/app/admin/suggestions/*` |
| every console | "Send a suggestion" dialog | `src/components/app/suggestion-dialog.tsx`, mounted `console-shell.tsx:31,298` |
**No screen exists for:** a facility to see or answer a dispute, any party to attach or read dispute evidence, any party to read a dispute outcome, a facility to cancel an assignment (the API exists), a facility to see a fault decision or report a no-show, a practitioner to report an incident, a practitioner to read a suggestion response, a facility to see the suspension of a practitioner.

---

## 1. attendance (`src/modules/attendance`)

### 1.1 Purpose and real-world need
Evidence of what actually happened on shift day, strong enough to survive a dispute months later: who was present, when, how it was verified, and whether a human overrode the record. It is also the gate between "confirmed" and "paid": nothing is invoiced unless the attendance record is APPROVED.

### 1.2 Actors, permissions, scopes
| Act | Route | Permission | Scope | Who can reach it |
|---|---|---|---|---|
| Facility issues code | POST `/api/v1/assignments/:id/attendance/token` | attendance.record | FACILITY (`input.facilityId`) | facility_administrator, facility_owner, super_admin |
| Practitioner presents code | POST `.../attendance/present` | attendance.record | SELF | practitioner |
| Facility records by hand | POST `.../attendance/manual` | attendance.record | FACILITY | as above |
| Read record + event log | GET `.../attendance` | service_request.read | SELF or FACILITY, plus `getAssignmentInScope` (`attendance/route.ts:28-37`) | party to the shift |
Route table `src/modules/attendance/routes.ts:19-50`. Schemas `presentation/schemas.ts:10-44`.

### 1.3 Entities and state machine
Tables (`prisma/schema.prisma`): `AttendanceRecord` `:1179-1213` (one per assignment, unique `assignment_id`), `CheckInEvent` `:1232-1250` (append-only log; `occurredAt` vs `recordedAt`, `method` SUPERVISOR_CODE | QR | MANUAL, `reason`, `deviceLabel`), `CheckInToken` `:1273-1289` (HMAC digest, `expiresAt`, `attempts`, `consumedAt`).

Nine states, verbatim from spec 9.16 (`domain/state-machine.ts:11-21`). Every legal move is one table (`:44-61`), entered only through `assertTransition` (`:101-103`):
```
NOT_STARTED        -> CHECK_IN_PENDING | MANUALLY_CORRECTED
CHECK_IN_PENDING   -> CHECKED_IN | NOT_STARTED | MANUALLY_CORRECTED
CHECKED_IN         -> CHECKED_OUT | MANUALLY_CORRECTED
CHECKED_OUT        -> SUBMITTED | MANUALLY_CORRECTED
SUBMITTED          -> APPROVED | REJECTED | MANUALLY_CORRECTED
APPROVED           -> DISPUTED
REJECTED           -> MANUALLY_CORRECTED | SUBMITTED | DISPUTED
DISPUTED           -> SUBMITTED | APPROVED | REJECTED
MANUALLY_CORRECTED -> SUBMITTED
```
20 legal pairs out of 81; no self-transitions; no terminal state (`:81-83`). Which code performs each move:
| Move | Code |
|---|---|
| NOT_STARTED -> CHECK_IN_PENDING | `issueCheckInToken` purpose CHECK_IN `attendance.ts:150-157,184-189` |
| CHECK_IN_PENDING -> CHECKED_IN, CHECKED_IN -> CHECKED_OUT | `presentCheckInToken` `:241-242,278-284` |
| CHECK_IN_PENDING -> NOT_STARTED | **nothing writes this** (token lapse is documented in `state-machine.ts:46-47` but no code or sweep does it) |
| any pre-approval state -> MANUALLY_CORRECTED | `recordManualAttendance` `:357-369`; `correctTimesheet` `timesheets/application/timesheet.ts:351-399` |
| CHECKED_OUT / MANUALLY_CORRECTED / REJECTED (/ DISPUTED) -> SUBMITTED | `submitTimesheet` `timesheet.ts:190,197-201` |
| SUBMITTED -> APPROVED / REJECTED | `reviewTimesheet` `timesheet.ts:254-267` (compare-and-set on `status: 'SUBMITTED'`) |
| APPROVED / REJECTED -> DISPUTED | `openDispute` `attendance.ts:470-507` (stores `preDisputeStatus`) |
| DISPUTED -> SUBMITTED (upheld) / pre-dispute state (dismissed, withdrawn) | `closeDispute` `attendance.ts:517-564`; fallback to SUBMITTED if `preDisputeStatus` is null `:537` |
Tests: exhaustive 81-pair unit test against a separately written legal list (`state-machine.test.ts:12-80`).

### 1.4 Flow as implemented
1. Facility staff press "Code to check in" (`attendance-panel.tsx:136-146`). Server: `issueCheckInToken` -> `ensureAttendanceRecord` (creates the record on first touch; requires assignment CONFIRMED, `attendance.ts:94-103`) -> for CHECK_IN guards NOT_STARTED -> CHECK_IN_PENDING (re-issuing while already pending is allowed, `:153-157`) -> in one transaction supersedes any unconsumed token for that purpose (`:169-172`), stores `HMAC-SHA256(SESSION_SECRET, "attendance:<PURPOSE>:<assignmentId>:<code>")` (`:174-182`, `domain/check-in-token.ts:44-53`), flips the record, audits (the code is never audited, `:191-200`). Returns `{code, qr, expiresAt}` once, status 201.
2. The code is a 6-digit `randomInt` (`check-in-token.ts:15,30-32`); TTL 300 s (`:23`); max 5 attempts (`:26`). The "QR" is the string `medilink://attendance/<purpose>/<assignmentId>/<code>` (`:61-67`, parsed by regex `:75-87`); same secret, same limits.
3. The facility reads the digits to the practitioner. Practitioner types them (UI box appears only from 3 hours before start, `check-in-panel.tsx:33,68-70`) -> `presentCheckInToken` (`attendance.ts:221-322`): parse (a QR payload naming another assignment/purpose is refused `:233-238`), `guardTransition` (`:242`), latest token for that purpose (`:248-251`), `evaluateCheckInToken` in order no_token / already_used / too_many_attempts / expired / mismatch (`check-in-token.ts:112-133`). On mismatch the attempt counter is incremented *before* the error is returned (`attendance.ts:263-268`). On success one transaction: consume token, update record, append CheckInEvent (`actorId` = presenter, method QR or SUPERVISOR_CODE, `deviceLabel`), audit, publish ShiftStarted/ShiftCompleted (`:272-321`). The timestamp is server time (`:240`; the route schema has no `occurredAt`).
4. Check-out repeats with purpose CHECK_OUT; the facility can only issue it while the record is CHECKED_IN (`:158-160`); check-out must be after check-in (`:244-246`).
5. Manual fallback: facility submits `checkedInAt`, `checkedOutAt`, optional `breakMinutes`, mandatory reason (zod min 10 / max 500, `schemas.ts:27-37`; service `attendance.ts:346`). Writes two MANUAL CheckInEvents (`:371-386`), sets MANUALLY_CORRECTED, audits with before/after, publishes shift.completed (`:405-414`, a previously found bug now fixed).
6. `shift.completed` -> worker computes the timesheet (section 2).
7. Practitioner, approval, dispute: see sections 2 and 4.

### 1.5 API and sweeps
Four routes above. No sweep. Read side also feeds `GET /api/v1/assignments?include=attendance` (`src/app/api/v1/assignments/route.ts:40-51`) which the rosters use.

### 1.6 Events
shift.started (no handler), shift.completed (handler -> timesheet). See 0.3.

### 1.7 Business rules with file:line
- HMAC code: `check-in-token.ts:44-53`, key `env.SESSION_SECRET` (`attendance.ts:178,255`). Digest comparison `digestsMatch` from auth otp (`check-in-token.ts:2,125`).
- Attempt limit 5: `check-in-token.ts:26,119-121`; expiry 300 s `:23,122,135-137`.
- Check-in window: **none on the server.** UI-only: 3 hours before start, no upper bound (`check-in-panel.tsx:33,68-70`).
- Manual reason: min 10 chars at the schema, non-blank at the service (`schemas.ts:35`, `attendance.ts:346`).
- Any-sign-of-attendance test used by the no-show sweep: status != NOT_STARTED (`attendance.ts:453-461`).

### 1.8 Stubbed / UI-less
- QR: payload is produced by the API but no screen renders a QR image and no screen scans one (`attendance-panel.tsx:35` holds the field, `:180` shows digits only; no QR dependency in `package.json`). Practitioner box says "or a scanned QR" (`check-in-panel.tsx:98`) but means pasting the payload.
- Device identifier: `deviceLabel` column and param exist (`schemas.ts:23`, `attendance.ts:293`); no screen sends it (grep of `*.tsx` finds none).
- Location: deliberately absent (`docs/stage-7-1-7-2-7-3-attendance.md:112-115`); no coordinates in the schema.
- Offline capture/queue: not built (doc `:94-97`).
- CHECK_IN_PENDING -> NOT_STARTED lapse: unused transition.
- Practitioner cannot enter a break; breaks arrive only through the facility's manual record or correction.

### 1.9 Tests
`state-machine.test.ts` (81 pairs + 8 cases), `check-in-token.test.ts` (21 cases: HMAC binding, expiry, attempts, QR parse), `tests/integration/attendance.test.ts` (21 cases: round trip, QR, wrong/used/expired/superseded code, other-shift payload, cancelled assignment, manual record, audit never holds the code, route table), `tests/e2e/attendance.spec.ts` (3) and `after-the-shift.spec.ts` (manual record). **Not tested:** present by a non-assignee; token/manual by a facility that does not own the shift; any server-side time window; manual times far from the shift; double present; token attempts under parallel requests.

---

## 2. timesheets (`src/modules/timesheets`)

### 2.1 Purpose and need
Turn "who checked in and out when" into a priced, reviewable record: hours, break, night/holiday/overtime/on-call minutes, amount at the agreed rate, with every correction kept. It is the facility's accept/reject point before money is raised.

### 2.2 Actors, permissions, scopes
| Act | Route | Permission | Scope |
|---|---|---|---|
| Practitioner submits | POST `/api/v1/assignments/:id/timesheet/submit` | timesheet.submit | SELF (+ assignee check `timesheet.ts:188`) |
| Facility approves/rejects | POST `.../timesheet/review` | timesheet.approve | FACILITY (+ `assignment.facilityId` check `:247`) |
| Facility corrects | POST `.../timesheet/correct` | timesheet.approve | FACILITY (+ check `:344`) |
| Read | GET `.../timesheet` | service_request.read | SELF or FACILITY + `getAssignmentInScope` |
`src/modules/timesheets/routes.ts:19-49`.

### 2.3 Entities and state machine
- `Timesheet` `schema.prisma:1297-1329`: one per attendance record (unique FK); worked/break/billable/night/overtime/holiday/on-call minutes; `hourlyRateKobo`, `amountKobo` (Int), `currency`, `revision`.
- `TimesheetRevision` `:1334-1351`: whole previous state as JSON, actor, reason, `@@unique([timesheetId, revision])`.
- **There is no separate timesheet state.** Submission, approval, rejection are the attendance record's states (`docs/stage-7-1...md:19-23`). Approval metadata lives on the attendance record (`submittedAt/By`, `reviewedAt/By`, `reviewNotes`, `schema.prisma:1189-1194`) and is **overwritten** on each review; earlier reviews survive only in the audit trail.
- Revisions: `correctTimesheet` writes the previous figures and previous check-in/out into `timesheet_revisions` (`timesheet.ts:369-389`), sets MANUALLY_CORRECTED (`:391-399`), increments `revision` (`:401-404`), audits, then recomputes (`:418`).

### 2.4 Flow as implemented
1. `shift.completed` -> `computeAndSaveTimesheet(assignmentId)` (`timesheet.ts:92-159`): needs check-in and check-out (`:95-97`); reads the **current** service-request rate (`:99-102,142`); loads holiday dates (`:104`, `holidayDatesFor` `:57-72`); keeps `onCallMinutes` from the existing row (`:110-125`); `computeTimesheet`; upsert on `attendance_record_id` (`:152-156`, race-safe). Domain refusals (`TimesheetError`) are rethrown as `AttendanceErrors.illegalTransition(status, status)` (`:126-131`), which reads "cannot move from X to X".
2. `computeTimesheet` (`domain/hours.ts:129-206`): out must be after in (`:130`); break >= 0 (`:133`); break not longer than shift (`:141`); **worked <= 1440 min** (`:147`); `billable = worked - break` (`:151`); walk every minute (`classifyMinutes` `:103-127`); scale night/holiday by `billable/total` so the break is deducted proportionally (`:161-163`); overtime = billable minus scheduled length (`:168-172`); on-call input only (`:174`); `amountKobo = round(billable * rate / 60)` (`:193`) - **base rate only**.
3. Practitioner presses Submit (only CHECKED_OUT, MANUALLY_CORRECTED, REJECTED show the button, `practitioner/timesheets/page.tsx:176-179`): `submitTimesheet` checks assignee, `guardTransition(status, SUBMITTED)`, recomputes, in one transaction sets SUBMITTED + `submittedAt/By`, audits, publishes timesheet.submitted (`timesheet.ts:179-230`).
4. Facility (UI only acts on SUBMITTED rows, `facility/timesheets/page.tsx:396,458`):
   - Approve/Reject: `reviewTimesheet` (`timesheet.ts:245-316`); reject needs notes (schema `timesheets/presentation/schemas.ts:16-27`, service `:252`); compare-and-set `updateMany where status='SUBMITTED'` (`:258-267`); audit; on approve publish timesheet.approved (`:284-296`). **After** the transaction commits, `markAssignmentCompleted` runs separately (`:305-313`; `matching/assignment.ts:658-708`, a no-op if already COMPLETED `:672`).
   - Correct: `correctTimesheet` (`:340-419`) - check-in/out/break/on-call + reason >= 10; leaves the record in MANUALLY_CORRECTED. The facility page shows no buttons for that status, so **the practitioner must resubmit before the facility can approve** (`practitioner page:176-179`, `facility page:396`).
5. Rejected -> practitioner may resubmit unchanged (REJECTED -> SUBMITTED legal) or dispute.
6. Approved -> assignment COMPLETED (reliability "completed" count, `matching/application/assignment.ts:732-755`) -> shift becomes invoiceable (`billing-settlement/application/invoice.ts:140-146` selects `status: 'APPROVED'`).

### 2.5 API and sweeps
Four routes. No sweep, no deadline, no reminder.

### 2.6 Events
shift.completed (consumed here), timesheet.submitted (no handler), timesheet.approved (no handler). No event for reject or correct.

### 2.7 Business rules with file:line
- Night window 20:00-06:00 WAT, hard-coded constants: `domain/hours.ts:27-28`, test `isNightMinute` `:89-92` (window wraps midnight). WAT offset +60 min from `availability/domain/availability.ts:15`.
- Minute-walk classifier: `hours.ts:103-127` (`holiday` by WAT calendar date `:81-87,118`; counts `night`, `holiday`, `nightNotHoliday`).
- Holiday list: table `config.public_holidays` (`schema.prisma:406-417`, no state column), seeded with **six 2026 dates only** (`prisma/seed.ts:253-262`: 1 Jan, 1 May, 12 Jun, 1 Oct, 25 Dec, 26 Dec). No Easter, Good Friday, Eid, Maulud, no 2027+. Nothing in the app writes the table (`grep publicHoliday` finds only the timesheet reader and demo seed).
- Overlap vs exclusive bands: `nightMinutes` and `holidayMinutes` stored on the sheet overlap (`schema.prisma:1307-1311`). The correct exclusive split is computed (`hours.ts:183-189`) but **never saved** (`timesheet.ts:134-144`). Billing re-derives it by subtracting *all* holiday minutes from night minutes (`invoice.ts:113-122`) - see section 7 item 6.
- Overtime: strictly beyond the request's scheduled length, no daily cap (`hours.ts:165-172`); no "approved overtime" concept.
- Break: proportional across bands (`hours.ts:155-163`).
- No weekend band anywhere in the classifier (docs and schema comments mention weekend allowances; `RateCard` has only night/holiday/overtime/on-call multipliers `schema.prisma:1798-1801`).
- Reliability formula (consumes approvals): `matching/domain/reliability.ts:27-31` `completed / (completed + noShow)`, `null` if none decided; engine weight 15 of 100 (`engine.ts:31-36`); cold start `completed < 5` scores neutral 0.5 (`engine.ts:52,63,183-186`). Cold start tests only `completed`, so a practitioner with 0 completed and any number of no-shows scores neutral.

### 2.8 Stubbed / UI-less
Practitioner cannot enter break or on-call. Facility cannot see a corrected sheet re-enter the queue without practitioner action. No notification to the practitioner on reject or correct, nor to the facility on submit (no handlers). No "timesheet entries" lines; one sheet = one shift.

### 2.9 Tests
`hours.test.ts` (21: midnight crossing, holiday, proportional break, rounding, exclusive bands sum), `tests/integration/timesheets.test.ts` (20: priced submission, reject needs reason, approval -> COMPLETED + event, foreign facility refused, two corrections with revisions intact, on-call survives recompute, cold start ends, scope refusals as 404, concurrent pricing leaves one row), `after-the-shift.spec.ts` (submit/approve/reject-without-reason). **Not tested:** failure of `markAssignmentCompleted` after commit; correction whose recompute fails; the correct-then-resubmit stall; holiday/night spanning midnight through to the *invoice* (billing tests live in `billing.test.ts`).

---

## 3. cancellations-sanctions (`src/modules/cancellations-sanctions`)

### 3.1 Purpose and need
When a confirmed shift is not honoured, someone must decide whose fault it was before a practitioner is marked as a no-show; the practitioner may explain. In v2.9 terms this module should also hold cancellation penalties, a sanction ladder and replacement search; **only the fault/excusal core exists**.

### 3.2 Actors, permissions, scopes
| Act | Route | Permission | Scope |
|---|---|---|---|
| Queue of flags | GET `/api/v1/unhonoured` | sanction.apply | PLATFORM |
| Decide fault | POST `/api/v1/assignments/:id/fault` | sanction.apply | PLATFORM |
| Practitioner asks excusal | POST `/api/v1/assignments/:id/excusals` | attendance.record | SELF (+ assignee check `excusal.ts:66`) |
| Read excusals | GET same path | attendance.record SELF (+ `getAssignmentInScope`) or sanction.apply PLATFORM (`?scopeType=PLATFORM`) |
| Officer decides excusal | POST `/api/v1/excusals/:id/decide` | sanction.apply | PLATFORM |
Held by: administrator, super_administrator only. **Facility has no route here**; the module's doc states this on purpose (`routes.ts:13-17`). Facility-side cancel is in matching: POST `/api/v1/assignments/:id/cancel`, `assignment.cancel` at FACILITY (`src/app/api/v1/assignments/[id]/cancel/route.ts`), reason min 3 (`matching/presentation/schemas.ts:57-61`) - no screen calls it.

### 3.3 Entities and state machines
- `Assignment` status (`matching/domain/assignment.ts:41-48`): `CONFIRMED -> CANCELLED | COMPLETED | NO_SHOW`; CANCELLED, COMPLETED, NO_SHOW are terminal (empty lists). Every change writes `AssignmentStatusHistory` with required actor+reason (`schema.prisma:1130-1144`).
- `UnhonouredAssignment` (`schema.prisma:1359-1387`): unique per assignment; `AWAITING_DECISION -> CLOSED`; `fault` PRACTITIONER | FACILITY | NEITHER, nullable until closed. CLOSED is final (no reopen route, `updateMany where status='AWAITING_DECISION'` `fault.ts:189-199`).
- `Excusal` (`schema.prisma:1410-1431`): REQUESTED -> GRANTED | REFUSED (`domain/fault.ts:70-81`); not unique per assignment, refusals retained.
- Close rules (`domain/fault.ts:36-56`): not already closed; fault non-null; reason >= 10 chars; granted excusal + PRACTITIONER fault is refused.
- Outcome mapping (`fault.ts:65-67`): PRACTITIONER -> assignment NO_SHOW; FACILITY or NEITHER -> CANCELLED.

### 3.4 Flow as implemented
1. Hourly `assignment.unhonoured_sweep` (`application/fault.ts:115-153`): `listEndedConfirmedAssignments(now)` = status CONFIRMED and `endsAt < now` (`matching/application/assignment.ts:1000-1006`); minus those with attendance status != NOT_STARTED (`attendance.ts:453-461`); minus already flagged (unique + skip `:123-127`); creates one `AWAITING_DECISION` row + audit with no actor (`:133-148`). It decides nothing and notifies nobody.
2. Officer opens `/admin/unhonoured`, picks PRACTITIONER / FACILITY / NEITHER with a reason -> `recordFault` (`fault.ts:170-228`): blockers `:177-183`; transaction closes the row compare-and-set + audit (`:188-216`); **then, outside that transaction**, `settleUnhonouredAssignment` writes the assignment (`:220-225`; `matching/assignment.ts:1016-1079`, publishes no_show.recorded only for NO_SHOW).
3. Practitioner may ask to be excused from the shift screen, shown only for a CONFIRMED shift that has ended or a NO_SHOW (`practitioner/shifts/page.tsx:115-118`); the request is allowed by the API for any assignment of theirs at any time or status (`excusal.ts:64-90`, no status/time check). Officer grants/refuses (`decideExcusal` `:113-179`): refusal needs notes >= 10; **grant** closes an open AWAITING flag as NEITHER via `recordFault` (`:159-176`); a grant before the sweep has run only stores the excusal and later blocks PRACTITIONER fault (`domain/fault.ts:51-53`). A grant does **not** cancel the assignment, free the place or notify the facility.
4. Reliability consumes only `NO_SHOW` (`matching/assignment.ts:732-755`, `reliability.ts:27-31`).

### 3.5 API and sweeps
Routes above; sweep `assignment.unhonoured_sweep` hourly.

### 3.6 Events
no_show.recorded (no handler). Nothing on flag, fault decision (other than no-show), excusal, or cancellation.

### 3.7 Business rules with file:line
- Fault values/outcome map `domain/fault.ts:8,12,65-67`; reason min 10 max 500 `:14-15`.
- "No-show never counted until fault decided": a NO_SHOW exists only after `recordFault` (`fault.ts:220-225`), and only PRACTITIONER fault produces it.
- Detection predicate: shift **ended** and no attendance sign (`assignment.ts:1000-1006`, `attendance.ts:453-461`).
- Cancellation terms: free text `ServiceRequest.cancellationTerms` (`schema.prisma` ServiceRequest block; required min 10, `service-requests/presentation/schemas.ts:33`); UI pre-fills "Either party may cancel up to 24 hours before the shift without penalty." (`facility/shifts/new-shift-dialog.tsx:56-58`); `grep cancellationTerms` shows nothing ever reads it for logic.
- Cancel (facility): `cancelAssignment` (`assignment.ts:527-576`) any time while CONFIRMED, no window, no penalty, no event; reopens a FILLED request to PUBLISHED (`:554-560`). Cancelling a **request** (`service-requests/application/request.ts:294-333`) withdraws invitations only and leaves assignments live.

### 3.8 Stubbed / UI-less
No sanction entity, no ladder, no appeal, no penalty rules, no replacement search, no practitioner-initiated cancellation. `sanction.apply` ("Apply or lift a sanction", `permissions.ts:43`) is used only to gate fault/excusal decisions. `docs/stage-7-7-7-8-fault-and-excusals.md:115-122` defers the ladder and cancellation windows. Facility has no fault/excusal visibility and no way to report a no-show. Closed determinations are final.

### 3.9 Tests
`domain/fault.test.ts` (13), `tests/integration/unhonoured.test.ts` (21: sweep flags/does not flag/idempotent/not-yet-ended, close refused without fault or reason, practitioner fault -> NO_SHOW + event, facility fault costs nothing, no double decision, audit, granted excusal, refused-then-granted retained, cross-practitioner excusal refused, route table, excusal reads over HTTP). No e2e for fault or excusal. **Not tested:** `settleUnhonouredAssignment` failing after the closing transaction; excusal on a non-CONFIRMED assignment; excusal granted before the shift.

---

## 4. disputes (`src/modules/disputes`)

### 4.1 Purpose and need
A structured way for either side to contest a shift that has already been approved or rejected, adjudicated by the platform, with evidence, a time limit to open, and a record of the outcome.

### 4.2 Actors, permissions, scopes
All ten routes carry `dispute.manage` and differ by scope (`routes.ts:19-36`):
| Act | Route | Scope as declared | Notes |
|---|---|---|---|
| Open | POST `/assignments/:id/disputes` | SELF (practitioner) or FACILITY (`facilityId` in body) | party check inside `raiseDispute` (`dispute.ts:155-161`); facility side needs `dispute.manage` at FACILITY = **facility_owner only** (`permissions.ts:199`) |
| List for a shift | GET `/assignments/:id/disputes` | SELF or FACILITY | **no record-scope check** (`route.ts:54` calls `listDisputesFor(input.id)` directly) |
| Queue / read | GET `/disputes`, `/disputes/:id`, `/disputes/:id/evidence` | PLATFORM | |
| Start review / resolve | POST `/disputes/:id/review`, `/resolve` | PLATFORM | |
| Withdraw | POST `/disputes/:id/withdraw` | **SELF** | raiser only (`domain/dispute.ts:136-145`) |
| Evidence upload URL / attach / download link | POST `/disputes/:id/evidence/upload-url`, `/evidence`, `/evidence/:evidenceId/url` | **SELF** | |

### 4.3 Entities and state machine
- `Dispute` `schema.prisma:1450-1486`: assignment, raisedBy, raisedParty (PRACTITIONER|FACILITY), category (HOURS | PAY | NON_ATTENDANCE | CONDUCT | OTHER `:1495-1506`), reason, status, outcome (UPHELD|DISMISSED), resolvedBy/At/Notes, withdrawnAt. No money fields. Not unique per assignment; one live case enforced in code only (`dispute.ts:130,164-186`).
- `DisputeEvidence` `:1530-1546`: object key, attachedBy, note; append-only.
- Dispute status: `OPEN -> UNDER_REVIEW -> RESOLVED`, and `OPEN | UNDER_REVIEW -> WITHDRAWN` (`dispute.ts:243-274,294-345,356-401`; blockers `domain/dispute.ts:106-145`). OPEN may also resolve directly (`LIVE = OPEN|UNDER_REVIEW`). RESOLVED and WITHDRAWN are final; a new case may be opened later (`schema.prisma:1479-1481`).
- Shift side: attendance APPROVED/REJECTED -> DISPUTED -> (upheld) SUBMITTED | (dismissed/withdrawn) pre-dispute state (`attendance.ts:470-564`).

### 4.4 Flow as implemented
1. Open: practitioner clicks "Dispute this" on an APPROVED or REJECTED card (`practitioner/timesheets/page.tsx:260-271,115-130`). `raiseDispute` (`dispute.ts:151-236`): party (`partyFor` `domain/dispute.ts:154-162`: assignee = practitioner, caller's `facilityId` equals the shift's = facility, else none); `getAttendance` (404 if the shift has no attendance record); `openBlockers` (`domain/dispute.ts:70-94`): not a party / not APPROVED or REJECTED / already open / outside window / reason < 20 chars. **Window: 14 days from the decision** (`DISPUTE_WINDOW_DAYS = 14` `:38`; decision time = `attendance.reviewedAt` `dispute.ts:170`; test `withinWindow` `:96-99`). Transaction re-counts live cases, inserts the dispute, audits, publishes dispute.opened (`:178-223`). **Then, outside the transaction**, `openDispute` moves attendance to DISPUTED (`:229-233`).
2. Evidence: upload URL (`evidence.ts:67-114`: type/size check, live case required, stores `StoredObject` owned by caller) -> browser PUTs to storage -> attach (`:122-163`: object must exist, purpose `dispute_evidence`, owned by caller). Admin reads a short-lived download URL per item, audited (`:226-246`). Evidence is never removed.
3. Adjudication: admin queue (`listDisputes` `dispute.ts:453-506`), "Start reviewing" (`beginReview` `:243-274`, stores no officer on the row), then Uphold/Dismiss with a finding >= 20 chars (`resolveDispute` `:294-345`; closes the row compare-and-set + audit; **then** `closeDispute` on attendance outside the transaction `:337-342`). Uphold sends the sheet back to SUBMITTED so the facility corrects it through the normal route; dismiss restores the old state.
4. Withdraw (`:356-401`) restores the shift the same way.
5. Money: none. `grep -i dispute src/modules/billing-settlement src/modules/rates-contracts` finds nothing; `generateInvoice` selects only attendance APPROVED not already billed (`invoice.ts:140-162`); `amountOwed` and `preparePayout` read only the ledger (`payout.ts:55-120`). A shift disputed before invoicing is excluded from invoicing wholly (status no longer APPROVED); a shift already invoiced/credited is untouched; after an upheld case, re-approval cannot re-bill because `invoice_lines.assignment_id` is unique.

### 4.5 API and sweeps
Ten routes (`docs/stage-8-disputes.md:126-141`). No sweep: no age, no escalation.

### 4.6 Events
dispute.opened only (`dispute.ts:208-220`), no handler. No event on review/resolve/withdraw (deliberate, `dispute.ts:33-39`). The only notification path to either party is none.

### 4.7 Business rules with file:line
Window 14 days `domain/dispute.ts:38`; disputable states `:41-46`; reason min 20 / max 2000 `:23-24`; resolve needs outcome and notes >= 20 `:121-133`; one open case `:80-83` + `dispute.ts:182-185`; operations officers cannot open (not a party) `domain/dispute.ts:148-153`.

### 4.8 Stubbed / UI-less
- Facility: no dispute screen at all; and even by API the facility cannot attach/download evidence or withdraw, because those routes are SELF-scoped and facility grants are FACILITY-scoped (0.1).
- Practitioner: can open; **no evidence UI, no status/outcome view** (the only dispute call in non-admin UI is the POST, `practitioner/timesheets/page.tsx:117`).
- Admin copy promises "Marking it under review tells the other side somebody is looking" and "your finding ... both sides read it" (`dispute-detail.tsx:261-263,279-281`); neither is true today (no notification, no screen).
- `EvidenceErrors.notAParty` is defined (`evidence.ts:29-30`) and never used.
- NO_SHOW, CANCELLED outcomes cannot be disputed (needs an attendance record in APPROVED/REJECTED; `getAttendance` throws 404 for none).
- No SLA, no named officer, no response from the other party, no case messages.

### 4.9 Tests
`domain/dispute.test.ts` (24), `tests/integration/disputes.test.ts` (26: open, remembers pre-dispute state, event+audit, facility may raise, non-party and foreign facility refused, undecided refused, second open case refused, 14-day cut-off, resolve both ways, no double counting of completion, withdraw, re-dispute after dismissal, route-table assertions), `after-the-shift.spec.ts` (practitioner disputes, admin decides). **Evidence has no tests** (grep finds none outside audit-coverage registry). No HTTP-level test for `GET /assignments/:id/disputes` scope, evidence party checks, or the SELF-scope withdraw by a facility.

---

## 5. clinical-incidents, reporting and closure side (`src/modules/clinical-incidents`)

### 5.1 Purpose and need
A defined channel for patient-safety events on a shift, with a compliance review, a recorded outcome and, where warranted, suspension of the practitioner. Governing principle: "a report is not an accusation" (`domain/incident.ts:1-9`).

### 5.2 Actors, permissions, scopes
| Act | Route | Permission | Scope |
|---|---|---|---|
| Facility reports | POST `/api/v1/incidents` | incident.report | FACILITY |
| Facility lists own | GET `/api/v1/incidents` | incident.report | FACILITY (`facilityId` in query narrows) |
| Compliance queue | GET `/incidents/queue` | incident.manage | PLATFORM |
| Read one (+ subject, shift, subject's history) | GET `/incidents/:id` | incident.manage | PLATFORM |
| Take case | POST `/incidents/:id/review` | incident.manage | PLATFORM |
| Close (+ suspend) | POST `/incidents/:id/close` | incident.manage | PLATFORM |
| Reinstate | POST `/users/:id/reinstate` | incident.manage | PLATFORM |
| Suspension history | GET `/users/:id/suspensions` | incident.manage | PLATFORM |
`routes.ts:19-28`. Practitioners lack `incident.report` (`permissions.ts:116-122`). No edit or delete routes (test asserts, `incidents.test.ts:666`).

### 5.3 Entities and state machine
- `ClinicalIncident` `schema.prisma:1559-1604`: facility, optional assignment, optional `subjectUserId` (**no foreign key**, `:1573`), reportedBy, occurredAt, severity NEAR_MISS < MINOR < MODERATE < SEVERE < DEATH, category (8), summary (20-4000 chars), status REPORTED -> UNDER_REVIEW -> CLOSED, outcome, closure fields.
- Outcomes (`domain/incident.ts:34-40`): SYSTEM_ISSUE, NO_ACTION, ADVICE_GIVEN, TRAINING_REQUIRED, PRACTITIONER_SUSPENDED, REFERRED_TO_REGULATOR (regulator outcome stores only the outcome, no regulator/reference/date).
- `AccountSuspension` `:1677-1702`: user, reason, suspendedBy/At, `incidentId?`, liftedBy/At/Reason. `UserStatus` has SUSPENDED (`schema.prisma:67`).
- `IncidentAttachment` `:1654-1669`: model and storage purpose exist; **nothing reads or writes it** (`grep IncidentAttachment` finds only `audit-coverage.ts:69`).
- Transitions: REPORTED -> UNDER_REVIEW (`beginIncidentReview` `incident.ts:194-225`, idempotent); REPORTED or UNDER_REVIEW -> CLOSED, except SEVERE/DEATH cannot close straight from REPORTED (`domain/incident.ts:61,110-125`); no reopen.

### 5.4 Flow as implemented
1. Report: facility staff fill the dialog (`facility/incidents/report-incident-dialog.tsx`): occurred time, severity, category, summary (>= 20), optional shift (last N days). `reportIncident` (`incident.ts:133-191`): summary >= 20 and not in the future (`domain/incident.ts:81-95`); **if an assignment is named it must be this facility's** (`:144-147`); `subjectUserId = input.subjectUserId ?? assignment.userId` (`:143,149`); insert + audit + publish clinical_incident.reported. **Opening an incident restricts nobody.**
2. Compliance sees it in `/admin/incidents` (most serious first, then oldest, `incident.ts:367-408`); "Take case" -> UNDER_REVIEW.
3. Close with an outcome and notes >= 20 (`closeIncident` `:248-304`): blockers `domain/incident.ts:110-125`; `PRACTITIONER_SUSPENDED` requires a subject (`:260-261`); one transaction closes the incident and calls `suspendAccount` (`:265-288`; `suspension.ts:87-128`: reason >= 20, sets `users.status = 'SUSPENDED'`, inserts the suspension row, audits).
4. Effect of suspension: `session-service.ts:92` returns no session for SUSPENDED users, so they are signed out on the next request; login/recovery/registration refuse (`login.ts:81`, `recovery.ts:44,81`, `registration.ts:115,176`); the eligibility rule excludes them from matching (`suspension.ts:16-18`). **Nothing touches their existing CONFIRMED assignments, nothing tells the facility, nothing tells the practitioner.**
5. Reinstate: `reinstateAccount` (`suspension.ts:151-192`) with reason >= 20, closes the suspension row, sets ACTIVE. Only reversal path; there is no appeal or notice route.
6. The facility sees outcome and closure notes in a read-only dialog (`incident-detail-dialog.tsx:64-82`).

### 5.5 API and sweeps
Eight routes; no sweep; no deadline.

### 5.6 Events
clinical_incident.reported (no handler) - so a SEVERE or DEATH report raises no alert.

### 5.7 Business rules with file:line
Severity ranking `domain/incident.ts:11,42-48,68-70`; review-required severities `:61`; suspension reason min 20 `:52`; outcome-suspends mapping `:134-136`.

### 5.8 Stubbed / UI-less
Practitioner reporting; officer-originated reports; attachments; patient-data guidance or redaction (free text, UI placeholder only); regulator referral record; notice/hearing/appeal; facility-specific restriction; legal hold; notification of the facility on suspension; incident follow-up/updates by the reporter.

### 5.9 Tests
`domain/incident.test.ts` (16), `tests/integration/incidents.test.ts` (23: report against a shift, no-shift report, event+audit, foreign-facility shift refused, future refused, lists, queue order, close rules, severe needs review, no double close, no subject -> no suspend, suspend in the same transaction, ineligible after suspension, reinstate, history, audit, route table), `oversight.spec.ts` (report + close). **Not tested:** `subjectUserId` supplied with no shift (the gap), subject different from the shift's practitioner, existing assignments after suspension.

---

## 6. suggestions (`src/modules/suggestions`)

### 6.1 Purpose and need
A pilot feedback log so findings do not live in WhatsApp; also receives practitioner decline reasons, anonymously.

### 6.2 Actors, permissions, scopes
| Act | Route | Permission | Scope |
|---|---|---|---|
| Submit | POST `/api/v1/suggestions` (201) | suggestion.submit | SELF, or FACILITY when body carries `facilityId` (`suggestions/route.ts:22-25`); **`routes.ts:19-24` declares SELF only** |
| List log | GET `/suggestions` | suggestion.triage | PLATFORM |
| Summary by area | GET `/suggestions/summary` | suggestion.triage | PLATFORM |
| Triage | POST `/suggestions/:id/triage` | suggestion.triage | PLATFORM |
There is **no route for an author to read their own suggestions or responses.**

### 6.3 Entities and state machine
`Suggestion` `schema.prisma:1713-1746`: source USER | DECLINE_REASON, nullable `raisedBy`, area (ONBOARDING, CREDENTIALS, MATCHING, SCHEDULING, ATTENDANCE, TIMESHEETS, PAYMENTS, SUPPORT, OTHER), body, `sourceRef`, status NEW | TRIAGED | PLANNED | DONE | DECLINED, triagedBy/At, response. Rules (`domain/suggestion.ts:63-74`): no move out of DONE or DECLINED; no move to the same status; DONE/DECLINED need a response >= 10 chars; the triage input cannot name NEW (`presentation/schemas.ts:41-45`), so any open state can move to any of TRIAGED/PLANNED/DONE/DECLINED (including PLANNED -> TRIAGED). Compare-and-set on status (`suggestion.ts:170-179`). No status-history table; history only in audit.

### 6.4 Flow as implemented
1. Any console's "Send a suggestion" dialog: area + text >= 10 (`suggestion-dialog.tsx`); hospital staff send `facilityId` for the scope check only; the row stores the person, not the facility, role, or screen (`suggestion.ts:73-103`).
2. Decline reasons: `recordDeclineAsSuggestion` runs inside the decline's own transaction, files under MATCHING, `raisedBy` null, audit with no actor (`suggestion.ts:117-142`).
3. Admin triages with an optional response (`:158-196`); summary counts by area with open counts (`:290-307`).
4. The submitter is told "The Medilink team reads every suggestion and replies to it" (`suggestion-dialog.tsx:72`) but cannot see any reply.

### 6.5-6.7 API, events, rules
Four routes; no sweep; no events (no handler could fire). Rules `domain/suggestion.ts:34-36,63-89`.

### 6.8 Stubbed / UI-less
Author view, notification, tags beyond `area`, retention, report-a-user, ratings. `docs/stage-9-5-suggestion-log.md` is stale (names the retired `operations_officer`, states "no FACILITY scope anywhere" though the handler accepts a facility scope).

### 6.9 Tests
`domain/suggestion.test.ts` (10), `tests/integration/suggestions.test.ts` (17: file, empty refused, audit, decline -> suggestion without name, triage rules, reopen refused, filters, paging, summary, route table, hospital staff accepted, foreign facility refused). No e2e.

---

## 7. Verification at HEAD (the 28 claims)

Legend: CONFIRMED / ALREADY FIXED / NOT FOUND / PARTLY. All "by reading".

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 1 | Check-in does not compare caller to assignee | **CONFIRMED** | `presentCheckInToken` loads the assignment (`attendance.ts:224`) and uses it only for audit scope and event payload (`:303,312-316`); no comparison of `assignment.userId` to `input.userId` between `:221-322`. Route scope is SELF with the caller's own id, which always passes (`present/route.ts:20`, `guard.ts:62`). The event's `actorId` is the presenter (`:289`), so impersonation is visible only after the fact. Contrast `submitTimesheet` `timesheet.ts:188`. Side effect: any practitioner can also burn another shift's 5 attempts (`:263-268`). |
| 2 | Three-hour window enforced only by the screen | **CONFIRMED** | Constant and test in `check-in-panel.tsx:33,68-70`; neither `issueCheckInToken` (`attendance.ts:147-205`) nor `presentCheckInToken` compares `now` with `assignment.startsAt/endsAt`. No upper bound after the shift end either, in UI or server. |
| 3 | Manual times accept any date; no practitioner confirmation | **CONFIRMED** | `manualAttendanceSchema` `schemas.ts:27-37` (`z.coerce.date()` x2); service checks only out > in (`attendance.ts:347-349`); no link to the shift window, no future check; cap only via the 24 h worked limit later (`hours.ts:147`). Practitioner's only touchpoint is pressing Submit (MANUALLY_CORRECTED -> SUBMITTED), no "I agree/disagree with these times" step. Same for `correctTimesheet` (`timesheets/presentation/schemas.ts:35-44`). |
| 4 | No idempotency on check-in retry | **CONFIRMED** | A retry after a lost success: token already consumed `:273-276` and `guardTransition(CHECKED_IN, CHECKED_IN)` throws illegal transition 409 (`:242`, `state-machine.ts:44-61`), shown to the user as "That code did not work" (`check-in-panel.tsx:62`). No idempotency key. Also, by reading, two parallel valid presents can both pass: `updateMany` result is not asserted (`:273-276`) and the record update is unconditional (`:278-284`). |
| 5 | Timesheet has no deadline / auto-approve; facility never approving stalls payment | **CONFIRMED** | No job (`jobs.ts:31-68`), no field, no reminder; facility UI acts only on SUBMITTED rows (`facility/timesheets/page.tsx:396,458`); invoicing needs APPROVED (`invoice.ts:143`); payout needs a ledger credit, which is created at invoice draft (`invoice.ts:216-232`, `payout.ts:55-65`). Same stall for CHECKED_IN never checked out and CHECKED_OUT never submitted. |
| 6 | Timesheet amount is base-only; invoice includes premiums | **CONFIRMED** | `hours.ts:193` and `timesheet.ts:142-143` (base `billable * rate / 60`); invoice prices night/holiday/overtime/on-call with the active rate card (`invoice.ts:166-180`, `rates-contracts/domain/pricing.ts:98-139`). UI admits it (`facility/timesheets/page.tsx:424-427`, `practitioner/timesheets/page.tsx:203-205`) yet the facility button reads "Approve {base amount}" (`:492`). Root cause of the related minute loss: exclusive split computed (`hours.ts:183-189`) but never persisted (`timesheet.ts:134-144`); billing recomputes by subtracting all holiday minutes from night (`invoice.ts:113-122`). Worked example, shift 24 Dec 22:00 -> 25 Dec 08:00 (600 min): sheet stores night 480, holiday 480; billing yields ordinary 0, night 0, holiday 480 = 480 priced, 120 night minutes lost. |
| 7 | Approval and assignment completion not one transaction | **CONFIRMED** | Approval transaction `timesheet.ts:257-303`; `markAssignmentCompleted` after it `:305-313`. A failure there leaves attendance APPROVED, timesheet.approved already published, assignment CONFIRMED; a retry cannot repair (APPROVED -> APPROVED illegal, `:254`); the no-show sweep skips it (attendance exists, `attendance.ts:456-460`); billing still picks it up (attendance APPROVED, `invoice.ts:143`). `reviewTimesheet` does not check the assignment's own status first. |
| 8 | Holiday list partial, no state holidays, night window hard-coded | **CONFIRMED** | Six 2026 dates `prisma/seed.ts:253-262`; model has no state/region column `schema.prisma:406-417`; nothing writes the table; night constants `hours.ts:27-28`. No weekend band exists either. |
| 9 | Unhonoured detection only after shift end | **CONFIRMED** | `endsAt < now` `matching/assignment.ts:1000-1006`; hourly `jobs.ts:62-67`; so earliest flag is up to an hour after the end. No "not checked in N minutes after start" signal, no early alert, no auto-reopen. |
| 10 | No cancellation window / penalty / sanctions ladder | **CONFIRMED** | `cancelAssignment` has no timing, penalty, event (`assignment.ts:527-576`); `cancellationTerms` is stored text never evaluated (`grep`); no sanction table or code; deferred in `docs/stage-7-7-7-8-fault-and-excusals.md:115-122`. No practitioner cancellation route; no UI for the facility cancel route. |
| 11 | Facility fault consumed by nothing | **CONFIRMED** | FACILITY fault only maps to CANCELLED (`domain/fault.ts:65-67`); `grep` shows no reader of `UnhonouredAssignment.fault` besides the module's own views; `platform-summary.ts:74-75` counts AWAITING only. No facility reliability, no facility visibility. |
| 12 | Fault record not atomic with assignment update | **CONFIRMED** | Close transaction `fault.ts:188-216`, assignment write after it `:220-225`. If the second step fails: determination CLOSED, assignment CONFIRMED; re-calling `recordFault` is refused `already_closed` (`:177-183`); the sweep skips it (known set `:123-127`). Unrecoverable without a database edit. Same shape in `decideExcusal` (grant committed `:130-157`, fault close after `:159-176`). |
| 13 | No-show terminal | **CONFIRMED** | `NO_SHOW: []` `matching/domain/assignment.ts:47`; determination CLOSED is final (`fault.ts:189-199`); cannot be disputed (`getAttendance` 404 when no record, `dispute.ts:163`; only APPROVED/REJECTED disputable, `domain/dispute.ts:41-46`); a later excusal grant does nothing once closed (`excusal.ts:167`); UI offers excusal only for CONFIRMED (`shifts/page.tsx:117`). |
| 14 | Dispute evidence download/upload/list lacks party check | **PARTLY** | Download: CONFIRMED - `requestEvidenceDownloadUrl(evidenceId, viewerId)` ignores the dispute id and checks no party (`evidence.ts:226-246`; route SELF `url/route.ts:29-34`). Upload URL: CONFIRMED - only "dispute is live" (`:76-78`). Attach: CONFIRMED - only "object owned by caller" (`:132-134`), `notAParty` unused. **Evidence list: NOT as claimed** - `GET /disputes/:id/evidence` and `GET /disputes/:id` are PLATFORM-only (`evidence/route.ts:46`, `[id]/route.ts:20`). The related leak is `GET /assignments/:id/disputes`, which returns case reason and resolution notes for any assignment id to any SELF/FACILITY caller (`assignments/[id]/disputes/route.ts:50-54`). |
| 15 | Dispute: no facility screen, no practitioner evidence UI, no notifications | **CONFIRMED** | No facility dispute page (grep of `src/app/facility`); only dispute call outside admin is the POST (`practitioner/timesheets/page.tsx:117`); no handler for dispute.opened (`handlers.ts:15-52`). Worse: facility routes for evidence/withdraw do not exist in practice (SELF scope vs FACILITY grants, 0.1). |
| 16 | Dispute not linked to money | **CONFIRMED** | No dispute reference in billing or rates (grep empty); invoice picks APPROVED only (`invoice.ts:143`); payout reads ledger only (`payout.ts:55-120`); `InvoiceStatus.VOID` has no writer (grep `invoice.ts`); no reversal/credit-note ledger entries (grep empty). |
| 17 | Incident can name any practitioner when no shift is attached | **CONFIRMED** | `subjectUserId = input.subjectUserId ?? null` is taken from the body unchecked (`incident.ts:143`; schema `presentation/schemas.ts:16-19`); no FK (`schema.prisma:1573`), no existence/role/shared-shift check. Also with a shift attached, a supplied `subjectUserId` overrides the shift's practitioner (`:149`). Compliance then sees that user's name/phone and a history built from it (`incidents/[id]/route.ts:33-48`); `PRACTITIONER_SUSPENDED` can suspend whichever active user id was supplied (`suspension.ts:93-101`), including a non-practitioner. |
| 18 | Suspension: no notice/hearing/appeal; no cancel/notify of confirmed shifts | **CONFIRMED** | `suspendAccount` (`suspension.ts:87-128`) touches user, suspension row, audit only; no assignment query, no event, no message. Notice to the subject deliberately deferred (`docs/stage-5-clinical-incidents.md:110-114`). Consequence: the suspended practitioner cannot sign in (`session-service.ts:92`) so cannot ask for an excusal, while the sweep later flags their ended shifts for an officer to blame them. Only reversal is admin reinstate (`:151-192`). |
| 19 | Practitioners cannot report incidents | **CONFIRMED** | `incident.report` not in PRACTITIONER (`permissions.ts:116-122`); report route is FACILITY-scoped (`incidents/route.ts:23`); no practitioner UI. |
| 20 | Suggestion authors cannot read the response | **CONFIRMED** | Route table has no author read (`suggestions/routes.ts:19-24`); no such screen; dialog promises a reply (`suggestion-dialog.tsx:72`). |
| 21 | (Related) Cancelled request leaves assignments live | **CONFIRMED** | `cancelServiceRequest` withdraws invitations only (`request.ts:305-333`). |
| 22 | Manual record published no shift.completed | **ALREADY FIXED** | `attendance.ts:400-414` now publishes it; timesheet then computed by handler. |
| 23 | Read routes scope-check the record | **ALREADY FIXED** | `getAssignmentInScope` on attendance/timesheet reads (`attendance/route.ts:28-33`, `timesheet/route.ts:29-34`); excusal read `excusals/route.ts:74`; timesheet submit assignee check `timesheet.ts:188`; review/correct facility check `:247,344`. |
| 24 | Concurrent compute/submit race | **ALREADY FIXED** | Upsert `timesheet.ts:146-156`, test `timesheets.test.ts:594`. |
| 25 | Re-approval after upheld dispute double-counts completion | **ALREADY FIXED** | `markAssignmentCompleted` is a no-op when already COMPLETED (`assignment.ts:672`); tested `disputes.test.ts:465`. |
| 26 | Facility can issue codes / record by hand for another facility's shift | **CONFIRMED (new)** | `issueCheckInToken` and `recordManualAttendance` take no `facilityId` and load the assignment unscoped (`attendance.ts:147-148,351-358`; routes `token/route.ts:21-27`, `manual/route.ts:22-33`); the guard only proves the caller acts for the `facilityId` they typed. Audit rows record the real facility as scope (`:197,394`), so it is detectable but not prevented. |
| 27 | Suspended practitioner's confirmed shifts end as unhonoured | **CONFIRMED (new)** | see 18. |
| 28 | Reliability counts completions in the denominator; cold start ignores no-shows | **CONFIRMED** | `reliability.ts:27-31`, `engine.ts:183-186`. |

---

## 8. Gaps the redesign doc (`docs/redesign-recommendations-2026-10-13.md`) did NOT mention

All by reading; none reproduced.
1. **Facility-side attendance functions are not ownership-checked** (check-in code issue and manual record) - verification 26. The redesign (section 5 attendance and section 6.2) names only the practitioner-side check-in ownership.
2. **Any practitioner can burn another shift's check-in attempts** (no assignee check plus 5-attempt limit, `attendance.ts:263-268`), and the attempt check reads a stale counter (`check-in-token.ts:119-121`) so parallel guesses can exceed 5 (same pattern the redesign flags only for login OTPs).
3. **Practitioner submit can pull a shift out of DISPUTED** : the machine allows DISPUTED -> SUBMITTED (`state-machine.ts:59`) and `submitTimesheet` has no dispute check (`timesheet.ts:190`), so via the API a practitioner can bypass the dispute hold; the facility could then approve while the case is OPEN, and the later `closeDispute` fails with an illegal transition after the dispute row is already RESOLVED (`dispute.ts:307-342`). The UI hides the button (`practitioner/timesheets/page.tsx:176-179`).
4. **`GET /api/v1/assignments/:id/disputes` has no record-scope check** (`route.ts:54`): case reasons and resolution notes for any assignment id.
5. **Facility cannot use the evidence or withdraw routes at all** (SELF-scoped, facility grants are FACILITY-scoped): the stage doc's "either party may attach" (`docs/stage-8-disputes.md:93-96`) holds only for practitioners.
6. **Facility-side dispute opening is limited to facility_owner**, not facility_administrator (`permissions.ts:140-147,199`).
7. **No-shows cannot be disputed**, and excusal after a closed finding does nothing (verification 13).
8. **A granted excusal does not release the shift**: no cancellation, no freed place, no facility notice (`excusal.ts:159-176`); a practitioner's only exit before the shift is a request the UI hides until after the shift (`practitioner/shifts/page.tsx:115-118`). The redesign mentions "exit only through an excusal" but not that the grant is inert before the sweep.
9. **Facility has no way to report a no-show or see/contest a fault decision**; fault is decided without hearing the facility.
10. **Stuck states with no sweep or alert**: CHECK_IN_PENDING never lapses (`state-machine.ts:46-47` unused), CHECKED_IN never checked out, CHECKED_OUT never submitted, SUBMITTED never reviewed, REJECTED never resubmitted, MANUALLY_CORRECTED never resubmitted.
11. **Correct-then-approve stall**: a facility correction moves the record to MANUALLY_CORRECTED and the facility UI then offers no approve; the practitioner must resubmit (`facility/timesheets/page.tsx:396,458`).
12. **`correctTimesheet` is not atomic**: revision, record change and revision-bump commit, then recompute runs (`timesheet.ts:367-418`); a recompute failure leaves figures stale; and domain errors surface as "cannot move from X to X" (`:126-131`).
13. **`shift_too_long` on a stray check-in** (24 h cap, `hours.ts:147`) throws inside the shift.completed handler and retries to dead-letter, with no operator-facing explanation.
14. **Weekend band is absent** from classifier and rate card though docs and spec 10 name weekend allowances.
15. **`exclusive` bands computed and thrown away** (`hours.ts:183-189`, `timesheet.ts:134-144`): the right numbers exist at the moment of computation; the redesign proposes a fix in billing only.
16. **Reviews overwrite**: `reviewedAt/By/Notes` are overwritten on every approval/rejection (`timesheet.ts:258-266`); only the audit table keeps earlier reviews; the dispute 14-day window restarts at each re-decision (`dispute.ts:170`).
17. **Incident subject override and no foreign key** (`incident.ts:149`, `schema.prisma:1573`) beyond the redesign's "any practitioner when no shift".
18. **Suspended practitioner is signed out and cannot answer an excusal request** while the sweep flags their shifts (verification 27).
19. **`IncidentAttachment` model is unused**; `REFERRED_TO_REGULATOR` stores nothing about the referral; incident severe/death raises no event consumer.
20. **No QR rendering or scanner**; `deviceLabel` never sent - spec 9.16 "device identifier" is effectively absent.
21. **Suggestion route-table drift**: `routes.ts` says SELF; the handler also accepts FACILITY scope (`suggestions/route.ts:22-25`); the doc says "no FACILITY scope anywhere".
22. **Several UI promises are untrue today**: "Marking it under review tells the other side" and "both sides read it" (`dispute-detail.tsx:261-263,279-281`); "replies to it" (`suggestion-dialog.tsx:72`); "Compliance sees it immediately" (`report-incident-dialog.tsx:114`, no alert).
23. **Cancellation terms are mandatory free text with a pre-filled promise** ("up to 24 hours before the shift without penalty", `new-shift-dialog.tsx:56-58`) that nothing enforces - a contractual representation the system cannot honour.
24. **Assignment-cancel API has no UI and no notification**; request cancellation leaves assignments live (the redesign lists this item in its pre-pilot 16; the missing UI/notification is extra).
25. **Doc drift in this slice**: `docs/stage-8-disputes.md:145` still says billing "does not exist"; `docs/stage-7-4-7-5-7-6-timesheets.md:119` still lists "A user interface" as not built; `docs/stage-9-5-suggestion-log.md` names retired roles.

---

## 9. v2.9 spec vs code

Source: `/tmp/claude-0/.../scratchpad/v29/v29.md` (read as data). Numbering note: v2.9 numbers modules 9 attendance, 12 cancellation/fault/sanctions, 13 disputes, 14 clinical incidents, 18 suggestions; the code and its docs use an older scheme (14 disputes, 15 incidents, 13 cancellations). Figure 4 is an image (`media/image4.png`) not present in the supplied text; it was compared against the nine named states and the stated correction rule only.
Marks: IMPLEMENTED / PARTLY / MISSING / DIVERGES.

### 9.1 Module 9 - Attendance and timesheets (spec lines 510-522, 728)
| Requirement | Mark | Evidence |
|---|---|---|
| Check-in/out with supervisor OTP | IMPLEMENTED | `attendance.ts:147-322`, `check-in-token.ts` |
| ... or QR confirmation | PARTLY | payload generated `check-in-token.ts:61-67`; no QR image or scanner in any UI (`attendance-panel.tsx:35,180`) |
| Short-lived (spec 9.16) | IMPLEMENTED | 300 s `check-in-token.ts:23`, 5 attempts `:26`, HMAC `:44-53` |
| Optional location validation (GPS a signal, never sole) | MISSING | no coordinates in `CheckInEvent` (`schema.prisma:1232-1250`); deferred by design `docs/stage-7-1-7-2-7-3-attendance.md:112-115` |
| Device identifier (9.16) | PARTLY | `deviceLabel` column `schema.prisma:1242`, accepted `schemas.ts:23`; no UI sends it |
| Facility confirmation (9.16) | IMPLEMENTED | the facility issues the code (`attendance.ts:147`); direction is the evidence |
| Manual attendance fallback with reason | IMPLEMENTED | `attendance.ts:343-418`, reason >= 10 `schemas.ts:35`; times unbounded (verification 3) |
| Breaks | PARTLY | stored and deducted proportionally (`hours.ts:141-163`) but only the facility can set them (manual/correct) |
| Overtime | PARTLY | computed vs scheduled length (`hours.ts:168-172`) and paid with no approval step; spec Module 13 expects "unapproved overtime" to be disputable |
| On-call hours | PARTLY | facility-entered only (`timesheet.ts:403`, `hours.ts:174`); not worked from a clock |
| Practitioner submission | IMPLEMENTED | `timesheet.ts:179-230` |
| Facility approval or rejection with reason | IMPLEMENTED | `timesheet.ts:245-316`; reject reason required `:252` |
| Amendment history | IMPLEMENTED | `timesheet_revisions` `schema.prisma:1334-1351`, `timesheet.ts:369-389` |
| Dispute initiation | PARTLY | practitioner UI only; facility API-only and limited to facility_owner (section 4) |
| Data tables: attendance_records, checkin_events | IMPLEMENTED | `schema.prisma:1179,1232` |
| Data table: timesheets | IMPLEMENTED | `:1297` |
| Data table: timesheet_entries | MISSING | one sheet per shift; bands are columns |
| Data table: timesheet_approvals | DIVERGES | approval fields live on `attendance_records` and are overwritten per review (`schema.prisma:1189-1194`, `timesheet.ts:258-266`) |
| Mobile (Module 28): offline-tolerant check-in queue | MISSING | no PWA/offline queue (`docs/stage-7-1...md:94-97`) |
| Nigerian public-holiday configuration (Module 8 dependency) | PARTLY | table exists but six 2026 dates only, no state holidays (`prisma/seed.ts:253-262`) |
| WAT display, UTC stored | PARTLY | timestamps UTC; WAT used in classifier (`hours.ts:81-87`) |

### 9.2 Module 12 - Cancellation, no-show, fault and sanctions (spec 558-586)
| Requirement | Mark | Evidence |
|---|---|---|
| Practitioner-initiated cancellation with reason | MISSING | no route; only an excusal request (`excusal.ts:64-90`) |
| Facility-initiated cancellation with reason | PARTLY | route exists, reason >= 3 (`matching/presentation/schemas.ts:57-61`, `assignment.ts:527-576`); no UI, no event |
| Configurable penalty rules | MISSING | `cancellationTerms` is unevaluated free text |
| Emergency replacement search | MISSING | only side effect: cancelling reopens a FILLED request to PUBLISHED (`assignment.ts:554-560`); no automatic re-match/invite/alert |
| No-show reporting with evidence submission | MISSING | facility cannot report; platform detects by sweep (`fault.ts:115-153`); no evidence attach |
| No-show reliability impact | IMPLEMENTED | `reliability.ts:27-31`, `engine.ts:31-36,183-186` |
| Administrator override authority | PARTLY | administrator holds `sanction.apply`/`assignment.cancel` at PLATFORM (`permissions.ts:172-183`); a closed determination cannot be varied (`fault.ts:189-199`) |
| Fault categories: practitioner / facility / excused / undetermined pending review | DIVERGES | PRACTITIONER / FACILITY / NEITHER, and AWAITING_DECISION as "undetermined" (`domain/fault.ts:8-9`); "excused" is not a fault value, a grant records NEITHER (`excusal.ts:168-172`) |
| A no-show never counted against a practitioner until fault decided | IMPLEMENTED | `fault.ts:220-225`; only PRACTITIONER fault creates NO_SHOW (`domain/fault.ts:65-67`) |
| Excusal: practitioner asks **the facility** to release; facility accepts -> excused | DIVERGES | the platform officer decides (`excusal.ts:113-179`, `sanction.apply` PLATFORM); the facility is not involved or informed |
| Excused carries no sanction and no reliability penalty | IMPLEMENTED | grant closes as NEITHER, assignment CANCELLED, not counted (`excusal.ts:159-176`, `reliability.ts:22-25`, tested `unhonoured.test.ts:371`) |
| Excusal requests time-stamped and retained, granted or refused | IMPLEMENTED | `schema.prisma:1410-1431`, `excusal.ts:181-191` |
| Facility that habitually refuses is visible to operations | MISSING | the facility never refuses; no report or view on refusals |
| Graduated sanction ladder warning -> temp suspension -> extended -> removal, each configurable, reasoned | MISSING | no sanction entity; `docs/stage-7-7-7-8-fault-and-excusals.md:117-119` defers it |
| Only a Compliance Officer may apply/vary/lift; facility can report; practitioner can appeal | DIVERGES | no compliance-officer role (merged into administrator `permissions.ts:230-236`); facility cannot report no-shows; **no appeal exists anywhere** (grep) |
| Sanction and appeal history retained; lifted sanction closed with reason | PARTLY | true for account suspensions (`suspension.ts:151-192`), not applicable to ladder (absent); appeals absent |
| Financial consequence separate from disciplinary consequence | MISSING | no financial consequence exists (no withheld/reduced pay, no penalty); the two are separate only by absence |
| Reliability reflects only at-fault assignments | IMPLEMENTED | only NO_SHOW (practitioner fault) lowers it; excused/cancelled/facility fault excluded (`reliability.ts:22-25`); note completions sit in the denominator |
| ... shown to facilities with the count it is based on | PARTLY | factor detail shows "N assignments completed" or "neutral: N of 5" (`engine.ts:211-218`); count of no-shows/decided not shown |
| Practitioner appeal route for inaccurate reliability data (9.16) | MISSING | none |
| Data tables: cancellations, replacement_requests, no_show_reports, fault_determinations, excusal_requests, penalty_rules, penalties, sanctions, sanction_history, appeals, reliability_scores | PARTLY | present as `unhonoured_assignments` (fault) and `excusals`; all others absent; reliability is computed on the fly, not stored |

### 9.3 Module 13 - Disputes (spec 588-602)
| Requirement | Mark | Evidence |
|---|---|---|
| Incorrect timesheets, unpaid work, incorrect rates, unapproved overtime | PARTLY | categories HOURS, PAY, NON_ATTENDANCE, CONDUCT, OTHER (`domain/dispute.ts:11,15-21`); no rate or overtime category (OTHER only) |
| No-shows, facility cancellations, misconduct, unsafe conditions, payment reversals | PARTLY | CONDUCT/OTHER exist; no-show and cancellation outcomes cannot be disputed (verification 13); no unsafe-conditions or reversal type |
| Hold on the disputed amount only; undisputed part settles | MISSING | no amount on a dispute; a pre-invoice dispute holds the whole shift out of invoicing (`invoice.ts:143`), an invoiced one holds nothing; payouts ignore disputes (`payout.ts:55-120`) |
| Dispute opened after settlement resolved by reversal entry, never editing the ledger | MISSING | no reversal entries or credit notes (grep empty); `InvoiceStatus.VOID` has no writer |
| Per-type target resolution time | MISSING | `docs/stage-8-disputes.md:155-157` ("A time limit on adjudication" not built); no field |
| Auto-escalation to a named officer when overdue | MISSING | no sweep, no officer assignment (`beginReview` stores no officer, `dispute.ts:243-274`) |
| Case structure: messages, evidence, assignments, decisions, status history | PARTLY | `disputes` + `dispute_evidence` only (`schema.prisma:1450,1530`); no messages, no other-party response, no case-assignment, status history only in audit |
| Process "rather than ad hoc escalation" (opening rules, window) | PARTLY | 14-day window, one live case, reasons (`domain/dispute.ts:38,70-94`); window is not in spec |
| 9.15: payout only if "disputed amounts are separated" | MISSING | `payout.ts` has no dispute logic |

### 9.4 Module 14 - Clinical incidents (spec 604-622; 9.15 line 866)
| Requirement | Mark | Evidence |
|---|---|---|
| Either party may report against a specific assignment (facility, practitioner, officer) | PARTLY | facility only (`permissions.ts:140-147`); practitioner and officer cannot (`incident.report` absent from `:116-122,172-183`); assignment is optional by design (`schemas.ts:13-19`) |
| Report records what/when/assignment; no patient identifiers or clinical details | DIVERGES | 20-4000 char free text, no guard, redaction or guidance (`schemas.ts:8-9`); the UI invites "what was supposed to happen, what happened instead" (`report-incident-dialog.tsx:217`) |
| Opening an incident suspends the practitioner from new matching **at that facility** pending review | MISSING | opening does nothing (`incident.ts:133-191`); only close with PRACTITIONER_SUSPENDED suspends, **platform-wide account** (`suspension.ts:87-128`); no facility-specific restriction |
| Compliance decides within a defined period whether to extend / lift / keep facility-specific | MISSING | no deadline or period; no facility-specific state to extend from |
| Suspension pending investigation recorded as not a finding of fault; separate from the sanction ladder | PARTLY | `account_suspensions` is a separate decision log with reason and `incidentId` (`schema.prisma:1677-1702`); but suspension is a closure outcome (a decision), there is no "pending investigation" kind |
| Referral to MDCN recorded | PARTLY | outcome `REFERRED_TO_REGULATOR` only (`domain/incident.ts:34-40`); no regulator, reference, date, or contact record |
| Legal hold on related records, exempt from retention until closure | MISSING | no legal-hold anywhere (grep empty); no retention rules |
| Production of records to a court/coroner/Council, each logged | MISSING | no lawful-disclosure route or log (grep empty) |
| 9.15: serious incident must preserve records, apply restriction, notify responsible officer, start investigation deadline, audit event, restrict access | PARTLY | audit event yes (`incident.ts:166-174`); access limited to facility's own list and PLATFORM (`routes.ts:19-28`); no preservation, no restriction, no notification (event has no handler), no deadline |
| Data tables: clinical_incidents, incident_reports, incident_suspensions, incident_referrals, legal_holds | PARTLY | `clinical_incidents` and `account_suspensions` only |

### 9.5 Module 18 - Suggestions (spec 666-678)
| Requirement | Mark | Evidence |
|---|---|---|
| Control available from every screen | IMPLEMENTED | dialog in `ConsoleShell` (`console-shell.tsx:31,298`) for all three consoles; not on public/auth pages |
| Captures suggestion, submitter's role, screen, facility/practitioner | PARTLY | stores text, area, person (`suggestion.ts:73-103`); no role, no screen, facility used for scope only (`schemas.ts:50-53`) |
| Status visible to the submitter: received, under consideration, planned, shipped, declined with reason | MISSING | no author read route (`routes.ts:19-24`); internal statuses NEW/TRIAGED/PLANNED/DONE/DECLINED map to the spec's words but are visible only to staff |
| Tagged by module | PARTLY | single `area` enum of nine values (`schema.prisma:1757-1769`), summary by area (`suggestion.ts:290-307`); no multi-tag |
| Reviewed weekly with the dispute log and the refused-excusal record | MISSING | summary covers suggestions only; refusals are by officers, not facilities; no combined view or cadence |
| Data: suggestions, suggestion_status_history, suggestion_tags | PARTLY | `suggestions` only; history in audit |
| Declined with a reason | IMPLEMENTED | DECLINED/DONE need a response >= 10 (`domain/suggestion.ts:63-74`) |

### 9.6 Section 9.16 attendance state list and Figure 4
| Requirement | Mark | Evidence |
|---|---|---|
| Nine states exactly as named | IMPLEMENTED | `state-machine.ts:11-21`, enum `schema.prisma:1215-1228`, tested `state-machine.test.ts:51-63` |
| One transition model, no illegal path | IMPLEMENTED | `state-machine.ts:44-61,101-103`; exhaustive test; **but** `submitTimesheet` can leave DISPUTED (gap 3) |
| Timestamp, supervisor OTP, QR, device, optional location, facility confirmation, manual fallback with reason | PARTLY | see 9.1 (QR UI absent, device unsent, location absent) |
| Every correction preserves the original event and records who/why/when | PARTLY | manual record appends events and audits before/after (`attendance.ts:371-398`); timesheet correction preserves originals in `timesheet_revisions.previous` with actor and reason (`timesheet.ts:369-389`) but writes no `checkin_event` and overwrites `attendance_records` times (`:391-399`); approvals overwrite reviewer fields |
| Figure 4 | not assessable | image not in the supplied text |
| Matching: practitioner appeal routes for inaccurate reliability | MISSING | none |

### 9.7 Section 9.17 glossary and state discipline
Spec asks for Confirmed, Approved, Verified, Eligible, Active, Licensed, Suspended, Disputed, Settled, Captured, Paid out, Reversed, not used interchangeably, and a state-transition model for each major aggregate.
| Term | Mark | Evidence |
|---|---|---|
| Confirmed | PARTLY | assignment status CONFIRMED (`matching/domain/assignment.ts:12`); invitation has ACCEPTED vs assignment CONFIRMED (kept distinct) but CONFIRMED also stays on an assignment whose attendance is APPROVED until completion succeeds (gap in verification 7) |
| Approved | PARTLY | attendance APPROVED (`state-machine.ts:17`) means timesheet approved; assignment goes COMPLETED separately; no "approved" for invoice/credential in this sense |
| Verified | PARTLY | credential and facility use VERIFIED (`schema.prisma:539-560` credential, `:616-632` facility); eligibility is a computed rule, not a stored state |
| Eligible | PARTLY | pure function, no stored state (`practitioners/domain/eligibility.ts`) |
| Active | DIVERGES | the same word means user ACTIVE (`schema.prisma:66`), registration ACTIVE (`:733-743`), rate card ACTIVE (`:1820-1826`) |
| Licensed | MISSING | no state of that name; registration ACTIVE/EXPIRED/STRUCK_OFF/SUSPENDED/UNKNOWN stands in |
| Suspended | DIVERGES | three different meanings under one word: `UserStatus.SUSPENDED` (platform-wide account, `schema.prisma:67`), `RegistrationStatus.SUSPENDED` (regulator licence, `:735`), `FacilityStatus.SUSPENDED` ("reachable by no code path", `:624`) |
| Disputed | PARTLY | attendance DISPUTED (`state-machine.ts:19`); the dispute aggregate itself has OPEN/UNDER_REVIEW/RESOLVED/WITHDRAWN (`schema.prisma:1508-1516`) |
| Settled | PARTLY | `PayoutStatus.SETTLED` only (`schema.prisma:1966-1972`); invoices go ISSUED -> PAID (`:1865-1873`) |
| Captured | MISSING | no payment-capture state (no gateway) |
| Paid out | PARTLY | stands in as payout SETTLED and event payout.settled |
| Reversed | MISSING | no reversal state or entries; `InvoiceStatus.VOID` has no writer |
| State-transition model per aggregate | PARTLY | explicit, tested table only for attendance; assignment has a small table (`assignment.ts:41-48`); dispute, incident, suggestion, unhonoured, excusal enforce transitions through blocker functions and compare-and-set updates, not a table; no practitioner/facility/credential/invoice/payout transition tables in this slice; no glossary document in `docs/` (grep) |

---

## 10. Unverified / not checked
- Race conditions and state-combination bugs (verification 4, 7, 12; gaps 2, 3, 12) are from reading two code paths; reproduce with a test before fixing.
- Billing arithmetic example (verification 6) is hand-computed from `hours.ts` and `invoice.ts:113-122`, not run.
- Figure 4 of the spec and the original v2.9 numbering of the stage docs were not available as images/text.
- Notification delivery, storage provider behaviour for evidence, and the `/api/v1/audit` route behaviour used by admin history tabs were not inspected.
