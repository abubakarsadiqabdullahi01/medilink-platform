# Medilink Module Completion Plan v1.1

**Document type:** implementation and sign-off plan  
**Status:** working source of truth for delivery  
**Prepared:** 14 October 2026 (v1.0); re-baselined the same day (v1.1)  
**Application baseline:** `main` at `9a93861` (v1.0 was written against `6a2ce43`)  
**Product scope:** Gombe pilot first; expansion only after the pilot gates pass

| Version | What changed |
| --- | --- |
| v1.0 | The plan as first written, against `main` at `6a2ce43`. |
| v1.1 | Re-baselined to `9a93861`, which carries the Phase 0 work (87 of the 119 P0 gaps fixed, 18 fixed in part, 14 not done). Section 5 lists what that closed; Section 7 carries an evidence column; task marks in Sections 8 and 9 say what is done, partly done or open; G0 in Section 12 records the evidence. **No module status was promoted**: promotion needs the sign-offs in Section 3, and none has been given. The full gap-by-gap reconciliation of all 410 gaps is in [Gap-Reconciliation.md](Gap-Reconciliation.md): **104 closed, 86 partly closed, 220 open** (P0: 87, 18 and 14; P1: 16, 61 and 148; P2: 1, 7 and 58; the P1 changes after `9a93861` are listed in that file). The P1 and P2 marks are one reading of the code and were not tested. |

---

## 1. Purpose

This document turns the System Blueprint and Module Reference into an ordered delivery plan. It tells the team:

1. which module to work on next;
2. what “complete” means for that module;
3. which work must be done in order;
4. which tests and evidence are required;
5. who must approve it; and
6. which later modules must wait for it.

It is not a replacement for the two design documents:

- **System Blueprint v3.0** explains the product, strategy, target flows and gap register.
- **Module Reference v3.0** contains the detailed current behaviour, file evidence and original acceptance criteria.
- **This Completion Plan** controls implementation order, current status and sign-off.
- **[Phase0-progress.md](Phase0-progress.md)** records, for each P0 gap, what was changed, how it was shown to work, and what was not done. **[Gap-Reconciliation.md](Gap-Reconciliation.md)** extends that to all 410 gaps.

When documents disagree, use this precedence:

1. signed legal, regulatory and clinical-safety decisions;
2. an approved Architecture Decision Record (ADR);
3. this completion plan’s latest reviewed status;
4. System Blueprint v3.0;
5. Module Reference v3.0;
6. older v2.9 and implementation-plan documents.

Do not silently change a rule in code. Record the decision first, then update all affected documentation in the same pull request.

---

## 2. Status language

| Status | Meaning |
| --- | --- |
| `NOT STARTED` | No usable implementation exists. |
| `STUB` | A route, page or data shape exists but the complete workflow does not. |
| `PARTIAL` | The main workflow exists, but material safety, usability or operational work remains. |
| `CORE READY` | The happy path and main exceptions work, but final pilot gates or external services remain. |
| `PILOT READY` | Approved for controlled use in Gombe with named support and monitoring. |
| `PRODUCTION READY` | Security, operations, compliance, scale and support gates are satisfied for public use. |
| `BLOCKED` | Work cannot safely continue until the named decision or dependency is resolved. |

“Code exists” does not mean “module complete.” A module is complete only at the readiness level explicitly approved for it.

**Task marks.** In Sections 8 to 10 a task is marked `[x]` when it is done, `[~]` when part of it is done (the note says which part and what remains), and `[ ]` when it is open. A mark is made only where the code, a test or a commit shows it; a task with no mark has not been checked, not “probably done”. Commit hashes are on `main`.

---

## 3. Definition of complete for every module

A module may be marked `PILOT READY` only when every applicable item below is checked.

### Product and workflow

- [ ] A named product owner has approved the problem, users, workflow and wording.
- [ ] Happy path, rejection, cancellation, timeout, retry and recovery paths are documented.
- [ ] Empty, loading, unavailable, forbidden and error states are usable.
- [ ] The interface tells the user what happened and what to do next.
- [ ] Mobile, desktop and the Gombe demonstration display have been checked.

### Data and domain rules

- [ ] The state machine, invariants and allowed transitions are written down.
- [ ] Database constraints protect invariants that must survive concurrency.
- [ ] Mutable commercial and policy terms are snapshotted when an agreement is made.
- [ ] State and reference data have owners, versions and review dates.
- [ ] Migration, rollback and existing-data handling are documented.

### Security and privacy

- [ ] Authentication, permission, tenant-scope and record-ownership checks are present.
- [ ] Every route taking an identifier has a cross-tenant refusal test.
- [ ] Sensitive values are minimised, masked in responses and omitted from logs.
- [ ] Rate limits, abuse cases and audit events are defined.
- [ ] Privacy, retention, export and deletion effects are known.

### Testing

- [ ] Domain/unit tests cover every business rule and state transition.
- [ ] Integration tests cover the database, transactions, permissions and concurrency.
- [ ] Browser tests cover the critical journey and its most dangerous failure path.
- [ ] Accessibility checks cover keyboard use, labels, focus, contrast and large text.
- [ ] Lint, typecheck, unit, integration, browser and production-build checks pass from a clean checkout.

### Operations

- [ ] Logs use identifiers and outcomes without leaking secrets or clinical details.
- [ ] Metrics, alerts, retry policy and dead-letter handling are defined where needed.
- [ ] Runbook, owner, support response and rollback procedure exist.
- [ ] External provider failure has a visible and safe fallback.
- [ ] Backup and restore impact is understood and tested for material data.

### Approval

- [ ] Engineering review complete.
- [ ] QA evidence linked.
- [ ] Product owner sign-off complete.
- [ ] Clinical/compliance sign-off complete where applicable.
- [ ] Finance/legal sign-off complete where money, contracts or regulation are involved.
- [ ] Documentation and progress table updated in the same change.

---

## 4. How the team executes this plan

For each task below:

1. Confirm its dependency and decision rows are closed.
2. Create one issue using the task ID from this document.
3. Add or update the failing test before changing the behaviour when reproducing a defect.
4. Implement the smallest complete vertical path: database, domain, API, interface, notification and audit.
5. Run the module tests, then the complete quality gate.
6. Record evidence in the pull request: test result, screenshots where relevant, migration notes and rollback.
7. Update the task checkbox and the module status only after review.
8. Obtain every named sign-off before moving the module to `PILOT READY` or `PRODUCTION READY`.

Do not close a backend task while leaving its required screen, message, audit event or operational recovery undocumented. Do not begin real-money, advertising or resource-exchange work while the gates that precede them are open.

---

## 5. Baseline reconciliation

The Blueprint and Module Reference were written from code at `5c199c1`. Two bodies of work landed after that and must not be reopened unless a regression is found.

### 5.1 Closed before `6a2ce43`

| Closed area | Gap/task | Evidence |
| --- | --- | --- |
| Grant tenant isolation | `AUT-01` | `a0bb6da` |
| Match-result privacy | `MAT-01` | `3c05bf9` |
| Request locking and booking revalidation | `MAT-02`, `MAT-03`, `MAT-04` | `54edb3a`, `6a2ce43` |
| Attendance and incident ownership | `ATT-01`, `ATT-02`, `INC-01` | `52a0456` |
| Dispute party isolation | `DSP-01`, `DSP-02` | `52a0456`, `6a2ce43` |
| Cancellation cascade and assignment cancellation | `REQ-02`, `MAT-05`, `SAN-02` | `a1a6bb4` |
| Credential renewal and NIN masking | `PRA-08`, `PRA-10` | `6b84a20` |
| Holiday/night minute billing | `BIL-01`, `TIM-03` | `9cf2997` |
| Payout concurrency protection | `BIL-04` | `00196bb` |
| Facility verification before staff lookup | `AUT-07` partial safety closure | `dc2c499` |
| Notification handlers, retry and WAT wording | `NOT-01`, `NOT-03`–`NOT-06`, `CRE-07`, `DSP-03` partial | `bd278ee`, `a7a49c7` |
| Cross-tenant route test campaign | `AUT-10` | `18af704` |

### 5.2 Closed by the Phase 0 merge (`9a93861`)

Pull request 1 merged 71 commits. Each fix was written test-first; the record of how each was shown is in [Phase0-progress.md](Phase0-progress.md). Gaps are grouped here by the module they belong to. “Part” means the gap is fixed in part and the remainder is listed in that file.

| Area | Gaps | Evidence |
| --- | --- | --- |
| Sign-in and recovery | `AUT-02` per-address limits from a trusted header, `AUT-03`, `AUT-04`, `AUT-05`, `AUT-06` forgot-password screen, `AUT-08` first administrator, `AUT-09` CSP and HSTS | `61672b1`, `8e7f356`, `52353b6`, `515f2f3`, `8f1c972`, `2d50b55`, `a4bd229` |
| Tenant isolation | `AUT-10`, `QAL-01`: 65 id-taking routes called as a second tenant, as another practitioner, with no grants and signed out | `cc7f13d` |
| Facilities | `FAC-01`, `FAC-02`, `FAC-04`, `FAC-05` (government and other bodies without a CAC number), `UXO-01`, `UXO-02`, `UXF-01`–`UXF-03` | `4e578fc`, `3008e5c`, `5551d16` |
| Availability | `AVL-02` free tonight, all day, one date | `67639d8` |
| Credentials | `CRE-04` printed expiry, `CRE-07` decision texts, `CRE-08` expiry warnings | `0f009cc`, `63c904a`, `fd31453` |
| Level model | `PRA-01`, `PRA-02` recorded level and registration category, `UXF-06` shift type from hours; `CFG-04` and `REQ-01` in part (mechanism built, no levels ship) | `a1b0a48`, `e0991d0`, `6d91334`, `ec30477` |
| Service requests and offers | `REQ-03`, `UXP-02` terms shown and kept; `UXP-04`, `AUD-03` (part), `UXW-03`, `UXW-04` agreements enforced and terms, privacy, contact pages | `9af9aff`, `ede2f62` |
| Rates | `RAT-01` no floor means no publish, `RAT-02` premiums fixed at booking, `RAT-03` holidays to 2030; `CFG-02` in part | `2d90eee`, `2f0f91a`, `20fb06d` |
| Timesheets | `TIM-02`, `BIL-11`, `UXF-07` approval shows what will be billed; `TIM-01` in part | `48b1501` |
| Money | `BIL-03` payouts sized from collected cash, `BIL-05` manual provider, `BIL-06` verified payout accounts, `BIL-08` voids, `BIL-10` dispute holds, `BIL-12` step-up; `BIL-02`, `BIL-07`, `UXO-03`, `DSP-05` in part | `7fabcb1`, `dc0d277`, `37e9ac8`, `27e58b7`, `5da6618`, `76bc4da` |
| Scheduling and attendance | `SCH-02` shift reminder, `SCH-03` Lagos time everywhere; `SAN-01` in part | `ed67c35`, `eab6cb1` |
| Disputes and incidents | `DSP-03` notices, `DSP-04` facility screen, `INC-03` severe-incident alert, `INC-04` no patient identity | `56fe6ed`, `773e6ef`, `0421b43`, `c87f795` |
| Notifications | `NOT-03`–`NOT-06`, `UXP-01` in-app inbox; `NOT-01`, `NOT-02`, `UXW-02` in part (adapters written, never run against a provider) | `a1c6576`, `bd278ee`, `bb6589a`, `7426f3a` |
| Privacy | `AUD-01` erasure that deletes, `AUD-02` no personal data in the audit trail, `PRA-14` sanctions screen (mechanism; the lists are compliance’s); `AUD-04` in part | `a720baa`, `80a314e`, `7d40059` |
| Platform | `PLT-03` stranded events reclaimed; `PLT-01`, `PLT-04` in part | `434d1ea` |
| Readability | `UXA-01`, `UXA-02`, `UXA-03`, `UXA-04`, `UXA-06`, `UXA-08` | `6708bb6`, `3dfbfbb`, `7f83e8e` |

**The register as a whole** (410 gaps, in [Gap-Reconciliation.md](Gap-Reconciliation.md)): 104 closed, 86 partly closed, 220 open. The P1 and P2 gaps (291) were not tracked during Phase 0 and were judged afterwards by reading the code; 209 of them are still open.

**Not closed, and why.** Fourteen P0 gaps remain open and each needs something from outside engineering: `BIL-13` and `BIL-09` (the legal role, the provider, the fee and credit-note decisions), `AUD-05` (counsel and the regulator), `CRE-01`, `CRE-02`, `CFG-01`, `CFG-03`, `UXP-03`, `QAL-06` (the regulators’ requirements for each profession), `UXW-06` (a commercial statement), `INC-02` (a policy), `PLT-02`, `PLT-05`, `QAL-02` (an environment to deploy to, a restored backup, a staging site). Eighteen more are fixed in part.

### 5.3 Baseline evidence on `9a93861`

CI run 12 on `main` at `9a93861`, all six jobs passing:

| Check | Result |
| --- | --- |
| Lint, typecheck, unit tests | pass; 1,004 unit tests in 70 files (v1.0 recorded 620) |
| Migrations and seed on an empty database | pass: migrate up, down and up again, seed, row counts |
| Integration against a real database | pass; 1,122 tests in 67 files, also run locally with no `.env`, as CI runs them |
| Production image | builds; the web process, worker and migrations are in it and it runs as an unprivileged user |
| Dependency and secret scanning | pass (audit, gitleaks) |
| End-to-end | pass; 56 browser journeys, desktop and mobile, against a production build with the worker running |

GitGuardian’s pull-request check flagged one test fixture string and is not part of the gate above; its incident has to be dismissed on GitGuardian’s dashboard.

**What v1.0 recorded and is now resolved.** On 14 October, before the merge, the integration suite could not be rerun locally because the PostgreSQL credentials were rejected, so no status could be promoted. The suite now runs in CI against a PostgreSQL service container and passes. That removes the technical reason for caution; the reasons that remain are the missing sign-offs (Section 3) and the open decisions (Section 11).

**Still not shown on `9a93861`.** The production image has never been started by anyone (CI builds it and checks its contents; there is no Docker daemon in the development environment). The scheduled jobs have not been run from the image. Nothing has run on a phone, behind a real proxy, with a real SMS provider or against a real bank. The `docker-compose.yml` change to MinIO has not been run with `docker compose up`.

---

## 6. Programme gates and delivery order

| Gate | Objective | Exit condition |
| --- | --- | --- |
| `G0` | Re-establish a trustworthy baseline | Clean database; integration and browser suites green; docs reconciled with current code |
| `G1` | Make the existing one-way staffing flow safe for a controlled pilot | All pilot P0s closed; real messages; support and operations ready; legal and clinical pilot decisions signed |
| `G2` | Model professional hierarchy correctly | Levels, registration categories, competencies and supervision validated for the selected professions |
| `G3` | Add the two-sided marketplace | Unified Booking, practitioner listings, applications, proposals and counteroffers work safely |
| `G4` | Introduce trustworthy money movement and the success fee | Licensed provider integration, reconciliation, dispute holds, refunds and financial sign-off complete |
| `G5` | Build trust and retention | Reviews, favourites, recurring work, replacement and mature sanctions/appeals work |
| `G6` | Launch the Clinical Resource Exchange | Separate verified inventory, booking, safety and payment flow approved |
| `G7` | Add premium services and controlled sponsorship | Free core protected; paid benefits and advertising rules approved and measurable |

Work moves through the gates in order. Discovery and legal work may run earlier, but a later commercial feature cannot be activated before its gate.

---

## 7. Module progress board

The **Status** column is v1.0’s, unchanged: no module has been promoted, because promotion needs the sign-offs in Section 3. The **Since v1.0** column says what the Phase 0 merge changed, with the gaps it closed (see 5.2 and Gap-Reconciliation.md).

| ID | Module | Status | Since v1.0 | Target before Gombe pilot | Gate |
| --- | --- | --- | --- | --- | --- |
| M01 | Authentication and access control | PARTIAL | Recovery screen, first administrator, CSP/HSTS, lockout and code-guess fixes, per-address limits, route sweep. Role separation and a second factor open. | PILOT READY | G1 |
| M02 | Practitioners | PARTIAL | Level and registration category recorded by an officer; sanctions screen. No ladder content ships; competencies and incident restriction open. | PILOT READY for selected professions | G1–G2 |
| M03 | Credentials | PARTIAL | Printed expiry, decision texts, expiry warnings. Requirements for the other professions are the regulators’ to state. | PILOT READY for selected professions | G1–G2 |
| M04 | Facilities | PARTIAL | Correction after refusal, licence upload, licence expiry warnings, duplicate guard, non-CAC registration, evidence on approval. Accepted evidence per facility type (D03) and staff lifecycle open. | PILOT READY | G1 |
| M05 | Availability | PARTIAL | Free tonight, all day, one date; Lagos time. | PILOT READY | G1 |
| M06 | Service requests | CORE READY | Level and supervision on the request; shift type from the hours; terms shown and kept; no publish without a floor. | PILOT READY | G1–G2 |
| M07 | Matching and assignment | CORE READY; integration and browser validation green in CI on `9a93861` | Lock and revalidate, privacy of contact, level matching. | PILOT READY | G1–G2 |
| M08 | Scheduling | STUB | A reminder before the start; Lagos time; confirmed shifts as a day-by-day agenda for the practitioner and, within a page, the facility. Rota, swaps and a calendar not built. | Minimum pilot schedule ready | G1; full at G5 |
| M09 | Attendance | CORE READY; validated in CI | Code and facility ownership checks; an alert thirty minutes into a missed shift; a code is pinned to one shift, one purpose and one use on the server's clock. A hand-recorded or corrected time that has not happened yet is refused, and one longer than a day; a code is five tries and one check-in under parallel use. No check-in window, no QR drawn; weak-network fallback not built. | PILOT READY | G1 |
| M10 | Timesheets | CORE READY; validated in CI | Approval shows the billed amount, and is of the figures that were seen: worked out again at approval, refused with the new figures if the calendar moved, and the practitioner is told; a submitted sheet is no longer rewritten by a late event; a correction commits as one transaction; approval and completing the assignment cannot come apart; no minute priced twice, property-tested. Deadline policy open. | PILOT READY | G1 |
| M11 | Rates and contracts | PARTIAL | Floors required, per level, set on a screen; premiums fixed at booking; holidays to 2030. Figures are the regulators’; cancellation fees and counsel’s terms open. | PILOT READY | G1–G2 |
| M12 | Billing, ledger and settlement | PARTIAL / NO REAL MONEY | Payouts sized from collected cash; manual payout provider; verified payout accounts; voids; payment record; dispute hold; step-up. No gateway; credit notes and the fee model open. | Accurate pilot ledger; provider payment at G4 | G1 and G4 |
| M13 | Cancellations, no-shows and sanctions | PARTIAL | Cancelling releases bookings and tells people; alert thirty minutes into a missed shift. Replacement search, policy and appeals open. | PILOT READY | G1 |
| M14 | Disputes | PARTIAL | Facility screen, party isolation, notices, hold on the disputed amount. Escalation, appeal and credit-note effect open. | PILOT READY | G1; money integration at G4 |
| M15 | Clinical incidents | PARTIAL | Severe-incident alert; no patient identity in a summary. Interim restriction and clinical-governance process open. | PILOT READY | G1 |
| M16 | Notifications | PARTIAL | Texts for the main transitions, retry, in-app inbox, Termii and Africa’s Talking adapters (never run live). No provider account, receipts or failover. | PILOT READY with real provider | G1 |
| M17 | Audit, consent and compliance | PARTIAL | Erasure that deletes, audit trail free of personal data, data inventory, purge job; an export of everything held, open to every signed-in person on a fresh password; a failed audit write is logged as `audit_write_failed`. Retention and bases unsigned by counsel; no alert channel. | PILOT READY | G1 |
| M18 | Suggestions and feedback | BASIC | The author can see where each suggestion stands and read the answer, and is texted when it is planned, done or declined. Categories, duplicate linking and measurement open. | Closed feedback loop | G1 |
| X01 | Reference data and configuration | PARTIAL | Screens for levels and registration categories, pay floors, holidays, sanctions. Credential requirements and fee policy not built; no maker-checker. | PILOT READY for selected scope | G1–G2 |
| X02 | Platform and operations | PARTIAL | CI runs every suite; image carries the worker; health screen; stranded events reclaimed. Nothing deploys; no alert channel; no restored backup; no staging. | PILOT READY | G0–G1 |
| X03 | Practitioner console | PARTIAL | Inbox, forgot-password, free-tonight, offer terms, larger text. | PILOT READY | G1–G3 |
| X04 | Facility console | PARTIAL | Profile and licence, disputes, level on the request, billed amount on approval. | PILOT READY | G1–G3 |
| X05 | Operations console | PARTIAL | Register a facility, verification evidence, sanctions, pay floors, levels, payout accounts, system health. | PILOT READY | G1 |
| X06 | Public site, support, accessibility | PARTIAL | Terms, privacy, contact; 16-pixel text; contrast tested; text-size switch; skip link. Help, pricing and Hausa open. | PILOT READY | G1 |
| N01 | Unified Booking and two-sided marketplace | NOT STARTED | No change. | Later expansion | G3 |
| N02 | Provider payments and success fee | NOT STARTED / prototype ledger only | No change. | Later expansion | G4 |
| N03 | Reviews, reputation and retention | NOT STARTED | No change. | Later expansion | G5 |
| N04 | Clinical Resource Exchange | NOT STARTED | No change. | Later expansion | G6 |
| N05 | Premium services and sponsorship | NOT STARTED | No change. | Later expansion | G7 |

---

# 8. Existing modules: ordered completion cards

## M01 · Authentication and access control

**Outcome:** every person has an individual, recoverable account; permissions are scoped; abuse is limited; privileged actions are traceable.

**Dependencies:** X02 messaging and security configuration; legal decision on retention and identity evidence.

### Ordered work

- [x] `M01-01` Repair and test verification-code concurrency, lockout and password-step binding (`AUT-03`–`AUT-05`). *`8e7f356`, `52353b6`, `515f2f3`.*
- [~] `M01-02` Add IP, phone, account and global rate limits to registration, sign-in, reset and resend (`AUT-02`). *Done: per-address limits read from the one header the edge sets (`CLIENT_IP_HEADER`; staging and production refuse to start until it is said), per-address and per-number limits on sign-in, and a per-number send budget. Open: a global limit, and limits at the edge. `61672b1`, `eab6cb1`.*
- [x] `M01-03` Deliver forgot-password and reset screens with safe account-enumeration behaviour (`AUT-06`). *`8f1c972`; the generic answer on a gateway failure is deliberate. `AUT-11` (differences between registered and unknown numbers on some routes) is separate: see Gap-Reconciliation.md.*
- [x] `M01-04` Provide an audited, production-safe first-super-administrator procedure (`AUT-08`). *`2d50b55`: one command in the production image, refuses once one exists, writes an audit row.*
- [x] `M01-05` Add CSP, HSTS and reviewed session/cookie headers (`AUT-09`). *`a4bd229` (CSP and HSTS). Session lifetime and idle timeout are `AUT-12`: see Gap-Reconciliation.md.*
- [ ] `M01-06` Decide whether the five code roles are sufficient for the pilot; add separation between operations, compliance and finance before real money. *Part exists: the person who prepares a payout cannot release it (`UXO-03`, switchable for a pilot with one finance person).*
- [~] `M01-07` Run an access matrix test for every UI action and API route. *Done for API routes: 65 id-taking routes attacked from another tenant (`cc7f13d`) and a unit test that every route uses an approved wrapper. Open: UI actions.*

### Module acceptance

- [ ] A user can register, verify, sign in, sign out and recover access from the interface.
- [ ] One tenant cannot read or mutate another tenant’s records.
- [ ] Repeated attempts are limited without allowing a third party to keep a victim locked out.
- [ ] Suspending an account invalidates active access promptly.
- [ ] All privileged grant changes are audited with actor, scope, reason and time.

---

## M02 · Practitioners

**Outcome:** the platform represents who a practitioner is, the level at which they may work and whether they are eligible now.

**Dependencies:** M03 credentials; X01 profession data; clinical/regulatory validation of ladders.

### Ordered work

- [ ] `M02-01` Select the first one or two pilot professions from measured Gombe demand. *Blocked on D01.*
- [ ] `M02-02` Approve each profession’s level/cadre ladder with practising professionals and the relevant regulator. *Blocked on D02; none ships.*
- [~] `M02-03` Add structured registration category, level, competencies, specialties and supervision requirement (`PRA-01`, `PRA-02`). *Done: level and registration category (with supervision) are recorded by the officer who checks the registration, audited, and cannot be set by the practitioner. Open: competencies and skill lists (`CFG-04` in part). `a1b0a48`, `6d91334`.*
- [ ] `M02-04` Derive eligibility from account, registration, licence, credentials, sanctions, incident restrictions and consent. *Eligibility already reads account, registration, credentials, screening and consent; an open incident restricts nobody (`INC-02`).*
- [~] `M02-05` Revalidate eligibility at match, invitation, acceptance, confirmation, check-in and renewal boundaries. *Done at invitation, acceptance and confirmation, the last inside the request and practitioner locks at a fresh time. Open: check-in and renewal boundaries. `54edb3a`, `6a2ce43`.*
- [~] `M02-06` Create a controlled sanctions/watch-list intake and review workflow (`PRA-14`). *Mechanism done: add one or a pasted notice, remove with a reason, everybody screened again at once. The lists’ content is compliance’s to supply. `7d40059`.*
- [ ] `M02-07` Show the practitioner every eligibility blocker and the action needed to remove it.

### Module acceptance

- [ ] A practitioner cannot self-assert a verified level or regulated competency.
- [ ] Every level is supported by named evidence and a review decision.
- [ ] Supervised practitioners can only be booked where the required supervision is confirmed.
- [ ] Eligibility changes immediately affect future offers without rewriting history.
- [ ] Historic bookings retain the verified profile and commercial snapshot used at agreement.

---

## M03 · Credentials

**Outcome:** every selected profession has a complete, auditable verification and renewal workflow.

**Dependencies:** M02 ladders; X01 credential catalogue; M16 messages; compliance staffing.

### Ordered work

- [ ] `M03-01` Define credential types and required evidence for every selected profession (`CRE-01`, `CRE-02`). *Open; the regulators’ to state.*
- [x] `M03-02` Store the expiry printed on the document; do not substitute the review date plus a policy interval (`CRE-04`). *`0f009cc`; the interval remains only as a labelled fallback.*
- [ ] `M03-03` Complete submit, replace, reject-with-reason, resubmit, verify, expire and renew states.
- [x] `M03-04` Add 30-day, 7-day and expired reminders with idempotent delivery. *`fd31453` (a month and a week before), `63c904a` (decisions); nobody is told twice.*
- [ ] `M03-05` Add reviewer workload, turnaround target and escalation reporting.
- [x] `M03-06` Make multi-record confirmation transactional and safe to retry (`CRE-12`). *`fadcda6`: confirming a NIN or a licence from what the practitioner submitted wrote the identity or registration, then decided the submission in a second transaction, then masked the number in a third. A failure between the first two left a record its own submission did not agree with, a retry wrote it again (two audit rows for one act), and a second officer who read the slip differently overwrote the first one’s reading while the first one’s decision stood. Each confirm now prepares everything first, asking a provider before any transaction opens, and writes the decision and the record in one; the decision only succeeds on a submission still waiting, so the second of two officers at once is refused as already reviewed and leaves nothing behind. Tests make the queue refuse at the decision and check nothing is recorded and a retry records once (identity, mismatch, registration, a suspended licence), and run two officers at once. The third commit, `maskSubmissionReference`, changed nothing (`reviewCredential` already masks a NIN with any decision on it) and is removed, with its audit action `credential.reference_masked`. **Not covered:** the other multi-step operations were not looked at for the same shape beyond what the audit catalogue’s function check found (`M17-01`); the manual “record an identity” and “record a registration” forms still write the record alone and the officer then decides in a separate action, which is how they are meant to be used.*
- [ ] `M03-07` Define secure file scanning, object access, retention and deletion.

### Module acceptance

- [ ] The system refuses eligibility when a required credential is missing, rejected or expired.
- [ ] Practitioners see the decision, reason, expiry and renewal action.
- [ ] Reviewers see the source checked and the evidence supporting the decision.
- [ ] Sensitive identity numbers never appear raw in ordinary responses, logs or notifications.

---

## M04 · Facilities

**Outcome:** only a real, approved facility can publish work or access practitioner contact details.

**Dependencies:** X01 facility types; M01 staff roles; regulatory decision for non-CAC facilities.

### Ordered work

- [~] `M04-01` Define accepted identity evidence for private hospitals, government hospitals, PHCs, laboratories and clinics (`FAC-05`). *Mechanism done: a facility registers as a CAC company, a government facility (ministry reference) or another body, each with its own uniqueness rule, and approval needs the licence on file and every check confirmed. What evidence is accepted for each type is D03. `5551d16`.*
- [x] `M04-02` Normalise identifiers and prevent duplicate/squatted facility records (`FAC-04`). *`3008e5c`.*
- [x] `M04-03` Add licence upload, expiry, replacement and reviewer workflow (`FAC-02`). *Upload, the profile screen and the reviewer’s reasons (`4e578fc`). A lapsed licence already stopped a facility publishing, inviting or confirming, with no job involved; a daily job (`facility.licence_sweep`) now also tells the people who run a verified facility (its representative and whoever holds `facility.write`) a month ahead and again in the last week, and once when it has lapsed (announced for 14 days after, so the first run does not text every old lapse), one message per person at each stage for that expiry date. **Observation, not changed:** uploading a renewed licence returns a verified facility to review at once, even with weeks left on the old one (`facility.licence_replaced`), so a facility that renews early cannot publish until compliance has checked it. That is deliberate (a swapped document must not keep publishing on a review nobody did) and the warning says to renew early for that reason; whether renewing the same licence number should stay live while it is checked is compliance’s to decide.*
- [x] `M04-04` Add correction and resubmission for rejected facilities (`FAC-01`). *`4e578fc`.*
- [~] `M04-05` Separate provisional ownership from permissions granted after verification. *Staff lookup and giving access are refused for a facility that is not verified (`dc2c499`). An unverified facility’s owner can still create drafts (`AUT-07`, `FAC-03` in part).*
- [ ] `M04-06` Add staff invitation, acceptance, role change, removal and emergency access revocation.
- [ ] `M04-07` Ensure suspension stops publishing, booking and contact access while preserving records.

### Module acceptance

- [ ] Every approved facility has evidence appropriate to its type.
- [ ] Pending or rejected facilities cannot browse practitioners, add operational staff or publish work.
- [ ] A facility owner can manage only staff within that facility.
- [ ] Licence expiry generates warnings and safely limits new bookings.

---

## M05 · Availability

**Outcome:** a practitioner can accurately state when they can work without exposing a precise private routine publicly.

**Dependencies:** M02 profile; N01 listings for priced public availability.

### Ordered work

- [x] `M05-01` Add one-off “free tonight,” date-range and all-day availability (`AVL-02`). *`67639d8`: all day, every day, Monday to Friday, and a “free on a date” tab with one-tap free tonight; worked out in Lagos time.*
- [ ] `M05-02` Keep recurring patterns, exceptions, leave and one-off slots in one precedence model.
- [~] `M05-03` Detect overlaps and apply the practitioner’s time zone explicitly as Africa/Lagos. *Lagos time is applied wherever a time is typed or shown (`eab6cb1`). Overlap detection not checked.*
- [x] `M05-04` Explain why a candidate was excluded for availability. *The matcher said only `unavailable` for somebody who offered none of a shift and for somebody who offered most of it, and a facility was shown the raw word. The availability verdict now has a third answer, `partly_offered` (some of what they offered falls inside the shift but no stretch of it covers the whole; a slot that only touches the shift is still none), and the matcher reports it as `partly_available`, so a facility can see that shortening or splitting a shift would bring somebody in. Every exclusion reason now has a short name and a sentence in a ward manager’s words (`EXCLUSION_WORDS`), shown on the shift page under “left out, and why” and in the right-hand column of `docs/matching-rules.md`. The words for the three availability reasons say only that the time was marked unavailable, offered not at all or offered in part: never what for, never which days somebody works, which a test holds. Checked on the seeded data (two of the thirteen left out for one shift were free for part of it) and by eight of eight mutations, with an integration test through a real match run. **Not done:** how much of the shift they offered is not shown to a facility, on purpose (it would show a routine); the practitioner is not told they were left out or why.*
- [ ] `M05-05` Separate private matching availability from an opt-in priced marketplace listing.

### Module acceptance

- [ ] Recurring availability plus exceptions produces deterministic results at boundaries.
- [ ] A practitioner can declare and withdraw one-off availability on a phone.
- [ ] Private schedules are not exposed to facilities or public users.
- [ ] Concurrent bookings cannot exceed the remaining available time.

---

## M06 · Service requests

**Outcome:** a verified facility can publish a complete, understandable and fillable staffing need.

**Dependencies:** M02 hierarchy; M11 rates; M04 verified facility.

### Ordered work

- [~] `M06-01` Add required profession, registration category, level, competencies and supervision (`REQ-01`). *Done: a request names its level and whether anybody will supervise; once a profession has levels in use every request for it must name one; matching ranks only practitioners recorded at exactly that level. Open: competencies, per-person rate, whether a higher level may take a lower shift (a product decision). `ec30477`, `e0991d0`.*
- [ ] `M06-02` Add per-person quantity and rate terms where multiple workers are requested.
- [~] `M06-03` Display duties, location, hours, breaks, rate, premiums, cancellation terms and evidence needed for a dispute (`REQ-03`). *Done: the offer shows cancellation terms, ward notes, address and headcount above the buttons, and accepting copies what was shown onto the invitation (`9af9aff`). Not checked: duties, breaks, premiums and the dispute-evidence statement.*
- [~] `M06-04` Validate time, capacity, facility status, floors and required fields on draft, publish and material edit. *Floors: creating or publishing with no floor in force is refused (`2d90eee`). Facility status and capacity are checked at publish and booking.*
- [ ] `M06-05` Freeze or re-accept material changes after an offer exists.

### Module acceptance

- [ ] The request says exactly who is needed, what work is expected and what will be paid.
- [ ] A request cannot publish below an applicable floor or without an approved facility.
- [ ] Quantity cannot be overfilled under concurrent acceptance/confirmation.
- [ ] Cancelling a request releases affected bookings and tells all parties.

---

## M07 · Matching and assignment

**Outcome:** eligible people are ranked fairly, invited safely and confirmed without privacy leakage, stale eligibility or overbooking.

**Dependencies:** M02, M04–M06, M11 and M16.

### Ordered work

- [x] `M07-01` Rerun all matching, tenant, concurrency and post-lock revalidation tests on the repaired integration database. *1,122 integration tests pass in CI on a PostgreSQL service container and locally without `.env` (Section 5.3).*
- [~] `M07-02` Add approved level, competency and supervision rules as hard eligibility filters. *Level and supervision are hard filters at match and at every booking step (`ec30477`, `6a2ce43`). Competencies are not built.*
- [x] `M07-03` Document ranking factors, weights, tie-breaking and exclusion reasons. *`c9ed5a2`, `f2d4ddb`: `docs/matching-rules.md` says who is looked at, the nine reasons a person is excluded, the four weighted factors with their caps, the tie-break and a worked example. It is generated from the engine’s own constants, and a test fails when it and the code differ, shows each exclusion reason is a rule the engine applies and applies alone, and pins the rounding, tie-break, cold-start and reliability statements (eleven of twelve engine mutations are caught; the twelfth changes nothing observable). Through a real match run the integration tests hold the facts the engine is handed: who is in the pool (a withdrawn consent or another profession is left out entirely), which assignments count as hours already committed (a seven-day window, read from the engine’s constant), and which is a conflict. The older stage page listed seven reasons where the code has nine; it now points at the generated page. **Stated on the page and not changed:** rest counts only assignments still confirmed, so a shift worked and approved does not weigh on the next ranking (`MAT-10`, open).*
- [~] `M07-04` Test concurrent invite, accept, confirm, cancellation, suspension and start-time changes. *Concurrent confirmation onto the last place is tested and fails without the lock (`54edb3a`); a suspension, consent withdrawal, licence lapse or start time arriving while a confirmation waits is covered by the revalidation test (`6a2ce43`). The full list in this task is not covered.*
- [x] `M07-05` Keep contact masked until the approved reveal window; audit each reveal. *Initials only until a booking exists; phone from 48 hours before the shift to 24 hours after (`3c05bf9`). `8d9766a`: the number used to ride on every facility roster read inside the window, whether or not the screen showed it (the shifts list and the incident dialog received numbers they never displayed) and nothing recorded who had been sent one. It is now released only when a request names it (`include=contact`: the roster, the shift detail and the timesheets screens do, no other does), inside the same window, and each number released is written to `security_events` as `contact.revealed` before the roster is returned: who, which booking, whose number, which facility and the correlation id, one row each time, never the number itself; if the rows cannot be written the roster is not returned. A practitioner reading their own roster is not recorded. Checked through the function and the route, with the window’s edges, a cancelled booking and a failed write; ten of ten mutations are caught. **Not covered:** the practitioner cannot see who was shown their number (their export lists what they themselves looked at); the window’s 48 and 24 hours are constants in code, not a policy anybody has approved; and an erasure of the person who looked removes the detail from their rows, which is what names the booking.*
- [ ] `M07-06` Prepare migration from assignment to the unified Booking only after N01 is approved.

### Module acceptance

- [ ] No ineligible, unavailable or conflicted practitioner can be confirmed.
- [ ] A request cannot be overfilled under concurrency.
- [ ] The same practitioner cannot be double-booked.
- [ ] Facilities receive useful reasons without private excluded-candidate information.
- [ ] Every confirmation records the rule and terms used.

---

## M08 · Scheduling

**Outcome:** both sides know what is happening next and receive help before a shift becomes uncovered.

**Dependencies:** M07 bookings; M16 messaging; X01 holidays.

### Ordered work

- [~] `M08-01` Deliver pilot agenda/day/week views from confirmed bookings. *Done: the practitioner’s confirmed shifts are an agenda, grouped under the day each starts in Lagos time (Today, Tomorrow, then the weekday and date) with Today / Next 7 days / All and a count of what the range left out; one under way is listed under today even if it began last night, and one that has ended and is still confirmed is shown first in every range, because it is the one that needs hours or an excuse. The facility’s roster groups the confirmed tab the same way within each page. Not done: a facility range switch (its list is paged on the server, so a page-wide filter would be wrong across pages), a week grid or calendar, and the other tabs.*
- [~] `M08-02` Add configurable 24-hour and near-start reminders (`SCH-02`). *A reminder three hours before a confirmed shift; nobody is told twice (`ed67c35`). Not configurable, and no 24-hour reminder.*
- [~] `M08-03` Detect missing check-in early enough for the facility to respond. *Practitioner and facility are told thirty minutes into a shift with no check-in (`ed67c35`). The replacement search is not built (`SAN-01` in part).*
- [~] `M08-04` Maintain federal and selected state holidays as versioned data (`SCH-03`). *Fixed and Easter-derived holidays generated to 2030, a screen to add declared Islamic holidays, and a coverage check that says what is missing (`20fb06d`). State holidays not checked.*
- [ ] `M08-05` After the pilot, add recurring rota templates, swaps, rescheduling, replacement and calendar export.

### Module acceptance

- [ ] Practitioner and facility see the same shift time and status in WAT.
- [ ] Reminders are idempotent, observable and preference-aware.
- [ ] A missing check-in creates an actionable alert, not only a post-shift record.
- [ ] Rescheduling never changes accepted terms without consent.

---

## M09 · Attendance

**Outcome:** both parties can prove arrival, departure and authorised manual corrections under real network conditions.

**Dependencies:** M07 confirmed booking; M08 schedule; M13 no-show handling.

### Ordered work

- [x] `M09-01` Rerun assignment-binding and facility-ownership integration tests after database repair. *Passing in CI; the fixes are `52a0456`.*
- [~] `M09-02` Complete QR/code, manual exception and correction paths with reason and audit. *Done and tested: the code path, the hand-recorded path (mandatory reason, audit row with the record before and after, both events kept with when it happened apart from when it was recorded) and the timesheet correction (reason, actor, the whole previous state as a revision). Open: no QR is drawn or scanned anywhere, the QR is an API string (`ATT-08`); and a hand-recorded or corrected time may still be days from the shift (`ATT-04`: the half that a time which has not happened yet is refused landed in `ae317e4`, five minutes' tolerance, 422 `time_in_future`; the other half needs a window and a number from operations, as `ATT-03` does). A hand-recording over a sheet that exists does not write a timesheet revision: the attendance audit and the event log keep the old times, the sheet's figures are replaced.*
- [~] `M09-03` Define grace periods and clock source; reject replayed or cross-booking codes. *Done (`197913e`): a code is good for one shift, one purpose, once, on the server's clock, and each of those is now pinned in a test (the six digits of one of a practitioner's shifts are refused for another, a check-in code is refused as the check-out code, a used code is spent, a time claimed in the request body is ignored). Characterisation tests: nothing in the code changed. Open: there is no check-in window (`ATT-03`), so a code issued the day before checks a practitioner in a day early. Enforcing one is not built because it needs a number from operations (how early a ward lets a nurse start) and a wrong default would turn people away; the manual path is the only way round it. Also done (`c5959a2`): a code is five tries however many guesses arrive together (the attempt is taken before the guess is judged, in one conditional statement: fourteen at once were seven attempts), and two presentations of one right code at the same moment check in once, where they both did (`ATT-06`, and the race half of `ATT-05`). Presenting a code again after it worked is still refused, as the used-code contract above says; making a replay succeed would be a decision.*
- [ ] `M09-04` Design a weak-network fallback that cannot silently manufacture attendance.
- [~] `M09-05` Connect missing and late attendance to alerts, no-show review and timesheet creation. *The thirty-minute alert exists (`ed67c35`); the rest not checked.*

### Module acceptance

- [ ] Only the assigned practitioner can use a booking’s check-in method.
- [ ] Only the owning facility can issue or manually record attendance.
- [ ] Every manual correction records actor, reason, previous value and new value.
- [ ] Offline/failed attempts recover without duplicates or lost evidence.

---

## M10 · Timesheets

**Outcome:** worked time becomes one understandable, reviewable amount without indefinite approval delays.

**Dependencies:** M09 attendance; M11 pricing; M12 invoicing; M16 reminders.

### Ordered work

- [x] `M10-01` Show the same banded minutes and premium-inclusive amount that billing will use (`TIM-02`). *`48b1501`: “To be billed”, priced by the function the invoice uses. The exact night/holiday split is stored on the timesheet (`9cf2997`).*
- [~] `M10-02` Add submission and approval deadlines, reminders and an approved auto-resolution policy (`TIM-01`). *Reminders to the facility after a day and three days; the practitioner is told at three days. A deadline after which hours are approved is a commercial decision (D05) and is not made.*
- [~] `M10-03` Complete correction, reject, resubmit, approve, dispute and lock states. *The machine already had correction, rejection, resubmission, approval and dispute (every ordered pair of states is tested). Added (`0f8a34e`): the lock. A submitted, approved or disputed sheet is no longer rewritten by the ShiftCompleted event, which the outbox delivers at least once and which used to recompute it from today's data with no revision and no audit row. Added after that (`6d81631`, `e140478`): a correction works out its figures before anything is written and commits as one transaction, so a refusal commits nothing (`TIM-07`); no shift over 24 hours can be recorded at check-out, in a hand-recording or in a correction, and a record the timesheet cannot price says why as a 422 (`TIM-08`); and approving a sheet and completing its assignment cannot come apart: a failure completing is logged and the approved event completes it, and approving again finishes a stranded approval (`TIM-04`). The practitioner can now read the facility’s reason for sending hours back on their own sheet, only while it is rejected (it was only ever in the text message). Open: a hand-recording over a sheet that exists writes no timesheet revision (see `M09-02`); the deadline policy is `M10-02` and D05.*
- [x] `M10-04` Prevent approval after material attendance or rate data changes without recalculation and review. *`0f8a34e`: an approval works the figures out again on the data as it stands; if they differ the sheet takes them, the old ones go into a revision with who asked and why, an audit row says so, and the approval is refused (409 `timesheet_figures_changed`) so the next one is of what is on screen. The approval also carries the revision the screen showed (`seenRevision`), and the facility's timesheet screen sends it and reloads after any refusal. The practitioner is texted, and gets the inbox row, that the sheet was worked out again (`5c215fd`; that it happened and where, not the figures; one text per recalculation, retried if the gateway refuses). The holiday calendar is the input that moves today; attendance changes already send a sheet back through resubmission (a correction leaves `SUBMITTED`), and a request's rate cannot be edited yet (`M06-05`), at which point the same recomputation covers it. Each guard was removed in turn and its tests went red.*
- [x] `M10-05` Property-test ordinary, overnight, holiday, overtime, break and boundary cases. *`eea361a`: 1,500 generated shifts with a fixed seed, an independent interval calculation of the night and the holiday, a shift cut in two, a longer break never paying more, and a swept grid of 1,728 shifts inside the night that a holiday splits at midnight. **It found a defect:** 22:00 to 02:00 WAT with the first two hours a holiday and a one-minute break is 239 billable minutes and came out as 240 priced, because ordinary was clamped at zero while both premium buckets rounded 119.5 up. Fixed in the timesheet and where the invoice reads the stored bands (an old row is priced once too). The sweep and the pricing case were red before the fix. Random shifts almost never take that shape, so the sweep is what finds it.*

### Module acceptance

- [ ] Facility and practitioner see identical hours, bands, rates and totals.
- [ ] No minute is lost or counted twice when night, holiday and overtime overlap.
- [ ] A facility cannot indefinitely prevent payment by ignoring the timesheet.
- [ ] Changes after approval require a recorded reversal/reapproval flow.

---

## M11 · Rates and contracts

**Outcome:** all parties know the minimum, agreed rate, premiums, cancellation terms and who pays each fee.

**Dependencies:** M02 levels; X01 policies/holidays; legal and tax decisions before paid launch.

### Ordered work

- [~] `M11-01` Define level-aware floors for selected professions; fail closed when a required floor is absent (`RAT-01`). *Fail-closed and level-aware are done: no floor means no publish, a floor for the request’s level beats one for its specialty, and floors are set on a screen (`2d90eee`). The figures are the regulators’ to state (`CFG-02` in part); the seed has placeholders for doctors and nurses only.*
- [~] `M11-02` Version rate cards and holidays with effective dates and owners (`RAT-03`). *A floor is versioned from a date and never edited or deleted; holidays are generated and maintained (`20fb06d`). Owners and review dates not recorded.*
- [~] `M11-03` Snapshot base rate, premiums, allowances, break, overtime, cancellation and fee terms at agreement (`RAT-02`). *Confirming copies the allowances in force for the shift’s date onto the booking (`2f0f91a`), and accepting copies the terms the practitioner was shown onto the invitation (`9af9aff`). Fee terms do not exist yet.*
- [ ] `M11-04` Present a plain-language total estimate to both sides before acceptance.
- [ ] `M11-05` Add approved counteroffer limits during N01.
- [ ] `M11-06` Obtain counsel approval of the engagement and cancellation terms. *Blocked on D06.*

### Module acceptance

- [ ] A booking can reproduce its price without reading today’s configuration.
- [ ] The practitioner receives the quoted practitioner amount under the target fee model.
- [ ] The facility sees practitioner pay, platform fee and provider charge separately.
- [ ] Missing policy data blocks publishing instead of silently permitting an unsafe rate.

---

## M12 · Billing, ledger and settlement

**Outcome:** approved work produces balanced, reversible and reconcilable financial records; real funds move only through an approved licensed provider.

**Dependencies:** M10–M11; M14 dispute holds; finance, tax, legal and payment-provider approval.

### Ordered work

- [~] `M12-01` Correct ledger recognition: no practitioner payable or platform revenue before the approved collection/settlement event (`BIL-02`, `BIL-03`). *What can be paid out now waits for the facility to pay (`BIL-03`, `7fabcb1`); the screens say so. The ledger still credits a practitioner when an invoice is raised (`BIL-02`), which is the commercial question the blueprint asks.*
- [~] `M12-02` Add invoice issue, partial/full payment, payment reference, payer, date and idempotency (`BIL-07`). *Recording a payment takes the bank’s reference, amount, date and payer, with the amount checked against the invoice. Part payments, over-payments and one transfer covering several invoices have no model and are refused.*
- [~] `M12-03` Add voids, credit notes and reversing entries; never edit posted ledger history (`BIL-08`). *Voiding a draft reverses each credit with a balanced entry and the originals stay (`37e9ac8`); refused once a payout has moved. No credit notes (`BIL-09`).*
- [~] `M12-04` Add verified payout destinations, change protection and maker-checker (`BIL-06`, `BIL-12`). *A payout goes only to a verified account that has been the practitioner’s for 24 hours; the account number is sealed and shown as its last four digits; changing it and every money act needs a fresh password (`dc0d277`, `5da6618`). The preparer cannot release (`UXO-03`, switchable). Recording a payment or a transfer by hand is still one person.*
- [~] `M12-05` Integrate disputes as holds on only the disputed amount (`BIL-09`, `BIL-10`). *A dispute holds what was credited for that shift and nothing else, and the hold lifts when the case ends (`27e58b7`). An upheld dispute cannot change an invoice (`BIL-09`, `DSP-05`).*
- [ ] `M12-06` Select a licensed provider; implement authorise/capture/settle/refund webhooks idempotently (`BIL-05`). *Today `PAYMENT_PROVIDER=manual`: finance pay by bank transfer and record its reference. `BIL-05` is fixed in that sense only.*
- [~] `M12-07` Build daily reconciliation, unmatched-item queue and ledger-balance alerts. *`d86c276`: the job `billing.reconciliation_sweep` runs daily and adds the money up. Every transaction and the whole ledger sum to zero; cash, a facility’s payable and a practitioner’s earnings never go the wrong side of nothing; every invoice’s lines and ledger entries agree with its status (draft, issued, paid or void) and a paid invoice’s recorded payment is the whole of it; a settled payout has its two entries and no other payout has any; and a released payout has not been left without a gateway answer for an hour, or without a recorded transfer for three days when it is paid by hand. It fails naming the kinds of break, so it shows on System health, and logs ids and amounts and never a name. A card on the Finance page and `GET /api/v1/finance/reconciliation` show the same, worked out as the page opens, and `docs/money-reconciliation.md` says what each kind means and what to do first. A real money journey (a draft voided, billed again, issued, paid, the practitioner paid) comes back clean at every stage, and every rule and every query was broken in turn and the tests caught it. **Open:** no bank statement or provider report is read, so money that arrived and was never recorded cannot be found (`BIL-33`; it needs the provider, `D04`, and finance’s process); there is no month-end close; there is no queue with an owner and a resolved state, a finding is on the card until the numbers agree; nothing pages anybody (`X02-05`); and the two thresholds, 60 minutes and 3 days, are starting points nobody has decided.*
- [ ] `M12-08` Implement facility-paid fee policy only after the signed commercial, tax and legal decisions (`BIL-13`). *Blocked on D06 to D09.*

### Module acceptance

- [ ] Every posted transaction balances and every correction is a reversing transaction.
- [ ] No payout can exceed collected, available and undisputed funds.
- [ ] Replayed or out-of-order provider webhooks cannot double-credit or double-pay.
- [ ] Finance can reconcile provider, bank, invoice, ledger and payout totals daily.
- [ ] Real money remains disabled until a month-long controlled reconciliation proves clean.

---

## M13 · Cancellations, no-shows and sanctions

**Outcome:** disruptions are handled quickly and fairly, with human review before reputational or financial consequences.

**Dependencies:** M08 early alerts; M09 attendance; M11 cancellation policy; M14 appeals.

### Ordered work

- [~] `M13-01` Add early missing-check-in detection and replacement escalation (`SAN-01`). *The alert is built (`ed67c35`); the replacement search is not.*
- [ ] `M13-02` Configure cancellation windows, reasons, evidence and consequences as versioned policy.
- [ ] `M13-03` Separate an operational no-show signal from a reviewed fault decision.
- [ ] `M13-04` Add warning, restriction, suspension, expiry and appeal states.
- [ ] `M13-05` Notify both parties of reports, decisions, effects and appeal rights.
- [ ] `M13-06` Connect approved consequences to eligibility and, later, financial adjustments.

*Closed on the way (`a1a6bb4`): cancelling a request cancels every confirmed booking in one transaction, a booking can be cancelled from the roster, and an absence no longer asks an officer whose fault it was (`REQ-02`, `MAT-05`, `SAN-02`).*

### Module acceptance

- [ ] Cancellation frees capacity and starts replacement where appropriate.
- [ ] No person is sanctioned automatically from a missing signal alone.
- [ ] A decision identifies policy version, evidence, reviewer, reason and appeal deadline.
- [ ] Expired or overturned sanctions stop affecting eligibility.

---

## M14 · Disputes

**Outcome:** either party can raise a scoped case, exchange evidence, receive an impartial decision and see the operational/financial result.

**Dependencies:** M07 booking; M10 timesheet; M12 holds; M16 notifications; operations staffing.

### Ordered work

- [x] `M14-01` Rerun practitioner and facility evidence/list/withdraw/notification tests after database repair. *Passing in CI.*
- [~] `M14-02` Deliver practitioner and facility screens for open, evidence, withdraw and status tracking. *The facility’s screen (its cases, evidence from its side, withdrawing one it raised) was added in `773e6ef`; the other side’s names and storage keys are not sent to it.*
- [ ] `M14-03` Add response deadlines, review queue, evidence visibility rules and structured decision reasons.
- [ ] `M14-04` Add escalation/appeal policy and separation from the original decision maker.
- [~] `M14-05` Add disputed-amount calculation, ledger hold, release and adjustment with M12. *Hold and release are done (`27e58b7`). Adjustment on an upheld dispute is not (`BIL-09`, `DSP-05`).*
- [x] `M14-06` Notify each party at every material transition without revealing the other party’s private data. *`56fe6ed`: opened, picked up, decided, withdrawn; each side is told what concerns it, never the argument or the officer’s notes; main’s later change tells the other side when a facility raises a case (`6a2ce43`).*

### Module acceptance

- [ ] Only the parties and authorised reviewers can see or add case evidence.
- [ ] The subject, booking, timesheet and money are linked without accepting arbitrary identifiers.
- [ ] A decision has a reason, evidence record, actor, time and operational/financial effect.
- [ ] Closing or withdrawing a case releases or adjusts holds exactly once.

---

## M15 · Clinical incidents

**Outcome:** serious safety reports trigger immediate, proportionate containment and a confidential reviewed outcome.

**Dependencies:** M02 eligibility; M07 future bookings; M16 urgent alerts; clinical safety lead.

### Ordered work

- [ ] `M15-01` Appoint a clinical safety lead and approve severity, triage and escalation rules. *Blocked on D11.*
- [x] `M15-02` Add immediate alerting for severe harm or death (`INC-03`). *`0421b43`: everybody holding `incident.manage` is texted for a severe or fatal incident, with facility and severity only; with nobody to tell, the event fails visibly. The target response time is not set (D11).*
- [ ] `M15-03` Add risk-based interim restriction while preserving due process (`INC-02`). *A policy decision; an open incident restricts nobody today.*
- [~] `M15-04` Warn against patient-identifying data; structure the report and screen sensitive text (`INC-04`). *A summary that identifies a patient is refused, with what to write instead (`c87f795`). Structuring the report is not done.*
- [ ] `M15-05` Review confirmed future bookings and replacement needs when a restriction is applied.
- [ ] `M15-06` Add investigation, outcome, appeal, regulator/insurer referral and retention procedures.

### Module acceptance

- [ ] A severe report reaches the named on-call owner within the approved target.
- [ ] Interim restrictions affect matching and confirmation consistently.
- [ ] The reporter cannot nominate an unrelated subject.
- [ ] Patient data is minimised and restricted to authorised incident reviewers.
- [ ] Closure records the decision, evidence, actions and follow-up owner.

*The reporter-cannot-nominate-an-unrelated-subject criterion is met in code (`INC-01`, `52a0456`): a named shift must agree with its practitioner and a named person must have been booked by the facility.*

---

## M16 · Notifications

**Outcome:** important system events reach the right person, in understandable WAT wording, through an observable production provider.

**Dependencies:** provider contract, templates, consent/preferences and X02 worker operation.

### Ordered work

- [~] `M16-01` Choose and integrate a real SMS provider; evaluate WhatsApp only after consent, template and cost review. *Adapters for Termii and Africa’s Talking are written to each provider’s documented API, and a provider missing its credentials stops a staging or production boot (`bb6589a`). **Never run against either provider.** Needs an account, a sender ID, credentials and a real code sent to a real phone (D04).*
- [~] `M16-02` Maintain an event-to-recipient-to-channel matrix for every critical transition. *`1e6b94d`: `docs/notification-matrix.md` says, for each of the 33 messages the platform sends, when, to whom, how often and what the text may name, and for each of the 32 domain events whether it tells anybody. It is generated from `notification-matrix.ts`, and a test holds the two to each other and to the worker’s handlers and what the code publishes, so a new event cannot ship unclassified. What it found: `no_show.recorded` and `sanction.applied` tell nobody, and both are decisions about a person (D05, D10); `timesheet.submitted` tells only the facility’s representative, not whoever holds `timesheet.approve`, who hear a day later; a practitioner has no way to withdraw from a confirmed booking. Open: it records what the code does and decides nothing about who should be told; SMS is the only channel (`NOT-09`), and there are no preferences (`NOT-08`, `M16-04`).*
- [~] `M16-03` Add shift reminders, missing check-in, payout, cancellation, incident and appeal templates. *Done: shift reminder, missing check-in, payment sent, cancellation, severe incident, dispute transitions, hours, invoices, expiring licences, credential decisions, payout account decisions. Appeal templates are not (no appeal workflow yet).*
- [ ] `M16-04` Add preferences while keeping legally or operationally essential messages non-optional where lawful.
- [~] `M16-05` Add delivery status, retry/backoff, provider failover, dead-letter queue and operator replay. *Done: retry on the same row reaching only the people missed (`a1c6576`, `bd278ee`); a five-minute lease so a dead worker’s events are reclaimed and dead-lettered with a reason (`434d1ea`); replay of a given-up event from the System health screen. Failover: a second gateway (`SMS_FALLBACK_PROVIDER` with its own `SMS_FALLBACK_*` credentials; off unless set; refused at boot if it is the same provider, shares the key or is incomplete) is offered a message when the first fails to take it, and every message records which gateway carried it, under what id, and which one failed first. Delivery status: a message’s row carries what the gateway reported (pending, delivered, failed, with a reason code) once a gateway has been given the callback address; the callback exists only when `SMS_RECEIPT_SECRET` is set. The System health screen counts texts a second gateway took, texts reported failed after acceptance, and texts taken more than half an hour ago with no report. Not done: **no receipt endpoint for Termii** (its report format could not be confirmed); the Africa’s Talking parser was written from its documented fields and has never seen a real report; no automatic resend when a gateway reports a failure after accepting; nothing pages anybody; a failover can send a text twice. Which provider is the second is D04.*
- [~] `M16-06` Add cost, latency, failure and stranded-event dashboards and alerts. *A System health screen and `/api/v1/health/background` show whether the worker is delivering and what it has given up on. Nothing pages anybody (`PLT-04` in part).*
- [~] `M16-07` Test every template with real Nigerian phone formats, WAT times and no sensitive data. *`513193b`: every text any integration test stores (all 33 kinds were exercised in the last full run) is held to `sms-hygiene.ts`: the GSM alphabet, at most three segments, every clock time followed by WAT and never UTC, GMT or a machine timestamp, no email address, no Nigerian phone number in any written form, no run of nine digits (an account or a NIN) and nothing left unfilled; the one-time-code text is held to one segment for every purpose. It found one fault, now fixed: the timesheet-rejection text cut a long reason with “…”, which made the whole message UCS-2, five segments where the same words are two. Punctuation typed on a phone (a hospital entered as “St Mary’s”) is made plain where every text is sent, so it no longer doubles the cost; letters a name needs (Ọ, ṣ) are left as they are and cost more. Open: **never run against a real gateway or a real handset** (D04), so what a carrier does to a text is not tested, only what we send; what each text may name is tested template by template, not by a rule; a hospital name much longer than the roughly 100 characters the test uses can still take a text past three segments.* Settled since: the timesheet-rejection text no longer carries what the facility typed (a note by another person, about the practitioner, kept on a lock screen and by the carrier); it says the hours were not approved and to open the app, where the reason is on the practitioner’s sheet (see `M10-03`).

*Also done, and not in this card’s task list: every message the platform sends is in the app with a bell and an unread count (`UXP-01`, `7426f3a`), so a person is told even where no text reaches them.*

### Module acceptance

- [ ] No pilot depends on the console-only adapter.
- [ ] Critical event delivery is idempotent and observable end to end.
- [ ] A provider outage does not block the console or lose the event.
- [ ] Support can see failure reason and safely retry.

---

## M17 · Audit, consent and compliance

**Outcome:** Medilink can prove who did what, why data is held and how a person exercises their privacy rights.

**Dependencies:** counsel/NDPC review; every module’s event and retention requirements.

### Ordered work

- [x] `M17-01` Complete the audit-event catalogue for security, verification, booking, money, sanctions and admin actions. *`7170efb`: `docs/audit-catalogue.md` lists every action the code writes (135 now, in ten kinds, each against the table it names and the sentence the audit screen shows for it) and the four security-event kinds, generated from `audit-catalogue.ts`. A test reads the source with the TypeScript parser and holds it to the code both ways: every action is a line, every line is written, the table matches, and no action is built at run time. The audit screen’s labels are held to the same list (29 were missing). It also finds every function that changes an audited table and has no audit call in it, which found two real gaps, both fixed: a shift reopened by a cancelled booking was audited going one way (`service_request.filled`) and not coming back (now `service_request.reopened`), and a payout release was audited only after the gateway had been asked, so a process that stopped between left a released payout with no row saying by whom (now `payout.release_started`, in the claim’s own transaction). Nine functions write an audited table with no row of their own and each is listed with the reason and what does record the change. **Not covered, said in the document:** reads of sensitive records are recorded for five kinds only (a credential document, a facility licence, the trail, an export, and since `M07-05` a phone number shown to a facility) and a clinical incident opened by staff, or the rest of a practitioner’s profile as a facility sees it, leaves no trace (`AUD-12`, `AUD-14`); sign-in attempts are in their own table; and a decision nobody has built yet (a facility suspension, a practitioner withdrawing from a booking) cannot be on a list of what the code writes.*
- [ ] `M17-02` Make consent purpose-specific and versioned; record withdrawal effects.
- [~] `M17-03` Implement authenticated data export with secure expiry and delivery. *`e42b766`: every table the data inventory lists as about a person is a section of the export or a written reason for leaving it out, and a test fails when the two disagree. Columns are named, never whole rows, and a test scans the export for any other person’s account id and for token hashes, push tokens and storage keys. Open to every signed-in person from the account menu (`AUD-08`), it asks for the password again, is delivered in the response and nowhere else (so there is no stored file and no link to expire, forward or guess), is marked no-store, and a security event is written before the data leaves. **Open: a report that names the person is held back until the data protection officer and counsel say what may be shared (D10); a very large history is returned whole, with no paging.***
- [~] `M17-04` Implement reviewed erasure/anonymisation with legal-hold and ledger/audit exceptions. *Carrying out a request replaces the person’s details, deletes their files and closes the account, keeping the audit trail, ledger, shifts, disputes and incidents; a test scans every text column for the person afterwards (`a720baa`). **Counsel and a data protection officer must sign the retention schedule before it is run on a real person’s data.***
- [~] `M17-05` Define and enforce retention schedules by data class. *`docs/data-inventory.md` is generated from the code and checked against the schema, so a new table cannot ship unclassified; a daily job deletes one-time codes, ended sessions, the sign-in log, delivered queue entries and abandoned uploads. Every period and every lawful basis is the team’s proposal, not signed off.*
- [ ] `M17-06` Complete DPIA, breach-response procedure, regulator register and cross-border hosting decision. *Blocked on D10 (`AUD-05`).*
- [~] `M17-07` Alert on audit pipeline failure; prevent silent loss of mandatory records. *`2fff0b1`: every audit row is written in the transaction of the act it records, so a failed write takes the act with it and nothing is lost silently. What was missing is now there: `recordAudit` logs one structured error, `audit_write_failed`, with the action, the entity and the kind of error and nothing the row held, and throws on; and a source scan fails if any call is neither awaited nor returned (none is; `no-floating-promises` is off in this repo). Open: the alert that turns that line into a page. There is no alert channel (`X02-05`), so today it is a line in a log somebody has to be reading.* *`60e030b` and `d172eae` (`AUD-06`): the audit table refuses UPDATE and DELETE at the database, for every client, and a nightly job (`audit.digest_sweep`) seals each finished day as a count and a chained hash of its rows and fails, naming the day, when a sealed day no longer matches. A change made by somebody who switched the trigger off therefore shows. Not covered (`docs/audit-digest.md`): an owner who also rewrites the digests, which only a copy kept off the database host defends against (each sealing is logged as `audit_digest_sealed` for that), and `TRUNCATE`, which the trigger leaves alone though the digest would notice it.* *`0c39863` (`AUD-13`): one business action can now be followed. The correlation id is ambient and saved on every audit row and event, and the worker run that finishes an event writes under the id of the request that published it; a caller-supplied id is accepted only if it looks like an identifier, because it now goes into a trail that cannot be edited. The network address is deliberately still not saved there.*

*Also closed (`80a314e`, `AUD-02`): names, emails, phone numbers and free text are kept out of the audit trail, and a test reads every audit row back. Rows written before the change keep what they held.*

### Module acceptance

- [ ] Audit records are append-only, scoped and searchable by authorised staff.
- [ ] Export contains the user’s data but not another person’s private data.
- [ ] Erasure produces a reviewable result and preserves only justified records.
- [ ] Every sensitive data class has purpose, owner, retention and access rules.

---

## M18 · Suggestions and feedback

**Outcome:** a user can submit an idea or problem and see that it was acknowledged, reviewed and resolved.

**Dependencies:** M16 notifications; X05 operations console.

### Ordered work

- [ ] `M18-01` Add categories, severity, duplicate linking and responsible team.
- [x] `M18-02` Let the author track status without exposing internal/private notes. *`GET /api/v1/me/suggestions` and a “Yours” view in the suggestion dialog show what they wrote, where it stands (received, being looked at, planned, done, not taken forward) and the answer written for them. Keyed by the author only; no officer’s name or id; a decline reason, which has no author, is never in it (`SUG-01`).*
- [~] `M18-03` Add acknowledgement, request-for-information and resolution messages. *Resolution done: when a suggestion is planned, done or declined the author is texted which, and it is in their inbox, once per answer and retried if the text does not go; the text never carries what they wrote or the answer, which are on their screen (`SUG-02`). Acknowledgement is the “Received” status in “Yours”, not a text. Request-for-information is not built: there is no state for it.*
- [ ] `M18-04` Measure response time, recurring themes and changes produced by feedback.
- [ ] `M18-05` Keep clinical incidents, disputes and account support out of the suggestion queue through clear routing.

### Module acceptance

- [ ] Every submission receives a reference and visible status.
- [ ] Operations can assign, respond, close and reopen with an audit trail.
- [ ] Safety or privacy reports are escalated to the correct controlled workflow.

---

# 9. Cross-cutting products and delivery systems

## X01 · Reference data and configuration

**Outcome:** regulated and commercial rules change through reviewed, dated configuration instead of emergency code edits.

- [~] `X01-01` Add owned, versioned catalogues for professions, registration categories, levels, competencies and credential requirements. *Registration categories and cadre levels have a screen (`config.manage`), are retired and never deleted, and are audited (`6d91334`); nothing ships in them. Competencies and credential requirements are not built as catalogues.*
- [~] `X01-02` Add facility types and accepted verification evidence, including non-CAC public facilities. *Registration kinds exist (`5551d16`); accepted evidence per type is D03.*
- [~] `X01-03` Add rate floors, premiums, holidays, cancellation rules and fee policies with effective dates. *Floors (versioned from a date, on a screen) and holidays (to 2030, maintainable) are done (`2d90eee`, `20fb06d`); premiums are rate-card data. Cancellation rules and fee policies are not.*
- [~] `X01-04` Add controlled sanctions/watch-list sources and review dates. *The screen exists (`7d40059`); the sources and the review dates are compliance’s.*
- [ ] `X01-05` Build operations screens with maker-checker for high-impact policy changes.
- [~] `X01-06` Block unsafe operations when required configuration is missing or expired. *A profession with no floor cannot have a shift published, and the overview names each one that has none (`2d90eee`); staging and production refuse to start without `PAYOUT_ACCOUNT_KEY`, `CLIENT_IP_HEADER` and, for a provider, its credentials.*

**Sign-off:** product, clinical/compliance and engineering; finance/legal for money configuration.

---

## X02 · Platform, DevOps and operations

**Outcome:** the complete application, worker, database and providers can be deployed, observed, recovered and demonstrated predictably.

- [x] `X02-01` Repair local PostgreSQL/test credentials and prove G0 from a clean database. *Proven in CI on a PostgreSQL service container, from an empty database (Section 5.3); the local credentials problem in v1.0 does not affect it.*
- [ ] `X02-02` Run demonstrations from a production build; keep the development server separate. *`.env` sets `NODE_ENV=development`, which makes `next build` fail; unset it for builds (recorded in Phase0-progress.md).*
- [~] `X02-03` Package and run the web process, worker and scheduled jobs in production. *The image carries the web process, the worker, `src/`, the migrations and the first-administrator command, runs unprivileged, and CI builds it and checks its contents. The image has not been started anywhere; scheduled jobs are registered by `pnpm db:seed` and have not been run from the image (`PLT-01` in part).*
- [~] `X02-04` Add CI deployment gates, migrations, smoke tests and rollback. *CI runs lint, types, unit, migrations up/down/up with seed, image build, dependency and secret scan, integration and end-to-end. Nothing deploys and there is no rollback (`PLT-02`).*
- [~] `X02-05` Add central structured logs, metrics, tracing and alerts for web, database, queue, provider and worker failure. *Health endpoint and screen only; nothing pages anybody (`PLT-04` in part).*
- [~] `X02-06` Encrypt secrets and sensitive data appropriately; document rotation and emergency revocation. *Payout account numbers are sealed with AES-256-GCM under a key derived from `PAYOUT_ACCOUNT_KEY`; opening the whole number is audited. No rotation or revocation procedure is written.*
- [ ] `X02-07` Automate backups and perform a timed restore exercise. *`scripts/backup-drill.sh` exists; no backup has been restored (`PLT-05`).*
- [ ] `X02-08` Define availability, recovery-time, recovery-point, latency and support targets.
- [ ] `X02-09` Load-test matching, dashboards, offer concurrency, notification fan-out and settlement. *`scripts/load-test.ts`, `scripts/seed-performance.ts` and `scripts/page-budget.mjs` exist; no result is recorded.*
- [ ] `X02-10` Maintain production, staging, test and demo separation; never use live personal data in demos. *No staging (`QAL-02`).*

**G0 command evidence:** `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, production build, worker smoke test and `pnpm test:e2e`. All but the worker smoke test from the image have run green on `9a93861` (Section 12).

---

## X03 · Practitioner console

**Outcome:** a practitioner can complete the entire journey without staff performing hidden manual steps.

- [~] Onboard, verify phone, recover password and understand consent. *Forgot-password and the terms and privacy gate are done (`8f1c972`, `ede2f62`).*
- [ ] Build profile, level and credential evidence with clear eligibility blockers.
- [~] Set recurring and one-off availability. *One-off is done (`67639d8`).*
- [~] See complete offer terms; accept, decline or later counter. *Terms shown and kept (`9af9aff`); counter is N01.*
- [ ] View schedule, contact window, attendance, timesheet and expected payment.
- [ ] Cancel/report safely; open and track disputes/incidents/support.
- [~] See credential renewal, notifications and account/data controls. *The inbox with a bell and unread count is done (`7426f3a`); expiry warnings are texted (`fd31453`).*

**Pilot usability gate:** representative practitioners complete every pilot journey on their own phone with readable text and no developer explanation. *Not run: the browser checks so far are headless Chromium.*

---

## X04 · Facility console

**Outcome:** a facility can be verified, manage staff and complete the staffing journey without unsafe shortcuts.

- [~] Register the correct facility type; upload and renew evidence; recover from rejection. *Register and recover are done (`5551d16`, `4e578fc`); renewal is not.*
- [ ] Invite staff and assign only approved roles.
- [~] Create a complete level-aware request and understand total cost. *Level-aware is done (`ec30477`, `e0991d0`); a total-cost estimate is not.*
- [~] Review privacy-safe matches; invite, confirm, cancel and replace. *Privacy-safe, invite, confirm and cancel are done (`3c05bf9`, `54edb3a`, `a1a6bb4`); replace is not.*
- [~] Operate schedule, attendance, timesheets, disputes and incidents. *Disputes are done (`773e6ef`); the billed amount shows on approval (`48b1501`).*
- [ ] See invoices, payments, fees, credits and later settlement references.
- [ ] Access support and audit history appropriate to the role.

**Pilot usability gate:** facility owner, scheduler/ward manager and finance user can each complete only their authorised tasks.

---

## X05 · Operations console

**Outcome:** named teams can safely operate verification, exceptions, safety, support and money without database access.

- [ ] Separate queues and permissions for compliance, operations, clinical safety, support and finance.
- [~] Show queue age, priority, owner, service target and escalation. *The credential officer’s queue puts the longest-waiting first; no other queue shows age or targets.*
- [~] Provide safe actions for verification, disputes, incidents, sanctions, privacy and notification replay. *Verification (with evidence), sanctions, erasure and replay of a given-up event are done (`5551d16`, `7d40059`, `a720baa`, `434d1ea`).*
- [~] Provide maker-checker and step-up controls for high-risk identity and money actions. *Step-up on money acts is done (`5da6618`); the preparer cannot release (`UXO-03`).*
- [~] Provide reconciliation, export/erasure and reference-data screens. *Erasure, levels, pay floors and holidays are done; reconciliation is not.*
- [ ] Audit every decision and prevent officers from deciding their own conflicts.

---

## X06 · Public site, support, readability and accessibility

**Outcome:** users understand and trust the service before registration and can operate it on a phone, projector and weak connection.

- [~] Publish approved About, How it works, Safety, Pricing/free pilot, Terms, Privacy, Contact and Help pages. *Terms, privacy and contact render what is in force and say plainly when nothing has been published (`ede2f62`); the content is counsel’s. Pricing is `UXW-06`, a commercial statement.*
- [x] Add forgot-password entry and clear onboarding choices for practitioner and facility. *`8f1c972`.*
- [~] Increase small text, form labels and table readability; add a larger-text/demo mode. *Content text is 16 pixels and secondary text 14 (`6708bb6`); an A / A+ / A++ switch is remembered per device (`3dfbfbb`).*
- [~] Complete keyboard, focus, semantic label, contrast and screen-reader checks. *A two-pixel focus ring, a skip link and a drawer that traps focus (`7f83e8e`); contrast tokens retuned to WCAG AA with a test that reads the real stylesheet (`3dfbfbb`). No screen-reader pass.*
- [ ] Reduce page/request weight; show progressive loading without blocking the whole console.
- [ ] Test on low-cost Android devices, weak 3G/4G and common narrow screen sizes. *A crawl of every page in the three consoles at 390 pixels wide found no horizontal overflow; not run on a device.*
- [ ] Validate Hausa-assisted onboarding and critical templates during the Gombe study.
- [ ] Staff and publish the support telephone/WhatsApp hours and escalation path. *The telephone, WhatsApp, email and hours come from `SUPPORT_*` configuration and show on the public pages only when set (`ede2f62`).*

---

# 10. Expansion modules

## N01 · Unified Booking and two-sided marketplace — Gate G3

**Outcome:** either a facility or practitioner can initiate an engagement, but all paths converge on one safe Booking state machine.

### Ordered work

- [ ] Approve one Booking model with origin: `FACILITY_POSTED`, `PRACTITIONER_APPLIED` or `LISTING_BOOKED`.
- [ ] Add opt-in practitioner listings with availability window, level, location radius, expected rate and visibility expiry.
- [ ] Add facility shift board and practitioner applications.
- [ ] Add facility invitations to listings.
- [ ] Add proposals/counteroffers with at most the approved number of rounds.
- [ ] Add soft holds, expiry, revalidation, confirmation and immutable term snapshots.
- [ ] Protect listings from scraping; reveal contact only after confirmation and only for the approved window.
- [ ] Migrate existing assignments without losing audit history.

### Acceptance

- [ ] All three origins use the same eligibility, conflict, pricing, attendance and cancellation rules.
- [ ] Concurrent proposals cannot overbook a practitioner or request.
- [ ] Booking origin, proposals and accepted terms are visible in the audit trail.

---

## N02 · Provider payments and transparent success fee — Gate G4

**Outcome:** the facility pays a plainly disclosed fee after a successful engagement; the practitioner receives the agreed practitioner rate.

- [ ] Complete M12 and obtain payment, contract, VAT and withholding-tax advice.
- [ ] Keep the controlled pilot fee at 0% until the activation decision is signed.
- [ ] Model dated fee policy with payer, rate/fixed amount, caps, waivers and repeat-pair rules.
- [ ] Display practitioner pay, platform fee and provider charge separately before acceptance and on statements.
- [ ] Use provider-held/authorised funds; Medilink must not casually collect funds into its own account.
- [ ] Add settlement, refund, dispute hold, reversal, reconciliation and payout evidence.
- [ ] Measure whether fees reduce repeat booking or drive users off-platform.

**Activation gate:** counsel and provider approval, a clean month of reconciliation, no unexplained ledger difference and executive sign-off.

---

## N03 · Reviews, reputation and retention — Gate G5

**Outcome:** trustworthy behaviour is rewarded without creating an unfair or defamatory scoring system.

- [ ] Permit reviews only after a completed Booking.
- [ ] Use structured measures relevant to each side; keep free text moderated.
- [ ] Hold reviews until both submit or the review window closes.
- [ ] Separate private safety reports from public reputation.
- [ ] Provide appeal/correction and show sample size with scores.
- [ ] Add favourites, preferred pools, repeat booking, rota templates and replacement workflows.
- [ ] Monitor bias by profession, level, facility type, location and sample size.

---

## N04 · Clinical Resource Exchange — Gate G6

**Outcome:** verified facilities can list and book clinical equipment, laboratory capacity or workspace through a marketplace separate from staffing.

- [ ] Validate demand before implementation; select one low-risk resource category.
- [ ] Define owner, operator, maintenance, calibration, licence/accreditation, insurance and liability evidence.
- [ ] Model resource, location, capacity, availability, price, deposit, booking and responsible operator.
- [ ] Verify both listing facility and requesting user; prevent unsafe self-service where an operator is required.
- [ ] Add inspection, handover, incident, damage, cancellation and dispute records.
- [ ] Add provider payments and commission only after N02 is stable.
- [ ] Keep resource safety, ranking and disputes separate from practitioner ratings.

**Activation gate:** insurance, regulator and counsel approval; a completed safety assessment; one controlled resource type only.

---

## N05 · Premium services, partnerships and sponsorship — Gate G7

**Outcome:** Medilink earns sustainable revenue without selling safety, verification or fair access.

- [ ] Keep registration, verification, applying/booking, timesheets, safety reporting and receiving payment in the meaningful free core.
- [ ] Validate premium demand for analytics, integrations, enterprise controls, advanced reporting and managed services.
- [ ] Define individual/facility plans, billing, cancellation and entitlement enforcement.
- [ ] Permit only clearly labelled, clinically appropriate sponsorships.
- [ ] Never sell ranking, verification status, safety outcomes or personal/clinical data.
- [ ] Separate advertising targeting data from operational identity and health/safety records.
- [ ] Measure conversion, churn, marketplace liquidity and fairness before expansion.

---

# 11. Decisions that block completion

“Blocks” is a reading of the gap register, not a statement by the owner: it names the open P0 gaps and plan tasks that cannot be finished until the decision is recorded.

| ID | Decision | Owner | Needed by | Status | Blocks |
| --- | --- | --- | --- | --- | --- |
| D01 | First one or two professions for Gombe | Product + pilot lead | M02/M03 start | OPEN | `M02-01`; the credential types and requirements `CRE-01`, `CRE-02`, `CFG-01`, `CFG-03`, `UXP-03`, `QAL-06` |
| D02 | Validated level/cadre ladder and evidence | Clinical/compliance + regulators | G2 | OPEN | `M02-02`; the content of the Levels screen (`CFG-04`, `REQ-01`); whether a higher level may take a lower shift |
| D03 | Accepted verification for government hospitals and PHCs without CAC | Compliance + state authorities | M04 | OPEN | `M04-01`, `X01-02` |
| D04 | Primary messaging provider/channel and budget | Product + operations | M16 | OPEN | `M16-01`, `NOT-02`, `UXW-02` |
| D05 | Pilot cancellation, no-show and auto-approval policy | Product + clinical + legal | M10/M13 | OPEN | `M10-02` (`TIM-01`), `M13-02`–`M13-04`; whether a practitioner recorded as a no-show is told (`no_show.recorded` sends nothing today) |
| D06 | Medilink’s legal role and contracting parties | Counsel + owners | G1/G4 | OPEN | `BIL-13`, `M11-06`, `M12-08` |
| D07 | Payment architecture and licensed provider | Finance + counsel + engineering | G4 | OPEN | `BIL-13`, `BIL-09`, `M12-06` |
| D08 | Fee payer, launch fee and free-core promise | Owners + product + counsel | Public pages/G4 | Recommended: facility pays; pilot 0% | `BIL-13`, `UXW-06` |
| D09 | VAT and withholding-tax treatment | Tax counsel | G4 | OPEN | `N02` |
| D10 | NDPC obligations, DPIA, retention and hosting region | Privacy counsel + DevOps | G1 | OPEN | `AUD-05`, `M17-03`–`M17-06`; what may be shared about a clinical incident that names a person (the export holds it back); whether a practitioner flagged by sanctions screening is told, and how (`sanction.applied` sends nothing today); the retention schedule in `src/modules/audit-compliance/domain/erasure.ts` and `docs/data-inventory.md` are unreviewed |
| D11 | Clinical safety lead and incident escalation | Owners | M15 | OPEN | `M15-01`, `M15-03` (`INC-02`) |
| D12 | Support hours, telephone/WhatsApp ownership and response targets | Operations | G1 | OPEN | `M16`, `X06` support |
| D13 | Counteroffer rounds and commercial limits | Product + finance | G3 | Recommended: two rounds | `N01` |
| D14 | Hausa scope for pilot | Product + pilot panel | X06 | OPEN | `X06` |

Two more decisions were taken in code while the P0 gaps were closed and are **proposals, not signed off by anybody**; each is listed with its default in Phase0-progress.md and each wants an owner’s answer: a shift is matched to one level exactly; a shift straddling 20:00 or 06:00 counts as night when half or more of its minutes fall between them, and is held to the higher floor; a payout goes only to an account that has been the practitioner’s for 24 hours. The environment also needs an owner for `PLT-02`, `PLT-05` and `QAL-02` (somewhere to deploy to, a restored backup, a staging site).

No engineer should guess an open regulatory, clinical or money decision. The task remains blocked until its owner records the answer, date and evidence.

---

# 12. Release gates

## G0 · Technical baseline

Evidence is for `main` at `9a93861` (CI run 12; Section 5.3).

- [x] Fresh database can migrate and seed without manual repair. *CI: migrate up, down and up again, seed, row counts.*
- [x] Lint, typecheck and unit tests pass. *1,004 unit tests.*
- [x] Integration tests pass in isolation. *1,122 tests, 67 files, against a PostgreSQL service container; also run locally with no `.env`.*
- [x] Production build succeeds. *The end-to-end job builds and starts it.*
- [~] Worker and scheduled jobs start and process one event safely. *The worker runs in the end-to-end job and the journeys that wait on the outbox pass. The image has not been started, and the scheduled jobs have not been run from it.*
- [x] Browser journeys pass against the production build. *56 journeys, desktop and mobile.*
- [ ] Test and demo credentials are documented without using live data. *Not checked.*

## G1 · Controlled Gombe pilot

- [ ] M01–M18 pilot requirements applicable to the chosen scope are signed off.
- [ ] X01–X06 pilot requirements are signed off.
- [ ] Real messaging works and is monitored.
- [ ] Facility and practitioner support is staffed.
- [ ] Legal, privacy and clinical pilot conditions are written and accepted.
- [ ] No unresolved P0 safety, privacy, tenant-isolation or money-correctness defect remains. *Fourteen P0 gaps are open and eighteen fixed in part; none of the fourteen is a defect in what is built, and each needs a decision, a regulator’s content or an environment (Section 5.2).*
- [ ] At least 50 verified practitioners across the selected specialties are available before facility expansion.
- [ ] Five to ten pilot facilities complete moderated end-to-end rehearsals.
- [ ] Backup restore and incident-response exercises pass.
- [ ] Go/no-go review records owners, risks, rollback and stop conditions.

## G3 · Two-sided marketplace

- [ ] G1 evidence remains green.
- [ ] N01 acceptance passes under concurrency and privacy tests.
- [ ] Gombe study validates listings, invitations, applications and counteroffers.
- [ ] Marketplace liquidity and abuse monitoring are active.

## G4 · Real money and platform fee

- [ ] M12 and N02 are signed off by engineering, finance, legal, tax and the provider.
- [ ] Maker-checker and step-up controls are active.
- [ ] Refund, dispute, reversal and provider-outage drills pass.
- [ ] Reconciliation remains clean for one controlled month.
- [ ] Fee disclosure is clear and practitioner pay is not silently reduced.
- [ ] Owners sign the fee activation decision and rollback condition.

## G6/G7 · Resource exchange and premium services

- [ ] Staffing marketplace is stable and support capacity is adequate.
- [ ] Each expansion has its own legal, safety, privacy and financial assessment.
- [ ] The free core and neutral ranking are protected by automated tests and policy.
- [ ] Rollout begins with one cohort and a reversible feature flag.

---

# 13. Required sign-off record

Copy this block into the pull request or release record when a module changes readiness.

```text
Module:
Target readiness: PILOT READY / PRODUCTION READY
Commit/release:
Product owner:
Engineering reviewer:
QA reviewer:
Clinical/compliance reviewer:
Finance/legal reviewer, if applicable:
DevOps/on-call owner:

Acceptance checklist: PASS / FAIL
Unit tests:
Integration tests:
Browser tests:
Accessibility evidence:
Security/tenant evidence:
Migration and rollback:
Monitoring and runbook:
Known limitations accepted:
Approval date:
Next review date:
```

---

# 14. Progress-update rules

1. Update this file in every pull request that completes or reopens a task.
2. Never mark a parent module ready because only its API exists.
3. Link the merged commit beside completed tasks during the weekly documentation review.
4. Recount open P0/P1/P2 gaps monthly and reconcile them with the Blueprint gap register ([Gap-Reconciliation.md](Gap-Reconciliation.md) is the starting point).
5. Record accepted limitations explicitly; “we will remember” is not evidence.
6. Keep all production activation behind reviewed feature flags until the relevant gate passes.
7. After each pilot cohort, update decisions, metrics, incidents and module status before adding users.

**The immediate next action (v1.1)** is to close what G0 still lacks (start the production image and run the scheduled jobs from it; document the test and demo credentials) and to obtain the decisions in Section 11, beginning with D01, D04 and D05, which unblock the most work. Engineering that needs no decision can proceed in the plan’s dependency order (X02 → M01/M16/M17 → M02/M03/M04/X01 → M05–M15 → X03–X06): message delivery receipts and failover, the replacement search from a missed check-in, the feedback loop, agenda views and facility licence expiry.
