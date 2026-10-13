# Part 2 — Where we stand: v2.9, the code, and v3 side by side

## 2.1 Three sources of truth, and how we reconcile them

| Source | What it is | How this document treats it |
|---|---|---|
| **System Documentation v2.9** (Sept 2026) | The specification we committed to: 36 modules in three priority bands, the safety principles, and the baseline decisions on revenue, payment timing and legal role | The **standard**. Where the code falls short of it, that is a gap; where the code does something different, that is a divergence to resolve |
| **The repository** at commit `5c199c1` | What actually exists and runs. Every module under `src/modules/`, the three consoles under `src/app/`, the shared machinery under `src/lib/` | The **truth about the present**. Where a stage document and the code disagree, the code was treated as correct and the document flagged as stale |
| **The v3 strategy** (this document, Part 6) | The expansion: professional hierarchy, a two-sided marketplace, negotiation, a success fee, licensed-provider payments, trust, privacy, later a resource exchange | The **direction**. Anything in it that is not already built is labelled NEW EXPANSION or LATER (GATED) |

The through-line of v2.9 survives intact and is the test every v3 change must pass: *every irreversible step is preceded by a check that can be evidenced afterwards.* A practitioner cannot be matched without verification; a shift cannot be paid without an approved timesheet; a sanction cannot be applied without a fault decision; a correction never overwrites what it corrected.

## 2.2 The module map: v2.9 against the repository

The repository numbers its modules slightly differently from v2.9 — it splits v2.9's Module 9 into attendance and timesheets, and it folds v2.9's Module 16 (Administration and operations) into the operations console. This document uses **the repository's numbers** in chapter headings, because that is how code, tests and stage documents refer to them, and shows the v2.9 number beside each.

| Repo # | Module (`src/modules/…`) | v2.9 # | Built? | Maturity for a Gombe pilot |
|---|---|---|---|---|
| 1 | Authentication and access (`auth`) | 1 | Built | Ready after P0 fixes |
| 2 | Practitioner profiles (`practitioners`) | 2 | Built | Ready after P0 fixes; no level/cadre |
| 3 | Credential verification (`credentials`) | 3 | Built | Doctors only fully gated |
| 4 | Facility management (`facilities`) | 4 | Built | Ready after P0 fixes |
| 5 | Availability (`availability`) | 5 | Built | Private pattern data, not an offer |
| 6 | Service requests (`service-requests`) | 6 | Built | Ready after P0 fixes; no level |
| 7 | Matching and assignment (`matching`) | 7 | Built | Not safe: privacy leak, overbooking |
| 8 | Scheduling (`scheduling`) | 8 | **Stub** | List only; schedule lives in matching |
| 9 | Attendance (`attendance`) | 9 (part) | Built | Ready after P0 fixes |
| 10 | Timesheets (`timesheets`) | 9 (part) | Built | Ready after P0 fixes |
| 11 | Rates and contracts (`rates-contracts`) | 10 | Built | Floors for two professions only |
| 12 | Billing, ledger and settlement (`billing-settlement`) | 11 | Built, gateway stubbed | **Not ready** |
| 13 | Cancellations, no-shows and sanctions (`cancellations-sanctions`) | 12 | Partly | No ladder, no appeals |
| 14 | Disputes (`disputes`) | 13 | Built | Not ready: access gaps, no money link |
| 15 | Clinical incidents (`clinical-incidents`) | 14 | Built | Not ready: subject rule, no suspension |
| 16 | Notifications (`notifications`) | 15 | Partly | SMS adapter, no live gateway |
| 17 | Audit, consent and compliance (`audit-compliance`) | 17 | Built | Erasure and agreement gate missing |
| 18 | Suggestions (`suggestions`) | 18 | Built | Loop not closed |
| — | Operations console (`/admin`) | 16 | Built | Queues work; no second approver |
| — | Reference data (`config`) | (8.6) | Built | Seed-only; no admin screen |

**v2.9 Priority 1 and 2 modules (19 to 36).** Reports and analytics (21) and low-bandwidth/PWA delivery (27) are partly present (dashboards; a responsive, installable app). Credential renewal (22) exists only as an expiry sweep. **Not started:** ratings and performance (19), rostering (20), tax and statements (23), preferred pools (24), fraud and risk (25), customer support (26), the Flutter client (28), and all of the ecosystem modules (29 to 36). Several of these become v3 pilot or Phase 2–4 work; see Part 9.

## 2.3 What is strong — do not rebuild

The review of 13 October and this study agree that these are better than most pilots and should be extended, not replaced.

- **The authorisation guard** enforces permission *and* scope on the server for every route, before any data is read; step-up (a fresh password check) is evaluated before the permission. Navigation hides what a person cannot do as a courtesy; it is never the control.
- **The audit trail** is written in the same transaction as the change, and a **coverage test fails the build** if a write to an audited table has no audit row.
- **The transactional outbox** claims events with `SKIP LOCKED`, counts the attempt before running a handler, backs off, dead-letters after eight attempts, and has a two-worker concurrency test.
- **The matching engine** is a pure function: hard exclusions (every reason collected, not just the first), then a 100-point score — proximity 35, experience 30, fatigue 20, reliability 15 — with the weights and every candidate's factors stored with the run, so "why did they rank there" can be answered later.
- **The eligibility rule** is a pure function with ten explicit hard blockers, each with a human-readable reason shown on the practitioner's own screen.
- **Attendance** has an exhaustively tested state machine (all 81 state pairs against an independent list); check-in codes are bound with a keyed hash, expire in five minutes and allow five attempts.
- **Money primitives** are sound: integer kobo, basis-point multipliers, a signed double-entry ledger that refuses an unbalanced set, compare-and-set status changes, and one invoice line per assignment enforced by a unique key.
- **Timesheet revisions** keep the whole prior state; break, night and holiday minutes are walked minute by minute.
- **Boot-time guardrails** refuse a production start with console SMS, console payments, a published secret, or a non-HTTPS address.
- **Login hygiene**: Argon2id hashing, timing equalised against unknown numbers, one-time codes stored as keyed digests, lockout and an audited attempt record.
- **Reference data**: all 36 states, the FCT and all 774 local government areas are seeded, with the counts asserted in a test.
- **Verification by evidence**: the officer reads the practitioner's photograph beside the number and confirms; the identity number is kept out of the audit trail and masked after use.
- **About 1,050 automated test cases** across unit, integration (real PostgreSQL) and browser journeys through all three consoles.

## 2.4 Where the code diverges from what v2.9 promised

These are not new ideas; they are promises already made. Each is a gap in Part 5 with an identifier.

| # | v2.9 says | The code does | v2.9 reference |
|---|---|---|---|
| 1 | The **facility** bears the commission, deducted at settlement, shown on the facility invoice and the practitioner statement; the practitioner receives the accepted rate | The **practitioner** bears the fee; it is booked when the invoice is **drafted**; neither the facility invoice nor any practitioner statement shows it | §9.4.1 |
| 2 | The facility authorises payment before the shift; a licensed provider captures on timesheet approval; **Medilink never holds funds**; payout follows promptly | No authorise or capture step exists; Medilink's ledger models receiving facility cash and paying out of it; practitioners are credited at invoice draft and a payout does not require the invoice to be paid | §9.4.2, §8.4 |
| 3 | A practitioner facing an emergency asks the **facility** to release them | A **platform officer** decides excusals | Module 12 |
| 4 | A graduated sanction ladder, compliance-officer-only authority, appeals | Fault is recorded; there is no ladder, no appeal and no compliance-officer role | Module 12 |
| 5 | Opening an incident suspends the practitioner from matching at that facility; either party may report; legal hold | Opening an incident suspends nobody; only facilities can report; no legal hold | Module 14 |
| 6 | A dispute holds **only the disputed amount**; later corrections are reversal entries; each type has a resolution target | A dispute does not touch money at all; no reversal facility; no target time | Module 13 |
| 7 | Nine roles, including separate compliance, operations and finance officers and separate facility scheduler and finance roles | Five roles; operations, compliance and finance merged into one `administrator`; one coarse `payout.manage` | §6, §8.8 |
| 8 | Modules communicate through domain events and never read each other's tables | Several modules read each other's tables directly (billing reads attendance; matching reads facilities); 17 of 20 events have no handler | §8.2 |
| 9 | A verification panel and three evidence tiers on each claim; NIN typed and verified through a provider | No facility-facing panel or tiers; NIN is free text; providers switched off by design; manual path instead | Modules 2 and 3 |
| 10 | Matching has transactional conflict detection, race handling, and PostgreSQL time-range exclusion constraints | Confirm locks the practitioner only; no request lock; no database overlap constraint | §9.16 |
| 11 | A staffed telephone and WhatsApp line is a **condition of launch**; SMS-first notifications | No support surface in the product; SMS gateways are not implemented; no message is sent for an offer | §11, Module 15 |
| 12 | Seed data before first registration: categories, floors, holidays for this and next year, one agreement template, notification templates | Floors for doctors and nurses only; six 2026 holidays only; no agreement or notification template seeded | §11.2 |
| 13 | Idempotency keys, webhook signature validation, correlation identifiers on every request, event and ledger entry | None of these exist for money; correlation identifiers are never written | §9.12 |
| 14 | Legal gate: revenue decision, legal opinion on Medilink's role, authorise-then-capture confirmed, NDPC registration, NIMC account, clinical safety lead, engagement agreement | All eight gate items are "Not started" | Stage 3 checklist |

## 2.5 What v3 adds beyond v2.9

| Topic | v2.9 | v3 |
|---|---|---|
| **Positioning** | A staffing and payment tool | A verified workforce marketplace and settlement platform whose defensible advantage is trust |
| **Professional hierarchy** | Scope of practice and supervision are required in §9.8 but have no data model | A first-class structure: profession → registration category → cadre → specialty → competencies → experience band → supervision → licence; hard eligibility rules |
| **Direction of the market** | Facility posts, practitioner applies or is invited; availability is private | Both sides can start: facility-posted shifts *and* professional-published priced availability, converging on one Booking |
| **Pricing** | A rate is accepted | Offer, bounded counter-offers and an agreed rate, each side floor-checked, with a non-binding recommended range and no open auction |
| **Revenue** | A facility-borne commission is the baseline | The same baseline, sharpened: free to join, verify and publish; a dated fee policy; 0% in the pilot; a 4–6% success fee tested; shown plainly; per-line applied rate |
| **Payments** | Authorise-then-capture through a licensed provider | The same, made specific: split settlement, delayed release, refunds, idempotent webhooks, reconciliation; and a stated pilot interim that does not hold funds |
| **Reviews** | P1 ratings with moderation | Phase 4: structured two-way reviews between parties to a completed booking, with appeal and anti-retaliation |
| **Advertising and premium** | Not specified | Gated by explicit rules: ads never alter ranking; verification, safety and ordinary work are never paid features |
| **Resource exchange** | Not in v2.9 | A separate second marketplace for clinical space and equipment, after the workforce loop works |
| **Privacy** | §9.9 and §9.14 | Adds a formal DPIA, a responsible officer, explainable matching, human review of adverse automated decisions, and separate consent for priced listings |
| **Evidence activity** | Launch operating model in §11.1 | Adds the structured Gombe usability study and a single north-star measure |
