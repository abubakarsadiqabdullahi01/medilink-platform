# Study 1 — Identity, audit/compliance, notifications, config, and the platform around them

Repo: `/home/user/medilink-platform`, HEAD `5c199c1` (working tree clean). Read-only study, 2026-10-13.
Method: every statement below was read in the code at HEAD; line numbers are 1-based and refer to the file as it is on disk.
"As built" = what the code does. "Gap" = what is absent, stubbed, or wrong. Where I infer something from a negative grep I say so.
Test counts are from `grep` of `it(`/`test(` lines, not from running anything: unit 482, integration 535, browser (e2e) 44.

Contents: A. Module-by-module fact sheet · B. Verification of the redesign-doc claims · C. Gaps the redesign doc did not mention · D. v2.9 spec vs code · E. Stale docs.

---------------------------------------------------------------------------------------------------

## A. Module-by-module fact sheet

### A0. Cross-cutting reference: roles, permissions, scopes

Source: `src/lib/authz/permissions.ts`, `src/lib/authz/guard.ts`, `src/lib/http/guarded-handler.ts`.

- 32 permission keys (`permissions.ts:6-58`). Five roles (`permissions.ts:185-220`):
  - `practitioner` (116-122): availability.read/write, practitioner.profile.read/write, credential.submit, credential.document.read, service_request.read, attendance.record, timesheet.submit, invoice.read, payout.account.change, dispute.manage, suggestion.submit.
  - `facility_administrator` (140-147): availability.read, facility.read/write/user.manage, service_request.read/publish, assignment.confirm/cancel, attendance.record, timesheet.approve, invoice.read, payout.manage, incident.report, suggestion.submit.
  - `facility_owner` = facility_administrator + `role.grant` + `dispute.manage` (`permissions.ts:199`).
  - `administrator` (172-183): user.read/suspend, role.grant, practitioner.profile.read, credential.review/document.read, facility.read/write/verify, availability.read, service_request.read, assignment.confirm/cancel, invoice.read, payout.manage, dispute.manage, sanction.apply, incident.manage, audit.read, suggestion.submit/triage.
  - `super_administrator` = every key (`permissions.ts:219`). The only difference from `administrator` is `config.manage` (comments at `permissions.ts:150-170` and `204-218`).
- Five retired roles map onto these (`RETIRED_ROLES`, `permissions.ts:230-236`); `sync-roles.ts:67-98` migrates holders.
- Scope types: PLATFORM, FACILITY_GROUP, FACILITY, BRANCH, DEPARTMENT, SELF (`schema.prisma:140-147`). Only PLATFORM, FACILITY and SELF are used by any route; no Branch/Department/FacilityGroup model exists (`grep "model Branch|Department|FacilityGroup" schema.prisma` returns nothing) and no caller passes `ancestors` to the guard (`grep ancestors src/app` returns nothing; support exists only at `guard.ts:15,57-59`).
- Guard decision (`guard.ts:45-71`): grant must carry the permission AND its scope must equal PLATFORM, or the requested `type:id`, or an ancestor; SELF requires `requested.id === actingUserId` (62-64). The "requested scope" is **supplied by the caller's own input** in every guarded route (e.g. `grants/route.ts:24`, `grants/[id]/revoke/route.ts:25`).
- Order in `handleGuardedRequest` (`guarded-handler.ts:73-137`): 401 if no session (89) → parse input (92-93) → step-up check before permission check (102-108) → `requirePermission` (110) → action. `step_up_required` is a 401 and is returned even to callers who do not hold the permission (deliberate, comment 95-101).
- Step-up permissions: `payout.account.change`, `role.grant` only (`permissions.ts:77-83`). `payout.account.change` has no route and no bank-account model anywhere (grep).
- Permissions with no code path outside the catalogue: `user.suspend`, `facility.user.manage`, `payout.account.change` (grep of `src/app`, `src/modules`, `src/components`; `clinical-incidents/permissions.ts:13` and `facilities/permissions.ts:5` say so explicitly). `config.manage` is described as "Edit controlled vocabularies and rate floors" (`permissions.ts:47`) but its only uses are the agreement-publishing routes (`agreements/route.ts:62`, `agreements/versions/route.ts:14`) and the last-appointer check (`grants.ts:292-299`).
- Routes that do not use `handleGuardedRequest` (16): the 7 public auth routes, `auth/session`, `auth/logout`, `auth/step-up`, `reference`, `facilities/register`, `health`, `dashboard/facility`, `dashboard/practitioner`, `dashboard/platform`. `dashboard/*` compute per-section permission checks themselves (`dashboard/facility/route.ts:93-101`, `dashboard/platform/route.ts:32-46`).

---

### A1. `src/modules/auth` — registration, login, sessions, recovery, step-up, role grants

**(1) Purpose / user need.** A practitioner, hospital owner or colleague needs to get an account on a phone number, sign in on a ward computer, get back in when they forget, and (for hospital owners and administrators) hand access to staff. Phone is the primary identifier; day-to-day sign-in is a password (`docs/stage-4-2-auth.md:8-12`).

**(2) Actors / permissions / scopes.**
- Anonymous: the 7 public routes (`auth/routes.ts:19-27`).
- Any signed-in user: `GET /auth/session`, `POST /auth/logout`, `POST /auth/step-up` (session only, no permission).
- `role.grant` (+ fresh step-up): `GET/POST /grants`, `POST /grants/:id/revoke`, `GET /grants/find`. Held by `administrator` (PLATFORM), `facility_owner` (FACILITY) and `super_administrator`.
- `user.read` at PLATFORM: `GET /users/find` (`users/find/route.ts:30-38`).
- Escalation ceiling: nobody can grant a permission they do not hold (`grants.ts:144-146`); nobody can revoke PLATFORM authority they do not hold (`assertMayRevoke`, `grants.ts:241-269`); peers cannot revoke peers unless the actor holds every permission (258-268); the last holder of `config.manage` at PLATFORM cannot be revoked (`grants.ts:286-304`). `super_administrator` is never offered in the role list (`grants.ts:73-79`).

**(3) Entities and state machines.**
- Tables: `identity.users`, `roles`, `permissions`, `role_permissions`, `user_roles`, `sessions`, `devices` (unused), `otp_codes`, `login_attempts` (`schema.prisma:25-229`); `audit.security_events` (written by 3 read-access paths only).
- `User.status` (`schema.prisma:64-72`): PENDING_VERIFICATION → (set-password) UNDER_REVIEW for practitioners or ACTIVE for `staff` (`registration.ts:188-199`); UNDER_REVIEW → ACTIVE by the activation sweep (`practitioners/application/eligibility.ts:238-263`); any non-SUSPENDED → SUSPENDED and SUSPENDED → ACTIVE via the clinical-incidents module (`clinical-incidents/application/suspension.ts:95-99, 174`); **DEACTIVATED has no writer** (grep: only checks at `login.ts:81`, `session-service.ts:92`, `registration.ts:115,176`, `recovery.ts:44,81`, `resend-code/route.ts:28`). `User.deletedAt` is never set by any code (grep).
- OTP (`otp_codes`): issued → superseded (older unconsumed codes get `consumedAt` at `otp-service.ts:63-68`) | consumed (`consumeOtp`, 180-187, conditional on `consumedAt IS NULL`) | expired (10 min, `otp.ts:13`, check 100) | exhausted (`attempts >= 5`, `otp.ts:14,97`). Purposes: PHONE_VERIFICATION, PASSWORD_RESET are consumed; LOGIN is issued but nothing verifies it; EMAIL_VERIFICATION and STEP_UP are declared and never used (`otp.ts:18-23`; grep).
- Session: issued (`issueSession`, `session-service.ts:27-68`) → revoked (logout 108-134, or all on password reset 141-168) | expired (14 days, `session.ts:10`). `stepUpAt` freshness 300 s (`session.ts:17,50-53`).
- Grant (`user_roles`): live → revoked (`revokedAt` stamped, row kept, `grants.ts:326-331`); re-grant after revoke creates a new row (partial unique index `user_roles_one_live_grant`, baseline migration `:1833`; `20261012120000_regrant_after_revoke`).

**(4) User-facing flow as coded.**
1. Register (`/register`, `app/(auth)/register/page.tsx`): details → `POST /auth/register` (`registration.ts:40-96`): normalise phone (E.164, allow-listed mobile prefixes, `lib/phone.ts:22-50`), find existing user; if none create `PENDING_VERIFICATION` user + audit `auth.registration_started` (67-85); `issueOtp` PHONE_VERIFICATION. If the number already exists, issue a code anyway (LOGIN purpose if fully registered) and return the same 202 body (53-64; route body `register/route.ts:22-26` drops `existing`).
2. `POST /auth/verify-phone` (`registration.ts:99-140`): `verifyOtp` (wrong guess commits an attempt increment + audit `auth.otp_attempt_failed` in its own tx, `otp-service.ts:134-149`), then in one tx `consumeOtp` + set `phoneVerifiedAt` + audit.
3. `POST /auth/set-password` (`registration.ts:147-239`): requires only `phoneVerifiedAt` set and no password yet (173-175); policy = 10–128 chars, no common-list, no phone/name/email substring (`password-policy.ts:7-61`); Argon2id (memory 19456, time 2, `password.ts:16-20`). Practitioner → UNDER_REVIEW + `practitioner.registered` event + optional consent grants (`CONSENT_AT_REGISTRATION` = credential sharing + profile visibility, `domain/consent.ts:64-67`) in the same tx; `staff` → ACTIVE, no event. `accountType` and `consentToSharing` come from the client (`schemas.ts:36-41`).
4. UI then calls `/auth/login`, polls `/auth/session` up to 8×1 s for the worker-granted `practitioner` SELF grant (`register/page.tsx:170`), and redirects by grants (`lib/ui/session.tsx:42-53`: PLATFORM → /admin, FACILITY → /facility, no grants → /facility, else /practitioner).
5. Login (`login.ts:15-96`): lockout check from `login_attempts` by phone (34-46) → verify password against real or dummy Argon2 hash (59-63) → failures recorded (65-74) → unverified phone 409 (76-79) → SUSPENDED/DEACTIVATED 403 (81-84) → success row + session cookie `medilink_session` (httpOnly, `secure` unless APP_ENV=local, SameSite=Lax, `session.ts:59-68`).
6. Recovery: `POST /auth/password/reset-request` always returns 202 `code_sent_if_registered`, swallows throttle errors (`recovery.ts:21-58`); `POST /auth/password/reset-confirm` verifies code, replaces hash, audits, then revokes **all** the user's sessions (65-123). **No screen exists for either** (see B5).
7. Step-up: `POST /auth/step-up` re-verifies the password, shares the login lockout counter (`session-service.ts:185-254`), sets `sessions.step_up_at`. Used by `components/app/step-up.tsx` before `role.grant` calls.
8. Staff management (`components/app/staff-manager.tsx:102-157`; pages `facility/staff/page.tsx`, `admin/staff/page.tsx`): list grants → find person by phone (`/grants/find`) → grant role at the chosen scope → revoke with a reason (≥5 chars, `grant-schemas.ts:34`). Grants take effect immediately because `loadGrants` runs on every request (`guard.ts:73-87`).

**(5) API routes and jobs.**
POST `/api/v1/auth/{register, verify-phone, set-password, login, resend-code, password/reset-request, password/reset-confirm, logout, step-up}`; GET `/api/v1/auth/session`; GET/POST `/api/v1/grants`; POST `/api/v1/grants/:id/revoke`; GET `/api/v1/grants/find`; GET `/api/v1/users/find`. (`users/:id/suspensions` GET and `users/:id/reinstate` POST are `incident.manage` at PLATFORM and belong to clinical-incidents.) No scheduled job touches auth tables.

**(6) Events.** Emits `practitioner.registered` (`registration.ts:229-235`) → handler `worker/handlers.ts:42-51` (grants practitioner role at SELF, `practitioners/application/role-grants.ts`, then screens). No events for login, grants, suspension, password reset.

**(7) Business rules enforced (file:line).**
- OTP: 6 digits, 10-minute TTL, 5 attempts, 60 s resend cooldown, 5 sends/hour/user/purpose (`otp.ts:12-16,97-101,128-153`; applied `otp-service.ts:41-56`); stored as HMAC(SESSION_SECRET) bound to purpose+user (`otp.ts:39-46`); constant-time compare with hex-shape guard (56-65).
- Login lockout: 5 consecutive failures within 15 min → locked 15 min from the **newest** failure, success clears the streak (`lockout.ts:7-9,27-53`).
- Login timing equalisation with a cached dummy Argon2 hash (`login.ts:59-63,98-109`).
- Sessions: opaque 256-bit token, SHA-256 stored (`session.ts:20-32`); suspension/deactivation/soft-delete checked on every request (`session-service.ts:80-99`).
- Password reset revokes all sessions (`recovery.ts:115-120`).
- Grants: unknown role 422, scope required except PLATFORM (`grants.ts:134`, `grant-schemas.ts:15-20`), duplicate live grant 409 (148-157), escalation 403 (144-146), revoke reason mandatory (`grant-schemas.ts:34`), PLATFORM revoke rules and last-appointer rule (above). Every grant/revoke writes `role.granted`/`role.revoked` audit at the affected scope (`grants.ts:172-182, 332-342`).
- Boot refuses non-local `SMS_PROVIDER=console`, `PAYMENT_PROVIDER=console`, published secrets, non-https `APP_URL` (`env-rules.ts:42-80`).

**(8) Stubbed / not implemented.**
- No real SMS gateway (A5/sms). No email: `email` is stored, never verified (`emailVerifiedAt` never written; grep) and `SMTP_URL` is parsed (`env.ts:39`) and used by nothing.
- No password-reset screen; no authenticated change-password; no session list / "sign out everywhere" route (`revokeAllSessions` has one caller, `recovery.ts:115`).
- No MFA, no device registration (`devices` table never touched), no impersonation, no suspicious-login detection, no IP throttle.
- DEACTIVATED unreachable; no production path to create the first `super_administrator` (`grants.ts:75-77` refuses to list it; `scripts/support/demo.ts:27-34` `assertLocal`; `docs/end-to-end.md:53`).
- `auth/routes.ts` `ROUTES` is empty (35) and the table omits `step-up`, `grants/*`, `users/find` (19-33).

**(9) Tests.** Unit: `domain/otp.test.ts` (21 cases), `domain/lockout.test.ts` (8, includes "extends the lock when a locked-out user keeps trying"), `domain/session.test.ts` (14), `lib/password.test.ts` (13), `lib/phone.test.ts` (7), `lib/authz/{guard,roles,step-up}.test.ts` (7/13/5). Integration: `tests/integration/{registration,grants,step-up,authorization,audit-coverage,worker-handlers}.test.ts`. E2E: `tests/e2e/auth.spec.ts` (8 tests: sign-up in 3 steps, wrong code, sign-in for 3 roles, wrong password, signed-out redirect, practitioner cannot open admin). **Not covered by any test:** `resend-code` route, enumeration behaviour, `requestPasswordReset`/`confirmPasswordReset` except as one step in the audit-coverage journey (`audit-coverage.test.ts:86-91`), login lockout through the real route, and any cross-tenant call to `/grants/:id/revoke` (`grants.test.ts:189-212` calls `revokeGrant` directly and says "the route's own scope check is what confines who may touch a facility's staff" — the route's check is derived from the caller's own input).

---

### A2. `src/modules/audit-compliance` — audit trail, consent, agreements, data-subject rights, dashboards

**(1) Purpose.** Let compliance officers and hospital admins answer "who did what, when, why"; let practitioners control what is shown to hospitals and exercise NDPA rights; let operations publish the terms people agree to; give dashboards one-request summaries.

**(2) Actors / permissions / scopes** (`audit-compliance/routes.ts:17-48`; actual guards read from the route files):
- `audit.read` at any of PLATFORM/FACILITY_GROUP/FACILITY/BRANCH/DEPARTMENT/SELF → `GET /audit`; PLATFORM → `GET /admin/performance`, `GET /data-requests`, `POST /data-requests/:id/start|close`.
- `practitioner.profile.read|write` at SELF → consent, practitioner agreements, `/me/export`, `/me/erasure`, `/me/data-requests`, `POST /data-requests`.
- `config.manage` at PLATFORM → `PATCH /agreements` (publish), `GET /agreements/versions`.
- `facility.read` at FACILITY → `GET|POST /agreements/facility` (accepting a hospital's terms needs only read).
- Per-section permissions → `GET /dashboard/platform`, `GET /dashboard/facility`.

**(3) Entities / state machines.**
- `audit.audit_log` (`schema.prisma:232-258`), `audit.security_events` (290-300), `audit.outbox_events`, `audit.scheduled_jobs` (see A6).
- `consent.agreement_versions` / `agreement_acceptances` / `consent_records` / `data_subject_requests` (`schema.prisma:1987-2146`).
- Agreement version: published (effectiveFrom) → retired (`retiredAt` stamped when a newer version of the same kind is published, `consent.ts:363-366`). Acceptance: append-only, unique per (user, version) (`schema.prisma:2034`).
- Consent: append-only rows; current state = latest row per purpose (`consent.ts:59-80`); only purposes whose lawful basis is CONSENT can be withdrawn (`domain/consent.ts:43-51`; IDENTITY_VERIFICATION is LEGAL_OBLIGATION and cannot).
- Data-subject request: RECEIVED → IN_PROGRESS (`startRequest`, `data-subject.ts:138-175`, conditional update) → COMPLETED | REFUSED; RECEIVED → COMPLETED | REFUSED directly is allowed (`closeRequest`, 177-219, rejects only already-closed and empty outcome). `dueBy` = received + 30 days, stamped at creation (`domain/consent.ts:70-74`; `data-subject.ts:98`).

**(4) Flows as coded.**
- Audit read: caller names a scope (required unless PLATFORM/SELF, `schemas.ts:13-43`) → guard checks permission at that scope → query is filtered to the same scope (`read-audit-trail.ts:42-45`; PLATFORM sees untagged rows too) → returns id/action/entity/actor/scope/reason/correlationId/createdAt only (no before/after, 75-87) with actor names resolved (117-131) → writes `audit.trail_read` into `security_events` (140-163). Area filter groups action prefixes (`domain/audit-areas.ts:15-23,54-60`); there is deliberately no filter-by-person.
- Consent: registration checkbox (practitioners only) → `grantConsentsInTx` (`consent.ts:144-164`); later toggle from My profile → Privacy (`practitioner/profile/privacy-section.tsx`); withdrawal needs a reason and removes the practitioner from matching via `withdrawnFromMatching` (`consent.ts:178-194`), counting only explicit withdrawals.
- Agreements: operator publishes (PATCH, retires predecessor in same tx, `consent.ts:346-398`); practitioner sees `PRACTITIONER_ENGAGEMENT` + `PRIVACY_NOTICE`, hospital staff see `FACILITY_TERMS` + `PRIVACY_NOTICE` (`consent.ts:199-253`); accept → row with IP/UA (`consent.ts:255-293`). **Nothing requires acceptance** (B18).
- Data requests: practitioner raises one → officer queue ordered by deadline (`data-subject.ts:261-296`) → start → close with an outcome (≥10 chars). ACCESS/PORTABILITY are self-serve via `GET /me/export` (`data-subject.ts:320-402`); ERASURE is only assessed (411-431).
- Dashboards: `platform-summary.ts` (6 queue counts + oldest, incident severity, worst incident, 24-month growth by Lagos month, last 8 audit rows) and `facility-summary.ts` (published count, roster, awaiting approval, weekly fulfilment, monthly spend). Both are raw SQL across other modules' tables and say so (`platform-summary.ts:4-22`).

**(5) API routes / jobs.** GET `/audit`; GET `/admin/performance`; GET/POST `/consent`; GET/POST/PATCH `/agreements`; GET `/agreements/versions`; GET/POST `/agreements/facility`; GET `/me/export`; GET `/me/erasure`; GET `/me/data-requests`; GET/POST `/data-requests`; POST `/data-requests/:id/start`; POST `/data-requests/:id/close`; GET `/dashboard/platform`; GET `/dashboard/facility`. No scheduled job (no retention, no DSR-overdue alert).

**(6) Events.** None emitted. Audit rows: 99 `recordAudit(` call sites across `src` (grep).

**(7) Business rules (file:line).**
- Audit row is written in the same transaction as the change (`lib/audit.ts:50-68`); redaction by key name only: passwordHash, password, codeHash, tokenHash, accountNumber, bvn, nin, secret, apiKey (`audit.ts:31-48`).
- Coverage harness fails the integration suite when a write to an audited model leaves no audit row **naming the same table** in the window (`lib/audit-coverage.ts:25-72` 43 audited models, `78-109` 15 exempt models each with a stated reason, `187-212` observer, `224-240` report); table-level matching is acknowledged (`docs/stage-4-5-audit-coverage.md:51-59`).
- Withdrawal needs a note and a withdrawable purpose (`consent.ts:94-97`).
- Agreement identifiers unique, reuse refused with a message (`consent.ts:359-360`); `acceptAgreementAs` checks the version binds that audience (333-343); retired versions cannot be accepted (262).
- 30-day statutory clock fixed at creation (`data-subject.ts:96-98`); a refusal needs an outcome as much as a grant does (190).
- Export never contains the audit trail, ledger or NIN and says so inside the payload (`data-subject.ts:374-384`).
- Erasure blockers: confirmed assignment, unpaid balance, open dispute (`domain/consent.ts:115-121`; `data-subject.ts:411-431`).

**(8) Stubbed / not implemented.** Erasure (assessment only). Rectification/restriction have no fulfilment path beyond closing the request with free text. No retention rules, legal holds, breach workflow, lawful-disclosure route, data inventory. No CSV/report export (grep `csv` returns nothing). Export covers 13 sources (`data-subject.ts:335-370`) and omits disputes, incidents, notifications, attendance, timesheets, screening, sessions, invoices. Export/erasure/consent/DSR-raise routes need `practitioner.profile.*`, which hospital staff accounts do not hold (`permissions.ts:140-147,199`), so hospital staff cannot exercise NDPA rights through the product.

**(9) Tests.** Unit: `domain/consent.test.ts` (14), `domain/audit-areas.test.ts` (5), `lib/audit.test.ts` (1). Integration: `tests/integration/consent.test.ts` (consent grant/withdraw/audit; agreements: version recorded, no double accept, retired still readable, reused identifier, facility staff accept only FACILITY terms; DSR deadline, outcome required, refusal, start/close races; export contents/never-contains; erasure "can proceed for somebody with nothing outstanding"), `authorization.test.ts` (audit endpoint only: 403s, scope filter, SELF, paging, no before/after, trail-read event), `audit-coverage.test.ts`, `dashboard-summary.test.ts`.

---

### A3. `src/modules/notifications` — SMS only, one handler

**(1) Purpose.** Tell the practitioner and the hospital that a shift is confirmed (the only real notification), and record it.
**(2) Actors / permissions.** None: no routes (`routes.ts:13` `ROUTES = []`), `MODULE_PERMISSIONS = []`. It is driven by the worker.
**(3) Entities.** `notifications.messages` (`schema.prisma:1151-1169`): userId, channel, kind, masked recipient, body, related type/id, `sentAt`, `failureReason`. No state machine: `sentAt` set or `failureReason` set, never updated afterwards.
**(4) Flow.** `AssignmentConfirmed` event → worker → `notifyAssignmentConfirmed` (`handlers.ts:33-81`): load facility + assignment; practitioner message "Your shift at {facility} is confirmed: {YYYY-MM-DD HH:MM to HH:MM UTC}. Medilink." and a message to the facility **representative only** (72-80); each guarded by `alreadyNotified` (any prior row for user+kind+related, failed or not, 13-19) → `notify` (`notify.ts:31-57`): `trySendSms`, then insert the row with `sentAt`/`failureReason`.
**(5) API / jobs.** None. `notificationsFor` (`notify.ts:59-65`) has no caller.
**(6) Events.** Consumes `assignment.confirmed` only.
**(7) Rules.** `notify` never throws (`notify.ts:29-30` comment); recipient stored masked (`notify.ts:49`); handler idempotent per user+kind+assignment.
**(8) Stubbed.** All SMS gateways (A5); no email/push/WhatsApp/in-app; no templates, preferences, delivery receipts, retry, reminders, cancellation or licence-expiry messages. Times printed in UTC (`handlers.ts:21-27`). Failure recorded but handler returns normally → event PROCESSED (`processor.ts:88-96`) and `alreadyNotified` then blocks any later re-send.
**(9) Tests.** `tests/integration/assignments.test.ts:733-766` (two messages recorded per confirmation). Nothing tests a failed send or the time format.

---

### A4. `src/modules/config` — reference data (read-only)

**(1) Purpose.** One endpoint that feeds every dropdown (categories, specialties, credential types with who must hold them, facility types, states, LGAs, whether NIN/licence checks are automated).
**(2) Actors.** Any signed-in user; no permission (`reference/route.ts:23-33`, justified in its header 10-22).
**(3) Entities.** `config.professional_categories`, `specialties`, `credential_types`, `credential_requirements`, `facility_types`, `states`, `lgas`, `public_holidays`, `rate_floors`, `sanctioned_entries` (`schema.prisma:307-436`, 827-843). Every list carries an `owner` string. No state machines; `isActive` exists only on categories (312) and specialties (330).
**(4) Flow.** `getReferenceData` runs 7 `findMany`s in parallel (`reference.ts:47-78`), joins `requiredForCategoryIds` from `credential_requirements` (82-87), adds `verification.{identityAutomated,registrationAutomated}` (96-99). Browser caches 1 h in React Query (`lib/ui/reference.ts:29-35`).
**(5) Routes / jobs.** GET `/api/v1/reference`. No jobs.
**(6) Events.** None.
**(7) Rules.** Seed asserts 37 states / 774 LGAs (`seed.ts:228-234`; `nigeria.test.ts`). Rate floors are consumed by service-requests (`service-requests/application/request.ts:85-107,154-164`).
**(8) Gaps.** No writer anywhere (B20). No admin screen. `reference.ts` ignores `isActive`. No HTTP caching. The module has none of the standard folders (only `reference.ts` and a test).
**(9) Tests.** `src/modules/config/nigeria.test.ts` (8 cases on the geography file). Nothing tests `getReferenceData` or the endpoint.

**Seed content as shipped (`prisma/seed.ts`, `prisma/data/nigeria.ts`)**: 5 categories with regulators MDCN/NMCN/PCN/MLSCN/RRBN (35-50); 12 doctor + 3 nurse specialties, none for the other three (67-74); 6 credential types, all doctor/MDCN-oriented (99-107); credential **requirements for doctors only** (127-149); 7 facility types (194-203; no pharmacy or maternity home); 37 states + 774 LGAs incl. Gombe with 11 LGAs (`nigeria.ts:184-191`); 6 fixed 2026 public holidays (253-261; no Eid/Easter/2027); 4 "placeholder" rate floors, doctor and nurse × day/night (273-282); sanctions list empty by design (165-178); 6 scheduled jobs from `JOB_DEFINITIONS` (180-192). `seed.ts:14-15` imports from `../src` (see Docker gap B13).

---

### A5. `src/lib/**` — platform machinery

| File | What it does (as built) |
|---|---|
| `authz/permissions.ts`, `guard.ts`, `sync-roles.ts` | Catalogue, bundles, pure decision function, `loadGrants` per request (`guard.ts:73-87`), role sync (authoritative: removes permissions that left a bundle, `sync-roles.ts:18-57`). |
| `http/guarded-handler.ts` | Session → validate → step-up → permission+scope → action; wraps in `timed` (Server-Timing header on every guarded response, 166-197). |
| `http/request-context.ts`, `responses.ts`, `errors.ts` | `x-request-id`/`x-correlation-id` taken from headers or generated (`request-context.ts:19-20`); IP = first `x-forwarded-for` hop, unconditionally trusted (22); one error shape (`responses.ts:26`). `fail()` does not echo `x-correlation-id`. |
| `http/timing.ts` | In-memory per-process route stats (p50/p95/count/db time), read at `/admin/performance`; resets on restart (18-22). |
| `db.ts` | One `PrismaClient`, default pool; query timer via `prisma.$use` (28). |
| `audit.ts`, `audit-coverage.ts` | See A2. `audit-coverage.ts:191` also uses `$use`. |
| `outbox.ts`, `events.ts` | `publishEvent(tx, …)` (19-30), `MAX_ATTEMPTS = 8` (32), backoff `min(2^attempts × 5, 900)` s (35-38); 20 event names (`events.ts:5-26`), unversioned strings. |
| `sms/index.ts` | `SmsAdapter` interface (33-36); console adapter prints body and optionally appends to a file (43-67); `termii`/`africastalking` throw `SmsNotConfiguredError` (69-84,105-108); console refused outside local (99-104); `trySendSms` never throws and returns null on failure (113-125). `smsAdapter()` is called outside the `try` (114). |
| `storage/tigris.ts` | S3 client + separate presigning client for a browser-reachable endpoint (30-51); purposes (53-59); allow-list pdf/jpeg/png/webp/heic, 10 MB (61-69, 80-87); opaque keys `purpose/yyyymm/owner/uuid.ext` (71-78); signed PUT/GET, TTL default 300 s (89-121); `headObject` (124-126). No delete function. Content type is whatever the client declares. |
| `verification/index.ts` | NIN and professional-register adapters, default `none` (disabled → manual evidence), `sandbox`/`live` throw "not written yet" (83-133). |
| `env.ts`, `env-rules.ts` | Zod validation at boot (build phase relaxed, `env.ts:73-75`); non-local refusals (A1). `PLATFORM_FEE_BP` is not in the schema. |
| `password.ts`, `password-policy.ts`, `phone.ts`, `logger.ts` | Argon2id; policy; E.164 normalisation + mask; JSON logger (never logs bodies by convention). |
| `ui/*` | Client helpers (React Query keys, session context, reference cache). |

Tests: `authz/{guard,roles,step-up}.test.ts`, `env-rules.test.ts` (5), `http/timing.test.ts` (8), `password.test.ts`, `phone.test.ts`, `audit.test.ts` (1), `storage/tigris.test.ts` (5), `verification/verification.test.ts` (5), `ui/api.test.ts` (6). **No test** for `sms/index.ts`, `guarded-handler.ts` as a unit, `request-context.ts`, `outbox.ts` beyond integration.

---

### A6. `src/worker/**` — outbox worker and scheduled jobs

**(1) Purpose.** Deliver domain events after the originating transaction commits, and run recurring sweeps.
**(3) State machines.**
- `audit.outbox_events.status` (`schema.prisma:280-287`): PENDING → PROCESSING (claim, attempts+1, `processor.ts:44-52`) → PROCESSED | FAILED (backoff, `availableAt` pushed, 98-112) → PROCESSING again when due → DEAD_LETTER when `attempts >= 8` (`processor.ts:101-102`). Events with no registered handler → PROCESSED immediately with a warning (79-86). **PROCESSING after a crash is never reclaimed** (claim selects only PENDING/FAILED, 47-49).
- `audit.scheduled_jobs`: `claimDueJobs` sets `next_run_at = now() + interval` before running (`scheduler.ts:36-55`) so missed windows are skipped; result recorded as SUCCEEDED/FAILED with `failureCount`, `lastError`, `lastDurationMs` (`scheduler.ts:66-113`); `enabled` is an operator off-switch the seed never overwrites.
**(4) Loop (`worker/index.ts:24-58`).** One process: `runOnce` (batch 20, `processor.ts:26`) then, if 30 s have passed, `runDueJobs` — **sequentially in the same loop**; sleeps 2 s while busy (and for a minute after), 5 s when idle (`polling.ts:26-40`).
**(5) Jobs (all via `jobs.ts:31-68`):** `screening.sweep` daily; `credential.expiry_sweep` daily; `registration.expiry_sweep` daily; `practitioner.activation_sweep` daily; `service_request.expiry_sweep` hourly; `assignment.unhonoured_sweep` hourly. First start runs all six immediately (`ScheduledJob.nextRunAt` defaults to now).
**(6) Event handlers (3 of 20) — `worker/handlers.ts:20,38,42`:**

| Event | Published at | Handler |
|---|---|---|
| practitioner.registered | `auth/application/registration.ts:230` | `grantPractitionerRoleOnRegistration` + `screenPractitioner` |
| assignment.confirmed | `matching/application/assignment.ts:503` | `notifyAssignmentConfirmed` (SMS) |
| shift.completed | `attendance/application/attendance.ts:309,406` | `computeAndSaveTimesheet` |
| credential.submitted | `credentials/application/submission.ts:229` | none |
| credential.verified | `submission.ts:413` | none |
| credential.expired | `credentials/application/expiry.ts:56` | none |
| facility.verified | `facilities/application/facility.ts:451` | none |
| service_request.published | `service-requests/application/request.ts:272` | none |
| shift.invited | `matching/application/assignment.ts:158,191` | none |
| shift.accepted | `assignment.ts:263` | none |
| shift.started | `attendance.ts:309` | none |
| timesheet.submitted | `timesheets/application/timesheet.ts:218` | none |
| timesheet.approved | `timesheet.ts:286` | none |
| invoice.created | `billing-settlement/application/invoice.ts:247` | none |
| payment.completed | `invoice.ts:338` | none |
| payout.settled | `billing-settlement/application/payout.ts:207` | none |
| no_show.recorded | `assignment.ts:1065` | none |
| sanction.applied | `practitioners/application/screening.ts:140` | none |
| dispute.opened | `disputes/application/dispute.ts:209` | none |
| clinical_incident.reported | `clinical-incidents/application/incident.ts:177` | none |

All 20 declared events are published somewhere; 17 have no consumer. No publisher sets `idempotencyKey` (grep) and none passes `correlationId`.
**(7) Rules.** SKIP LOCKED claim; attempt counted before handler; 8 attempts; handlers must be idempotent (comment `handlers.ts:75-79`); two-worker test; one failing sweep does not stop others.
**(8) Not implemented.** Reclaim of stranded events; dead-letter view/alert/replay; heartbeat/liveness; alerting on `failureCount` (`docs/scheduled-jobs.md:71-73`); purge of processed events, sessions, OTPs, login attempts; reminders; early no-show detection; facility-licence expiry sweep; manual "run now".
**(9) Tests.** Unit `polling.test.ts` (6). Integration `outbox.test.ts` (retry, backoff, dead-letter at 8, rollback leaves no event, duplicate idempotency key refused, payload unchanged, unconsumed type not retried, two workers deliver once), `scheduler.test.ts` (claim, not-yet-due, disabled, skip missed windows, success/failure recording, one failure does not stop others, missing handler recorded, two workers run once, registry matches definitions), `worker-handlers.test.ts` (role granted exactly once across retried delivery). **No test** for the `ShiftCompleted` handler wiring, `AssignmentConfirmed` handler under a failing gateway, or loop-level starvation.

---

### A7. Docker, Compose, CI, scripts, docs, ADRs

- `Dockerfile` (1-44): stages base → deps → development → build → runner. **Runner (32-44)** copies `.next`, `public`, `node_modules`, `package.json`, `prisma` only (35-39), runs as uid 10001, healthcheck `curl /api/v1/health` (42-43), `CMD pnpm start` (44). No `src/`, so `pnpm worker` (`tsx src/worker/index.ts`, `package.json:24`) and `pnpm db:seed` (`tsx prisma/seed.ts`, imports `../src/...`) cannot run from it; no migrate step; no separate worker entrypoint.
- `docker-compose.yml`: local only. `web` runs `prisma migrate deploy && pnpm dev` (67); `worker` uses the development target (169-193); `e2e` and `demo` profiles run a production build inside the dev image (102-167); MinIO + mc init + Mailpit (SMTP unused by code). Credentials are literals (`medilink`).
- `.github/workflows/ci.yml` (one workflow): quality (lint, tsc, unit, 22-40), migrations (deploy, reset+deploy, seed, 42-74), integration (real Postgres, 76-107), security (`pnpm audit --audit-level high`, gitleaks, 109-129), e2e (build, `pnpm start` + `pnpm worker`, Playwright on Chromium, with `APP_ENV: local`, 131-187). No docker-build job, no deploy job, no scheduled run.
- `scripts/`: `bootstrap-demo.ts` (actors for `e2e.py`, local only), `seed-demo.ts` (3,013 lines; full pilot world via application functions), `reset-to-superadmin.ts` (wipes DB + bucket to one admin, local only), `e2e-world.ts`/`support/*` (Playwright fixtures), `e2e.py`/`simulate.py` (HTTP walks; simulate reports PASS/FAIL/GAP), `load-test.ts` (p95 budgets 300/750 ms, **4 concurrent × 40 requests, GET only**, 24-28), `page-budget.mjs` (Slow-4G browser budget), `seed-performance.ts` (`_perf` DB, 100 facilities/1,000 practitioners/100k audit rows), `prepare-test-db.ts`, `backup-drill.sh` (dump → restore → compare counts → `migrate status`; local compose only; its header cites `docs/backup-and-restore.md` which does not exist, line 16), `demo.ps1`, `smoke-auth.ps1`.
- `docs/scheduled-jobs.md`, `stage-4-2/3-4-4/4-5/4-6/4-8`, `stage-3-gate-checklist.md`, `adr/0001-0004` — summarised in E (stale items) and referenced in B. Gate checklist: items 3.1–3.8 all "Not started" except 3.7 "Scaffolded, partial" (`stage-3-gate-checklist.md:9-15`); 3.4 NDPC registration "Not started" (line 12); 3.9 CI "In progress" with "Staging and production deployment jobs still to be wired" (29-30). ADR 0001 (Postgres only), 0002 (Tigris, private bucket, signed URLs, 5 min), 0003 (Flutter after API stabilises), 0004 (Prisma; claims "a clear up/down story", but Prisma Migrate has no down migrations and CI "down" is `migrate reset`, `ci.yml:71`).

---------------------------------------------------------------------------------------------------

## B. Verification of redesign-doc claims against HEAD

Legend: CONFIRMED / ALREADY FIXED / NOT FOUND / PARTLY.

| # | Claim (redesign doc) | Verdict | Evidence |
|---|---|---|---|
| B1 | `revokeGrant` does not check the grant lies in the approved scope | **CONFIRMED** | `grants.ts:306-355`: loads the grant by id (313-317), runs only `assertMayRevoke` (319) — which returns immediately for any non-PLATFORM grant (246) — and updates (327-330). The route takes `scopeType/scopeId` from the request body (`grants/[id]/revoke/route.ts:25`; the UI sends them from the client, `staff-manager.tsx:157`) and the guard authorises *that claimed scope* (`guard.ts:45-71`). No comparison of `existing.scopeType/scopeId` with the claimed scope anywhere. A facility owner (holds `role.grant` at FACILITY A, `permissions.ts:199`) can revoke any facility's staff grant or any user's SELF `practitioner` grant by UUID, after a password step-up. Also revocable: a PLATFORM-scope `facility_administrator` grant (peer test at 258-262 passes because owner ≠ subset). No route-level cross-tenant test exists (A1 tests). |
| B2 | No IP/global rate limit; per-phone lockout is a DoS vector | **CONFIRMED** | No `middleware.ts` (`ls` of repo root and `src/`); `grep ratelimit|throttle` finds only account/phone logic. Login keyed on phone only (`login.ts:34-46`); IP merely recorded (`login.ts:123`). Lockout is sliding: each `locked_out` attempt is written as a failed row (`login.ts:44`) and the lock runs 15 min from the newest failure (`lockout.ts:44-52`; unit test "extends the lock when a locked-out user keeps trying"), so one request per <15 min from anyone keeps a victim locked indefinitely; a reset does not clear it (`recovery.ts:96-113` writes no `login_attempts` row). The same keyed-by-user budgets apply to OTP sends (`otp-service.ts:41-56`) so an attacker can exhaust a victim's 5 reset codes/hour. `register` creates a user row, 2 audit rows and an SMS for every valid-prefix number with no limit (`registration.ts:67-95`). `docs/stage-4-2-auth.md:100-101` admits the IP gap. |
| B3 | No CSP/HSTS | **CONFIRMED** | `next.config.mjs:24-36` sets only `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`; `poweredByHeader:false` (11). Grep for CSP/HSTS/`Strict-Transport` across source and config finds none; no middleware. |
| B4 | Resend route reveals registered numbers | **CONFIRMED** | `resend-code/route.ts:19-38`: unknown number → 202 always; known → `issueOtp`, which throws `otp_throttled` 429 inside the 60 s cooldown (`otp-service.ts:54-56`) — not swallowed here (contrast `recovery.ts:54-57`). Two quick calls: 202,202 = unknown; 202,429 = registered (and the first call sends the owner an SMS). The `register` route leaks the same way after a recent send. Further oracles: `reset-confirm` answers 422 `password_rejected` for a registered number but 400 `otp_invalid` for an unknown one before any code is checked (`recovery.ts:80-90`); `verify-phone` answers 403 `account_not_usable` for suspended accounts (`registration.ts:115-117`). |
| B5 | Password reset has no screen | **CONFIRMED** | `app/(auth)/` contains only `login/page.tsx` and `register/page.tsx`; no UI file references `reset-request`/`reset-confirm`/"forgot" (grep); the login page offers no link (`login/page.tsx:99-123`); the register page says "there is no way to reset a password from the interface yet" (`register/page.tsx:394-396`). Lockout message tells users to reset (`domain/errors.ts:26-28`). API exists and works (`recovery.ts`). |
| B6 | Sessions 14 days, no idle timeout, no purge job | **CONFIRMED** | `session.ts:10` (14 d), cookie expiry fixed at issue (`session.ts:66`); `Session` has no last-seen column (`schema.prisma:151-165`); `isSessionUsable` checks only revoked/expires (`session.ts:44-48`); no job in `jobs.ts:31-68` and no `delete`/`deleteMany` of sessions, OTPs, login attempts or outbox rows anywhere in `src`/`scripts` except local reset (grep). |
| B7 | OTP attempt counter is read-then-incremented (race) | **CONFIRMED** | `verifyOtp` reads the latest code (`otp-service.ts:125-128`), decides on the *read* `attempts` (`otp.ts:97`), then increments in a separate tx with an unconditional `increment: 1` (134-140). N parallel guesses all read the same count and all get evaluated. `consumeOtp` is correctly conditional (181-186), so a *correct* code cannot be double-spent; only guessing is affected. Verify routes are unauthenticated. |
| B8 | Facility self-registration makes the user `facility_owner` while unverified; `facility_owner` can look up users by phone | **CONFIRMED** | `facilities/register/route.ts:27-57` (any signed-in user; only limit is one PENDING facility at a time, 37-46) → `createFacility` creates the facility (status default PENDING, `schema.prisma:578`) and grants `facility_owner` at FACILITY in the same tx (`facility.ts:194,224-245`). `facility_owner` includes `role.grant` (`permissions.ts:199`); `GET /grants/find` is guarded by `role.grant` at the caller-named FACILITY scope (`grants/find/route.ts:15-24`) → `findUserByPhone` returns id, full name, phone, status for any registered number (`grants.ts:386-393`). Facility status is never consulted by the guard. Only mitigations: password step-up (`permissions.ts:77-83`) and no rate limit. (Matching side, outside this slice: `matching/application/match.ts:69-131` loads the facility only for state/LGA and `:163-178` returns `practitionerPhone`; I saw no status check there.) |
| B9 | Only 3 outbox events have handlers | **CONFIRMED** | `worker/handlers.ts:20,38,42` — see the table in A6. 17 of 20 events have none (the doc's §4.9 "eight" understates it). |
| B10 | SMS gateways throw "not implemented" | **CONFIRMED** | `sms/index.ts:69-84` (`SmsNotConfiguredError`: "…not implemented yet (Stage 4.7)"), selected for `termii`/`africastalking` at 105-108; console refused outside local (99-104) and at boot (`env-rules.ts:53-57`). |
| B11 | Failed SMS is recorded as handled and never retried | **CONFIRMED** | `trySendSms` returns null on error (`sms/index.ts:113-125`); `notify` stores `sentAt: null, failureReason` and returns (`notify.ts:42-55`); handler completes → event PROCESSED (`processor.ts:88-96`); `alreadyNotified` counts failed rows (`handlers.ts:13-19`) so even a manual re-run is suppressed; nothing scans `failureReason`. OTP sends ignore the result and report success (`otp-service.ts:87-96`). |
| B12 | Times printed in UTC | **CONFIRMED** | `notifications/application/handlers.ts:21-27` builds `YYYY-MM-DD HH:MM to HH:MM UTC` from `toISOString()`. (Dashboards use Africa/Lagos, `platform-summary.ts:~89`, `facility-summary.ts:93`; UI uses `en-NG`, `components/app/format.ts:9-45`.) |
| B13 | Production Docker image lacks worker source | **CONFIRMED** | `Dockerfile:32-44` (see A7). Worker command `tsx src/worker/index.ts` (`package.json:24`); `tsx` is present in `node_modules` (full install in `deps`, `Dockerfile:12-13`) but `src/` is not. Same for `prisma/seed.ts` (imports `../src/lib/authz/sync-roles`, `../src/worker/jobs`, `seed.ts:14-15`). The compose `web` service does the migrating (`docker-compose.yml:67`), the production CMD does not (`Dockerfile:44`). CI has no image-build job (`ci.yml` jobs: quality, migrations, integration, security, e2e), which is how this went unnoticed. |
| B14 | Stranded outbox events never reclaimed | **CONFIRMED** | `claimDueEvents` selects `status IN ('PENDING','FAILED')` (`processor.ts:47-49`) and sets PROCESSING (45); only `processEvent` moves a row out of PROCESSING (88-112). No timeout, sweep, heartbeat or reclaim anywhere (`grep PROCESSING` finds only schema, processor and docs). A worker killed mid-batch leaves up to 20 events permanently PROCESSING. |
| B15 | No deploy workflow | **CONFIRMED** | `.github/workflows/` contains only `ci.yml`; `stage-3-gate-checklist.md:29-30`: "Staging and production deployment jobs are still to be wired". |
| B16 | Erasure not implemented (only an assessment) | **CONFIRMED** | `data-subject.ts:411-431` (`assessErasure` returns blockers + explanation); `GET /me/erasure` is read-only (`me/erasure/route.ts:12-20`); `closeRequest` only records an outcome (177-219); no pseudonymisation code (`grep pseudonym|anonymi` finds only a comment in `domain/consent.ts`); nothing ever sets `User.deletedAt` or `DEACTIVATED`; no object-deletion function (`DeleteObjectCommand` only in `scripts/reset-to-superadmin.ts:20,78`). |
| B17 | Audit rows keep full names/email | **CONFIRMED** | `registration.ts:80` writes `after: { phone: maskPhone, fullName, email }`; redaction is by key name only and the list has no name/email/phone key (`audit.ts:31-48`); `facility.created`/`updated` audit `toView(facility)` incl. `contactPhone`/`contactEmail` (`facility.ts:74-98,221,385,443`); free text from data-subject requests and consent notes lands in `reason` (`data-subject.ts:109`, `consent.ts:118`). Audit readers also receive actor full names (`read-audit-trail.ts:117-131`). |
| B18 | Agreements not enforced at sign-up | **CONFIRMED** | No server gate: `currentAgreements`/`acceptAgreementAs` have exactly two caller routes (`agreements/route.ts:24,43`, `agreements/facility/route.ts:27,39`); `setPasswordSchema` has no acceptance field (`schemas.ts:36-41`); register page has no agreement/privacy step (grep); `consentToSharing` is optional on the server (`schemas.ts:40`) and mandatory only by a disabled button (`register/page.tsx:434`). Facility acceptance records the *person*: `AgreementAcceptance` has `userId` only (`schema.prisma:2020-2037`) and the route passes `session.userId`, using `facilityId` only for the scope check (`agreements/facility/route.ts:36-45`). No re-acceptance on a new version: `currentAgreements` only reports an `acceptedAt` flag (`consent.ts:218-253`). |
| B19 | Audit table append-only only by convention | **CONFIRMED** | `schema.prisma:230-231` ("No update or delete path exists in application code"); `EXEMPT_MODELS.AuditLog` says the same (`audit-coverage.ts:79-80`); no TRIGGER / REVOKE / RULE in any migration (grep over `prisma/migrations`: only `CREATE TABLE "audit"."audit_log"` and indexes); the app connects with one `DATABASE_URL` role; `scripts/reset-to-superadmin.ts` deletes audit rows (local). No hash-chain or tamper evidence. |
| B20 | Config vocabularies only changeable via seed | **CONFIRMED** | No `create/update/upsert/delete` on any `config.*` model in `src` (grep of `prisma\.(professionalCategory|specialty|credentialType|state|lga|facilityType|publicHoliday|rateFloor|credentialRequirement|sanctionedEntry)\.`); `src/modules/config` has no routes/permissions/application; `config.manage` governs nothing of the sort (A0). Seeding from the production image is impossible (B13). The sanctions list also has no writer (`seed.ts:165-178`). |
| B21 | Missing rate floor silently passes | **CONFIRMED** | `service-requests/domain/rate-floor.ts:78-83` `if (!floor) return { ok: true, minHourlyKobo: null }`; `resolveRateFloor` returns null when none applies (45-61); applied only when `!ok && minHourlyKobo !== null` (`request.ts:154-164`). Floors exist only for doctor/nurse × day/night with specialty `*` (`seed.ts:273-282`); pharmacist, lab scientist and radiographer have none. |
| B22 | Reference endpoint returns inactive rows / no caching | **CONFIRMED (inactive rows) / PARTLY (caching)** | `reference.ts:50-77`: no `isActive` filter although `ProfessionalCategory.isActive` (`schema.prisma:312`) and `Specialty.isActive` (330) exist; the other lists have no active flag. Server side: 7 queries and the full 774-LGA list per call (`reference.ts:47-78`), no `Cache-Control` (`reference/route.ts:23-33`). Client side: React Query keeps it 1 h per page load (`lib/ui/reference.ts:29-35`). Leftover duplicate "mandatory" flag also confirmed: `CredentialType.isMandatory` (`schema.prisma:347`) is still written by the seed (`seed.ts:101-106`) while the live rule is `CredentialRequirement` (`schema.prisma:821-839`). |
| B23 | Platform fee is the env var `PLATFORM_FEE_BP` | **CONFIRMED** | `billing-settlement/application/invoice.ts:43-46` reads `process.env.PLATFORM_FEE_BP` at call time, default `PLATFORM_FEE_UNSET_BP = 0` (`domain/ledger.ts:192`), applied at invoice draft (`invoice.ts:197`). Not in the Zod schema (`env.ts:9-62`) or `.env.example`, so it is unvalidated and unversioned. |

**Other redesign claims that touch this slice**

| Claim | Verdict | Evidence |
|---|---|---|
| Escalation check ignores scope | CONFIRMED | `grants/route.ts:35` flattens every grant's permission into one list; `grants.ts:144-146` compares against it. Holding `payout.manage` at facility A plus `role.grant` at B lets you hand out `payout.manage` at B. |
| Reset by SMS alone covers admin accounts; no second factor | CONFIRMED | `recovery.ts:21-123` has no role check; no MFA anywhere (`stage-4-8-step-up.md:89-90`). |
| Prisma hook that "may not exist in Prisma 6" | PARTLY (code facts confirmed; version fact is outside the repo) | `$use` at `lib/db.ts:28` and `lib/audit-coverage.ts:191`. Resolved version is 5.22.0 (`pnpm-lock.yaml:31`, `package.json` `^5.20.0`), where `$use` exists. That Prisma 6 removes it is from Prisma's release notes, not from this repo. |
| `/health` checks only the DB and is the container healthcheck | CONFIRMED | `health/route.ts:14-27`; `Dockerfile:42-43`. |
| No worker liveness; outbox loop shares a thread with sweeps | CONFIRMED | `worker/index.ts:32-40` (`await runDueJobs` inside the same loop); no heartbeat. |
| Squashed migration baseline is uncommitted | **ALREADY FIXED** | Tracked in git: commit `1fcabb9` (2026-10-13) "squash migration history into a baseline…"; `git ls-files prisma/migrations` lists 5 migrations + lock; tree clean. |
| Backup script cites a document that does not exist | CONFIRMED | `scripts/backup-drill.sh:16` → `docs/backup-and-restore.md`; `ls docs` has no such file. The drill is not run by CI. |
| Facility staff cannot use export/erasure routes | CONFIRMED | Those routes need `practitioner.profile.read/write` at SELF (`me/export/route.ts:19-20` etc.), absent from facility roles (`permissions.ts:140-147,199`). |
| Export omits disputes, incidents, notifications, attendance, timesheets, screening, sessions | CONFIRMED | Source list `data-subject.ts:335-370`. |
| No magic-byte check or malware scan on uploads; no object deletion | CONFIRMED | `tigris.ts:80-87` checks only the client-declared type and size; no delete function. |
| Pool is Prisma's default | CONFIRMED | `db.ts:12-16`; no `connection_limit` in env/compose. |
| NDPC registration, DPO, counsel opinion "not started" | CONFIRMED | `stage-3-gate-checklist.md:9-16`. |
| Stage documents are stale | CONFIRMED | See E. |

---------------------------------------------------------------------------------------------------

## C. Gaps found that the redesign doc did NOT mention

1. **`set-password` is not bound to the OTP step.** It needs only `phoneVerifiedAt` set and no password yet (`registration.ts:173-175`). Anyone who knows a number that has verified but not yet set a password (including abandoned sign-ups, forever) can call the unauthenticated route and set the password and `accountType` (`schemas.ts:36-41`). The real owner can recover only through reset. Contradicts the header claim at `registration.ts:12-17` and `docs/stage-4-2-auth.md:20`.
2. **Sliding lockout is extended by the lock itself, and reset does not clear it** (B2 detail). A locked-out legitimate user who keeps trying extends their own lock.
3. **Third parties can exhaust a victim's OTP.** `verify-phone` and `reset-confirm` need no authentication, and wrong guesses burn the victim's 5 attempts (`otp-service.ts:125-149`); a registrant cannot finish sign-up or reset until they request a new code (itself capped at 5/hour).
4. **Pre-squatting a number.** `register` creates the user with the caller's `fullName`/`email` for any valid-prefix number; for an existing user those fields are ignored (`registration.ts:48-65`), so the person who verifies the code later inherits whatever name was typed first.
5. **Dead OTP purposes.** A `LOGIN`-purpose code is texted to already-registered numbers on `register` (`registration.ts:56`) and nothing verifies it; `EMAIL_VERIFICATION` and `STEP_UP` are unused; email is never verified or sent; `SMTP_URL` unused.
6. **OTP SMS failure is invisible to the user** (`otp-service.ts:87-96` ignores the null result; the API says `code_sent`).
7. **Suspension does not revoke sessions**; it works because `currentSession` re-reads status (`session-service.ts:92`). A reinstated user's pre-suspension sessions become valid again (reinstate sets ACTIVE only, `suspension.ts:174`). There is no authenticated change-password, no session list, no "sign out everywhere" (`revokeAllSessions` has one caller).
8. **`revokeGrant` can be repeated:** no check of `existing.revokedAt` (`grants.ts:313-331`), so a second revoke overwrites the timestamp and writes another audit row.
9. **Client IP is spoofable and inconsistently captured:** first `x-forwarded-for` hop trusted unconditionally (`request-context.ts:22`); agreement acceptance stores the *whole header* (`agreements/route.ts:46`, `agreements/facility/route.ts:42`); this IP is later the "evidence of the act".
10. **Correlation ids are generated, returned and logged but never persisted:** no caller passes `correlationId` to `recordAudit` or `publishEvent` (grep), so `audit_log.correlation_id` and `outbox_events.correlation_id` are always null; `fail()` omits the `x-correlation-id` header (`responses.ts:26`).
11. **Outbox idempotency key is never used** by any publisher (grep); processed events are never purged; events with no handler are marked PROCESSED and a handler added later never sees history (`processor.ts:79-86`).
12. **Agreement versions with a future `effectiveFrom` leave nothing in force:** publishing stamps the old version `retiredAt = effectiveFrom` (`consent.ts:363-366`) but `currentAgreements` filters `retiredAt: null` AND `effectiveFrom <= now` (224-225) and `acceptAgreement` refuses any version with `retiredAt` set (262): until the new date, there is no acceptable agreement.
13. **Data-subject queue actions use a read permission:** `start`/`close` require `audit.read` (`data-requests/[id]/start|close/route.ts`, `routes.ts:39-40`).
14. **Route tables are not authoritative:** `auth/routes.ts` omits step-up, grants and users/find; `authorization.test.ts:347-380` only checks the audit-compliance table. Three catalogue permissions have no code path (A0).
15. **No production path to create the first super administrator** (A1 §8).
16. **CI cannot catch deployment-shape bugs:** no image build, e2e runs with `APP_ENV: local` (`ci.yml:138`), so the production env guards and the Dockerfile are untested. "Migrate down" in CI is `migrate reset` + `deploy` (`ci.yml:71`); ADR 0004's "clear up/down story" is not accurate for Prisma Migrate.
17. **Notifications go only to `facility.representativeUserId`**, not to staff (`handlers.ts:72-80`), and a failed send is permanent (B11).
18. **CSRF:** no token or Origin check; relies on SameSite=Lax (`session.ts:59-68`) and routes parse JSON regardless of content type (`guarded-handler.ts:60-65`, `handler.ts:22`). Not exploitable cross-site through cookies under Lax, but nothing protects against same-site origins.
19. **`Server-Timing` with DB query counts is returned on every guarded response** (`guarded-handler.ts:171`).
20. **Seed ships partial reference data that silently changes behaviour:** holidays only for 2026 (six fixed days) feed overtime/holiday pricing; sanction list empty means screening is "clear" for everyone (`seed.ts:157-178`) with no tool to fill it.
21. **`Reinstate` sets ACTIVE regardless of prior status** (`suspension.ts:174`), so an UNDER_REVIEW practitioner who is suspended and reinstated skips the activation sweep's gate (eligibility is still evaluated separately at matching).
22. **`StoredObject.checksumSha256` is never written** (grep `checksum` in `src` finds nothing outside tests); the spec lists checksum among the recorded metadata.
23. **In-memory performance stats are per process** (`timing.ts:18-22`); with 2+ web instances `/admin/performance` shows one of them.

---------------------------------------------------------------------------------------------------

## D. v2.9 spec vs code

Source: `scratchpad/v29/v29.md` (read as data). Spec numbering differs from the code's `module-map.md` (spec Module 15 = Notifications, 16 = Admin & Ops, 17 = Security/Privacy/Audit; code folders `notifications`, `audit-compliance`; spec Module 14 is incidents). Format: `[STATUS] requirement — evidence`. `OUT-OF-SLICE` marks criteria whose implementation lives in modules I was not assigned; I note only what I happened to see.

**Tally of the requirement lines below (counted, not estimated): IMPLEMENTED 14 · PARTLY 51 · MISSING 32 · DIVERGES 5 · OUT-OF-SLICE 1 (103 lines).** The 5 DIVERGES are the 8.2 event chain, the 8.2 no-cross-table-reads rule, 8.5 schema prefixes, 8.8 permission names/merged facility roles, and 9.11 refresh-token model.

### D1. Module 1 — Authentication and Access Control (v29.md:310-326)
- [PARTLY] Email and Nigerian phone registration with OTP verification — phone flow complete (`registration.ts:40-140`); email optional, stored, never verified or used (`schemas.ts:25`; `emailVerifiedAt` never written; `otp.ts:20` purpose unused).
- [IMPLEMENTED] Secure login — Argon2id (`password.ts:16-20`), timing-equalised (`login.ts:59-63`), lockout (`lockout.ts`), audited attempts (`login.ts:111-127`).
- [PARTLY] Password recovery — API complete (`recovery.ts`), revokes all sessions (115-120); no screen (B5); phone-only (`recovery.ts:11-13`).
- [MISSING] Optional multi-factor authentication — none; step-up is a password re-entry (`session-service.ts:185-254`, `stage-4-8-step-up.md:89-90`).
- [IMPLEMENTED] RBAC layered with granular permissions — `permissions.ts:6-58,185-220`, guard `guard.ts:45-71`; five roles (spec text predates the merge, see D8).
- [PARTLY] Session and device management — sessions: opaque, revocable, 14 d (`session.ts:10`, `session-service.ts:27-168`); no session list/"sign out everywhere"; `Device` model exists (`schema.prisma:169-178`) with no code.
- [PARTLY] Account suspension and deactivation — suspension implemented (`clinical-incidents/application/suspension.ts:95-99,174`; enforced per request `session-service.ts:92`); DEACTIVATED unreachable.
- [MISSING] Administrative impersonation with full audit trail — no code (grep `impersonat` empty).
- [IMPLEMENTED] Data: users, roles, permissions, user_roles, sessions, login_attempts — `schema.prisma:25-229`; `devices` present but unused.

### D2. Module 15 — Notifications and Communication (v29.md:624-632)
- [PARTLY] In-app, email, SMS, push, WhatsApp — only SMS code path, and no live gateway (`sms/index.ts:69-84,105-108`); in-app: table exists, no route/UI (`notify.ts:59-65` unused); email: `SMTP_URL` parsed only (`env.ts:39`); push: `Device.pushToken` unused (`schema.prisma:169-178`); WhatsApp: none.
- [PARTLY] Covers invitations, confirmations, reminders, cancellations, timesheet approvals, payments, disputes, licence expiry — confirmations only (`handlers.ts:33-81`); `shift.invited`, `timesheet.approved`, `payment.completed`, `dispute.opened`, `credential.expired` published with no consumer (A6 table); no reminder jobs (`jobs.ts:31-68`); no cancellation event or message.
- [PARTLY] Data: notifications — `notifications.messages` (`schema.prisma:1151-1169`) exists.
- [MISSING] Data: notification_templates, notification_preferences, notification_deliveries — no models (grep).

### D3. Module 16 — Administration and Operations (v29.md:634-646)
- [IMPLEMENTED] User and facility approval, credential review — `facilities/[id]/verify`, `credentials/[id]/review`, `practitioners/verification/*`, `practitioners/screening` routes (route list); queues on `dashboard/platform` (`platform-summary.ts:65-78`).
- [PARTLY] Request/payment monitoring — platform/facility/finance dashboards (`dashboard/*`); no alerting; performance report in memory (`timing.ts`).
- [IMPLEMENTED] Dispute management, account suspension — `disputes/*`, `users/[id]/suspensions|reinstate`.
- [MISSING] Risk flags — no model or route (module 25 is P1 in spec).
- [MISSING] Configuration management — seed only (B20).
- [PARTLY] Manual corrections always with a recorded reason — grant revoke needs a reason (`grant-schemas.ts:34`) but granting does not (`grants.ts:124-195`); attendance/timesheet corrections carry reasons (other slices).
- [PARTLY] Operational dashboards and exportable reports — dashboards yes; no report export of any kind (grep `csv` empty; only `GET /me/export` JSON).
- [IMPLEMENTED] Every action produces an audit record — `recordAudit` in-tx (`audit.ts:50-68`) + coverage harness (`audit-coverage.ts`); table-level matching only (`stage-4-5-audit-coverage.md:51-59`); reads go to `security_events`, not the audit log.

### D4. Module 17 — Security, Privacy and Audit (v29.md:648-664)
- [PARTLY] Role-based data access — permission + claimed scope on every guarded route (`guarded-handler.ts:110`); record-scope not verified in places (B1 and redesign list).
- [PARTLY] Encryption in transit and at rest — transit: `APP_URL` must be https outside local and cookies are Secure (`env-rules.ts:73-77`, `session.ts:63`) but no HSTS (B3); at rest: nothing in the repo (host-dependent); NIN stored as HMAC (`schema.prisma:669-675`).
- [PARTLY] Secure document access — private bucket, 5-min signed URLs, authorise-then-sign (`tigris.ts:115-121`, ADR 0002), access events in `security_events` (`credentials/application/submission.ts:669`, `facilities/application/facility.ts:552`); no malware scan or content sniffing (`tigris.ts:80-87`).
- [PARTLY] Consent records and privacy-policy acceptance — consent implemented (`consent.ts:59-164`); privacy-notice agreement kind exists (`schema.prisma:2010-2016`) but is not required at sign-up (B18).
- [IMPLEMENTED] Audit logs — `schema.prisma:232-258`, `read-audit-trail.ts`; weaknesses in B17/B19.
- [MISSING] Data-retention rules — no table, no purge job, no policy doc (grep `retention` in src/prisma empty; docs only the redesign file).
- [PARTLY] Account-data export — `data-subject.ts:320-402`, 13 sources, SELF practitioners only (B-extras).
- [PARTLY] Correction/deletion requests — requests recorded and queued with a 30-day clock (`data-subject.ts:82-296`); erasure only assessed (B16); rectification unfulfilled by code.
- [MISSING] Lawful disclosure route (MDCN/court/law-enforcement queries, authorising officer, data released, request itself auditable) — no model/route (grep `lawful|court|coroner|law enforcement` empty in source).
- [IMPLEMENTED] No standing/bulk access for external bodies — no external roles, API keys or integrations exist (by absence).
- [PARTLY] Security-event monitoring — `security_events` written for 3 read-access kinds only (`read-audit-trail.ts:146`, `submission.ts:669`, `facility.ts:552`); `login_attempts` kept; no monitoring or alerting.
- [MISSING] Data-breach workflow — none (only a comment at `schema.prisma:2108`).
- [PARTLY] Backup/disaster recovery — `scripts/backup-drill.sh` (local compose, not in CI, cites missing runbook, line 16); no schedule, PITR, or targets.
- [PARTLY] Data tables — audit_logs ✓, consent_records ✓, privacy_requests ✓ (`data_subject_requests`), security_events ✓; data_retention_rules ✗, breach_incidents ✗.

### D5. §8 Architecture (v29.md:204-296)
- [PARTLY] 8.1 Standard module structure — folders exist for every module (`docs/module-map.md`), but `infrastructure/` and `tests/` are `.gitkeep`-only for auth, notifications, audit-compliance; `config` has only `reference.ts` + a test; tests live in `domain/` (unit) and top-level `tests/integration`.
- [PARTLY] 8.2 Events with a Postgres outbox — outbox is transactional, SKIP LOCKED, backoff, dead-letter (`outbox.ts`, `processor.ts`); all 11 named events exist and are published (A6 table) but only `AssignmentConfirmed` among them has a consumer; stranded PROCESSING rows never reclaimed (B14).
- [DIVERGES] 8.2 Example chain ShiftAccepted → CreateAssignment → AddToSchedule → CreateTimesheet → SendConfirmation — acceptance publishes `shift.accepted` with no consumer (`assignment.ts:263`); the assignment is created by the facility's explicit confirm (`assignment.ts:~480-503`); timesheet is computed on `shift.completed` (`handlers.ts:38`), not at confirmation.
- [DIVERGES] 8.2 "Modules react to events rather than reading each other's tables" — cross-table reads: dashboards (`platform-summary.ts:4-22`), notifications reading facility/assignment (`handlers.ts:43-52`), matching reading facility (`match.ts:69`), erasure assessment calling billing (`data-subject.ts:5`); `module-map.md` states the rule.
- [PARTLY] 8.3 Provider adapters — SMS: interface + console + two throwing stubs (`sms/index.ts`); identity/registration verification: interface, default off, live stubs throw (`verification/index.ts:83-133`); storage: S3-compatible behind `lib/storage/tigris.ts`; payments: a function with a console stub and `PaymentGatewayUnavailable` for paystack/remita (`billing-settlement/infrastructure/gateway.ts:50-65`), not an interface with swappable classes, no Flutterwave, no bank-transfer provider (bank transfer is a manual mark-paid, `invoices/[id]/pay`).
- [MISSING] 8.3 Email, WhatsApp, maps/geolocation, video, analytics providers — none.
- [IMPLEMENTED] 8.5 PostgreSQL throughout, binary content in Tigris with key stored — ADR 0001/0002, `schema.prisma:16-17,441-456`.
- [DIVERGES] 8.5 Schema prefixes — 20 schemas but different names from the spec's examples (`identity, audit, config, storage, practitioners, credentials, facilities, availability, service_requests, matching, notifications, attendance, timesheets, cancellations_sanctions, disputes, clinical_incidents, suggestions, rates, billing, consent`, `schema.prisma:20`) instead of workforce/staffing/operations/finance/compliance/support.
- [IMPLEMENTED] 8.5 UUID ids, DB-level FKs/constraints — `schema.prisma:6-8` convention; unique indexes (e.g. `user_roles_one_live_grant`, baseline migration `:1833`).
- [PARTLY] 8.5 created_at/updated_at on every table — 56 `createdAt` and 24 `updatedAt` columns across 61 models (grep); append-only tables omit `updated_at`; some (e.g. `role_permissions`) have neither.
- [PARTLY] 8.5 Status history tables rather than overwriting — `AssignmentStatusHistory` (`schema.prisma:1130`), `TimesheetRevision`, `AccountSuspension`; user, facility, invoice statuses are overwritten and recorded only in `audit_log`.
- [PARTLY] 8.5 Soft deletion where auditable — `deletedAt` on 9 models (grep); nothing sets it on `User`.
- [IMPLEMENTED] 8.5 JSONB only for variable metadata — Json columns are audit before/after, outbox payload, security detail, match weights/factors, timesheet previous (`schema.prisma:242-243,265,295,1013,1032,1340`).
- [IMPLEMENTED] 8.5 Versioned migrations — `prisma/migrations` (5 after the squash), CI migrate up/reset/up (`ci.yml:42-74`).
- [PARTLY] 8.6 Categories, regulators, specialties, credential types as configurable records — stored as rows with owner (`schema.prisma:307-360`; `reference.ts`), each category has its own regulator and `CredentialRequirement`s; but no way to edit them (B20), requirements seeded for doctors only (`seed.ts:127-149`), nurse specialties are general/perioperative/midwifery (no ICU, `seed.ts:73`), shift type is a hard-coded DAY/NIGHT enum.
- [MISSING] 8.7 Configurable workflow engine (transitions stored in config; standard, emergency, long-term-contract flows) — all transitions are in code (e.g. `attendance/domain/state-machine.ts`, `matching/domain/assignment.ts`); no workflow table (grep).
- [DIVERGES] 8.8 Permissions not roles — granular keys exist and every check names one (`guarded-handler.ts:45`), but names differ from the spec's examples (`request.create`, `request.publish`, `assignment.approve`, `payment.release`, `credential.verify`, `dispute.resolve`, `report.export` vs `service_request.publish`, `assignment.confirm`, `payout.manage`, `credential.review`, `dispute.manage`; no create/export permission); and the spec's own example — a facility administrator and a facility finance officer with different capabilities — was merged away (`permissions.ts:89-113` "There were nine…"; `RETIRED_ROLES` 230-236).
- [MISSING] 8.9 Feature flags (`feature_flags` with key, enabled, rollout %, facility, state, environment) — nothing (grep `feature.?flag|rollout_percentage` empty).
- [IMPLEMENTED] 8.10 API versioning — everything under `src/app/api/v1/` including the four example resources; no v2 mechanism needed yet.

### D6. §9.10 Authorization and tenant isolation (v29.md:834-836)
- [PARTLY] Permission AND access to the facility/branch/department/assignment/payment/credential/case/incident — permission + *claimed* scope enforced (`guard.ts:45-71`); the record-belongs-to-scope check is per-route and missing for grant revoke (B1) and others in the redesign doc.
- [PARTLY] Facility-group hierarchy, branch and department access — scope types and ancestor logic exist (`schema.prisma:140-147`, `guard.ts:57-59`); no hierarchy models, no caller supplies ancestors.
- [PARTLY] Practitioner profile visibility — consent withdrawal removes a practitioner from matching (`consent.ts:178-194`); matching still returns phones (B8 note).
- [PARTLY] Finance access, compliance access, timesheet approval rights — separate permissions (`invoice.read`, `payout.manage`, `credential.review`, `timesheet.approve`); finance staff role merged into administrator/facility_administrator.
- [MISSING] Separation of duties for payment release — one permission raises, issues, marks paid, prepares and releases (`billing-settlement/routes.ts:18-25`); `Payout` records only `releasedBy`, no preparer (`schema.prisma:1952`; `payout.ts:131`). OUT-OF-SLICE detail.
- [MISSING] Break-glass access — none (grep).
- [PARTLY] Revocation when employment ends — grants revocable immediately with reason (`grants.ts:306-355`, effective next request `guard.ts:73-87`); no automatic offboarding; revoke has the scope hole in B1.
- [MISSING] Admin impersonation restrictions — no impersonation exists.
- [PARTLY] Authorization tests for every sensitive endpoint — `authorization.test.ts` is audit-endpoint only; `grants.test.ts` is function-level; `step-up.test.ts` covers step-up on `/grants`; no per-route cross-tenant suite (`stage-4-3-4-4-authorization.md:98-104`).

### D7. §9.11 Authentication and account security (v29.md:838-842)
- [IMPLEMENTED] OTP expiry, attempt limits, resend limits — `otp.ts:12-16`; attempt limit raceable (B7).
- [PARTLY] Rate limits by IP, device, phone and account — phone/account only (`login.ts:34-46`, `otp-service.ts:41-56`); IP recorded, never used; device none (B2).
- [PARTLY] Credential-stuffing protection — per-phone lockout only; no IP, global or breached-password checks (`password-policy.ts:22-25` is a 10-item common list).
- [PARTLY] Session rotation after login and privilege changes — new random token per login (`session.ts:20-23`); password reset revokes all sessions (`recovery.ts:115-120`); grant/revoke/suspension do not rotate or revoke sessions.
- [DIVERGES] Refresh-token rotation and revocation — no tokens or refresh flow; single opaque server-side session row, instantly revocable (`session.ts:3-8`).
- [MISSING] Suspicious-login detection — IP and UA stored (`session-service.ts:27-68`), never analysed (grep empty).
- [MISSING] Recovery paths that do not rely only on the registered phone — phone-only (`recovery.ts:11-13`); email never verified.
- [MISSING] Passkeys / authenticator-app MFA for administrator, compliance, finance — none; they use password + SMS reset.
- [PARTLY] Step-up before sensitive actions — enforced for `role.grant` and `payout.account.change` only (`permissions.ts:77-83`), password re-entry; `payout.manage` (money release) and suspension have none (`stage-4-8-step-up.md:94-97` leaves suspension out deliberately).
- [MISSING] Notification / cooling-off / review on phone, email, bank-detail or payout-account changes — no routes to change phone, email or bank details exist; `payout.account.change` has no route or model (A0).

### D8. §9.12 API, integration and event reliability (v29.md:844-848)
- [MISSING] Idempotency keys for request creation, assignment confirmation, payment initiation, payout, refund, webhooks — no `Idempotency-Key` handling in any route (grep); `OutboxEvent.idempotencyKey` is unique-indexed (`schema.prisma:~265`, test `outbox.test.ts:150`) but no publisher sets it.
- [MISSING] Webhook signature validation, replay protection, retries, reconciliation — no webhook route exists (`src/app/api` has only `v1`, none inbound-provider); `PAYSTACK_WEBHOOK_SECRET` only parsed (`env.ts:46`).
- [PARTLY] Dead-letter processing — outbox dead-letters at 8 attempts (`processor.ts:98-112`); no view, alert or replay (`stage-4-6-outbox-recovery.md:71-76`).
- [MISSING] Provider timeout rules, pending-state handling, outage mode, duplicate-payment prevention, manual recovery — SMS: no real adapter, no timeout; payments: stub only (`gateway.ts`); manual recovery is a manual mark-paid.
- [PARTLY] Correlation identifier on every request, event, provider call, ledger entry and audit record — generated/echoed/logged for requests (`request-context.ts:19-20`, `responses.ts:14`, `processor.ts:74`); columns exist on `audit_log` and `outbox_events` but nothing populates them (C10); none on ledger entries or provider calls.
- [MISSING] Versioned domain events — plain string names (`events.ts:5-26`), no version field in payload or schema.
- [PARTLY] Exactly-once business effects under duplicate delivery — at-least-once delivery with per-handler idempotency (role grant find-first `role-grants.ts`, `alreadyNotified` `handlers.ts:13-19`, timesheet recompute) and conditional OTP consume (`otp-service.ts:181-186`); no general mechanism, and lost-forever stranded events (B14).

### D9. §9.14 Data retention, deletion and legal hold (v29.md:856-860)
- [MISSING] Data inventory per category (purpose, legal basis, owner, retention, deletion method, legal hold, backup deletion, cross-border) — no inventory in code or docs; only `LawfulBasis` enum for consent purposes (`schema.prisma:2082-2094`).
- [PARTLY] Account deletion defined precisely (what is deleted vs retained) — policy intent written in `ERASURE_EXEMPT_REASON` and blockers (`domain/consent.ts:96-121`); nothing executes it (B16).
- [MISSING] Legal holds overriding deletion — no model or check (grep `legal.?hold` empty).

### D10. §9.15 Operational readiness, acceptance criteria, observability (v29.md:862-868)
- [MISSING] Operational readiness items (workload, SLAs, support hours, escalation, reconciliation ownership, staff training/background checks, access reviews, offboarding, outage and impersonation procedures) — no runbooks in repo; `docs/` has none (only `scripts/backup-drill.sh`).
- [PARTLY] Matching acceptance criterion (identity verified, credentials verified/unexpired, documents approved, no suspension, category/scope of practice) — eligibility rule exists and consent withdrawal excludes people (`consent.ts:178-194`); credential requirements are seeded for doctors only (`seed.ts:127-149`); scope-of-practice records absent. OUT-OF-SLICE for the rest.
- [PARTLY] Assignment-confirmation criterion (facility active+verified, eligible, no conflict, rate accepted, notifications queued, audit written) — `assignment.confirmed` is queued and audited in the confirming tx (`assignment.ts:503`); I did not find a facility-status check in the matching path I read (`match.ts:69-131`); other items OUT-OF-SLICE.
- [PARTLY] Payout criterion (approved timesheet, disputed amounts separated, authorization, verified payout account, unused idempotency key, ledger commit) — OUT-OF-SLICE; observed: no payout account model, no idempotency key (`schema.prisma:1939-1964`).
- [OUT-OF-SLICE] Serious-incident criterion (preserve records, matching restriction, notify officer, deadline, audit, restrict access) — I observed only that `clinical_incident.reported` has no consumer (A6), so no notification to the officer.
- [MISSING] Service objectives: availability target, RPO, RTO, backup frequency/encryption, restore-test frequency, failover, log retention, alert severity, on-call — none defined in repo (redesign §7 proposes RPO ≤15 min / RTO ≤4 h, not adopted).
- [MISSING] Tamper detection for audit logs — no hash chain, signature or DB immutability (B19).
- [PARTLY] Dashboards and alerts (registration conversion, verification turnaround, fill rate, cancellation, no-show, timesheet approval time, payment success, settlement delay, dispute age, notification delivery, queue failures, provider errors, credential-review backlog, suspicious logins) — partial dashboards: queue counts + oldest age, growth, usage, incident severity (`platform-summary.ts`), weekly fulfilment and spend (`facility-summary.ts`), finance summary; no alerting at all; no notification-delivery, queue-failure, provider-error, suspicious-login or verification-turnaround metrics.

### D11. §10 Non-functional requirements (v29.md:884-915)
- [MISSING] Assumptions register table (legal role, payment authorization model, NDPA obligations, engagement rules; all "Open") as a *live* register — only the Stage-3 gate checklist with owners/status (`stage-3-gate-checklist.md:9-16`); no review dates or system-impact column.
- [MISSING] 10.1 ≥10,000 concurrent users at launch scale — no evidence: load harness runs 4 concurrent × 40 GET requests (`scripts/load-test.ts:24-25`); default Prisma pool (`db.ts:12-16`); single worker; per-process stats.
- [PARTLY] 10.1 Sub-2-second for request submission and acceptance — measured budgets are p95 300/750 ms on read endpoints only (`load-test.ts:27-28,46-61`); no POST probes; `Server-Timing` helps diagnosis (`guarded-handler.ts:171`).
- [PARTLY] 10.2 All personal/professional/financial data encrypted in transit and at rest — see D4; no HSTS; nothing at rest in repo.
- [PARTLY] 10.2 NDPA compliance (consent, access control, encryption, audit logs, retention, breach management, DSR handling) — consent, access control, audit, DSR queue present; retention, breach, erasure absent (D4, D9).
- [MISSING] 10.2 NDPC registration as a data controller of major importance — gate item 3.4 "Not started" (`stage-3-gate-checklist.md:12`).
- [PARTLY] 10.2 Credential verification aligned with MDCN/NMCN etc. — manual officer review works; automated providers are stubs that throw (`verification/index.ts:83-133`); requirements seeded for doctors only (`seed.ts:127-149`).
- [PARTLY] 10.2 NIN/BVN collected only where necessary and via an authorised provider — NIN never stored raw (HMAC + last four, `schema.prisma:669-675`; export note `data-subject.ts:381-383`); no authorised provider integrated (default `none`).
- [PARTLY] 10.2 Payments only through licensed Nigerian partners — no partner integrated; console stub refused outside local (`gateway.ts:56-65`, `env-rules.ts:63-67`); payments are recorded manually.
- [PARTLY] 10.3 Usability for varied digital literacy — UI exists for all three consoles (`docs/interfaces.md`); readability issues in redesign §8 not re-checked here.
- [MISSING] 10.3 Comprehensive in-app help — no help pages (grep `help` in `src/app` finds only incidental text).
- [MISSING] 10.3 Multilingual support — English only (inline strings; `en-NG` formatting only, `components/app/format.ts`); spec says "planned for later phases".

---------------------------------------------------------------------------------------------------

## E. Stale documentation noticed in this slice

- `docs/stage-4-2-auth.md:91-93` says step-up has no enforcing route; contradicted by `guarded-handler.ts:102-108`.
- `docs/stage-4-8-step-up.md:22-24,92-93` says `role.grant` has no endpoint and no client prompt; both exist (`grants/route.ts`, `components/app/step-up.tsx`).
- `docs/stage-4-5-audit-coverage.md:37-46` lists four exempt tables; `audit-coverage.ts:78-109` has fifteen.
- `docs/stage-4-2-auth.md:66-68` and `registration.ts:35-39` claim identical responses for register/reset; B4 shows differences.
- `README.md` quick start tells new developers to run `prisma migrate dev --name init` against a repo that now has a squashed baseline.
- `scripts/backup-drill.sh:16` cites a runbook that does not exist.
- `docs/redesign-recommendations-2026-10-13.md` §4.9 says eight events lack consumers; the code has 17 (A6).
