# Phase 0 progress — what has been fixed, and what has not

*Written against System Blueprint v3.0 and Module Reference v3.0. Branch `claude/focused-thompson-q3c4g0`.*

The blueprint lists 119 P0 gaps, 14 of which block a pilot. This note says which ones have been fixed in code, how each was shown to be fixed, and — as importantly — which have **not** been, and why. A gap appears under "fixed" only if a test that failed before the change passes after it. Where a fix is partial the remainder is stated.

**Verification.** Every fix below was written test-first: the new test was run and seen to fail for the reason the gap predicts before the code changed. Final state: 638 unit tests and 666 integration tests (38 files, against a real PostgreSQL) all pass; type-check and lint are clean. Before this work the suites held 600 and 563.

## Fixed

| Gap | What was wrong | What changed | Commit |
|---|---|---|---|
| AUT-01 | `revokeGrant` never compared the grant's scope with the scope the guard approved; a facility owner could revoke any hospital's staff by id. | The caller must name the grant's own scope and it must match. Proven by revoking another tenant's grant before the fix. | `a0bb6da` |
| MAT-01 | A match result carried every candidate's full name and unmasked phone number, ranked and excluded, to any facility. | Initials only until a booking exists; phone shown only from 48 h before the shift to 24 h after; exclusion reasons no longer name people. | `3c05bf9` |
| MAT-02 | Confirm locked the practitioner, not the request: two people could take the last place, and a full shift of two stayed PUBLISHED then EXPIRED. | The request row is locked first, then the practitioner, always in that order, and re-read under the lock. Fails 3 of 3 runs with the lock removed. | `54edb3a` |
| MAT-03 | Invite, accept and confirm never re-checked licence, profession, consent, the facility's status or the clock. | All three ask again. Declining stays possible for someone who has since lapsed. | `54edb3a` |
| MAT-04 | Match and invite did not require a published request or a verified facility. | Refused for an unpublished request, a started shift, or a facility that cannot publish. | `54edb3a` |
| DSP-01, DSP-02 | Dispute evidence had no party check, the download ignored the dispute id, and the case list for a shift was open to any caller who named it. | Every read and write asks where the caller stands on the case. Only the two sides add evidence; the two sides and an adjudicator read; outsiders get "not found". | `52a0456` |
| INC-01 | A clinical incident's subject could be any user id, or override the practitioner on the shift named. | A named shift must agree with its practitioner; a named person must have been booked by the facility. | `52a0456` |
| ATT-01 | Any signed-in practitioner who heard the check-in code could check someone else in. | Only the person booked onto the shift can present the code, and only while the booking is confirmed. | `52a0456` |
| ATT-02 | A facility could issue codes or write hours for another facility's shift. | Both routes prove the shift belongs to the facility named. | `52a0456` |
| REQ-02, SAN-02 | Cancelling a request left confirmed bookings live, so the sweep later asked an officer whose fault an absence was. | Cancelling a request cancels every confirmed booking in the same transaction, with the reason and actor on each history. | `a1a6bb4` |
| MAT-05 | No screen could cancel a booking; the API wrote unconditionally, emitted no event and told nobody. | One cancel function, conditional on the booking still being confirmed (two at once leave one history row), refused once the shift is over, publishing `assignment.cancelled` with a notification. A Cancel action on the roster and on filled shifts. | `a1a6bb4` |
| PRA-08 | Renewing an expired credential never cleared `credential_expired`. | An expired row counts only while nothing of that type is verified. | `6b84a20` |
| PRA-10 | A raw NIN stayed in clear on rejected, queried or mismatched submissions. | Masked on every decision; resupplying a NIN asks for the number again. | `6b84a20` |
| BIL-01, TIM-03 | Billing lost minutes when a night and a holiday overlapped. | The exact split is stored on the timesheet and billed from. A new migration backfills existing rows to what they were priced at. | `9cf2997` |
| BIL-04 | Two simultaneous "prepare" clicks created two full payouts; release never re-checked the balance. | Prepare is serialised per practitioner and release re-checks. | `00196bb` |
| NOT-03, NOT-04, NOT-05 | A failed text was recorded as handled; a failed code was answered "code sent"; times were printed in UTC. | The event is retried and reaches only the people missed; a failed code answers 503 and is audited; times are Lagos time. | `a1c6576` |
| PLT-03 | A worker killed after claiming left events in PROCESSING for ever. | Claims carry a five-minute lease and expired ones are reclaimed; one that dies on its last attempt is dead-lettered with a reason. | `434d1ea` |
| PLT-01 | The production image had no `src/` (so no worker) and no `next.config.mjs` (so no security headers), and nothing ran migrations. | The image carries them, starts through an entrypoint that can migrate, and CI now builds it and asserts its contents. | `2aa1a23` |
| AUT-03 | Every attempt made while locked extended the lock; a password reset did not clear it. | Refused attempts are recorded but not counted; completing a reset clears the lock. | `8e7f356` |
| AUT-04 | The password step was not bound to the code step: anyone who knew a verified-but-passwordless number could claim it. | Verifying the phone returns a 30-minute signed token and set-password requires it. | `52353b6` |
| AUT-05 | The five-guess limit could be exceeded by parallel guesses (40 of 40 were judged). | The attempt is taken in one conditional UPDATE before the guess is judged. | `515f2f3` |
| AUT-09 | No Content-Security-Policy and no HSTS. | Both added and unit-tested; a production build loaded 16 pages across four consoles in headless Chromium with no CSP violation. | `a4bd229` |
| AUT-06 | No forgot-password screen; the lockout message told people to reset and there was nowhere to do it. | `/forgot-password` (number, code, new password), linked from the login page and from the lockout message. Verified in headless Chromium: lock an account, reset through the screen, sign in while the old lock would still be running. | `8f1c972` |
| UXW-05 | The public login page told every visitor about `seed-demo.ts`. | Removed. | `8f1c972` |
| INC-03 | A severe or fatal incident raised no alert. | The worker texts everybody holding `incident.manage` for SEVERE and DEATH — facility and severity only, never what happened. With nobody to tell, the event fails visibly instead of looking handled. | `0421b43` |
| DSP-03 | Nobody was told when a dispute was opened, picked up, decided or withdrawn. | Three new events published in the same transaction; each side is texted what concerns it, never the argument or the officer's notes. | `56fe6ed` |
| SCH-02, SAN-01 (first half) | No reminder; an absence was noticed only after the shift ended. | Two scheduled jobs: a reminder three hours before, and an alert to practitioner and facility thirty minutes after the start if nobody has checked in. Neither decides anything. | `ed67c35` |
| UXA-02, UXA-06 | 1px focus ring, 36px controls, 28px tabs, no skip link, and a "modal" drawer that did not trap focus. | 2px ring with offset, 40px controls and 36px tabs, a skip link, and a drawer that traps focus, restores it and locks background scroll. Fourteen pages checked at 390px for overflow. | `7f83e8e` |

## Fixed in part — the remainder is stated

| Gap | Done | Not done |
|---|---|---|
| AUT-02 | Sends are limited per address (30/hour) and overall (600/hour), checked before anything is created. | The address is whatever the edge puts in `X-Forwarded-For`; unless the platform overwrites it, a caller can rotate it and only the overall budget remains. Login attempts are still throttled per phone only. The limits are pilot guesses, not measurements, and nothing alerts when one is spent (PLT-04). |
| AUT-07, FAC-03 | The staff lookup by phone number refuses a facility that is not VERIFIED. | An unverified facility's owner can still create drafts and grant roles to people whose ids they already hold. Gating facility permissions on verification changes the onboarding flow and wants a decision. |
| PLT-01 | The image is corrected and CI builds it. | **The image has not been built here** — there is no Docker daemon in this environment. The worker was started from a scratch directory holding exactly the runner's files and ran. PLT-02 (nothing deploys) is untouched. |
| NOT-03/04 | Failures are retried and visible. | Nothing reaches a real phone: there is still no SMS gateway (NOT-02). Password reset and resend keep the generic answer on a gateway failure, deliberately, so a 503 does not reveal which numbers have accounts. |
| NOT-01, CRE-07 | Offers, acceptances, cancellations, disputes, severe incidents, shift reminders and every credential decision now send a text. | Timesheet and invoice decisions, payouts, and expiry warnings (CRE-08) still send nothing, and nothing reaches a real phone until a gateway exists (NOT-02). |
| SAN-01 | The practitioner and facility are told thirty minutes into a shift with no check-in. | The replacement search the blueprint recommends opening from an absence is not built. |

## Not done, and why

**Needs an outside party or a signed decision — cannot be closed in code alone.**
NOT-02 and NOT-06 (an SMS gateway needs an account, a sender ID and credentials; the boot guardrails still accept two provider names that have no adapter). BIL-03, BIL-05, BIL-13 and the money model (fee model, legal role and provider-held payments are all "not started"; BIL-03 — a payout that does not require its invoice to have been paid — belongs to that decision, not to a patch). AUD-03, AUD-05 (agreement content, regulator registration, DPO and counsel's opinion). CRE-01, CRE-02, CFG-01, CFG-02, QAL-06 (the credential types and pay floors for nurses, pharmacists, laboratory scientists and radiographers need the regulators' actual requirements and an owner's decision; inventing them would be a regulatory claim). PRA-14, CFG-03 (the sanctions and "quack" lists need a real source). PLT-05 (backups need an environment).

**Large features, not started.** The level/cadre/registration-category model (PRA-01, PRA-02, REQ-01, CFG-04), one Booking entity (the v3 core), erasure (AUD-01), facility onboarding and profile screens (FAC-01, FAC-02, UXF-01, UXO-01), facility participation in disputes (DSP-04), the money flows (BIL-02, BIL-06 to BIL-12), first super-administrator (AUT-08), type size, contrast, a larger-text switch and manifest icons (UXA-01, UXA-03, UXA-04, UXA-08).

**Small items not yet attempted.** AUD-02 (personal data in audit rows), PLT-04 (alerts — nothing yet watches a failed event, a dead-lettered one, or a spent send budget), AUT-10/QAL-01 (a suite that proves every id-taking route refuses another tenant — the fixes above each have their own route-level test, but there is no sweep over all routes yet).

## Things to know when you pick this up

- **Two new migrations** (`timesheet_exact_bands`, `otp_send_budget`). Run `pnpm db:deploy` on any existing database; the app returns 500s on timesheet reads until you do.
- **One API contract changed (AUT-04)**: `verify-phone` now returns `setupToken` and `set-password` requires it. The registration page, `scripts/e2e.py`, `scripts/simulate.py` and `scripts/smoke-auth.ps1` are updated; any other client is not.
- **`.env` sets `NODE_ENV=development`**, which makes `next build` fail with an `<Html>` import error. Unset it for builds.
- **The demo seed** now gives the suspended practitioner a shift at the flagship hospital, because a facility can only name someone it has booked.
