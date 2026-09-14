# Stage 3 — Before any code: gate checklist

Nothing in this stage is development work and all of it blocks development.
Code in this repository may progress on step 3.9 only; the rest gates
production development.

| # | Step | Owner | Status | Evidence required |
| --- | --- | --- | --- | --- |
| 3.1 | Revenue model confirmed: commission, subscription or listing fee; who bears it; when it is taken | Founder | Not started | Signed decision plus a hand-worked fee, tax and payout example for one shift |
| 3.2 | Legal opinion on Medilink's role: introducer, agency or employer | Counsel | Not started | Dated, signed opinion on file |
| 3.3 | Authorise-then-capture confirmed with the payment provider | Founder | Not started | Sandbox test: authorise, capture less, void |
| 3.4 | NDPC registration as a data controller of major importance | Founder | Not started | Acknowledgement letter |
| 3.5 | NIMC verification provider account | Founder | Not started | Contract test: a known test NIN returns the expected name |
| 3.6 | Clinical safety lead appointed | Founder | Not started | Appointment letter |
| 3.7 | Seed data: categories, specialties, credential types, states and LGAs, holidays, facility types, rate floors | Compliance + Operations | **Scaffolded, partial** | CI migrates an empty database and asserts row counts per list |
| 3.8 | Engagement agreement template drafted | Counsel | Not started | Versioned document; the version identifier is stored, not the file name |
| 3.9 | Repository, CI pipeline and three environments | Developer | **In progress** | Pipeline run: a no-op commit reaches staging with no hands |

## What is already in the repository

* Step 3.7 — the seed structure exists with a named owner per list. **The
  geography is now complete**: all 36 states, the FCT and all 774 LGAs, with
  the counts asserted in the seed and in a unit test. The names still want
  checking against INEC or the NBS — a count proves none is missing, not that
  each is spelled as the register spells it. The holiday list stays partial
  because the moveable Islamic and Christian dates are announced yearly, and
  the rate floors wait on the 3.1 decision.
* Step 3.9 — CI runs lint, typecheck, unit tests, migrate up/down/up, seed,
  dependency audit, secret scan and end-to-end tests. Staging and production
  deployment jobs are still to be wired to the chosen host.

## Gate

* The three decisions in Section 9.4 of the specification settled in writing
* NDPC registration acknowledged and the NIMC account verifying a test NIN
* Seed data loading into an empty database by migration alone
* A commit reaching staging without anyone touching a server
