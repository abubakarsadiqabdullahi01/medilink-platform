---
title: "MEDILINK"
subtitle: "Module Reference v3.0 — companion to the System Blueprint"
date: "13 October 2026"
---

# Contents

**How to use this reference**

**Summaries by area**

- Identity, access, notifications, compliance and platform
- Practitioners and credentials
- Facilities, availability, requests, matching and scheduling
- Attendance, timesheets, sanctions, disputes, incidents and suggestions
- Rates, billing, ledger and payouts
- The three consoles, the public site, accessibility and quality

**Chapters**

- Module 1 · Authentication and access control
- Module 2 · Practitioners
- Module 3 · Credentials
- Module 4 · Facilities
- Module 5 · Availability
- Module 6 · Service requests
- Module 7 · Matching and assignment
- Module 8 · Scheduling
- Module 9 · Attendance
- Module 10 · Timesheets
- Module 11 · Rates and contracts
- Module 12 · Billing, ledger and settlement
- Module 13 · Cancellations, no-shows and sanctions
- Module 14 · Disputes
- Module 15 · Clinical incidents
- Module 16 · Notifications
- Module 17 · Audit, consent and compliance
- Module 18 · Suggestions
- Module — · Reference data and configuration
- Module — · Platform and operations
- Console A · Practitioner
- Console B · Facility
- Console C · Operations
- Public site and sign-in
- Readability, accessibility and low-bandwidth
- Quality and delivery

**v2.9 module numbering vs repo numbering**

**Cross-module dependencies**

- Identity, access, notifications, compliance and platform
- Practitioners and credentials
- Facilities, availability, requests, matching and scheduling
- Attendance, timesheets, sanctions, disputes, incidents and suggestions
- Rates, billing, ledger and payouts
- The three consoles, the public site, accessibility and quality

**The shift-day state glossary**


# How to use this reference

This is the detailed companion to the *System Blueprint v3.0*. It holds **one chapter per module and console**, each in the same shape:

1. **Status, label and pilot maturity** — one line.
2. **Why it exists** — the real-world need.
3. **Who uses it** — roles and the permission-and-scope each needs.
4. **How it works today** — step by step, with the state tables.
5. **Rules the system enforces** — each one testable.
6. **What is not there yet** — every gap with an identifier, severity, source and `file:line` evidence.
7. **Recommended change (v3)** and 8. **Acceptance criteria**.

Chapters follow the repository's module numbers, with the v2.9 number beside each. Evidence is read from the code at commit `5c199c1`; nothing was run. Chapters refer to **Annex M1–M3** (money: one shift three ways, the money states, the fix order) and **Annex P1–P3** (roles and permissions, the event catalogue, scheduled jobs and boot guardrails); in the Blueprint these are **Appendices F, G, H and I**. Where a chapter says *the review said X; at HEAD it is fixed*, the review of 13 October said it was open and the code at HEAD shows it closed — it is recorded so that closed work is not re-opened.

**Gap sources:** `V2.9`, `REVIEW`, `NEW`, `V3` as in Part 5 of the Blueprint. **Severity:** P0 before the pilot; P1 before growth; P2 later.

# Summaries by area

## Identity, access, notifications, compliance and platform

- **What is solid.** Signing in is built carefully: one-time codes are stored as keyed hashes, passwords use Argon2id, an unknown phone number takes about as long to refuse as a wrong password, and a suspended person is locked out on their very next request. Every route that touches a record names a permission and a scope, and the audit trail has a test that fails the build if a change forgets to write its row. The outbox that carries events survives a failing consumer and two workers running at once. The server refuses to boot in staging or production with console SMS, a published secret or a non-https address.
- **What is dangerous.**
  - A hospital owner can revoke another hospital's staff by pasting a grant id. The guard proves the scope the caller names; `revokeGrant` never checks that the grant is in that scope.
  - The password step of sign-up is not tied to the code step, so anyone who knows a half-registered number can finish it.
  - A wrong-code counter can be beaten with parallel guesses, and nothing limits requests per IP address.
  - Anyone can register a "hospital" and, while it is unverified, look up any user by phone number.
  - Nobody can reset a forgotten password from the screen, and there is no way to create the first administrator in production.
- **What is silent.** The product's whole promise is replacing phone calls, yet only one of the 20 domain events sends a message (shift confirmed), and no real SMS provider exists. A practitioner learns of an offer only by opening the app. A failed text is recorded as handled and never retried. Times are printed in UTC.
- **What is missing for privacy law.** Erasure is only an assessment. Audit rows keep names and emails. Agreements are not required at sign-up. There is no retention schedule, breach process or lawful-disclosure route, and registration with the data-protection regulator, a privacy officer and counsel's opinion are all "Not started" in `docs/stage-3-gate-checklist.md`.
- **What cannot ship as built.** The production Docker image has no `src/` folder, so the worker and the seed cannot run from it. Nothing deploys, nothing alerts, stranded outbox events are never reclaimed, and backups are a local drill whose runbook does not exist.
- **Order of work.** Close the five access holes and the three platform blockers first (Phase 0), then give the pilot real messages, a real image, alerts and a backup you have restored once. Everything else in these chapters can wait for growth.

---

## Practitioners and credentials

- **What is solid.** Whether a practitioner may be offered work is decided by one pure, well-tested function that returns every reason at once, not the first. Identity is stored as a keyed hash plus the last four digits, never the NIN itself. An officer confirms a NIN or licence from the practitioner's own photograph in one click, and the number is never retyped. A practitioner cannot review their own documents. Every state change writes an audit row.
- **What is dangerous.**
  - Only doctors have document requirements. Nurses, pharmacists, laboratory scientists and radiographers are checked by identity, a regulator registration and screening only.
  - A doctor who renews an expired licence stays blocked (a bug found in this study, in none of the earlier reviews).
  - The sanctions list ships empty, so screening says "clear" for everyone.
  - Nobody is texted about a decision or an expiry.
  - The raw NIN sits in clear text in the database until an officer confirms it.
  - The platform has no idea of level, cadre, registration category, supervision or competence. A house officer and a consultant are the same person to it.
- **What facilities see.** Nothing about verification. The only trust signal a facility gets is that a person was ranked at all.
- **Where eligibility is checked.** At match time only. Invitations and confirmations do not re-check it (fix lives in Module 7).
- **Providers.** NIMC (identity) and the regulator register check are switched off, and every non-off setting throws. Manual officer review is the only live path, which suits a pilot of about fifty practitioners.
- **Order of work.** Fix the renewal bug, seed requirements for the other four professions, load the sanctions lists, mask the NIN, and add outbound notices (Phase 0). Build the level, registration-category and supervision model before any pilot data exists (Phase 1).

---

## Facilities, availability, requests, matching and scheduling

- **What is solid.** The matching engine is a pure, explainable function; every ranking is stored with its weights and factors. A request cannot be published below its rate floor or by an unverified facility. An accepted offer is not a booking — the facility must confirm — and the confirmation checks the practitioner's schedule under a lock. Every assignment change records who and why.
- **What is dangerous.**
  - The candidate list returns every practitioner's **name and full phone number**, ranked *and* excluded, to any facility user.
  - Two different practitioners can be confirmed onto the last place of one request at the same moment; at headcount 2 the request is then never marked filled.
  - Invitations, acceptances and confirmations never re-check licence, category, consent, the clock or the facility's own status.
  - Cancelling a filled shift leaves the people on it confirmed, and no screen can cancel one person.
  - Nobody is messaged when they are offered a shift.
- **What is missing for the v3 direction.** There is no level or cadre, no per-person rate, no counter-offer, no way for a practitioner to browse shifts, apply, or publish a priced availability, and no direct booking. The whole marketplace is one-way.
- **What facilities cannot do.** A rejected facility cannot recover; no screen uploads a licence; government hospitals and PHCs, which have no CAC number, cannot register honestly; there is no suspend action and no licence-expiry sweep.
- **Order of work.** Phase 0: strip contact details from matching, lock the request, re-validate at invite and confirm, make cancellation cascade, add notifications, fix facility recovery and licence upload. Phase 1: add the level model to requests so pilot data is born with it. Phase 2: the Booking, proposals and listings.

---

## Attendance, timesheets, sanctions, disputes, incidents and suggestions

- **What is solid.** Attendance has one transition table for its nine states, entered through a single function, with an exhaustive test over all 81 pairs. The check-in code is a six-digit secret that the facility issues and the practitioner presents. It is stored as a keyed fingerprint tied to one shift and one purpose, lives five minutes and dies after five wrong tries. Every correction to hours keeps the whole earlier version with who changed it and why. Nobody can be marked a no-show until a person has decided whose fault it was. Incident reports cannot be edited or withdrawn, and a suspension is written in the same transaction as the closure that ordered it. Suggestions from a declined offer are stored without the practitioner's name.
- **What is dangerous.**
  - **Check-in is not tied to the person it is for.** Any signed-in practitioner who hears the code on the ward can check in a colleague. The facility-side "issue a code" and "record by hand" functions do not check that the shift belongs to the facility asking.
  - **Dispute evidence is open to any practitioner.** Anyone can attach to, or download from, any live case by id, and the case list for a shift answers any caller. Nobody is told that a dispute was opened, decided or withdrawn. Facilities have no dispute screen and cannot even reach the evidence and withdraw routes.
  - **Money and disputes do not meet.** A dispute never holds a payout and never produces a credit note.
  - **The timesheet shows one figure and the invoice bills another.** The sheet is at base rate; the invoice adds premiums and, on a holiday night, drops minutes.
  - **A facility that never approves stalls the practitioner's pay.** There is no deadline.
  - **An incident can name any user.** Opening one restricts nobody. A death-severity report raises no alert.
  - **Suspension does not touch confirmed shifts.** The facility is not told, and the suspended person cannot sign in to explain an absence the sweep will flag.
- **What is missing against v2.9.** The sanction ladder, appeals, penalty rules, replacement search, optional location, a dispute hold on the disputed amount only, reversal entries, dispute deadlines and escalation, legal hold, and a suggestion status the submitter can see.
- **Where the code departs from v2.9 on purpose or by drift.** Excusals are decided by a platform officer, not by the facility. An incident restricts nobody when it is opened. "Suspended" means three different things. There is no compliance-officer role. Details are in Modules 13 and 15 and in the glossary at the end.
- **Nobody is told anything.** Of the seven events this slice raises, one has a handler (it computes the timesheet). A rejected timesheet, an opened dispute, a flagged no-show, a suspension and a suggestion answer reach no one unless they open the app.
- **Order of work.** Phase 0: bind check-in to the assignee and the facility, close the dispute-evidence and dispute-list holes, constrain the incident subject, add an alert and an interim restriction for serious incidents, give disputes a payout hold and a facility screen, set a timesheet deadline, make the timesheet show what will be billed, and detect no-shows at the start of the shift rather than after the end. Phase 1: notices, the ladder with appeals, practitioner withdrawal, and the author-visible suggestion status.

---

## Rates, billing, ledger and payouts

**What is solid.** Money is stored as whole kobo, never decimals. Every ledger step must add up to zero or it is refused. A shift can only be invoiced once (a database rule), invoices can only be built from hours the facility has already approved, and every status change on an invoice or payout is a guarded one-way step with an audit row. The minimum-rate check is correct for the doctor and nurse rates it has, and the premium maths (night, holiday, overtime, on-call) is clear and well tested.

**What is dangerous.**
- **Wrong amounts today:** a night shift that touches a public holiday is under-billed (a 24-25 December night shift loses 2 of its 12 hours), and a facility can change its premium rates between the shift and the invoice.
- **Money leaves too early:** practitioners are credited when a draft invoice is created, not when the facility pays, and a payout does not check that anyone paid.
- **Payouts are not safe:** two clicks at once can create two payouts for the same money, any gateway error is recorded as "nothing moved", and outside a developer laptop there is no setting under which a payout can complete at all.
- **No correction path:** an invoice cannot be voided, credited or reversed, and a dispute never touches the ledger.
- **The fee is not what the spec says:** it is taken from the practitioner, booked at draft, and set by an environment variable. It is 0% today, so nothing is lost yet, but it must not be switched on in this form.
- **Missing pieces:** no bank-account record, no tax fields, no statements, no reconciliation, no provider integration (authorise/capture), and the money columns overflow at ₦21,474,836.47.

The minimum fix order, with effort, is in Annex M3. The same shift worked three ways (as built, as v2.9 specifies, as v3 targets) is in Annex M1.

---

## The three consoles, the public site, accessibility and quality

- **What is solid.** Three consoles exist and cover the whole shift-to-payment journey for a practitioner, a facility and Medilink staff: 35 pages, one shared shell, one status-colour vocabulary, honest empty and error states, times in West Africa Time, and a permission-driven menu. Screens say what a button will do before it is pressed ("Accepting is not being confirmed", "Uphold — send the figures back"). The practitioner onboarding wizard and the officer's "confirm from the photograph" flow are good.
- **What is dangerous.**
  - Nobody is told anything. No offer, confirmation, decision or reminder reaches a practitioner or a facility unless they open the app, and the only SMS adapter that works prints to a log.
  - The marketplace is one way: a practitioner cannot see a shift, apply, or state a price.
  - A facility cannot upload a licence, edit its details or answer a rejection, and its registration form insists on a CAC number that most Gombe government hospitals and PHCs do not have.
  - A nurse, pharmacist, laboratory scientist or radiographer is asked for no documents at all.
- **What the public sees.** One landing page and two forms. No forgot-password screen, no pricing, terms, privacy or contact page, no phone or WhatsApp number, and developer text on the login page.
- **Readability.** Content is 14px and 12px on a 16px root, buttons are 36px, input borders are 1.31:1, the commonest status badge is 3.01:1, there is no larger-text or projector mode, no skip link, no service worker, and the web manifest has no icons.
- **Delivery.** About 1,050 automated test declarations and a five-job CI pipeline are in place. There are no component or accessibility tests, no deploy job, and the demo data contains nothing in Gombe. Several docs describe an older product, and the v2.9 spec and Implementation Plan are not in the repo.
- **Roles.** The spec has nine roles; the code has five. Separation of duties between compliance, operations and finance, and between a facility scheduler and a finance officer, no longer exists.
- **Order of work.** Phase 0: notifications and a deliverable SMS provider, the offer card's missing facts, document requirements for the other four professions, facility profile and licence upload, a CAC alternative, forgot-password, the public pages, and the readability fixes. Phase 1: levels in the profile and the shift form. Phase 2: shift board, applications, priced listings and proposals.

---

# Chapters

## Module 1 · Authentication and access control  *(repo folder `src/modules/auth`; v2.9 Module 1)*

**Status:** Partly built · **Label:** CURRENT + IMPROVE · **Maturity for a Gombe pilot:** Ready after P0 fixes — sign-in, sessions and the permission guard are sound and well tested, but one cross-tenant revoke hole, an unbound password step, no rate limits, no reset screen and no first-administrator path must be closed first.

**Why it exists.** A nurse in Gombe needs an account on their phone number, a ward manager needs to sign in on a shared hospital computer, and a hospital owner needs to give each colleague their own login. Medilink needs to know who did what, and to cut off a person's access at once when a clinical incident suspends them. Without this module, either nothing is protected or everyone shares one password.

**Who uses it.**

| Actor | What they do here | Permission @ scope |
|---|---|---|
| Anyone not signed in | Register, confirm a code, set a password, sign in, ask for a new code, reset a password | none (7 public routes, `src/modules/auth/routes.ts:19-27`) |
| Any signed-in user | See who they are and what they may do; sign out; re-enter their password to unlock a sensitive action | a valid session only (`session`, `logout`, `step-up` routes) |
| Practitioner (own record) | Everything about their own profile, credentials, shifts | `practitioner` role, scope SELF |
| Hospital owner (the MD) | Add a colleague by phone number, give them a role, remove them with a reason | `role.grant` @ FACILITY, plus a fresh password re-entry |
| Facility administrator | Run the hospital; cannot add staff | no `role.grant` (`src/lib/authz/permissions.ts:140-147`) |
| Platform administrator | Appoint and remove other administrators and facility owners; find a user by phone | `role.grant` and `user.read` @ PLATFORM |
| Super administrator | All of the above, plus appoint other super administrators; the only holder of `config.manage` | every permission @ PLATFORM |
| Worker (system) | Gives each new practitioner the `practitioner` role | system, on the `practitioner.registered` event |

**How it works today.**

1. **Register.** The person enters name, phone and optional email. The phone is converted to `+234…` form and only assigned mobile prefixes are accepted (`src/lib/phone.ts:22-50`). A pending account is created and a six-digit code is texted. If the number already exists, a code is texted anyway and the screen says the same thing (`registration.ts:40-96`).
2. **Confirm the code.** Wrong guesses are counted; a right code marks the phone verified in one transaction (`registration.ts:99-140`).
3. **Set a password.** Ten to 128 characters, not on a short common list, not containing the phone number, name or email name (`src/lib/password-policy.ts:7-61`). A practitioner becomes `UNDER_REVIEW` and an event is published; the worker then grants the practitioner role and screens the name. A "staff" account (a hospital owner or colleague) becomes `ACTIVE` with no role, no event and no screening (`registration.ts:147-239`).
4. **Sign in.** Five wrong passwords in 15 minutes lock the number for 15 minutes. A session cookie is set (`login.ts:15-96`). The screen then lands the person in the console that matches their grants.
5. **Forgot a password.** The API texts a code and, on confirmation, replaces the password and ends every session (`recovery.ts:21-123`). **There is no screen for it.**
6. **Sensitive actions.** Granting or removing a role asks for the password again, valid for five minutes (`src/modules/auth/application/session-service.ts:185-254`).
7. **Staff.** An owner types a colleague's phone, sees the name, chooses a role (administrator or owner) and the system records the grant; removal needs a written reason of five or more characters (`src/components/app/staff-manager.tsx:102-157`).

**The permission-plus-scope guard, in plain words.** Every action in Medilink needs two things at once, like a key card and a building pass. The key card is a **permission** such as "approve a timesheet". The pass is a **scope**: the whole platform, one facility, or "just me". A hospital owner in Gombe General holds `timesheet.approve` only for Gombe General. When they ask to approve a timesheet at another hospital, the guard looks for a grant that carries that permission and covers that facility, finds none, and answers "forbidden" without saying whether the other hospital exists. A platform grant covers every facility. A "just me" grant covers only the caller's own id. Roles such as "administrator" are only bundles of permissions; no code asks "is this an administrator?" (`src/lib/authz/guard.ts:45-71`, `src/lib/http/guarded-handler.ts:73-137`). For the two permissions that need a fresh password, the guard asks for it before it checks the permission, so nobody learns what they hold by being refused.
**What the guard proves, and what it does not.** It proves the caller holds the permission over the scope *the caller named in the request*. Each route must still check that the record belongs to that scope. The revoke route does not (AUT-01), and the review found the same shape in dispute evidence, incident subjects, check-in and invitations (other chapters).

State tables.

| Account status | Can go to | Triggered by |
|---|---|---|
| PENDING_VERIFICATION | UNDER_REVIEW | A practitioner sets a password (`registration.ts:188-199`) |
| PENDING_VERIFICATION | ACTIVE | A staff account sets a password |
| UNDER_REVIEW | ACTIVE | Daily activation sweep once the practitioner is eligible (Module 2) |
| Any status except SUSPENDED | SUSPENDED | An incident closed with "suspend" (Module 15, `src/modules/clinical-incidents/application/suspension.ts:95-99`) |
| SUSPENDED | ACTIVE | Reinstatement with a written reason (`suspension.ts:174`) |
| DEACTIVATED | — | **Set by no code path** |

| One-time code | Can go to | Triggered by |
|---|---|---|
| ISSUED | CONSUMED | Right code inside the same transaction as the change it authorises (`otp-service.ts:180-187`) |
| ISSUED | SUPERSEDED | A newer code for the same purpose (`otp-service.ts:63-68`) |
| ISSUED | EXPIRED / EXHAUSTED | Ten minutes pass / five wrong guesses (`src/modules/auth/domain/otp.ts:13-14`) |

| Session | Can go to | Triggered by |
|---|---|---|
| ACTIVE | REVOKED | Sign out; password reset (all sessions) |
| ACTIVE | EXPIRED | Fourteen days after sign-in (`src/modules/auth/domain/session.ts:10`) |
| ACTIVE | (suspended person's) refused | Account status checked on every request; the row is not revoked |

| Role grant | Can go to | Triggered by |
|---|---|---|
| LIVE | REVOKED | `role.grant` holder revokes with a reason; the row is kept (`grants.ts:326-331`) |
| REVOKED | — | A re-grant creates a new row; the old one stays as history |

**Rules the system enforces.**

- Phone numbers have one form (`+234` plus ten digits) and only assigned mobile prefixes are accepted (`src/lib/phone.ts:22-50`).
- A code is six digits, lives ten minutes, allows five wrong guesses, can be re-sent after 60 seconds and at most five times an hour per person per purpose; it is stored only as a keyed hash tied to the person and purpose (`src/modules/auth/domain/otp.ts:12-46,128-153`).
- Login throttling is derived from the database, not memory, so it survives restarts and several web servers (`src/modules/auth/domain/lockout.ts:7-53`); step-up shares the same counter (`session-service.ts:185-254`).
- An unknown number is checked against a dummy hash so timing does not reveal who is registered (`login.ts:59-63`).
- A suspended, deactivated or soft-deleted person is refused on every request, so suspension is immediate (`session-service.ts:80-99`).
- A password reset ends every session of that person (`recovery.ts:115-120`).
- The cookie is httpOnly, SameSite=Lax and Secure everywhere except local (`src/modules/auth/domain/session.ts:59-68`).
- Nobody can grant a permission they do not hold; nobody can remove platform authority they do not hold; peers cannot remove peers unless the actor holds everything; the last holder of `config.manage` cannot be removed (`grants.ts:144-146,241-304`).
- One live grant per person, role and scope, enforced by a database index (`prisma/migrations/20261007000000_baseline/migration.sql:1833`).
- Every grant and revoke is audited at the scope it affects (`grants.ts:172-182,332-342`).
- Every request carries a request id and a correlation id, returned in the response headers (`src/lib/http/request-context.ts:19-20`).

**What is not there yet.**

| ID | Gap | Sev | Source | Evidence |
|---|---|---|---|---|
| AUT-01 | `revokeGrant` never compares the grant's own scope with the scope the guard approved, and the route takes that scope from the request body. A facility owner can revoke any hospital's staff, or any user's own practitioner role, by id. | P0 | REVIEW | `src/modules/auth/application/grants.ts:306-355`; `src/app/api/v1/grants/[id]/revoke/route.ts:25` |
| AUT-02 | No limit per IP address or overall. `register` and `resend-code` create rows and send SMS for any valid-looking number without limit; the address is recorded and never used. | P0 | REVIEW | `src/modules/auth/application/login.ts:34-46`; `src/modules/auth/application/registration.ts:67-95`; `docs/stage-4-2-auth.md:100-101` |
| AUT-03 | The per-phone lockout can be used against a victim: every locked-out attempt is itself recorded as a failure and pushes the lock out another 15 minutes, and completing a password reset does not clear it. | P0 | REVIEW | `src/modules/auth/application/login.ts:43-45`; `src/modules/auth/domain/lockout.ts:44-52`; `src/modules/auth/application/recovery.ts:96-113` |
| AUT-04 | The password step is not bound to the code step. Anyone who knows a phone that has verified but not set a password (an abandoned sign-up stays claimable for ever) can set its password and account type. | P0 | NEW | `src/modules/auth/application/registration.ts:173-175`; `src/modules/auth/presentation/schemas.ts:36-41` |
| AUT-05 | The wrong-guess counter is read, judged, then incremented in a separate step. Parallel guesses all see the old count, so the five-try limit can be exceeded. Together with AUT-02 this removes the protection that makes a six-digit code safe; how many guesses fit in ten minutes was not measured. | P0 | REVIEW | `src/modules/auth/application/otp-service.ts:125-149`; `src/modules/auth/domain/otp.ts:97` |
| AUT-06 | Password reset has no screen and the login page has no "forgot password" link; the lockout message tells people to reset. A forgotten password locks the person out. | P0 | REVIEW | `src/app/(auth)/register/page.tsx:394-396`; `src/app/(auth)/login/page.tsx:99-123`; `src/modules/auth/domain/errors.ts:26-28` |
| AUT-07 | A signed-in user can register a facility and is made `facility_owner` at once, while it is still PENDING. That role carries `role.grant`, which opens a lookup of any registered user's name, phone and status by phone number. The guard never looks at facility status. | P0 | REVIEW | `src/modules/facilities/application/facility.ts:194,224-245`; `src/app/api/v1/grants/find/route.ts:15-24`; `src/modules/auth/application/grants.ts:386-393` |
| AUT-08 | No way to create the first super administrator in production: the role is never offered in the UI and the scripts that create one refuse to run outside local. | P0 | NEW | `src/modules/auth/application/grants.ts:73-79`; `scripts/support/demo.ts:27-34`; `docs/end-to-end.md:53` |
| AUT-09 | No Content-Security-Policy and no HSTS header; only four basic headers are set. | P0 | REVIEW | `next.config.mjs:24-36` |
| AUT-10 | No test calls a route as a user from another tenant. The only route-level isolation test covers the audit endpoint. The grants test calls the function directly and says the route's scope check protects it. | P0 | REVIEW | `tests/integration/authorization.test.ts:347-380`; `tests/integration/grants.test.ts:189-212` |
| AUT-11 | Registered numbers can be told apart from unknown ones: `resend-code` answers 429 only for registered numbers; `reset-confirm` answers a weak-password error only for registered ones; `verify-phone` reveals suspended accounts. | P1 | REVIEW | `src/app/api/v1/auth/resend-code/route.ts:19-38`; `src/modules/auth/application/recovery.ts:80-90`; `src/modules/auth/application/registration.ts:115-117` |
| AUT-12 | Sessions last 14 days with no idle timeout, and no job removes old sessions, codes or login attempts. | P1 | REVIEW | `src/modules/auth/domain/session.ts:10`; `src/worker/jobs.ts:31-68` |
| AUT-13 | Suspension does not revoke sessions (it works by re-reading status), so a reinstated person's old sessions come back to life. There is no sign-out-everywhere, change-password or session list for a signed-in user. | P1 | NEW | `src/modules/auth/application/session-service.ts:92`; `src/modules/clinical-incidents/application/suspension.ts:174` |
| AUT-14 | A password reset by SMS alone covers administrator and compliance accounts, and there is no second factor anywhere (v2.9 asks for authenticator or passkey for privileged roles). | P1 | V2.9 | `src/modules/auth/application/recovery.ts:21-123`; `docs/stage-4-8-step-up.md:89-90` |
| AUT-15 | The "cannot grant what you do not hold" check merges permissions from all scopes, so permissions held at one hospital count when granting at another. | P1 | REVIEW | `src/app/api/v1/grants/route.ts:35`; `src/modules/auth/application/grants.ts:144-146` |
| AUT-16 | Anyone can burn a victim's five code attempts (verify and reset-confirm need no sign-in), stopping their sign-up or reset until a new code is sent. | P1 | NEW | `src/modules/auth/application/otp-service.ts:125-149` |
| AUT-17 | The client address is the first `x-forwarded-for` value, trusted without a proxy check; agreement acceptances store the whole header. That address is later offered as evidence. | P1 | NEW | `src/lib/http/request-context.ts:22`; `src/app/api/v1/agreements/route.ts:46` |
| AUT-18 | The facility scheduler and finance roles were merged into one administrator. v2.9 §9.10 asks for separation of duties on payment release; today one permission raises, issues, marks paid, prepares and releases, and has no step-up. | P1 | V2.9 | `src/lib/authz/permissions.ts:89-113`; `src/modules/billing-settlement/routes.ts:18-25` |
| AUT-19 | Recovery relies on the registered phone alone. There is no route to change a phone or email, no officer-assisted recovery for a lost or swapped SIM, and email is never verified or used. | P1 | V2.9 | `src/modules/auth/application/recovery.ts:11-13`; `src/modules/auth/presentation/schemas.ts:25` |
| AUT-20 | `DEACTIVATED` is checked in six places and set by none; `users.deleted_at` is never written. There is no way to close an account. | P1 | NEW | `src/modules/auth/application/login.ts:81`; `prisma/schema.prisma:64-72` |
| AUT-21 | Revoking an already-revoked grant overwrites the timestamp and writes a second audit row. | P2 | NEW | `src/modules/auth/application/grants.ts:313-331` |
| AUT-22 | `register` creates a pending account with whatever name and email the caller typed for any number, so the real owner inherits them when they confirm. | P2 | NEW | `src/modules/auth/application/registration.ts:48-65` |
| AUT-23 | Dead code paths: a LOGIN-purpose code is texted to registered numbers and nothing verifies it; EMAIL_VERIFICATION and STEP_UP purposes are unused; `SMTP_URL` is read and unused. | P2 | NEW | `src/modules/auth/application/registration.ts:56`; `src/modules/auth/domain/otp.ts:18-23`; `src/lib/env.ts:39` |
| AUT-24 | Not built, per v2.9: device management (the table is unused), suspicious-login detection, administrator impersonation, break-glass access. | P2 | V2.9 | `prisma/schema.prisma:169-178`; `src/modules/auth/application/session-service.ts:27-68` |
| AUT-25 | No CSRF token or Origin check; protection rests on SameSite=Lax and routes parse JSON whatever the content type. | P2 | NEW | `src/modules/auth/domain/session.ts:59-68`; `src/lib/http/guarded-handler.ts:60-65` |
| AUT-26 | The route tables are not complete: `auth/routes.ts` omits step-up, grants and users/find, and three permissions (`user.suspend`, `facility.user.manage`, `payout.account.change`) have no code path. | P2 | NEW | `src/modules/auth/routes.ts:19-35`; `src/lib/authz/permissions.ts:6-58` |

*Already fixed.* None of the review's authentication claims has been fixed at HEAD; each was re-read and still stands. One thing the review did not claim is worth recording as closed: re-granting a role after it was revoked used to fail with a database error, and now works (`prisma/migrations/20261012120000_regrant_after_revoke`, test `tests/integration/grants.test.ts:216`).

**Recommended change (v3).**

*Phase 0, make it safe.* In this order: (1) AUT-01, compare the grant's own scope with the approved scope and refuse on any difference, then add a cross-tenant refusal test for every route that takes an id (AUT-10), starting with grants, disputes, incidents and check-in. (2) Bind the password step to the code step with a single-use proof issued by the verify step (AUT-04). (3) Make the attempt counter a single conditional update (AUT-05). (4) Put rate limits at the edge (CDN or proxy) per IP and overall, add trusted-proxy handling (AUT-17), and change the phone lockout into a slowing delay that does not extend itself and is cleared by a completed reset (AUT-02, AUT-03). (5) Build the forgot-password screen, but only after a real SMS provider exists (NOT-02). (6) Gate the facility owner's powers on VERIFIED status and replace the phone lookup with an invitation the colleague accepts (AUT-07). (7) Add a one-off, logged "create first administrator" command in the production image (AUT-08, depends on PLT-01). (8) Add CSP and HSTS (AUT-09).

*Phase 1, Gombe pilot.* Uniform responses on every public route (AUT-11); an idle timeout and absolute lifetime for sessions, revoke sessions on suspension and password change, and a purge job (AUT-12, AUT-13). Officer-assisted recovery for a lost phone (AUT-19). A second factor for administrator and finance accounts (AUT-14).

*Phase 2 and later.* Re-split the merged roles by permission bundle, not by code: a platform finance role that can prepare but not release, a facility finance role, and maker-checker on payouts (AUT-18). Two-sided booking adds permissions to publish a priced availability listing and to accept a booking, held by `practitioner`, plus a separate consent for listings (Module 17). Device management and suspicious-login alerts when volume justifies them (AUT-24).

**Acceptance criteria.**

1. Given an owner of Hospital A, when they revoke a grant that belongs to Hospital B, then the request is refused with 403 and the grant is unchanged; the same holds for a practitioner's own role.
2. Given a phone that has verified its code but not set a password, when anyone calls set-password without the single-use proof, then it is refused.
3. Given 50 parallel wrong guesses against one code, when they all complete, then at most five were evaluated and the code is dead.
4. Given one IP address sending 20 sign-up or sign-in requests in a minute, when it sends more, then it is slowed or refused regardless of the phone number used.
5. Given a locked-out user who completes a password reset, when they sign in with the new password, then they are let in.
6. Given a registered and an unregistered number, when either is sent to resend-code, reset-request, reset-confirm or verify-phone with the same input, then the responses are identical in status, body and timing class.
7. Given a facility that is PENDING, when its owner calls the phone lookup, then it is refused; once VERIFIED, they can invite a colleague who must accept before holding any role.
8. Given a production deployment with no administrator, when the first-administrator command runs once, then exactly one super administrator exists, an audit row names the operator, and a second run is refused.

---

## Module 2 · Practitioners  *(repo folder `src/modules/practitioners`; v2.9 Module 2)*

**Status:** Partly built · **Label:** CURRENT + NEW EXPANSION · **Maturity for a Gombe pilot:** Ready after P0 fixes — the doctor path works end to end, but the renewal bug, the empty sanctions list and the missing level and supervision model must be fixed before pilot data exists.

**Why it exists.** A nurse in Gombe wants to be trusted without phoning around; a ward manager wants to staff a night shift without checking a stranger's papers. This module holds who the practitioner says they are, what a Medilink officer has checked, and the single rule that says "safe to offer work". Without it, anyone could be matched to a shift, including a struck-off or unlicensed person.

**Who uses it.**

| Actor | What they do here | Permission @ scope |
|---|---|---|
| Practitioner | Create and edit their profile, upload a photo, submit for review, read their own eligibility and verification | `practitioner.profile.read` / `practitioner.profile.write` @ SELF (`src/lib/authz/permissions.ts:116-122`) |
| Administrator (compliance and operations merged) | Work the "waiting for approval" queue, record identity and registration, clear a sanctions flag, read anyone's eligibility | `practitioner.profile.read` and `credential.review` @ PLATFORM (`src/lib/authz/permissions.ts:172-183`) |
| Facility staff | Nothing here. They see a ranked name and score through Matching | none held (`src/lib/authz/permissions.ts:140-147`) |
| Worker (system) | Grants the practitioner role, screens names, runs the nightly sweeps | system |
| Incident officer (Module 15) | Suspends or reinstates the account; this module's rule reads that status | `incident.manage` @ PLATFORM |

**How it works today.**

1. **Sign-up.** The practitioner registers by phone, verifies a code and sets a password. The account becomes `UNDER_REVIEW` and an event `practitioner.registered` is published (`auth/application/registration.ts:193-232`). The worker then grants the `practitioner` role at SELF scope and screens the name against the sanctions lists (`worker/handlers.ts:42-51`, `practitioners/application/role-grants.ts:19-63`).
2. **Profile.** A four-step wizard on `/practitioner/profile`: details, availability, documents, review. Details are profession (one of five), one optional specialty, years of experience, bio, home state and LGA, how far they will travel (own LGA, own state, anywhere), and an optional photo.
3. **Submit for approval.** The server refuses until there is a profile, at least one availability slot and a live submission for every document the profession requires. A document still waiting for review counts as supplied; a rejected one does not. Pressing submit twice changes nothing (`application/application-review.ts:27-96`).
4. **Officer queue.** `/admin/practitioners` opens on "Waiting for approval", longest-waiting first (`application/directory.ts:78-81,111-114`).
5. **Confirming evidence.** For a NIN the officer reads the slip photo and says whether the name matches the account; for a licence the officer says what it shows and optionally the printed expiry date. One click records the identity or registration and decides the submission (`application/confirm-from-submission.ts:73-175`). A name mismatch is recorded as a fact and the practitioner is asked to correct it; a licence that is not active is recorded as it is and the submission rejected with the reason. A "Record by hand" form exists for people who have submitted nothing.
6. **Eligible.** The rule runs live whenever it is asked. The practitioner sees "Can be offered shifts" the moment it returns no blockers. A daily sweep later flips the account label from `UNDER_REVIEW` to `ACTIVE`; the label changes nothing, because the rule accepts both.
7. **Ongoing.** A nightly sweep re-screens everyone with a profile; two more expire licences and credentials; regulator evidence goes stale 365 days after the officer recorded it.
8. **Suspension (Module 15).** Closing an incident with the outcome "practitioner suspended" sets the account to `SUSPENDED` in the same transaction (`clinical-incidents/application/suspension.ts:80-125`). The rule's first blocker then fires, matching drops them at once, and they cannot sign in (`auth/application/session-service.ts:92`). Reinstating sets the account to `ACTIVE` (`clinical-incidents/application/suspension.ts:174`).

State tables. The application state is derived, not stored; the only stored fact is the "submitted for review" time (`prisma/schema.prisma:484`).

| Application state | Can go to | Triggered by |
|---|---|---|
| DRAFT | READY | Profile, one availability slot and every required document are in (`domain/application-review.ts:40-49`) |
| READY | WAITING | Practitioner presses submit |
| WAITING | APPROVED | The rule returns no blockers (officer confirmations plus clear screening) |
| WAITING | CHANGES_NEEDED (screen only) | Officer rejects a **required** document; this clears the submitted time (`application-review.ts:117-150`) |
| CHANGES_NEEDED | WAITING | Replacement document live and the practitioner submits again |
| APPROVED | WAITING | A blocker reappears (expiry, stale evidence, suspension); the label drops because it is derived (`src/lib/ui/practitioner.ts:186-194`) |

| Registration status | Can go to | Triggered by |
|---|---|---|
| ACTIVE, SUSPENDED, EXPIRED, STRUCK_OFF, UNKNOWN | any of the others | Officer records or re-records it (no transition guard, `application/verification.ts:272-307`) |
| ACTIVE | EXPIRED | Daily sweep when the recorded expiry date has passed (`application/expiry.ts:22-35`) |

| Screening result | Can go to | Triggered by |
|---|---|---|
| (none) | CLEAR or FLAGGED | First screen at registration |
| CLEAR | FLAGGED | Nightly sweep finds a new match (`application/screening.ts:173-192`) |
| FLAGGED | CLEAR | Officer clears it with a reason of 20 or more characters, or the sweep no longer finds a match |
| (PENDING) | — | The value exists but no code ever writes it; a missing row is treated as "not clear" |

| Account status | Can go to | Triggered by |
|---|---|---|
| PENDING_VERIFICATION | UNDER_REVIEW | Password set (`auth/application/registration.ts:193`) |
| UNDER_REVIEW | ACTIVE | Daily activation sweep when eligible (`application/eligibility.ts:242-268`) |
| UNDER_REVIEW, ACTIVE | SUSPENDED | Incident closure (Module 15) |
| SUSPENDED | ACTIVE | Reinstatement with a written reason (Module 15) |
| DEACTIVATED | — | Set by no code path |

Identity has no status. There is one row per person: a hash, the last four digits, a "name matches" flag, who recorded it and when.

**Rules the system enforces.**

- One profile per account; a second create is refused (409). A category must be active; a specialty must be active and belong to the chosen category; the home LGA must sit in the home state (`application/profile.ts:65-100`).
- Years of experience 0–60; bio at most 1,000 characters (`domain/profile.ts:7-9`).
- A practitioner cannot record their own identity or registration. Those routes are PLATFORM-only, and an officer cannot review their own submission (`application/confirm-from-submission.ts:65`).
- A NIN is exactly 11 digits. It is stored only as a keyed hash plus the last four digits, is unique across accounts, and never appears in the audit trail (`domain/verification.ts:11-45`; `schema.prisma:675`).
- A folio number is stripped of spaces and upper-cased, and is unique across the whole platform. A practitioner holds at most one registration per regulator (`schema.prisma:710,726`).
- The officer must say whether the name matched and what the register showed; there is no default in the confirm path. `UNKNOWN` is not "active" (`domain/verification.ts:94-102`).
- Regulator evidence older than 365 days is stale; the boundary is inclusive (`domain/verification.ts:69-77`).
- Screening names ignore titles and word order, so "Amina Yusuf" equals "Yusuf Amina". A folio match is reported ahead of a name match. An officer's clearance covers one list entry only; a different entry flags again (`domain/screening.ts:38-48,77-99`; `application/screening.ts:93-98`).
- Someone who withdrew consent to be shown to facilities is left out of match candidates entirely (`application/candidates.ts:65-75`).
- Suspension takes effect immediately everywhere, with no sweep, because `SUSPENDED` is a blocker.

**The eligibility rule, in plain English.** One function, `eligibilityBlockers`, returns every reason at once (`src/modules/practitioners/domain/eligibility.ts:52-100`). A person is eligible when the list is empty. The 5,000-profile property test asserts that nobody missing identity, an active registration or a clear screening can ever pass (`domain/eligibility.test.ts:239`).

| # | Blocker | What it means | Who can clear it | Evidence |
|---|---|---|---|---|
| 1 | `account_not_usable` | The account is still being set up, suspended or closed. `UNDER_REVIEW` and `ACTIVE` both pass. | Finish sign-up; or the incident officer reinstates | `domain/eligibility.ts:60-62` |
| 2 | `profile_incomplete` | No profile exists. | Practitioner | `:64` |
| 3 | `identity_unverified` | No officer has recorded the NIN against this person. | Officer | `:66-67` |
| 4 | `identity_name_mismatch` | The officer recorded that the name on the NIN slip does not match the account name. | Practitioner corrects and resubmits; officer re-records | `:68-71` |
| 5 | `registration_missing` | No registration on record with the regulator for the person's profession. The regulator is taken from the profession, and the text must match exactly. | Officer | `:74-75`; `application/eligibility.ts:111,149-153` |
| 6 | `registration_not_active` | The registration is suspended, expired, struck off or unknown, or its recorded expiry date has passed. | Officer, after the practitioner renews | `:77`; `domain/verification.ts:94-102` |
| 7 | `registration_evidence_stale` | The register check on file is 365 days old or more, counted from the day the officer recorded it. | Officer re-checks | `:78-84` |
| 8 | `credential_expired` | A document the profession requires has expired. See PRA-08: this blocker does not clear after renewal. | Practitioner renews, once PRA-08 is fixed | `:90-91` |
| 9 | `credential_missing` | A required document is not verified: not sent, waiting, queried or rejected. | Practitioner and officer | `:93-94` |
| 10 | `screening_not_clear` | No screening result, or the name or folio matches a sanctions or "quack" list entry that an officer has not cleared. | Officer | `:97-98`; `domain/screening.ts:112-113` |

Not in the rule: availability and consent (applied separately), indemnity cover, level or cadre, scope of practice, and incident history other than an actual suspension. The rule is read at match time (`application/candidates.ts:65-83`), at the practitioner's own screens and by officers. It is not read at invitation, acceptance or confirmation.

**The review said X; at HEAD it is partly fixed.** The review said the licence's printed expiry is not captured. At HEAD the officer can enter it on the registration (optional) and the rule enforces it live (`admin/practitioners/evidence-review.tsx:489-500`). The review said practitioners are not told of a rejection. At HEAD a refused required document shows a red "your application was sent back" card with the reviewer's note when they open the app (`app/practitioner/profile/returned-notice.tsx`); no message is sent.

**What is not there yet.**

| ID | Gap | Sev | Source | Evidence |
|---|---|---|---|---|
| PRA-01 | No level, cadre or grade anywhere: not on the profile, the shift request, the rate floor or the matching engine. A house officer and a consultant are the same to the platform. | P0 | REVIEW | `prisma/schema.prisma:466-497`; `matching/domain/engine.ts:135-146` |
| PRA-02 | No structured registration category (provisional, full, intern, post-basic register) and no supervision requirement. The only candidate field is a free-text `practice_type`, settable only through the API and read by nothing. | P0 | V3 | `schema.prisma:711`; `application/verification.ts:248` |
| PRA-03 | One optional specialty; no skill or competency set, no subspecialty. A request that names a specialty excludes anyone whose single specialty differs, including people who have none. Specialties are seeded for doctors (12) and nurses (3) only. | P1 | REVIEW | `schema.prisma:470`; `matching/domain/engine.ts:143-146`; `prisma/seed.ts:67-74` |
| PRA-04 | Experience is a self-declared whole number (0–60) with no evidence and no "practising since" date. Matching caps it at 10 years for scoring. | P1 | REVIEW | `domain/profile.ts:7-8`; `matching/domain/engine.ts:46,174-175` |
| PRA-05 | A folio number is unique across **all** regulators, so a doctor and a nurse with the same digits collide. It should be unique per regulator and folio. | P1 | REVIEW | `schema.prisma:710` |
| PRA-06 | The regulator on a manually recorded registration is free text (2–20 characters) and must equal the profession's regulator string exactly. A typo or different case silently leaves the practitioner blocked at `registration_missing`. The confirm path avoids this by taking the regulator from the profession. | P1 | REVIEW | `presentation/schemas.ts:97`; `application/eligibility.ts:120-121,152` |
| PRA-07 | Changing category, specialty, years or home area after approval does not return the application for review. A category change breaks eligibility only by accident (no registration for the new regulator). | P1 | REVIEW | `application/profile.ts:235-290`; `tests/integration/application-review.test.ts:266` |
| PRA-08 | **Renewing an expired credential never clears `credential_expired`.** The old EXPIRED row stays, and the rule flags any expired required type even when a newer VERIFIED row exists. Every doctor whose first licence credential lapses stays blocked after renewing. Found by reading; no test covers it. | P0 | NEW | `domain/eligibility.ts:90-91`; `application/eligibility.ts:85-88,164-170` |
| PRA-09 | A credential's lapse is enforced only after the daily sweep marks it EXPIRED, up to a day late. The loader never reads the credential's expiry date. The code comments and stage docs say the opposite; that is true only for registrations. | P1 | NEW | `application/eligibility.ts:85-88`; `credentials/application/expiry.ts:15-21` |
| PRA-10 | The raw NIN sits in clear in `credential_submissions.reference_number` from submission until an officer confirms. It is masked only on the confirmed path, so a rejected, queried or mismatched submission keeps it whole. | P0 | NEW | `application/confirm-from-submission.ts:96-118`; `credentials/application/submission.ts:548-576` |
| PRA-11 | The NIN hash is keyed with `SESSION_SECRET`, with no key version. Rotating that secret silently breaks duplicate-NIN detection for every stored row. | P1 | NEW | `application/verification.ts:110`; `schema.prisma:663-671` |
| PRA-12 | A "name does not match" record still reserves the NIN hash (it is unique). A later confirmation of the real owner would be refused as a duplicate, with no release path. Read from code; no test. | P1 | NEW | `application/verification.ts:110-136,153-159` |
| PRA-13 | Identity assurance is name-only and officer-asserted: no date of birth, no photo comparison, no regulator-record name captured. The NIN is typed by the practitioner as free text and read by an officer from a photograph. | P1 | V2.9 | `application/verification.ts:79-108`; `app/practitioner/profile/evidence-fields.tsx:156-164` |
| PRA-14 | The sanctions and "quack" lists ship empty, and no route or screen can add to them. Screening therefore reports "clear" for everyone until compliance inserts rows by SQL. No feed from any list exists. | P0 | REVIEW | `prisma/seed.ts:165-178`; `docs/stage-5-6-screening.md` |
| PRA-15 | Recording a registration does not trigger screening, so a listed folio is first checked at the next nightly sweep. List entries' folio numbers are compared as stored, while the practitioner's are normalised. | P1 | NEW | `application/verification.ts` (no screening call); `domain/screening.ts:81-87` |
| PRA-16 | Facilities see no verification information: no MDCN status and date, licence expiry, NIN yes/no, evidence tier or regulator. Nothing marks a claim as verified, evidenced or stated. | P1 | V2.9 | `src/lib/authz/permissions.ts:140-147`; `matching/application/match.ts:161-179` |
| PRA-17 | No structured qualifications (degree, institution, year, housemanship, fellowships) and no employment history. There is only a 1,000-character bio. | P1 | V2.9 | `schema.prisma:473`; `domain/profile.ts:9` |
| PRA-18 | No languages spoken. | P1 | V2.9 | `schema.prisma:466-497` |
| PRA-19 | Indemnity cover is an optional document with no provider, policy number or real expiry, no renewal reminder, and the rule does not read it. | P1 | V2.9 | `prisma/seed.ts:106`; `domain/eligibility.ts:52-100` |
| PRA-20 | A duplicate NIN or folio is refused only when an officer records it, not when the second person submits it. There is no duplicate-account review queue. | P1 | V2.9 | `application/verification.ts:153-159,311-314` |
| PRA-21 | No bank-account reuse check, because the schema has no bank-account model. | P1 | V2.9 | `schema.prisma:1939-1964` |
| PRA-22 | No account recovery through a compliance officer; recovery is by phone code only. | P1 | V2.9 | `auth/application/recovery.ts:1-12` |
| PRA-23 | "Held, not refused" when there is no NIN is half built: the person waits at `identity_unverified`, but no officer path decides on other evidence, because a NIN is required to create the identity row. | P1 | V2.9 | `presentation/schemas.ts:75-91`; `schema.prisma:675` |
| PRA-24 | The "platform record" (shifts completed, facilities worked, reliability and the number it is based on) exists only inside a match run, not on the profile. | P2 | V2.9 | `matching/domain/engine.ts:209-218` |
| PRA-25 | Five of the eight spec categories are seeded (no dentist, physiotherapist or community health practitioner). Categories, specialties and requirements change only by seed and deploy. | P1 | V2.9 | `prisma/seed.ts:36-42` |
| PRA-26 | Eligibility is not re-checked when a practitioner is invited, accepts, or is confirmed. The only consumers are the match run, the practitioner's own screens and the eligibility route. Fix lives in Module 7. | P0 | REVIEW | `application/candidates.ts:65-83` |
| PRA-27 | No second approver and no step-up on identity or registration confirmation, clearing a sanctions flag, or reinstatement. The only control is that nobody reviews their own submission. | P1 | NEW | `src/lib/authz/permissions.ts:77-83`; `credentials/application/submission.ts:357` |
| PRA-28 | The annual licence number the practitioner types is stored, made unique and sanction-matched as the "folio number". Whether those are the same identifier on the regulator's register is not verified. | P1 | NEW | `app/practitioner/profile/evidence-fields.tsx:60-72`; `confirm-from-submission.ts:146-150` |
| PRA-29 | The "Record by hand" form pre-selects "name matches" and "ACTIVE", against the stated rule that there is no default. | P2 | NEW | `app/admin/practitioners/page.tsx:196,200` |
| PRA-30 | A practitioner whose own credential expired, or who changed category, still reads "Waiting for approval" and sits in the officer's waiting queue. Only a rejection returns the application. | P2 | NEW | `src/lib/ui/practitioner.ts:186-194`; `application/directory.ts:78-81` |
| PRA-31 | The `ACTIVE` label is cosmetic and a day late; `DEACTIVATED` is set by no code; the `PENDING` screening value is never written. | P2 | NEW | `domain/eligibility.ts:60`; `worker/jobs.ts:51-54` |
| PRA-32 | A registration is overwritten in place when re-recorded; only the audit trail keeps what it used to say. v2.9 asks for evidence to be preserved when a source changes. | P2 | V2.9 | `application/verification.ts:289-304` |

**Recommended change (v3).**

*Phase 0, make it safe.* Fix PRA-08 first: the rule must use the **latest decided submission per credential type**, and read the credential's own expiry date live (PRA-09). Load the real sanctions lists and give compliance a screen to maintain them (PRA-14); run screening when a registration is recorded (PRA-15). Stop holding the NIN in clear (PRA-10): keep it only as the keyed hash and last four, and let an officer read it from the photograph. Validate the regulator against the profession and make the folio unique per regulator (PRA-05, PRA-06). Re-check eligibility inside the one booking function that Module 7 will own (PRA-26): invitations, acceptances and confirmations all go through it.

*Phase 1, Gombe pilot.* Put the level model in **before any pilot data exists**, because retrofitting it into live shifts, rates and invoices is the most expensive change in the programme (PRA-01, PRA-02, PRA-03). The profile carries a *claimed* level and a *verified* level; an officer verifies against evidence. Changing level, category or specialty after approval returns the application for review (PRA-07). Replace "years of experience" with a "practising since" date drawn from registration evidence (PRA-04). The next section describes the shape.

*Phase 2, two-sided marketplace.* Facilities see a verification panel with the date each check was done, the regulator, the expiry and the evidence tier, and every profile claim is marked verified, evidenced or stated (PRA-16). Add qualifications, employment history, languages and structured indemnity (PRA-17 to PRA-19). Practitioner listings stay opt-in under a separate consent.

*Phase 3 and 4.* Bank-account reuse check using the payment provider's account-name answer (PRA-21); duplicate-account review queue and officer-assisted recovery (PRA-20, PRA-22); notices through the Notifications module when a suspension, flag or expiry changes someone's standing.

**Acceptance criteria.**

1. Given a doctor whose licence credential was verified, expired and then replaced by a newer verified one, when eligibility is read, then no `credential_expired` blocker appears and the old row is shown as superseded.
2. Given a verified credential whose expiry date was yesterday and whose sweep has not run, when a match run starts, then that practitioner is excluded for `credential_expired`.
3. Given a practitioner approved at one cadre, when they claim a higher one, then the application returns to review and they are not matched at the higher level until an officer verifies it.
4. Given a registration recorded with a regulator that is not the profession's regulator, when the officer saves, then the request is refused with a plain message.
5. Given the same folio digits under two different regulators, then both are accepted; given the same folio twice under one regulator, then the second is refused.
6. Given a name added to the sanctions list, when an officer records a registration carrying a listed folio, then the practitioner is flagged within the same request and drops out of the next match run.
7. Given a NIN submission that an officer rejected, when the database row is read, then the NIN is not present in clear.
8. Given a practitioner whose registration category requires supervision, when a facility posts a shift that needs independent practice, then they are excluded with the reason `supervision_required`.

---

### Professional hierarchy: what the data model must become

Today a profile says "Nurse / Midwife", one optional specialty and a number of years. That cannot tell an intern from a consultant, a provisional registrant from a fully registered one, or a general nurse from a midwife who also holds a theatre post-basic register. The target is a chain in which licence, cadre and mandatory competence are **hard rules** and distance, experience, rate and preference only rank:

profession → regulator → registration category → cadre rung → specialty set → verified competencies → experience band → supervision requirement → active licence.

Every regulatory statement in the table below is a **working assumption [Counsel/Regulator to confirm]**. The rungs are Medilink's own platform rungs, drawn from Appendix A of `docs/redesign-recommendations-2026-10-13.md`; they are not official titles and have not been validated with any regulator or Gombe panel. Where a source is noted, it is the coordinator's note to this study, not something this study checked.

| Profession | Regulator | What the code seeds today | Registration categories to model | Draft cadre rungs (low → high) | Supervision rule | Evidence that proves it |
|---|---|---|---|---|---|---|
| Doctor | MDCN (`prisma/seed.ts:37`) | Category `doctor`; 12 specialties; credential types MDCN licence, NIN slip, MBBS; three requirements; no cadre, no registration category | Provisional registration versus full registration (user-supplied; unverified) [Counsel/Regulator to confirm]; practice type medical, dental or alternative, as the v2.9 spec describes MDCN's status form [not verified against MDCN]; specialist or fellowship status | House Officer · Medical Officer · Senior Medical Officer · Registrar · Senior Registrar · Consultant | Provisionally registered doctors and House Officers always supervised and never offered unrestricted independent duties; Registrars work under a named consultant [Counsel/Regulator to confirm] | Register entry showing registration type and date; practising licence for the year; MBBS certificate; fellowship or specialist certificate for the top three rungs; evidence of completed housemanship [Counsel/Regulator to confirm] |
| Nurse / Midwife | NMCN (`seed.ts:38`) | Category `nurse`; three specialties (general nursing, perioperative nursing, midwifery); **no** credential types or requirements | NMCN's own site lists basic General Nursing and Basic Midwifery registration plus 17 post-basic programmes across 19 registers (coordinator's note: verified against NMCN's site; not re-checked here). Model each register as a separate registration category; one person can hold several [Counsel/Regulator to confirm] | Staff Nurse/Midwife · Nursing Officer · Senior Nursing Officer · Principal Nursing Officer and above | Newly qualified nurses under supervised practice; midwifery duties require the midwifery register; specialist units (theatre, intensive care) tied to the matching post-basic register [Counsel/Regulator to confirm] | NMCN register entry and licence; certificate for each register held; post-basic certificate; grade letter from the employer |
| Pharmacist | PCN (`seed.ts:39`) | Category `pharmacist`; no specialties; **no** credential types or requirements | Pharmacist versus pharmacy technician (user-supplied; unverified); intern or provisional status [Counsel/Regulator to confirm]. Premises registration belongs to the facility | Intern · Pharmacist · Senior Pharmacist · Principal and above | Interns supervised by a registered pharmacist; technicians work under a pharmacist [Counsel/Regulator to confirm] | PCN register entry and licence; internship completion; degree certificate |
| Medical laboratory scientist | MLSCN (`seed.ts:40`) | Category `lab_scientist`; no specialties; **no** credential types or requirements | Scientists, technicians and assistants (secondary source; unverified); intern status [Counsel/Regulator to confirm] | Intern · Scientist · Senior Scientist · Principal and above | Interns, technicians and assistants work under a registered scientist [Counsel/Regulator to confirm] | MLSCN register entry and licence; internship completion; qualification certificate |
| Radiographer | RRBN (`seed.ts:41`) | Category `radiographer`; no specialties; **no** credential types or requirements | Not known to this study; the regulator's own categories must be obtained. Treat as open [Counsel/Regulator to confirm] | Intern · Radiographer · Senior · Principal and above | Interns supervised; duties around imaging equipment follow the regulator's and the facility's equipment licences [Counsel/Regulator to confirm] | RRBN register entry and licence; internship completion; qualification certificate |
| Dentist, physiotherapist, community health practitioner (listed in v2.9, not seeded) | Regulators not stated in the spec and not verified here [Counsel/Regulator to confirm] | Nothing | To be defined with each regulator | Not drafted | Not drafted | To be defined |

What the model must hold, as new or changed entities (names are proposals):

| Entity | Purpose |
|---|---|
| `regulators` and `registration_categories` | Reference data owned by compliance: regulator, category, whether independent practice is allowed, whether supervision is required, order. Replaces the free-text `regulator` and `practice_type` strings. |
| `cadres` | Ordered rungs per profession, each mapped to the registration categories that can hold it. |
| Registration (extended) | Registration category, date first registered, expiry as printed, evidence tier, source reference; unique on regulator plus folio. |
| Claimed and verified level | Two fields on the profile plus who verified, when, and which evidence document proved it. |
| `competencies` and practitioner competencies | Declared by category, never free text; each claim marked verified, evidenced or stated; a shift can require one. |
| Specialty **set** with one primary | Replaces the single `specialtyId`. |
| Qualifications, employment history, languages, indemnity policy | The v2.9 profile content, each with its supporting document. |

Rules the hierarchy must enforce, all as **hard eligibility rules** with a named exclusion reason: the person must hold an active registration whose category allows the work; their verified rung must meet the shift's required level (exact, or "this level or above"); a required competence must be verified; a supervised or provisional practitioner is never offered unrestricted independent duties; and a cheaper lower cadre cannot fill a post that needs a higher regulated capability.

---

## Module 3 · Credentials  *(repo folder `src/modules/credentials`; v2.9 Module 3)*

**Status:** Partly built · **Label:** CURRENT + IMPROVE · **Maturity for a Gombe pilot:** Ready after P0 fixes — the review queue and one-click confirmation work, but only doctors have required documents and nobody is told of a decision or an expiry.

**Why it exists.** A licence number proves a licence exists; a photograph and a reviewer prove that someone looked. This module is where a practitioner sends the evidence (a licence, a NIN slip, a degree, an indemnity certificate) and an officer decides. Without it, "verified" would be a claim, and a facility would be trusting a stranger's word about a theatre list.

**Who uses it.**

| Actor | What they do here | Permission @ scope |
|---|---|---|
| Practitioner | Submit evidence, answer a request for more, read their own submissions and documents | `credential.submit`, `credential.document.read` @ SELF (`src/lib/authz/permissions.ts:116-122`) |
| Administrator | Read the queue, open documents, approve, reject, ask for more, confirm a NIN or licence | `credential.review`, `credential.document.read` @ PLATFORM (`src/lib/authz/permissions.ts:172-183`) |
| Worker (system) | Daily expiry sweep | system |
| Facility staff | Nothing; they hold none of these keys | none |

**How it works today.**

1. **Types and requirements.** Six credential types are seeded: MDCN annual practising licence (issuer MDCN, expires, 365 days, checked by number), NIN slip (NIMC, no expiry, checked by number), MBBS certificate (document review), NYSC certificate, certificate of good standing (MDCN, expires 365 days) and professional indemnity cover (expires 365 days), the last three document review and optional. A separate table says which are **required** for which profession. Only doctors have rows: licence, NIN slip and MBBS (`prisma/seed.ts:99-107,127-149`).
2. **Submitting.** A type checked by number needs a number; every other type needs a document. The form asks for a photograph beside the number while no provider is switched on. Files go straight to storage by signed link, up to 10 MB, PDF or common image types (`lib/storage/tigris.ts:61-69`). A second live submission of the same type is refused (`credentials/application/submission.ts:187-198`).
3. **Deciding.** An officer approves, rejects or asks for more. Reject and ask-for-more need a written reason. Asking for more lets the practitioner reply on the **same** row, which returns it to waiting.
4. **Number-checked types go through "confirm".** A plain approve of a NIN or licence is refused (`confirm_through_practitioner`), because a bare approval would leave the practitioner blocked on a record nobody made. Confirming records the identity or registration, approves the submission and, for a NIN, masks the stored number to its last four digits. It is three separate commits, retry-safe but not atomic (`application/confirm-from-submission.ts:83-118`).
5. **Expiry.** On approval the system sets the expiry as the **review date plus the type's review days**, for types that expire. A daily sweep moves verified rows past their date to EXPIRED and publishes `credential.expired`. It does not suspend anyone, deliberately, so the practitioner can still sign in and upload a renewal (`credentials/application/expiry.ts:15-70`).
6. **Telling the practitioner.** The practitioner sees the status and the reviewer's note on their credentials tab; a refused required document also shows a banner. Nothing is sent by SMS.
7. **Providers.** Automated NIN and register checks are behind two switches that are off by default. Turning either on makes the call throw, because no adapter has been written. See the providers table below.

| Submission status | Can go to | Triggered by |
|---|---|---|
| (new) | PENDING | Practitioner submits |
| PENDING | VERIFIED | Officer approves (expiry set if the type expires; `credential.verified` published) |
| PENDING | REJECTED | Officer rejects with a reason; a required type also sends the application back; nothing published |
| PENDING | MORE_INFO_REQUESTED | Officer asks for more with a reason; nothing published |
| MORE_INFO_REQUESTED | PENDING | Practitioner replies (only from this status) |
| VERIFIED | EXPIRED | Daily sweep once the expiry date has passed (`credential.expired` published) |
| REJECTED, EXPIRED | — | Terminal. A new submission may be made, but the old row stays |

No status is reachable from VERIFIED except EXPIRED. There is no revoke, withdraw or supersede (`submission.ts:358`).

| Provider | Switch | Default | What happens if turned on |
|---|---|---|---|
| NIMC identity check | `NIN_VERIFICATION_PROVIDER` = none, sandbox, live | none | Throws `VerificationNotConfiguredError`; no adapter exists, and `sandbox` is treated like `live` (`lib/verification/index.ts:99-133`) |
| Regulator register check | `MDCN_VERIFICATION_PROVIDER` | none | Same. One switch serves every regulator; there is no NMCN, PCN, MLSCN or RRBN path (`index.ts:139-149`) |

With both off, an officer enters the result. Switching a provider on later is meant to change only who answers the officer's two questions, not the endpoints or schema. Not verified: whether that holds against a real provider's contract.

**Rules the system enforces.**

- One live submission per credential type (pending, queried or verified). A rejected or expired one does not block a new submission.
- Number-checked types need a number; every other type needs a document. The API requires only "a number or a document"; the photograph is a form rule.
- A document must have finished uploading and belong to the submitter, or the submission is refused (`submission.ts:120-135`).
- Reject and request-more need a reason of any length up to 1,000 characters (`presentation/schemas.ts:76-87`).
- Only a waiting submission can be decided. Only a queried one can be answered. A reviewer cannot decide their own submission (`submission.ts:357-358`).
- Number-checked types are approved only through the confirm route.
- The NIN never appears in an audit row, only its last four digits; a stored NIN is reduced to its tail after a successful confirmation (`submission.ts:79-82,548-576`).
- A practitioner can only see their own submissions and documents; another person's is a 404, not a 403. Every officer document view writes a security event (`submission.ts:643-676`).
- Only verified-and-unexpired rows count towards eligibility, and only for the types the profession requires.

**What is not there yet.**

| ID | Gap | Sev | Source | Evidence |
|---|---|---|---|---|
| CRE-01 | Credential requirements are seeded for doctors only. A nurse, pharmacist, laboratory scientist or radiographer needs no document to submit for review and is verified by identity, registration and screening alone. | P0 | REVIEW | `prisma/seed.ts:127-149` |
| CRE-02 | No NMCN, PCN, MLSCN or RRBN credential types, and no qualification, internship or post-basic types for any profession but doctors. The one-click registration confirm exists only for the doctor-labelled MDCN licence type, so a nurse's NMCN registration is recorded through that label or by hand. | P0 | REVIEW | `prisma/seed.ts:99-107`; `application/confirm-from-submission.ts:130,146` |
| CRE-03 | The submit form lists every credential type to every profession, so a nurse is offered "MDCN Annual Practising Licence". | P1 | NEW | `app/practitioner/profile/credentials-section.tsx:93-103,153-163` |
| CRE-04 | A credential's expiry is the review date plus the type's review days, not the date printed on the document, and that computed date is what the practitioner is shown. (The review said the printed date is never captured; at HEAD it can be entered on the registration but not on the credential.) | P0 | REVIEW | `submission.ts:363`; `domain/submission.ts:50-58`; `credentials-section.tsx:229` |
| CRE-05 | The printed expiry on the registration is optional for the officer. If left blank the only limit is the 365-day evidence age counted from the day the officer recorded it. There are two expiry clocks with no link between them. | P1 | NEW | `admin/practitioners/evidence-review.tsx:489-500`; `practitioners/domain/eligibility.ts:78-84` |
| CRE-06 | A verified credential blocks a new submission of its type, so a renewal cannot be sent early. There is no "supersedes" link, and after expiry the old row stays and keeps blocking (PRA-08). | P1 | REVIEW | `submission.ts:187-198` |
| CRE-07 | Decisions are not sent to the practitioner. Reject and request-more publish no event, and the three credential events that do exist have no handler. They find out when they open the app. | P0 | REVIEW | `submission.ts:409-410`; `worker/handlers.ts:15-52` |
| CRE-08 | No expiry warnings (30 and 7 days) and no renewal prompt. The only expiry actions are the daily sweeps. Both CRE-07 and CRE-08 need a working SMS provider from Module 16. | P0 | REVIEW | `worker/jobs.ts:31-56` |
| CRE-09 | Both verification providers are unimplemented switches. Selecting any value but "none" makes the call throw; `sandbox` is not distinct from `live`; one switch covers all regulators. | P1 | V2.9 | `lib/verification/index.ts:99-149`; `lib/env.ts:52-56` |
| CRE-10 | The confirm path reads a photographed licence, not the regulator's register. No register response, screenshot or source reference is stored. The spec asks the officer to look the person up on the register and store the result with its date. | P1 | V2.9 | `admin/practitioners/evidence-review.tsx:80,475`; `application/verification.ts:251` |
| CRE-11 | A verified credential cannot be revoked, withdrawn or superseded, so a forged certificate cannot be un-verified except by editing the registration or suspending the person. | P1 | NEW | `submission.ts:358` |
| CRE-12 | Confirm-from-submission commits three times (record, decide, mask). A failure between them leaves a recorded identity with a submission still waiting. | P2 | NEW | `confirm-from-submission.ts:83-118` |
| CRE-13 | The status model and tables differ from v2.9. There is no Draft, Under review or Suspended status. One table holds submissions with embedded document and review fields instead of separate documents, reviews, sources and flags. Reviewer and note fields are cleared on resupply, so history lives only in the audit trail. No issue date, no source reference, no superseded link. | P2 | V2.9 | `prisma/schema.prisma:505-553`; `submission.ts:481-485` |
| CRE-14 | No retention rule for rejected documents, no image compression for weak connections and no malware check on uploads. | P1 | REVIEW | `lib/storage/tigris.ts:61-69` |
| CRE-15 | One live submission per type is checked in code only; there is no unique index, so a concurrent double submit can create two waiting rows. | P2 | NEW | `submission.ts:181-186` |
| CRE-16 | The spec says expiry suspends the account automatically. The code blocks matching instead and leaves the account usable. This is a deliberate divergence that needs a recorded decision. | P2 | V2.9 | `credentials/application/expiry.ts:15-21` |
| CRE-17 | The sweeps run in one pass with no isolation per row and no paging. One failing row fails the job until tomorrow. | P2 | REVIEW | `credentials/application/expiry.ts:33-66` |
| CRE-18 | Verification turnaround is not measured, though the spec asks for it from week one. Timestamps exist; nothing aggregates them. | P2 | V2.9 | `schema.prisma:484,519-521` |

**Recommended change (v3).**

*Phase 0.* Compliance, with each regulator and with sign-off, defines credential types and requirements for the four other professions (CRE-01, CRE-02): at least the registration licence, the qualification and identity for each, then internship and post-basic evidence where a register depends on it [Counsel/Regulator to confirm]. Filter the form to the profession's types (CRE-03). Capture the printed expiry on the credential at review, so the date the practitioner sees is the document's own (CRE-04, CRE-05). Allow a renewal to be submitted while the old one is still verified; on approval the old row becomes superseded rather than expired (CRE-06, and PRA-08 in Module 2). Send an SMS on every decision and at 30 and 7 days before expiry through the Notifications module (CRE-07, CRE-08).

*Phase 1.* Level evidence (fellowship, grade letter, internship completion, post-basic certificate) becomes credential types attached to a rung, so Module 2 can verify a claimed level. Record the decision on automatic suspension: recommend keeping "block matching, not sign-in", and amend the spec (CRE-16). Add revoke and withdraw, with a reason and an audit row (CRE-11).

*Phase 2 and 3.* Write the NIMC and register adapters when subscriptions exist, one per regulator, behind the same two questions the officer answers today (CRE-09). Until then change the confirm step to record the officer's register lookup with its date and a source reference (CRE-10). Move toward the spec's separate documents, reviews and sources tables only when something needs them (CRE-13). Add retention and compression (CRE-14).

*Phase 4.* Measure verification turnaround and show it to the operations lead (CRE-18).

**Acceptance criteria.**

1. Given a nurse who has submitted every document the nursing profession requires, when they submit for approval, then the server accepts it; given a missing required document, it refuses with 422 naming "your documents".
2. Given a licence photo showing an expiry date of 30 June, when the officer confirms it, then the credential and the registration both carry 30 June, and the practitioner is shown 30 June.
3. Given a verified licence, when the practitioner submits its renewal before expiry, then the system accepts it and, on approval, marks the old one superseded without a gap in eligibility.
4. Given an officer rejecting a submission, when the reason is saved, then an SMS with the reason reaches the practitioner and the outcome is recorded.
5. Given a verified credential that expires in 30 days, when the daily job runs, then the practitioner is sent a reminder, and again at 7 days.
6. Given a NIN submission, when an officer opens the queue, then the number is visible only on demand and is not present in clear in the database after the decision.
7. Given a credential type that is not required for the practitioner's profession, when they open the form, then it is not offered as required.
8. Given NIMC switched on without an adapter, when the app starts, then it fails loudly at boot rather than at the first practitioner.

---

## Module 4 · Facilities  *(repo folder `src/modules/facilities`; v2.9 Module 4)*

**Status:** Partly built · **Label:** CURRENT + IMPROVE · **Maturity for a Gombe pilot:** Ready after P0 fixes — the verification gate works, but a rejected facility is stuck, no screen uploads a licence, and the identity rules do not fit government facilities.

**Why it exists.** A hospital, PHC or clinic must be a real, licensed place before any practitioner is sent to it. A fabricated facility drawing a nurse to an address that does not exist is as serious as a fabricated nurse `[v2.9 Module 4]`. This module gives a facility an identity and one decision — *may it publish work?* — that the rest of the system relies on.

**Who uses it.**

| Actor | What they do here | Permission @ scope |
|---|---|---|
| Facility owner or administrator | Register the facility, edit its details, upload the licence (API only), add staff | `facility.read` / `facility.write` @ FACILITY |
| Facility owner | Grant staff roles (needs a fresh password check) | `role.grant` @ FACILITY |
| Medilink administrator | Create a facility on someone's behalf (API only), verify or reject, read the licence (access is logged) | `facility.write`, `facility.verify` @ PLATFORM |
| Any signed-in user | Self-register one facility | authenticated only |

**How it works today.**

1. **Register.** A signed-in person completes `/facility/register` (name, type, CAC number, state, optional LGA, address, contact, licence number). One pending facility per person. In the same transaction the registrant is granted `facility_owner` over it — **even though it is unverified**.
2. **Wait.** The facility sits `PENDING`; its owner sees a banner. Nothing tells them when a decision is made.
3. **Verify.** An administrator opens `/admin/facilities`, reads the detail card and clicks Verify or Reject (a rejection needs a reason). They cannot verify their own facility. No licence is required for approval; the screen merely warns when none was uploaded. Verification is a human click — there is no CAC register lookup and no stored evidence of what was checked.
4. **Publish.** Only a `VERIFIED` facility with an unexpired licence date (when one is recorded) can publish a shift. This is the single gate, `canPublish`.
5. **Change the licence.** Editing the licence number, expiry or document on a verified facility sends it back to `PENDING` for review. Editing name, address or contact does **not**.

| Facility state | Can go to | Triggered by |
|---|---|---|
| PENDING | VERIFIED or REJECTED | Administrator decision (`facility.verify`); reject needs notes |
| VERIFIED | PENDING | Licence number, expiry or document changed by the owner |
| REJECTED | *(nothing)* | **Dead end** — no code path leads out |
| SUSPENDED | *(nothing)* | **Unreachable** — the state exists, no code writes it |

**Rules the system enforces.**

- A facility cannot publish unless it is `VERIFIED`, not deleted, and its licence expiry (if recorded) is in the future.
- A reviewer cannot verify their own facility; a decision can be made only from `PENDING`, by a compare-and-set update, so two reviewers cannot both decide.
- The CAC number is unique at the database level; the operations route upper-cases and strips it, but self-registration does not (`rc 123456` and `RC123456` are different rows).
- The representative cannot be deleted while they represent a facility (restrict foreign key).
- Reading a licence document writes a security-event row.

**What is not there yet.**

| ID | Gap | Sev | Source | Evidence |
|---|---|---|---|---|
| FAC-01 | **A REJECTED facility is stuck.** Verify requires PENDING; the CAC number cannot be edited; re-registering hits the unique CAC rule. The dashboard banner tells the owner to "reply with the corrected documents" — there is no way to. | P0 | REVIEW | `src/modules/facilities/application/facility.ts:352,410,246-252`; `src/app/facility/page.tsx:131-166` |
| FAC-02 | **No screen uploads a facility licence, and approval needs none.** The upload API exists but nothing calls it; the administrator may approve with no evidence on file. | P0 | REVIEW | `facility.ts:399-464,480-525`; `src/app/admin/facilities/facility-detail.tsx:208-211` |
| FAC-03 | **A self-registered, unverified facility's owner holds `facility_owner` immediately**, including the ability to create drafts and look up users by phone to add staff. Facility permissions are not gated on verified status. | P0 | REVIEW | `facility.ts:194,224-232`; `src/app/api/v1/grants/find/route.ts` |
| FAC-04 | CAC number is not normalised at self-registration, so someone can squat another hospital's number in a different spelling, and a duplicate is not caught. | P0 | REVIEW | `src/modules/facilities/presentation/schemas.ts:91` vs `24-32`; `facility.ts:202` |
| FAC-05 | **CAC is mandatory**, but government hospitals and primary health centres — most of the facilities in Gombe — have no CAC number. They cannot register truthfully. Needs a ministry or registration reference alternative. | P0 | REVIEW | `prisma/schema.prisma:567`; `schemas.ts:91`; `src/app/facility/register/page.tsx:82` |
| FAC-06 | No suspend action and no licence-expiry sweep. A lapsed licence blocks only *new* publishing; a request already published stays matchable, invitable and confirmable. The expiry date is never captured by the registration screen, so the blocker cannot fire. | P1 | REVIEW | `facility.ts` (no writer of SUSPENDED); `src/worker/jobs.ts:31-68`; `src/app/facility/register/page.tsx` |
| FAC-07 | No facility profile page: no edit screen, no licence upload, no representative change. Renaming a verified facility needs no review, yet practitioners identify the facility by name in offers. | P1 | NEW | `facility.ts:344-352`; `src/modules/matching/application/assignment.ts:802,816` |
| FAC-08 | Only one representative exists and it is immutable; it is the sole recipient of confirmation messages. Other owners and administrators are never told, and revoking the representative's grant leaves them as the recipient. | P1 | NEW | `src/modules/notifications/application/handlers.ts:44-47,72-80` |
| FAC-09 | Nobody is told a facility was verified or rejected (`facility.verified` has no handler; rejection emits no event). | P1 | NEW | `facility.ts:446-460`; `src/worker/handlers.ts` |
| FAC-10 | Facility types: no pharmacy, maternity home or other; no ownership type (public, private, mission, NGO). | P1 | REVIEW | `prisma/seed.ts:194-203` |
| FAC-11 | v2.9 evidence missing: CAC register result with retrieval date; a representative verified by NIN and phone; first-engagement address confirmation; legal vs trading name; billing contact and shift supervisor roles. | P1 | V2.9 | `prisma/schema.prisma:561-614` |
| FAC-12 | The last owner can revoke themselves, leaving the facility with no one who can appoint. | P1 | REVIEW | `src/modules/auth/application/grants.ts:246,291` |
| FAC-13 | Branches and departments are not built; `BRANCH`/`DEPARTMENT` exist only as unused scope values. | P2 | V2.9 | `prisma/schema.prisma:140-147`; `src/lib/authz/guard.ts:15,57` |
| FAC-14 | Self-registration is throttled only by "one pending per person"; there is no limit on verified or rejected registrations, and no test covers the route. | P1 | NEW | `src/app/api/v1/facilities/register/route.ts:37-46` |
| FAC-15 | Matching reads the `facilities` table directly, breaking the module rule; staff management is by phone lookup of an existing account, not an invitation. | P2 | REVIEW | `src/modules/matching/application/match.ts:69-72` |

**Recommended change (v3).**

1. *Phase 0.* Fix FAC-01 (a REJECTED → PENDING re-review path with a reason shown to the owner), FAC-02 (a licence upload on a facility profile page; approval requires licence evidence or a recorded override reason), FAC-03 (gate facility permissions on verified status; replace phone lookup with an invitation the invitee accepts), FAC-04 (reuse the normaliser) and FAC-05 (accept a ministry or registration reference where there is no CAC; decide the allowed reference types with Gombe facilities at the appraisal).
2. *Phase 1.* Add a suspend action, a daily licence-expiry sweep with 30 and 7-day reminders, and notifications for verification outcomes. Add pharmacy, maternity home and ownership type.
3. *Phase 2 onward.* Branches and departments (the booking will need a department so a duty can be tied to a clinical area), and facility reliability measures — payment reliability, approval time, cancellation history — which the two-way trust model needs.

**Acceptance criteria.**

- Given a rejected facility, when its owner supplies corrected evidence, then it returns to review and the owner is told the outcome by message.
- Given a facility with no licence document and no override reason, when an administrator tries to approve, then the approval is refused.
- Given an unverified facility, when its owner tries to look up a user or create staff, then the action is refused until verification.
- Given two registrations of the same CAC number in different spellings, then the second is refused.
- Given a government PHC with a ministry reference and no CAC number, when it registers, then it can complete verification.
- Given a verified facility whose licence expires today, when the sweep runs, then it is suspended and its published requests stop being matchable.

---

## Module 5 · Availability  *(repo folder `src/modules/availability`; v2.9 Module 5)*

**Status:** Built (API); UI partly · **Label:** CURRENT + IMPROVE, then NEW EXPANSION (priced listings) · **Maturity for a Gombe pilot:** Ready after P0 fixes — the engine is sound, but the screen cannot say "free tonight" and, as designed, anyone without a weekly pattern is never offered work.

**Why it exists.** A nurse who works nights on Monday and Thursday should not be offered a Tuesday morning. Availability is the practitioner's statement of when they can work, and the matcher uses it as a hard filter.

**Who uses it.**

| Actor | What they do here | Permission @ scope |
|---|---|---|
| Practitioner | Add and remove weekly slots, one-off slots (API only) and blocked periods | `availability.write` @ SELF |
| Matching engine | Reads every candidate's slots and blocks | internal |
| Administrator | Read-only view | `availability.read` @ PLATFORM |

**How it works today.**

1. The practitioner adds **recurring weekly slots** (a day, a start and an end in West Africa Time, stored as minutes after midnight). An end at or before the start means the slot runs past midnight.
2. Optionally they add **blocked periods** (leave, a conference, a shift worked elsewhere) with a reason. A block always beats a slot.
3. When a shift is matched, the engine expands recurring slots to the shift's dates (starting a day early so Monday's night slot covers Tuesday's small hours), merges touching windows, and answers *available* only if one merged window covers the **whole shift**; otherwise *blocked* or *not offered*.

| State | Meaning |
|---|---|
| available | A merged window covers the whole shift and no block overlaps |
| blocked | Any block overlaps any part of the shift (checked first) |
| not offered | No slot covers the whole shift — including "no slots at all" (default-deny) |

**Rules the system enforces.**

- Whole-shift cover: partial availability is not availability.
- A block beats a slot; a slot with end ≤ start wraps past midnight; the API accepts an end of 24:00 for "all day".
- All writes are SELF-scoped; a test asserts no write ever gains wider scope.
- A practitioner can submit for review only when at least one slot exists (Module 2).

**What is not there yet.**

| ID | Gap | Sev | Source | Evidence |
|---|---|---|---|---|
| AVL-01 | **The pattern is not an offer.** There is no rate, level, visibility, status, area, minimum notice or expiry, so nothing a facility could search or book. This is the foundation of the two-sided marketplace. | P1 | V3 | `prisma/schema.prisma:863-889` |
| AVL-02 | **The screen cannot express "free tonight" or "all day".** It builds weekly patterns only; one-off slots and effective dates are API-only; the time input cannot yield 24:00, and 00:00–23:59 leaves a one-minute hole that refuses overnight shifts. Default-deny means a practitioner without a pattern is never offered anything. | P0 | REVIEW | `src/app/practitioner/profile/availability-section.tsx:93-98,153-168`; `src/modules/availability/application/availability.ts:103-105` |
| AVL-03 | No way to remove a blocked period from the screen, and block reasons are free text kept in the audit trail indefinitely (may contain health information). | P1 | NEW | `availability-section.tsx`; review §5 (audit retention not re-verified) |
| AVL-04 | Location is one home state and LGA, not preferred areas; travel is three tiers (own LGA / own state / anywhere), not a distance. | P1 | V2.9 | `prisma/schema.prisma:474-479`; `src/modules/matching/domain/engine.ts:20-21` |
| AVL-05 | No day, night, weekend, holiday or on-call preference; no practitioner-set maximum working hours. | P1 | V2.9 | `prisma/schema.prisma:863-889` |
| AVL-06 | A practitioner who left home state empty is silently excluded by the default `SAME_STATE` travel preference; one with preference `SAME_LGA` can never match a facility with no LGA — both under the reason `travel_preference`. | P1 | NEW | `engine.ts:153-158,260-274`; `prisma/schema.prisma:479` |
| AVL-07 | Old slots and blocks are never pruned; the batch loader reads all of them for every candidate on every run. | P2 | REVIEW | `src/modules/availability/application/availability.ts:277-280` |

**Recommended change (v3).** *Phase 0:* add "free tonight", "all day" and "every weekday" shortcuts and a block-removal control; make the one-off slot a first-class screen; show the practitioner *why* they were not offered something. *Phase 1:* bulk entry; an optional pick-list for block reasons kept out of the audit trail; pruning. *Phase 2:* a separate **Availability Listing** — dates or recurring pattern, profession and level offered, specialty and competencies, approximate area and radius, minimum hourly or shift rate, day/night/weekend/emergency preferences, whether they accept immediate or advance bookings, expiry and status (open, held, booked, withdrawn, expired) — floor-checked, and visible to facilities only after the practitioner opts in under a **separate consent**. Exact home address and detailed schedules are never shown; facilities see an approximate location and an availability window until a booking is accepted. The private pattern remains for the matcher.

**Acceptance criteria.**

- Given a practitioner with no weekly pattern, when they mark "free tonight", then they appear to matching for tonight's shifts.
- Given an overnight shift, when the practitioner chooses "all day", then the shift is covered.
- Given a listing, when it is published without the opt-in consent, then it is refused.
- Given a listing visible to facilities, then no field exposes a street address, phone number or full schedule.

---

## Module 6 · Service requests  *(repo folder `src/modules/service-requests`; v2.9 Module 6)*

**Status:** Built · **Label:** CURRENT + IMPROVE, then NEW EXPANSION (levels, rates per person) · **Maturity for a Gombe pilot:** Ready after P0 fixes — but a request still cannot say what *level* it needs.

**Why it exists.** A ward manager says "we need two nurses on Saturday night at this rate." This module captures that need, refuses it if it is below the rate floor or the facility is not verified, and holds it until it is filled, cancelled or has started.

**Who uses it.**

| Actor | What they do here | Permission @ scope |
|---|---|---|
| Facility owner or administrator | Create, publish, cancel a request; view the list | `service_request.publish` / `service_request.read` @ FACILITY |
| Medilink administrator | Read all requests (cannot publish or cancel on a facility's behalf) | `service_request.read` @ PLATFORM |
| Practitioner | **Cannot list open requests**; sees only offers made to them | `service_request.read` @ SELF (own offers) |

**How it works today.**

1. **Create.** The dialog on `/facility/shifts` asks for profession, optional specialty, day or night (picked by hand), start and end (up to 24 hours), headcount (1–50), an hourly rate (pre-filled at ₦5,000 for every profession), urgency, cancellation terms and notes. The rate is checked against the floor for that profession, specialty and shift type.
2. **Publish.** The dialog publishes immediately. Publish re-checks the floor (a floor may have moved), that the start is in the future and that the facility `canPublish`; a failure leaves a draft with a retry button.
3. **Run.** Matching, offers and confirmation (Module 7) fill the request.
4. **End.** It becomes `FILLED` when confirmations reach headcount, `CANCELLED` if the facility cancels, or `EXPIRED` when an hourly sweep finds it still open after its start.

| Request state | Can go to | Triggered by |
|---|---|---|
| DRAFT | PUBLISHED or CANCELLED | Publish (compare-and-set) or cancel |
| PUBLISHED | FILLED, CANCELLED or EXPIRED | Confirmations reach headcount; facility cancels; hourly sweep after start |
| FILLED | CANCELLED (documented) or PUBLISHED (in code) | Cancel; or a facility cancels one assignment, which reopens it — the code does this though the transition table does not allow it |
| CANCELLED, EXPIRED | *(terminal)* | — |

**Rules the system enforces.**

- A request's rate must be at or above the most specific rate floor that applies on the shift date: a specialty floor beats the profession-wide one; otherwise the latest effective date wins.
- Window ≤ 24 hours; headcount 1–50; start in the future at publish; cancellation terms 10–2,000 characters.
- Cancelling withdraws outstanding offers.
- There is **no edit route**: to change a request, cancel it and publish a new one.

**What is not there yet.**

| ID | Gap | Sev | Source | Evidence |
|---|---|---|---|---|
| REQ-01 | **A request cannot name a level, cadre, supervision requirement or per-person rate.** One hourly rate is the contract for everyone on it. Retrofitting a level into live shifts, rates and invoices is the most expensive change in this document, so the field must exist before pilot data does. | P0 | V3 | `prisma/schema.prisma:922-967`; `src/modules/matching/domain/engine.ts:135-146` |
| REQ-02 | **Cancelling a filled request leaves its assignments live**, and no screen can cancel an individual assignment — yet the cancel dialog tells the user to do that separately. | P0 | REVIEW | `src/modules/service-requests/application/request.ts:305-317`; `src/app/facility/shifts/page.tsx:408,473-475` |
| REQ-03 | **The offer hides what a dispute turns on.** The practitioner sees the rate and times, but not the cancellation terms, the notes (ward, what to bring), the address or the headcount; they accept blind, and no acceptance of terms is recorded. | P0 | NEW | `src/modules/matching/application/assignment.ts:762-771,790-803` |
| REQ-04 | Shift type (day or night) is chosen by hand, not derived from the times, so a night shift labelled "day" gets the lower floor. | P1 | REVIEW | `src/modules/service-requests/presentation/schemas.ts:24`; `request.ts:84-109` |
| REQ-05 | Urgency is display-only: no shorter offer lifetime, no broadcast, no automatic invitation. | P1 | REVIEW | not read in `engine.ts` or `match.ts` |
| REQ-06 | The expiry sweep marks a half-filled request EXPIRED (distorting fill rate) and returns the count it selected, not the count it updated. There is no PARTIALLY_FILLED state. | P1 | REVIEW | `src/modules/service-requests/application/expiry.ts:26,37-40,67,72` |
| REQ-07 | No clone, repeat or recurring request; no edit of non-contractual fields. Every Saturday night is a separate request. | P1 | REVIEW | `docs/stage-6-1-service-requests.md` |
| REQ-08 | v2.9 fields missing: branch, department, structured responsibilities, minimum experience, per-request required credentials, allowances, application deadline; statuses Matching, Partially filled, In progress, Completed, Disputed; a status-history table. | P1 | V2.9 | `prisma/schema.prisma:922-967`; `src/modules/service-requests/domain/request.ts:5-10` |
| REQ-09 | An unverified facility's owner can create drafts; a lapsed facility's already-published request remains matchable, invitable and confirmable. | P1 | NEW | `request.ts:126-196` |
| REQ-10 | The new-shift dialog pre-fills ₦5,000 per hour for every profession, anchoring facilities low. Rate floors exist for doctors and nurses only; for pharmacists, laboratory scientists and radiographers a request publishes at any positive rate. | P1 | REVIEW | `src/app/facility/shifts/new-shift-dialog.tsx:55`; `prisma/seed.ts:278-281` |
| REQ-11 | `cancelServiceRequest` writes without a status condition (a race with a concurrent confirm); two different "filled" counts exist (list counts non-cancelled, confirm counts confirmed). | P1 | NEW | `request.ts:306`; `src/app/api/v1/service-requests/route.ts:41-44` |
| REQ-12 | The domain transition table and the code disagree (FILLED → PUBLISHED). Operations cannot publish or cancel on a facility's behalf. | P2 | NEW | `domain/request.ts:32-40`; `assignment.ts:555-560` |

**Recommended change (v3).** *Phase 0:* REQ-02 and REQ-03 (cancellation cascades with notice; the offer shows full terms and records acceptance). *Phase 1 — before any pilot data:* add to the request a **required level** (exact, or "this level or above"), required competencies, whether supervision is available, the clinical department, an **offered rate and unit** (hourly or per shift) and visible premium rules; key the rate floors by profession, **level**, specialty and shift type; derive the shift type from the times; pre-fill the floor for the chosen profession and level instead of ₦5,000; refuse to publish where no floor exists. *Phase 2:* the request becomes one of two kinds of listing that end in a Booking (Part 6); add clone and recurring templates.

**Acceptance criteria.**

- Given a request that names level L, when it is published, then the rate is checked against the floor for that profession and level, and publication is refused if no floor exists.
- Given a night-time window labelled day, when it is saved, then the shift type is corrected or the request refused.
- Given a filled request, when the facility cancels it, then every confirmed assignment is cancelled with a reason, each person is notified, and none is recorded as a no-show.
- Given an offer, then the practitioner sees times, place, rate and premiums, cancellation terms and notes before they can accept, and their acceptance of those terms is stored.

---

## Module 7 · Matching and assignment  *(repo folder `src/modules/matching`; v2.9 Module 7)*

**Status:** Built · **Label:** CURRENT + IMPROVE, then NEW EXPANSION (Booking, proposals) · **Maturity for a Gombe pilot:** **Not ready** — privacy leak, an overbooking race and missing re-validation must be fixed first.

**Why it exists.** "Never simply the first to click accept" `[v2.9]`. Matching turns a published request into a ranked, explained shortlist, lets a person choose, lets the practitioner say yes, and lets the facility make it final.

**Who uses it.**

| Actor | What they do here | Permission @ scope |
|---|---|---|
| Facility scheduler/owner | Run a match, invite chosen people, confirm an acceptance, cancel an assignment (API only) | `assignment.confirm`, `assignment.cancel` @ FACILITY |
| Practitioner | See offers; accept or decline (a reason is mandatory); see own assignments | `service_request.read` @ SELF |
| Medilink administrator | Run match, invite, confirm for any facility | `assignment.confirm` @ PLATFORM |

**How it works today.**

1. **Rank.** "Find candidates" runs the engine over *every* practitioner of the request's profession. Practitioners who withdrew consent to be shown to facilities are dropped silently. Each remaining person is either **excluded** (all reasons listed) or **ranked**.
2. **Invite.** The facility ticks names; each becomes an invitation, open for 24 hours by default. No message is sent.
3. **Respond.** The practitioner opens `/practitioner/offers` and accepts, or declines with a reason (copied to the suggestion log without their name).
4. **Confirm.** The facility sees the acceptance (the page polls every 15 seconds) and confirms. Confirm takes a database lock on the **practitioner**, checks the request is published and not full, the invitation is accepted and there is no overlapping confirmed shift, then writes the assignment, a history row, an audit row and an event; when confirmations reach headcount the request becomes `FILLED` and the remaining offers are withdrawn.
5. **Notify.** An outbox handler sends one SMS to the practitioner and one to the facility's representative, with times printed in UTC.

*Hard exclusions* (all collected): `not_eligible`, `category_mismatch`, `specialty_mismatch`, `blocked`, `unavailable`, `already_assigned`, `travel_preference`.
*Score (100):* proximity 35 (same LGA 1.0, same state 0.6, else 0.2); experience 30 (years capped at 10); fatigue 20 (hours already confirmed in the preceding 168 hours, capped at 48); reliability 15 (neutral 0.5 until five completed assignments, then completed ÷ (completed + no-shows)). Rate, urgency, headcount, notice, language, facility preference and past pairing do not rank.

| Invitation | Can go to | Triggered by |
|---|---|---|
| INVITED | ACCEPTED or DECLINED | Practitioner responds while the offer is open |
| INVITED, ACCEPTED (unconfirmed) | WITHDRAWN | Request fills, is cancelled or expires |
| WITHDRAWN, lapsed | INVITED | Re-invite |
| *(EXPIRED)* | — | **Never written**; a lapsed offer stays INVITED until the request closes |

| Assignment | Can go to | Triggered by |
|---|---|---|
| CONFIRMED | CANCELLED | Facility cancels (also reopens a FILLED request) |
| CONFIRMED | COMPLETED | Approved timesheet (Module 10) |
| CONFIRMED | NO_SHOW or CANCELLED | Officer's fault decision after an unhonoured shift (Module 13) |

**Rules the system enforces.**

- Accepting an offer creates no assignment; only the facility's confirmation does.
- A practitioner cannot be confirmed onto overlapping shifts (checked under the practitioner lock); back-to-back is allowed.
- A request cannot be confirmed beyond headcount (but see MAT-02).
- Every assignment change writes a history row with a mandatory actor and reason.
- Every ranking is stored with the weights in force and, per candidate, the factors or the exclusion reasons.

**What is not there yet.**

| ID | Gap | Sev | Source | Evidence |
|---|---|---|---|---|
| MAT-01 | **The match result carries each candidate's name and full, unmasked phone number — ranked and excluded — to any facility user, nationwide.** Exclusion reasons and factor text also expose a named person's calendar (`blocked`, `unavailable`), other commitments, verification state, years of experience, home-area tier and hours worked this week. Nothing tests that phones are absent. This is a privacy breach and it destroys the fee: people simply phone each other. | P0 | REVIEW | `src/modules/matching/application/match.ts:37-55,157-179`; `engine.ts:94-102,194-217` |
| MAT-02 | **Confirm locks the practitioner, not the request.** Two different practitioners can be confirmed onto the last place at once. At headcount 2, two concurrent confirms each see a count of zero, so the request is **never marked FILLED**, stays published at full strength and is later marked EXPIRED. A test runs this case and asserts only that both succeed. | P0 | REVIEW | `src/modules/matching/application/assignment.ts:393-395,411,420,479`; `tests/integration/assignments.test.ts:341-367` |
| MAT-03 | **Invite, accept and confirm never re-check** licence/eligibility, category, consent, user status, the facility's own verified status, or the clock. A lapsed licence still gets confirmed; a started shift can still be invited and confirmed until the hourly sweep; an accepted offer never goes stale. | P0 | REVIEW | `assignment.ts:91-202,211-276,404-518` |
| MAT-04 | **Match and invite do not require a published request or a verified facility.** A draft by an unverified owner can be matched; the "Find candidates" button shows on any status. | P0 | REVIEW | `match.ts:64-72`; `src/app/facility/shifts/[id]/page.tsx:312-321` |
| MAT-05 | **No screen can cancel an assignment**, though the API exists. Cancelling emits no event, notifies nobody, has no time guard and writes unconditionally. | P0 | NEW | `assignment.ts:527-576`; grep of `src/app` |
| MAT-06 | **Rebooking someone who cancelled crashes with a 500**: the (request, practitioner) unique key raises an error nothing catches. Re-inviting them is a silent no-op because their invitation is still ACCEPTED, while the screen reports success. | P1 | REVIEW | `prisma/schema.prisma:1101`; `assignment.ts:122-131,421-423,444`; `src/lib/http/responses.ts:30-38` |
| MAT-07 | Decline reasons are returned to the facility next to the practitioner's name, though the practitioner screen promises the reason "reaches the platform without your name". | P1 | NEW | `assignment.ts:59,62-73,870-873`; `src/app/practitioner/offers/page.tsx:84,169` |
| MAT-08 | Offer lifetime is a flat 24 hours regardless of the shift or urgency; `EXPIRED` is never written; accepted offers never expire; the screen promises "the sweep will withdraw it" but no sweep exists. | P1 | REVIEW | `src/modules/matching/domain/assignment.ts:15`; `assignment.ts:98-100,125`; `offers/page.tsx:155-161` |
| MAT-09 | **No two-way marketplace:** no application to a shift, no counter-offer, no per-person rate, no priced listing, no direct or instant booking, no shift board for practitioners. The rate is on the request, not on the booking, so levels, two-way pricing, snapshots and per-person rates all need it moved. | P1 | V3 | `prisma/schema.prisma:1079-1115` (no rate on Assignment); `src/modules/service-requests/routes.ts` |
| MAT-10 | Ranking quality: experience is self-declared and capped at 10 years; fatigue counts only confirmed shifts and looks only backwards (completed shifts drop out; no rest rule); a facility's own users choose, not operations staff. | P1 | REVIEW | `engine.ts:46,174-181`; `match.ts:103-119` |
| MAT-11 | The whole profession is loaded into memory on every run and a row is written for every practitioner each time; nothing is paginated or pre-filtered in the database. | P1 | REVIEW | `src/modules/practitioners/application/candidates.ts:49-85`; `match.ts:194-217` |
| MAT-12 | No database-level overlap or headcount constraint (the time-range exclusion v2.9 asks for was explicitly declined); no soft hold, so two facilities can chase one person and the loser's acceptance stays open unnoticed. | P1 | V2.9 | `assignment.ts:379-392`; `prisma/schema.prisma:1104` |
| MAT-13 | The facility roster shows each practitioner's phone permanently, before and after the shift. Contact should be revealed only inside a window around the booking. | P1 | REVIEW | `assignment.ts:913-969` |
| MAT-14 | Eligibility collapses to a single `not_eligible` reason in the stored run, so the specific blocker is lost; no appeal route for inaccurate reliability data; reliability is shown without its denominator. | P2 | V2.9 | `engine.ts:11-18`; `match.ts:210-217` |
| MAT-15 | The first fifty engagements are not forced through operations hand-matching, and none of the launch signals (fill rate, time to confirm, approval-to-paid, verification turnaround, second-shift returns) is computed. | P1 | V2.9 | `src/app/admin/page.tsx:61-67,180-182` |
| MAT-16 | Facility invitations, confirmations and assignment cancellations are audited at the practitioner's scope, so a facility reading its own trail does not see them. | P2 | NEW | `assignment.ts:178-188,467-475,562-572` |

**Recommended change (v3).** The central move is the **Booking**: today's assignment, extended, becomes the one record every route to work ends in (Part 6, move 2).

1. *Phase 0.* Return initials, a verified badge, level, area and rate-from — never a phone or surname-level detail — until a booking exists (MAT-01); write one booking function that is the only way to create an assignment, takes a lock on the **request row and then the practitioner in a fixed order**, re-validates eligibility, category, consent, user and facility status and the clock, and fails closed (MAT-02, 03, 04); add a cancel control with cascade, notification and a not-a-no-show reason (MAT-05); catch the uniqueness error and allow re-booking after cancel (MAT-06).
2. *Phase 1.* An offer expiry that ends before the shift and respects urgency; "not checked in 30 minutes after start → alert the facility and backfill-invite"; a database overlap constraint as backstop; an idempotency key on confirm so a retry on a weak connection cannot book twice; top-N persistence with the state and eligibility filter in the database.
3. *Phase 2.* Proposals with up to two counter rounds; applications; listings and direct booking; origin recorded on the booking (`FACILITY_POSTED`, `PRACTITIONER_APPLIED`, `LISTING_BOOKED`); a soft hold on an accepted-but-unconfirmed offer; **level as a hard filter** with a visible `level_mismatch` reason; experience demoted to a tie-break; contact reveal windows.

**Acceptance criteria.**

- Given a match run, then the response contains no phone number and no surname-level detail for any candidate.
- Given a request with one place left and two practitioners confirmed concurrently, then exactly one succeeds and the other receives `request_full`.
- Given a request of headcount two and two concurrent confirms, then the request ends `FILLED`.
- Given an accepted offer whose practitioner's licence has since lapsed, when the facility confirms, then confirmation is refused with the reason.
- Given a request that is not published, or a facility that is not verified, when a match or invite is attempted, then it is refused.
- Given a confirmed assignment, when the facility cancels it, then the practitioner is notified, the request reopens, and attendance is not recorded as a no-show.
- Given a retry of the same confirmation, then no second assignment is created.

---

## Module 8 · Scheduling  *(repo folder `src/modules/scheduling`; v2.9 Module 8)*

**Status:** Stub · **Label:** CURRENT (placeholder) + NEW EXPANSION · **Maturity for a Gombe pilot:** Acceptable as a list for the pilot; calendars and recurrence are Phase 4.

**Why it exists.** Both sides need a reliable, conflict-free schedule. v2.9 asks for calendars, recurring shifts, rescheduling, replacement requests, reminders and calendar export.

**How it works today.** The folder is an empty placeholder (`ROUTES = []`, no permissions). "Schedule" means the assignment list inside matching: `/practitioner/shifts` (tabs Confirmed, Completed, No-show, Cancelled) and `/facility/roster` (a paged table). That was a deliberate decision: an assignment and the schedule it appears on are the same aggregate, and splitting them would have meant one module reading the other's tables. Conflict detection happens only at confirmation, per practitioner.

**What is not there yet.**

| ID | Gap | Sev | Source | Evidence |
|---|---|---|---|---|
| SCH-01 | No calendar, recurrence, rota template, shift swap, rescheduling or replacement request; no calendar export. | P1 | V2.9 | `src/modules/scheduling/routes.ts:13` |
| SCH-02 | **No shift reminder and no early no-show detection.** A no-show is flagged only by the hourly sweep after the shift ends, so an urgent shift cannot be saved. | P0 | REVIEW | `src/worker/jobs.ts:31-68`; `assignment.ts:1000-1006` |
| SCH-03 | Public holidays: six fixed 2026 dates only; none for 2027; no state holidays; not used by scheduling. Display is Africa/Lagos, but the confirmation SMS prints UTC and the shift form's date inputs follow the browser's time zone. | P0 | REVIEW | `prisma/seed.ts:253-271`; `src/modules/notifications/application/handlers.ts:21-27`; `new-shift-dialog.tsx:79-80` |

**Recommended change (v3).** *Phase 0:* reminders at 24 hours and 2 hours; "not checked in 30 minutes after start" alert and backfill; West Africa Time everywhere; a holiday list through 2027. *Phase 4:* rota templates that generate independent requests, a calendar view (also the home of the two-way calendar), recurring bookings, replacement workflow, calendar export.

**Acceptance criteria.**

- Given a confirmed shift, then both people receive a reminder 24 hours and 2 hours before, with the time in West Africa Time.
- Given a practitioner not checked in 30 minutes after start, then the facility is alerted and a backfill invitation to the next-ranked eligible practitioners can be sent in one action.

---

## Module 9 · Attendance  *(repo folder `src/modules/attendance`; v2.9 Module 9)*

**Status:** Built · **Label:** CURRENT + IMPROVE · **Maturity for a Gombe pilot:** Ready after P0 fixes — the state machine and the code check are sound and tested, but check-in is not tied to the practitioner it is for, and the facility-side functions do not check which facility owns the shift.

**Why it exists.** A charge nurse at a Gombe general hospital needs proof that the locum was on the ward from 19:00 to 07:00, and the locum needs proof of the same. Without a record that both sides trust, every disputed night turns into a phone call and a paper register. It is also the gate between "confirmed" and "paid": nothing is invoiced unless the attendance record is Approved.

**Who uses it.**

| Actor | What they do here | Permission @ scope |
|---|---|---|
| Facility staff (charge nurse, administrator, owner) | Press "Code to check in" or "Code to check out" on the roster; record a shift by hand when the network failed | `attendance.record` @ FACILITY (`src/lib/authz/permissions.ts:140-147,199`) |
| Practitioner | Type the code the ward reads out; read their own record | `attendance.record` @ SELF (`:116-122`); `service_request.read` @ SELF |
| Medilink administrator | Read any shift's record and event log. Holds no right to write attendance | `service_request.read` @ PLATFORM (`:172-183`) |
| Worker (system) | Receives `shift.completed` and computes the timesheet | system |
| Practitioner, via Module 10 | Submit hours; the facility approves or rejects. Those moves change this record's state | see Module 10 |

**How it works today.**

1. **The record appears on first touch.** Nobody creates it when the assignment is confirmed. It is made the first time a code is issued or a hand record is written, and only for a confirmed assignment (`application/attendance.ts:94-103`). A confirmed shift that nobody touches has no record at all, which is how the no-show sweep in Module 13 finds it.
2. **The ward issues a code.** On the facility roster, staff press "Code to check in" (`app/facility/roster/attendance-panel.tsx:136-146`). The server checks the record is "not started" (or already "pending", which simply issues a fresh code), replaces any earlier unused code for that purpose, stores a keyed fingerprint of the six digits tied to this shift and this purpose, and returns the digits and a QR string once (`application/attendance.ts:147-205`). The dialog shows the digits for the supervisor to read aloud; they are never stored in readable form and never written to the audit trail.
3. **The practitioner presents it.** They type the digits on "My shifts" (`app/practitioner/shifts/check-in-panel.tsx`). The server checks that the move is legal, that a pasted QR string names this shift and this purpose, and that the code exists, is unused, has not had five wrong tries, is under five minutes old and matches. A wrong guess is counted before the answer goes back, so abandoning the request buys no free guess. On success the code is consumed, the record becomes "checked in", the arrival time is the server's clock (a screen cannot back-date it), an event row records who presented it and by which method, and `shift.started` is published (`application/attendance.ts:221-322`).
4. **Check-out repeats the same.** The ward can only issue a check-out code while the record is "checked in", and check-out must be after check-in (`:158-160,244-246`).
5. **When the network fails, the ward records by hand.** Staff type both times, an optional break, and a reason of at least ten characters. The record becomes "manually corrected"; two MANUAL events are written, with the time the shift happened and the time somebody typed it kept in separate columns; and `shift.completed` is published, exactly as for a code check-out (`application/attendance.ts:343-418`, `presentation/schemas.ts:27-37`).
6. **The timesheet takes over.** `shift.completed` makes the worker compute the sheet (Module 10). The practitioner submits it there and the facility approves or rejects it there; each of those changes this record's state.
7. **A dispute (Module 14)** moves an approved or rejected record to "disputed" and remembers where it came from, so a dismissed case can put it back exactly (`application/attendance.ts:470-564`).
8. **Reading.** The record and its event log are returned only to the shift's practitioner, to the shift's own facility, or to a platform holder (`app/api/v1/assignments/[id]/attendance/route.ts:28-37`).

**What the practitioner's screen does and what the server does.** The practitioner's app shows the code box from three hours before the shift starts and says so (`app/practitioner/shifts/check-in-panel.tsx:33,68-70`). That is the only time rule. The server accepts a code at any hour, and issues one at any hour (ATT-03).

**Shift-day walk-through, part 1 (the ward).** A night shift at a general hospital: scheduled Wednesday 9 September 2026, 19:00 to 07:00 West Africa Time (WAT, UTC plus one hour), at ₦5,000 per hour (500,000 kobo). Part 2 is in Module 10.

| Time (WAT) | What happens | Attendance record |
|---|---|---|
| 16:00 | The practitioner's app starts showing the code box ("Check-in opens three hours before the shift") | Not started (no record exists yet) |
| 19:00 | The charge nurse presses "Code to check in". The app shows six digits, good for five minutes and five tries | Check-in pending |
| 19:00 | The practitioner types the digits. The server stamps its own clock, 19:00, as the arrival time | Checked in |
| 07:00 (Thursday) | The charge nurse presses "Code to check out"; the practitioner types it. The server stamps 07:00 | Checked out |
| a few seconds later | The event `shift.completed` reaches the worker, which computes the timesheet (Module 10, part 2) | Checked out |
| (if the network had failed) | The charge nurse records 19:00 and 07:00 by hand with a reason such as "ward network down all night; times from the paper register" | Manually corrected; the practitioner must still submit |

**The nine states, in plain English.**

| State | What it means | Can go to | Triggered by |
|---|---|---|---|
| Not started | Nothing has happened on the day. A record exists only once somebody touches it | Check-in pending; Manually corrected | Ward issues a check-in code; ward records by hand |
| Check-in pending | The ward has issued a code and is waiting for the practitioner | Checked in; Not started (**unused**, see ATT-07); Manually corrected | Practitioner presents the right code; hand record |
| Checked in | The practitioner is on shift; the arrival time is stored | Checked out; Manually corrected | Practitioner presents the check-out code; hand record |
| Checked out | The shift ended and hours are known; the practitioner has not yet sent them in | Submitted; Manually corrected | Practitioner submits (Module 10); correction |
| Submitted | The practitioner has sent the hours for the facility's decision | Approved; Rejected; Manually corrected | Facility approves or rejects; facility corrects |
| Approved | The facility accepted the hours. This is the state that makes the shift billable | Disputed (only) | Facility approves |
| Rejected | The facility refused, with a written reason | Manually corrected; Submitted; Disputed | Facility rejects |
| Disputed | The shift is on hold while the platform decides a case | Submitted (upheld); Approved or Rejected (dismissed or withdrawn, whichever it was) | A party opens a dispute; the case closes |
| Manually corrected | A person overrode the record, from the ward register or a facility correction. The practitioner must submit again | Submitted | Hand record; facility correction (Module 10) |

All 20 legal pairs are in one table, and the unit test checks all 81 ordered pairs against a separately written list of the 20 (`domain/state-machine.ts:44-61`; `domain/state-machine.test.ts:12-80`). No state is permanently final: an approved shift can be disputed and a dispute resolves back into the machine.

**Rules the system enforces.**

- The code is six digits from a cryptographic random source and lives 300 seconds; five wrong tries kill it (`domain/check-in-token.ts:15,23,26,30-32`).
- The stored fingerprint is a keyed hash over purpose, shift and code, so a check-in code cannot be replayed as a check-out and a code for one shift cannot be used on another (`domain/check-in-token.ts:44-53`).
- Issuing a new code supersedes the old one; the plaintext is returned once and is never stored or audited (`application/attendance.ts:169-172,191-200`).
- Attendance can only be recorded against a confirmed assignment (`application/attendance.ts:96`).
- Check-out must be after check-in; a hand record needs a reason of ten to 500 characters and a break of 0 to 1,440 minutes (`presentation/schemas.ts:27-37`; `application/attendance.ts:244-246,346-349`).
- The attendance event log is append-only; a hand record keeps "when it happened" apart from "when it was recorded".
- Every state change writes an audit row with before and after. The code itself never appears in one (`tests/integration/attendance.test.ts:498`).
- The nine states are exactly those named in v2.9 §9.16 (`domain/state-machine.ts:11-21`).
- Tests today: 9 state-machine cases plus 81 generated pair cases, 21 token cases, 21 integration cases (round trip, QR, wrong, used, expired and superseded codes, another shift's QR, hand record, audit) and 3 browser tests. Not tested: a non-assignee presenting, another facility issuing, any time window, a hand record far from the shift, two parallel presents.

**The review said X; at HEAD it is fixed.** An earlier defect, noted in a code comment, was that a shift recorded by hand never reached the timesheet because it published no event. At HEAD it publishes `shift.completed` like a code check-out (`application/attendance.ts:400-414`). Reading attendance, timesheets and excusals also now checks that the shift is in the caller's scope instead of trusting the scope the caller claims (`getAssignmentInScope`, `src/modules/matching/application/assignment.ts:633-651`; `app/api/v1/assignments/[id]/attendance/route.ts:28-37`). Do not reopen either.

**What is not there yet.**

| ID | Gap | Sev | Source | Evidence |
|---|---|---|---|---|
| ATT-01 | Check-in is not tied to the assignee. Any signed-in practitioner who hears or guesses the code can check someone else in, and can burn another shift's five tries. The event keeps the presenter's id, so it is visible only afterwards. | P0 | REVIEW | `application/attendance.ts:224-228,241-242,263-268`; `app/api/v1/assignments/[id]/attendance/present/route.ts:20-28` |
| ATT-02 | The facility-side "issue a code" and "record by hand" functions never check that the shift belongs to the facility named in the request. Staff of hospital A can issue codes or write hours for hospital B's shift by sending their own facility id with B's shift id. The audit row names the real facility, so it is detectable, not prevented. | P0 | NEW | `application/attendance.ts:147-148,351-358`; `app/api/v1/assignments/[id]/attendance/token/route.ts:21-27`; `.../manual/route.ts:22-33` |
| ATT-03 | There is no server-side check-in window. The three-hour rule exists only on the practitioner's screen, and nothing limits check-in or code issue after the shift ends. | P1 | REVIEW | `app/practitioner/shifts/check-in-panel.tsx:33,68-70`; `application/attendance.ts:147-205,221-322` |
| ATT-04 | Hand-recorded and corrected times can be any date, including the future or days from the shift. The practitioner is never asked whether they agree; their only touchpoint is pressing Submit. | P1 | REVIEW | `presentation/schemas.ts:27-37`; `application/attendance.ts:346-349` |
| ATT-05 | No idempotency. A retry after a lost success returns "illegal transition" and the screen says "That code did not work". Two parallel valid presents can both pass, because the update of the code is not checked and the record update is unconditional (by reading). | P1 | REVIEW | `application/attendance.ts:241-242,273-284`; `app/practitioner/shifts/check-in-panel.tsx:62` |
| ATT-06 | The wrong-try limit reads a count and then increments it, so a burst of parallel guesses can exceed five. With ATT-01, the exposure is a colleague's check-in. By reading. | P1 | NEW | `domain/check-in-token.ts:119-121`; `application/attendance.ts:253-268` |
| ATT-07 | Stuck states have no sweep or alert. "Check-in pending" never lapses (the move back to "not started" is in the table and no code uses it), "checked in" is never checked out, "checked out" is never submitted. The ward must notice. | P1 | NEW | `domain/state-machine.ts:46-48`; `src/worker/jobs.ts:31-68` |
| ATT-08 | The QR exists only as an API string. No screen draws a QR and none scans one; practitioners type digits. | P1 | V2.9 | `app/facility/roster/attendance-panel.tsx:35,180`; `app/practitioner/shifts/check-in-panel.tsx:98` |
| ATT-09 | A practitioner cannot record or declare a break; it exists only if the facility enters it by hand or in a correction. v2.9 lists breaks, overtime and on-call under attendance. | P1 | V2.9 | `app/practitioner/shifts/check-in-panel.tsx:50-55`; `application/attendance.ts:367` |
| ATT-10 | No offline or queued check-in for weak connections, although v2.9 expects the practitioner client to queue check-in events and sync later. | P1 | V2.9 | `docs/stage-7-1-7-2-7-3-attendance.md:94-97` |
| ATT-11 | A device identifier is accepted but no screen sends one, so spec §9.16's "device identifier" is not captured. | P2 | V2.9 | `presentation/schemas.ts:23`; `application/attendance.ts:293` |
| ATT-12 | Optional coarse location is absent by design (nothing in the schema holds coordinates). Spec says optional and never the sole method. | P2 | V2.9 | `prisma/schema.prisma:1232-1250`; `docs/stage-7-1-7-2-7-3-attendance.md:112-115` |

**Recommended change (v3).**

*Phase 0, make it safe.* Two small fixes close the P0 gaps. Compare the signed-in practitioner to the assignee, and require the assignment to still be confirmed, before a code is accepted (ATT-01). Pass the facility id into the code-issue and hand-record functions and refuse a shift that is not the facility's, answering 404 as the timesheet functions do (ATT-02). Add a test for each, in the style of the existing scope tests.

*Phase 1, Gombe pilot.* The one Booking carries the shift window and the check-in rules, so attendance hangs off the Booking rather than a bare assignment. Move the window to the server: a code can be issued and presented from a configurable time before the start until a configurable time after the end (ATT-03). Bound hand-recorded and corrected times to the shift window plus a grace, refuse future times, and send the practitioner an in-app and SMS "do these hours look right?" with an auto-accept deadline (ATT-04). Take an idempotency key on the present call and compare-and-set the code and the record, so a retry returns the first answer (ATT-05, ATT-06). Raise an alert 30 minutes after the start when nobody has checked in, and nudge when a record sits in "checked in" or "checked out" (ATT-07; the no-show side is SAN-01). Draw the QR and add a scanner (ATT-08). Let the practitioner enter a break at check-out (ATT-09).

*Phase 2 and later.* A queued check-in for weak networks, delivered as part of the offline shell (ATT-10); a device identifier from the app (ATT-11); optional coarse location as a signal for fraud review, never as the only proof, and only after a privacy assessment (ATT-12). Notifications for check-in and check-out belong to the Notifications module.

**Acceptance criteria.**

1. Given a shift assigned to nurse A, when nurse B presents the correct code for that shift, then the request is refused and no event is written; given the right nurse presents it, then the record becomes "checked in".
2. Given a shift of hospital B, when hospital A's charge nurse asks to issue a code or write a hand record for it, then the answer is 404 and nothing changes.
3. Given a shift that started yesterday, when a code is issued or presented outside the configured window, then the request is refused with the window in the message.
4. Given a hand record whose times lie outside the shift window plus grace, or in the future, when it is saved, then it is refused; given times inside the window, then the practitioner is asked to confirm before the sheet is sent.
5. Given a successful check-in whose response was lost, when the app retries with the same idempotency key, then it receives the original success and no second event exists.
6. Given six wrong codes sent in parallel for one token, then at most five are counted and the token is dead.
7. Given a shift with no check-in 30 minutes after its start, then the facility and the practitioner are notified and the shift is shown as "not checked in" on the roster.
8. Given a QR issued by the ward, when the practitioner scans it, then it checks them in exactly as the typed digits would.

---

## Module 10 · Timesheets  *(repo folder `src/modules/timesheets`; v2.9 Module 9, second half)*

**Status:** Built · **Label:** CURRENT + IMPROVE · **Maturity for a Gombe pilot:** Ready after P0 fixes — hours, revisions and approval work and are tested, but a facility that never approves stalls the practitioner's pay, the sheet shows a different figure from the invoice, and a holiday night loses minutes at billing.

**Why it exists.** A PHC ward manager will not pay for hours they have not seen, and a night nurse wants every night and holiday minute counted. A timesheet turns "who checked in and out when" into hours, bands and an amount that both sides can read, with every correction kept. Without it, pay is argued on the phone and nobody can show what the figures used to be.

**Who uses it.**

| Actor | What they do here | Permission @ scope |
|---|---|---|
| Practitioner | Read their sheet, submit it | `timesheet.submit` @ SELF (`src/lib/authz/permissions.ts:116-122`) |
| Facility staff (administrator, owner) | Approve, reject with a reason, correct the hours | `timesheet.approve` @ FACILITY (`:140-147,199`) |
| Medilink administrator | Read any sheet; raise invoices from approved ones (Module 12) | `service_request.read` @ PLATFORM (`:172-183`) |
| Worker (system) | Computes the sheet when a shift is completed | system |

**How it works today.**

1. **The sheet is computed when the shift ends.** The event `shift.completed` (a code check-out, or a hand record) makes the worker call `computeAndSaveTimesheet`. It needs both a check-in and a check-out, reads the current hourly rate from the service request, loads the public-holiday dates for the days the shift touches, and saves one sheet per shift. Two callers can reach it at once, so it is a single upsert that cannot fail on a clash (`application/timesheet.ts:92-159`; `src/worker/handlers.ts:38-40`).
2. **The minute walk.** The calculation looks at every minute between check-in and check-out on the Nigerian clock (WAT). For each minute it asks two questions: is it between 20:00 and 06:00 (night), and does its calendar date appear in the holiday table. It counts night minutes, holiday minutes, and the minutes that are both. Then it takes the break off. Nothing records when the break was taken, so the break is removed proportionally from every band instead of from the cheapest one. Overtime is whatever remains beyond the length the request asked for. On-call is never derived; it is a number a facility types (`domain/hours.ts:103-206`).
3. **The amount is the base rate only.** `amount = billable minutes × hourly rate ÷ 60`, rounded once, in kobo. Night, holiday and overtime premiums are not in it (`domain/hours.ts:193`).
4. **The practitioner submits.** The server checks the sheet is theirs, recomputes from the attendance record, and sets the record to "submitted". `timesheet.submitted` is published; nobody consumes it (`application/timesheet.ts:179-230`).
5. **The facility decides.** On `/facility/timesheets`, only a submitted sheet shows buttons. *Approve* sets "approved" with a compare-and-set, so two people clicking cannot both win, and publishes `timesheet.approved`. *Reject* needs a reason; the practitioner then submits again or disputes. *Correct the hours* changes check-in, check-out, break or on-call with a reason of ten or more characters (`application/timesheet.ts:245-419`; `app/facility/timesheets/page.tsx:396,458`).
6. **A correction keeps everything.** Before anything moves, the whole earlier sheet and the earlier check-in and check-out times are saved as a revision with the actor and the reason. The attendance record becomes "manually corrected", the sheet's revision number goes up, and the sheet is recomputed. The facility's screen then shows no Approve button for that sheet, so the **practitioner must submit again before the facility can approve** (`application/timesheet.ts:340-419`).
7. **Approval completes the assignment.** After the approval commits, a second step sets the assignment to "completed", which ends cold start for the reliability score and makes the shift invoiceable. It is not in the same transaction (`application/timesheet.ts:305-313`; `src/modules/matching/application/assignment.ts:658-708`).
8. **Invoicing.** An officer later raises an invoice from approved shifts; Module 12 prices the bands with the facility's rate card.

**Shift-day walk-through, part 2 (the hours).** Continuing the night shift from Module 9: Wednesday 9 September 2026, 19:00 to 07:00 WAT, ₦5,000 per hour.

| Time (WAT) | What happens | Attendance record |
|---|---|---|
| 07:00 Thu | Check-out. The worker walks 720 minutes: **night 600** (20:00 to 06:00), holiday 0, break 0, overtime 0, so 120 minutes are neither night nor holiday. Base amount ₦60,000 (6,000,000 kobo). Both consoles show the sheet | Checked out |
| 08:30 | The practitioner presses Submit. The sheet is recomputed first, then sent | Submitted |
| 10:00 | The charge nurse says the practitioner took an hour's break and presses "Correct the hours": break 60, with a reason. Revision 1 saves the 720-minute version. The sheet is recomputed: billable 660, **night 550** (600 × 660 ÷ 720, rounded), ordinary 110, base ₦55,000 (5,500,000 kobo) | Manually corrected |
| 10:05 | The facility's screen shows no Approve button for this sheet. Nobody is told that the practitioner now has to act | Manually corrected |
| later | The practitioner opens Timesheets, sees "revision 2" and presses Submit again | Submitted |
| later | The facility presses "Approve ₦55,000" (the base figure). The approval commits | Approved |
| right after | The assignment becomes Completed in a second step; the shift can now be invoiced (Module 12 prices night and holiday premiums) | Approved |

**The minute walk on four shifts** (₦5,000 per hour; figures recomputed by hand from the classifier and not run in the app):

| Case | Worked | Break | Billable | Night | Holiday | Overtime | Neither night nor holiday | Base amount |
|---|---|---|---|---|---|---|---|---|
| A. 19:00 to 07:00, no break | 720 | 0 | 720 | 600 | 0 | 0 | 120 | ₦60,000 (6,000,000 kobo) |
| A with a 60-minute break | 720 | 60 | 660 | 550 | 0 | 0 | 110 | ₦55,000 (5,500,000 kobo) |
| A, check-out at 08:00, no break | 780 | 0 | 780 | 600 | 0 | 60 | 180 | ₦65,000 (6,500,000 kobo) |
| B. 24 Dec 19:00 to 25 Dec 07:00, no break (25 Dec is a seeded holiday) | 720 | 0 | 720 | 600 | 420 | 0 | 60 | ₦60,000 (6,000,000 kobo) |

**Why case B matters.** Night (600 minutes) and holiday (420 minutes, the hours from midnight on 25 December) overlap for 360 minutes, 00:00 to 06:00. The sheet stores night 600 and holiday 420. The correct split into pieces that do not overlap is 60 ordinary (19:00 to 20:00), 240 night only (20:00 to midnight) and 420 holiday, which adds to 720. The classifier computes that split and then throws it away. Invoicing re-derives it by subtracting all 420 holiday minutes from the 600 night minutes, when only the 360 overlapping ones should come off, and gets 0 + 180 + 420 = 600. **So 120 minutes are never priced.** On the illustrative rate card used in Module 12's worked example (night ×1.5, holiday ×2.0) that is ₦12,500 less than the correct figure. Pricing detail is in Module 12; the cause is in this module's discarded split (TIM-03).

**Where a sheet is, in plain English.** A timesheet has no state of its own. It follows the attendance record, plus a revision number.

| Where the sheet is | What it means | Can go to | Triggered by |
|---|---|---|---|
| No sheet | The shift has not been checked out | Computed | Check-out or hand record publishes `shift.completed` |
| Computed (record "checked out", or "manually corrected") | The figures exist; the practitioner has not sent them | Submitted | Practitioner presses Submit |
| Submitted | The facility has the hours | Approved; Rejected; Corrected | Facility approve, reject or correct |
| Corrected, revision n+1 (record "manually corrected") | The facility changed the hours; the earlier version is saved | Submitted | Practitioner submits again |
| Approved | Accepted; assignment becomes Completed; invoiceable | Disputed | Facility approves |
| Rejected | Refused with a reason | Submitted; Corrected; Disputed | Facility rejects |
| Disputed | On hold while the platform decides (Module 14) | Submitted (upheld); Approved or Rejected (dismissed or withdrawn) | A party opens a case; the case closes |

Approval details (who, when, notes) live on the attendance record and are overwritten each time the sheet is reviewed; only the audit trail keeps earlier reviews (`prisma/schema.prisma:1189-1194`; `application/timesheet.ts:258-266`).

**Rules the system enforces.**

- Check-out must be after check-in; the break cannot be longer than the shift; a recorded shift may not exceed 24 hours (`domain/hours.ts:130-149`).
- Night is 20:00 to 06:00 WAT, written into the code, not configuration. WAT is UTC plus one hour (`domain/hours.ts:27-28`; `src/modules/availability/domain/availability.ts:15`).
- A holiday minute is one whose WAT calendar date is in `config.public_holidays` (`domain/hours.ts:81-87,118`).
- The break is deducted proportionally across bands (`domain/hours.ts:155-163`). Overtime is billable minutes beyond the requested length, with no daily cap (`:165-172`).
- On-call is entered by a person and survives every recomputation (`application/timesheet.ts:110-125`).
- Amount is whole kobo, rounded once, base rate only (`domain/hours.ts:193`).
- Only the sheet's practitioner can submit it (404 otherwise); only the shift's own facility can review or correct it (`application/timesheet.ts:188,247,344`).
- A rejection without a reason is refused in the form and again in the service (`presentation/schemas.ts:13-27`; `application/timesheet.ts:252`).
- Approval is compare-and-set on "submitted", so a second approval fails (`application/timesheet.ts:258-267`).
- A correction needs a reason of ten or more characters, writes the whole earlier state as a revision, and never overwrites it (`application/timesheet.ts:341,369-389`; `presentation/schemas.ts:29-40`).
- Completing an assignment that is already completed does nothing, so a disputed and re-approved shift counts once (`src/modules/matching/application/assignment.ts:672`).
- Tests today: 21 hour-calculation cases (midnight, holiday, break, rounding), 20 integration cases (pricing, reject needs a reason, approval completes, foreign facility refused, two corrections with both revisions kept, on-call kept, concurrent computes leave one row) and the five-test after-the-shift browser journey. Not tested: the second step failing after approval, a correction whose recompute fails, a night running into a holiday through to the invoice.

**The review said X; at HEAD it is fixed.** The review's pattern "claimed scope is checked, the record's scope is not" no longer holds here: submit, review, correct and read all check the shift belongs to the caller (`application/timesheet.ts:188,247,344`). A concurrency fault where a check-out followed at once by Submit made one of two writers fail on the unique key and the practitioner saw a server error is fixed by the single upsert (`application/timesheet.ts:146-156`; tested at `tests/integration/timesheets.test.ts:594`). Do not reopen either.

**What is not there yet.**

| ID | Gap | Sev | Source | Evidence |
|---|---|---|---|---|
| TIM-01 | No deadline, reminder or auto-approval. A facility that never approves stalls the practitioner's pay; nothing reminds either side. The facility screen acts only on "submitted" rows. | P0 | REVIEW | `src/worker/jobs.ts:31-68`; `app/facility/timesheets/page.tsx:396,458` |
| TIM-02 | The sheet is at base rate; the invoice adds night, holiday, overtime and on-call premiums from the facility's rate card. The facility approves a figure it will not be billed, and the button says "Approve ₦" followed by the base amount. | P0 | REVIEW | `domain/hours.ts:193`; `app/facility/timesheets/page.tsx:424-427,492`; `src/modules/rates-contracts/domain/pricing.ts:98-139` |
| TIM-03 | The correct non-overlapping split of minutes is computed and then discarded. Billing re-derives it by subtracting all holiday minutes from night, so a night that runs into a holiday loses minutes (case B: 120). The fix is in Module 12; the root cause is here. | P0 | REVIEW | `domain/hours.ts:183-189`; `application/timesheet.ts:134-144`; `src/modules/billing-settlement/application/invoice.ts:113-122` |
| TIM-04 | Approval and "assignment completed" are two steps. If the second fails, attendance is Approved, `timesheet.approved` is out, the assignment stays Confirmed, a retry is refused (approved to approved), the no-show sweep skips it, and billing still bills it. Review does not check the assignment's own status first. | P1 | REVIEW | `application/timesheet.ts:254,257-313`; `src/modules/attendance/application/attendance.ts:456-460` |
| TIM-05 | The holiday list is six fixed 2026 dates (no Easter, no Eid al-Fitr or al-Adha, no Maulud, nothing after 2026) and has no state or region. Nothing in the app can edit it. The night window is a constant. | P1 | REVIEW | `prisma/seed.ts:253-262`; `prisma/schema.prisma:406-417`; `domain/hours.ts:27-28` |
| TIM-06 | A facility correction puts a submitted sheet back to "manually corrected" and the facility has no Approve button until the practitioner submits again. Neither side is told. | P1 | NEW | `application/timesheet.ts:351-399`; `app/facility/timesheets/page.tsx:396,458`; `app/practitioner/timesheets/page.tsx:176-179` |
| TIM-07 | A correction is not atomic. The revision, the record change and the revision number commit, then the recompute runs. If the recompute fails, figures are stale, and a domain refusal surfaces as "cannot move from X to X". | P1 | NEW | `application/timesheet.ts:126-131,367-418` |
| TIM-08 | A check-in or check-out that makes a shift longer than 24 hours raises an error inside the `shift.completed` handler. The event retries and ends in the dead-letter queue with no message a person can act on. | P1 | NEW | `domain/hours.ts:147`; `src/worker/handlers.ts:38-40`; `src/worker/processor.ts:96-111` |
| TIM-09 | History is thinner than v2.9 asks. Review fields on the attendance record are overwritten on each review (earlier reviews only in the audit trail). A correction writes no check-in event and overwrites the record's times (the originals live in the revision). There is no approvals table and no per-line entries table. | P1 | V2.9 | `application/timesheet.ts:258-266,391-399`; `prisma/schema.prisma:1189-1194` |
| TIM-10 | No weekend band exists in the classifier or the rate card, although v2.9 lists weekend allowances. Overtime is paid with no approval step, although v2.9 expects "unapproved overtime" to be disputable. On-call can only be typed by the facility. | P1 | V2.9 | `domain/hours.ts:103-206`; `prisma/schema.prisma:1798-1801` |
| TIM-11 | Nobody is told when a sheet is submitted, approved, rejected or corrected. Four events, no handlers. | P1 | REVIEW | `src/worker/handlers.ts:15-52`; `application/timesheet.ts:217-226,284-296` |
| TIM-12 | The rate is read from the service request at every recomputation, not from the booking, and no premium multipliers are fixed at agreement. The new strategy needs level, rate and premiums frozen on the Booking. | P1 | V3 | `application/timesheet.ts:99-102,142` |

**Recommended change (v3).**

*Phase 0, make it safe.* Put a clock on approval (TIM-01): a facility has a set number of days to approve or reject, with a reminder partway, and a sheet nobody has disputed is approved automatically at the deadline. The number of days is for facilities in Gombe to agree; the redesign proposes the mechanism, not the number. Make the sheet show what will be billed (TIM-02): the Booking freezes the agreed rate and the facility's premium multipliers at agreement, the sheet prices night, holiday, overtime and on-call from that snapshot, and the facility approves one figure that is also the invoice figure. Persist the non-overlapping bands at computation and make Module 12 read them (TIM-03), with a test for a night that runs into a holiday.

*Phase 1, Gombe pilot.* Make approval and "completed" one transaction, or drive the second from the outbox with a repair job (TIM-04). Load the full holiday calendar as reference data owned by operations, with the moveable Islamic and Christian dates entered each year and a region column, and read the night window from configuration (TIM-05). Decide how a facility correction travels: either it stays with the facility for approval and the practitioner is told and may dispute, or it returns to the practitioner with an auto-accept deadline (TIM-06); this is a decision for the team and it must end the silence. Make the correction one transaction (TIM-07) and turn the over-24-hours case into a message the ward can act on (TIM-08). Send notices on submit, approve, reject, correct and the approaching deadline through the Notifications module (TIM-11).

*Phase 2 and later.* Add a weekend band and an approval step for overtime above a threshold, and let the practitioner record a break at check-out (TIM-10; ATT-09). Keep review and correction history in tables built for it (TIM-09). Freeze the rate on the Booking (TIM-12) so negotiated rates per person work.

**Acceptance criteria.**

1. Given a sheet submitted and not reviewed for the agreed number of days, when the deadline passes and no dispute is open, then the sheet is approved automatically and both sides are told; given a dispute is open, then it is not.
2. Given a facility with a night multiplier of 1.5, when a practitioner's sheet for a night shift is shown, then the figure on the sheet, on the Approve button and on the invoice line are the same.
3. Given a shift from 24 December 19:00 to 25 December 07:00 with no break, when the invoice is raised, then it prices 60 ordinary, 240 night and 420 holiday minutes and no minute is dropped.
4. Given approval has committed, when marking the assignment completed fails, then the failure is retried automatically and the assignment ends Completed, or the approval itself is rolled back; the two never disagree for long.
5. Given a facility corrects a submitted sheet, then both sides are told, the earlier version is kept, and the sheet is approvable without an unexplained stall.
6. Given a shift on a date entered in the holiday table for the facility's state, then its minutes count as holiday; given a date not in the table, then they do not.
7. Given a check-out that makes a shift longer than 24 hours, when the sheet cannot be computed, then the ward sees a plain message and the event is not left silently in the dead-letter queue.

---

## Module 11 · Rates and contracts  *(repo folder `src/modules/rates-contracts`; v2.9 Module 10)*

**Status:** Built · **Label:** CURRENT + IMPROVE · **Maturity for a Gombe pilot:** Ready after P0 fixes — the pricing maths works, but a missing floor lets any rate publish, premiums are not frozen at booking, and the holiday list runs out on 26 December 2026.

**Why it exists.** A ward manager at a Gombe general hospital needs to post a night shift at a rate a nurse will take, and a nurse needs to know the pay is not a race to the bottom. Without a minimum rate, facilities undercut each other and the platform is blamed for hosting it. Without a rate card there is nowhere to record that nights, holidays and overtime pay more than the base rate, so every extra becomes an argument after the shift. Where the floors live matters: in the code the minimum-rate check sits in the service-requests module and the data in config; this chapter covers both, plus the facility rate card and the pricing maths.

**Who uses it.**

| Actor | What they do here | Permission @ scope |
|---|---|---|
| Facility administrator / facility owner | Sets or replaces their facility's rate card; types the hourly rate on a shift request | `facility.write` @ FACILITY (cards); `service_request.publish` @ FACILITY (requests) |
| Facility staff | Reads the card and the shift's rate | `facility.read` @ FACILITY |
| Platform administrator | Can set any facility's card; cannot edit floors in the product | `facility.write` @ PLATFORM |
| Compliance / finance owner of floors | Owns the floor numbers; today can only change them through the seed script | none (no route); `config.manage` is described as owning floors but is not wired to any floor route |
| Practitioner | Sees the base hourly rate on an offer; **cannot** read the rate card | `service_request.read` @ SELF; no `facility.read` |
| System | Checks the floor at create and publish; prices bands when an invoice is raised | n/a |

**How it works today.**
1. **Floors.** Compliance seeds a minimum hourly rate per profession category, optional specialty (`*` means any), and day or night, each with an effective date. Four placeholder rows exist: doctor ₦5,000 day / ₦6,500 night, nurse ₦2,500 day / ₦3,250 night (comment in the seed: "placeholder floors pending the signed revenue decision").
2. **Request.** A facility types one hourly rate for the whole request. The system finds the governing floor using the shift's start date and refuses a lower rate, once when the draft is created and again at publish. The rate cannot be edited afterwards (no edit route), so it is effectively frozen.
3. **Rate card.** A facility may set four multipliers: night (20:00-06:00 WAT), public holiday, overtime, on-call. All default to 1.0×, so a facility that never sets a card pays the plain rate. Saving a card makes it active immediately and marks the previous one superseded; nothing is deleted.
4. **Timesheet.** When the shift is worked, the timesheet records minutes per band and a base amount at the request's rate. It does not apply the card.
5. **Invoice.** When a Medilink officer raises an invoice, the system takes the facility's active card at that moment and prices every shift on the invoice with it (see Module 12).

**How a floor is chosen (most specific first).**

| Order | Rule |
|---|---|
| 1 | Must match the profession category and day/night. |
| 2 | Must have started on or before the **shift's** start (not today). |
| 3 | A floor naming the request's specialty beats the category-wide `*`, even if the `*` floor is newer. |
| 4 | Among equally specific floors, the latest start date wins. |
| 5 | No matching floor: the rate is accepted, whatever it is. |

**How the four multipliers are priced.**

| Band | Default | Allowed range | Pricing rule |
|---|---|---|---|
| Night | 1.0× | 1.0×-5.0× | night minutes × rate × multiplier |
| Public holiday | 1.0× | 1.0×-5.0× | **replaces** night for those minutes; the two never compound |
| Overtime (beyond the scheduled length) | 1.0× | 1.0×-5.0× | adds only the part above 1.0× on top of the band the minutes already sit in |
| On-call | 1.0× | 1.0×-5.0× | added whole; on-call minutes are not part of worked time |

**State of a rate card.**

| State | Can go to | Triggered by |
|---|---|---|
| DRAFT | (never used; no code sets it) | n/a |
| ACTIVE | SUPERSEDED | the facility saving a newer card |
| SUPERSEDED | nothing | automatic when the next card is saved; kept with an end date |

Floors have no state; they are dated rows. Tests present: pricing (16 unit cases), floor resolution (22 request unit cases including specialty and date rules), floor refusal at create and publish (integration), card supersession and below-par refusal (integration).

**Rules the system enforces.**
- A request below the governing floor cannot be created or published, and the refusal names the floor in naira.
- A rate exactly at the floor is accepted.
- The floor that applies is the one in force at the shift start, not at the moment of drafting.
- A specialty-specific floor beats the category-wide one.
- Every multiplier must be a whole number of basis points between 10,000 and 50,000; a card below 1.0× or above 5.0× is refused.
- Saving a card supersedes the previous active card in one transaction and keeps it.
- A night minute that is also a holiday minute is paid the holiday rate only.
- Overtime adds only the extra above par, never the full multiplier again.
- With no card at all, pricing equals the plain agreed rate.

**What is not there yet.**

| ID | Gap | Sev | Source | Evidence |
|---|---|---|---|---|
| RAT-01 | A missing floor lets any rate publish. The seed has floors for doctors and nurses only, so pharmacist, laboratory scientist and radiographer shifts have no minimum at all. | P0 | REVIEW | `src/modules/service-requests/domain/rate-floor.ts:82`; `prisma/seed.ts:278-281` |
| RAT-02 | Premiums are not frozen at booking. One card, chosen when the invoice is raised, prices every shift on it; the card's own effective dates and the shift dates are ignored; a facility can supersede its card (down to 1.0×) any time before the officer raises the invoice. Only the base rate is effectively frozen (immutable request, copied to the timesheet). | P0 | REVIEW | `src/modules/rates-contracts/application/rate-card.ts:134-140`; `src/modules/billing-settlement/application/invoice.ts:166-167` |
| RAT-03 | The holiday premium silently stops after 26 Dec 2026. Only six fixed 2026 dates are seeded, no 2027, no moveable holidays (Eid, Good Friday, Easter Monday), and no screen or route writes holidays. | P0 | NEW | `prisma/seed.ts:253-271`; `src/modules/timesheets/application/timesheet.ts:64` |
| RAT-04 | The on-call multiplier cannot be below 1.0×, although the code describes on-call as paid at a fraction of the rate. | P1 | REVIEW | `src/modules/rates-contracts/domain/pricing.ts:22,29-31`; `src/modules/rates-contracts/presentation/schemas.ts:10` |
| RAT-05 | On-call defaults to full rate, and its whole amount is counted as "premium" because on-call minutes sit outside the base. | P1 | NEW | `src/modules/rates-contracts/domain/pricing.ts:34-39,128-138` |
| RAT-06 | Each band rounds on its own while the base rounds once, so at par the "premium" can be +1 or -1 kobo; the facility approves one figure and is invoiced a figure that can differ by a kobo or two. | P1 | REVIEW | `src/modules/rates-contracts/domain/pricing.ts:76-82,134-138` |
| RAT-07 | No ceiling on an hourly rate (any positive whole number), no check against the floor, and the new-shift form pre-fills ₦5,000 for every profession. | P1 | REVIEW | `src/modules/service-requests/presentation/schemas.ts:29`; `src/app/facility/shifts/new-shift-dialog.tsx:55` |
| RAT-08 | No weekend allowance band, although v2.9 lists weekend allowances and a schema comment mentions weekend. | P1 | V2.9 | `src/modules/rates-contracts/domain/pricing.ts:98-139`; `prisma/schema.prisma:1295` |
| RAT-09 | Only hourly rates. No daily or fixed-shift rate; floors have no engagement-type key (nor level, region or urgency). | P1 | V2.9 | `prisma/schema.prisma:937`; `src/modules/service-requests/domain/rate-floor.ts:12-18` |
| RAT-10 | No transport or accommodation allowances on a request or a rate card. | P2 | V2.9 | `prisma/schema.prisma:922-967,1793-1818` |
| RAT-11 | No cancellation penalty: cancellation terms are free text with no money consequence. | P1 | V2.9 | `src/modules/service-requests/presentation/schemas.ts:33` |
| RAT-12 | No tax or withholding configuration. | P1 | V2.9 | `prisma/schema.prisma:1793-1818` |
| RAT-13 | Floors can be changed only through the seed script, which overwrites same-key floors on every run; the permission described as owning floors (`config.manage`) is wired only to agreements; the numbers are placeholders. | P1 | NEW | `prisma/seed.ts:274,295`; `src/lib/authz/permissions.ts:47`; `src/modules/audit-compliance/routes.ts:25-27` |
| RAT-14 | Shift type (day/night) is chosen by hand, not derived from the start and end times, so a night shift labelled day is checked against the lower floor. | P1 | REVIEW | `src/modules/service-requests/presentation/schemas.ts:24`; `src/modules/service-requests/application/request.ts:153-160` |
| RAT-15 | Practitioners cannot read the rate card, so premiums are invisible when an offer is accepted; the code comment says they may. The facility also approves a base-only timesheet figure (see BIL-11). | P1 | REVIEW | `src/modules/rates-contracts/permissions.ts:7-11`; `src/lib/authz/permissions.ts:116-122` |
| RAT-16 | No per-engagement contract: agreements are user-to-platform, versioned, with recorded acceptance, but nothing requires acceptance before a shift is accepted or billed, and an acceptance is not tied to a booking or a rate. | P1 | V2.9 | `prisma/schema.prisma:1987-2037` |
| RAT-17 | Rate-card integrity: DRAFT is never used, nothing enforces one active card per facility, a backdated card gives an end date earlier than the old card's start, and two simultaneous saves can leave two active cards. | P2 | NEW | `src/modules/rates-contracts/application/rate-card.ts:95-112`; `prisma/schema.prisma:1815` |
| RAT-18 | Docs list "rate floors" under this module although they live in service-requests/config, and number the module 11 where v2.9 numbers it 10. | P2 | NEW | `docs/module-map.md:19-20` |
| RAT-19 | Floors have no level or unit and are checked only at create and publish; v3 needs level-keyed floors and a re-check on every proposal and counter-offer. | P1 | V3 | `src/modules/service-requests/domain/rate-floor.ts:12-18` |

**Recommended change (v3).** In order:
1. **Fail closed on floors (RAT-01, RAT-13).** A shift whose profession has no floor cannot publish. Seed a floor for all five professions with Gombe clinicians and compliance, and add an audited floors screen so the seed stops being the only editor. The seed must never overwrite an edited value.
2. **Fix the holiday data (RAT-03).** Load 2027 and the moveable 2026 dates now, add an owner-edited holiday list with a "next year's list is complete" alert.
3. **Snapshot at booking (RAT-02, RAT-15).** When a booking is confirmed, copy the agreed hourly rate, the four multipliers and (later) the fee policy onto the booking, and price invoices from the booking, not from the facility's current card. Show the premiums on the offer so the practitioner sees what they will be paid. This is the "one Booking" design applied to money.
4. **Tidy the arithmetic (RAT-04, RAT-05, RAT-06, RAT-07).** Allow on-call below 1.0×, price the whole sheet in one rounding pass (or round lines and define base as the sum of lines), and add a ceiling guard: a warning above a multiple of the floor and a hard cap.
5. **Match the spec (RAT-08 to RAT-12, RAT-14).** Derive shift type from the times; add a weekend band (or a general list of dated pay rules); allowances and cancellation penalties as money fields; a tax/withholding configuration after counsel.
6. **Levels and negotiation (RAT-19).** Key floors by profession, level, specialty, shift type and unit; re-check the floor on every proposal and counter-offer; store three money figures (offered, requested, agreed).

**Acceptance criteria.**
- Given a pharmacist shift request, when no floor exists for pharmacists, then publishing is refused with a message naming the missing floor.
- Given a doctor night floor of ₦6,500, when a request is saved at ₦6,499.99, then it is refused; at ₦6,500 it is accepted.
- Given a shift crossing midnight into 25 December, when its minutes are priced, then those minutes are paid the holiday rate and none is paid twice.
- Given a confirmed booking with night 1.5×, when the facility later saves a card with night 1.0×, then the booking still prices at 1.5×.
- Given a facility with no rate card, when a shift is priced, then the total equals hours × rate with zero premium.
- Given a card with on-call 0.5×, when 2 on-call hours are priced at ₦5,000, then the on-call line is ₦5,000 (500,000 kobo).
- Given two lines priced at par, when the invoice is built, then base equals the sum of the lines and the premium is zero.
- Given a date in the following calendar year, when no holiday list is loaded for it, then the owner sees an alert before the first shift of that year.

---

## Module 12 · Billing, ledger and settlement  *(repo folder `src/modules/billing-settlement`; v2.9 Module 11)*

**Status:** Partly built · **Label:** CURRENT + NEW EXPANSION · **Maturity for a Gombe pilot:** Not ready — invoices, ledger and payout steps exist, but the amounts can be wrong, money is credited and payable before it is collected, a payout can be created twice, and no payout can complete outside a developer machine.

**Why it exists.** A nurse who covers a night shift at a Gombe PHC wants to be paid promptly and know what she is owed; the facility wants one bill it can trust; Medilink needs a record that survives an audit. Without a ledger, nobody can answer "who owes what" six months later. Without a controlled payout step, one wrong click pays the wrong amount to the wrong person. The module turns approved timesheet hours into an invoice, a set of balanced ledger entries and a two-step payout. It is a **ledger and an operator console**, not a payment system: no money is captured by software, and the gateway is a console stub that works only on a developer machine.

**Who uses it.**

| Actor | What they do here | Permission @ scope |
|---|---|---|
| Medilink administrator (finance work) | Raises a draft invoice, issues it, records that the facility paid, prepares and releases payouts | `payout.manage` @ PLATFORM (one permission for all five acts) |
| Medilink administrator / super administrator | Reads platform finance totals and every invoice | `invoice.read` @ PLATFORM |
| Facility administrator / owner | Reads that facility's invoices and totals (drafts hidden); cannot mark anything paid | `invoice.read` @ FACILITY |
| Practitioner | Reads own payouts and the "owed to you" figure | `invoice.read` @ SELF |
| Facility approver | Approves the timesheet that feeds an invoice | `timesheet.approve` @ FACILITY |
| Facility roles | Hold `payout.manage` in their role bundle, but every billing route needs PLATFORM scope, so it does nothing today | `payout.manage` (inert) |

No billing act needs step-up (fresh password). The only step-up permissions are `payout.account.change` (no route exists) and `role.grant`.

**How it works today.**
1. The facility approves a practitioner's timesheet. The timesheet holds minutes per band and a **base-rate-only** amount.
2. A Medilink officer chooses a facility and a period and presses "Raise". The system finds approved shifts in the period (by scheduled start) not already invoiced, takes the facility's current rate card, and prices each shift into one invoice line.
3. The same step creates the invoice (DRAFT, number `INV-<year>-<timestamp code>`), stamps the platform fee from the `PLATFORM_FEE_BP` setting (0 if unset or invalid), and writes **one balanced ledger entry set per shift**: the facility owes the gross; the practitioner is credited the gross less the fee; Medilink's revenue is credited the fee (omitted when zero). The practitioner's "owed" figure rises at this moment.
4. The officer issues the invoice (DRAFT to ISSUED). No ledger rows, no message.
5. The facility pays by bank transfer outside the system. The officer presses "Record payment" (ISSUED to PAID): cash in, facility obligation cleared, for the full gross. No reference, date, payer or partial amount is captured.
6. The officer prepares a payout for a practitioner: the amount is everything the ledger says they are owed, minus payouts already prepared or released. Nothing is written to the ledger.
7. The officer releases the payout. The gateway adapter is called; if it says "settled", the payout becomes SETTLED and the ledger moves the amount from the practitioner's earnings to cash-out. Any error marks it FAILED.

**State of an invoice.**

| State | Can go to | Triggered by |
|---|---|---|
| DRAFT | ISSUED | officer "Issue" (compare-and-set on status) |
| ISSUED | PAID | officer "Record payment" (compare-and-set) |
| PAID | nothing | n/a |
| VOID | nothing | declared in the database, **no code can set it** |

**State of a payout.**

| State | Can go to | Triggered by |
|---|---|---|
| PREPARED | RELEASED | officer "Release" (compare-and-set before the gateway call) |
| RELEASED | SETTLED, FAILED, or stays RELEASED | gateway result; `settled:false` is never completed by anything |
| SETTLED | nothing | gateway said settled; ledger written in the same transaction |
| FAILED | nothing | any error from the gateway call; a new payout must be prepared |

**Ledger accounts today.** FACILITY_PAYABLE (what a facility owes; positive = owed), PRACTITIONER_EARNINGS (negative = owed to the practitioner), PLATFORM_REVENUE (negative = earned), CASH (money in or out). Positive amounts are debits, negative are credits. Annex M1(a) shows every row for a worked shift.

**Events.** `invoice.created` (at draft), `payment.completed` (on "Record payment"), `payout.settled`. None has a subscriber, so nobody is told an invoice was issued, paid or a payout sent. No scheduled job touches money.

**The platform fee today.** Taken from the **practitioner**; the facility is invoiced the gross only. Recognised at **draft creation**, whether or not the invoice is ever paid. Rate comes only from the `PLATFORM_FEE_BP` setting (not in the environment schema or `.env.example`). It is 0% unless somebody sets it.

**Tests present.** Ledger maths (14 unit), pricing (16 unit), invoice-to-payout integration cycle (20), invoice paging (4), finance endpoints, five end-to-end browser steps. Not covered: holiday-and-night invoices, simultaneous payouts, gateway failure or timeout, a non-zero fee through the application, step-up or separation of duties on money routes.

**Rules the system enforces.**
- Only APPROVED attendance with a timesheet can be invoiced, and a shift can appear on at most one invoice line (database unique rule).
- Every ledger transaction must sum to exactly zero and contain whole kobo, or it is refused before it is written.
- A platform fee cannot be negative or exceed the work's value.
- Issue and pay are one-way compare-and-set steps; a second click gets "cannot become" instead of a double effect.
- A payout can be released once (compare-and-set); a second release is refused.
- A payout is prepared only for money the ledger shows as owed and not already in flight.
- Failed payouts leave the ledger untouched; the ledger is written only when the gateway says settled.
- `console` payment provider outside local stops the application at boot; the console adapter refuses to run outside local.
- Every invoice, issue, payment and payout step writes an audit row.
- A practitioner can read only their own payouts; an officer reads another's only at PLATFORM scope.

**What is not there yet.**

| ID | Gap | Sev | Source | Evidence |
|---|---|---|---|---|
| BIL-01 | Billing drops minutes when a holiday and a night overlap. It subtracts all holiday minutes from night and subtracts the overlap twice from ordinary, using overlapping figures the timesheet stored; the correct split is computed and thrown away. Example: a 19:00 24 Dec to 07:00 25 Dec shift is billed for 600 of 720 minutes, ₦12,500 (1,250,000 kobo) short. It only ever under-bills. | P0 | REVIEW | `src/modules/billing-settlement/application/invoice.ts:119-121`; `src/modules/timesheets/application/timesheet.ts:134-144` |
| BIL-02 | Practitioners are credited at invoice draft, not on payment. "Owed to you" shows money on drafts the facility cannot see. | P0 | REVIEW | `src/modules/billing-settlement/application/invoice.ts:222-234`; `src/app/practitioner/earnings/page.tsx:87-93` |
| BIL-03 | A payout does not check that any invoice was paid; the platform can pay before it is paid and the cash account can go negative. The test builds a payout from a draft. | P0 | REVIEW | `src/modules/billing-settlement/application/payout.ts:78-88`; `tests/integration/billing.test.ts:431-439` |
| BIL-04 | Two simultaneous "prepare" clicks both read the same balance and create two payouts of the full amount; release never re-checks the balance. A FAILED payout is also excluded from "in flight", so a new one can be prepared at once. | P0 | REVIEW | `src/modules/billing-settlement/application/payout.ts:78-93,83-86` |
| BIL-05 | Outside local there is no setting under which a payout can complete: `console` stops the boot, `none`/`paystack`/`remita` throw, and every release attempt leaves a FAILED payout. The pilot has no way to record a manual payout. | P0 | NEW | `src/modules/billing-settlement/infrastructure/gateway.ts:57-67`; `src/lib/env-rules.ts:63-67`; `src/modules/billing-settlement/application/payout.ts:142-164` |
| BIL-06 | No bank-account model: no payout destination, no verification, no reuse check; `payout.account.change` is a permission with no route. | P0 | REVIEW | `src/modules/billing-settlement/infrastructure/gateway.ts:18-22`; `docs/stage-4-8-step-up.md:22` |
| BIL-07 | Inbound payment is a bare button: no reference, amount, date or payer; always the full gross; no partial payment. | P0 | REVIEW | `src/modules/billing-settlement/application/invoice.ts:301-318` |
| BIL-08 | No void, credit note or reversing entry. VOID exists in the database but no code sets it; a wrong draft cannot be cancelled because its lines pin the shifts and the ledger has already credited the practitioner. | P0 | REVIEW | `prisma/schema.prisma:1870`; `src/lib/audit-coverage.ts:108` |
| BIL-09 | Disputes post no ledger adjustment. An upheld dispute can never change an invoiced shift because it cannot be re-billed. | P0 | REVIEW | `src/modules/billing-settlement/application/invoice.ts:152-164`; `src/modules/attendance/domain/state-machine.ts:52,59` |
| BIL-10 | Payouts ignore disputes: no hold, no disputed-amount account; v2.9 requires a hold on the disputed amount only. | P0 | REVIEW | `src/modules/billing-settlement/application/payout.ts:74-107` |
| BIL-11 | The facility approves a base-only timesheet figure but is invoiced a different, premium-inclusive figure. | P0 | REVIEW | `src/modules/timesheets/application/timesheet.ts:134-144`; `src/modules/billing-settlement/application/invoice.ts:169-194` |
| BIL-12 | No step-up or stronger protection on any money act, although v2.9 requires it for finance accounts. | P0 | REVIEW | `src/lib/authz/permissions.ts:77-83` |
| BIL-13 | No signed decisions behind the money model: fee model (3.1), legal role (3.2), authorise-then-capture with the provider (3.3) are all "Not started"; floors and fee are placeholders. | P0 | V2.9 | `docs/stage-3-gate-checklist.md:9-11` |
| BIL-14 | Any gateway error, including a timeout after the provider accepted, is recorded as FAILED with "nothing moved"; no pending state, no status query. Latent until a real provider exists. | P1 | REVIEW | `src/modules/billing-settlement/application/payout.ts:142-159`; `src/app/admin/payouts/page.tsx:241-243` |
| BIL-15 | Payout dead ends: a RELEASED payout with `settled:false` never completes (no webhook or poller); a PREPARED payout cannot be cancelled; the RELEASED claim commits before the gateway call, so a crash strands it. | P1 | NEW | `src/modules/billing-settlement/application/payout.ts:129-133,171`; `prisma/schema.prisma:1966-1973` |
| BIL-16 | No separation of duties: the same person can raise, issue, mark paid, prepare and release; the payout row records no preparer, so a maker-checker rule cannot be checked. | P1 | REVIEW | `src/modules/billing-settlement/routes.ts:18-25`; `prisma/schema.prisma:1939-1964` |
| BIL-17 | `payout.manage` is in the facility roles (a leftover of the retired facility finance role); only the PLATFORM scope on the routes stops it working. | P1 | REVIEW | `src/lib/authz/permissions.ts:145,199` |
| BIL-18 | Money columns are 4-byte integers: the cap is ₦21,474,836.47 per invoice, ledger row, payout or hourly rate (about 275 night shifts like the worked example on one invoice). The currency column is never set or validated. | P1 | REVIEW | `prisma/schema.prisma:1843-1844,1887-1897,1918,1943`; `prisma/migrations/20261007000000_baseline/migration.sql:1476-1550` |
| BIL-19 | Invoice numbers are a timestamp code, not sequential or gapless; two raised in the same millisecond collide. | P1 | REVIEW | `src/modules/billing-settlement/application/invoice.ts:198` |
| BIL-20 | No VAT, withholding tax or TIN anywhere (invoice, facility, practitioner, ledger). The gate asks for a worked tax example. | P1 | REVIEW | `prisma/schema.prisma:1833-1863`; `docs/stage-3-gate-checklist.md:9` |
| BIL-21 | The fee is borne by the practitioner (credit = gross less fee) where v2.9 says the facility bears it and the practitioner receives the accepted rate. | P1 | V2.9 | `src/modules/billing-settlement/domain/ledger.ts:104-108,127-133` |
| BIL-22 | Fee and earnings are recognised at draft creation, not on approved and collected work; no reversal if the invoice is never paid. | P1 | REVIEW | `src/modules/billing-settlement/application/invoice.ts:208,222-234`; `src/modules/billing-settlement/application/finance-summary.ts:35` |
| BIL-23 | The fee is one environment variable: no date, payer, scope, waiver, or applied rate stored per line. | P1 | REVIEW | `src/modules/billing-settlement/application/invoice.ts:43-46` |
| BIL-24 | `PLATFORM_FEE_BP` is not in the environment schema or `.env.example`; a typo silently means 0%; no upper bound (above 10000 makes every invoice raise fail; 10000 pays practitioners nothing). | P1 | NEW | `src/modules/billing-settlement/application/invoice.ts:43-46`; `src/lib/env.ts:9-62`; `src/modules/billing-settlement/domain/ledger.ts:113-118` |
| BIL-25 | The invoice's fee figure can exceed the ledger's revenue rows because the fee is floored per line after being floored on the total (lines 333/333/334 at 10%: invoice 100, ledger 99). The finance tile uses the invoice column. | P1 | NEW | `src/modules/billing-settlement/application/invoice.ts:197,223` |
| BIL-26 | The fee is not shown on the facility invoice or on any practitioner statement, and there are no downloadable statements or receipts. | P1 | V2.9 | `src/app/facility/invoices/page.tsx:93-113`; `src/app/practitioner/earnings/page.tsx:58-93` |
| BIL-27 | Money passes through Medilink's own cash account: the facility pays Medilink and Medilink pays out. There is no authorise-before-shift or capture-on-approval, which v2.9 §9.4.2 adopts and v3 requires ("Medilink never holds client funds"). | P1 | V2.9 | `src/modules/billing-settlement/domain/ledger.ts:29-30,151-184` |
| BIL-28 | No provider integration: no authorise, capture, void, refund, webhook, idempotent transfer reference or reconciliation; `paystack`/`remita` are named in the settings and implemented nowhere. | P1 | V2.9 | `src/modules/billing-settlement/infrastructure/gateway.ts:54-68`; `src/lib/env.ts:44-46` |
| BIL-29 | Ledger accounts missing for provider fees, taxes, refunds, holds, disputed amounts, failed payments, reversals and chargebacks; no reversal function. | P1 | V2.9 | `src/modules/billing-settlement/domain/ledger.ts:22-31` |
| BIL-30 | Ledger integrity is convention only: `account` is free text, no foreign keys to invoice or payout, no CHECK, no trigger, no actor or correlation id on entries; "append-only" is not enforced by the database. | P1 | REVIEW | `prisma/migrations/20261007000000_baseline/migration.sql:1517-1530`; `src/lib/audit-coverage.ts:108` |
| BIL-31 | Money events have no subscribers and carry no idempotency key or correlation id; invoice-issued, payout-prepared, released and failed publish no event. | P1 | REVIEW | `src/modules/billing-settlement/application/invoice.ts:246,337`; `src/worker/handlers.ts:15-52` |
| BIL-32 | Dashboards mix statuses: the "Platform fees" tile sums fee on every invoice including drafts and void; monthly "invoiced" includes drafts; the facility spend chart includes drafts while the facility invoice page hides them; the finance page says figures come from ledger entries but they come from invoices; totals cover verified facilities only. | P1 | NEW | `src/modules/billing-settlement/application/finance-summary.ts:32-45`; `src/modules/audit-compliance/application/facility-summary.ts:94`; `src/app/admin/finance/page.tsx:182` |
| BIL-33 | No reconciliation (end-of-day, month-end, provider reports) and no statement correction. | P1 | V2.9 | `tests/integration/billing.test.ts:361-403` (only sum-to-zero tests) |
| BIL-34 | No partial timesheet approval and no multi-tranche settlement: approval is approve or reject, payment is the whole gross, a payout is the whole balance. | P2 | V2.9 | `src/modules/timesheets/application/timesheet.ts:232-238`; `src/modules/billing-settlement/application/invoice.ts:318` |
| BIL-35 | `GET /payouts?scopeType=PLATFORM` without a person returns every payout and the platform-wide owed total, unpaginated (officer-only). | P2 | NEW | `src/app/api/v1/payouts/route.ts:41-50`; `src/modules/billing-settlement/presentation/schemas.ts:29-32` |
| BIL-36 | Admin screens: the payout page does not show the owed amount the API returns and shows the practitioner's phone; invoice tables omit overtime and on-call minutes; negative premiums are hidden. | P2 | NEW | `src/app/admin/payouts/page.tsx:64-71,172`; `src/app/facility/invoices/page.tsx:159-166,178-180` |
| BIL-37 | Invoice-raise mechanics: period filter uses scheduled start, period end before start is not rejected, the number is made outside the transaction, a simultaneous duplicate surfaces as a raw database error. | P2 | NEW | `src/modules/billing-settlement/application/invoice.ts:144-146,198`; `src/modules/billing-settlement/presentation/schemas.ts:5-9` |
| BIL-38 | Billing reads attendance, assignment, timesheet, user and facility tables directly, against the module rule. | P2 | REVIEW | `src/modules/billing-settlement/application/invoice.ts:141-150,430`; `docs/module-map.md:35` |
| BIL-39 | Documentation drift: `interfaces.md` says the earnings and facility-invoice pages are missing; they exist. | P2 | NEW | `docs/interfaces.md:134-136` |

**Recommended change (v3).** In the order of Annex M3:
1. **Make the numbers right first (BIL-01, BIL-11).** Persist the correct exclusive bands (or recompute with the domain function) and price once, at approval or booking, so the facility approves the figure it will be billed.
2. **Stop the leaks (BIL-03, BIL-04, BIL-12, BIL-16, BIL-17).** One open payout per person enforced by a partial unique index, re-check the balance at release, step-up on release and mark-paid, a preparer column and a different-person release rule, and take `payout.manage` out of the facility roles.
3. **Let the pilot move money by hand, safely (BIL-05, BIL-07, BIL-06, BIL-15).** A manual provider that records the bank reference, date and payer on inbound payments and payouts, completes RELEASED payouts, allows cancelling PREPARED ones, and uses a verified payout destination.
4. **Pay only collected money (BIL-02, BIL-03, BIL-22).** Practitioner earnings become payable on capture (or after a recorded payment); until then they are shown as "approved, awaiting facility payment".
5. **Corrections (BIL-08, BIL-09, BIL-10, BIL-29).** Void, credit note and reversing entries; a disputed-amount hold that blocks only the disputed part; ledger accounts for holds, disputes, reversals.
6. **Fee policy (BIL-21, BIL-23, BIL-24, BIL-25, BIL-26).** A dated fee policy table; fee payer, rate and amount stored on every line; fee recognised on approved, collected work; fee shown on quote, invoice and statement; fee total = sum of lines.
7. **Provider (BIL-14, BIL-27, BIL-28, BIL-33).** Licensed provider with authorise-before-shift, capture on approval, split settlement, idempotent webhooks, timeouts treated as "pending", reconciliation. Medilink's ledger records, the provider holds. A pooled or segregated account is not the target and needs counsel's sign-off if used at all.
8. **Data and tax (BIL-18, BIL-19, BIL-20, BIL-30).** Whole-number 64-bit money columns, gapless invoice numbers, tax and TIN fields after counsel, database protection for the ledger.

**Acceptance criteria.**
- Given a shift from 19:00 on 24 Dec to 07:00 on 25 Dec with a night and a holiday premium, when the invoice is raised, then all 720 minutes are billed and the line total equals ordinary + night + holiday as the timesheet's exclusive bands say.
- Given an invoice that is ISSUED but unpaid, when an officer prepares a payout for the practitioner, then the payout is refused, or limited to money already collected.
- Given two officers pressing "Prepare" at the same moment for one practitioner, when both requests run, then exactly one payout exists for that money.
- Given a gateway call that times out, when the payout is checked, then it shows "pending", is not FAILED, and a new payout for the same money cannot be prepared until the first is resolved.
- Given an officer who prepared a payout, when the same officer tries to release it, then the release is refused.
- Given a wrongly raised draft invoice, when an officer voids it, then its shifts become billable again and the ledger shows a reversing entry set rather than an edit.
- Given a dispute upheld over ₦5,000 of an invoiced shift, when it is resolved, then a ledger adjustment is posted and the undisputed part was payable throughout.
- Given any ledger transaction, when it is written, then it sums to zero and carries a correlation id and the acting user.

---

## Module 13 · Cancellations, no-shows and sanctions  *(repo folder `src/modules/cancellations-sanctions`; v2.9 Module 12)*

**Status:** Partly built · **Label:** CURRENT + NEW EXPANSION · **Maturity for a Gombe pilot:** Ready after P0 fixes — the rule that a person decides fault before anyone is marked a no-show works and is tested; but an absence is noticed only after the shift has ended, cancelling a request can leave a live assignment, and there is no ladder, appeal or penalty.

**Why it exists.** A PHC ward manager expects a nurse at 19:00. If nobody comes, the ward needs the shift covered and the platform needs to know whose fault it was: a flooded road and a locked ward are not the same as a nurse who switched their phone off. Without a fault decision, an innocent nurse carries a no-show; without any consequence, a habitual no-show keeps being offered work.

**Who uses it.**

| Actor | What they do here | Permission @ scope |
|---|---|---|
| Practitioner | Explain an absence to Medilink (an excusal request), read the reply | `attendance.record` @ SELF (`src/lib/authz/permissions.ts:116-122`) |
| Facility staff | Cancel a confirmed assignment through the API (no screen). Nothing else: no fault, excusal or no-show routes are open to a facility | `assignment.cancel` @ FACILITY (`:140-147`; route in Module 7) |
| Medilink administrator | Work the "unhonoured" queue, decide fault, grant or refuse excusals | `sanction.apply` @ PLATFORM (`:172-183`; `routes.ts:19-57`) |
| Worker (system) | Hourly sweep that flags shifts that ended with no sign of attendance | system |

There is no compliance-officer role. v2.9 gives that authority to a Compliance Officer alone; the code gives it to the merged administrator role (`src/lib/authz/permissions.ts:172-183,230-236`).

**How it works today.**

1. **The sweep flags; it does not decide.** Every hour the worker takes the confirmed assignments whose shift has ended, removes any that show a sign of attendance (the record is in any state but "not started", so even a code that was issued counts), removes any already flagged, and writes one "awaiting decision" row for each, with an audit row that names no person. It notifies nobody (`application/fault.ts:115-153`; `src/modules/matching/application/assignment.ts:1000-1006`; `src/modules/attendance/application/attendance.ts:453-461`).
2. **The practitioner may explain.** On "My shifts" a box appears only for a shift that has ended with no check-in, or for a no-show already recorded. The request is a reason of ten or more characters. The server would accept one for any assignment of theirs at any time (`app/practitioner/shifts/page.tsx:115-118`; `application/excusal.ts:64-90`).
3. **An officer decides.** On `/admin/unhonoured` (oldest first) the officer reads the shift, the people and any excusals, then picks **Practitioner**, **Facility** or **Neither**, with a reason of at least ten characters. There is no default and no way to close without a choice (`application/fault.ts:170-228`; `presentation/schemas.ts:6-14`).
4. **The system writes the result.** The determination closes once, with a compare-and-set. Then, in a second step outside that transaction, the assignment becomes **No-show** if the fault was the practitioner's, or **Cancelled** if it was the facility's or neither's; a no-show publishes `no_show.recorded` (`application/fault.ts:188-225`; `src/modules/matching/application/assignment.ts:1016-1079`).
5. **Excusals.** An officer grants or refuses. A refusal needs notes of ten or more characters and decides nothing about fault. A grant closes an open flag as Neither, so the assignment is Cancelled and never a no-show. A grant made before the sweep has run is only stored; it later makes a practitioner-fault finding impossible. A grant does not cancel the assignment, free the place or tell the facility (`application/excusal.ts:113-179`; `domain/fault.ts:51-53`).
6. **Reliability.** Only the practitioner-fault no-show lowers the score. Cancelled and excused shifts count for nothing either way (`src/modules/matching/domain/reliability.ts:27-31`).
7. **Facility cancellation.** Through the API a facility can cancel any confirmed assignment, with a reason of at least three characters. There is no time rule, no penalty and no message, and a cancelled place reopens a filled request. No screen calls this route. Cancelling a whole request withdraws its offers only and leaves its assignments confirmed (`src/modules/matching/application/assignment.ts:527-576`; `src/modules/service-requests/application/request.ts:305-333`).

**The state machines, in plain English.**

| Assignment end states | Can go to | Triggered by |
|---|---|---|
| Confirmed | Cancelled; Completed; No-show | Facility cancel; timesheet approved (Module 10); officer finds practitioner at fault |
| Cancelled, Completed, No-show | nothing | They are final (`src/modules/matching/domain/assignment.ts:41-48`) |

| Unhonoured determination | Can go to | Triggered by |
|---|---|---|
| (none) | Awaiting decision | Hourly sweep finds an ended confirmed shift with no sign of attendance |
| Awaiting decision | Closed, with fault Practitioner, Facility or Neither | Officer records a fault; or a granted excusal closes it as Neither |
| Closed | nothing | Final; nothing can reopen it (`application/fault.ts:189-199`) |

| Excusal | Can go to | Triggered by |
|---|---|---|
| Requested | Granted; Refused | Officer decides; a granted one also closes an open flag as Neither |
| Granted, Refused | nothing | Retained; a later request is a new row, not an overwrite |

**DIVERGES FROM v2.9.** v2.9 Module 12 and the code differ in these places. They need a decision, not just a fix.

| v2.9 says | The code does | Mark |
|---|---|---|
| A practitioner asks **the facility** to release them; if the facility accepts, the release is recorded as excused with no sanction | The request goes to a **platform officer**. The facility is not asked, not told, and sees nothing (`application/excusal.ts:113-179`; `routes.ts:13-17,43-57`) | DIVERGES |
| A facility that habitually refuses reasonable requests is visible to operations | The facility never refuses, so there is nothing to see | MISSING |
| Fault is one of practitioner, facility, excused or undetermined | Practitioner, Facility, Neither, plus "awaiting decision" for undetermined. "Excused" is not a fault value: a grant is stored as Neither (`domain/fault.ts:8-9`; `application/excusal.ts:168-172`) | DIVERGES |
| Only a Compliance Officer may apply, vary or lift a sanction; a facility can report; a practitioner can appeal | No compliance-officer role; administrators hold the permission. A facility cannot report a no-show. No appeal exists anywhere in the code | DIVERGES |
| Graduated ladder: warning, temporary suspension from matching, extended suspension, removal, each configurable and reasoned | No sanction entity exists. `sanction.apply` only gates fault and excusal decisions | MISSING |
| Penalty rules and emergency replacement search | None. A cancelled place reopens a filled request; nothing searches or invites | MISSING |
| Financial consequence separate from disciplinary consequence | No financial consequence exists, so the two are separate only by absence | MISSING |
| A no-show is never counted against a practitioner until fault is decided | Holds: only a decided practitioner fault creates a no-show | IMPLEMENTED |
| Reliability reflects only at-fault assignments and is shown with the count it is based on | Only no-shows lower it; completions sit in the denominator; the match screen shows the completed count only | PARTLY |

**Rules the system enforces.**

- A flag exists only for a confirmed assignment whose shift has ended and whose attendance record is absent or "not started"; there is at most one flag per assignment (`application/fault.ts:115-153`; `prisma/schema.prisma:1359-1387`).
- A fault value is required, with no default; the reason is 10 to 500 characters (`domain/fault.ts:14-15,36-56`).
- Only practitioner fault produces a no-show; facility fault and neither produce Cancelled (`domain/fault.ts:65-67`).
- A granted excusal makes practitioner fault impossible on that assignment, whichever order things happened in (`domain/fault.ts:51-53`).
- A determination closes once; two officers deciding at once cannot both write (`application/fault.ts:189-199`).
- A refused excusal needs notes of 10 or more characters; refusals and grants are both kept with their times (`domain/fault.ts:70-81`; `prisma/schema.prisma:1410-1431`).
- Fault is decided at PLATFORM scope; no route in the module is facility-scoped, and a test asserts it (`routes.ts:13-17`; `tests/integration/unhonoured.test.ts:542`).
- A practitioner can ask only about their own shift and can read only their own requests; reading another's is refused as not found (`application/excusal.ts:66`; `app/api/v1/assignments/[id]/excusals/route.ts:74`).
- Reliability is completed divided by completed plus no-show, empty until something is decided; below five completed assignments the engine uses a neutral 0.5 (`src/modules/matching/domain/reliability.ts:27-31`; `src/modules/matching/domain/engine.ts:52,63,183-186`).
- Tests today: 13 fault-rule cases and 21 integration cases (the sweep flags, does not flag, is idempotent; close refused without a fault or reason; practitioner fault makes a no-show with its event; facility fault costs nothing; granted, refused and refused-then-granted excusals; reading excusals over HTTP). No browser test. Not tested: the assignment write failing after the closing step; an excusal for an assignment that is not confirmed or has not yet happened.

**What is not there yet.**

| ID | Gap | Sev | Source | Evidence |
|---|---|---|---|---|
| SAN-01 | An absence is noticed only after the shift ends, on an hourly sweep. Nothing alerts the ward at the start, and nothing reopens the shift or invites a replacement. | P0 | REVIEW | `src/modules/matching/application/assignment.ts:1000-1006`; `src/worker/jobs.ts:62-67` |
| SAN-02 | Cancelling a request, even a filled one, leaves its assignments confirmed. The sweep then flags the shift as an absence and an officer is asked whose fault it was. The fix belongs to Modules 6 and 7; it is listed here because the damage lands here. | P0 | REVIEW | `src/modules/service-requests/application/request.ts:305-333` |
| SAN-03 | No cancellation window, penalty or notice rule. The request carries mandatory free-text terms, pre-filled "Either party may cancel up to 24 hours before the shift without penalty", which nothing evaluates. The facility's cancel has no time rule and no consequence; a practitioner has no cancel route at all. | P1 | REVIEW | `app/facility/shifts/new-shift-dialog.tsx:56-58`; `src/modules/matching/application/assignment.ts:527-576` |
| SAN-04 | No sanction ladder and no penalty rules. | P1 | V2.9 | `src/lib/authz/permissions.ts:43`; `docs/stage-7-7-7-8-fault-and-excusals.md:117-119` |
| SAN-05 | No appeal against a fault finding or against reliability data; a closed determination is final and the practitioner cannot see why beyond the reply to an excusal. | P1 | V2.9 | `application/fault.ts:189-199` |
| SAN-06 | Facility fault is recorded and used by nothing: no facility reliability score and no view for operations. | P1 | REVIEW | `domain/fault.ts:65-67` |
| SAN-07 | Recording a fault is not atomic with updating the assignment. If the second step fails, the determination is closed and the assignment stays confirmed; a retry is refused and the sweep skips it. The excusal grant has the same shape. | P1 | REVIEW | `application/fault.ts:177-183,188-225`; `application/excusal.ts:130-176` |
| SAN-08 | A no-show is final. It cannot be disputed (a dispute needs an approved or rejected record) and a later excusal grant does nothing once the flag is closed. | P1 | REVIEW | `src/modules/matching/domain/assignment.ts:47`; `src/modules/disputes/application/dispute.ts:163`; `application/excusal.ts:167` |
| SAN-09 | Excusals are decided by a platform officer, not the facility. A grant before the shift releases nothing: no cancellation, no freed place, no message to the facility. The practitioner's screen offers the request only after the shift. | P1 | V2.9 | `application/excusal.ts:113-179`; `app/practitioner/shifts/page.tsx:115-118` |
| SAN-10 | A facility cannot report a no-show, attach evidence, see a fault decision or contest one. Fault is decided without hearing the facility. | P1 | V2.9 | `routes.ts:13-17` |
| SAN-11 | The assignment-cancel route has no screen, publishes no event and tells the practitioner nothing. | P1 | NEW | `src/modules/matching/application/assignment.ts:527-576` |
| SAN-12 | No emergency replacement search. The only effect of a cancellation is that a filled request reopens. | P1 | V2.9 | `src/modules/matching/application/assignment.ts:554-560` |
| SAN-13 | A flag, a fault decision and an excusal decision notify nobody. The practitioner learns of a reply only by opening the shift screen. | P1 | NEW | `src/worker/handlers.ts:15-52` |
| SAN-14 | No compliance-officer role; `sanction.apply` sits in the merged administrator role. | P1 | V2.9 | `src/lib/authz/permissions.ts:172-183,230-236` |
| SAN-15 | An excusal can be requested for any assignment of the practitioner, at any status and time, and repeatedly. | P2 | NEW | `application/excusal.ts:64-90` |
| SAN-16 | Reliability counts completions in the denominator; cold start tests only completions, so a practitioner with several no-shows and under five completions still scores neutral; the facility sees the completed count, not the no-show count; nothing is stored. The fix lives in Module 7. | P2 | V2.9 | `src/modules/matching/domain/reliability.ts:27-31`; `src/modules/matching/domain/engine.ts:183-186,211-218` |

**Recommended change (v3).**

*Phase 0, make it safe.* Move detection to the start of the shift (SAN-01). Thirty minutes after the start, with no check-in, alert the facility and the practitioner, show "not checked in" on the roster, and open a replacement search from the Booking by inviting the next ranked eligible practitioners. Keep the sweep after the end as the decision queue. Make cancelling a request cancel its bookings, with a message to each practitioner (SAN-02).

*Phase 1, Gombe pilot.* Put the cancellation rule on the Booking: a notice window and a stated consequence, shown on the offer before it is accepted and frozen at agreement (SAN-03). Give practitioners a withdrawal with reason and the same rules, and give facilities a cancel screen that applies them (SAN-03, SAN-11). Decide who answers an excusal. v2.9 says the facility. The recommendation is that the facility answers first within a set time, an accept means excused with no penalty, and a platform officer decides refused, unanswered or contested cases; operations can then see a facility that habitually refuses (SAN-09). This is a decision for the team. Tell people: a flag, a fault decision and an excusal answer each send a notice (SAN-13). Make fault and the assignment write one step (SAN-07). Let a facility report a no-show with evidence and see the decision (SAN-10).

*Phase 2 to 4.* Build the ladder as configuration owned by compliance: warning, temporary pause from matching, extended pause, removal, each step with a reason and a review (SAN-04), with an appeal to a named reviewer and full history (SAN-05), and a separate compliance-officer permission (SAN-14). Add a facility reliability score and fix cold start and the denominator with Module 7 (SAN-06, SAN-16). Feed repeat pairs and unusual cancellation patterns to the Trust module's reviews and risk queue.

**Acceptance criteria.**

1. Given a confirmed shift with no check-in 30 minutes after its start, when the check runs, then the facility and the practitioner are told, the roster shows "not checked in", and a replacement search is opened.
2. Given an unhonoured shift, when an officer tries to close it without a fault value or with a reason under ten characters, then the request is refused and the shift stays awaiting decision.
3. Given a practitioner-fault finding, when it is recorded, then the assignment becomes No-show in the same step, `no_show.recorded` is published, the practitioner is told, and they can appeal.
4. Given a request cancelled with confirmed bookings, when it is saved, then each booking is cancelled, each practitioner is told, and none of the shifts is later flagged as an absence.
5. Given a practitioner who withdraws inside the notice window, when they confirm, then the stated consequence is shown first and the facility is told at once.
6. Given a granted excusal for a shift that has not yet started, then the booking is released, the place reopens, and the facility is told; the practitioner's reliability is unchanged.
7. Given a facility that refuses excusal requests, when operations view the facility, then the count and reasons of refusals are visible.
8. Given a sanction applied at one step of the ladder, when it is lifted, then it is closed with a reason and stays in the history.

---

## Module 14 · Disputes  *(repo folder `src/modules/disputes`; v2.9 Module 13)*

**Status:** Partly built · **Label:** CURRENT + IMPROVE · **Maturity for a Gombe pilot:** Not ready — a practitioner can open a case and an officer can decide it, but facilities cannot take part, nobody is told, evidence and the case list are open to the wrong people, and a decision never reaches the money.

**Why it exists.** A nurse in Gombe was approved for eight hours and worked twelve; a ward manager says the locum left early and the record says otherwise. Both need a defined process, with a deadline to raise it, a place to put evidence, and a decision from someone outside the shift. Without one, disagreements go to a phone number and a spreadsheet, and the side with less patience loses.

**Who uses it.**

| Actor | What they do here | Permission @ scope |
|---|---|---|
| Practitioner | Open a case on an approved or rejected shift (screen); withdraw it and attach evidence (API only, no screen) | `dispute.manage` @ SELF (`src/lib/authz/permissions.ts:116-122`) |
| Facility owner | Open a case for the facility (API only). A facility administrator cannot: the permission is not in that role | `dispute.manage` @ FACILITY (`:140-147,199`) |
| Medilink administrator | Queue, start a review, read evidence, decide | `dispute.manage` @ PLATFORM (`:172-183`) |
| Worker (system) | Nothing; `dispute.opened` has no handler | system |

Facility staff hold their grants at FACILITY scope only. The routes to attach evidence, download it and withdraw a case are declared SELF-scoped, so by reading `isAuthorized` a facility user cannot reach them (`routes.ts:19-36`; `src/lib/authz/guard.ts:45-71`; `src/modules/facilities/application/facility.ts:224-231`). The stage document says "either party may attach"; that holds for practitioners only.

**How it works today.**

1. **Opening.** On an approved or rejected card the practitioner presses "Dispute this", picks a category (hours, pay, "the shift did not happen as agreed", conduct, other) and writes at least twenty characters (`app/practitioner/timesheets/page.tsx:115-130,260-271`). The server checks the caller is the shift's practitioner or acts for the shift's facility; the shift's record is approved or rejected; no case is live; the decision was less than **14 days** ago; and the reason is long enough. A second check inside the transaction keeps two parties clicking together from opening two cases (`application/dispute.ts:151-236`; `domain/dispute.ts:70-99`).
2. **The shift goes on hold.** The case is saved and `dispute.opened` is published. Then, in a second step outside that transaction, attendance moves to "disputed" and remembers what it was (`application/dispute.ts:178-233`; `src/modules/attendance/application/attendance.ts:470-507`).
3. **Evidence.** A party asks for an upload link (image or PDF up to 10 MB), the browser sends the file straight to storage, and the party "attaches" it with a note. Evidence is never removed. The administrator opens each item through a short-lived link, and each opening is audited (`application/evidence.ts:67-246`; `src/lib/storage/tigris.ts:61-69`).
4. **Adjudication.** Administrators see the queue oldest first. "Start reviewing" marks the case under review; it records no officer on the case. Uphold or dismiss needs a finding of twenty or more characters (`application/dispute.ts:243-345`; `app/admin/disputes/dispute-detail.tsx`).
5. **The shift comes back.** Upheld sends the shift to "submitted" so the facility corrects the hours through the ordinary route, which leaves its own revision. Dismissed or withdrawn puts the shift back to approved or rejected, whichever it was. The case row stays either way (`application/dispute.ts:337-342,393-398`; `src/modules/attendance/application/attendance.ts:517-564`).
6. **Money.** None of this reaches Module 12. No dispute reference exists in billing; an invoice picks only approved shifts not already billed, so a shift disputed before invoicing falls out of invoicing as a whole, and a shift already invoiced is untouched. Payouts read the ledger only (`src/modules/billing-settlement/application/invoice.ts:140-162`; `.../payout.ts:55-120`).

**The state machines, in plain English.**

| Dispute | Can go to | Triggered by |
|---|---|---|
| Open | Under review; Resolved; Withdrawn | Officer starts a review; officer decides; the party who raised it withdraws |
| Under review | Resolved; Withdrawn | Officer decides; the raiser withdraws |
| Resolved (upheld or dismissed) | nothing | Final. A later case on the same shift is a new row |
| Withdrawn | nothing | Final; the row and its reason stay |

| What the case does to the shift | From | To | Triggered by |
|---|---|---|---|
| Hold | Approved or Rejected | Disputed (previous state remembered) | A case is opened |
| Upheld | Disputed | Submitted | Officer upholds |
| Dismissed or withdrawn | Disputed | The remembered Approved or Rejected | Officer dismisses; raiser withdraws |

Only one case may be live per shift. Nothing in the attendance table stops a record cycling; the one-live-case rule does (`domain/dispute.ts:80-83`).

**DIVERGES FROM v2.9 Module 13.**

| v2.9 says | The code does | Mark |
|---|---|---|
| Covers incorrect timesheets, unpaid work, incorrect rates, unapproved overtime, no-shows, facility cancellations, misconduct, unsafe conditions and payment reversals | Five categories: hours, pay, non-attendance, conduct, other. No-shows and cancellations cannot be disputed at all, because a case needs an approved or rejected record (`domain/dispute.ts:11,15-21,41-46`; `application/dispute.ts:163`) | PARTLY |
| A dispute on a timesheet holds **the disputed amount only**; the undisputed part settles on schedule | A case carries no amount. The whole shift is held out of a future invoice; an already invoiced shift is not held at all; payouts ignore disputes (`prisma/schema.prisma:1450-1486`) | MISSING |
| A dispute after settlement is resolved by a reversal entry, never by editing the ledger | No reversal or credit-note entries exist anywhere; the invoice status "void" has no writer | MISSING |
| Each type has a target resolution time; a case past it escalates automatically to a named officer | No target, no sweep and no officer on the case (`application/dispute.ts:243-274`; `docs/stage-8-disputes.md:155-157`) | MISSING |
| Case messages, evidence, assignments, decisions and status history | A case row and an evidence table. No messages, no reply from the other party, no assignment, status history only in the audit trail | PARTLY |
| §9.15: a payout must not start unless "disputed amounts are separated" | `payout.ts` has no dispute logic | MISSING |

**Rules the system enforces.**

- A case may be opened only on an approved or rejected shift, only by its practitioner or by someone acting for its facility, within 14 days of the decision, with a reason of 20 to 2,000 characters (`domain/dispute.ts:23-24,38-46,70-94`). The 14 days run from the decision, not the shift, and restart whenever the shift is decided again (`application/dispute.ts:170`).
- One live case per shift, checked again inside the transaction (`application/dispute.ts:130,164-186`).
- An officer cannot open a case: somebody on neither side of the shift is "not a party" (`domain/dispute.ts:148-162`).
- A case cannot be resolved without an outcome and a finding of 20 or more characters; a second resolution fails (`domain/dispute.ts:121-133`; `application/dispute.ts:307-320`).
- Only the party who raised a case may withdraw it, and only while it is live (`domain/dispute.ts:136-145`).
- Evidence needs a live case, an accepted file type, 10 MB or less, and a stored object owned by the person attaching it. It is never deleted, and each download is a separate audited link (`application/evidence.ts:74-78,132-134,226-246`).
- A decided shift can be disputed again after a dismissal, on new evidence; both cases are kept (`prisma/schema.prisma:1479-1481`).
- Tests today: 24 rule cases (window boundary, every blocker, who is a party) and 26 integration cases (open, event and audit, facility as a party, strangers refused, undecided and out-of-window refused, second case refused, resolve both ways, completion counted once, withdraw, re-dispute) and a browser journey (practitioner opens, administrator decides). **Evidence has no tests at all**, and no test calls the case-list route as a stranger.

**The review said X; at HEAD it is fixed.** A defect recorded in the stage document: re-approving a shift after an upheld dispute threw "a COMPLETED assignment cannot become COMPLETED", and the alternative would have let a practitioner inflate their record by winning a dispute. Completing an already completed assignment is now a no-op, so the reliability count and the status history show one completion after a full round trip (`src/modules/matching/application/assignment.ts:672`; `tests/integration/disputes.test.ts:465`). Do not reopen it.

**What is not there yet.**

| ID | Gap | Sev | Source | Evidence |
|---|---|---|---|---|
| DSP-01 | Evidence has no party check. The upload link needs only a live case; attach needs only that the caller owns the uploaded object; the download link takes an evidence id and ignores the dispute id. Any signed-in practitioner who has a case or evidence id can add to it or read it. `notAParty` is defined and never used. No test covers evidence. | P0 | REVIEW | `application/evidence.ts:29-30,67-114,122-163,226-246`; `app/api/v1/disputes/[id]/evidence/[evidenceId]/url/route.ts:29-34` |
| DSP-02 | The case list for a shift has no check that the shift is the caller's. Any SELF or FACILITY caller who names a shift id is returned the reasons and findings of its cases. | P0 | NEW | `app/api/v1/assignments/[id]/disputes/route.ts:50-54`; `application/dispute.ts:409-418` |
| DSP-03 | Nobody is told when a dispute is opened, put under review, decided or withdrawn. The admin screen says "Marking it under review tells the other side somebody is looking" and "both sides read it"; neither is true. | P0 | REVIEW | `src/worker/handlers.ts:15-52`; `application/dispute.ts:208-220`; `app/admin/disputes/dispute-detail.tsx:261-263,279-281` |
| DSP-04 | Facilities cannot take part. No facility screen exists; the evidence and withdraw routes are SELF-scoped and unreachable by facility grants; only the facility owner may even open a case. | P0 | REVIEW | `routes.ts:19-36`; `src/lib/authz/permissions.ts:140-147,199` |
| DSP-05 | A dispute is not linked to money. Payouts ignore it; there is no hold, no credit note and no reversal entry; the invoice status "void" has no writer. | P0 | REVIEW | `src/modules/billing-settlement/application/payout.ts:55-120`; `.../invoice.ts:140-162` |
| DSP-06 | A practitioner has no screen to attach evidence and none to read the status, finding or outcome of their own case. | P1 | REVIEW | `app/practitioner/timesheets/page.tsx:117` |
| DSP-07 | Opening and resolving write attendance in a second step. A failure leaves an open case with no hold, or a resolved case with the shift still held. | P1 | REVIEW | `application/dispute.ts:178-233,307-342` |
| DSP-08 | A practitioner's submit can pull a disputed shift out of "disputed" by API (the machine allows disputed to submitted, and submit has no dispute check). The facility could then approve while the case is open, and the later close fails after the case is already resolved. By reading. | P1 | NEW | `src/modules/attendance/domain/state-machine.ts:59`; `src/modules/timesheets/application/timesheet.ts:190`; `application/dispute.ts:307-342` |
| DSP-09 | No resolution target per type, no named officer, no auto-escalation, no appeal step. "Start reviewing" records no officer. The platform that may take a fee also adjudicates. | P1 | REVIEW | `application/dispute.ts:243-274`; `docs/stage-8-disputes.md:155-157` |
| DSP-10 | No amount on a case, so no hold on the disputed amount only and no reversal entry after settlement. | P1 | V2.9 | `prisma/schema.prisma:1450-1486`; `src/modules/billing-settlement/application/invoice.ts:143` |
| DSP-11 | Categories are narrower than v2.9 (no rate, overtime, facility cancellation, unsafe conditions, payment reversal); no-show and cancelled outcomes cannot be disputed. | P1 | V2.9 | `domain/dispute.ts:11,15-21`; `application/dispute.ts:163` |
| DSP-12 | No case messages, no reply from the other party, no case-assignment and no status-history table (audit only). | P2 | V2.9 | `prisma/schema.prisma:1450,1530` |

**Recommended change (v3).**

*Phase 0, make it safe.* Check, on every read, upload, attach and download, that the case belongs to the caller's side (the shift's practitioner, an acting member of the shift's facility, or a platform holder), and that an evidence id belongs to the dispute named in the URL (DSP-01, DSP-02). Add a facility console: list, open, reply, attach and withdraw, with the evidence and withdraw routes accepting FACILITY scope, and open the dispute permission to the facility administrator as well as the owner (DSP-04). Send a notice to the other side when a case opens, starts review, resolves or is withdrawn (DSP-03). Give a dispute an amount at stake and a payout hold on that amount only, and have an upheld case post an adjustment through Module 12, with a reversal entry if the shift was already settled (DSP-05, DSP-10).

*Phase 1, Gombe pilot.* Give practitioners a case screen with evidence upload and the finding (DSP-06). Make the case open and close in one step with attendance, and refuse submit while a case is live (DSP-07, DSP-08). Set a resolution target per category, assign a named officer when review starts, escalate automatically when the target passes, and add an appeal to a second reviewer (DSP-09). Add the categories v2.9 lists, plus "wrong level supplied or paid for" once levels exist (DSP-11); allow disputing a no-show or a cancellation (SAN-08).

*Phase 2 and later.* Case messages and a reply from the respondent, officer assignment and a status history (DSP-12). Generalise the subject from "a shift" to "a Booking of any kind" so later modules (resource exchange) reuse the case.

**Acceptance criteria.**

1. Given a practitioner who is not a party to a case, when they ask for an upload link, attach evidence, download an item or list the shift's cases, then each request is refused as not found.
2. Given a case opened by a practitioner, when it is opened, then the facility owner and administrators are told at once; when it is decided, then both sides are told with the finding.
3. Given a facility administrator, when they open a case, reply or attach evidence from the facility console, then it works and appears on the officer's screen as the facility's.
4. Given a case with an amount at stake, when a payout is prepared, then only the disputed amount is held and the undisputed part is paid on schedule.
5. Given an upheld case on an already settled shift, when it is decided, then a reversal entry is posted and the original ledger rows are untouched.
6. Given a shift in "disputed", when the practitioner tries to submit its timesheet, then the request is refused.
7. Given a case past its target for its category, when the check runs, then it is assigned to a named officer's queue and flagged.
8. Given a failed attendance step while opening a case, then no case row exists afterwards.

---

## Module 15 · Clinical incidents  *(repo folder `src/modules/clinical-incidents`; v2.9 Module 14)*

**Status:** Partly built · **Label:** CURRENT + IMPROVE · **Maturity for a Gombe pilot:** Not ready — reporting, review and closure work and are tested, but opening an incident restricts nobody, a death-severity report raises no alert, the report can name any user, and a suspension ignores the practitioner's confirmed shifts.

**Why it exists.** Medilink does not judge clinical quality and holds no patient records, yet it places practitioners on wards. Sooner or later a patient will be harmed or die on a shift staffed through the platform, and the response must be defined in advance, not improvised by a ward manager at midnight. The module gives a facility a way to say what happened, a compliance officer a queue and a recorded decision, and the platform a way to stop sending a practitioner to work while that decision is made.

**Who uses it.**

| Actor | What they do here | Permission @ scope |
|---|---|---|
| Facility staff (administrator, owner) | File a report; read their own reports, with the outcome and closure notes | `incident.report` @ FACILITY (`src/lib/authz/permissions.ts:140-147`) |
| Medilink administrator | Queue, read a case with the subject's history, take the case, close it with an outcome (including "suspend the practitioner"), reinstate an account | `incident.manage` @ PLATFORM (`:172-183`; `routes.ts:19-28`) |
| Practitioner | Nothing. They cannot report, cannot see a report naming them and, once suspended, cannot sign in | none held (`:116-122`) |
| Worker (system) | Nothing; `clinical_incident.reported` has no handler | system |

There is no compliance-officer role; `incident.manage` is part of the merged administrator role (`src/lib/authz/permissions.ts:172-183,230-236`).

**How it works today.**

1. **Reporting.** The ward opens the dialog, gives when it happened, a category, a severity (near miss, minor, moderate, severe, death) and a summary of 20 to 4,000 characters, and may pick a recent shift. Naming a shift links the report to the practitioner who worked it. The server refuses a summary under 20 characters and a time in the future, and refuses a shift that belongs to another facility. The report is saved with an audit row and `clinical_incident.reported` is published (`application/incident.ts:133-191`; `app/facility/incidents/report-incident-dialog.tsx`). A report cannot be edited or withdrawn; no route exists to do so.
2. **The API accepts more than the screen offers.** Without a shift, the caller can send any user id as the "subject", and the server stores it with no check. With a shift, a supplied subject replaces the shift's practitioner (`application/incident.ts:143-150`).
3. **The queue.** Compliance sees open reports, most serious first and oldest within that. A case read returns the report, the subject's name, phone and status, and every other report naming the same user (`application/incident.ts:367-418`; `app/api/v1/incidents/[id]/route.ts:27-49`).
4. **Taking the case.** "Take case" moves a report to under review. A severe or death report cannot be closed straight from reported (`application/incident.ts:194-225`; `domain/incident.ts:61,110-125`).
5. **Closing.** The officer chooses an outcome (system issue, no action, advice given, training required, practitioner suspended, referred to the regulator) and writes notes of 20 or more characters. If the outcome is "practitioner suspended", the report must name a subject, and in the same transaction the account becomes suspended, a suspension row records who, when and why (the closure notes), and an audit row is written (`application/incident.ts:248-304`; `application/suspension.ts:87-128`).
6. **What a suspension does.** The person's next request is refused, so they are signed out; login, password reset and sign-up refuse them; the matching rule excludes them from new offers. It does nothing else: their confirmed shifts stay confirmed, the facility is not told, and the practitioner is shown only a generic "this account cannot sign in" (`src/modules/auth/application/session-service.ts:92`; `src/modules/auth/application/login.ts:81-84`).
7. **Reinstating.** An officer lifts a suspension with a reason of 20 or more characters. The suspension row is closed, not deleted, and the account becomes active, whatever its status was before (`application/suspension.ts:151-192`).
8. **The reporting facility** can open a read-only dialog showing the outcome and the closure notes word for word (`app/facility/incidents/incident-detail-dialog.tsx:64-82`). A comment records that the facility used to have no way to see the outcome of its own report; at HEAD it does.

**The state machines, in plain English.**

| Incident | Can go to | Triggered by |
|---|---|---|
| Reported | Under review; Closed (minor, moderate or near miss only) | Officer takes the case; officer closes it. A severe or death report cannot skip review |
| Under review | Closed | Officer closes with an outcome and notes |
| Closed | nothing | Final. There is no reopen and no edit |

| Account status | Can go to | Triggered by |
|---|---|---|
| Any status except Suspended | Suspended | A closure with the outcome "practitioner suspended" (the only code path) |
| Suspended | Active | An officer reinstates with a reason. Never back to the earlier status |
| Deactivated | nothing | Set by no code path |

| Suspension record | Can go to | Triggered by |
|---|---|---|
| Open (lifted time empty) | Lifted | Reinstatement. The row keeps who lifted it, when and why. Only one open row per account; a second suspension is refused |

**DIVERGES FROM v2.9 Module 14.**

| v2.9 says | The code does | Mark |
|---|---|---|
| **Opening an incident suspends the practitioner from new matching at that facility pending review.** A compliance officer then decides within a defined period whether it extends platform-wide, is lifted or stays facility-specific | **Opening restricts nobody.** Only a closure with the outcome "practitioner suspended" suspends, and it suspends the whole account. There is no facility-specific restriction and no review period (`application/incident.ts:133-191`; `application/suspension.ts:87-128`; `docs/stage-5-clinical-incidents.md:116-118`) | DIVERGES |
| Suspension pending investigation is explicitly not a finding of fault, is recorded as such, and is separate from the sanction ladder | A suspension is the outcome of a decision at closure. It has no "pending investigation" kind, no scope and no end date (`prisma/schema.prisma:1677-1702`) | PARTLY |
| Either party may report against a specific assignment: the facility, the practitioner, or an officer | Facility only. The assignment is optional by design (`src/lib/authz/permissions.ts:116-122,172-183`; `presentation/schemas.ts:13-16`) | PARTLY |
| The report must not record patient identifiers or clinical detail | A free-text summary of up to 4,000 characters, with no guidance on the form and no screening (`presentation/schemas.ts:9`; `app/facility/incidents/report-incident-dialog.tsx:217`) | DIVERGES |
| Referral to MDCN is recorded | The outcome "referred to the regulator" is stored; no regulator, reference or date (`domain/incident.ts:34-40`) | PARTLY |
| Records are placed under legal hold; production of records is logged | Neither exists | MISSING |
| §9.15: a serious incident must preserve records, apply the temporary restriction, notify the responsible officer, start the investigation deadline, create an audit event and restrict access | Only the audit event and restricted access (own facility's list and PLATFORM) exist | PARTLY |
| §9.17: "Suspended" must not be used interchangeably | **"Suspended" means three different things in the code.** `UserStatus.SUSPENDED` is a platform-wide account block, set only by this module (`prisma/schema.prisma:68`). `RegistrationStatus.SUSPENDED` is a regulator's licence status that an officer records (`:735`). `FacilityStatus.SUSPENDED` exists and "is reachable by no code path" (`:620-623`) | DIVERGES |
| Only a Compliance Officer decides | No such role | DIVERGES |

**Rules the system enforces.**

- A report needs a summary of 20 or more characters and an occurrence time not in the future; nothing else is mandatory, on purpose, so that reporting stays easy (`domain/incident.ts:50,81-95`).
- A shift named in a report must belong to the reporting facility (`application/incident.ts:144-147`).
- A report cannot be edited, withdrawn or deleted; the route table has no such route and a test asserts it (`routes.ts:19-28`; `tests/integration/incidents.test.ts:666`).
- A severe or death incident cannot be closed from "reported" (`domain/incident.ts:120-122`).
- A closure needs an outcome and notes of 20 or more characters; a second closure fails (`domain/incident.ts:110-125`; `application/incident.ts:266-276`).
- "Practitioner suspended" needs a named subject; the suspension and the closure are one transaction, so a closure cannot claim a suspension that did not happen (`application/incident.ts:260-261,280-288`).
- A suspension and a reinstatement each need a reason of 20 or more characters; a suspended account cannot be suspended again, and an account that is not suspended cannot be reinstated (`application/suspension.ts:88-101,151-165`).
- A suspended account has no session, cannot sign in and is excluded from matching with no sweep involved (`src/modules/auth/application/session-service.ts:92`; `src/modules/practitioners/domain/eligibility.ts:60-62`).
- The queue shows the most serious first, then the oldest (`application/incident.ts:367-408`).
- Tests today: 16 rule cases, 23 integration cases (report against a shift, no-shift report, event and audit, foreign shift refused, future refused, lists, queue order, close rules, severe needs review, suspension in the same transaction, practitioner ineligible after it, reinstatement, history, route table) and 2 browser tests. Not tested: a subject supplied with no shift, a subject that differs from the shift's practitioner, what happens to confirmed shifts.

**What is not there yet.**

| ID | Gap | Sev | Source | Evidence |
|---|---|---|---|---|
| INC-01 | The subject can be any user id. With no shift, the id is stored unchecked; with a shift, a supplied subject overrides the shift's practitioner; the column has no foreign key. A throwaway facility can file a death-severity report against anyone, who then appears with their name and phone in compliance's queue, and a closure can suspend whoever was named. | P0 | REVIEW | `application/incident.ts:143-150`; `presentation/schemas.ts:13-16`; `prisma/schema.prisma:1573`; `app/api/v1/incidents/[id]/route.ts:33-48` |
| INC-02 | Opening an incident restricts nobody. There is no interim hold at the facility pending review and no review period; the only suspension is at closure and covers the whole account. | P0 | V2.9 | `application/incident.ts:133-191`; `application/suspension.ts:87-128` |
| INC-03 | A severe or death report raises no alert. The event has no handler, so it waits in a queue until somebody looks. The review rated this P1; it is P0 here because a death waits silently. | P0 | REVIEW | `application/incident.ts:176-187`; `src/worker/handlers.ts:15-52` |
| INC-04 | The summary is free text with no warning on the form and no screening, so it will receive patient names and details. v2.9 says the report must not record patient identifiers. | P0 | REVIEW | `presentation/schemas.ts:9`; `app/facility/incidents/report-incident-dialog.tsx:217` |
| INC-05 | A suspension does not touch the practitioner's confirmed shifts and does not tell the facility. The suspended person cannot sign in to explain, while the unhonoured sweep flags their ended shifts for an officer to decide as absences. | P1 | REVIEW | `application/suspension.ts:87-128`; `src/modules/auth/application/session-service.ts:92`; `src/modules/cancellations-sanctions/application/fault.ts:115-153` |
| INC-06 | No notice, hearing, right of reply or appeal. The practitioner sees a generic "cannot sign in" and never the reason. No direct suspend route exists, so `user.suspend` has no code behind it. | P1 | REVIEW | `application/suspension.ts:87-192`; `src/modules/auth/application/login.ts:81-84`; `docs/stage-5-clinical-incidents.md:110-114` |
| INC-07 | Practitioners and officers cannot report; v2.9 says either party and an officer acting on information may. | P1 | REVIEW | `src/lib/authz/permissions.ts:116-122,172-183`; `app/api/v1/incidents/route.ts:23` |
| INC-08 | A suspension has no kind (pending investigation versus decided), no scope (facility versus platform) and no end date; there is no deadline for compliance to decide. | P1 | V2.9 | `prisma/schema.prisma:1677-1702` |
| INC-09 | "Referred to the regulator" records only the decision. No regulator, reference or date, and nothing shows the referral was made. | P1 | V2.9 | `domain/incident.ts:34-40` |
| INC-10 | No legal hold, no exemption from retention, and no log of records produced to a court, coroner or the Council. | P1 | V2.9 | no match for legal hold or lawful disclosure anywhere in `src/` or `prisma/schema.prisma`; `src/modules/audit-compliance/application/data-subject.ts:335-370` (the export omits incidents) |
| INC-11 | The reporting facility sees the closure notes word for word. They may name the practitioner and the grounds of a suspension; there is no separate wording for the facility. | P1 | NEW | `app/facility/incidents/incident-detail-dialog.tsx:64-82` |
| INC-12 | Attachments are not built. The table and the storage purpose exist and nothing reads or writes them; the reporter cannot add a photograph, a form or a later note. | P2 | NEW | `prisma/schema.prisma:1654-1669`; `src/lib/audit-coverage.ts:69` |
| INC-13 | Reinstating sets the account to active whatever its earlier status was, so a practitioner suspended while under review skips the activation step. Eligibility is still checked at matching. | P2 | NEW | `application/suspension.ts:174` |

**Recommended change (v3).**

*Phase 0, make it safe.* Constrain the subject (INC-01): a report may name only a practitioner who held a booking at the reporting facility, chosen from that booking, and "names nobody" stays allowed. Alert on severity (INC-03): a severe or death report sends an immediate notice to the named compliance lead through SMS or WhatsApp and the in-app inbox, and starts an investigation clock. Give the form a plain warning not to enter patient names, record numbers or clinical detail, and screen for obvious identifiers (INC-04). Apply v2.9's interim rule (INC-02, INC-08): opening an incident that names a practitioner places a facility-specific hold on new bookings for that practitioner at that facility, recorded as "pending investigation, not a finding of fault", with a review deadline; compliance decides whether to extend platform-wide, lift or keep it.

*Phase 1, Gombe pilot.* Give suspensions a kind, a scope and an end date (INC-08). When a hold or suspension starts, list the practitioner's upcoming bookings to compliance with a one-step action that cancels them, tells the facility and starts a replacement search; and stop the sweep flagging those shifts as absences (INC-05). Add notice to the practitioner, a right of reply and an appeal to a second reviewer, and a direct suspend route for cases that arise outside an incident (INC-06). Let practitioners and officers report (INC-07). Record the referral with regulator, reference and date (INC-09), and show the facility its own wording of the outcome (INC-11).

*Phase 2 and later.* Legal hold and a log of records produced, built with the retention schedule in the privacy workstream (INC-10). Attachments (INC-12). Keep reinstatement honest about the earlier status (INC-13).

**Acceptance criteria.**

1. Given a report that names a user who never held a booking at the reporting facility, when it is submitted, then it is refused.
2. Given a severe or death report, when it is filed, then the compliance lead is notified at once and the report shows its review deadline.
3. Given a report that names a practitioner, when it is opened, then that practitioner is excluded from new bookings at that facility pending review, and the record says it is not a finding of fault.
4. Given a suspension, when it starts, then the practitioner's confirmed future bookings are listed to compliance, the facility is told, and no shift cancelled for that reason is later flagged as an absence.
5. Given a suspended practitioner, when they try to sign in, then they are told they are suspended, why in plain words, and how to appeal.
6. Given a report form, when it is opened, then it carries a warning against entering patient identifiers.
7. Given a practitioner who sees a safety problem on a shift, when they open the app, then they can file a report that reaches compliance.
8. Given a closed incident whose notes name the practitioner, when the facility opens it, then it shows the facility's wording of the outcome, not the internal notes.

---

## Module 16 · Notifications  *(repo folder `src/modules/notifications`; v2.9 Module 15)*

**Status:** Stub · **Label:** CURRENT + NEW EXPANSION · **Maturity for a Gombe pilot:** Not ready — there is no live SMS provider and only one of 20 domain events sends a message, so the promise of replacing phone calls cannot be kept.

**Why it exists.** A Gombe nurse who is offered a night shift needs to know within minutes, not whenever they next open the app. A ward manager needs to know the nurse said yes. A practitioner whose licence has lapsed needs to hear it from Medilink, not from a rejected match. Without messages, every step of the booking becomes a phone call or a refresh, which is exactly what Medilink is meant to replace. Text messages come first because connectivity is patchy and SMS is the channel most likely to arrive.

**Who uses it.**

| Actor | What they do here | Permission @ scope |
|---|---|---|
| Practitioner | Receives sign-up and reset codes, and a text when a shift is confirmed | none (system sends) |
| Facility representative | Receives a text when a shift is confirmed; the only facility person ever texted | none |
| Other facility staff, officers, finance | Receive nothing; there is no inbox for anyone | none |
| Worker (system) | Reads the `assignment.confirmed` event and sends the two texts | system |
| Authentication (Module 1) | Sends codes straight through the same SMS adapter, not through this module | system |

**How it works today.**

1. **Codes.** After a code is stored and the database transaction commits, the SMS adapter is asked to send, for example "482913 is your code to verify your Medilink number. It expires in 10 minutes. Do not share it." The wording changes for password reset and step-up (`src/modules/auth/domain/otp.ts:156-165`). The send is outside the transaction on purpose, so a slow gateway cannot hold a database connection (`src/modules/auth/application/otp-service.ts:24-29`).
2. **Shift confirmed.** When a facility confirms a practitioner, the booking and an `assignment.confirmed` event are saved together. Within two to five seconds the worker picks the event up and sends two texts, one to the practitioner and one to the facility's representative: "Your shift at {facility} is confirmed: 2026-11-02 18:00 to 06:00 UTC. Medilink." (`src/modules/notifications/application/handlers.ts:33-81`). Each text is first checked against earlier messages for the same person and booking, so a retried event does not send twice.
3. **Recording.** Each text is saved with the recipient's number masked, the full body, and either a sent time or a failure reason (`src/modules/notifications/application/notify.ts:31-57`).
4. **The adapter.** `console` prints the whole message and is refused anywhere but a developer's machine. `termii` and `africastalking` are placeholders that throw "not implemented"; the send helper catches that and returns nothing (`src/lib/sms/index.ts:43-125`).
5. **Everything else is ignored.** Of the 20 events, three have a handler (this one, `shift.completed` which builds the timesheet, and `practitioner.registered` which grants the role). The other 17 are saved, picked up, logged with a warning and marked processed (`src/worker/processor.ts:79-86`). No one is told.

| Message record | Can go to | Triggered by |
|---|---|---|
| (new) | SENT | The adapter returned a result (`notify.ts:53`) |
| (new) | FAILED | The adapter threw or is not configured; a reason is stored (`notify.ts:54`) |
| SENT or FAILED | — | Never updated. There is no retry, no delivery receipt and no read state |

**Rules the system enforces.**

- A failed send never undoes the thing it reports: sending helpers catch every error (`src/lib/sms/index.ts:113-125`; `notify.ts:23-30`).
- Codes go out only after the transaction that stored them has committed (`otp-service.ts:24-29`).
- The console adapter cannot run outside local, at boot or at send (`src/lib/env-rules.ts:53-57`; `src/lib/sms/index.ts:98-104`).
- The stored recipient is masked (`+234803***567`) because many people can read this table (`notify.ts:49`).
- The confirmation handler is safe to run twice: one message per person, kind and booking (`handlers.ts:13-19,60,72`).
- A message for a deleted user is skipped with a warning (`notify.ts:36-40`).

**What is not there yet.**

| ID | Gap | Sev | Source | Evidence |
|---|---|---|---|---|
| NOT-01 | **Offers, acceptances, cancellations, reminders, verification decisions and expiry warnings send no message.** Only `assignment.confirmed` has a handler. `shift.invited`, `shift.accepted`, `credential.verified`, `credential.expired`, `facility.verified`, `timesheet.submitted`, `timesheet.approved`, `dispute.opened` and nine more are published and ignored; cancellation, rejection and reminder events do not exist at all. See Annex P2. | P0 | REVIEW | `src/worker/handlers.ts:20-51`; `src/worker/processor.ts:79-86`; `src/lib/events.ts:5-26` |
| NOT-02 | No SMS gateway is implemented, so no one-time code or confirmation can reach a real phone. There is no second provider, no failover and no delivery receipt, and the `transactional` flag meant for do-not-disturb numbers is never read. | P0 | REVIEW | `src/lib/sms/index.ts:23-25,69-84,105-108` |
| NOT-03 | A failed text is recorded as handled and never retried. The handler returns normally, the event becomes PROCESSED, and the duplicate check counts failed rows, so even a manual re-run sends nothing. | P0 | REVIEW | `src/modules/notifications/application/notify.ts:42-55`; `src/modules/notifications/application/handlers.ts:13-19`; `src/worker/processor.ts:88-96` |
| NOT-04 | A failed code SMS is hidden: the result is ignored and the API answers "code sent". A person waits for a text that was never sent. | P0 | REVIEW | `src/modules/auth/application/otp-service.ts:87-96` |
| NOT-05 | Confirmation times are printed in UTC, an hour behind Nigerian time. The rest of the product uses Lagos time. | P0 | REVIEW | `src/modules/notifications/application/handlers.ts:21-27`; `src/modules/audit-compliance/application/platform-summary.ts:88-91` |
| NOT-06 | The boot guardrails accept `SMS_PROVIDER=termii` or `africastalking`, though neither works. The server starts, every code then fails silently, and the only trace is an error log line. | P0 | NEW | `src/lib/env-rules.ts:42-80`; `src/lib/sms/index.ts:105-108` |
| NOT-07 | No in-app inbox. The module has no routes and the one read function has no caller. | P1 | REVIEW | `src/modules/notifications/routes.ts:13`; `src/modules/notifications/application/notify.ts:59-65` |
| NOT-08 | v2.9 tables for templates, preferences and per-delivery records do not exist; each text is one row with no opt-out, digest, cost control or provider message id. | P1 | V2.9 | `prisma/schema.prisma:1151-1169` |
| NOT-09 | Email, push and WhatsApp channels are not built. `SMTP_URL` is read and never used; `devices.push_token` is unused. | P1 | V2.9 | `src/lib/env.ts:39`; `prisma/schema.prisma:169-178` |
| NOT-10 | Only the facility's single representative is texted; owners, administrators and schedulers who actually run the shift hear nothing, and removing the representative's role does not change the recipient. | P1 | NEW | `src/modules/notifications/application/handlers.ts:72-80`; `prisma/schema.prisma:575` |
| NOT-11 | All message text is English, written inline; no template store, no Hausa. | P1 | V3 | `src/modules/notifications/application/handlers.ts:64,75`; `src/modules/auth/domain/otp.ts:156-165` |
| NOT-12 | No scheduled reminders (24 hours and 2 hours before a shift) and no "not checked in" alert. The only sweeps are the six in Annex P3. See SCH-02. | P1 | REVIEW | `src/worker/jobs.ts:31-68` |

**Recommended change (v3).**

*Phase 0, make it safe.* (1) Implement two real SMS providers behind the existing adapter, with failover, a delivery receipt callback and the transactional flag honoured (NOT-02). The provider names in the environment list are Termii and Africa's Talking; choose by sending a test from a Gombe SIM, and check sender-ID registration rules [not verified]. (2) Make the boot guardrails refuse any provider that is not implemented and configured (NOT-06). (3) Make a failed send visible: show the person "we could not send the code, try again" (NOT-04), and make the handler fail so the outbox retries with backoff, or give messages their own queue with PENDING, SENT, FAILED and DEAD states (NOT-03). (4) Print every time in West Africa Time (NOT-05). (5) Add consumers for the events marked "before pilot" in Annex P2 (NOT-01), starting with offer received, offer accepted, booking confirmed, booking cancelled, credential decisions and expiry, facility verified, timesheet submitted and approved, dispute opened.

*Phase 1, Gombe pilot.* Send to every facility person with the right permission, not only the representative (NOT-10). Add the 24-hour and 2-hour reminders and the 30-minute no-show alert (NOT-12, SCH-02). Move message text into stored templates, English first, with Hausa-assisted wording reviewed by a Gombe speaker (NOT-11). Add an in-app inbox and a per-person preference (NOT-07, NOT-08), because SMS cost is real and the platform pays it while the product is free.

*Phase 2 and later.* WhatsApp as the second channel, through an approved provider (NOT-09) [Counsel and provider approval]. New events for proposals, counter-offers, expiry of an offer, contact-reveal windows, review requests and payout notices.

What should be sent, by trigger:

| Trigger | Today | Before pilot | Later |
|---|---|---|---|
| Sign-up or reset code | Text, not deliverable (no provider) | Real SMS, failure shown to the person | Hausa wording |
| Offer received | Nothing | Text to the practitioner: place, date and time in WAT, hourly rate | Rate and premiums, travel |
| Offer accepted | Nothing | Text to the facility's staff: please confirm | Counter-offer rounds |
| Booking confirmed | Two texts, UTC, representative only | WAT, all permitted facility staff | Calendar link |
| Booking or shift cancelled | Nothing | Text to the other party | Penalty notice |
| Reminder, 24 h and 2 h | Nothing | Practitioner and facility | Preferences |
| Not checked in 30 minutes after start | Nothing | Facility alert | Auto backfill |
| Credential or identity decision, licence expiry (30 and 7 days) | Nothing | Practitioner, with the reason | Renewal prompts |
| Facility verified or rejected | Nothing | Owner, with the reason | Licence expiry |
| Timesheet submitted, approved | Nothing | Facility to approve; practitioner when approved | Auto-approval notice |
| Dispute opened, answered | Nothing | The other party | SLA reminders |
| Serious incident reported | Nothing | Compliance officer, immediately | Facility notice |
| Invoice issued, payment received, payout sent | Nothing | Payout sent to the practitioner | Facility statements |

**Acceptance criteria.**

1. Given a configured SMS provider, when a person requests a code, then a text reaches a real handset and a delivery receipt is stored against the message.
2. Given the provider rejects a send, when the code is requested, then the screen says it could not be sent and offers a retry; no "code sent" message is shown.
3. Given a confirmation text fails, when the worker next runs, then it is retried with backoff and, after the last attempt, appears in a failed-messages list an operator can see.
4. Given a facility publishes an offer to a practitioner, when the invitation is saved, then the practitioner is texted within one minute with the place, the date and time in West Africa Time and the hourly rate.
5. Given a booking is confirmed for 18:00 Lagos time, when the texts are sent, then both read "18:00" and no text reads "UTC".
6. Given a facility with an owner, two administrators and a representative, when a practitioner accepts, then each person who may confirm is texted once.
7. Given `SMS_PROVIDER=termii` with no working adapter, when the server starts in staging or production, then it refuses to boot and names the problem.
8. Given a person who has switched off non-essential texts, when a reminder is due, then it is not sent, but a code or a cancellation still is.

---

## Module 17 · Audit, consent and compliance  *(repo folder `src/modules/audit-compliance`; v2.9 Module 17, with the dashboards of v2.9 Module 16)*

**Status:** Partly built · **Label:** CURRENT + IMPROVE · **Maturity for a Gombe pilot:** Ready after P0 fixes — the audit trail, consent records and rights queue work, but erasure does not exist, audit rows hold names, agreements are not required, and registration with the data-protection regulator, a privacy officer and a retention schedule are not started.

**Why it exists.** A practitioner hands Medilink a national identity number, licence documents and a photograph. The Nigeria Data Protection Act 2023 says they must be able to see what is held, say who may see their profile, change their mind, and be answered within a month. A compliance officer must be able to answer "who approved this licence, when and why", and a hospital must be able to show what it agreed to. Without this module, a dispute about "I never agreed to that" or "who changed this" cannot be settled, and the platform is not lawfully operable.

**Who uses it.**

| Actor | What they do here | Permission @ scope |
|---|---|---|
| Administrator (compliance, operations, finance merged) | Read the audit trail; work the data-request queue; see queue and growth dashboards | `audit.read` @ PLATFORM (`src/lib/authz/permissions.ts:172-183`) |
| Super administrator | Publish new versions of the privacy notice and the two terms of engagement | `config.manage` @ PLATFORM |
| Practitioner | Give or withdraw consent; accept agreements; download their data; ask for erasure or another right | `practitioner.profile.read` / `.write` @ SELF |
| Hospital staff | Accept the hospital's terms; see their own dashboard | `facility.read` @ FACILITY; dashboard sections by permission |
| Hospital staff, practitioners | **Cannot** read an audit trail: no role holds `audit.read` below platform level | none |
| System | Writes an audit row inside every state change; a test checks it | system |

**How it works today.**

1. **The audit trail.** Every change to the data writes one audit row in the same database transaction: who (a person, the system or the worker), what (`subject.verb`, such as `facility.verified`), which table and record, which scope, an optional reason, and the before and after values with secret fields removed by name (`src/lib/audit.ts:31-68`). There are about 100 write sites.
2. **The coverage test.** The test suite fails if a write to any of 46 listed tables leaves no audit row naming the same table. 15 other tables are exempt, each with a written reason (`src/lib/audit-coverage.ts:25-109`). The match is by table, not by row, which the stage document admits (`docs/stage-4-5-audit-coverage.md:51-59`).
3. **Reading it.** An officer opens `/admin/audit`, filters by area (sign-in, practitioners, facilities, shifts, casework, money, compliance), date or record, and sees who did what with the actor's name. Before and after values are never returned, there is no "everything this person did" filter by design, and each read is logged as a security event (`src/modules/audit-compliance/application/read-audit-trail.ts:35-163`).
4. **Consent.** A practitioner ticks "show my verified credentials and profile to hospitals" at sign-up; the screen will not let them continue without it. That writes two consent records. Later they can withdraw from My profile, Privacy, with a reason, and matching leaves them out. Identity verification is held on legal obligation and cannot be withdrawn. Marketing is never asked (`src/modules/audit-compliance/application/consent.ts:59-194`).
5. **Agreements.** A super administrator publishes a version of the privacy notice, the practitioner engagement terms or the facility terms; the previous version of that kind is retired in the same step. A practitioner sees what is in force on the Privacy tab; hospital staff see it on the facility home page. Accepting records the version, the time, the address and the browser. Nothing requires it (`consent.ts:196-398`).
6. **Data requests.** From the Privacy tab a practitioner can ask for access, correction, erasure, a portable copy or a restriction. A 30-day deadline is stamped on the request. Officers work `/admin/data-requests` closest-deadline first, pick one up, then close it with a written outcome (`src/modules/audit-compliance/application/data-subject.ts:82-296`). Access and portability are answered by the "Get a copy" button, which downloads a JSON file. For erasure the page lists what would block it and what it would do; **nothing is deleted** (`data-subject.ts:411-431`).
7. **Dashboards.** The platform dashboard shows six work queues with their oldest waiting item, incident severity, monthly growth in Lagos time and the last eight audit rows. The facility dashboard shows published shifts, roster size, timesheets awaiting approval, weekly fill and monthly spend. Each is one request and shows only what the caller's permissions allow (`platform-summary.ts`, `facility-summary.ts`).

| Data request | Can go to | Triggered by |
|---|---|---|
| RECEIVED | IN_PROGRESS | An officer picks it up (race-safe, `data-subject.ts:149-172`) |
| RECEIVED or IN_PROGRESS | COMPLETED or REFUSED | An officer closes it with an outcome of 10+ characters (`data-subject.ts:177-219`) |
| COMPLETED, REFUSED | — | Closed; cannot be reopened |

| Agreement version | Can go to | Triggered by |
|---|---|---|
| In force | Retired | A newer version of the same kind is published (`consent.ts:363-366`) |
| In force or retired | — | Never deleted; acceptances stay readable |

| Consent purpose (per person) | Can go to | Triggered by |
|---|---|---|
| Not asked | Granted | Sign-up tick-box (`consent.ts:144-164`) or the toggle |
| Granted | Withdrawn | Person withdraws with a reason; only purposes resting on consent |
| Withdrawn | Granted | Person grants again; every change is a new row |

**Rules the system enforces.**

- A change and its audit row commit or fail together (`src/lib/audit.ts:50-68`).
- These fields never reach the audit table in clear: `passwordHash`, `password`, `codeHash`, `tokenHash`, `accountNumber`, `bvn`, `nin`, `secret`, `apiKey` (`src/lib/audit.ts:31-48`). Names, emails and phones are not on that list.
- Adding a database table without deciding whether it is audited or exempt fails the test suite (`tests/integration/audit-coverage.test.ts:377-415`).
- The audit read always names a scope; only platform scope sees rows with no scope; before and after are never returned; each read is recorded (`read-audit-trail.ts:42-45,75-87,140-163`).
- Consent is append-only; only purposes resting on consent can be withdrawn; withdrawal needs a reason (`consent.ts:94-97`; `src/modules/audit-compliance/domain/consent.ts:43-51`).
- A practitioner who explicitly withdrew either matching consent is left out of every match (`consent.ts:178-194`).
- Agreement identifiers are unique, a retired version cannot be accepted, and the facility route accepts only facility terms and the privacy notice (`consent.ts:262,333-343,359-360`).
- A data request cannot be closed without an outcome, and two officers cannot pick up the same one (`data-subject.ts:149-156,190`).
- The export contains no audit trail, ledger entry or NIN, and says so (`data-subject.ts:374-384`). Erasure is deferred, not refused, while a shift is confirmed, money is owed or a dispute is open (`src/modules/audit-compliance/domain/consent.ts:115-121`).

**What is not there yet.**

| ID | Gap | Sev | Source | Evidence |
|---|---|---|---|---|
| AUD-01 | Erasure is not implemented. The page and API only assess blockers and explain; closing an erasure request records words and deletes nothing. No code replaces personal data, deletes stored files, or sets an account to closed. | P0 | REVIEW | `src/modules/audit-compliance/application/data-subject.ts:411-431,177-219`; `src/app/api/v1/me/erasure/route.ts:12-20` |
| AUD-02 | Audit rows keep personal data. Registration stores full name and email; facility rows store contact phone and email; free text from rights requests and consent notes goes into the reason. Redaction works on key names only. Names would survive an erasure. | P0 | REVIEW | `src/modules/auth/application/registration.ts:80`; `src/lib/audit.ts:31-48`; `src/modules/facilities/application/facility.ts:74-98,221`; `data-subject.ts:109` |
| AUD-03 | Agreements are not enforced. Sign-up has no privacy-notice or terms step; nothing blocks work until accepted; a new version is not re-accepted; a hospital's acceptance records the person, not the facility. The fee cannot be made binding on someone who never accepted terms. | P0 | REVIEW | `src/modules/audit-compliance/application/consent.ts:218-253`; `prisma/schema.prisma:2020-2037`; `src/app/api/v1/agreements/facility/route.ts:36-45` |
| AUD-04 | No data inventory, no retention schedule and no purge job for any category (identity, documents, notifications, audit, sessions). v2.9 §9.14 requires purpose, basis, owner, retention and deletion method per category. | P0 | V2.9 | `prisma/schema.prisma:2096-2146` (no retention model); `src/worker/jobs.ts:31-68` |
| AUD-05 | Registration with the data-protection regulator as a controller of major importance, a data-protection officer, a privacy impact assessment, counsel's opinion on Medilink's role and a cross-border storage note are all "Not started". [Counsel] | P0 | REVIEW | `docs/stage-3-gate-checklist.md:9-16` |
| AUD-06 | The audit table is append-only by habit only. The application's database role can update or delete rows; no trigger or permission blocks it, and there is no tamper evidence (v2.9 §9.15 asks for it). | P1 | REVIEW | `prisma/schema.prisma:230-231`; `src/lib/audit-coverage.ts:79-80` |
| AUD-07 | The export omits disputes, incidents, notifications, attendance, timesheets, screening, sessions and invoices. | P1 | REVIEW | `src/modules/audit-compliance/application/data-subject.ts:335-370` |
| AUD-08 | Hospital staff cannot exercise any right: export, erasure assessment, consent and request routes need practitioner permissions that no facility role holds. | P1 | REVIEW | `src/app/api/v1/me/export/route.ts:19-20`; `src/lib/authz/permissions.ts:140-147` |
| AUD-09 | Consent is "yes by silence" in matching: a practitioner with no consent record is shown to hospitals, and the sign-up tick-box is enforced by the screen only; the server accepts a sign-up without it. | P1 | NEW | `src/modules/audit-compliance/application/consent.ts:166-194`; `src/modules/auth/presentation/schemas.ts:40`; `src/app/(auth)/register/page.tsx:434` |
| AUD-10 | Picking up and closing a rights request needs only `audit.read`, a read permission. Rectification and restriction have no way to be carried out in the product; closing records words. | P1 | NEW | `src/app/api/v1/data-requests/[id]/close/route.ts:20`; `data-subject.ts:177-219` |
| AUD-11 | No lawful-disclosure route for a regulator, court or police request (the request, legal basis, authorising officer and what was released recorded). | P1 | V2.9 | v2.9 Module 17; no model or route in `prisma/schema.prisma` |
| AUD-12 | No data-breach workflow or incident table. Security events are written for only three read paths and nothing monitors them. [Counsel on notification duties] | P1 | V2.9 | `src/modules/audit-compliance/application/read-audit-trail.ts:146`; `src/modules/credentials/application/submission.ts:669` |
| AUD-13 | The correlation id is made for every request and logged, but never saved in an audit row or an event, so one business action cannot be followed across them. | P1 | V2.9 | `src/lib/audit.ts:26,63`; `src/lib/outbox.ts:14,26` |
| AUD-14 | Consent has four purposes. The two-sided design needs separate opt-ins for publishing a priced listing, contact reveal and profile viewing by hospitals, each re-asked, with a view log of who looked at whom. | P1 | V3 | `prisma/schema.prisma:2069-2080` |
| AUD-15 | Coverage is by table, so a write can pass because an unrelated write to the same table was audited in the same window. | P2 | NEW | `src/lib/audit-coverage.ts:224-240` |
| AUD-16 | Publishing an agreement with a future start date retires the old one at once and refuses to accept it, leaving nothing in force until the date. | P2 | NEW | `consent.ts:224-225,262,363-366` |
| AUD-17 | No exportable report of any kind (CSV) for the audit trail or queues, which v2.9 Module 16 lists. | P2 | V2.9 | `src/app/admin/audit/page.tsx` |
| AUD-18 | Only platform staff can read a trail. The route accepts facility and self scopes, but no role holds `audit.read` there, so a hospital cannot see who did what in its own account. | P2 | NEW | `src/lib/authz/permissions.ts:140-147,172-183`; `src/modules/audit-compliance/routes.ts:42-47` |
| AUD-19 | Dashboards read other modules' tables directly (a documented exception). A change in another module can silently break a tile. | P2 | REVIEW | `src/modules/audit-compliance/application/platform-summary.ts:4-22` |

**Recommended change (v3).**

*Phase 0, make it safe.* (1) Stop new personal data entering audit rows: store ids and masked values, add name, email and phone keys to the redaction list, move free text out of `reason`, and add a test that reads a fresh audit table for a known name (AUD-02). This is small and must precede real data. (2) Add a sign-up step that shows the privacy notice and the engagement terms and records acceptance; make the server refuse to leave the review state, or to be matched, without the current versions; ask again when a new version is published; store a hospital's acceptance against the facility and the person (AUD-03). (3) Build erasure as a job: replace personal fields with a stable pseudonym on the user, profile, consent and credential rows, delete the stored files, replace names in audit rows, keep ledger and audit rows, and prove it with a test (AUD-01). It needs an object-delete function (PLT-12). (4) With counsel: the retention schedule and data inventory, regulator registration, a privacy officer, an impact assessment and the cross-border note (AUD-04, AUD-05).

*Phase 1, Gombe pilot.* Block updates and deletes on the audit table in the database and add a nightly hash check (AUD-06). Widen the export and give hospital staff a rights route (AUD-07, AUD-08). Make consent explicit in matching and on the server (AUD-09). Give rights work its own permission and a real carry-out step for correction and restriction (AUD-10). Design lawful disclosure and breach handling with counsel (AUD-11, AUD-12). Save the correlation id (AUD-13).

*Phase 2 and later.* New consent purposes for listings, contact reveal and directory visibility, with re-consent and a log of who viewed which profile (AUD-14); a way for a practitioner to ask a human to review an adverse automated ranking; retention jobs for old sessions, codes, messages and rejected documents (PLT-07). Ads and any paid tier need their own consent or contract basis [Counsel].

**Acceptance criteria.**

1. Given a new registration, when the audit table is searched for the person's name, email and full phone, then none appears.
2. Given a practitioner who has not accepted the current privacy notice and terms, when they try to submit for approval or accept an offer, then the server refuses and names the missing agreement.
3. Given a new version of the terms is published, when a practitioner next signs in, then they must accept it before continuing.
4. Given an approved erasure request with no blockers, when the job runs, then the person's name, phone, email, documents and photo are replaced or deleted, the audit and ledger rows remain, and a search of both finds no real name.
5. Given a request to update or delete an audit row from the application's database role, when it is run, then the database refuses.
6. Given a hospital administrator, when they ask for their own data or an erasure, then the request is accepted and appears in the officer queue within its 30-day deadline.
7. Given a practitioner with no consent record who registered through the API, when a facility runs a match, then they are not returned.
8. Given two events from one booking, when an officer follows the correlation id, then the request, the audit rows and both events appear together.

---

## Module 18 · Suggestions  *(repo folder `src/modules/suggestions`; v2.9 Module 18)*

**Status:** Partly built · **Label:** CURRENT + IMPROVE · **Maturity for a Gombe pilot:** Ready — filing and triage work and are tested; closing the loop to the person who wrote is a P1, but the screen already promises a reply that nothing delivers.

**Why it exists.** The pilot exists to learn what the specification got wrong. That only works if a nurse who finds a screen confusing, or a ward manager who finds matching unhelpful, has somewhere to say so that is not a WhatsApp message to the founder. v2.9 says the reason in one line: a suggestion box that swallows input teaches people to stop using it.

**Who uses it.**

| Actor | What they do here | Permission @ scope |
|---|---|---|
| Practitioner | Send a suggestion from any console | `suggestion.submit` @ SELF (`src/lib/authz/permissions.ts:116-122`) |
| Facility staff | The same, sending their facility id so the scope check passes | `suggestion.submit` @ FACILITY (`:140-147`; `presentation/schemas.ts:23-29`) |
| Medilink administrator | Read the log, read the summary by area, triage and answer | `suggestion.triage` @ PLATFORM (`:172-183`) |
| System | Turns an offer's decline reason into a suggestion, with no author | inside the decline transaction |

**How it works today.**

1. **Filing.** Every console has a "Send a suggestion" dialog (`src/components/app/suggestion-dialog.tsx`, mounted at `src/components/app/console-shell.tsx:31,298`). The writer picks one of nine areas (signing up, documents, offers and matching, shifts and rotas, checking in and out, timesheets, pay and invoices, getting help, something else) and writes at least ten characters. The row stores the person, the area, the text and the status "new". It does not store their role, the screen they were on or their facility; the facility id is used only for the scope check (`application/suggestion.ts:73-103`).
2. **A decline reason becomes a suggestion.** When a practitioner declines an offer and gives a reason of ten or more characters, the reason is saved as a suggestion under "matching" in the same transaction as the decline. It has no author and carries a pointer to the invitation, so a candid reason is not put under the practitioner's name in an operations queue (`application/suggestion.ts:117-142`).
3. **Triage.** Administrators see the log newest first, filter by status or area, and see a count by area with how many are still open. They move a suggestion along; moving to "done" or "declined" needs a written response of at least ten characters (`application/suggestion.ts:158-307`; `app/admin/suggestions/*`).
4. **The writer is told nothing.** The dialog says "The Medilink team reads every suggestion and replies to it." No route and no screen lets the writer read their suggestion, its status or the reply, and no message is sent (`src/components/app/suggestion-dialog.tsx:72`; `routes.ts:19-24`).

**The state machine, in plain English.**

| State | Can go to | Triggered by |
|---|---|---|
| New | Triaged; Planned; Done; Declined | Administrator triages |
| Triaged | Planned; Done; Declined | Administrator moves it along |
| Planned | Triaged; Done; Declined | Administrator moves it along |
| Done, Declined | nothing | Final. A suggestion cannot be reopened; changing one's mind is a new suggestion |

A move to the same status is refused, and "new" cannot be chosen as a target (`domain/suggestion.ts:63-74`; `presentation/schemas.ts:40-44`). v2.9's five words map as: received is *new*, under consideration is *triaged*, planned is *planned*, shipped is *done*, declined with a reason is *declined*. None is visible to the writer.

**Against v2.9 Module 18.**

| v2.9 says | The code does | Mark |
|---|---|---|
| A control available from every screen | The dialog is in all three consoles; not on public or sign-in pages | IMPLEMENTED |
| Captures the suggestion, the submitter's role, the screen and the facility or practitioner | Text, area and person only | PARTLY |
| Every suggestion carries a status visible to the person who submitted it | No author read route or screen | MISSING |
| Tagged by module | One `area` of nine values; no tag table | PARTLY |
| Reviewed weekly with the dispute log and the record of refused excusals | The summary covers suggestions only | MISSING |
| Declined with a reason | A response of ten or more characters is required for done and declined | IMPLEMENTED |
| Data: suggestions, status history, tags | Suggestions only; status history lives in the audit trail | PARTLY |

**Rules the system enforces.**

- A suggestion needs an area and ten to 2,000 characters (`domain/suggestion.ts:34-35`; `presentation/schemas.ts:20-22`).
- A decline reason never carries an author, and its audit row has no actor (`application/suggestion.ts:117-142`).
- Done and declined need a response of at least ten characters; the status change is a compare-and-set, so two administrators cannot both close one (`domain/suggestion.ts:63-74`; `application/suggestion.ts:170-179`).
- A closed suggestion stays closed (`domain/suggestion.ts:66`).
- Only `suggestion.triage` at PLATFORM can read the log; a facility has no way to read what practitioners wrote about it (`routes.ts:19-24`; `tests/integration/suggestions.test.ts:344`).
- A member of a hospital's staff can file only under a facility they belong to (`tests/integration/suggestions.test.ts:385`).
- Tests today: 10 rule cases and 17 integration cases (file, empty refused, audit, decline to suggestion without a name, triage rules, no reopening, filters, paging, the summary, route table, hospital staff accepted and a foreign facility refused). No browser test.

**The review said X; at HEAD it is fixed.** A code comment records that the log used to hear only decline reasons, because holders of the permission (practitioners, hospital staff, administrators) had nowhere to write one. At HEAD every console has the dialog, and hospital staff can file under their facility (`src/components/app/suggestion-dialog.tsx:42-49`; `presentation/schemas.ts:20-29`).

**What is not there yet.**

| ID | Gap | Sev | Source | Evidence |
|---|---|---|---|---|
| SUG-01 | The writer cannot read the status or the response of their own suggestion, though the dialog promises a reply. | P1 | REVIEW | `routes.ts:19-24`; `src/components/app/suggestion-dialog.tsx:72` |
| SUG-02 | Nobody is told when a suggestion is answered. No event is published on triage. | P1 | NEW | `application/suggestion.ts:158-196` |
| SUG-03 | Only text, area and person are captured; no role, screen or facility (the facility id is used for scope only). | P2 | V2.9 | `application/suggestion.ts:73-103`; `presentation/schemas.ts:20-29` |
| SUG-04 | One area of nine values, not tags by module; no status-history table. | P2 | V2.9 | `prisma/schema.prisma:1757-1769` |
| SUG-05 | No weekly review that sets suggestions beside the dispute log and refused excusals; the summary covers suggestions only. | P2 | V2.9 | `application/suggestion.ts:290-307` |
| SUG-06 | The route table says submit is SELF only; the handler also accepts FACILITY scope. The stage document says "no FACILITY scope anywhere" and names a retired role. | P2 | NEW | `app/api/v1/suggestions/route.ts:22-25`; `routes.ts:19-24`; `docs/stage-9-5-suggestion-log.md` |
| SUG-07 | No retention rule, no warning against personal data in the text, and the log is not a complaints channel. | P2 | REVIEW | `application/suggestion.ts:73-103` |
| SUG-08 | No report-a-user and no after-shift ratings. Both belong to the Trust and reviews work, not here. | P2 | REVIEW | `routes.ts:19-24` |

**Recommended change (v3).**

*Phase 1, Gombe pilot.* Add a "My suggestions" screen showing v2.9's five words and the reply (SUG-01), and send a notice through the in-app inbox, with an SMS option, when a suggestion is answered (SUG-02). Capture the writer's role, the screen and the facility automatically (SUG-03). Fix the route table and the stale document (SUG-06). Add a plain note on the dialog not to include personal or patient details, and set a retention period (SUG-07).

*Phase 2 and later.* Replace the single area with module tags and a status-history table (SUG-04). Produce a weekly review pack that puts suggestions beside the dispute log and the record of refused excusals, so patterns across them are seen together (SUG-05; the refusal record depends on SAN-09). Route "report this person" and after-shift ratings to the two-way reviews work in the Trust phase (SUG-08), with moderation and appeal, rather than growing this log into a complaints system.

**Acceptance criteria.**

1. Given a suggestion I filed, when I open "My suggestions", then I see its text, its status in v2.9's words and, once closed, the reply.
2. Given an administrator moves my suggestion to "done" or "declined" with a reply, when it is saved, then I receive a notice in the app.
3. Given a suggestion filed from the timesheets screen by a hospital administrator, when an officer reads it, then it shows the role, the screen and the facility.
4. Given a closed suggestion, when anyone tries to reopen it, then the request is refused and a new suggestion is the only way to say more.
5. Given a decline reason, when it becomes a suggestion, then no author appears anywhere in the log or the audit row.
6. Given the weekly review, when it is produced, then it lists suggestions, new disputes and refused excusals for the week side by side.

---

## Module — · Reference data and configuration  *(repo folder `src/modules/config`; v2.9 §8.6, and Module 16 "configuration management")*

**Status:** Partly built · **Label:** CURRENT + NEW EXPANSION · **Maturity for a Gombe pilot:** Ready after P0 fixes — the lists work for doctors and nurses, but nothing can be edited without a developer, four professions have no document requirements, three have no pay floor, and the sanctions list is empty.

**Why it exists.** Every form and every safety rule leans on a few controlled lists: which professions exist and who regulates them, which documents a profession must show, which states and LGAs a person works in, what a shift may pay at minimum, which days are public holidays, and which names are barred. When a compliance officer in Gombe learns that pharmacists need a new document, or that Eid has been announced for a Friday, the list has to change the same day without a developer. Without these lists, a nurse could be matched on a doctor's rules or a shift could be posted below a defensible rate.

**Who uses it.**

| Actor | What they do here | Permission @ scope |
|---|---|---|
| Every signed-in person | Read the lists to fill dropdowns | a session only (`src/app/api/v1/reference/route.ts:23-33`) |
| Super administrator | Is meant to edit vocabularies and floors | `config.manage` @ PLATFORM, which no route uses for this (`src/lib/authz/permissions.ts:47`) |
| Developer or operator | Changes a list by editing the seed file, deploying and running the seed | database access |
| Other modules | Read floors (shift pricing), categories (profiles), requirements (eligibility), holidays (timesheets), sanctions (screening) | in code |

**How it works today.**

1. **Loading.** `prisma/seed.ts` writes every list with a named owner and can be re-run safely: it updates by natural key and never switches a disabled job back on (`prisma/seed.ts:35-329`). It is run by hand; the production image cannot run it (PLT-01).
2. **Serving.** `GET /api/v1/reference` returns professions, specialties, credential types (with which professions must hold each), facility types, 37 states and all 774 LGAs, plus whether identity and licence checks are automated (`src/modules/config/reference.ts:47-101`). The browser keeps the answer for an hour (`src/lib/ui/reference.ts:29-35`).
3. **Using it.** The profile wizard, the shift form, facility registration and the credential form all read it.
4. **Pay floors.** When a facility creates or publishes a shift, the platform finds the floor for the profession, the specialty (or "any") and day or night, effective on the shift's start. A floor naming the specialty beats the general one; among equals the latest effective date wins. A rate at the floor is allowed; below it is refused. **If no floor exists the shift passes** (`src/modules/service-requests/domain/rate-floor.ts:42-83`).
5. **Changing anything.** Edit the seed, deploy, run the seed. No screen, no audit row. The one list a person can change in the product is the agreements (Module 17).

What is seeded, by profession.

| Profession (regulator) | Specialties | Documents required | Other document types that exist | Pay floor, day / night per hour |
|---|---|---|---|---|
| Doctor (MDCN) | 12: general practice, internal medicine, paediatrics, obstetrics and gynaecology, general surgery, anaesthesia, emergency medicine, family medicine, radiology, pathology, psychiatry, ophthalmology | MDCN annual practising licence, NIN, MBBS certificate | NYSC certificate, certificate of good standing, professional indemnity cover (optional) | ₦5,000 (500,000 kobo) / ₦6,500 (650,000 kobo) |
| Nurse / midwife (NMCN) | 3: general nursing, perioperative nursing, midwifery | **none** | no NMCN type | ₦2,500 (250,000 kobo) / ₦3,250 (325,000 kobo) |
| Pharmacist (PCN) | **none** | **none** | no PCN type | **none** |
| Medical laboratory scientist (MLSCN) | **none** | **none** | no MLSCN type | **none** |
| Radiographer (RRBN) | **none** | **none** | no RRBN type | **none** |

Source: `prisma/seed.ts:35-50,67-74,99-107,127-149,273-282`. The floors are labelled placeholders pending the revenue decision (`seed.ts:274`).

Other lists: seven facility types (teaching hospital, general hospital, private hospital, primary health centre, clinic, diagnostic laboratory, imaging centre; `seed.ts:194-203`); 36 states plus the FCT and 774 LGAs, with Gombe's 11 (Akko, Balanga, Billiri, Dukku, Funakaye, Gombe, Kaltungo, Kwami, Nafada, Shongom, Yamaltu/Deba; `prisma/data/nigeria.ts:184-191`); six public holidays, all in 2026 (`seed.ts:253-261`); an empty sanctions list by design (`seed.ts:157-178`).

What can be changed, and how.

| List | Row states | Changed by | Screen? | Audit row? |
|---|---|---|---|---|
| Professions, specialties | active or inactive (`is_active`; set by no code) | seed, then deploy | No | No |
| Credential types and requirements | none | seed, then deploy | No | No |
| Facility types, states, LGAs, holidays | none | seed, then deploy | No | No |
| Rate floors | dated; the latest effective on the shift's start wins; no end date | seed, then deploy | No | No |
| Sanctions list | none | **nothing writes it** | No | No |
| Agreements | in force or retired | super administrator in the console | Yes (`/admin/agreements`) | Yes |

**Rules the system enforces.**

- The seed refuses to finish unless it has exactly 37 states and 774 LGAs, and a test pins counts such as Kano 44 and Lagos 20 (`prisma/seed.ts:228-234`; `src/modules/config/nigeria.test.ts`).
- Every list row carries an owner label (`prisma/schema.prisma:307-436`).
- A shift's pay must be at or above the governing floor; a floor naming the specialty beats the general one; the latest effective date at or before the shift's own start wins, not today's date (`rate-floor.ts:42-83`).
- A facility's LGA must belong to its state; a practitioner's home LGA must sit in their home state (`src/modules/facilities/application/facility.ts:101-104`).
- The job rows come from one list in code, so a job with no handler cannot exist, and the seed never re-enables a job an operator disabled (`src/worker/jobs.ts:31-68`; `prisma/seed.ts:180-192`).
- Roles and permissions in the database are overwritten to match the code on every seed, so a permission removed from a role really leaves (`src/lib/authz/sync-roles.ts:18-57`).

**What is not there yet.**

| ID | Gap | Sev | Source | Evidence |
|---|---|---|---|---|
| CFG-01 | No credential types or requirements for nurses, pharmacists, laboratory scientists or radiographers. Four of five professions need no document to submit for review. Same fact as CRE-01 and CRE-02. | P0 | REVIEW | `prisma/seed.ts:99-149` |
| CFG-02 | Pay floors exist only for doctor and nurse, day and night. A shift for any other profession has no floor and **silently passes**, at any rate. The floors that exist are placeholders. | P0 | REVIEW | `prisma/seed.ts:273-299`; `src/modules/service-requests/domain/rate-floor.ts:78-83` |
| CFG-03 | The sanctions list is empty and nothing can fill it, so screening reports "clear" for everyone. Same as PRA-14. | P0 | REVIEW | `prisma/seed.ts:157-178`; no writer in `src/` |
| CFG-04 | No level, cadre, registration category, supervision, skill or competency lists exist. They must be in place before pilot data exists. | P0 | V3 | `prisma/schema.prisma:307-336` |
| CFG-05 | Nothing writes the lists except the seed. Every change is a deploy and a hand-run seed, and `config.manage` ("edit vocabularies and rate floors") governs only agreements. | P1 | REVIEW | `src/lib/authz/permissions.ts:47`; `src/app/api/v1/agreements/route.ts:62` |
| CFG-06 | Seed edits leave no audit row, so a changed floor or requirement has no who, when or why. The tables are listed as audited only for tests. | P1 | NEW | `prisma/seed.ts:273-299`; `src/lib/audit-coverage.ts:41,57` |
| CFG-07 | Specialties are seeded for doctors (12) and nurses (3) only; none for the other three professions; nursing has no intensive-care entry; a practitioner holds one specialty. | P1 | REVIEW | `prisma/seed.ts:67-74` |
| CFG-08 | Professions the review names as missing: dentists, physiotherapists, community health workers, optometrists, medical-records staff (v2.9 §8.6 lists physiotherapists as an example cadre). | P1 | REVIEW | `prisma/seed.ts:35-50` |
| CFG-09 | Facility types lack pharmacy and maternity home. Government hospitals and primary health centres have no registration reference other than a CAC number (Module 4). | P1 | REVIEW | `prisma/seed.ts:194-203` |
| CFG-10 | Holidays: six fixed 2026 dates, none for 2027, no moveable Islamic or Christian dates, no state holidays. Holiday pay and scheduling read them. See SCH-03. | P1 | REVIEW | `prisma/seed.ts:253-271` |
| CFG-11 | The reference endpoint returns inactive professions and specialties, sends all 774 LGAs on every call and sets no cache header. (The browser caches it for an hour, which hides the cost.) | P1 | REVIEW | `src/modules/config/reference.ts:50-77`; `src/app/api/v1/reference/route.ts:23-33` |
| CFG-12 | The platform fee is the environment variable `PLATFORM_FEE_BP`, read at call time, outside the validated settings, with no dates, no scope and no per-line record of the rate applied. | P1 | REVIEW | `src/modules/billing-settlement/application/invoice.ts:43-46`; `src/lib/env.ts:9-62` |
| CFG-13 | The old global "mandatory" flag on credential types is still written, while the real rule is the per-profession requirements table. | P2 | REVIEW | `prisma/schema.prisma:347`; `prisma/seed.ts:101-106` |
| CFG-14 | Owner labels name retired roles (`compliance-officer`, `operations-officer`, `finance-officer`), so "named owner" no longer points at a person or role that exists. | P2 | NEW | `prisma/seed.ts:19-23` |
| CFG-15 | v2.9 asks for configurable workflow transitions (§8.7) and feature flags (§8.9). Both are absent; all transitions are in code. | P2 | V2.9 | no table or code (search of `src/` and `prisma/schema.prisma`) |

**Recommended change (v3).**

*Phase 0, make it safe.* (1) With each regulator and with compliance sign-off, define credential types and requirements for nurses and midwives, pharmacists, laboratory scientists and radiographers (CFG-01; see CRE-01). (2) Give every profession a day and a night floor, validated with Gombe facilities, and make a missing floor refuse publication instead of passing (CFG-02). Add a check in the seed test that fails if any active profession lacks a floor or a requirement set. (3) Load the real sanctions lists and give compliance a screen to maintain them (CFG-03). (4) Create the level reference data before any pilot data: profession, registration category, cadre or level, specialty, competencies and supervision requirement, seeded from the draft ladders in the review (Appendix A) and validated with regulators and practising clinicians in Gombe (CFG-04).

*Phase 1, Gombe pilot.* Build an admin screen under `config.manage` for vocabularies, requirements, floors and holidays. Every edit writes an audit row with who, why and before and after; floors are new dated rows, never overwritten; a second person approves floor changes (CFG-05, CFG-06). Make the reference endpoint return only active rows, with a change marker so browsers refetch only when something changed (CFG-11). Enter 2027 holidays and the moveable dates when announced, and add state holidays (CFG-10). Add specialties, categories and facility types as compliance decides (CFG-07 to CFG-09).

*Phase 3, money you can trust.* Replace the environment variable with a dated fee policy table: rate, who pays, waiver, scope and effective dates. "Free at launch" is a 0% row, and the rate applied is stored on every invoice line (CFG-12).

*Later.* Drop the legacy flag (CFG-13). Add feature flags only when a second state needs a different setting (CFG-15).

**Acceptance criteria.**

1. Given a nurse, when they open the credential form, then it lists the documents the nursing profession requires and not the doctor's licence.
2. Given a pharmacist shift with no floor defined, when a facility tries to publish it, then publication is refused with a plain reason.
3. Given a compliance officer with `config.manage`, when they add a pay floor with an effective date, then it is used for shifts starting on or after that date and an audit row records who, why and the old and new values.
4. Given a name added to the sanctions list by compliance, when the next screening runs, then a matching practitioner is flagged.
5. Given an inactive profession, when the reference endpoint is called, then it is not returned and no form offers it.
6. Given a reference list that has not changed, when a browser asks again, then the server answers "not modified" and does not resend 774 LGAs.
7. Given the seed run on an empty database, when it finishes, then every active profession has at least one requirement, a day floor and a night floor, or the run fails.

---

## Module — · Platform and operations  *(repo folders `src/lib`, `src/worker`, `prisma`, `scripts`, `Dockerfile`, `docker-compose.yml`, `.github/workflows`; v2.9 §8 and §9.12 to §9.15)*

**Status:** Partly built · **Label:** CURRENT + IMPROVE · **Maturity for a Gombe pilot:** Not ready — the engine is well made, but the production image cannot run the worker, nothing deploys, nothing alerts, and no backup has been restored.

**Why it exists.** This is everything that is not a feature but decides whether features keep working: the way the code is laid out, the queue that carries events, the sweeps that run at night, where documents live, what stops a misconfigured server from starting, and how a release reaches a server. On a ward at 2 a.m. the practitioner only notices it when it fails. Without it, a lost event means a practitioner is never granted a role, a crashed server means nobody is told, and a bad deploy cannot be undone.

**Who uses it.**

| Actor | What they do here | Permission @ scope |
|---|---|---|
| Developer | Builds, tests, runs locally with Docker | repository access |
| Operator (to be named) | Deploys, watches queues and sweeps, restores backups | none in the product; infrastructure access |
| Administrator | Reads route timings on `/admin/performance` (per web process, since last restart) | `audit.read` @ PLATFORM (`src/app/api/v1/admin/performance/route.ts:12-20`) |
| Worker (system) | Delivers events and runs six sweeps | system |
| Monitoring (not built) | Would read health, queue depth and failures | none |

**How it works today.**

1. **One program, many rooms.** Medilink is a "modular monolith": one Next.js application that holds 19 module folders, each meant to own its own data and rules. Inside each are the same rooms: pure rules (`domain`), use-cases that touch the database (`application`), input checks (`presentation`), a permission list and a route table. The application has 110 API route files with 131 handlers under `/api/v1`, and 38 pages in three consoles. Modules should react to each other through events, not read each other's tables; dashboards and a few others break that rule on purpose and say so.
2. **The database.** One PostgreSQL, 61 tables in 20 named schemas, 5 migrations after a squash into a baseline, accessed through Prisma. Reporting and the queue claims are written as raw SQL.
3. **The event queue (outbox).** A change and its event are saved in one transaction. A separate worker process claims up to 20 due events at a time using a lock that lets several workers run safely, counts the attempt before it calls the handler, and retries a failure after 10 seconds, 20, 40 and so on up to 15 minutes. After eight attempts it is parked as DEAD_LETTER. An event with no handler is marked processed with a warning (`src/worker/processor.ts:38-150`; `src/lib/outbox.ts:32-38`).
4. **The sweeps.** The same worker loop, every 30 seconds, claims any due row in `audit.scheduled_jobs` and runs it. It sets the next run to now plus the interval, so missed windows are skipped, not replayed. There are six (Annex P3) (`src/worker/scheduler.ts:36-143`).
5. **Documents.** Files go straight from the browser to a private bucket (Tigris in production, MinIO locally) through a signed link; the database stores only the key. Download links are issued only after a permission check and last five minutes. Allowed types are PDF, JPEG, PNG, WebP and HEIC up to 10 MB. Four of the six storage purposes are in use (`src/lib/storage/tigris.ts:61-121`).
6. **Boot guardrails.** The server validates its settings when it starts and refuses to run in staging or production with console SMS, console payments, a secret published in the repository or an address that is not https (Annex P3) (`src/lib/env.ts:73-91`; `src/lib/env-rules.ts:42-80`).
7. **Docker image.** Built in stages; the runtime stage copies the compiled web app, dependencies, `package.json` and `prisma/`, runs as a non-root user, and checks `/api/v1/health` every 30 seconds. It has no `src/` folder, so the worker and the seed cannot start from it (`Dockerfile:32-44`).
8. **CI.** One GitHub workflow runs five jobs on every push and pull request: lint, types and unit tests; migrate up, reset and up again then seed; integration tests on a real PostgreSQL (audit coverage, outbox, scheduler and more); dependency audit and secret scan; and browser journeys against a built app with the worker running. There is no job that builds the image and none that deploys (`.github/workflows/ci.yml:22-187`).
9. **Environments.** `local` is Docker Compose: PostgreSQL 16, MinIO, a mail catcher the code never uses, the web dev server, the worker, and `e2e` and `demo` profiles that run a production build in the dev image (`docker-compose.yml`). `staging` and `production` exist only as allowed values of `APP_ENV`; no definition of either is in the repository.
10. **Backups.** `scripts/backup-drill.sh` dumps the local database, restores it into a scratch database, compares row counts and checks the migration state. It is run by hand and cites a runbook that does not exist (`scripts/backup-drill.sh:16`).
11. **Watching it.** Logs are one JSON line each on standard output with request and correlation ids. Every guarded response carries a `Server-Timing` header; requests slower than 500 ms are logged; per-route statistics sit in memory (`src/lib/http/timing.ts`). `/api/v1/health` checks only that the database answers.

| Outbox event | Can go to | Triggered by |
|---|---|---|
| PENDING | PROCESSING | A worker claims it; attempts goes up by one (`processor.ts:43-52`) |
| PROCESSING | PROCESSED | Handler succeeded, or no handler exists (`processor.ts:79-96`) |
| PROCESSING | FAILED | Handler threw and attempts < 8; next try pushed out (`processor.ts:98-112`) |
| FAILED | PROCESSING | Next try is due |
| PROCESSING | DEAD_LETTER | Handler threw on attempt 8 |
| PROCESSING | — | **If the worker dies mid-batch the row stays here for ever** |

| Scheduled job | Can go to | Triggered by |
|---|---|---|
| Enabled, due | Running | Claimed; next run set to now plus the interval (`scheduler.ts:36-55`) |
| Running | Succeeded or Failed | Handler returns or throws; `failure_count` counts failures in a row (`scheduler.ts:66-113`) |
| Enabled | Disabled | An operator sets one flag; the seed never turns it back on |

**Rules the system enforces.**

- A state change and its event commit together; a rolled-back change leaves no event (test `tests/integration/outbox.test.ts:131`).
- Two workers at once deliver each event once and run each sweep once (`outbox.test.ts:197`; `scheduler.test.ts:163`).
- Handlers must be safe to run twice, and the three that exist are (`src/worker/handlers.ts:20-51`).
- A sweep that fails is recorded and left until the next interval; one failing sweep does not stop the others (`scheduler.ts:123-143`).
- The integration suite refuses to run against any database whose name does not end in `_test`, and the performance seed only against `_perf` (`tests/integration/support/database-url.ts:11-50`; `scripts/seed-performance.ts:19`).
- Demo and reset scripts refuse to run unless `APP_ENV` is local (`scripts/support/demo.ts:27-34`).
- Documents are private, reached only by signed links, and a link is issued only after the caller is authorised (`src/lib/storage/tigris.ts:115-121`; ADR 0002).
- Dependencies and secrets are scanned on every push (`.github/workflows/ci.yml:109-129`).

**What is not there yet.**

| ID | Gap | Sev | Source | Evidence |
|---|---|---|---|---|
| PLT-01 | The production image has no `src/` folder, so `pnpm worker` and `pnpm db:seed` (which import from `src/`) cannot run from it. Nothing runs migrations when the image starts. There is no separate web, worker or migrate entrypoint. | P0 | REVIEW | `Dockerfile:32-44`; `package.json:24`; `prisma/seed.ts:14-15` |
| PLT-02 | Nothing deploys. There is no deploy workflow and no staging or production definition, and CI never builds the image, which is how PLT-01 went unnoticed. | P0 | REVIEW | `.github/workflows/ci.yml:22-187`; `docs/stage-3-gate-checklist.md:29-30` |
| PLT-03 | Stranded outbox events are never reclaimed. A worker killed after claiming leaves up to 20 events in PROCESSING for ever; the claim query only looks at PENDING and FAILED. | P0 | REVIEW | `src/worker/processor.ts:43-52` |
| PLT-04 | No alerts of any kind and no way to see trouble: no view, alert or replay for dead letters; no alert on a sweep's failure count; no worker heartbeat; no error tracker or uptime check; no alert on a severe incident. | P0 | REVIEW | `docs/scheduled-jobs.md:71-73`; `docs/stage-4-6-outbox-recovery.md:71-76`; `src/worker/index.ts:24-58` |
| PLT-05 | Backups are a local drill only: no schedule, no point-in-time recovery, no recovery targets, no restore ever proven, and the runbook the script cites does not exist. v2.9 §9.15 requires targets, encryption and a restore-test frequency. | P0 | REVIEW | `scripts/backup-drill.sh:16` |
| PLT-06 | The outbox and the sweeps run one after the other in the same loop. A slow nightly sweep delays the event that grants a new practitioner their role, which the sign-up screen waits only eight seconds for. | P1 | REVIEW | `src/worker/index.ts:32-40`; `src/app/(auth)/register/page.tsx:170` |
| PLT-07 | No job removes processed events, expired sessions, used codes, login attempts or old messages; all grow for ever. | P1 | REVIEW | `src/worker/jobs.ts:31-68` |
| PLT-08 | `/health` checks only the database and is also the container health check, so a database blip restarts the web tier. There is no liveness and readiness split and no worker health. | P1 | REVIEW | `src/app/api/v1/health/route.ts:14-27`; `Dockerfile:42-43` |
| PLT-09 | Migrations run on start only in the development compose file. There is no release-time migration step, and "migrate down" in CI is a database reset: Prisma Migrate has no down scripts, which ADR 0004 says it has. | P1 | REVIEW | `docker-compose.yml:67`; `.github/workflows/ci.yml:71`; `docs/adr/0004-prisma-data-access.md:16` |
| PLT-10 | No evidence for the v2.9 target of 10,000 concurrent users or sub-2-second writes. The load test makes 40 read requests four at a time and has no write probe; the pool is Prisma's default with no connection pooler. | P1 | V2.9 | `scripts/load-test.ts:24-28,46-61`; `src/lib/db.ts:12-16` |
| PLT-11 | The audit-coverage test and the request timer use Prisma's `$use` hook, which Prisma 6 removes (resolved version today: 5.22.0). A future upgrade would silently end both. | P2 | REVIEW | `src/lib/db.ts:28`; `src/lib/audit-coverage.ts:191`; `pnpm-lock.yaml:31` |
| PLT-12 | Uploads are trusted by declared type and size only: no content check, no malware scan, no stored checksum (the column is never written), no function to delete an object, and two of six storage purposes are unused. | P1 | REVIEW | `src/lib/storage/tigris.ts:61-87,124-126`; `prisma/schema.prisma:441-456` |
| PLT-13 | No idempotency key on any API route, no inbound webhook route or signature check, and events carry no version. The outbox has an idempotency column that no publisher sets. | P1 | V2.9 | `src/lib/outbox.ts:14-27`; `src/lib/events.ts:5-26`; `src/lib/env.ts:46` |
| PLT-14 | Observability for the pilot is thin: route statistics live in one process's memory and reset on restart; nothing measures message delivery, queue failures, provider errors or suspicious sign-ins. | P1 | V2.9 | `src/lib/http/timing.ts:18-22` |
| PLT-15 | CI never exercises the production guardrails or the image: the browser journeys run with `APP_ENV: local`, and there is no image smoke test. | P2 | NEW | `.github/workflows/ci.yml:138` |
| PLT-16 | Modules read each other's tables, against the written rule: dashboards, the confirmation handler (facility and assignment), matching (facility), the erasure assessment (billing). | P2 | REVIEW | `src/modules/audit-compliance/application/platform-summary.ts:4-22`; `src/modules/notifications/application/handlers.ts:43-52` |
| PLT-17 | Several stage documents are stale (for example step-up "not enforced", four exempt audit tables, README migration command). A new developer will be misled. | P2 | REVIEW | `docs/stage-4-2-auth.md:91-93`; `docs/stage-4-5-audit-coverage.md:37-46`; `README.md` quick start |
| PLT-18 | The production image carries every development dependency (full install is copied across). | P2 | NEW | `Dockerfile:12-13,37` |
| PLT-19 | No hosting decision or data-residency note: the repository names the object store but not where the database or the app runs, and cross-border transfer is unaddressed. [Counsel] | P1 | REVIEW | `docs/adr/0002-tigris-object-storage.md`; v2.9 §10.2 |
| PLT-20 | One secret, `SESSION_SECRET`, keys the one-time-code digests and the stored NIN hash. Rotating it breaks duplicate-identity detection, and nothing records a key version. | P1 | NEW | `src/modules/auth/domain/otp.ts:39-46`; `prisma/schema.prisma:663-671` |
| PLT-21 | A sweep has no per-row protection: one failing row throws, ends the whole sweep, and leaves later rows until the next interval. | P1 | REVIEW | `src/modules/credentials/application/expiry.ts:34-62`; `src/worker/scheduler.ts:66-113` |

**Recommended change (v3).**

*Phase 0, make it safe.* In this order: (1) fix the image so one build contains web, worker and a one-off migrate-and-seed command, and add a CI job that builds it and boots it with production-like settings (PLT-01, PLT-15). (2) Add a deploy workflow to a staging environment with its own database and provider sandboxes, then to production by image tag (PLT-02). (3) Reclaim stranded events: a row left PROCESSING longer than a set time goes back to FAILED with its attempt counted (PLT-03). (4) Add alerts to a phone someone carries: dead letters above zero, a sweep failing twice, health failing, SMS failure rate, error rate, plus an error tracker and an uptime check (PLT-04). (5) Back up with a managed PostgreSQL that has point-in-time recovery, adopt targets (proposed in the review: lose at most 15 minutes, back within 4 hours [proposed, not measured]), prove them with a timed restore on staging, and write the runbook (PLT-05). (6) Run the staging soak the review proposes: a seeded 100-facility dataset (`scripts/seed-performance.ts` exists), the load budget, and kill the worker mid-event to show nothing is lost.

*Phase 1, Gombe pilot.* Give the outbox and the sweeps their own loops or processes (PLT-06). Add purge jobs (PLT-07). Split health into liveness and readiness and add a worker heartbeat (PLT-08). Run migrations as a single release step (PLT-09). Isolate failures per row inside each sweep (PLT-21). Version the secret that keys digests (PLT-20). Add content checks and a delete function for uploads (PLT-12). Choose hosting by probing two or three candidates from a Gombe 4G connection and settle residency with counsel (PLT-19).

*Phase 2 and later.* Add a connection pooler once there are three or more app processes (PLT-10). Add idempotency keys and event versions before the payment provider goes live (PLT-13). Plan the Prisma upgrade (PLT-11). Remove cross-module table reads where modules grow (PLT-16). Refresh the stage documents (PLT-17).

**Acceptance criteria.**

1. Given a freshly built production image, when it is started as the worker, then it processes an event from the queue; when started as the migrate command, then it applies migrations and the seed.
2. Given an event left PROCESSING by a killed worker, when the timeout passes, then another worker processes it exactly once.
3. Given a dead-lettered event, when it appears, then an operator is alerted within five minutes and can see and replay it.
4. Given the database is restored from last night's backup to staging, when timed, then it meets the agreed recovery target and the row-count check passes.
5. Given a push to the main branch, when CI passes, then the image reaches staging without manual steps.
6. Given a 20-second sweep running, when a new practitioner signs up, then their role is granted within the sign-up screen's wait.
7. Given a sweep with one bad row, when it runs, then the other rows are processed and the failure is recorded.
8. Given staging started with `SMS_PROVIDER=console` or a published secret, when it boots, then it refuses and names every problem at once.

---

## Console A · Practitioner  *(repo folder `src/app/practitioner`; v2.9 front end for Modules 2, 3, 5, 7, 9, 12, 13, 17; Modules 27 and 28 govern its delivery)*

**Status:** Built · **Label:** CURRENT + NEW EXPANSION · **Maturity for a Gombe pilot:** Ready after P0 fixes — the journey from registration to earnings works on a phone-width screen, but an offer arrives silently, the offer card hides the ward, the notes and the cancellation terms, and a nurse is asked for no document.

**Why it exists.** A nurse in Gombe wants to see what they are being offered, say yes or no, turn up, prove they were there, get their hours approved and be paid, all from a phone in a corridor. A practitioner who cannot tell why they are not being offered work stops trusting the product. This console is the practitioner's whole view of Medilink. Without it every step is a phone call to operations.

**Who uses it.**

| Actor | What they do here | Permission @ scope |
|---|---|---|
| Practitioner | Register, build a profile, submit for approval, set availability, answer offers, check in, submit timesheets, dispute, read earnings, manage privacy | `practitioner.profile.read/write`, `availability.read/write`, `credential.submit`, `service_request.read`, `attendance.record`, `timesheet.submit`, `invoice.read`, `dispute.manage`, `suggestion.submit` @ SELF (`src/lib/authz/permissions.ts:116-122`) |
| Any signed-in user who opens `/practitioner` | Sees the shell; every API call is refused unless they hold the grant | permissions are checked server side; the menu is a courtesy (`src/lib/ui/session.tsx:19-21`) |

The shell is shared (`src/components/app/console-shell.tsx`): fixed sidebar from the `lg` breakpoint, an off-canvas drawer below it, a top bar with a theme toggle and a user menu ("Send a suggestion", "Sign out"). There is no notification bell, inbox or help link (`console-shell.tsx:264-295`).

**How it works today.**

Page inventory (menu from `console-layout.tsx:27-70`):

| Route | Purpose | Who sees it | Main actions |
|---|---|---|---|
| `/practitioner` | Dashboard from one request (`/api/v1/dashboard/practitioner`): setup card, "application sent back" notice, eligibility card, offers waiting, next shift | menu item without permission | Follow a setup link; read every eligibility blocker, split "Yours to do" (with links) and "Waiting on Medilink" (`page.tsx:218-262`) |
| `/practitioner/offers` | Open offers with profession, facility name, urgency, shift type, start, end, hourly rate, answer-by; answered history (10 recent) | `service_request.read` | **Accept**; **Decline** with a required reason that reaches the platform without the name (`offers/page.tsx:104,172-200`) |
| `/practitioner/shifts` | Tabs Confirmed, Completed, No show, Cancelled; facility, type, rate | `service_request.read` | **Check in/out** with the six-digit code from the ward; send an **excusal** explanation after a shift that ended with no check-in (`shifts/check-in-panel.tsx`, `shifts/excusal-panel.tsx`) |
| `/practitioner/timesheets` | Worked, break, billable, amount at base rate, night/overtime/holiday minutes, earlier versions | `timesheet.submit` | **Submit**; **Dispute this** after a decision (category and 20+ characters) (`timesheets/page.tsx:80,269-290`) |
| `/practitioner/earnings` | Owed (ledger balance), on its way, paid; list of payouts with reference | `invoice.read` | Read only |
| `/practitioner/profile` | A four-step wizard while setup is needed, then four tabs: **Profile** (photo, profession, specialty, years, state, LGA, travel, bio), **Credentials** (submit by type, resupply what a reviewer asked for), **Availability** (weekly slots, time-away blocks), **Privacy** (consents, agreements, export, erasure check, my requests) | `practitioner.profile.read` | Save; submit credentials; add or remove weekly slots; add time-away; withdraw a consent; download my data (`profile/page.tsx:23-28`) |
| `/practitioner/availability`, `/credentials`, `/privacy` | Redirect into the matching profile tab | any | none |

The journey, step by step. **NO SCREEN** marks a step the product needs and does not have.

1. **Register** at `/register`: name, phone, optional email; a six-digit code (10 minutes, resend, change number); a password of 10 or more characters typed twice; and a tick-box agreeing that verified credentials and profile may be shown to hospitals. The button stays off until it is ticked (`(auth)/register/page.tsx:32,336,413-435`). The form then signs in and waits up to eight seconds for the practitioner grant that arrives through the background worker (`:170`). The code can be delivered only by the local console adapter (see UXW-09).
2. **Wizard** (`profile/setup-wizard.tsx`): details, when you can work, documents, review. Everything is saved as you go. The documents step lists what the profession requires; for every profession except doctor it says "No documents are required for your profession right now" (`:399-401`).
3. **Submit for approval.** The button is off until all three steps are done. After it, the dashboard says "Waiting for approval" and officers see the person under "Waiting for approval" in Console C. A refused required document sends the application back with the reviewer's words (`profile/returned-notice.tsx`). The practitioner then replaces the document and submits again.
4. **Availability.** Weekly slots (day, start, end) can be added and removed; time-away blocks can be added with a reason. **NO SCREEN:** remove a block, add a one-off slot, state a rate, publish availability to facilities (`profile/availability-section.tsx:94,276-297`).
5. **Offers.** An offer appears in `/practitioner/offers` only when the practitioner opens the app. **NO SCREEN and no message** to say one exists (`src/worker/handlers.ts:20` is the only handler, and it covers confirmations only). The card shows no address, ward, notes, cancellation terms, premiums or total pay (see UXP-02).
6. **Accept.** The page and the toast both say the facility still has to confirm. **NO SCREEN:** browse open shifts, apply, counter on price.
7. **Shift.** Once the facility confirms, the shift appears under Confirmed. **NO SCREEN:** withdraw from a confirmed shift before it starts.
8. **Check in.** The box appears three hours before the start (`shifts/check-in-panel.tsx:33`). The ward reads out a six-digit code, valid five minutes and five attempts. The same box accepts a pasted QR payload; there is no camera scanner (no scanner library in `package.json`).
9. **Timesheet.** It is worked out when the practitioner checks out. They submit it; the facility approves, rejects with a reason, or corrects it. After a decision the practitioner may dispute.
10. **Earnings.** Credited when the shift is invoiced, not when it is approved, and the page says so (`earnings/page.tsx:87-93`). **NO SCREEN:** per-shift earnings, a payout bank account, a statement.
11. **Privacy.** Consents can be withdrawn, agreements accepted, data exported, an erasure assessment read and requested (`profile/privacy-section.tsx:97-146`). Erasure keeps the audit trail and the ledger and says so (`docs/interfaces.md:107-110`).

State tables. The application state is derived and is described in Module 2; this table lists what the practitioner can do in each state a screen shows.

| State shown | Can go to | Triggered by |
|---|---|---|
| Setup DRAFT | READY | Profile, one availability slot and every required document are in |
| READY | WAITING | Practitioner presses "Submit for approval" |
| WAITING | APPROVED | An officer's confirmations make the eligibility rule return no blockers |
| WAITING | CHANGES_NEEDED | An officer rejects a required document; the submitted time is cleared (`src/modules/practitioners/application/application-review.ts:117-149`) |
| Offer INVITED | ACCEPTED, DECLINED | Practitioner's answer; a lapsed offer shows a warning and hides both buttons (`offers/page.tsx:155-160`) |
| Offer ACCEPTED | shift CONFIRMED | Facility confirms; otherwise the offer is withdrawn when the shift starts (`src/modules/service-requests/application/expiry.ts:26-48`) |
| Shift CONFIRMED | COMPLETED, NO_SHOW, CANCELLED | Timesheet approval; the hourly unhonoured sweep; a facility or officer cancellation |
| Timesheet CHECKED_OUT or MANUALLY_CORRECTED | SUBMITTED | Practitioner submits (`timesheets/page.tsx:176-178`) |
| Timesheet APPROVED or REJECTED | DISPUTED | Practitioner opens a dispute (`:179`) |

**Rules the system enforces.**

- A decline needs a reason, in the page and on the server (`offers/page.tsx:196`; `src/modules/matching/presentation/schemas.ts:42-45`). The reason goes to the suggestion log without the person's name.
- The submit-for-approval button is off until profile, availability and documents are complete; the server refuses an incomplete application too (Module 2).
- A credential type already pending, queried or verified cannot be submitted again; the list shows it ticked and disabled (`profile/credentials-section.tsx:42`).
- A NIN must be 11 digits; documents must be PDF, JPEG, PNG, WebP or HEIC and at most 10 MB (`profile/evidence-fields.tsx:94-98`; `src/components/app/document-upload.tsx:11-12`). The file goes straight to storage on a signed URL and never passes through the app.
- A dispute needs a category and at least 20 characters; an excusal needs at least 10 and is offered only after a shift ended with no check-in (`timesheets/page.tsx:80`; `shifts/excusal-panel.tsx:23`).
- Every time on screen is shown in West Africa Time (`src/components/app/format.ts`).
- The photo is stored as an object key; a failed fetch of any dashboard section shows "Could not load", never a zero (`page.tsx:290-292,318-319`).

**The review said X; at HEAD it is fixed.** The review said there is no inbox route and that practitioners are not told of a rejection. A rejection now shows a red "application sent back" card with the reviewer's note wherever the practitioner looks (`profile/returned-notice.tsx`), though no message is sent. The wizard and the submit-for-approval step, which the review rates as good, are covered by end-to-end tests (`tests/e2e/onboarding.spec.ts:168`).

**What is not there yet.**

| ID | Gap | Sev | Source | Evidence |
|---|---|---|---|---|
| UXP-01 | Nobody is told. No message is sent for an offer, a withdrawal, a decision on a document, a timesheet decision, an invoice or a payout, and there is no in-app inbox or bell. A practitioner learns of an offer only by opening the app. | P0 | REVIEW | `src/worker/handlers.ts:20-44`; `src/components/app/console-shell.tsx:264-295` |
| UXP-02 | The offer card and the My shifts card show facility name, rate, urgency and times only. The facility is told its "Notes for the practitioner" (ward, who to report to) and "Cancellation terms" are for the practitioner, but neither the notes, the terms, the address, the premiums nor the total pay are returned or shown. A practitioner accepts a shift without knowing where to go. | P0 | NEW | `facility/shifts/new-shift-dialog.tsx:236-260`; `src/modules/matching/application/assignment.ts:793-802`; `offers/page.tsx:147-153` |
| UXP-03 | A nurse, pharmacist, laboratory scientist or radiographer is shown "No documents are required for your profession right now" and can submit for approval with no licence evidence beyond what an officer records by hand. Only doctors have seeded requirements. | P0 | REVIEW | `profile/setup-wizard.tsx:399-401`; `prisma/seed.ts:127-150` |
| UXP-04 | The engagement agreement is an optional line inside the Privacy tab. Nothing asks a practitioner to accept it before they accept a shift, and the dashboard never mentions an outstanding agreement. | P0 | REVIEW | `profile/privacy-section.tsx:97-125`; `offers/page.tsx:184-193` |
| UXP-05 | One-way marketplace. A practitioner cannot browse open shifts, apply, publish a priced availability listing, or counter an offer. The spec's workflow step 3 says practitioners "apply or accept". | P1 | V2.9 | `console-layout.tsx:27-70`; `profile/availability-section.tsx:94` |
| UXP-06 | A time-away block can be added but not removed, and a wrong one silently stops offers. Only weekly slots can be created, although the domain supports one-off slots. No "all day" shortcut. | P1 | NEW | `profile/availability-section.tsx:94,276-297`; `src/modules/availability/domain/availability.ts:26` |
| UXP-07 | The profile has no level, cadre or skills; years of experience is a self-declared number and there is one optional specialty. | P1 | V3 | `profile/profile-form.tsx:56-69` |
| UXP-08 | A confirmed shift cannot be withdrawn from. The only exit is an excusal sent after the shift ended, and a platform officer, not the facility, decides it. The spec says the facility decides. | P1 | V2.9 | `shifts/excusal-panel.tsx:84-123`; `src/app/api/v1/excusals/[id]/decide/route.ts:19-21` |
| UXP-09 | After a dispute is opened the practitioner has no screen showing its status, outcome notes or evidence, and cannot attach evidence or withdraw it. | P1 | NEW | `timesheets/page.tsx:115-130`; `src/app/api/v1/disputes/[id]/withdraw/route.ts` (no UI caller) |
| UXP-10 | Earnings shows three totals and a payout list only. No per-shift breakdown, no statement, no payout bank-account screen (no bank model), and credit arrives at invoicing. | P1 | REVIEW | `earnings/page.tsx:58-135` |
| UXP-11 | "Consent to be shown to hospitals" is a condition of creating the account (button disabled until ticked) while the page says it can be withdrawn. The v3 listing needs its own opt-in. Whether consent as a condition of sign-up is acceptable is for counsel. | P1 | V3 | `(auth)/register/page.tsx:413-435` |
| UXP-12 | The three-hour check-in window is enforced by the screen. Whether the server enforces it was not verified here. A QR payload must be pasted; there is no scanner although camera access is permitted in the response headers. | P2 | REVIEW | `shifts/check-in-panel.tsx:33,68-70`; `next.config.mjs:32` |
| UXP-13 | The lapsed-offer warning says "The sweep will withdraw it shortly", but the sweep withdraws offers only when the shift starts. | P2 | NEW | `offers/page.tsx:159`; `src/modules/service-requests/application/expiry.ts:26-48` |

**Recommended change (v3).**

*Phase 0.* Send an SMS for offer received, confirmation, withdrawal and each document decision, once a deliverable provider exists, and add a simple in-app inbox with a bell (UXP-01, with the Notifications chapter). Return and show address, ward notes, cancellation terms, premiums and total pay on the offer card and the shift card (UXP-02). Seed requirements for the other four professions before any nurse registers (UXP-03). Put the engagement agreement, with a link to the privacy notice, on the first screen after sign-up and before the first accept (UXP-04, with the Audit chapter).

*Phase 1.* Add level, registration category and skills to the profile and the wizard (UXP-07), plus "all day" and "every weekday" shortcuts, block removal and one-off slots (UXP-06).

*Phase 2.* Build the shift board with filters (profession, level, place, date, rate), applications, and a priced availability listing behind its own consent (UXP-05, UXP-11). The offer card becomes a proposal with at most two counter rounds, each checked against the rate floor. Add a proper withdrawal with notice rules, decided by the booking terms rather than by an officer (UXP-08). Show a dispute's progress and let the practitioner attach evidence (UXP-09).

*Phase 3 and 4.* Earnings statements and a verified bank-account screen before real payouts (UXP-10). Reviews and a reliability record the practitioner can read. Offline-tolerant check-in (see UXA-09).

**Acceptance criteria.**

1. Given a facility confirms a practitioner, when the confirmation is saved, then the practitioner receives a message within one minute with the facility name, date, start time in West Africa Time and where to report.
2. Given an offer, when the practitioner opens it, then it shows the address, ward notes, cancellation terms, hourly rate, any premium that applies and the total pay for the shift.
3. Given a nurse who has registered, when they open "Your documents", then the list shows the documents nursing requires and the button to submit stays off until each is supplied.
4. Given a practitioner who has not accepted the engagement agreement, when they press Accept on an offer, then they are shown the agreement first and the accept is refused until it is recorded.
5. Given a time-away block entered by mistake, when the practitioner removes it, then the next match run treats them as available for those dates.
6. Given a practitioner who asks to withdraw from a confirmed shift 48 hours ahead, when they send the request, then the facility is told, the shift reopens, and the terms agreed on the booking decide whether any consequence applies.
7. Given a dispute opened on a timesheet, when an officer decides it, then the practitioner sees the outcome and the officer's notes on the Timesheets page and receives a message.
8. Given a phone-width screen, when each practitioner page is opened, then nothing scrolls sideways (kept from `tests/e2e/mobile.spec.ts`).

---

## Console B · Facility  *(repo folder `src/app/facility`; v2.9 front end for Modules 4, 6, 7, 9, 10, 11, 14; v2.9 roles Facility Owner, Administrator, Scheduler, Finance Officer)*

**Status:** Built · **Label:** CURRENT + NEW EXPANSION · **Maturity for a Gombe pilot:** Ready after P0 fixes — a verified hospital can publish, staff, track attendance and approve hours today, but a Gombe government hospital or PHC cannot register without a CAC number, no one can upload a licence or answer a rejection, and the owner learns of an acceptance only by staring at the page.

**Why it exists.** A ward manager in Gombe has a night shift with no nurse and today fills it by phone and WhatsApp. They need to say what they need, see who could do it and why, offer it, know who turned up, and approve the hours that will be billed. Without this console the facility side of the marketplace is a series of phone calls to Medilink operations.

**Who uses it.**

| Actor | What they do here | Permission @ scope |
|---|---|---|
| Facility owner (the MD) | Everything an administrator does, plus staff and (in principle) disputes | the administrator bundle plus `role.grant` and `dispute.manage` @ FACILITY (`src/lib/authz/permissions.ts:199`) |
| Facility administrator | Publish and cancel shifts, find and offer, confirm, issue attendance codes, approve timesheets, read invoices, set rate cards, report incidents | `service_request.read/publish`, `assignment.confirm/cancel`, `attendance.record`, `timesheet.approve`, `invoice.read`, `facility.read/write`, `incident.report`, `payout.manage` @ FACILITY (`:140-147`) |
| New staff account with no grant | Sees a notice that the account is not attached and a "Register a facility" button (`console-layout.tsx:103-118`) | none |
| Person at two hospitals | Chooses which hospital the console acts for (`facility-switcher.tsx:47`) | one grant per facility |

The v2.9 spec names four facility roles; the code has two. A scheduler and a finance officer no longer exist as separate roles (see QAL-09).

**How it works today.**

Page inventory (menu from `console-layout.tsx:30-86`):

| Route | Purpose | Who sees it | Main actions |
|---|---|---|---|
| `/facility` | Status banner (waiting, rejected with the officer's note, suspended); terms to read and accept; three tiles; charts of staffing against need by week and invoiced against paid by month | any facility user | Click through to the queue behind a tile; read and accept terms (`page.tsx:159-185`) |
| `/facility/register` | Register the hospital: name, type, CAC number, state, LGA, address, phone, optional email, optional licence number | a signed-in account with no facility; outside the guard, not in the menu | Register (`register/page.tsx:79-85`) |
| `/facility/shifts` | Table with tabs Published, Filled, Draft, Cancelled, Expired; filters; 20 per page | `service_request.read` | **Publish a shift** (dialog); publish a stuck draft; cancel with a reason (`shifts/page.tsx:74,188`) |
| `/facility/shifts/[id]` | Find candidates (ranked, with factor bars and reasons, plus excluded and why); select and offer; list of offers refreshed every 15 seconds; confirm an accepted offer; confirmed list | `service_request.read`; controls need `assignment.confirm` | Find, Offer, Confirm (`shifts/[id]/page.tsx:151,313-320,395-402,448-453`) |
| `/facility/roster` | Confirmed, Completed, No show, Cancelled; search; date range | `attendance.record` | **Code to check in / out** (read aloud; shown once); **Record by hand** with a reason (`roster/attendance-panel.tsx`) |
| `/facility/timesheets` | Awaiting decision and Approved; practitioner and date filters; 50 per page | `timesheet.approve` | **Approve**; **Reject** (reason needed); **Correct the hours** (reason; earlier figures kept) (`timesheets/page.tsx:85,492`) |
| `/facility/invoices` | Issued invoices shift by shift; Outstanding and Paid totals from the server | `invoice.read` | Read only (`invoices/page.tsx:73`) |
| `/facility/rates` | Rate cards with night, public-holiday, overtime and on-call multipliers | `facility.write` | New rate card; edit the active one |
| `/facility/incidents` | The hospital's own reports with filters; report dialog; closed outcome visible | `incident.report` | Report; read; nothing can be edited or taken back |
| `/facility/staff` | Who can act for the hospital | `role.grant` (owner) | Find a colleague by phone, grant `facility_administrator` or `facility_owner`, revoke with a reason; each call needs the password typed again (`src/components/app/staff-manager.tsx:122`) |

The journey. **NO SCREEN** marks a step the product needs and does not have.

1. **Register.** The owner signs up at `/register?as=facility` (the same phone and code flow, without the practitioner consent box), then fills `/facility/register`. The account holds `facility_owner` at once while the facility is `PENDING`. The CAC number is required by the form, the API and the database (`register/page.tsx:79-85`; `src/modules/facilities/presentation/schemas.ts:91`; `prisma/schema.prisma:567`).
2. **Verification.** The dashboard says "Waiting for verification" and the owner may set up rates and staff meanwhile. An officer verifies or rejects in Console C. **NO SCREEN:** upload a licence or CAC certificate, edit the facility's details, see a facility profile, reply to a rejection. The registration form takes a licence *number* only; the officer can only *view* a licence file if one exists (`admin/facilities/facility-detail.tsx:205`).
3. **Staff and roles.** Only the owner has the Staff page. A colleague first creates a staff account at `/register?as=staff`; the owner finds them by phone number and grants a role. Terms published by Medilink appear on the dashboard and must be opened before "I agree" (`facility-agreements.tsx`).
4. **Publish a request.** "Publish a shift" creates a draft and publishes it in one step: profession, specialty, start, end, day or night, urgency, headcount, hourly rate, cancellation terms, notes. Once published its terms cannot change; cancel and publish another. **NO SCREEN:** edit, clone or repeat a shift, a calendar, a rota template.
5. **Find, offer, confirm.** "Find candidates" runs the ranking; the facility sees each person's score, four factor bars with detail text, and a list of exclusions with reasons. It selects people and presses Offer; nothing is sent automatically. It confirms accepted offers. **No message** reaches the practitioner on offer, and none reaches the facility when someone accepts.
6. **Roster.** Confirmed practitioners are listed with their name and phone number. **NO SCREEN:** release or cancel a confirmed practitioner, mark someone absent (the hourly sweep flags it and an officer decides).
7. **Attendance code.** The ward presses "Code to check in", reads six digits aloud, the practitioner types them. The code lives five minutes with five attempts and the next one supersedes it. When the network failed, "Record by hand" takes times, break and a reason of 10 or more characters and marks the record `MANUALLY_CORRECTED`.
8. **Approve the timesheet.** The card shows hours and an amount "at the base rate". Approve completes the assignment; reject needs a reason; correct keeps the earlier figures as a revision.
9. **Invoices and rates.** The hospital reads what it has been billed. **NO SCREEN:** pay or fund anything, download or print an invoice, question a line.
10. **Incident.** The ward reports an incident with severity and category; naming a practitioner is optional. A closed report shows its outcome.

State tables for what the console shows (the modules own the rules):

| Facility status | Can go to | Triggered by |
|---|---|---|
| PENDING | VERIFIED, REJECTED | Officer decision in Console C |
| VERIFIED | PENDING | Changing the licence of a verified facility sends it back (`admin/facilities/page.tsx:96`) |
| REJECTED | — (terminal) | No route back except changing the licence (`docs/stage-5-10-facility-verification.md:117`) |
| SUSPENDED | — | Set by no code path (same doc, `:112-113`; not re-verified) |

| Shift request | Can go to | Triggered by |
|---|---|---|
| DRAFT | PUBLISHED, CANCELLED | Publish (needs a verified facility and a licence not lapsed); cancel |
| PUBLISHED | FILLED, CANCELLED, EXPIRED | Confirmed count reaches headcount; cancel with reason; the hourly sweep once the shift has started unfilled (`src/modules/service-requests/application/expiry.ts:26-48`) |

| Attendance and timesheet | Can go to | Triggered by |
|---|---|---|
| NOT_STARTED, CHECK_IN_PENDING | CHECKED_IN | Practitioner presents the facility's code |
| CHECKED_IN | CHECKED_OUT | Code to check out |
| CHECKED_OUT, MANUALLY_CORRECTED | SUBMITTED | Practitioner submits |
| SUBMITTED | APPROVED, REJECTED | Facility decision; approval also completes the assignment |
| REJECTED | SUBMITTED | Facility corrects, practitioner resubmits |

**Rules the system enforces.**

- The console always acts for one hospital whose id comes from the user's grants, not from a picker; switching hospital resets every cached answer except the session (`facility-switcher.tsx:27-35,60`).
- A published shift's terms cannot be changed (`shifts/page.tsx:188`).
- Publishing is refused unless the facility is verified and its licence has not lapsed; a draft left behind by a refused publish can be retried (`shifts/new-shift-dialog.tsx:88-91`).
- Nothing is offered until a person presses Offer; ranking is a computation, not a decision (`shifts/[id]/page.tsx:325-329,405`).
- A confirmation that fills the last place withdraws everyone else's offer (`:187`).
- Rejecting a timesheet needs a reason of at least 10 characters; manual attendance needs one too (`timesheets/page.tsx:85`; `roster/attendance-panel.tsx`).
- A check-in code is issued by the facility, shown once, never stored, and expires in five minutes (`roster/attendance-panel.tsx`, dialog text).
- Staff changes need the password typed again, and the Staff page is hidden from anyone without `role.grant` (`src/components/app/staff-manager.tsx` header; `console-layout.tsx:83`).
- Draft invoices are never shown to the facility (`invoices/page.tsx:73`, `billedOnly=true`).
- A failed dashboard request shows "Could not load", never zero (`page.tsx:87-91`).

**The docs said X; at HEAD it is fixed.** `docs/interfaces.md:134-139` says a facility has no invoices page and that a person at two hospitals is shown only the first. Both exist (`facility-switcher.tsx`; `invoices/page.tsx`) and are covered by end-to-end tests (`tests/e2e/multisite.spec.ts`, `tests/e2e/money.spec.ts:50`). `docs/stage-5-10-facility-verification.md:23,104` says there is no self-service facility signup; the `/facility/register` form and the `/register?as=facility` path exist (QAL-07).

**What is not there yet.**

| ID | Gap | Sev | Source | Evidence |
|---|---|---|---|---|
| UXF-01 | No facility profile page. No one can upload a licence or CAC certificate, edit the address, contact or licence number, or see what compliance holds. The edit and upload routes exist and no screen calls them. | P0 | REVIEW | `src/app/api/v1/facilities/[id]/route.ts:30`; `src/app/api/v1/facilities/[id]/licence-upload-url/route.ts`; `register/page.tsx:210-224` |
| UXF-02 | CAC registration is mandatory in the form, the API and the database column. Government hospitals and primary health centres, most of Gombe, have none, and there is no other reference a facility can give. | P0 | REVIEW | `register/page.tsx:79-85`; `src/modules/facilities/presentation/schemas.ts:91`; `prisma/schema.prisma:567` |
| UXF-03 | A rejected facility is told "Reply to Medilink with the corrected documents to be reviewed again", but no reply or upload path exists and REJECTED is terminal. | P0 | REVIEW | `page.tsx:168-176`; `docs/stage-5-10-facility-verification.md:117` |
| UXF-04 | Practitioner names and phone numbers are shown permanently on the roster, the timesheets and the shift's confirmed list, and the match response carries a phone number for every ranked and excluded candidate. This invites bypass and exposes personal data. | P0 | REVIEW | `shifts/[id]/page.tsx:52,59,262-264`; `roster/page.tsx:245`; `timesheets/page.tsx:404` |
| UXF-05 | An acceptance is visible only on the open shift page (polled every 15 seconds). No message or inbox entry tells the facility someone accepted, declined, submitted hours, or failed to arrive. | P0 | REVIEW | `shifts/[id]/page.tsx:151`; `src/worker/handlers.ts:20-44` |
| UXF-06 | The shift form has no level or match rule, shift type (day or night) is chosen by hand and not derived from the times, and the rate floor is a single figure per profession. | P0 | V3 | `shifts/new-shift-dialog.tsx:186-197` |
| UXF-07 | The Approve button states the base-rate amount, but the invoice later adds rate-card premiums, so a facility approves a figure it will not be billed. There is no approval deadline, reminder or auto-approval, so one inattentive facility stalls a practitioner's pay. | P0 | REVIEW | `timesheets/page.tsx:492` and the comment above the premium line |
| UXF-08 | "Publish a shift" is offered to a facility that is not verified. It creates a draft and fails afterwards with a toast. | P1 | NEW | `shifts/page.tsx:109,189`; `shifts/new-shift-dialog.tsx:72-100` |
| UXF-09 | The rate field is pre-filled with ₦5,000 (500,000 kobo) for every profession, which anchors facilities low. No market guidance is shown. | P1 | REVIEW | `shifts/new-shift-dialog.tsx:55` |
| UXF-10 | No edit, clone or repeat of a shift, no calendar, no rota templates, no recurring shifts; every Saturday night is a new request. | P1 | REVIEW | `shifts/page.tsx:188` |
| UXF-11 | No screen to release or cancel a confirmed practitioner; the cancel route is called by no screen. | P1 | REVIEW | `src/app/api/v1/assignments/[id]/cancel/route.ts` (no UI caller) |
| UXF-12 | The owner holds `dispute.manage` but there is no facility dispute screen, so a facility cannot answer or open a dispute. | P1 | REVIEW | `src/lib/authz/permissions.ts:199`; `console-layout.tsx:30-86` |
| UXF-13 | Invoices are read-only. No funding or authorise-before-shift step (spec 9.4.2), no pay control, no download, and no finance role to hold them. | P1 | V2.9 | `invoices/page.tsx:73`; `admin/invoices/page.tsx:308-309` |
| UXF-14 | Staff are added by looking up any account by phone number rather than by an invitation the invitee accepts, and only two roles can be granted (no scheduler or finance split). | P1 | REVIEW | `src/components/app/staff-manager.tsx:122`; `staff/page.tsx:12-24` |
| UXF-15 | The reason text beside each ranking factor is clipped to seven rem, so the hand review the spec requires for the first fifty engagements cannot read it on screen. | P1 | NEW | `shifts/[id]/page.tsx:381` |
| UXF-16 | No onboarding checklist. After registering, the owner lands on a dashboard with a banner; nothing lists "add licence, add staff, set rates, publish". | P1 | REVIEW | `page.tsx:159-185` |

**Recommended change (v3).**

*Phase 0.* Build a facility profile page with licence and CAC upload, an edit form and a visible verification status (UXF-01). Accept a ministry or registration reference where there is no CAC, with an officer's note recording what was checked (UXF-02, with the Facilities chapter). Give a rejected facility a "fix and resubmit" path (UXF-03). Show initials and role, not a name and a phone number, until a booking exists; reveal contact details only inside a window around the shift (UXF-04, with Matching). Send the facility a message when an offer is answered, when hours are submitted and when a confirmed practitioner has not checked in 30 minutes after the start (UXF-05, with the Notifications chapter). Price the Approve button honestly and add an approval deadline with auto-approval unless disputed (UXF-07, with Timesheets).

*Phase 1.* Add level and match rule ("exact" or "this level or above") to the shift form; derive day or night from the times; pre-fill the rate floor for the chosen profession and level instead of a flat figure (UXF-06, UXF-09). Hide or disable publishing for an unverified facility and say why (UXF-08). Add a short onboarding checklist (UXF-16).

*Phase 2.* Clone and repeat a shift, a calendar view, and rota templates (UXF-10). A facility screen for disputes (UXF-12). A release flow for a confirmed practitioner with notice rules and a one-tap "find a replacement" (UXF-11). Replace the phone lookup with an invitation the colleague accepts, and split the facility role into scheduler and finance if the pilot shows that division of work (UXF-14).

*Phase 3.* Authorise payment before the shift through the payment provider, and let the facility see and download invoices with the fee shown plainly on each line (UXF-13).

**Acceptance criteria.**

1. Given a hospital with no CAC number, when its owner registers it with a ministry reference, then it is created pending, an officer sees the reference and what to check, and no other field is blocked.
2. Given a pending facility, when its owner opens the profile page, then they can upload a licence, edit the address and see the officer's note; and a rejected facility can resubmit.
3. Given an unverified facility, when its owner opens Shifts, then the publish button is disabled with the reason, and no draft is created.
4. Given a practitioner accepts an offer, when the response is saved, then the facility owner receives a message within one minute and the offer shows as accepted on the shift page.
5. Given a confirmed shift more than a window away, when the facility opens the roster, then it sees the practitioner's first name, surname initial and profession, and no phone number.
6. Given a submitted timesheet, when the facility opens it, then the amount shown is the amount that will be invoiced, including premiums, and an approval deadline is displayed.
7. Given a shift form, when a level is chosen, then the rate field offers the floor for that profession and level, and a lower rate is refused before publishing.
8. Given a facility owner with two hospitals, when they switch hospital, then no roster, invoice or incident from the first remains on screen.

---

## Console C · Operations  *(repo folder `src/app/admin`; v2.9 front end for Modules 3, 4, 11, 12, 13, 14, 16, 17, 18)*

**Status:** Built · **Label:** CURRENT + IMPROVE · **Maturity for a Gombe pilot:** Ready after P0 fixes — every queue the pilot needs can be worked from a screen, but an officer cannot create a facility, can verify one with no licence on file, can mark a payment received with no reference, and can close an erasure request without anything being erased.

**Why it exists.** A compliance officer in Gombe has fifty practitioners waiting to be approved and three hospitals to verify; a finance officer has to invoice and pay. The spec says the first fifty engagements are hand-matched and the safety-critical checks are staff-assisted, so this console is where the pilot's human work happens. Without it every decision is a database edit or a `curl` command, which is exactly where the project was before this console existed.

**Who uses it.**

| Actor | What they do here | Permission @ scope |
|---|---|---|
| Administrator (compliance, operations and finance merged) | Everything except publishing terms: onboarding queues, casework, money, suggestions, data requests, audit, staff, performance | 21 keys at PLATFORM, among them `credential.review`, `facility.verify`, `incident.manage`, `dispute.manage`, `sanction.apply`, `payout.manage`, `audit.read`, `suggestion.triage`, `role.grant` (`src/lib/authz/permissions.ts:172-183`) |
| Super administrator | The same plus "Terms and notices" and, in the API, the reference lists and rate floors | all keys including `config.manage` (`:219`) |
| Anyone else who opens `/admin` | Sees the shell with the entries their permissions allow; the API refuses the data | permissions are flat and scope-blind (`src/modules/auth/application/session-state.ts:34-43`) |

The three retired officer roles are mapped to `administrator` in `RETIRED_ROLES` (`src/lib/authz/permissions.ts:230-236`).

**How it works today.**

Page inventory (menu from `console-layout.tsx:33-123`; permission in brackets):

| Route | Purpose | Who sees it | Main actions |
|---|---|---|---|
| `/admin` | One request (`/api/v1/dashboard/platform`): a tile per queue with a count and the age of the oldest item, incident severity and worst incident, monthly growth chart, recent audit activity | any administrator | Click a tile into its queue (`page.tsx:61-113`) |
| `/admin/practitioners` [`credential.review`] | Queues "Waiting for approval", "Not submitted yet", "Everyone"; search; detail at `?user=` with tabs Identity and registration, Credentials | administrator | Record an identity; record a registration; **confirm from the photograph**; ask for more; clear a sanctions flag (20+ characters); lift a suspension (20+ characters) (`practitioners/page.tsx:81`; `practitioners/standing-panel.tsx:50-51`) |
| `/admin/credentials` [`credential.review`] | Queue by status with search; open the document | administrator | Approve; ask for more information (note needed); reject (note needed) (`credentials/page.tsx:370-400`) |
| `/admin/facilities` [`facility.verify`] | Queue by status; detail with Details and History; licence file if one exists | administrator | **Verify**; **Reject** (note needed) (`facilities/facility-detail.tsx:266-280`) |
| `/admin/incidents` [`incident.manage`] | Queue, most serious first | administrator | Begin review; close with an outcome (`incidents/incident-detail.tsx:60-67,289`) |
| `/admin/disputes` [`dispute.manage`] | Queue; case with evidence tab (view only) and history | administrator | Begin review; resolve upheld or dismissed with an outcome and notes of 20+ characters (`disputes/dispute-detail.tsx:71,309`) |
| `/admin/unhonoured` [`sanction.apply`] | Shifts that ended with nobody checked in | administrator | Decide fault (practitioner, facility, neither); grant or refuse an excusal (`unhonoured/unhonoured-detail.tsx:74,244,422`) |
| `/admin/finance` [`invoice.read`] | Totals, two charts, invoice table | administrator | Read |
| `/admin/invoices` [`payout.manage`] | Invoices by facility and month | administrator | Generate; issue; **record payment** (`invoices/page.tsx:107,283-305`) |
| `/admin/payouts` [`payout.manage`] | Find a practitioner; what the ledger says is owed; payouts | administrator | Prepare; release (a stub reference, with a banner saying no provider is configured) (`payouts/page.tsx:78,87,105-111`) |
| `/admin/suggestions` [`suggestion.triage`] | Pilot feedback and anonymised decline reasons | administrator | Triage; write a response (required to mark done or declined) |
| `/admin/data-requests` [`audit.read`] | Data-subject requests ordered by deadline | administrator | Start; close with an outcome of 10+ characters (`data-requests/request-detail.tsx:60,98,250`) |
| `/admin/audit` [`audit.read`] | Every state change with who and why; paged 50 at a time; no filter by actor, by design (`audit/page.tsx:47,68`) | administrator | Read |
| `/admin/staff` [`role.grant`] | Medilink's own staff | administrator | Appoint or remove an administrator or super administrator, each behind the password (`staff/page.tsx`) |
| `/admin/performance` [`audit.read`] | Route timings since this server started | administrator | Read |
| `/admin/agreements` [`config.manage`] | Versions of the terms and notices people accept | super administrator | Publish a new version (`agreements/page.tsx:82`) |

The journey for each queue. **NO SCREEN** marks a step that is missing.

1. **Practitioner verification.** The officer opens "Waiting for approval", opens a person, reads the NIN-slip photograph beside the number and confirms the name; reads the licence photograph and confirms what it shows; and approves or asks for more on every other document. A refused required document sends the application back. **NO SCREEN:** a "return the whole application with a note" action that is not tied to one document.
2. **Facility verification.** The officer opens a pending facility, reads the details and history, opens the licence file if one exists, and verifies or rejects. **NO SCREEN:** create a facility on its owner's behalf, suspend a facility, record what was checked beyond a free note, see a facility's licence expiry warning.
3. **Credential review.** Approve, ask for more (the practitioner sees the note and can resupply) or reject (the practitioner's application is sent back).
4. **Evidence confirmation.** One click records the identity or registration from what the practitioner sent and decides the submission; the number is never retyped (`practitioners/evidence-review.tsx`).
5. **Disputes.** Take the case, read the evidence, resolve upheld ("the timesheet reopens so the figures can be put right") or dismissed. **NO SCREEN:** the facility's reply, evidence from either party, a response deadline.
6. **Incidents.** Begin review, close with an outcome. Suspension is an outcome of closing; "System issue" is listed first on purpose. **NO SCREEN:** suspend directly, record which regulator and what reference when an incident is referred, notify the facility about shifts the person already holds.
7. **Unhonoured shifts.** Decide fault; decide an excusal. Each option states its consequence, and only one marks the practitioner's record. **NO SCREEN:** a graduated sanction (warning, pause, removal).
8. **Suggestions.** Triage and respond. The author cannot read the response.
9. **Finance.** Generate an invoice, issue it, record the payment, prepare a payout, release it. **NO SCREEN:** bank accounts, credit notes, reversals, reconciliation, VAT or withholding tax.
10. **Audit and data requests.** Read the trail; work data-subject requests by deadline.

The console owns no status; it moves statuses owned by the modules:

| Action on screen | Moves | Needs |
|---|---|---|
| Verify / Reject facility | PENDING → VERIFIED / REJECTED | Note to reject; none to verify |
| Approve / Ask for more / Reject credential | PENDING → VERIFIED / MORE_INFO_REQUESTED / REJECTED | Note to ask or reject |
| Begin review / Close incident | REPORTED → UNDER_REVIEW → CLOSED | Outcome and notes |
| Begin review / Resolve dispute | OPEN → UNDER_REVIEW → RESOLVED (upheld or dismissed) | Outcome and 20+ characters of notes; WITHDRAWN is set by the raiser and has no screen |
| Decide fault / excusal | AWAITING_DECISION → CLOSED; excusal REQUESTED → GRANTED / REFUSED | Fault option and 10+ characters |
| Start / Close data request | RECEIVED → IN_PROGRESS → COMPLETED or REFUSED | Outcome of 10+ characters |
| Triage suggestion | NEW → TRIAGED → PLANNED → DONE / DECLINED | A response to close |
| Generate / Issue / Record payment | invoice DRAFT → ISSUED → PAID | Nothing else is asked |
| Prepare / Release payout | PREPARED → RELEASED → SETTLED | Nothing else is asked |

**Rules the system enforces.**

- Every menu entry names the permission it needs and is hidden without it; every endpoint refuses on its own, so the menu is a courtesy (`src/components/app/console-shell.tsx`, `docs/interfaces.md:13-16`).
- A reject, a request for more information, a refused facility, a resolved dispute and a closed suggestion each need written reasons, and the button stays off until they are typed; the API enforces the same (`credentials/page.tsx:390`; `facilities/facility-detail.tsx:275`; `disputes/dispute-detail.tsx:309`).
- An officer cannot review their own submission; a practitioner cannot record their own identity (Module 2).
- The audit trail cannot be edited and has no filter by actor; the screen answers "what happened to this record", not "what has this person done" (`audit/page.tsx:68-76`).
- Granting or removing staff needs a freshly typed password (`src/lib/authz/permissions.ts:77-83`). Nobody can grant a permission they do not hold, so only a super administrator can appoint one; the last holder of `config.manage` cannot be removed (`docs/testing-by-role.md:239-254`).
- A failed queue count shows an error, never "everything is clear" (`page.tsx` summary handling).
- A queue older than five working days is marked stale on the tile (`page.tsx:113`).

**The docs said X; at HEAD it is fixed.** `docs/operations-console.md:24-27` says a facility still cannot publish a shift from a browser and a practitioner cannot see a shift; both consoles exist. `docs/demo-walkthrough.md:196-199` says screening flags have no console; `practitioners/standing-panel.tsx` answers them. `docs/operations-console.md:59` cites a file that does not exist (QAL-07).

**What is not there yet.**

| ID | Gap | Sev | Source | Evidence |
|---|---|---|---|---|
| UXO-01 | No screen creates a facility, although the spec's launch model is operations-assisted onboarding and `docs/testing-by-role.md` tells testers to "onboard a new one". Combined with the mandatory CAC number, a government hospital or PHC cannot be put on the platform from any screen. | P0 | NEW | `docs/testing-by-role.md:281`; `src/app/admin/facilities/page.tsx` (no create control); `prisma/schema.prisma:567` |
| UXO-02 | "Verify" is a live button whether or not a licence is on file, and records only a free-text note. Nothing records what was checked. | P0 | REVIEW | `facilities/facility-detail.tsx:266-272` |
| UXO-03 | "Record payment" sends no reference, amount, date or payer. The same holder of `payout.manage` can generate, issue, mark paid, prepare and release, with no second approver, and release writes a stub reference. | P0 | REVIEW | `invoices/page.tsx:299-309`; `payouts/page.tsx:78,87,105-111`; `src/lib/authz/permissions.ts:179` |
| UXO-04 | A data request can be closed as "Answered" with a typed note while the erasure itself is only an assessment; nothing in the product erases or pseudonymises. | P0 | REVIEW | `data-requests/request-detail.tsx:98-100`; review section 5 (audit-compliance) |
| UXO-05 | No screen edits the reference lists (categories, specialties, credential types, requirements, facility types, holidays) or the rate floors. The Staff page tells super administrators they can ("the reference lists and the minimum pay rates"). | P1 | REVIEW | `staff/page.tsx:26`; `console-layout.tsx:121` |
| UXO-06 | Case views have no URLs. A dispute, incident, facility, unhonoured shift, suggestion or data request opens as component state, so an officer cannot send a colleague a link, bookmark a case, or use the browser Back button. Only practitioners deep-link (`?user=`). | P1 | NEW | `disputes/page.tsx:49,80-83` |
| UXO-07 | "Waiting for approval" practitioners are the pilot's main work item, yet the dashboard has no tile for them and no age. | P1 | NEW | `page.tsx:61-113` |
| UXO-08 | None of the spec's first-month signals are shown: fill rate against the 70% gate for a second state, time from publish to confirmed, time from approval to paid, verification turnaround, repeat practitioners and facilities. | P1 | V2.9 | `src/modules/audit-compliance/application/platform-summary.ts:35-43` |
| UXO-09 | Disputes: the evidence tab is view-only, there is no facility response, no target resolution time or escalation, and no "amount at stake". | P1 | REVIEW | `disputes/dispute-detail.tsx:323-403` |
| UXO-10 | Closing an incident with a suspension notifies nobody, there is no direct suspend, and "refer to the regulator" records no regulator or reference. | P1 | REVIEW | `incidents/incident-detail.tsx:60-67` |
| UXO-11 | Suggestions: the response is saved but the author has no screen to read it, so the spec's "status visible to the person who submitted it" is not met. | P1 | V2.9 | `suggestions/suggestion-detail.tsx:105-107` |
| UXO-12 | Access to `/admin` is checked only in the browser, and the menu filter ignores scope. A practitioner who types `/admin` sees "Disputes" and "Finance" entries because they hold those permissions at their own scope; the API then refuses. No middleware exists. | P1 | NEW | `src/lib/ui/session.tsx:120-125`; `src/modules/auth/application/session-state.ts:34-43`; `tests/e2e/auth.spec.ts:107-115` |
| UXO-13 | Excusals are decided by a platform officer, not by the facility the practitioner asked, and a facility that habitually refuses is not visible to anyone. | P1 | V2.9 | `src/app/api/v1/excusals/[id]/decide/route.ts:19-21`; `unhonoured/unhonoured-detail.tsx:348` |
| UXO-14 | No sanction ladder (warning, pause, removal), no appeal, and no facility reliability view. | P1 | V2.9 | `unhonoured/unhonoured-detail.tsx:56-70` |

**Recommended change (v3).**

*Phase 0.* Add "Create a facility" for operations, with a reference field that accepts a ministry or registration number where there is no CAC (UXO-01). Make Verify require either a licence file or an officer's recorded reason, and record what was checked (UXO-02). In "Record payment" capture the bank reference, amount, date and payer; add a second approver for release, so the person who prepares a payout is not the one who releases it (UXO-03, with Billing). Make erasure real, or label the request "assessed only" until it is (UXO-04, with Audit).

*Phase 1.* Put "Waiting for approval" on the dashboard with its oldest age, and add the first-month signals the spec lists (UXO-07, UXO-08). Give every case its own URL (UXO-06). Build an audited screen for the reference lists and rate floors, keyed by level once levels exist (UXO-05).

*Phase 2.* Send the facility a notice when a practitioner it holds is suspended; add a direct suspend with notice and a right of reply; record the regulator and reference on a referral (UXO-10). Let the facility answer a dispute and attach evidence; add resolution targets and escalation (UXO-09). Let the facility decide an excusal first, with the officer as the backstop (UXO-13). Show the author a suggestion's status and response (UXO-11).

*Phase 3.* Move invoices and payouts onto the payment provider's capture and release, with reconciliation and credit notes on screen (Money chapters). Move the console behind server-side route protection and scope-aware menus (UXO-12).

**Acceptance criteria.**

1. Given an operations user and a hospital with no CAC, when they create it from the console with a ministry reference, then it exists as pending, the reference is on its record, and the owner is invited to sign in.
2. Given a pending facility with no licence file, when an officer presses Verify, then the screen asks for a recorded reason or a file before it accepts.
3. Given an issued invoice, when finance records a payment, then the bank reference, amount and date are stored and shown, and the ledger entry carries them.
4. Given a payout prepared by one officer, when the same officer tries to release it, then the system refuses and asks for a second approver.
5. Given any open dispute, incident or facility, when an officer copies the address from the browser, then a colleague with permission opens the same case.
6. Given a practitioner who types `/admin` into the browser, when the page loads, then they are sent to their own console and see no Operations entries.
7. Given an erasure request, when an officer closes it as answered, then the personal data has been removed or pseudonymised and a test proves it.
8. Given the dashboard, when a Gombe pilot week ends, then it shows the fill rate, the median time from publish to confirmed, and the median time from approval to payment.

---

## Public site and sign-in  *(repo folder `src/app/page.tsx` and `src/app/(auth)/`; v2.9 Modules 1, 26 and Section 10.3; no repo module)*

**Status:** Partly built · **Label:** CURRENT + NEW EXPANSION · **Maturity for a Gombe pilot:** Not ready — a visitor can read one landing page and fill two forms, but a locked-out user has no way back in, the one-time code cannot be delivered outside a developer's machine, and there is no contact number, terms, privacy notice or price anywhere.

**Why it exists.** A nurse in Gombe hears about Medilink from a colleague and opens the link on a phone. They need to know what it is, whether it costs anything, who stands behind it, how to get in, how to get back in after forgetting the password, and whom to phone at eleven at night when registration fails. The v2.9 spec makes a staffed phone line and a WhatsApp line a condition of launch for exactly this person (`v29.md:946`). Without these pages a pilot practitioner has no way to trust the product and no way to ask for help.

**Who uses it.**

| Actor | What they do here | Permission @ scope |
|---|---|---|
| Visitor | Read the landing page; choose sign-in or create-account | none |
| Practitioner-to-be | Register at `/register` | none until the grant arrives from the worker |
| Hospital representative | Register at `/register?as=facility`, then `/facility/register` | becomes `facility_owner` at the new facility |
| Hospital staff member | Register at `/register?as=staff`; wait to be added by the owner | none until granted |
| Anyone returning | Sign in at `/login`; the grants on the account decide which console opens (`src/lib/ui/session.tsx:44-54`) | session cookie set by the API |

**How it works today.**

Page inventory:

| Route | Purpose | Who sees it | Main actions |
|---|---|---|---|
| `/` | Landing: hero, three workspaces, four-step "how it works", for facilities, for practitioners, trust and safety, footer | anyone | Create account; Sign in; in-page anchors (`page.tsx:159-174,451-470`) |
| `/login` | Phone and password | anyone | Sign in; links to register a practitioner or a facility (`(auth)/login/page.tsx:99-117`) |
| `/register` (`?as=facility`, `?as=staff`) | Three steps: details, six-digit code, password; practitioners also tick the "show me to hospitals" consent | anyone | Send code; confirm; set password (`(auth)/register/page.tsx:32-35,413-435`) |
| `not-found`, `error`, `global-error` | Plain recovery pages with a reference code on errors | anyone | Try again; back to Medilink |

The journeys. **NO SCREEN** marks a step the product needs and does not have.

1. **Arrive.** The landing page names the three workspaces and explains the shift in four steps. **NO SCREEN:** price, terms, privacy notice, contact, FAQ, who verifies and against which regulators.
2. **Create an account.** Name, phone (any common Nigerian format), optional email, six-digit code valid ten minutes with resend, password of ten or more characters typed twice. The resend message is deliberately vague ("If that number can receive one…", `register/page.tsx:366`). The page says plainly that Medilink sends no email yet (`:301-304`).
3. **Get the code.** In the app, the code is sent through the SMS adapter. Only the console adapter exists; `termii` and `africastalking` are placeholders that throw, and the console adapter is refused at start-up outside local (`src/lib/sms/index.ts:98-108`; `src/lib/env-rules.ts:53-55`). **NO WORKING DELIVERY** outside a developer machine.
4. **Sign in.** The grants on the account choose the console. A wrong password shows the server's reason; too many attempts shows "Try again shortly or reset your password" (`src/modules/auth/domain/errors.ts:27`).
5. **Forgot the password.** **NO SCREEN.** The two reset routes exist and no page calls them (`src/app/api/v1/auth/password/reset-request/route.ts`, `reset-confirm/route.ts`). The register page admits "there is no way to reset a password from the interface" (`register/page.tsx:395`).
6. **Ask for help.** **NO SCREEN and no number.** A suspended account is told "Contact support" with nothing to contact (`src/modules/auth/domain/errors.ts:52`). The only help channel in the product is the signed-in "Send a suggestion" dialog (`src/components/app/suggestion-dialog.tsx:36`).

Sign-up states (the server's, shown so the screens make sense):

| Account status | Can go to | Triggered by |
|---|---|---|
| (none) | PENDING_VERIFICATION | Details submitted, code sent |
| PENDING_VERIFICATION | UNDER_REVIEW | Code confirmed and password set |
| UNDER_REVIEW | ACTIVE | Daily activation sweep once eligible; both statuses are usable (`src/modules/practitioners/domain/eligibility.ts:58-61`; `src/worker/jobs.ts:51-56`) |

**Rules the system enforces.**

- One sign-in for everyone; which console opens is decided by grants, not by the link followed (`page.tsx:23-38`).
- Only a practitioner can sign up on the default path; facility and staff accounts take their own query string, and a staff account receives no practitioner role (`register/page.tsx:96-107,155`).
- A practitioner cannot create an account without ticking consent to be shown to hospitals; the button is disabled until then (`:434`).
- The six-digit code is numeric, six long, and expires in ten minutes (`:32-33,336`).
- The password must be at least ten characters and match its confirmation (`:32,69-77`).
- A new practitioner waits up to eight seconds for the grant from the worker before the console opens, so the sidebar is never empty (`:170`).
- The hero image has descriptive alt text; the public pages are light only (`page.tsx:193`).
- Server-side: sessions are cookies, not tokens kept in browser storage (`(auth)/login/page.tsx:17-19`).

**What is not there yet.**

| ID | Gap | Sev | Source | Evidence |
|---|---|---|---|---|
| UXW-01 | No forgot-password screen. A locked-out user is told to reset and cannot. | P0 | REVIEW | `register/page.tsx:395`; `src/modules/auth/domain/errors.ts:27`; reset routes with no UI caller |
| UXW-02 | One-time codes cannot be delivered outside a developer machine: the real SMS adapters throw and the working one is refused in staging and production. Registration and password reset therefore cannot work in a Gombe pilot until a provider is written. | P0 | REVIEW | `src/lib/sms/index.ts:98-108`; `src/lib/env-rules.ts:53-55` |
| UXW-03 | No contact surface at all: no phone, WhatsApp, email, help or FAQ on the landing page, login, register, footer or consoles. The spec makes a staffed phone and WhatsApp line a condition of launch. | P0 | V2.9 | `v29.md:946`; `page.tsx:443-475`; `src/modules/auth/domain/errors.ts:52` |
| UXW-04 | No public Terms of use or Privacy notice, and the sign-up form links to neither and records no acceptance. Terms are shown only inside consoles after sign-in. For counsel to confirm what must be shown at the point of collection under the data-protection law. | P0 | REVIEW | `(auth)/register/page.tsx` (no terms or privacy text); `practitioner/profile/privacy-section.tsx:97-125` |
| UXW-05 | The login page tells visitors "Locally, `seed-demo.ts` creates every demo account… See `docs/interfaces.md`." | P0 | REVIEW | `(auth)/login/page.tsx:119-122` |
| UXW-06 | No pricing page and no statement anywhere that using Medilink is free during launch. | P0 | REVIEW | `page.tsx` (no price text); no `/pricing` route |
| UXW-07 | No menu on a phone. The anchor links are hidden below the large breakpoint, and "Sign in" in the header is hidden below the small one; only "Create account" stays. | P1 | REVIEW | `page.tsx:159,178` |
| UXW-08 | Landing copy overstates in one place: practitioners are promised "offers with their terms in full", but the offer card omits cancellation terms and premiums (UXP-02), while a comment at the top of the file claims everything stated is done today. | P1 | NEW | `page.tsx:37,65,111`; `src/app/practitioner/offers/page.tsx:147-153` |
| UXW-09 | The landing page names no regulator (MDCN, NMCN, PCN, MLSCN, RRBN), shows no real counts of verified practitioners or facilities, and says nothing about Gombe. Testimonials must not be invented. | P1 | REVIEW | `page.tsx:116-141` |
| UXW-10 | The public page loads the signed-in app's providers (React Query, motion, toaster) because they sit in the root layout; on a slow phone that is payload the landing page does not use. | P1 | REVIEW | `src/app/layout.tsx:22`; `src/lib/ui/providers.tsx` |
| UXW-11 | No sitemap, robots file, social-share image or "Share on WhatsApp" link. | P2 | REVIEW | `src/app` listing (only `icon.svg`, `layout.tsx`, `page.tsx`, error pages) |

**Recommended change (v3).**

*Phase 0.* Build the forgot-password flow on the existing routes: phone, code, new password, with the same generic wording as sign-up so it does not reveal which numbers are registered; require more than an SMS for platform staff (UXW-01). Write a deliverable SMS adapter with two providers and failover, mark one-time codes as transactional, and show a delivery failure to the user (UXW-02, with the Notifications chapter). Add a contact block (a staffed phone number and a WhatsApp number, with hours) to the landing page, the footer, the login and register pages and every "contact support" message (UXW-03). Publish Terms, Privacy and a pricing page that says "free during launch; verification, applying, booking, timesheets and getting paid stay free", sourced from the same versioned documents the consoles ask people to accept so there is one text, and link them from the sign-up form with a recorded acceptance (UXW-04, UXW-06; counsel signs the wording). Delete the developer text (UXW-05).

*Phase 1.* A phone menu and visible Sign in (UXW-07). Regulator names and live counts drawn from the data, no invented quotes (UXW-09). Move the heavy providers out of the public layout (UXW-10). Review every claim on the page against what is built, each release (UXW-08). Provide the public pages and sign-up in Hausa as well as English (UXA-12).

*Phase 2.* An anonymous shift board showing a teaser (profession, place, date, rate band) with sign-in needed to apply; a "Share on WhatsApp" link on each shift; sitemap, robots and share cards (UXW-11).

**Acceptance criteria.**

1. Given a user locked out after repeated wrong passwords, when they open the sign-in page, then there is a visible "Forgot password?" link, and completing it with a delivered code sets a new password and signs them in.
2. Given a production environment, when a practitioner registers with a valid Nigerian number, then the code arrives by SMS within one minute and a failed send is shown to the user, not swallowed.
3. Given any public page or any "contact support" message, when it is read, then it shows the staffed phone number, the WhatsApp number and their opening hours.
4. Given the sign-up form, when it is read, then it links to the current Terms and Privacy notice and the acceptance is recorded against the new account.
5. Given the landing page, when it is read, then it states what costs nothing during launch, and a `/pricing` page says the same.
6. Given a 360-pixel-wide phone, when the landing page is opened, then a menu button reaches every section and "Sign in" is visible without scrolling.
7. Given the login page, when it is read, then it contains no mention of scripts, files or documents in the repository.
8. Given the landing page, when its text is compared with the built product, then every claim is true of a feature that exists on the day it is published.

---

## Readability, accessibility and low-bandwidth  *(repo folders `src/components/ui`, `src/components/app`, `src/app/globals.css`, `public/`; v2.9 Section 10.3, Modules 27 and 28)*

**Status:** Partly built · **Label:** CURRENT + IMPROVE · **Maturity for a Gombe pilot:** Not ready — the screens are responsive and honest, but the type is small, the controls are short, the commonest status colour is hard to read, there is no larger-text or projector mode, and nothing works when the network does not.

**Why it exists.** The pilot's users include practitioners reading a phone in a dim corridor and facility managers reading a shared desktop, many of them older and not used to software. The readability complaint was raised in Gombe and is recorded in the redesign review (`docs/redesign-recommendations-2026-10-13.md`, section 3 direction 4 and section 8); the study document behind it is not in the repository and was not read for this chapter. The v2.9 spec asks for an interface "designed for varied levels of digital literacy", in-app help, multilingual support later, small payloads, compressed uploads, retry logic, draft-saving forms and network-status feedback (`v29.md:716-722,911-915`). A user who cannot read the screen, tap the button or load the page does not use the product.

**Who uses it.**

| Actor | What they need here | Permission @ scope |
|---|---|---|
| Practitioner on a phone | Text readable at arm's length, buttons that can be hit with a thumb, pages that load on a weak connection, check-in that works with no signal | SELF |
| Facility manager on a shared desktop | A projector- or meeting-friendly view, no clipped names or amounts | FACILITY |
| Older or low-vision user | A larger-text setting that survives a reload, visible focus, usable with a keyboard or screen reader | any |
| Hausa-speaking user | The practitioner journey in Hausa, with English available | any |
| Operations officer | Dense queues that stay readable | PLATFORM |

**How it works today.**

The measured facts, at HEAD:

| Area | Fact | Evidence |
|---|---|---|
| Root and body size | 16px (the browser default); nothing sets a larger root or body size | `src/app/globals.css:130-131`; `src/app/layout.tsx:21` |
| Content size | 14px (`text-sm`) is the working size: 291 uses on 290 lines in 73 files, including Button, Label, Table, Tabs, Alert, Select, Textarea, card descriptions and record values | `src/components/ui/button.tsx:20`; `label.tsx:9`; `table.tsx:12`; `src/components/app/page-shell.tsx:20,100` |
| Secondary size | 12px (`text-xs`): 272 lines in 72 files, 206 of them also grey (`text-muted-foreground`); small Button and every Badge are 12px | `button.tsx:36`; `badge.tsx:6`; `page-shell.tsx:99` |
| Smallest size | `text-[0.7rem]` (11.2px) in 10 places, among them every menu heading | `src/components/app/console-shell.tsx:174,215` |
| Inputs | 36px high; 16px text below 768px and 14px above | `src/components/ui/input.tsx:11` |
| Button height | Default 36px, small 32px, large 40px, icon 36px | `button.tsx:35-38` |
| Other controls | Select trigger and Tabs list 36px; menu links 36px | `select.tsx:19`; `tabs.tsx:16`; `console-shell.tsx:193` |
| Focus ring | Button and Input 1px, no offset; Select, Tabs and Textarea 2px, no offset; Badge and queue-card buttons 2px with offset | `button.tsx:20`; `input.tsx:11`; `select.tsx:20`; `tabs.tsx:32`; `textarea.tsx:9` |
| Contrast, text | Grey secondary text 4.57:1 on the page and 4.19:1 on a grey tint (light); the warning badge (pending, new, open, submitted, under review, awaiting decision, requested, reported) 3.01:1; the destructive badge in dark mode 3.42:1 | computed from `globals.css:32,37,44,97`; badge map `src/components/app/status-badge.tsx:38-59` |
| Contrast, controls | Input border 1.31:1 on the page (light), 1.58:1 (dark); card border 1.25:1 | computed from `globals.css:50,108` |
| Record values | The shared `Detail` clips long values with an ellipsis; 86 uses in 18 files, including every case panel; ranking reasons are clipped to seven rem | `page-shell.tsx:100`; `src/app/facility/shifts/[id]/page.tsx:381` |
| Larger text, projector mode | None | no matching code |
| Skip link | None; `<main>` has no id | `console-shell.tsx:311` |
| Mobile menu | Console: off-canvas drawer with Escape to close; no focus trap, focus return or scroll lock. Landing page: none | `console-shell.tsx:148-156,225-246`; `src/app/page.tsx:159,178` |
| Alerts | Every `Alert`, including static notices, is `role="alert"` and announced on every mount | `src/components/ui/alert.tsx:25` |
| Colour mode | Manual toggle in the console only; read in an effect after the first paint; the system setting is never read | `console-shell.tsx:136-146,160-166` |
| Reduced motion | Honoured | `src/components/app/motion.tsx` |
| Language | English; `lang="en-NG"`; times in West Africa Time; no i18n library | `src/app/layout.tsx:20`; `package.json` |
| PWA | Manifest present with `display: standalone`, but `"icons": []`; only a 32px SVG favicon | `public/manifest.webmanifest:6,9`; `src/app/icon.svg` |
| Service worker, offline | None; no queued writes, no offline page | no matching code |
| Retry and network feedback | Queries retry non-4xx errors twice; mutations do not retry; a failed session request shows "Could not reach Medilink"; no online/offline indicator | `src/lib/ui/providers.tsx:37-42`; `src/lib/ui/session.tsx:102,127-137` |
| Uploads | Type and 10 MB checks only; no compression or resize | `src/components/app/document-upload.tsx:11-12` |
| Drafts | The profile wizard saves each step to the server; nothing else keeps a draft; browser storage holds only the theme and the chosen hospital | `profile/setup-wizard.tsx` header; `console-shell.tsx:139,164`; `src/lib/ui/facility.ts:56-76` |
| Payload care | One-request dashboards; charts loaded on demand; a manual Slow-4G budget script, not in CI | `src/app/facility/page.tsx:27-34`; `scripts/page-budget.mjs` |
| Money format | Whole amounts print with ".00" | `src/components/app/format.ts` (`minimumFractionDigits: 2`) |

Mapping to the v2.9 text:

| v2.9 requirement | Status | Gap |
|---|---|---|
| 10.3 Interface for varied digital literacy | PARTLY: plain wording and consequences on buttons, but small type and short controls | UXA-01, UXA-02, UXA-04 |
| 10.3 Comprehensive in-app help | MISSING | UXA-11 |
| 10.3 Multilingual support (later phases) | MISSING, not yet due | UXA-12 |
| 27 Responsive, PWA-capable delivery | PARTLY: responsive; manifest has no icons; no service worker | UXA-08, UXA-09 |
| 27 Small page payloads | PARTLY | UXW-10, QAL-04 |
| 27 Compressed uploads | MISSING | UXA-10 |
| 27 Retry logic for failed requests | PARTLY: reads only | UXA-09 |
| 27 Draft-saving forms | PARTLY: the wizard only | UXA-11 |
| 27 SMS notifications | PARTLY: one message, local adapter | UXP-01, UXW-02 |
| 27 Clear network-status feedback | PARTLY: error screens only | UXA-09 |
| 28 Flutter client, Android first, offline-tolerant | MISSING (ADR only; spec sequences it after the API is stable) | UXA-17 |

State: colour mode is the only display setting a user can change.

| Display mode | Can go to | Triggered by |
|---|---|---|
| Light (default) | Dark | Theme button in the console top bar; kept in browser storage under `medilink:theme` |
| Dark | Light | Same button; the class is removed when the console unmounts so public pages stay light (`console-shell.tsx:136-146`) |

**Rules the system enforces.**

- Status words map to colours in one place, so a reader scanning three queues learns the palette once (`src/components/app/status-badge.tsx`).
- Severity has its own scale because it is ordered (`status-badge.tsx:84-98`).
- Skeletons, not spinners; "Could not load" is never shown as zero or empty (`src/app/facility/page.tsx:87-91`).
- Every chart figure also appears in a table beside it, so the page is readable without colour (`docs/interfaces.md:88-91`).
- Motion is removed for people who ask their system for less (`src/components/app/motion.tsx`).
- Practitioner pages do not scroll sideways at phone width; this is tested on a Pixel 5 profile (`tests/e2e/mobile.spec.ts:21-50`).

**The review said X; at HEAD it differs in detail.** The review's section 3 says "body text is 14px"; its section 8 is exact (root 16px, content 14px), and HEAD agrees with section 8. The review says focus rings are 1px; at HEAD that is true of Button and Input only, and Select, Tabs and Textarea use 2px. The "11px" style is 11.2px in ten places.

**What is not there yet.**

| ID | Gap | Sev | Source | Evidence |
|---|---|---|---|---|
| UXA-01 | Type is too small for the pilot's readers: 14px content, 12px secondary text on 272 lines, 11.2px menu headings. | P0 | REVIEW | `src/components/ui/button.tsx:20,36`; `src/components/app/console-shell.tsx:174,215`; `src/components/app/page-shell.tsx:99-100` |
| UXA-02 | Controls are 36px (32px small) and the focus ring on Button and Input is 1px with no offset. | P0 | REVIEW | `button.tsx:20,35-36`; `src/components/ui/input.tsx:11` |
| UXA-03 | Contrast falls short: input border 1.31:1, warning badge 3.01:1 (eight statuses, including the commonest ones), grey text on a grey tint 4.19:1, destructive badge in dark mode 3.42:1. | P0 | REVIEW | `src/app/globals.css:32,37,44,50,97`; `src/components/app/status-badge.tsx:38-59` |
| UXA-04 | No larger-text switch and no projector mode, the direct answer to the Gombe complaint. | P0 | REVIEW | no matching code |
| UXA-05 | Record values and ranking reasons are clipped with an ellipsis, so names, amounts and reasons can be unreadable. | P1 | REVIEW | `src/components/app/page-shell.tsx:100`; `src/app/facility/shifts/[id]/page.tsx:381` |
| UXA-06 | No skip-to-content link; the phone drawer neither traps nor returns focus nor stops the page behind it from scrolling. | P0 | REVIEW | `src/components/app/console-shell.tsx:225-246,311` |
| UXA-07 | Static notices are announced as alerts on every mount, so a screen reader hears the same banner each time a page opens. | P1 | REVIEW | `src/components/ui/alert.tsx:25` |
| UXA-08 | The web manifest has no icons, so the app cannot be installed to a phone's home screen. | P0 | REVIEW | `public/manifest.webmanifest:9` |
| UXA-09 | No service worker, offline page or queued writes: a check-in or timesheet submitted with no signal fails. Mutations never retry, and there is no online/offline indicator. | P1 | V2.9 | `src/lib/ui/providers.tsx:42`; no service worker in `src` or `public` |
| UXA-10 | Photographs and scans upload at full size up to 10 MB, with no compression, over weak 4G. | P1 | REVIEW | `src/components/app/document-upload.tsx:11-12` |
| UXA-11 | No in-app help; drafts are kept only by the profile wizard. | P1 | V2.9 | `src/app/practitioner/profile/setup-wizard.tsx` header; no help route |
| UXA-12 | No Hausa and no i18n: every string is written inline in the screens, so translation starts with extracting them (the review counts about 108 files; not recounted here). | P1 | REVIEW | `package.json`; `src/app/layout.tsx:20` |
| UXA-13 | Dark mode is manual only, applied after first paint (a flash), and the system setting is ignored. | P2 | REVIEW | `src/components/app/console-shell.tsx:136-146` |
| UXA-14 | The menu marks only an exact path as active, so deep pages such as a shift highlight nothing; a breadcrumb component exists but is unused. | P2 | NEW | `src/components/app/console-shell.tsx:179`; `src/components/ui/breadcrumb.tsx` |
| UXA-15 | Whole-naira amounts print with ".00" and rate inputs have no thousands separators. | P2 | REVIEW | `src/components/app/format.ts`; `src/app/facility/shifts/new-shift-dialog.tsx:225-233` |
| UXA-16 | No keyboard or screen-reader test exists anywhere, so none of the above is guarded against regression (see QAL-03). | P1 | NEW | `tests/e2e/mobile.spec.ts`; no accessibility tooling in `package.json` |
| UXA-17 | No Flutter client, no push notifications, no offline-tolerant check-in. The spec sequences it after the API stabilises, and the pilot serves practitioners through the PWA. | P2 | V2.9 | `docs/adr/0003-flutter-mobile-client.md`; `v29.md:726-742` |

**Targets (what v3 must meet).**

| Item | Today | Target | Reason |
|---|---|---|---|
| Root and body text | 16px root, 14px content | Root 17–18px, body text 16px, hints 14px; nothing below 14px; the 11.2px style deleted | Readable on a phone at arm's length and on a projector |
| Touch targets | 36px (32px small) | 44px for every button, link and control on touch layouts; inputs 44px with 16px text | Thumb use in a corridor |
| Text contrast | 3.01:1 (warning badge), 4.19:1 (grey on tint) | 4.5:1 for all text, with solid status fills | Standard threshold for body text |
| Control and border contrast | 1.31:1 input border | 3:1 for borders of inputs and buttons | Standard threshold for interface components |
| Focus | 1px or 2px, no offset | 2px ring with offset on every control, visible in light and dark | Keyboard and low-vision users |
| Larger text | None | A / A+ / A++ switch saved per user, honoured by every screen without sideways scroll at 360px | The Gombe complaint |
| Projector mode | None | Fewer columns, no truncation, larger figures, selectable from the user menu | Meetings and wards with a shared screen |
| Truncation | Values and reasons clipped | Wrap, never clip, record values and ranking reasons | Names and money must be fully visible |
| Plain English | Partly (named blockers, stated consequences) | A reading-level review of every practitioner and facility string, tested with Gombe users; no internal words (for example "match run", "step-up", "outbox") on screen | Varied digital literacy (spec 10.3) |
| Language | English only | Hausa and English for the practitioner app, the public pages and SMS and WhatsApp templates; Hausa-assisted onboarding by phone and in person; operations console stays English | Spec 10.3, review section 8 |
| Low bandwidth | No service worker, no compression | Offline shell, queued check-in and timesheet writes that replay safely, compressed uploads, a visible network status, and a page budget checked in CI | Spec Module 27 |
| Critical events by SMS | One message, local only | SMS for offer received, booking confirmed or cancelled, shift reminders (24 h and 2 h), no check-in 30 minutes after start, verification decisions and expiry warnings, timesheet and payout events, all in West Africa Time | Spec Modules 15 and 27 |
| Installable | Manifest without icons | 192px and 512px icons including a maskable one; passes browser installability checks | Spec Module 27 |

**Recommended change (v3).**

*Phase 0 (days of work, before the Gombe meeting).* Raise the root to 17–18px and body text to 16px, set controls to 44px with 16px inputs, make the focus ring 2px with offset on every control, darken muted text, warning text and input borders, switch status badges to solid fills, delete the 11.2px style (UXA-01, UXA-02, UXA-03). Wrap record values instead of clipping them (UXA-05). Add a skip link, trap and return focus in the drawer, and stop announcing static notices on every mount (UXA-06, UXA-07). Add the manifest icons (UXA-08).

*Phase 0 to 1 (one to three weeks).* Build the A / A+ / A++ switch saved per user and a projector mode; demonstrate both at the Gombe meeting (UXA-04). Respect the system colour setting and avoid the flash (UXA-13).

*Phase 1.* Extract strings and provide Hausa for the practitioner app, the public pages and the SMS and WhatsApp templates, with phone-assisted onboarding (UXA-12). Add contextual help (UXA-11). Compress photographs before upload (UXA-10). Put the Slow-4G page budget into CI (QAL-04).

*Phase 2 and later.* A service worker with an offline shell and a replay-safe queue for check-in and timesheet writes, which needs idempotent endpoints on the server (UXA-09, with the Attendance chapter). Decide on the Flutter client once the API has stabilised (UXA-17).

**Acceptance criteria.**

1. Given any page, when computed styles are read, then body text is at least 16px, no visible text is below 14px, and every button, link and form control is at least 44px high on a touch layout.
2. Given the light and dark themes, when contrast is measured, then all text is at least 4.5:1, every input and button border is at least 3:1, and no status badge falls below 4.5:1.
3. Given a user who chooses "A++", when they sign in again on another day, then the setting is still applied, and no practitioner page scrolls sideways at 360px.
4. Given projector mode, when the facility timesheets page is opened, then values wrap in full and no name or amount is clipped.
5. Given a keyboard-only user, when a page loads, then the first Tab stop is "Skip to content", the drawer returns focus to its trigger when closed, and an automated accessibility check reports no serious violation.
6. Given a phone with no signal, when a practitioner enters the ward's check-in code, then the attempt is queued, shown as pending, and replayed once without duplicating when the signal returns.
7. Given the practitioner journey, when the language is set to Hausa, then every screen from registration to earnings and every SMS template appears in Hausa.
8. Given Chrome on Android, when a user opens the site, then it offers installation and the installed app shows the Medilink icon.

---

## Quality and delivery  *(repo folders `tests/`, `.github/`, `scripts/`, `docs/`, `prisma/seed.ts`; v2.9 Sections 6, 8.9, 9.7, 11, 11.1, 11.2, 12)*

**Status:** Partly built · **Label:** CURRENT + IMPROVE · **Maturity for a Gombe pilot:** Ready after P0 fixes — the engine is well tested and the pipeline gates every change, but nothing is deployed from it, the browser tests do not cover most of the facility and operations consoles, the demo data is not in Gombe, and several documents describe a product that no longer exists.

**Why it exists.** The pilot will be run by a small team that has to trust a green build, rehearse in front of Gombe stakeholders with believable data, and hand the system to the next developer or a lawyer who will read the documents. A suite that proves the rules, a pipeline nobody can bypass, a demo world that looks like the pilot, and documents that match the code are what stop the first real shift from being the first test.

**Who uses it.**

| Actor | What they do here | Permission @ scope |
|---|---|---|
| Developer | Run `pnpm verify`, integration and browser tests; read module docs; seed a local world | repository access |
| CI | Runs five jobs on every push to `main` or `develop` and every pull request (`.github/workflows/ci.yml:3-8`) | repository secrets |
| Founder, operations lead | Sign in to the demo accounts to rehearse and show the product | local only (`scripts/seed-demo.ts` refuses outside `APP_ENV=local`) |
| Lawyer, clinical lead | Read the docs and the spec comparison | none |

**How it works today.**

Test inventory (declarations counted by pattern; `it.each` expands some further):

| Layer | Files | Declarations | What it is |
|---|---|---|---|
| Unit (`vitest.config.mts`, jsdom) | 40 | 473 (+9 `it.each`) | Pure domain rules and libraries. Only two files touch the UI layer (`src/components/app/format.test.ts`, `src/lib/ui/api.test.ts`) |
| Integration (`vitest.integration.config.mts`, real PostgreSQL `medilink_test`, one file at a time) | 31 | 534 (+1 `it.each`) | One suite per module plus audit coverage, outbox recovery, authorization, dashboards. The largest are assignments 36, credential verification 28, facility verification 28, disputes 26 |
| Browser (`playwright.config.ts`, one worker, serial) | 10 | 44 (about 56 at run time) | Journeys through all three consoles; a Pixel 5 project runs `mobile.spec.ts` only (`:41-53`) |
| HTTP walk (`scripts/e2e.py`) | 1 | 45 checks | Not in CI |
| Total declarations | | 1,051 | The review's summary says "about 1,500" and its platform section "about 1,050"; `docs/testing-by-role.md:328-329` says 525 and 431 |

Pipeline (`.github/workflows/ci.yml`):

| Job | Needs | What it proves |
|---|---|---|
| quality (`:24-40`) | none | Lint, type-check, unit tests |
| migrations (`:42-74`) | none | Migrate up; reset and migrate again; load seed data into an empty database (it runs `pnpm db:seed`; the step name says "assert row counts" but only prints them) |
| integration (`:76-107`) | quality | The suite against a real database, including "no write without an audit row" and "no event lost when a consumer fails" |
| security (`:109-130`) | none | `pnpm audit --audit-level high` and a secret scan |
| e2e (`:131-185`) | quality | Starts PostgreSQL and MinIO, migrates, seeds, builds, starts the app and the worker, runs the browser tests; keeps the report and logs on failure; one retry on CI |

What the browser journeys cover (`tests/e2e/*.spec.ts`):

| Journey | Covered | Not covered |
|---|---|---|
| Practitioner | Sign-up with the real code; wizard and review step; NIN, licence and document submissions; submit for approval; offers; check-in and check-out; timesheet; dispute; earnings; the nine profile and shift pages at phone width | Availability form entry, privacy actions, excusals, forgot-password |
| Facility | Publish, rank, offer, confirm; attendance code; manual record; reject-needs-reason and approve; invoices; incident; switching between two hospitals | Facility registration form, staff page, rate cards, acting for an unverified facility, any facility page at phone width |
| Operations | Verify a facility; confirm identity and licence from evidence; credential review; take and decide a dispute; close an incident; invoice, issue, record payment, pay | Unhonoured shifts, suggestions, data requests, audit, agreements, staff, performance |
| Public | Sign-up, sign-in, signed-out redirect, API refusal for the wrong console | The landing page's content; keyboard and screen-reader behaviour |

Demo and test worlds:

- **`scripts/seed-demo.ts`** (3,013 lines). Local only. Builds through the application layer, not raw inserts, so audit rows, events and a balanced ledger exist for real. Window: 16 weeks (`:173`). **Five facilities:** Aso Garden Specialist Hospital (Abuja, the flagship), Adeola Memorial (Lagos), Dala Road General (Kano), Crystal Diagnostics & Imaging Centre (Port Harcourt, pending), Goodlife Clinic (Enugu, refused with reasons) (`:1805-1860`). **Forty practitioners** (11 named, 29 in the pool): 21 doctors, 12 nurses, 3 pharmacists, 2 laboratory scientists, 2 radiographers, in FCT, Nasarawa, Niger, Lagos and Kano. **Fifty-five accounts:** 5 platform (two super administrators, three administrators), 10 facility (the flagship has an owner and three administrators), 40 practitioners; derived from the code, the script was not run. It covers all five roles. **It contains nothing in Gombe.** Gombe exists only in the state and LGA reference data (`prisma/data/nigeria.ts`).
- **`scripts/e2e-world.ts`** builds the small tagged world for browser tests (email domain `e2e.medilink.test`, CAC prefix `RC99`) and `scripts/bootstrap-demo.ts` builds three accounts for the HTTP walk.
- **`prisma/seed.ts`** loads the controlled vocabularies and no people. What it holds is described under QAL-06.

Documents (every file in `docs/`, dated by last commit; detail in the gap table):

| Document | State against HEAD |
|---|---|
| `README.md` (10-04) | Mostly current; names two companion documents that are not in the repo |
| `docs/interfaces.md` | "What is not wired up" is wrong on three of five items; role wording is pre-merge |
| `docs/end-to-end.md` (10-04) | Account counts and the e2e file table are stale |
| `docs/testing-by-role.md` | Contradicts itself on facility roles; says the activation sweep runs hourly (it is daily, `src/worker/jobs.ts:51-56`); "onboard a new facility" has no screen; test counts stale |
| `docs/demo-walkthrough.md` | Role labels retired; says screening flags have no console (they do) |
| `docs/operations-console.md` (10-04) | Largely stale; cites a file that does not exist |
| `docs/running-a-demo.md`, `docs/database-refresh-2026-10-07.md`, `docs/verification-providers.md`, `docs/scheduled-jobs.md`, `docs/module-map.md` | Current in substance |
| `docs/stage-4-2-auth.md`, `stage-5-1…`, `stage-5-10…`, `stage-5-8/5-9…`, `stage-8-disputes.md` | Each contains at least one statement that code has since overtaken (step-up enforced; officer reads exist; self-service facility sign-up exists; the job scheduler exists; billing exists) |
| Other `stage-*` documents and ADRs | Not individually re-verified |

The spec comparison. The v2.9 text lists nine roles; the code has five (`src/lib/authz/permissions.ts:185-260`):

| v2.9 role | Code role | What differs |
|---|---|---|
| Practitioner | `practitioner` | Same |
| Facility Owner | `facility_owner` | Same, plus `role.grant` and `dispute.manage` (`:199`) |
| Facility Administrator (profile, branches, departments, staff) | `facility_administrator` | Runs the whole facility operation (`:140-147`); cannot add staff (owner only); no profile screen; branches and departments not built |
| Facility Scheduler | `facility_administrator` | Retired role mapped to it (`:234`) |
| Facility Finance Officer | `facility_administrator` | Retired role mapped to it (`:235`); the facility role holds `payout.manage` (`:145`) |
| Medilink Operations Officer | `administrator` | Retired and merged (`:231`) |
| Medilink Compliance Officer | `administrator` | Merged (`:232`); the spec says only a compliance officer may apply, vary or lift a sanction, and every administrator now holds `sanction.apply` (`:180`) |
| Medilink Finance Officer | `administrator` | Merged (`:233`); the same person can generate, issue, mark paid, prepare and release |
| Super Administrator | `super_administrator` | Same; the only difference from `administrator` is `config.manage` (`:203-218`) |

**Rules the system enforces.**

- A migration must go up, down and up again on an empty database before a change merges (`ci.yml:68-71`).
- A write to an audited table with no audit row fails the integration suite, and a model in neither the audited nor the exempt list fails it too (`docs/CONTRIBUTING.md:51-54`).
- A consumer failure must not lose an event; `tests/integration/outbox.test.ts` covers recovery (the review also reports a two-worker concurrency test, not re-read here).
- Lint, types, unit and integration tests run on every pull request, and the end-to-end job needs the quality job (`ci.yml:5-8,76-80,131-137`). Whether merging is blocked on a red build depends on branch settings that are not visible in the repository.
- Dependencies with a high-severity advisory and committed secrets fail the pipeline (`ci.yml:124-130`).
- The console SMS adapter and the demo scripts refuse to run outside `local`; production boot refuses published secrets, console SMS and console payments (`src/lib/env-rules.ts:53-60`; `scripts/seed-demo.ts:1-41`).
- The browser tests build their own tagged world and never touch the demo data (`docs/end-to-end.md:188-198`).

**The review said X; at HEAD it is fixed or differs.** The review said the squashed migration baseline was uncommitted; the baseline `20261007000000_baseline` and four later migrations are committed (`prisma/migrations/`). The review said the backup script cites a document that does not exist; not re-checked here.

**What is not there yet.**

| ID | Gap | Sev | Source | Evidence |
|---|---|---|---|---|
| QAL-01 | No suite proves that every route taking an id refuses a caller from another tenant, the pattern behind the review's most serious findings. Per-module 401 and 403 cases exist, but I did not check them route by route. | P0 | REVIEW | `docs/CONTRIBUTING.md:73-81`; `tests/integration/authorization.test.ts` |
| QAL-02 | The pipeline builds and tests but has no image build, no release and no deploy job, and no staging environment. Whether the production image contains the worker's source was not verified here (platform slice). | P0 | REVIEW | `.github/workflows/ci.yml:24-185` |
| QAL-03 | No component tests and no accessibility checks anywhere; the phone-width tests cover the practitioner console and the public pages only, never the facility or operations consoles. | P1 | NEW | `vitest.config.mts:7-10`; `tests/e2e/mobile.spec.ts:21-50`; `package.json` (no accessibility tooling) |
| QAL-04 | The Slow-4G page budget, the load test, the backup drill and the HTTP walk are manual scripts, not run by CI. | P1 | NEW | `scripts/page-budget.mjs:1-18`; `scripts/load-test.ts`; `scripts/backup-drill.sh`; `ci.yml` |
| QAL-05 | The demo and rehearsal data has no Gombe facility or practitioner, so a Gombe meeting would be shown Abuja, Lagos and Kano. | P1 | NEW | `scripts/seed-demo.ts:1805-1860`; `prisma/data/nigeria.ts` |
| QAL-06 | The v2.9 Section 11.2 seed list is not met: requirements for doctors only; specialties for doctors (12) and nurses (3) only; six credential types, all doctor-flavoured; four rate-floor rows (doctor and nurse, day and night); six fixed 2026 holidays and none for 2027; seven facility types and no ownership types; regulators as text, not a list; no engagement agreement template and no notification templates in the seed; owners are named but no review date; loaded by `db:seed`, not by migrations. Owned by the Config chapter. | P0 | V2.9 | `prisma/seed.ts:36-42,73-77,100-107,127-150,194-201,253-262,273-282,301-312`; `v29.md:960-964` |
| QAL-07 | Documents describe a product that no longer exists, which misleads a new developer: the statements listed in the document table, plus the activation sweep described as hourly in `docs/testing-by-role.md:134` (it is daily) and conflicting test counts. | P1 | REVIEW | `docs/operations-console.md:24-27,59`; `docs/interfaces.md:125-141`; `docs/stage-5-10-facility-verification.md:23,55,104`; `docs/stage-8-disputes.md:142-147` |
| QAL-08 | The spec (v2.9) and the Implementation Plan (v1.2) named in the README are not in the repository, while code comments and tests cite their sections ("Implementation Plan §2.1", "Section 8.8", "step 4.5"). The v2.9 text has been supplied separately for this study. | P1 | NEW | `README.md:4`; `docs/CONTRIBUTING.md:3`; `docs/scheduled-jobs.md:14`; `tests/integration/outbox.test.ts:10` |
| QAL-09 | The role set diverges from the spec (table above). Separation of duties between compliance, operations and finance, and between a facility scheduler and finance officer, is gone, and a maker-checker on money is absent. | P1 | V2.9 | `src/lib/authz/permissions.ts:140-183,230-236` |
| QAL-10 | The browser tests leave the facility registration form, staff, rates, unhonoured and excusals, suggestions, data requests, audit, agreements, privacy actions and availability entry unexercised. | P1 | NEW | `tests/e2e/*.spec.ts` (page list) |
| QAL-11 | No feature flags. The spec's rollout tool for "matching in Lagos only" and a state-by-state launch does not exist, so a second state would mean a code change. | P1 | V2.9 | `v29.md:290-292`; no flag table in `prisma/schema.prisma` |
| QAL-12 | Each module's `tests/` folder is an empty placeholder (tests sit beside the domain code or under `tests/integration`), and the migrations job's comment says seed data loads "by migration alone" while it runs the seed script. Small, but the spec and the pipeline both say otherwise. | P2 | NEW | `src/modules/scheduling/tests/.gitkeep`; `ci.yml:73-74` |

**Recommended change (v3).**

*Phase 0.* Write the cross-tenant refusal test for every id-taking route, generated from the route list so a new route without a case fails the build (QAL-01). Add an image build and a staged deploy to the pipeline, with the worker included, and a restore drill (QAL-02, with Platform). Complete the Section 11.2 seed list, loaded and checked in CI, with owners and review dates (QAL-06, with Config). Correct or archive the stale documents, putting a "last verified against code" date on each, and add the v2.9 spec and Implementation Plan to `docs/` or remove the citations (QAL-07, QAL-08).

*Phase 1.* Add a Gombe demo world: a government hospital, a PHC and a private clinic with Gombe LGAs, practitioners across the five professions and the levels once defined, and a lab (QAL-05). Extend the browser tests to the missing journeys and to the facility and operations consoles at phone width, and add keyboard and accessibility checks (QAL-03, QAL-10). Put the page budget into CI (QAL-04). Introduce feature flags before a second state (QAL-11). Decide the role set with the founder: keep five roles and add a maker-checker on payouts and a named-person rule for sanctions, or restore the three platform and two facility roles (QAL-09).

*Phase 2 onward.* Contract tests for the Booking function and the proposal flow; a test that every notification event has a handler and a template; a reconciliation test run nightly against the payment provider's sandbox.

**Acceptance criteria.**

1. Given the list of routes that take an id, when CI runs, then each has a test where a caller from another facility or user is refused, and adding a route without one fails the build.
2. Given a merge to `main`, when CI is green, then an image containing the app and the worker is built and deployed to staging, and a failed deploy blocks the next one.
3. Given an empty database, when migrations and seed run, then every list in v2.9 Section 11.2 is present with a named owner and review date, and the job asserts the row counts.
4. Given the Gombe demo world, when an operator signs in as each role, then they see Gombe facilities, LGAs and practitioners and no record outside the pilot area.
5. Given the facility and operations consoles, when the end-to-end suite runs at phone width, then no page scrolls sideways and the main action on each page is reachable by keyboard.
6. Given any document in `docs/`, when it is opened, then its header states the commit it was last verified against, and a statement known to be wrong is not present.
7. Given the role decision, when an administrator prepares a payout, then a different person must release it, and the audit row names both.
8. Given a flag for a state, when it is switched off, then matching and publishing refuse requests from that state and say why.

---

# v2.9 module numbering vs repo numbering

The repo's own numbering is `docs/module-map.md:7-26`. It splits v2.9 Module 9 into attendance and timesheets, which shifts the repo numbers for v2.9 Modules 10 to 15 up by one. v2.9 Module 16 has no repo module and is folded into the `/admin` console (confirmed: no administration folder in `src/modules`, no row in the module map). Numbers 17 and 18 coincide again. A "Module 11" or "Module 12" in repo documents means rates and billing, which are v2.9 Modules 10 and 11.

| v2.9 module number and name | Repo module or console | Status |
|---|---|---|
| 1. Authentication and Access Control | `auth` (repo 1) | Built; spec extras (optional second factor, device management, administrative impersonation) not verified |
| 2. Practitioner Management | `practitioners` (repo 2) | Partly built: no level, cadre or skills model |
| 3. Credential and Compliance Verification | `credentials` (repo 3), identity assurance inside `practitioners` | Partly built: requirements for doctors only; no provider; no selfie match |
| 4. Healthcare Facility Management | `facilities` (repo 4) plus Console B and Console C screens | Partly built: no profile screen, no licence upload, no branches or departments |
| 5. Practitioner Availability | `availability` (repo 5) plus the profile tab in Console A | Partly built: weekly pattern and blocks only; no listing, rate or level |
| 6. Service Request and Shift Management | `service-requests` (repo 6) plus Console B shifts | Built: no level, edit, clone or recurrence |
| 7. Matching and Assignment | `matching` (repo 7) | Built; fixes needed (candidate contact details, re-checks at invite and confirm) |
| 8. Scheduling and Calendar | `scheduling` (repo 8) | Stub: only `permissions.ts` and `routes.ts`; the assignment list lives in `matching` |
| 9. Attendance and Timesheet Management | `attendance` (repo 9) and `timesheets` (repo 10) | Built: split into two repo modules; QR needs a scanner; no server-side window (not verified) |
| 10. Rates, Contracts and Engagement Terms | `rates-contracts` (repo 11); agreements live in `audit-compliance` | Partly built: rate floors for doctor and nurse; rate cards; agreements not enforced |
| 11. Billing, Payments and Settlement Ledger | `billing-settlement` (repo 12) plus Console C money screens and Console B invoices | Partly built: invoices and a balanced ledger; the payment gateway is a stub |
| 12. Cancellation, No-Show, Fault and Sanctions | `cancellations-sanctions` (repo 13) plus Console C unhonoured | Partly built: fault and excusal; no sanction ladder; no appeal |
| 13. Dispute and Case Management | `disputes` (repo 14) plus Console C | Partly built: practitioner-initiated, officer-decided; no facility or evidence screens |
| 14. Clinical Incident Reporting | `clinical-incidents` (repo 15) plus Console B and C screens | Built, with gaps in notice and referral records |
| 15. Notifications and Communication | `notifications` (repo 16) | Stub to partly built: SMS interface and one handler; no working provider, email, push, WhatsApp or inbox |
| 16. Administration and Operations | No repo module; Console C `/admin` | Built as a console; shares tables with modules 3, 4, 13, 14 and 17 |
| 17. Security, Privacy and Audit | `audit-compliance` (repo 17) plus `src/lib/{audit,authz,outbox}.ts` | Partly built: audit, consent, agreements, export; erasure is an assessment only |
| 18. Suggestions and Product Feedback | `suggestions` (repo 18) plus the console header dialog and Console C | Built; the author cannot read the response |
| 19 to 25 (ratings, rostering, reports, credential renewal and CPD, tax statements, preferred pools, fraud) | None | Not built |
| 26. Customer Support | None | Not built; no contact surface anywhere |
| 27. Low-Bandwidth and Mobile Experience | None (cross-cutting: `src/lib/ui`, `public/manifest.webmanifest`) | Partly built: responsive, manifest without icons, no service worker |
| 28. Mobile Application (Flutter) | None | Not built (ADR 0003 only) |
| 29 to 36 (Priority 2 ecosystem modules) | None | Not built |
| (reference data, Sections 8.6 and 11.2) | `config` in `src/modules` (not in the module map) | Partly built: see QAL-06 |

---

# Cross-module dependencies

## Identity, access, notifications, compliance and platform

- **Module 2 Practitioners and Module 3 Credentials.** Eligibility needs the requirement rows, level lists and sanctions entries in the Reference data chapter (CFG-01, CFG-03, CFG-04); until they exist the rule has nothing to check for four professions. They also need consumers for `credential.verified`, `credential.expired` and for reject and request-more events that do not exist yet (NOT-01; CRE-07, CRE-08). Erasure and retention must reach rejected documents and the stored NIN hash (AUD-01, AUD-04).
- **Module 4 Facilities.** Self-registration makes the registrant a `facility_owner` while the facility is PENDING (AUT-07); the fix is to gate that role's powers on VERIFIED status. `facility.verified` needs a consumer and rejection needs an event (NOT-01; FAC-09). A hospital's acceptance of terms must be stored against the facility (AUD-03). The single "representative" is the only person texted (NOT-10; FAC-08).
- **Module 6 Service requests and Module 11 Rates.** A missing pay floor silently passes (CFG-02). Publication must refuse when no floor applies, and floors must be keyed by level once the ladders exist (CFG-04).
- **Module 7 Matching and Module 8 Scheduling.** Cancelling an assignment publishes no event, so nobody is told (NOT-01; MAT-05). Reminders and the early no-show alert are new jobs for Annex P3 and need a working SMS provider (NOT-02, NOT-12; SCH-02). Every id-taking route in these modules needs a cross-tenant refusal test (AUT-10).
- **Modules 9 and 10 Attendance and Timesheets.** `shift.started`, `timesheet.submitted` and `timesheet.approved` need consumers; `shift.completed` already builds the timesheet and should also tell the practitioner it is ready (Annex P2). A facility that never approves stalls payment: auto-approval is a new sweep (TIM-01, TIM-11).
- **Module 12 Billing.** The fee must come from the dated fee policy, not `PLATFORM_FEE_BP` (CFG-12). One permission raises, issues, marks paid, prepares and releases, with no step-up (AUT-18). `payout.settled`, `payment.completed` and `invoice.created` have no consumer. Provider callbacks need idempotency keys and signature checks that do not exist yet (PLT-13).
- **Module 14 Disputes and Module 15 Incidents.** The same "claimed scope, not the record's scope" shape as AUT-01 appears in dispute evidence and incident subjects. `dispute.opened` and `clinical_incident.reported` need consumers (DSP-03, INC-03). Suspension does not revoke sessions, and reinstatement revives old ones (AUT-13).
- **Module 18 Suggestions.** An author should be told when their suggestion is answered, which needs the notification module.
- **UX.** The forgot-password screen (AUT-06), the privacy-notice and terms step at sign-up (AUD-03), the invitation flow for staff (AUT-07), the in-app inbox (NOT-07), and the admin screen for reference data (CFG-05) are interface work for the product chapters. The login page still names a seed script and a document in its footer text (`src/app/(auth)/login/page.tsx:119-123`).
- **Worker and platform.** Every new consumer must be safe to run twice, and failing sends must fail the event so the outbox retries (NOT-03). New sweeps must not share the outbox's thread (PLT-06).
- **Legal.** Items marked [Counsel] in AUD-05, AUD-11, AUD-12, PLT-19 and the fee and payment chapters need counsel's confirmation before they are built.

---

## Practitioners and credentials

- **Module 7 Matching.** Must call one booking-time check for eligibility, level and supervision at invitation, acceptance and confirmation (PRA-26), and carry the specific blockers into the run instead of a single `not_eligible`. The name-and-phone leak is added in Matching, not here (`matching/application/match.ts:161-179`); the candidate function in this module carries neither.
- **Module 6 Service requests and Module 11 Rates.** A shift must name a required level and match rule, and rate floors must be keyed by level, or PRA-01 cannot take effect. Specialty is today a hard filter that also excludes people with no specialty (`matching/domain/engine.ts:143-146`).
- **Module 16 Notifications.** Needs handlers for `credential.verified`, `credential.expired`, `sanction.applied` and for reject, request-more, suspension and reinstatement events, and a real SMS provider (CRE-07, CRE-08).
- **Module 15 Clinical incidents.** Writes `users.status` that the rule reads. Its own chapter must cover the unconstrained incident subject (`clinical-incidents/application/incident.ts:143-150`), the generic lock-out message a suspended person sees (`auth/domain/errors.ts:51-52`), the lack of a facility-specific or pending-review suspension, and closure notes reaching the reporting facility.
- **Module 1 Authentication.** Officer-assisted account recovery (PRA-22), a stronger second factor for officers who confirm identities, and key management for `SESSION_SECRET`, which also keys the NIN hash (PRA-11).
- **Module 12 Billing and Module 17 Audit.** A bank-account model is needed before a reuse check is possible (PRA-21). Retention and erasure must cover rejected documents and the NIN hash (CRE-14).
- **Module 4 Facilities and the facility console.** The verification panel (PRA-16) is read by facility screens that do not exist yet; it needs a consent-gated read function, not table access.
- **Config.** Categories, specialties, credential types, requirements and the sanctions list change only by seed and deploy; an audited admin screen is the other half of PRA-14, PRA-25 and CRE-01.
- **Worker.** The sweeps share one process with the outbox, and a slow nightly screen can delay the sign-up role grant. They need separate loops (platform slice).

## Facilities, availability, requests, matching and scheduling

- **Module 2 and 3:** eligibility is read at match time only; MAT-03 depends on re-using the same pure function at invite and confirm.
- **Module 10 and 12:** the rate lives on the request, not the booking, so timesheets and invoices read the request at compute and invoice time. A booking-level rate snapshot (MAT-09) changes both modules.
- **Module 13 and 14:** cancelling an assignment must not create an unhonoured-shift flag; a no-show decision changes assignment status through the matching module.
- **Module 16 (notifications):** MAT-03, MAT-05 and SCH-02 all need consumers for `shift.invited`, `shift.accepted`, `assignment.cancelled` and reminder events that do not exist yet (see NOT-01).
- **Module 17:** the facility audit trail does not show a facility's own invitations (MAT-16); a decision is needed about which scope those rows carry.

## Attendance, timesheets, sanctions, disputes, incidents and suggestions

- **Module 12 Billing (money slice).** The invoice prices from the timesheet's overlapping night and holiday minutes, not from a Booking, and picks the facility's active rate card at invoice time (TIM-02, TIM-03). It selects only shifts whose attendance is Approved, so a shift disputed before invoicing drops out whole and one already invoiced is untouched (DSP-05, DSP-10). Credit notes and reversal entries do not exist, and the invoice status "void" has no writer. Practitioner earnings are credited when the invoice draft is created, before any dispute or payment. All four need a decision in Module 12 before dispute holds can work.
- **Module 7 Matching and Module 6 Service requests.** Cancelling a request must cancel its bookings (SAN-02). Eligibility, suspension and the one booking function must run at invitation and confirmation, not only at match time. The Booking must carry the shift window, the cancellation rule, the agreed rate and the premium snapshot that Modules 9, 10 and 13 read. Reliability (completed over completed plus no-show) and its cold-start rule live here and need the fix in SAN-16.
- **Module 16 Notifications.** Needs handlers for `shift.started`, `timesheet.submitted`, `timesheet.approved`, `no_show.recorded`, `dispute.opened` and `clinical_incident.reported`, plus new events for rejected or corrected timesheets, excusal and fault decisions, dispute review and resolution, incident closure and suspension, and suggestion answers. It also needs an in-app inbox, a real SMS provider and West Africa Time on every message.
- **Module 1 Authentication and the permission map.** A suspended account is refused a session by the auth layer; the message must change (INC-06). Several fixes need permission changes: `dispute.manage` for the facility administrator (DSP-04), `incident.report` for practitioners (INC-07), and a separate compliance-officer permission (SAN-14, INC). Every id-taking route in this slice needs a test that a caller from another tenant is refused; several have none today (issuing a code, recording by hand, the dispute list for a shift, and all the evidence routes).
- **Module 2 Practitioners and eligibility.** A suspended account makes the matching rule fire `account_not_usable`. Reinstating sets the account to active whatever it was before (INC-13).
- **Module 17 Audit and compliance.** Legal hold, a retention schedule and a log of records produced to a court or the Council (INC-10). The data export omits attendance, timesheets, disputes and incidents. Audit rows hold the only history of earlier reviews and of suggestion status changes (TIM-09, SUG-04).
- **Module 4 Facilities.** The facility owner holds more than the facility administrator (disputes, role grants). `FacilityStatus.SUSPENDED` is reachable by no code path, so the facility-side meaning of "suspended" is unused.
- **Config and reference data.** The holiday table has no editing screen and no region; the night window is a constant; reference data should be owned by operations and compliance (TIM-05).
- **Platform and worker.** The unhonoured sweep is the only job in this slice. Early no-show detection, timesheet deadlines, dispute targets and incident deadlines each need a new sweep, and the sweeps share the loop with the outbox. A handler failure that retries to the dead-letter queue (TIM-08) needs an operator view.
- **Storage.** Dispute evidence uses the same object store as credentials: signed upload and download links, with no malware scan, no retention rule and no deletion on erasure.
- **Facility and practitioner consoles (UX).** A facility dispute console, a practitioner case screen with evidence, a QR display and scanner, a facility cancel screen and a "not checked in" roster flag are screens that do not exist.

---

## Rates, billing, ledger and payouts

- **Timesheets (TIM):** must persist the mutually exclusive bands (computed in `hours.ts:183-189`, never stored) and should price once at approval; the stored amount is base only. Holiday data lives in config and feeds the holiday premium.
- **Booking / assignments (MAT):** the snapshot (agreed rate, four multipliers, later the fee policy and origin) belongs on the Booking; billing must price from it. Today the assignment holds no money fields and the rate sits on the request.
- **Service requests (REQ):** the floor check, shift-type derivation, rate pre-fill and ceiling live there; floors need a level dimension once levels exist.
- **Disputes (DSP) and attendance (ATT):** an upheld dispute must call billing to post a reversal or hold; a DISPUTED shift must block payout of the disputed part.
- **Config (CFG):** floors, holidays and the fee policy need audited edit screens and must stop being seed-only; seeds must not overwrite edited values.
- **Auth (AUT):** step-up set, `payout.manage` placement in roles, a preparer-differs-from-releaser rule, and a separate release permission (v2.9 names `payment.release`).
- **Practitioners (PRA) and facilities (FAC):** the payout bank account and its verification belong with the practitioner record; facility TIN and billing contact belong with the facility.
- **Notifications (NOT):** invoice issued, payment received, payout sent and payout failed currently publish nothing a handler can send.
- **Audit and compliance (AUD):** facility dashboards read `billing.invoices` directly; correlation ids are missing on money writes; erasure keeps the ledger by design; agreement acceptance is not required before a shift is accepted or billed.
- **Platform (PLT):** boot-time rules for payment provider and fee settings, 64-bit money columns, ledger-sum alert, database protection for the ledger, scheduled reconciliation jobs.

---

## The three consoles, the public site, accessibility and quality

- **Notifications (v2.9 Module 15, repo 16).** UXP-01, UXF-05 and UXW-02 are one piece of work. The product needs a deliverable SMS provider with failover, handlers for every event a person must hear about, an in-app inbox with a bell in the shared shell, and West Africa Time in the message text (`src/modules/notifications/application/handlers.ts` prints UTC today).
- **Matching (Module 7) and Service requests (Module 6).** The offer card (UXP-02) can show address, notes, cancellation terms, premiums and total pay only when the invitation and assignment queries return them (`src/modules/matching/application/assignment.ts:793-802`). The shift form needs a level and match rule (UXF-06) from the levels model. The match response must stop carrying phone numbers (UXF-04).
- **Practitioners, Credentials and Config.** UXP-03 and UXP-07 depend on seeded requirements for the other four professions and on the level, registration-category and skills model. QAL-06 and UXO-05 depend on an audited screen for reference data and rate floors.
- **Facilities (Module 4).** UXF-01 to UXF-03 and UXO-01 and UXO-02 need the module to accept a non-CAC reference, a licence upload and a resubmission path after rejection, and to record what an officer checked. `cac_number` is a required unique column today (`prisma/schema.prisma:567`).
- **Timesheets, Billing and Disputes.** UXF-07 needs one price shown at approval and the invoice reading the same figure; UXO-03 needs payment reference capture and a second approver; UXP-09 and UXO-09 need dispute status, evidence and a facility response. The booking should snapshot rate, premiums and fee so the screens can show them without recomputing.
- **Attendance.** The check-in window is enforced by the screen (UXP-12); the offline queue (UXA-09) needs idempotent check-in and timesheet endpoints so a replay cannot book twice.
- **Authentication and Audit.** UXW-01 to UXW-04 need the reset flow, officer-assisted recovery, a consent and acceptance record at sign-up, and one set of versioned terms that both the consoles and the public pages render. UXO-04 needs a real erasure job.
- **Platform and delivery.** QAL-02 needs the image and deploy work in the platform slice; QAL-04 and UXA-09 need the page budget and the offline test run in CI; the worker's single process affects how fast a sign-up grant arrives (`register/page.tsx:170`).
- **Strategy and target design.** Hausa (UXA-12), larger-text and projector modes (UXA-04), the anonymous shift board and the priced listing (UXP-05, UXW-11) are v3 features that the lead's target design places in Phases 0 to 2; the numbers in the targets table are the acceptance bar for them.

# The shift-day state glossary

v2.9 §9.17 requires these words never to be used interchangeably. This table defines each one as **the code uses it today**, says where it is a stored value, and names the words it is most often confused with. A word that appears in a column the table says it does not appear in is a bug in the writing, not a feature.

| Word | What it means in the code today | Where it is a stored value (aggregate → value) | Not to be confused with |
|---|---|---|---|
| **Confirmed** | The facility chose this practitioner for this shift and pressed Confirm. The assignment exists. It stays Confirmed through the shift, and even after attendance is Approved, until the shift is completed, cancelled or marked a no-show | **Assignment** → `CONFIRMED` (`prisma/schema.prisma:1117-1125`; default `:1086`; `src/modules/matching/domain/assignment.ts:12,41-48`). Not on attendance, timesheet, invoice, payout, credential, account or facility | An invitation is **Accepted** when the practitioner says yes (`domain/assignment.ts:5-10`). A request is **Filled** when the headcount is reached. An officer "confirms" a licence from evidence (`src/modules/practitioners/application/confirm-from-submission.ts`), which records a registration, not a Confirmed state |
| **Approved** | The facility accepted the timesheet's hours. It is the only state that makes a shift invoiceable | **Attendance record** → `APPROVED` (`src/modules/attendance/domain/state-machine.ts:17`); event `timesheet.approved`; invoicing selects it (`src/modules/billing-settlement/application/invoice.ts:143`). The timesheet row has no status; the assignment becomes **Completed**; an invoice goes Draft, Issued, Paid. For a credential or a facility, "approve" is the officer's action and the stored result is **Verified** | Verified (documents or facility), Active (an account), Completed (the assignment after approval), Paid |
| **Verified** | A person at Medilink checked the evidence for this thing | **Credential submission** → `VERIFIED` (`prisma/schema.prisma:545`); **Facility** → `VERIFIED` (`:618`; a facility must be Verified to publish, `src/modules/facilities/domain/facility.ts:44`). A practitioner has no "verified" status: identity is a row with a verified time, a registration holds `ACTIVE`, screening holds `CLEAR`. Never on assignment, attendance, timesheet, invoice, payout or account | Eligible (a computed answer), Active (an account label), a verified phone number (a code sent by SMS) |
| **Eligible** | Computed, never stored. True when the ten-blocker list is empty (account usable, profile, identity, active registration, fresh evidence, required documents, clear screening) | **Nowhere.** `isEligibleForMatching` (`src/modules/practitioners/domain/eligibility.ts:52-105`) is read at match time and on practitioner and officer screens; no column holds it. An account that is Under review passes as well as one that is Active | Active (the label), Verified (the documents), Confirmed (a shift) |
| **Active** | Means a different thing on each aggregate. Always an *ongoing, in-force* state | **Account** → `ACTIVE` (`prisma/schema.prisma:67`; set by a daily sweep for eligible Under-review accounts, `src/modules/practitioners/application/eligibility.ts:238-263`, and by reinstatement). **Registration** → `ACTIVE` (`:734`: the regulator's register says the licence is in force). **Rate card** → `ACTIVE` (`:1822`: the facility's current card). Not on assignment, attendance, timesheet, invoice, payout or facility (a facility uses Verified) | Eligible; Verified. The account label is cosmetic, because the rule accepts Under review too |
| **Suspended** | **Three meanings.** (1) A platform-wide block on an account: the person is signed out and excluded from matching. (2) A regulator's status for a licence that an officer recorded: the registration blocker fires. (3) A facility status that no code can set | **Account** → `SUSPENDED` (`prisma/schema.prisma:68`; set only by an incident closure, `src/modules/clinical-incidents/application/suspension.ts:87-128`). **Registration** → `SUSPENDED` (`:735`). **Facility** → `SUSPENDED` (`:623`, "reachable by no code path"). Not on any shift-day aggregate | Deactivated (set by no code); a facility-specific or pending-investigation restriction (does not exist; v2.9 asks for it); Cancelled; Rejected |
| **Disputed** | A shift's record is on hold while a case is decided | **Attendance record** → `DISPUTED` (`src/modules/attendance/domain/state-machine.ts:19`). The case itself is a **Dispute** with status `OPEN`, `UNDER_REVIEW`, `RESOLVED` or `WITHDRAWN` (`prisma/schema.prisma:1508-1516`), never "disputed". Not on timesheet, invoice, payout or ledger | The Dispute status "Open"; a rejected timesheet (which can be corrected or disputed) |
| **Settled** | The payment provider reported that money went to the practitioner | **Payout** → `SETTLED` (`prisma/schema.prisma:1966-1972`; `src/modules/billing-settlement/application/payout.ts:171`); event `payout.settled`. Invoices are never "settled"; they are Paid. Nothing on a shift-day aggregate | **Third use:** `settleUnhonouredAssignment` writes the result of a fault decision onto an assignment (`src/modules/matching/application/assignment.ts:1016`); it has nothing to do with money. v2.9's financial "Settled" for a booking does not exist |
| **Paid** | An officer pressed "Record payment" after seeing the facility's bank transfer. No money moves in the system | **Invoice** → `PAID` (`prisma/schema.prisma:1865-1873`; `src/modules/billing-settlement/application/invoice.ts:301-330`). The practitioner's receipt is called "paid out" in v2.9 and is the payout's `SETTLED`. Not on attendance, timesheet or assignment | Credited (earnings are credited when the invoice **draft** is made, before any payment); Settled; the practitioner screen's "Nothing is paid until you [submit]" (`src/app/practitioner/timesheets/page.tsx:152-154`), which means "nothing is billed" |

**One shift in the right words.** The assignment is **Confirmed**. The attendance record goes Not started, Check-in pending, Checked in, Checked out, Submitted, then **Approved** (or Rejected, or Disputed). The assignment then becomes **Completed**. An invoice is raised (Draft), issued, and **Paid** when an officer records the facility's transfer. A payout is Prepared, Released and **Settled**. The words **Captured** and **Reversed** exist in v2.9 §9.17 and in no stored value in the code.

**Other words that are easy to mix.**

| Word | Where it is used | The difference |
|---|---|---|
| **Completed** | Event `shift.completed` and assignment status `COMPLETED` | The event fires at **check-out** (or a hand record) and triggers the timesheet. The status is set only after the facility **approves** the timesheet |
| **Submitted** | Attendance state `SUBMITTED` | The practitioner has sent the hours. Not "submitted for review" (a practitioner's application) and not "submitted" for a credential |
| **Cancelled** | Assignment status; service request status | The assignment is Cancelled by a facility, or by a fault decision of Facility or Neither. A cancelled request does not cancel its assignments |
| **No-show** | Assignment status `NO_SHOW` | Set only after an officer finds the practitioner at fault. A shift that merely ended with nobody there is "awaiting decision" (unhonoured), not a no-show |
