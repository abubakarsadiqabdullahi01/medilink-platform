# Phase 0 progress — what has been fixed, and what has not

*Written against System Blueprint v3.0 and Module Reference v3.0. Branch `claude/focused-thompson-q3c4g0`.*

The blueprint lists 119 P0 gaps, collected into fourteen pilot blockers. This note says which have been fixed in code, how each was shown to be fixed, and — as importantly — which have **not** been, and why.

**Where it stands: of the 119 P0 gaps, 72 are fixed, 16 are fixed in part and 31 are not done.** Of the fourteen blockers, one (facility onboarding) is closed in code. Several of the "fixed" rows still need something only a person outside engineering can supply (published terms, regulators' lists, counsel's sign-off); the caveat is on the row.

**What "fixed" means here.** Each fix was written test-first: the new test was run and seen to fail for the reason the gap predicts before the code changed, and where a test cannot see it (a screen, an interaction) it was driven in headless Chromium against a running server. A control case was run where a test could pass for the wrong reason. Nothing is counted as fixed because it was written.

**Verification.** 877 unit tests pass; type-check and lint are clean. Every integration file that touches the changed code was run against a real PostgreSQL and passes; the result of one complete run of the whole integration suite is recorded in the commit that follows this one. Before this work the suites held 600 unit and 563 integration tests.

## The fourteen pilot blockers

| # | Blocker | In code | What is left |
|---|---|---|---|
| 1 | Cross-tenant access and scope | 7 fixed, 2 in part | AUT-10 and QAL-01 (a sweep proving every id-taking route refuses another tenant — each fix has its own route-level test, but no sweep exists); AUT-07 and FAC-03 (the staff lookup is gated; an unverified facility's owner can still create drafts and grant roles to people whose ids they hold) |
| 2 | Contact details and personal data | 8 fixed, 2 in part | AUD-05 (regulator registration, a data protection officer, counsel's opinion); AUD-03 and AUD-04 in part — see below |
| 3 | Overbooking, stale checks, cancellation | 9 fixed, 1 in part | SAN-01: the replacement search the blueprint recommends opening from an absence |
| 4 | Nobody is told anything | 8 fixed, 2 in part | **NOT-02, NOT-06, UXW-02: there is still no SMS gateway, so nothing reaches a real phone.** Needs an account, a sender ID and credentials. UXP-01 (no in-app inbox or bell) |
| 5 | Verification only works for doctors | 3 fixed | CRE-01, CRE-02, CFG-01, CFG-02, CFG-03, UXP-03, QAL-06, RAT-01: the credential types, requirements and pay floors for four professions are the regulators' to state |
| 6 | The level model | none | PRA-01, PRA-02, REQ-01, CFG-04, UXF-06: a large feature, not started |
| 7 | Facility onboarding and verification | **all 9 fixed** | — |
| 8 | Disputes, incidents, fairness | 2 fixed, 1 in part | DSP-04 (facilities cannot take part in a dispute), INC-02 (an incident restricts nobody — a policy decision), BIL-09 (an upheld dispute cannot change an invoice), DSP-05 in part |
| 9 | Billing wrong in specific cases | 7 fixed, 2 in part | TIM-01 (no deadline after which hours are approved), SCH-03 (the shift form's date inputs still follow the browser's time zone) |
| 10 | Money is not safe to move | 3 fixed, 2 in part | BIL-02, BIL-03, BIL-05, BIL-06, BIL-13: the money model, the legal role and the provider are unsigned decisions; BIL-07 and UXO-03 in part |
| 11 | Abuse and account security | 7 fixed, 1 in part | AUT-02: the per-address limit trusts whatever the edge puts in `X-Forwarded-For` |
| 12 | Running it in production | 1 fixed, 2 in part | PLT-02 (nothing deploys), PLT-05 (no backup has been restored), QAL-02 (no staging); PLT-01 and PLT-04 in part |
| 13 | Readable and usable | 6 fixed, 1 in part | UXA-01: body text is 15px, the blueprint asks for 16–18 |
| 14 | The public face | 2 fixed | UXW-06: whether and how to say that use is free during launch is a commercial statement |

## Fixed

### Rounds one and two

| Gap | What was wrong | What changed | Commit |
|---|---|---|---|
| AUT-01 | `revokeGrant` never compared the grant's scope with the scope the guard approved; a facility owner could revoke any hospital's staff by id. | The caller must name the grant's own scope and it must match. Proven by revoking another tenant's grant before the fix. | `a0bb6da` |
| MAT-01, UXF-04 | A match result carried every candidate's full name and unmasked phone number, ranked and excluded, to any facility; the roster showed every phone number permanently. | Initials only until a booking exists; phone shown only from 48 h before the shift to 24 h after; exclusion reasons no longer name people. | `3c05bf9` |
| MAT-02 | Confirm locked the practitioner, not the request: two people could take the last place, and a full shift of two stayed PUBLISHED then EXPIRED. | The request row is locked first, then the practitioner, always in that order, and re-read under the lock. Fails 3 of 3 runs with the lock removed. | `54edb3a` |
| MAT-03, PRA-26 | Invite, accept and confirm never re-checked licence, profession, consent, the facility's status or the clock. | All three ask again. Declining stays possible for someone who has since lapsed. | `54edb3a` |
| MAT-04 | Match and invite did not require a published request or a verified facility. | Refused for an unpublished request, a started shift, or a facility that cannot publish. | `54edb3a` |
| DSP-01, DSP-02 | Dispute evidence had no party check, the download ignored the dispute id, and the case list for a shift was open to any caller who named it. | Every read and write asks where the caller stands on the case. Only the two sides add evidence; the two sides and an adjudicator read; outsiders get "not found". | `52a0456` |
| INC-01 | A clinical incident's subject could be any user id, or override the practitioner on the shift named. | A named shift must agree with its practitioner; a named person must have been booked by the facility. | `52a0456` |
| ATT-01 | Any signed-in practitioner who heard the check-in code could check someone else in. | Only the person booked onto the shift can present the code, and only while the booking is confirmed. | `52a0456` |
| ATT-02 | A facility could issue codes or write hours for another facility's shift. | Both routes prove the shift belongs to the facility named. | `52a0456` |
| REQ-02, SAN-02 | Cancelling a request left confirmed bookings live, so the sweep later asked an officer whose fault an absence was. | Cancelling a request cancels every confirmed booking in the same transaction, with the reason and actor on each history. | `a1a6bb4` |
| MAT-05 | No screen could cancel a booking; the API wrote unconditionally, emitted no event and told nobody. | One cancel function, conditional on the booking still being confirmed, refused once the shift is over, publishing `assignment.cancelled` with a notification. A Cancel action on the roster and on filled shifts. | `a1a6bb4` |
| PRA-08 | Renewing an expired credential never cleared `credential_expired`. | An expired row counts only while nothing of that type is verified. | `6b84a20` |
| PRA-10 | A raw NIN stayed in clear on rejected, queried or mismatched submissions. | Masked on every decision; resupplying a NIN asks for the number again. | `6b84a20` |
| BIL-01, TIM-03 | Billing lost minutes when a night and a holiday overlapped. | The exact split is stored on the timesheet and billed from. A migration backfills existing rows to what they were priced at. | `9cf2997` |
| BIL-04 | Two simultaneous "prepare" clicks created two full payouts; release never re-checked the balance. | Prepare is serialised per practitioner and release re-checks. | `00196bb` |
| NOT-03, NOT-04, NOT-05 | A failed text was recorded as handled; a failed code was answered "code sent"; times were printed in UTC. | The event is retried and reaches only the people missed; a failed code answers 503 and is audited; times are Lagos time. | `a1c6576` |
| PLT-03 | A worker killed after claiming left events in PROCESSING for ever. | Claims carry a five-minute lease and expired ones are reclaimed; one that dies on its last attempt is dead-lettered with a reason. | `434d1ea` |
| AUT-03 | Every attempt made while locked extended the lock; a password reset did not clear it. | Refused attempts are recorded but not counted; completing a reset clears the lock. | `8e7f356` |
| AUT-04 | The password step was not bound to the code step: anyone who knew a verified-but-passwordless number could claim it. | Verifying the phone returns a 30-minute signed token and set-password requires it. | `52353b6` |
| AUT-05 | The five-guess limit could be exceeded by parallel guesses (40 of 40 were judged). | The attempt is taken in one conditional UPDATE before the guess is judged. | `515f2f3` |
| AUT-09 | No Content-Security-Policy and no HSTS. | Both added and unit-tested; a production build loaded 16 pages across four consoles in headless Chromium with no CSP violation. | `a4bd229` |
| AUT-06, UXW-01 | No forgot-password screen; the lockout message told people to reset and there was nowhere to do it. | `/forgot-password` (number, code, new password), linked from the login page and the lockout message. Verified in a browser end to end. | `8f1c972` |
| UXW-05 | The public login page told every visitor about `seed-demo.ts`. | Removed. | `8f1c972` |
| INC-03 | A severe or fatal incident raised no alert. | The worker texts everybody holding `incident.manage` for SEVERE and DEATH — facility and severity only. With nobody to tell, the event fails visibly instead of looking handled. | `0421b43` |
| DSP-03 | Nobody was told when a dispute was opened, picked up, decided or withdrawn. | Three new events published in the same transaction; each side is texted what concerns it, never the argument or the officer's notes. | `56fe6ed` |
| SCH-02 | No shift reminder. | A scheduled job texts the practitioner three hours before a confirmed shift; nobody is told twice. | `ed67c35` |
| UXA-02, UXA-06 | 1px focus ring, 36px controls, no skip link, and a "modal" drawer that did not trap focus. | 2px ring with offset, a skip link, a drawer that traps focus, restores it and locks background scroll. | `7f83e8e` |
| CRE-07 | A credential decision told the practitioner nothing. | Every decision is an event and the practitioner is texted; expiry warnings followed in round four. | `63c904a` |

### Round three

| Gap | What was wrong | What changed | Commit |
|---|---|---|---|
| FAC-04 | Self-registration took the raw CAC string while operations normalised it, so somebody could register another hospital's number in a different spelling, slip past the duplicate check and wait to be verified as a hospital that already existed. | Self-registration uses the same schema and `createFacility` normalises for every caller. Hyphens, slashes and dots count as nothing; leading zeros are left alone. | `3008e5c` |
| INC-04 | A clinical incident summary could name the patient. | A summary that identifies a patient is refused, with what to write instead. | `c87f795` |
| FAC-01, FAC-02, UXF-01, UXF-03 | A refused facility was stuck: the CAC number could not be edited and the dashboard told the owner to "reply with the corrected documents" with no way to. No screen uploaded a licence or showed what compliance held. | A refused facility can correct itself and go back for review (only after a refusal, and only if something changed). A facility profile screen with licence upload, the refusal and compliance's reason. Checked in a browser against a local S3 emulator. | `4e578fc` |
| REQ-03, UXP-02 | The offer hid the cancellation terms, ward notes, address and headcount; nothing recorded what the practitioner had been shown. | The offer shows them above the buttons; accepting copies what was shown onto the invitation, as it stood. | `9af9aff` |
| RAT-02 | Premiums were priced from whichever rate card was active when the invoice was raised, so a card swapped after booking changed what the practitioner was paid. | Confirming copies the allowances in force for the shift's date onto the booking; invoicing prices each shift on its own terms. | `2f0f91a` |
| TIM-02, BIL-11, UXF-07 | A facility approved hours at the base rate and was invoiced for more. | The approval screen shows "To be billed" with the split, priced by the same function the invoice uses. | `48b1501` |
| RAT-03 | Six fixed dates for 2026 and nothing after: from 27 December 2026 no shift was ever a holiday, and nothing said so. | Fixed holidays and Easter-derived ones generated to 2030; a route and screen to add the declared Islamic holidays; a coverage check that names what is missing. | `20fb06d` |
| BIL-12 | The step-up guard sat on two permissions, neither of which moves money. | `payout.manage` — issue, record payment, prepare, release — needs a password confirmed in the last few minutes; the screens ask in a dialog and repeat the action. | `5da6618`, `76bc4da` |
| BIL-10 | A payout paid everything the ledger said was owed, including a shift under dispute. | A dispute holds what was credited for that shift and nothing else; the hold lifts when the case ends. Only the unpaid part is held. | `27e58b7` |
| BIL-08 | `VOID` existed in the database and nothing set it, so a wrong draft could not be cancelled. | Voiding a draft reverses each credit with a balanced entry (the originals stay), frees the shifts, records who and why, and needs a fresh password. Refused once a payout has moved. | `37e9ac8` |
| AUD-02 | Names, emails, phone numbers and free text were written into the audit trail, which is kept for good. | The redactor drops identifying keys and scrubs emails and Nigerian numbers from any text. A test reads every audit row back. Rows written before keep what they held. | `80a314e` |
| PRA-14 | The sanctions and "quack" lists shipped empty and nothing could write to them, so screening reported everybody clear. | A route and screen to add entries (one at a time or a pasted notice of up to 500) and remove them with a reason; everybody is screened again at once. **The lists' content is compliance's to supply from the regulators' notices; the screen says so while it is empty.** | `7d40059` |
| AUD-01, UXO-04 | Closing an erasure request recorded words and deleted nothing. | One action replaces the person's details, deletes their files and closes the account, keeping the audit trail, ledger, shifts, disputes and incidents. A test scans every text column for the person afterwards. **The retention schedule needs counsel's and a data protection officer's sign-off before it is run on a real person's data.** | `a720baa` |

### Round four

| Gap | What was wrong | What changed | Commit |
|---|---|---|---|
| UXA-03, UXA-04, UXA-08 | Input borders were 1.31:1; warning badges 3.0:1; no larger-text mode; no install icons. | Tokens retuned to WCAG AA and a test reads the real stylesheet and asserts every pair in light and dark; an A / A+ / A++ switch remembered per device; manifest icons at 192, 512 and maskable. 17 pages checked at 390px for overflow. | `3dfbfbb` |
| CRE-08, UXF-05 | Nobody was told that hours were waiting, that a licence was about to expire, or that an invoice was ready. | Texts for hours submitted, approved or not, invoice issued and payment sent; a warning a month and a week before a verified credential expires. | `fd31453` |
| UXP-04, UXW-03, UXW-04 | The engagement agreement was an optional line; a hospital could publish shifts having never accepted its terms; the sign-up form linked to neither terms nor privacy. | Accepting an offer needs the terms and privacy notice in force; publishing needs the hospital's terms; creating an account needs the privacy notice. `/terms`, `/privacy` and `/contact` render what is in force and say plainly when nothing has been published; support phone, WhatsApp, email and hours come from `SUPPORT_*` configuration and are shown only when set. **What the documents say is counsel's; no contact detail is invented.** | `ede2f62` |
| FAC-05, UXF-02, UXO-01, UXO-02 | A CAC number was mandatory, so government hospitals and primary health centres could not register; no screen created a facility for operations; "Verify" was live with no licence on file. | A facility is registered as a CAC company, a government facility (ministry reference) or another body, with the unique rule per kind. Operations have a "Register a facility" dialog. Approving needs the licence on file, every check confirmed and how it was checked in words; refusing needs only a reason. | `5551d16` |

### Round five (this session)

| Gap | What was wrong | What changed | Commit |
|---|---|---|---|
| AUT-08 | No way to create the first super administrator in production: the role is never offered and the scripts that create one refuse to run outside local. | `scripts/create-first-administrator.ts`, in the production image: the password is typed without echo (or read from `FIRST_ADMIN_PASSWORD`) and stored only as a hash; it refuses once a super administrator exists (`--additional` is the deliberate exception); it will not touch an existing account; it writes an audit row naming who ran it. Run against a real terminal to confirm the password is not echoed. | `2d50b55` |
| AVL-02 | The screen could build a weekly pattern and nothing else; all day was impossible to enter and 00:00–23:59 refused every overnight shift. | All day, Every day and Monday–Friday on the weekly form; a "Free on a date" tab with one-tap Free tonight, Free all day today and tomorrow, and a date form. Worked out in Lagos time. Checked in a browser. | `67639d8` |
| CRE-04 | A credential's expiry was the review date plus the type's review days, so a practitioner saw a date that appears nowhere on their document. | The reviewer reads the printed date off the document; it is stored and shown to the practitioner, and the expiry sweep and warnings act on the end of that day in Lagos. The review interval is only the fallback and every screen says when a date is an estimate. Refused: a date in the past, more than 15 years ahead, for a credential that does not expire, or sent with anything but an approval. Checked in a browser. | `0f009cc` |

## Fixed in part — the remainder is stated

| Gap | Done | Not done |
|---|---|---|
| AUT-02 | Sends are limited per address (30/hour) and overall (600/hour), checked before anything is created. | The address is whatever the edge puts in `X-Forwarded-For`; unless the platform overwrites it a caller can rotate it and only the overall budget remains. Login attempts are still throttled per phone only. The limits are pilot guesses, not measurements. |
| AUT-07, FAC-03 | The staff lookup by phone number refuses a facility that is not VERIFIED. | An unverified facility's owner can still create drafts and grant roles to people whose ids they already hold. Gating facility permissions on verification changes the onboarding flow and wants a decision. |
| PLT-01 | The image carries the worker, `src/`, `next.config.mjs` and the first-administrator command; CI builds it and asserts its contents. | **The image has not been built here** — there is no Docker daemon in this environment. The worker was started from a scratch directory holding exactly the runner's files and ran. |
| PLT-04 | A System health screen and `/api/v1/health/background` show whether the worker is delivering, what it has given up on and why; a given-up event can be replayed. | **Nothing pages anybody.** There is no alert channel or external monitor configured, only the endpoint to point one at. |
| NOT-01, UXP-01 | Offers, acceptances, cancellations, disputes, severe incidents, shift reminders, credential decisions, hours, invoices, payments and expiring licences all send a text. | Nothing reaches a real phone until a gateway exists (NOT-02). Password reset and resend keep the generic answer on a gateway failure, deliberately, so a 503 does not reveal which numbers have accounts. There is no in-app inbox or bell. |
| SAN-01 | The practitioner and facility are told thirty minutes into a shift with no check-in. | The replacement search the blueprint recommends opening from an absence is not built. |
| TIM-01 | A reminder to the facility after a day and three days of unapproved hours; the practitioner is told at three days they are being chased. | A deadline after which hours are approved for the facility is a commercial decision and is not made. |
| SCH-03 | Holidays to 2030 (RAT-03) and Lagos time in messages (NOT-05). | The shift form's date inputs still follow the browser's time zone. |
| AUD-03 | Terms and privacy are enforced for a practitioner accepting an offer, a facility publishing, and anyone registering; a new version is asked for again. | A facility-level acceptance record (the hospital as an organisation, not the person) is not built, and the content of the documents is counsel's. |
| AUD-04 | `docs/data-inventory.md` (generated from the code and checked against the schema, so a new table cannot ship unclassified) lists every kind of data with purpose, proposed basis, owner, retention and what removes it. A daily job deletes one-time codes (7 days), ended sessions (30), the sign-in log (90), delivered queue entries (30) and abandoned uploads (7). | **Every period and every lawful basis is the team's proposal, not signed off by counsel or a data protection officer.** Messages, security events, search rankings, rejected documents and old availability have a proposed period that nothing enforces; money, disputes, incidents and the audit trail are kept with their legal period undecided. |
| BIL-07 | Recording a payment takes the bank's reference, the amount, the date it arrived and who paid; the amount must be the invoice's, the date cannot be in the future or before issue, and the audit row carries the amount and date but not the payer or reference. | Part payments, over-payments and one transfer covering several invoices have no model and are refused. |
| UXO-03 | A payout cannot be released by the person who prepared it (`PAYOUT_SECOND_APPROVER=off` for a pilot with one finance person, as a deliberate decision). | Recording a payment is still one person; payouts prepared before the preparer was recorded are not held back. |
| UXA-01 | Secondary text 12px → 13px, content 14px → 15px, menu headings 11px → 13px; controls 44px; larger-text switch. | The blueprint asks for 16–18px body text. The projector size is not offered below tablet width (three pages overflow at 390px if forced). |
| DSP-05 | A dispute holds the amount in dispute (BIL-10). | No credit note and no reversal entry for an upheld dispute; that waits on the money model. |

## Not done, and why

**Needs an outside party or a signed decision — cannot be closed in code alone (23).**
- *An SMS gateway:* NOT-02, NOT-06, UXW-02. It needs an account, a sender ID and credentials; the boot guardrails still accept two provider names that have no adapter.
- *The money model:* BIL-02, BIL-03, BIL-05, BIL-06, BIL-13, and BIL-09 which follows it. The fee model, legal role and provider-held payments are "not started"; BIL-03 — a payout that does not require its invoice to have been paid — belongs to that decision, not to a patch.
- *Counsel, a data protection officer, the regulator:* AUD-05.
- *The regulators' actual requirements:* CRE-01, CRE-02, CFG-01, CFG-02, CFG-03, UXP-03, QAL-06, RAT-01. The credential types, requirements, sanctions lists and pay floors for nurses, pharmacists, laboratory scientists and radiographers; inventing them would be a regulatory claim.
- *A commercial statement:* UXW-06 (pricing). *A policy:* INC-02 (what an open incident restricts, and for whom).
- *An environment:* PLT-02, PLT-05, QAL-02 (deploy pipeline, a restored backup, staging).

**Large features, not started (6).** The level / cadre / registration-category model (PRA-01, PRA-02, REQ-01, CFG-04, UXF-06) — the blueprint's blocker 6, and the most expensive thing to retrofit once there is pilot data. Facility participation in disputes (DSP-04): no facility screen exists and the evidence routes are unreachable by facility grants.

**A sweep, not started (2).** AUT-10 and QAL-01: a suite that calls every id-taking route as a user from another tenant. Each fix above has its own route-level test; there is no sweep over all routes, so "no route lets one tenant reach another" is not proved, only the routes that were found.

## Things to know when you pick this up

- **Nine new migrations** since the baseline: `timesheet_exact_bands`, `otp_send_budget`, `invitation_terms_accepted`, `assignment_rate_terms`, `invoice_lines_voidable`, `facility_registration_kind`, `credential_document_expiry`, `invoice_payment_record`, `payout_prepared_by`. Run `pnpm db:deploy` on any existing database, and restart anything holding the old Prisma client (a dev server keeps it in memory and fails with "Unknown argument" until restarted).
- **Run `pnpm db:seed` after deploying.** It registers the new scheduled jobs (`credential.expiry_warning_sweep`, `timesheet.approval_reminder_sweep`, `retention.purge_sweep`), the new permissions (`system.manage`, `data.erase`) and the holidays to 2030.
- **API contracts changed.** `register` accepts `acceptedTerms` (required once a privacy notice is published); `invoices/:id/pay` requires `paymentReference`, `amountKobo`, `paidOn` and `payerName`; `credentials/:id/review` accepts `printedExpiryDate`; `facilities/:id/verify` takes `checks` and evidence on approval; facilities carry `registrationKind`; `GET /payouts` carries `heldKobo` and, at platform scope, `preparedByYou` and `secondApproverRequired`. The in-repo clients (`scripts/e2e.py`, `simulate.py`, `smoke-auth.ps1`, the Playwright specs, the demo seed) are updated; any other client is not. `verify-phone` now returns `setupToken` and `set-password` requires it.
- **New configuration.** `SUPPORT_PHONE`, `SUPPORT_WHATSAPP`, `SUPPORT_EMAIL`, `SUPPORT_HOURS` (shown on the public pages only when set) and `PAYOUT_SECOND_APPROVER` (leave unset; `off` only for a one-person pilot). Both are in `.env.example`.
- **New commands.** `scripts/create-first-administrator.ts` (in the production image) and `scripts/render-data-inventory.ts` (regenerate `docs/data-inventory.md` whenever the inventory changes; a test fails until you do).
- **For counsel and the data protection officer:** `docs/data-inventory.md` and the retention schedule in `src/modules/audit-compliance/domain/erasure.ts`. Neither has been reviewed.
- **The integration suite runs with `PAYOUT_SECOND_APPROVER=off`** so that the rest of the money flow can be driven by one person; the cases that are about the rule unset it.
- **`.env` sets `NODE_ENV=development`**, which makes `next build` fail with an `<Html>` import error. Unset it for builds.
- **The demo seed** gives the suspended practitioner a shift at the flagship hospital, because a facility can only name someone it has booked, and releases its payouts as a second person.
- **Nothing here has been run on a phone, behind a real proxy, with a real SMS provider, or against a real bank.** The browser checks were headless Chromium against a dev server and a local object store.
