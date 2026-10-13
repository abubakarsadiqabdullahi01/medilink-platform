# Study 5 - Money: rates, billing, ledger, payouts (fact sheet)

Repo: /home/user/medilink-platform at HEAD 5c199c1. Read-only study. Date of study: 2026-10-13.

Method and honesty notes
- Everything below was read in code. Where a number is quoted it was produced by running **copies** of the real domain functions (`computeTimesheet`, `priceTimesheet`, `ledger.ts`, `exclusiveBands` copied verbatim from invoice.ts:113-123) from the scratchpad folder `.../scratchpad/calc/` with Node 22. No repo file was modified, no database or app was run, no test suite was run.
- "As built" = what the code does at HEAD. "Gap" = a difference from what the code's own comments, docs, or the v2.9 spec promise.
- Citations are `path:line` relative to the repo root.
- Money columns are kobo (N1 = 100 kobo). Shorthand: N5,000/h = 500,000 kobo/h.

---

## 1. Purpose and real-world need served

As built, the money slice turns **approved shift hours into three things**: (a) a bill to the facility, (b) an amount owed to the practitioner, (c) a record of Medilink's cut. It exists because the platform's stated pains are "delayed or disputed payment for locum work" and "after-the-fact pay disputes" (v2.9 lines 43, 47): the facility's extra pay for nights/holidays/overtime is agreed up-front in a rate card, hours come from an approved timesheet, and every movement is a balanced ledger row.

Pieces:
- **Rate floors** (src/modules/service-requests/domain/rate-floor.ts) stop a shift being published below a minimum hourly rate for category/specialty/day-or-night (prevents "race to the bottom").
- **Rate card** (src/modules/rates-contracts) lets a facility pay premiums above the request's hourly rate: night, public holiday, overtime, on-call.
- **Invoice** (src/modules/billing-settlement/application/invoice.ts) is raised by a Medilink officer, per facility per period, one line per approved shift.
- **Double-entry ledger** (billing-settlement/domain/ledger.ts) records facility obligation, practitioner earnings, platform revenue and cash.
- **Payout** (billing-settlement/application/payout.ts) is a two-step prepare/release to a gateway adapter that is a console stub.
- **Screens**: practitioner earnings, facility invoices and rates, admin finance/invoices/payouts.

What it is **not** (as built): not an authorise-then-capture flow, not a bank-account/payout-destination system, not a tax-aware invoicing system. The pilot reality it supports is: operator raises invoice, facility pays by bank transfer outside the system, operator clicks "Record payment", operator clicks prepare/release (docs/interfaces.md:130-133; src/app/api/v1/invoices/[id]/pay/route.ts:5-12).

---

## 2. Actors, roles, permissions, scopes

Permission keys (src/lib/authz/permissions.ts): `facility.read` (:20), `facility.write` (:21), `invoice.read` (:37), `payout.manage` (:38 "Initiate or release a payout"), `payout.account.change` (:39), `timesheet.approve` (:36), `config.manage` (:47).

Enforcement path: `handleGuardedRequest` (src/lib/http/guarded-handler.ts:85-112): session -> input parse -> **step-up check (only for permissions in STEP_UP_PERMISSIONS)** -> `requirePermission(permission, scope)` -> action. Scope matching: src/lib/authz/guard.ts:45-71 (a PLATFORM grant satisfies any scope; a request for `{type:'PLATFORM'}` is satisfied only by a PLATFORM grant).

| Act | Route | Permission @ scope | Roles that hold it (permissions.ts) | Step-up |
|---|---|---|---|---|
| Set / supersede a facility rate card | POST /api/v1/rate-cards (src/app/api/v1/rate-cards/route.ts:15-24) | `facility.write` @ FACILITY(facilityId) | facility_administrator (:142), facility_owner (:199), administrator (:176) and super_administrator at PLATFORM | none |
| Read rate cards | GET /api/v1/rate-cards (:27-35) | `facility.read` @ FACILITY | same set. **Not practitioners** (PRACTITIONER bundle :116-122 has no `facility.read`) despite the comment at rates-contracts/permissions.ts:7-11 | none |
| Raise a draft invoice | POST /api/v1/invoices (src/app/api/v1/invoices/route.ts:16-25) | `payout.manage` @ PLATFORM | administrator (:179), super_administrator (:219) | none |
| Issue invoice | POST /invoices/:id/issue (…/issue/route.ts:6-20) | `payout.manage` @ PLATFORM | same | none |
| Mark invoice paid ("Record payment") | POST /invoices/:id/pay (…/pay/route.ts:13-27) | `payout.manage` @ PLATFORM | same | none |
| Prepare payout | POST /api/v1/payouts (src/app/api/v1/payouts/route.ts:19-28) | `payout.manage` @ PLATFORM | same | none |
| Release payout | POST /payouts/:id/release (…/release/route.ts:13-27) | `payout.manage` @ PLATFORM | same | none |
| Read a facility's invoices (+ totals) | GET /api/v1/invoices?facilityId (invoices/route.ts:28-41) | `invoice.read` @ FACILITY | facility_administrator (:145), facility_owner, administrator, super | none |
| Practitioner: own payouts + amount owed | GET /api/v1/payouts?scopeType=SELF (payouts/route.ts:31-52) | `invoice.read` @ SELF | practitioner (:120) | none |
| Officer: someone's payouts | same route with scopeType=PLATFORM | `invoice.read` @ PLATFORM | administrator, super | none |
| Finance dashboard / all invoices | GET /dashboard/finance, GET /finance/invoices | `invoice.read` @ PLATFORM | administrator, super | none |
| Approve the timesheet that feeds billing | POST /assignments/:id/timesheet/review (src/modules/timesheets/routes.ts:27-29) | `timesheet.approve` @ FACILITY | facility_administrator, facility_owner | none |

Step-up: the whole policy is `STEP_UP_PERMISSIONS = {payout.account.change, role.grant}` (permissions.ts:77-83). **No billing/payout permission needs step-up.** `payout.account.change` has no route (docs/stage-4-8-step-up.md:22-24). src/modules/auth/domain/session.ts:11-15 says step-up is meant for "changing a payout bank account, approving a timesheet, releasing a payout" - only the first is declared and it has no route. Step-up window is 300 s (session.ts:15). A unit test caps the set at 4 (src/lib/authz/step-up.test.ts:44-49).

Role consolidation consequence: operations, compliance and finance were merged into one `administrator` role (permissions.ts:97-113, :172-183, RETIRED_ROLES :230-236). The same account that verifies facilities and reviews credentials can raise, issue, mark paid, prepare and release.

Separation of duties: none. Same `payout.manage` grant performs all five money acts; `Payout` has no `preparedBy` column (schema:1939-1964; only `releasedBy`), so even a maker-checker rule could not be checked from the row. The integration test uses one `financeId` for all steps (tests/integration/billing.test.ts:127-133, 202).

Facility roles and `payout.manage`: facility_administrator (permissions.ts:145) and facility_owner (:199 spreads it) hold `payout.manage`; it is the legacy of the retired `facility_finance_officer` (roles.test.ts:180-181). It is **inert today** because every billing route requests `{type:'PLATFORM'}` (billing-settlement/routes.ts:13-27) and a FACILITY-scoped grant cannot satisfy that (guard.ts:51-71). The grant route also confines a facility owner to granting at their own facility (src/app/api/v1/grants/route.ts:17-36) while the escalation check compares permission keys only (grants.ts:140-146).

---

## 3. Entities and state machines

### 3.1 Tables (prisma/schema.prisma)

| Model | Lines | Notes |
|---|---|---|
| `config.rate_floors` RateFloor | 421-435 | category_key, specialty_key ('*' = any), shift_type ('day'/'night'), min_hourly_kobo INT, currency, effective_from, owner. Unique on the four keys. |
| `rates.rate_cards` RateCard | 1793-1818 | 4 multipliers in bp (default 10000), status DRAFT/ACTIVE/SUPERSEDED, effective_from/until, created_by. Index only; **no unique "one ACTIVE per facility"**. FK to facility ON DELETE CASCADE. |
| `billing.invoices` Invoice | 1833-1863 | number UNIQUE, period_start/end, gross_kobo INT, platform_fee_kobo INT default 0, currency, status DRAFT/ISSUED/PAID/VOID, issued_at, paid_at. |
| `billing.invoice_lines` InvoiceLine | 1878-1906 | assignment_id UNIQUE (one line per shift), rate_card_id (no FK), practitioner_id (no FK), hourly_rate_kobo, 5 minute columns, base/premium/amount kobo. |
| `billing.ledger_entries` LedgerEntry | 1912-1935 | transaction_id, `account` free-text String, amount_kobo signed INT, currency, subject_id, memo, invoice_id/payout_id (no FKs). No actor, no correlation id. |
| `billing.payouts` Payout | 1939-1964 | amount_kobo INT, status PREPARED/RELEASED/SETTLED/FAILED, provider_reference, failure_reason, released_by/at, settled_at. No destination account, no preparedBy, no idempotency key. |
| (not present) | - | No Payment model, no ledger-accounts table, no bank-account model, no refund/reconciliation/tax tables. "Payment" is only the ledger rows + `Invoice.status=PAID` + `paid_at`. |

DB-level protection: baseline migration (prisma/migrations/20261007000000_baseline/migration.sql:1457-1584) has no CHECK constraints, no triggers, no REVOKE. "Append-only ledger" is a convention (src/lib/audit-coverage.ts:108), not a DB rule.

Money columns: every kobo column is `Int` (4-byte): RateFloor.minHourlyKobo, ServiceRequest.hourlyRateKobo (:937), Timesheet.hourlyRateKobo/amountKobo (:1315-1316), Invoice.grossKobo/platformFeeKobo, InvoiceLine.*Kobo, LedgerEntry.amountKobo, Payout.amountKobo.

### 3.2 Rate card: DRAFT -> ACTIVE -> SUPERSEDED
- Create: `createRateCard` (rates-contracts/application/rate-card.ts:82-126). Validates all four multipliers (:90-93), then in one transaction `updateMany` ACTIVE -> SUPERSEDED with `effectiveUntil = new.effectiveFrom` (:98-101) and creates the new card **directly as ACTIVE** (:103-112). Audit `rate_card.created` (:114-122). No event.
- `DRAFT` is never written by any code. No delete, deactivate, or revert path (to go back to par you create a card with all 10000).
- Lookup: `activeRateCard` = latest-`effectiveFrom` row with status ACTIVE (:134-140). It ignores dates entirely.
- `effectiveFrom` may be set by the caller (schemas.ts:19); a future date still makes the card ACTIVE immediately and the old card SUPERSEDED with `effectiveUntil` in the future; a backdated card yields `effectiveUntil` earlier than the old card's `effectiveFrom`.
- Nothing guards two concurrent creates both ending ACTIVE (no unique index, no row lock).

### 3.3 Invoice: DRAFT -> ISSUED -> PAID (VOID declared, unreachable)
| Transition | Code | Guard | Side effects |
|---|---|---|---|
| (new) DRAFT | `generateInvoice` invoice.ts:140-255 | only APPROVED attendance with a timesheet, not already on a line (:141-164); `assignment_id` UNIQUE backstop (:136-139) | invoice + lines; **one balanced ledger transaction per line** (:222-234); audit `invoice.created`; event `invoice.created` |
| DRAFT -> ISSUED | `issueInvoice` :258-291 | status read (:264) then compare-and-set `updateMany where status=DRAFT` (:267-271) | audit `invoice.issued`; **no ledger, no event, no notification** |
| ISSUED -> PAID | `recordPayment` :301-350 | status read (:307), CAS `where status=ISSUED` (:310-314) | ledger `CASH +gross / FACILITY_PAYABLE -gross` (:316-320); audit `invoice.paid`; event `payment.completed` (:337-346) |
| * -> VOID | none | enum value exists (schema:1870) | **No code path anywhere sets VOID** (grep). No credit note, no draft cancel. A draft is irrevocable: its lines pin the shifts (unique assignment) and the ledger has already credited the practitioner. |

Amount paid is always `existing.grossKobo` (:318); no partial payments, no reference/date/payer fields; `paidAt = new Date()` (:312). No due date, no overdue state.

### 3.4 Payout: PREPARED -> RELEASED -> SETTLED | FAILED
| Transition | Code | Guard | Ledger |
|---|---|---|---|
| (new) PREPARED | `preparePayout` payout.ts:74-107 | owed = -(sum of PRACTITIONER_EARNINGS) (:55-65, :78); minus sum of PREPARED+RELEASED payouts (:83-88); both read **outside** the transaction, no lock/unique index | none ("Preparing moves no money and writes no ledger entry" :67-72); audit `payout.prepared` (scope SELF) |
| PREPARED -> RELEASED | `releasePayout` :117-133 | read status (:121-125), CAS `updateMany where status=PREPARED` (:129-133), **committed before the gateway call** | none |
| RELEASED -> SETTLED | :167-219 | only if `result.settled` | `PRACTITIONER_EARNINGS +amount / CASH -amount` in the same transaction as the status update (:177-193); event `payout.settled` (:205-216) |
| RELEASED -> RELEASED (stays) | :171 | gateway returned `settled:false` | none. **No webhook/poller exists to complete it** (grep: no webhook route; PAYSTACK_WEBHOOK_SECRET declared env.ts:46 and never read) |
| RELEASED -> FAILED | :142-159 | **any** exception from `sendPayout` | none; `tx.payout.update` without CAS (:145-148); audit `payout.failed`; rethrown as 503 if `PaymentGatewayUnavailable` (:161-164) |
| PREPARED -> cancelled | none | no CANCELLED state (schema:1966-1973) | a wrong PREPARED payout can only be released |
| FAILED -> retry | none | FAILED is terminal; a new payout must be prepared | FAILED is excluded from "in flight" (:83-86) |

Crash windows (code reading): process dying after the RELEASED claim (:129-133) and before the final transaction (:167) leaves a payout RELEASED forever with no ledger row; a DB error in the final transaction after a *real* gateway success would leave the same.

---

## 4. The money flow step by step, as built (with worked numbers)

### 4.1 Steps
1. Facility publishes a request with `hourlyRateKobo` (one rate for everyone on the request; no edit route exists - src/modules/service-requests/routes.ts has only create/get/publish/cancel). Floor checked at create and publish (request.ts:153-164, :221-243).
2. Practitioner accepted/confirmed; works; attendance recorded. Timesheet computed by `computeTimesheet` (src/modules/timesheets/domain/hours.ts:129-206) and saved by `computeAndSaveTimesheet` (timesheets/application/timesheet.ts:92-159). **Stored fields** (timesheet.ts:134-144): worked, break, billable, night (overlapping, includes holiday-night), holiday (all holiday minutes), overtime, onCall, hourlyRate (copied from the request at compute time :122, :142), `amountKobo = round(billable x rate / 60)` = **base rate only, no premiums** (hours.ts:193). The correct mutually-exclusive split `totals.exclusive` (hours.ts:183-189) is computed and **discarded - not persisted**.
3. Practitioner submits; facility approves (`timesheet.approve`); approval sets assignment COMPLETED (timesheet.ts:245-316).
4. A Medilink officer raises a draft invoice for facility + period (`generateInvoice`). It reads attendance/assignment/timesheet tables directly (invoice.ts:141-150), filters by the assignment's **scheduled** `startsAt` in [periodStart, periodEnd) (:144-146), picks the facility's ACTIVE rate card **as of now** (:166-167), prices each shift (:169-194), sums gross (:196), computes the fee from `PLATFORM_FEE_BP` on the *total* (:197), builds `INV-<year>-<Date.now() base36>` (:198) and, in one transaction, writes invoice + lines + one ledger transaction per line, audit and event (:200-251).
5. Officer issues (no ledger). Facility pays by bank transfer outside the system. Officer clicks "Record payment".
6. Officer prepares a payout for a practitioner (everything owed), then releases it; the stub "settles" instantly.

### 4.2 Worked example A - 12-hour night shift with a break (no holiday)
Inputs: check-in 2026-09-09 19:00 WAT (18:00Z), check-out 2026-09-10 07:00 WAT, scheduled the same, break 60 min, hourly rate N5,000 = 500,000 kobo. Hypothetical facility card: night 15,000 bp (1.5x), all other bands par. Hypothetical `PLATFORM_FEE_BP=1000` (10%).

Timesheet (hours.ts):
- minutes walked: 720 total; night window 20:00-06:00 WAT = 600; holiday 0.
- billable = 720 - 60 = 660; scale = 660/720 = 0.91667 (break deducted proportionally, hours.ts:161)
- stored night = round(600 x 0.91667) = **550**; ordinary = 110; overtime 0 (billable 660 < scheduled 720)
- `Timesheet.amountKobo` = round(660 x 500,000 / 60) = **5,500,000 (N55,000)**

Invoice line (invoice.ts:169-194, pricing.ts:98-139, `lineAmountKobo` pricing.ts:76-82 = round(min x rate x bp / (60 x 10,000))):
- ORDINARY 110 min x 1.0 = 916,666.67 -> **916,667**
- NIGHT 550 min x 1.5 = **6,875,000**
- line `amountKobo` = **7,791,667 (N77,916.67)**; `baseKobo` = round(660 x 500,000/60) = 5,500,000; `premiumKobo` = 2,291,667 (all NIGHT premium; note 916,667 + 4,583,333 at par = 5,500,000 so no rounding drift here)
- invoice `grossKobo` = 7,791,667 (one line)

Platform fee (ledger.ts:192-197, invoice.ts:197): floor(7,791,667 x 1000 / 10,000) = **779,166** (N7,791.66). `Invoice.platformFeeKobo` = 779,166. Per-line share = floor(779,166 x 7,791,667 / 7,791,667) = 779,166 (invoice.ts:223).

Ledger (signed integer, positive = debit/"increases what the account holds", negative = credit; ledger.ts:35-49). All entries of a step share one `transactionId` and must sum to 0 (`assertBalanced` ledger.ts:68-89):

| Step | Account | Subject | Amount (kobo) |
|---|---|---|---|
| Invoice DRAFT created (`entriesForApprovedWork` ledger.ts:109-148, posted invoice.ts:222-234) | FACILITY_PAYABLE | facility | **+7,791,667** |
| | PRACTITIONER_EARNINGS | practitioner | **-7,012,501** (= gross - fee) |
| | PLATFORM_REVENUE | (null) | **-779,166** |
| Invoice ISSUED | - | - | no rows |
| Invoice PAID (`entriesForPayment` :151-166) | CASH | (null) | +7,791,667 |
| | FACILITY_PAYABLE | facility | -7,791,667 (full gross) |
| Payout PREPARED | - | - | no rows (owed = 7,012,501 from the ledger) |
| Payout RELEASED+settled (`entriesForPayout` :169-184, posted payout.ts:177-193) | PRACTITIONER_EARNINGS | practitioner | +7,012,501 |
| | CASH | (null) | -7,012,501 |

End balances: FACILITY_PAYABLE 0, PRACTITIONER_EARNINGS 0, PLATFORM_REVENUE -779,166 (credit = revenue), CASH +779,166 (the fee is the cash still held; matches ledger.test.ts:135-152).
Practitioner receives **7,012,501 (N70,125.01)**; facility pays **7,791,667**; Medilink keeps 779,166.

**Today's real default** (no `PLATFORM_FEE_BP`, no rate card): line = 5,500,000 (equals the timesheet amount); fee 0; the ledger writes **no PLATFORM_REVENUE row** (ledger.ts:137-144); practitioner is credited 5,500,000 at draft and paid 5,500,000.

Overtime variant (check-out 09:00, scheduled 07:00, break 60, card overtime 1.5x): billable 780, overtime 60 -> OVERTIME band charges only the extra 0.5x: 60 x 500,000 x 5,000 / (60 x 10,000) = 250,000 on top of ordinary 1,858,333 + night 6,962,500 = 9,070,833 (pricing.ts:125-126).

### 4.3 Worked example B - the overlap bug on a seeded holiday (see 9.1)
Shift 2026-12-24 19:00 -> 2026-12-25 07:00 WAT (Christmas Day is seeded, prisma/seed.ts:259), no break, same card plus holiday 2.0x:
- Timesheet stores billable 720, night 600, holiday 420 (00:00-07:00 on the 25th), `amountKobo` 6,000,000.
- Correct exclusive bands (computed in hours.ts but not stored): ordinary 60, night 240, holiday 420 -> 500,000 + 3,000,000 + 7,000,000 = **10,500,000**.
- What billing prices (invoice.ts:113-123): ordinary max(0, 720-600-420)=0; night 600-420=180; holiday 420 -> 600 minutes -> 2,250,000 + 7,000,000 = **9,250,000**; `baseKobo` 5,000,000 (vs 6,000,000 on the timesheet).
- **Under-billed by 1,250,000 kobo (N12,500) and 120 minutes**; the practitioner's credit shrinks by the same (less fee).

### 4.4 WHO bears the platform fee today, and WHEN revenue is recognised
- **Bearer: the practitioner.** The facility is invoiced the priced gross only; the fee is not added to the facility's invoice (invoice.ts:196-213; `entriesForPayment` clears exactly `grossKobo`, invoice.ts:318). The practitioner's ledger credit is `gross - fee` (ledger.ts:127-133). The code says so: "this takes it from the practitioner's side because that is the arrangement the specification describes" (ledger.ts:104-108). Practitioner-facing screens never show a fee or gross (src/app/practitioner/earnings/page.tsx shows only owed / in-flight / paid payouts).
- **Recognised: at invoice draft creation**, in the same transaction that creates the invoice: PLATFORM_REVENUE is credited (invoice.ts:222-234) and `Invoice.platformFeeKobo` is stamped (:208), regardless of whether the invoice is ever issued or paid. Nothing reverses it (no VOID path). The admin "Platform fees" tile sums `platform_fee_kobo` over **every** invoice status (finance-summary.ts:35).
- **Practitioner earnings are also recognised at draft** (see 9.2).
- Fee rate source: only `process.env.PLATFORM_FEE_BP` (invoice.ts:43-46). Details in section 4.5.

### 4.5 `PLATFORM_FEE_BP`
- Single use: `platformFeeBp()` invoice.ts:43-46: `Number(process.env.PLATFORM_FEE_BP)`; accepted only if a non-negative integer, else `PLATFORM_FEE_UNSET_BP = 0` (ledger.ts:192). Read on every `generateInvoice` call.
- **Not** in the zod env schema (src/lib/env.ts:9-62) and **not** in `.env.example` (payments block lines 35-38 lists only PAYMENT_PROVIDER, PAYSTACK_*). So it is not validated at boot and not discoverable from the example file.
- Invalid values (typo, "10%", negative, decimal) silently mean 0% with no log.
- No upper bound: 10000 = practitioners credited 0; above 10000 makes `entriesForApprovedWork` throw `fee_exceeds_gross` (ledger.ts:113-118) inside the transaction, so every invoice raise fails and rolls back.
- Fee is computed on the invoice total with `floor`, then apportioned per line with `floor` (invoice.ts:197, :223); the remainder stays with practitioners. Therefore `Invoice.platformFeeKobo` can **exceed** the sum of PLATFORM_REVENUE ledger rows. Example: lines 333/333/334 at 10% -> invoice fee 100 but ledger shares 33+33+33 = 99.
- No dated policy, no per-line applied rate, no waiver/scope; demo seed never sets it (scripts/seed-demo.ts has no fee).

---

## 5. Rate floors, multipliers, what is seeded

### 5.1 Floor resolution (src/modules/service-requests/domain/rate-floor.ts:42-67), most-specific-first
Candidates must match: category key, shift type (enum upper -> column lower, :47), `effectiveFrom <= shift start` (:53 - the **shift's** start, not now), and specialty either `'*'` or equal to the request's specialty (:54-55). Among candidates: (1) a specialty-specific floor beats `'*'` even if the category one is newer (:64); (2) otherwise latest `effectiveFrom` wins (:65). No candidates -> `null`.
`checkAgainstFloor` (:78-84): `null` floor -> `{ok:true, minHourlyKobo:null}`; otherwise `rate >= floor` (at the floor is fine).
Callers: `floorFor` (request.ts:84-109) loads all floors of the category and resolves in JS; applied at create (:153-164) and publish (:221-243, via `publishBlockers`). Not re-checked at invite/confirm/invoice. Shift type is hand-picked (DAY/NIGHT), not derived from the times.
Dimensions that do **not** exist: engagement type, level, region/state, facility type, urgency.

### 5.2 The four multipliers (pricing.ts, basis points, 10000 = 1.0x)
| Band | Field | Default | Bounds | How priced |
|---|---|---|---|---|
| Night (20:00-06:00 WAT, hours.ts:27-28) | nightMultiplierBp | 10000 | 10000-50000 (pricing.ts:22-23; schema presentation/schemas.ts:10; validated again rate-card.ts:90-93) | night minutes x rate x mult |
| Public holiday | holidayMultiplierBp | 10000 | same | holiday minutes x rate x mult; **replaces** night (no compounding, pricing.ts:84-92) |
| Overtime (billable beyond scheduled length, hours.ts:168-172) | overtimeMultiplierBp | 10000 | same | **adds** only the extra over par on top of the band rate: `max(0, bp - 10000)` (pricing.ts:125-126); at default the OVERTIME line is 0 |
| On-call (minutes asserted by facility via timesheet correction; correctTimesheetSchema onCallMinutes max 1440) | onCallMultiplierBp | **10000** | **10000-50000** | added whole, not in billable minutes (pricing.ts:128-130); at default on-call minutes are billed at the **full** hourly rate |
No card at all = `DEFAULT_RATE_CARD` (all 10000) (pricing.ts:34-39; invoice.ts:166-167). There is no weekend band anywhere in code (schema comment :1295 mentions "weekend" but the bands are night/holiday/overtime/on-call).

### 5.3 What is seeded (prisma/seed.ts)
- Rate floors (:273-299), comment ":274 Placeholder floors pending the signed revenue decision (step 3.1)", effective 2026-01-01:
  - doctor `*` day 500,000 (N5,000/h); doctor `*` night 650,000 (N6,500/h)
  - nurse `*` day 250,000 (N2,500/h); nurse `*` night 325,000 (N3,250/h)
  - **no floors for pharmacist, lab_scientist, radiographer** (categories seeded :36-42), no specialty-specific floors.
  - The seed `upsert` **overwrites** `minHourlyKobo` for the same key on every run (:295), and the seed runs on every deploy (seed.ts header :5). No admin route edits floors (`config.manage` is described as "rate floors", permissions.ts:47, but its only routes are agreements - src/modules/audit-compliance/routes.ts:25-27).
- Public holidays (:253-271): six fixed 2026 dates only (1 Jan, 1 May, 12 Jun, 1 Oct, 25 Dec, 26 Dec). No moveable holidays, no 2027, no state holidays. No code writes `public_holidays` other than the seed (only reader: timesheets/application/timesheet.ts:64). After 2026-12-26 the holiday band is silently empty.
- Platform fee: nothing seeded (env only).
- Rate cards: none seeded in production seed; scripts/seed-demo.ts:1985-2005 creates demo cards (and its comment claims June vs September invoices are priced on different cards - they are not, because `activeRateCard` ignores dates and all demo invoices are generated now with the then-ACTIVE card).
- Demo comment at scripts/seed-demo.ts:1991-1992 itself records the on-call < 1.0 limitation.

---

## 6. The gateway (src/modules/billing-settlement/infrastructure/gateway.ts)

What the adapter does:
- One function `sendPayout({payoutId, practitionerId, amountKobo})` -> `{reference, settled}` (:18-28, :54-68). There is **no destination** in the request (no bank account), no idempotency key, no timeout/abort, no status query, no authorise/capture/void/refund, no webhook handler.
- `PAYMENT_PROVIDER` enum: `console | paystack | remita | none` (env.ts:44), default `none`.
- `console`: allowed only when `APP_ENV==='local'`, else throws `PaymentGatewayUnavailable` (gateway.ts:57-64). It logs `[payments] STUB - no money moved` and returns `reference "stub-<first 8 of payoutId>"`, `settled:true` (:45-52). So locally a release "settles" instantly and writes the ledger row.
- `paystack`, `remita`, `none`: all fall through to `throw new PaymentGatewayUnavailable(provider)` (:67). PAYSTACK_SECRET_KEY / PAYSTACK_WEBHOOK_SECRET are declared (env.ts:45-46) and used nowhere.

What blocks production boot: only `PAYMENT_PROVIDER=console` outside local (src/lib/env-rules.ts:63-67, unit test env-rules.test.ts:38); also boot refuses `SMS_PROVIDER=console`, published secrets, non-https APP_URL (:53-77). **`PAYMENT_PROVIDER=none/paystack/remita` boots fine** and then every release returns 503 `payment_gateway_unavailable` and leaves the payout FAILED (payout.ts:142-164). `PLATFORM_FEE_BP` has no boot rule.

Call-site semantics (payout.ts): any thrown error -> FAILED, "ledger untouched" (:142-159); the admin screen then tells the officer "Nothing moved and the ledger was not touched" for every failure (src/app/admin/payouts/page.tsx:233-246), which would be false for a timeout after the provider accepted.

---

## 7. Events emitted and handlers

Event names: src/lib/events.ts:5-26. Published via the transactional outbox (src/lib/outbox.ts:21-30; `idempotencyKey` and `correlationId` fields exist but billing passes neither).

| Event | Emitted at | Payload | Handler |
|---|---|---|---|
| `invoice.created` | generateInvoice, at **DRAFT** (invoice.ts:246-251) | invoiceId, facilityId, grossKobo | none |
| `payment.completed` | recordPayment (invoice.ts:337-346) | invoiceId, facilityId, amountKobo | none |
| `payout.settled` | releasePayout only when settled (payout.ts:205-216) | payoutId, userId, amountKobo | none |
| (upstream) `timesheet.submitted`, `timesheet.approved` | timesheet.ts:217-226, :285-295 | ids, amountKobo | none |
| (upstream) `shift.completed` | attendance | assignmentId | **has** handler: computeAndSaveTimesheet (src/worker/handlers.ts:38-40) |

Registered handlers in total: `assignment.confirmed`, `shift.completed`, `practitioner.registered` (handlers.ts:15-52). Unhandled events are logged and marked PROCESSED (src/worker/processor.ts:75-82). **No event for**: invoice issued, rate card created (audit only), payout prepared/released/failed. **No scheduled money job** (src/worker/jobs.ts:31-68 lists six sweeps, none financial). Audit actions written: `rate_card.created`, `invoice.created`, `invoice.issued`, `invoice.paid`, `payout.prepared`, `payout.released`, `payout.settled`, `payout.failed`; LedgerEntry and InvoiceLine are exempt from audit by design (audit-coverage.ts:104, :108).

---

## 8. Tests present

Unit (vitest, no DB):
- src/modules/rates-contracts/domain/pricing.test.ts - 16 cases: default card changes nothing, night premium, no night x holiday compounding, overtime extra only, on-call whole, integer kobo, total = sum of lines, `multiplierProblems`. One test feeds the **real** `computeTimesheet().exclusive` into pricing (:141-165) - it does not exercise invoice.ts `exclusiveBands`.
- src/modules/billing-settlement/domain/ledger.test.ts - 14 cases: balance invariant, fractional kobo refused, fee > gross refused, full cycle nets to zero, fee floor rounding.
- src/modules/service-requests/domain/request.test.ts - 22 cases incl. `resolveRateFloor` (specificity, date, null) and `checkAgainstFloor` ("accepts anything when no floor is published" :116-118).
- src/modules/timesheets/domain/hours.test.ts - 21 (bands, break, overtime, holiday/night overlap kept overlapping :155).
- src/lib/env-rules.test.ts (console payment refused), src/lib/authz/step-up.test.ts, roles.test.ts.
Integration (real Postgres):
- tests/integration/billing.test.ts - 20 cases: invoice from approved work, no double billing, night premium (works around the bug by hand-writing `nightMinutes` on the timesheet, :281-291), card supersession, below-par refused, ledger sums to zero, prepare/release/stub, "will not prepare a second payout" (:431-439, built from a DRAFT invoice only), release twice refused, PLATFORM vs SELF read, owed shown at draft (:488-520), draft cannot be paid.
- tests/integration/invoice-paging.test.ts (4), tests/integration/dashboard-summary.test.ts (finance endpoints :251-277), tests/integration/service-requests.test.ts (floor at/below, re-check at publish :202-260; the fixture deletes seeded floors, :177-179).
E2E: tests/e2e/money.spec.ts (5 serial steps: raise+issue, facility sees owed, record payment, nurse sees owed, finance pays).
**Not tested**: holiday+night invoice pricing through `generateInvoice`; concurrent prepare; gateway failure/timeout paths; `PLATFORM_FEE_BP` > 0 through the application layer (only the pure `entriesForApprovedWork`/`platformFeeKobo`); fee remainder vs ledger; rate-card dates; step-up or separation of duties on money routes; int4 overflow; any pharmacist/lab/radiographer floor.

---

## 9. Verification of each claim at HEAD

### 9.1 Billing drops minutes when holiday and night overlap - CONFIRMED
- Timesheet persists overlapping `nightMinutes` (all night incl. holiday-night) and `holidayMinutes` (all holiday), not the exclusive split (timesheet.ts:134-144; exclusive computed hours.ts:183-189, discarded).
- invoice.ts:119-121 recomputes ordinary = billable - night - holiday and night = night - **holiday** (not night - overlap) - subtracting holiday *daytime* minutes from night, and the overlap twice from ordinary. The comment above it (:108-112) says it "subtracts the overlap".
- Algebra: bands sum to B-H (unclamped) and is always <= B (case analysis, each clamp case <= B), so it only ever **under-bills**.
- Numbers (rate N5,000, card night 1.5x / holiday 2.0x): Dec-24-19:00 -> Dec-25-07:00: correct 10,500,000 vs billed 9,250,000 (120 min dropped); with 60-min break: 9,625,000 vs 8,479,167; Dec-25-19:00 -> Dec-26-07:00: 10,000,000 vs 8,750,000. Not affected: a shift wholly inside or wholly outside a holiday date (8h holiday day shift: 8,000,000 both ways).
- No test covers it (the night test hand-edits the timesheet, billing.test.ts:281-291).

### 9.2 Practitioners credited at invoice draft, not on payment - CONFIRMED
invoice.ts:222-234 posts `PRACTITIONER_EARNINGS` credit in the draft-creating transaction. `amountOwed` is just that account's balance (payout.ts:55-65). The practitioner page says so (practitioner/earnings/page.tsx:87-93) and the test asserts it (billing.test.ts:365-367, :508-509). A practitioner can see "Owed to you" for a DRAFT the facility cannot yet see (facility page hides drafts, facility/invoices/page.tsx:60-62, `billedOnly`).

### 9.3 Payout does not check the invoice is paid - CONFIRMED
`preparePayout` consults only the ledger balance and in-flight payouts (payout.ts:78-88). Payout rows carry no invoice link (schema:1939-1964). The integration test prepares a payout against an invoice that is still DRAFT (billing.test.ts:431-439). CASH can go negative (platform pays before it is paid); no constraint.

### 9.4 Payout race can double-pay - CONFIRMED (prepare path; the release step itself is CAS-protected)
- Two concurrent `preparePayout` calls both read `owed=X, inFlight=0` outside any transaction/lock (payout.ts:78-88) and each create a payout of X (:91-93); there is no unique/partial index (migration.sql:1572).
- `releasePayout` never re-checks the owed balance; each settles and posts `PRACTITIONER_EARNINGS +X` (:177-193), driving the account positive (practitioner overpaid by X).
- Second mechanism: a FAILED payout is excluded from in-flight (:83-86), so after any failure (including a timeout, 9.5) a new payout for the same amount can be prepared at once.
- Same-payout double release is prevented by the CAS (:129-133; test billing.test.ts:448-460).

### 9.5 Gateway timeout recorded as failure - CONFIRMED (latent: the only live adapter is a stub)
`sendPayout` has no timeout/pending handling; any thrown error marks the payout FAILED and the ledger untouched (payout.ts:142-159). A provider that accepted the transfer but timed out would read as FAILED while money moved; a new payout can then be prepared (9.4). The UI copy asserts "Nothing moved" (admin/payouts/page.tsx:241-243). `PayoutResult.settled:false` exists (gateway.ts:24-28) but nothing completes a RELEASED payout.

### 9.6 Missing rate floor silently passes - CONFIRMED
rate-floor.ts:82 `if (!floor) return {ok:true, minHourlyKobo:null}`; request.ts:162 only throws when a floor exists; unit test "accepts anything when no floor is published" (request.test.ts:116-118). Seed has floors for doctor and nurse only (seed.ts:278-281), so pharmacist, lab_scientist, radiographer shifts publish at any positive rate.

### 9.7 On-call multiplier cannot be < 1.0 - CONFIRMED
`MIN_MULTIPLIER_BP = NO_PREMIUM_BP` for all four (pricing.ts:22), enforced in zod (rates-contracts/presentation/schemas.ts:10), in `multiplierProblems` (pricing.ts:144-150, called rate-card.ts:90-93) and in the UI (`min={1}`, rate-card-dialog.tsx:155; invalid <1, :108-111). Yet pricing.ts:29-31 documents on-call as "paid at a fraction of the rate". Test `refuses a rate cut dressed as an allowance` (pricing.test.ts:173-175). Default on-call = full rate.

### 9.8 Rate-card choice ignores dates / nothing snapshotted at booking - CONFIRMED
- `activeRateCard` = latest-effectiveFrom ACTIVE row; no date filter against shift/period (rate-card.ts:134-140). `generateInvoice` takes one card for **all** lines at invoice time (invoice.ts:166-167). A card created with a future/backdated `effectiveFrom` is still ACTIVE immediately (:95-112).
- Snapshot: `Assignment` has no rate fields (schema:1079-1115); `InvoiceLine.rateCardId` is stamped only at invoice time (invoice.ts:184). Multipliers are not snapshotted anywhere; a facility holding `facility.write` can supersede its card any time before the platform raises the invoice (lowest allowed is par), and the practitioner cannot read the card (see section 2).
- Partly mitigated for the **base rate**: `ServiceRequest.hourlyRateKobo` is immutable (no edit route) and is copied to `Timesheet.hourlyRateKobo` at compute time (timesheet.ts:122, :142), then to the invoice line (invoice.ts:185).

### 9.9 Per-band rounding gives a phantom kobo premium - CONFIRMED
Every line rounds independently (pricing.ts:76-82, :110-115) while `baseKobo` rounds the whole billable block once (:134-136), so `premiumKobo = total - base` can be non-zero at par. Computed: rate N3,333.33 (333,333 kobo), 12h night shift, par card, break 45 min -> premium **+1** (timesheet 3,749,996 vs invoice 3,749,997); break 15 -> **-1** (3,916,663 vs 3,916,662); synthetic 1 min ordinary + 1 min night at 100,000 kobo/h -> +1. Negative premiums are hidden in the UI (`premiumKobo > 0 ? ... : '-'`, facility/invoices/page.tsx:178-180). The facility therefore approves one figure and is invoiced a figure that can differ by a kobo or two even with no card.

### 9.10 No ceiling on hourly rate - CONFIRMED
service-requests/presentation/schemas.ts:29 `z.coerce.number().int().positive()`; no max; no relation to the floor. Practical ceiling is Postgres INTEGER (N21,474,836.47 per hour, see 9.17). New-shift dialog pre-fills N5,000 for every profession (src/app/facility/shifts/new-shift-dialog.tsx:55).

### 9.11 Invoice numbers timestamp-based, not gapless - CONFIRMED
invoice.ts:198 `INV-${year}-${Date.now().toString(36).toUpperCase()}`, generated outside the transaction; not sequential, not per-facility, two raises in the same millisecond collide on the UNIQUE index (schema:1836). Nothing numbers credit notes (none exist).

### 9.12 No VAT / WHT / TIN - CONFIRMED
No tax fields on Invoice, InvoiceLine, Facility, practitioner profile, or any ledger account; grep for vat/withholding/wht/tin/tax across src and schema finds only unrelated words. Gate item 3.1 requires "a hand-worked fee, tax and payout example for one shift" (docs/stage-3-gate-checklist.md:9), status Not started.

### 9.13 One non-step-up permission lets the same person raise / mark-paid / prepare / release - CONFIRMED
All five routes use `payout.manage` @ PLATFORM (billing-settlement/routes.ts:18-25); not in STEP_UP_PERMISSIONS (permissions.ts:77-83); no preparer != releaser check (payout.ts:117-133, schema has no preparedBy). Administrator holds it (:179) alongside onboarding/credential review.

### 9.14 `payout.manage` in a facility role - CONFIRMED (inert today)
permissions.ts:145 (facility_administrator) and :199 (facility_owner). Only the PLATFORM scope on every billing route prevents use (routes.ts:13-16 comment; guard.ts:51-71); `grantRole` comment :140 names this exact fear. Navigation also gates the admin money screens on `payout.manage` (src/app/admin/console-layout.tsx:90-91).

### 9.15 No bank-account model - CONFIRMED
No model, no field, no route in schema/src (grep "bank|nuban|account number" only finds comments and the redaction test). `payout.account.change` is a permission with no route (docs/stage-4-8-step-up.md:22). `PayoutRequest` has no destination (gateway.ts:18-22). v2.9 also wants bank-account reuse checks (v29.md:402).

### 9.16 Inbound payment is a bare button - CONFIRMED
`recordPayment({invoiceId, actorId})` (invoice.ts:301-304); schema `invoiceActionSchema = {id, facilityId}` (billing presentation/schemas.ts:22; `facilityId` is required but ignored by the handlers); amount forced to `grossKobo` (:318); no reference, date, payer, method, partial amount; UI warns "the ledger will say it was paid either way" (admin/invoices/page.tsx:305-312). No Payment table. Event `payment.completed` is emitted with no reference.

### 9.17 Money columns INTEGER (cap ~N21.5m) vs BIGINT - CONFIRMED
All `Int` (list in 3.1; DDL migration.sql:1457-1550 `INTEGER`). Max 2,147,483,647 kobo = **N21,474,836.47** per value; this applies per invoice gross (`Invoice.grossKobo`), per ledger row, per payout and per hourly rate. Worked example A line is 7,791,667 so ~275 such shifts reach the cap in one invoice; at N5,000 x 8h par (4,000,000) it is 536 shifts. Currency columns exist (schema:427, 938, 1317, 1845, 1919, 1944) but no code sets/validates them and `InvoiceLine` has none. Dashboards cast sums to float8 for display (finance-summary.ts:32-41).

### 9.18 Disputes don't post ledger adjustments - CONFIRMED
src/modules/disputes has no reference to ledger/invoice/payout (grep). Disputing an APPROVED shift moves attendance to DISPUTED (state-machine.ts:52, :59; docs/stage-8-disputes.md "Upholding does not rewrite the hours"); an upheld case returns it to SUBMITTED, but a shift already on an invoice line (unique assignment) can never be re-billed (invoice.ts:152-164), so nothing in the ledger changes.

### 9.19 Payouts ignore disputes - CONFIRMED
`preparePayout` has no dispute check (payout.ts:74-107); the ledger credit made at draft stays payable whatever the dispute state. No hold/disputed-amount account (ledger.ts:22-31).

### 9.20 Billing reads attendance tables directly - CONFIRMED
invoice.ts:141-150 `prisma.attendanceRecord.findMany({... include:{assignment, timesheet}})` (schemas attendance, matching, timesheets); also `prisma.user` (:430) and raw SQL joining `facilities.facilities` (finance-summary.ts:36-37, :43-44, :48). Against docs/module-map.md:35 ("a module never reads another module's tables"). (Facility dashboard SQL in audit-compliance also reads billing.invoices, facility-summary.ts:91-100.)

Summary table

| # | Claim | Verdict |
|---|---|---|
| 1 | Minutes dropped when holiday and night overlap | CONFIRMED |
| 2 | Practitioners credited at invoice draft | CONFIRMED |
| 3 | Payout doesn't check invoice paid | CONFIRMED |
| 4 | Payout race can double-pay | CONFIRMED (prepare path) |
| 5 | Gateway timeout recorded as failure | CONFIRMED (latent) |
| 6 | Missing floor silently passes | CONFIRMED |
| 7 | On-call cannot be < 1.0 | CONFIRMED |
| 8 | Rate-card choice ignores dates / no snapshot | CONFIRMED (base rate partly frozen) |
| 9 | Phantom kobo from per-band rounding | CONFIRMED (+/-1 kobo shown) |
| 10 | No ceiling on hourly rate | CONFIRMED |
| 11 | Invoice numbers timestamp-based | CONFIRMED |
| 12 | No VAT/WHT/TIN | CONFIRMED |
| 13 | One non-step-up permission for all money acts | CONFIRMED |
| 14 | payout.manage in a facility role | CONFIRMED (inert via PLATFORM scope) |
| 15 | No bank-account model | CONFIRMED |
| 16 | Inbound payment bare button | CONFIRMED |
| 17 | INTEGER money columns | CONFIRMED |
| 18 | Disputes post no ledger adjustments | CONFIRMED |
| 19 | Payouts ignore disputes | CONFIRMED |
| 20 | Billing reads attendance tables | CONFIRMED |

No claim is ALREADY FIXED or NOT FOUND.

---

## 10. Gaps the redesign doc (docs/redesign-recommendations-2026-10-13.md) did NOT mention (or only in passing)

Listed as facts with evidence; "partly covered" means the redesign names the theme but not this specific mechanism.

1. **`PLATFORM_FEE_BP` handling**: absent from env schema and `.env.example`; malformed values silently become 0%; no upper bound; >10000 makes every invoice raise fail mid-transaction (invoice.ts:43-46; env.ts; ledger.ts:113-118). Redesign only says "replace the env var".
2. **Invoice fee != ledger revenue**: per-line floor apportionment lets `Invoice.platformFeeKobo` exceed the PLATFORM_REVENUE rows (invoice.ts:197, :223); the admin "Platform fees" tile uses the invoice column (finance-summary.ts:35).
3. **Dashboards mix statuses**: finance "Platform fees" sums fee over DRAFT/VOID too (finance-summary.ts:35); monthly "invoiced" includes DRAFT/VOID (:40); facility spend chart includes DRAFT (facility-summary.ts:94) while the facility invoices page hides drafts (facility/invoices/page.tsx:60-62); the admin finance page claims figures are "summed from its entries" of the ledger (admin/finance/page.tsx:182) but they come from the invoices table; totals are limited to VERIFIED facilities (finance-summary.ts:36-37), so a later-suspended facility's debt drops out.
4. **Payout dead ends**: RELEASED with `settled:false` never completes (no webhook/poller); a PREPARED payout cannot be cancelled (no state); FAILED excluded from in-flight enables immediate re-prepare; claim-then-send commits outside the transaction (payout.ts:129-133). Redesign covers "timeout as failure" and "idempotent reference/status query" but not these states.
5. **Payout GET quirk**: `GET /api/v1/payouts?scopeType=PLATFORM` with no `scopeId` passes `undefined` to Prisma `where`, returning every payout and the platform-wide owed total, unpaginated (payouts/route.ts:41-50; schemas.ts:29-32). Officer-only, but unbounded.
6. **Admin payout screen** does not display the owed amount the API returns (page types only `{payouts}`, admin/payouts/page.tsx:64-71) and shows the practitioner's phone number (:172); invoice tables omit overtime and on-call minutes though stored (facility/invoices/page.tsx:159-166; admin/invoices/page.tsx:240-246).
7. **No weekend band** although the spec lists "weekend allowances" and a schema comment mentions weekend (schema:1295).
8. **On-call defaults to full rate and `premiumKobo` includes the entire on-call amount** because on-call is outside the billable base (pricing.ts:34-39, :128-138).
9. **Holiday data cliff**: only six 2026 fixed holidays; none for 2027; no writer other than the seed (seed.ts:253-271) - after 2026-12-26 the holiday premium silently never applies. Redesign only says the list is partial.
10. **Seed overwrites floors** on every deploy (seed.ts:295), and the permission described as editing floors (`config.manage`) has no floor route. Redesign says "nothing writes config except the seed" but not the overwrite.
11. **Ledger integrity is convention only**: `account` is a free-text column with no CHECK/enum, no FKs from entries to invoices/payouts, no actor or correlation id on entries, no DB trigger/REVOKE (migration.sql:1517-1530). Redesign names "ledger protections in the database" generally.
12. **Money events carry no idempotencyKey / correlationId** though the outbox supports both (invoice.ts:246, :337; payout.ts:206; outbox.ts:15-17). Audit rows for money pass no correlationId either (invoice.ts:236-244, payout.ts:95-104).
13. **Rate-card detail**: `DRAFT` status never used; backdated card yields an inverted effective interval; no unique "one ACTIVE card" (redesign lists the unique index only as P2); the comment that practitioners may read the card (rates-contracts/permissions.ts:7-11) contradicts the role bundle.
14. **Invoice raise mechanics**: period filter uses scheduled start not approval/worked time (invoice.ts:144-146); `periodEnd > periodStart` unchecked (billing/presentation/schemas.ts:5-9); number generated outside the transaction; a concurrent duplicate surfaces as a raw unique-violation rather than a mapped error.
15. **Premium accounting**: the facility approves a timesheet figure that is base-only (timesheet.ts:134-144; redesign mentions) and, because the platform credits the **whole** priced gross (including premiums) to the practitioner, the premium cost is borne by the facility and received by the practitioner - but practitioners cannot see the card before accepting.
16. **Module numbering drift** between code/docs (Rates = module 11, Billing = module 12, docs/module-map.md:19-20) and v2.9 (Rates = Module 10, Billing = Module 11, v29.md:524, :542).

---

## 11. Documentation drift observed (money-relevant)

- docs/interfaces.md:134-136 says the practitioner earnings and facility "what we owe" pages are missing - they now exist (src/app/practitioner/earnings/page.tsx, src/app/facility/invoices/page.tsx, src/app/facility/rates/page.tsx).
- docs/module-map.md:19 lists "Rate floors" under `rates-contracts`; floors live in `service-requests/domain/rate-floor.ts` and `config.rate_floors`.
- docs/stage-3-gate-checklist.md:9-17: 3.1 revenue model, 3.2 legal role, 3.3 authorise-then-capture, 3.4 NDPC registration, 3.8 engagement agreement all "Not started"; 3.7 seed "Scaffolded, partial" (:16, :21-27: rate floors "wait on the 3.1 decision", holidays partial). The gate's evidence for 3.1 includes a tax example (:9).
- docs/stage-7-4-7-5-7-6-timesheets.md and the Timesheet model comment (schema:1293-1296) say allowances are "module 11 ... Stage 8" and mention weekend; code has no weekend band.
- docs/stage-4-8-step-up.md:22-24 says both step-up permissions have no route when written; `role.grant` now has one (grants route), `payout.account.change` still none.

---

## 12. v2.9 spec vs code (addendum)

Source: scratchpad/v29/v29.md (read as data). Spec numbering: Module 10 = Rates/Contracts (v29.md:524-540), Module 11 = Billing/Ledger (:542-556). Labels: IMPLEMENTED / PARTLY / MISSING / DIVERGES. Evidence is code `file:line`.

### 12.1 Direct answer: does the fee mechanism match 9.4.1?
**No - it DIVERGES on every defining point.** Spec 9.4.1 (v29.md:786): percentage commission, **borne by the facility**, **deducted at settlement**, shown transparently on facility invoice **and** practitioner statement; "the practitioner's accepted rate remains the amount the practitioner receives"; ledger records gross, commission, tax, provider charges, facility debit and practitioner payout as separate entries.
Code: percentage (bp) of gross - match; but **borne by the practitioner** (ledger.ts:104-108, :127-133; facility pays gross only, invoice.ts:196-213, :318), **recognised at invoice draft** not at settlement/capture (invoice.ts:222-234, stamp :208), practitioner receives priced gross minus fee, not the accepted rate (a facility card can lift it above the accepted rate; a fee lowers it), no fee on the facility invoice (it is not charged to the facility; fee shown only on the admin invoices screen, admin/invoices/page.tsx:277-280) and nothing on a practitioner statement (practitioner/earnings/page.tsx). Tax and provider-charge entries do not exist.

### 12.2 Module 10 - Rates, contracts and engagement terms (v29.md:524-540)
- Hourly, daily, or fixed-shift rates - PARTLY: hourly only (`ServiceRequest.hourlyRateKobo` schema:937); no daily/fixed-shift unit.
- Overtime allowance - IMPLEMENTED (pricing.ts:125-126; hours.ts:168-172).
- Night allowance - IMPLEMENTED (pricing.ts:119; hours.ts:27-28, :89-92).
- Weekend allowance - MISSING (no weekend band; only public holidays; hours.ts, pricing.ts).
- (Extra, not in spec) public-holiday and on-call bands - IMPLEMENTED (pricing.ts:120, :130).
- Configurable minimum rate per professional category - IMPLEMENTED (config.rate_floors schema:421-435; rate-floor.ts:42-67).
- ...and per **engagement type** - MISSING (keys are category, specialty, day/night; rate-floor.ts:12-18).
- "A request below the floor cannot be published" - PARTLY: enforced at create+publish (request.ts:153-164, :221-243) but a missing floor passes (rate-floor.ts:82) and only doctor/nurse are seeded (seed.ts:278-281).
- Floor is a configuration record, not hard-coded - PARTLY: a table, but seed-only with no admin write path and the seed overwrites values (seed.ts:295; permissions.ts:47 vs routes).
- Floor set in consultation with professional bodies - MISSING in code (seed values are "placeholder", seed.ts:274; process item, gate 3.1/3.7 incomplete).
- Transport/accommodation allowances - MISSING (no field on request or rate card; grep).
- Cancellation penalties - MISSING (only free-text `cancellationTerms`, service-requests/presentation/schemas.ts:33; no monetary consequence in code).
- Tax and withholding configuration - MISSING (no tables/fields).
- Digital engagement agreement with versioned terms and recorded acceptance - PARTLY: generic versioned agreements + append-only acceptances with IP/user-agent exist (schema:1987-2037; kind PRACTITIONER_ENGAGEMENT :2010-2014; audit-compliance/application/consent.ts:199-203), but they are between the user and the platform, not tied to an engagement/rate/assignment, and nothing in matching, confirmation or billing requires acceptance (grep: no gate in matching/billing).
- "Both sides agree on commercial terms before a shift is accepted" - PARTLY: the request's hourly rate is fixed and visible on the offer; premiums (rate card) are not readable by practitioners and are not frozen at booking (sections 2, 9.8).
- Data model rate_cards - IMPLEMENTED (schema:1793-1818); engagement_terms, contracts - MISSING; contract_versions / contract_acceptances - PARTLY (agreement_versions / agreement_acceptances, schema:1987-2037).

### 12.3 Module 11 - Billing, payments and settlement ledger (v29.md:542-556)
- Facility funding/authorisation - MISSING (no authorise/capture/hold; invoice raised after approval, paid by manual record: invoice.ts:301-350).
- Invoice generation - IMPLEMENTED (invoice.ts:140-291; one line per shift, minute bands stored).
- Practitioner earnings calculation - IMPLEMENTED (invoice.ts:222-234) but at draft, not on funds capture (DIVERGES on timing).
- Platform fees - PARTLY: bp of gross from env (invoice.ts:43-46), practitioner-borne (DIVERGES from 9.4.1, see 12.1).
- Tax/withholding entries - MISSING (ledger.ts:22-31 has four accounts; no tax account/fields).
- Integration with a licensed Nigerian payment provider - PARTLY: adapter shape and env enum for paystack/remita (env.ts:44), but only a console stub; paystack/remita/none throw (gateway.ts:54-68).
- Bank-account verification - MISSING (no model; `payout.account.change` has no route; docs/stage-4-8-step-up.md:22).
- Practitioner payout - PARTLY: prepare/release/settle states (payout.ts:74-220) against the stub; no destination, no real provider.
- Refunds / reversals - MISSING (VOID enum unreachable, schema:1870; no reversing-entry function in ledger.ts despite audit-coverage.ts:108 promising "a reversing transaction").
- Reconciliation - MISSING (no table, job or report; only tests asserting entries sum to zero, billing.test.ts:361-403).
- Downloadable statements - MISSING (no export route or UI for invoices/earnings; v29.md:702 also lists service-fee and withholding statements).
- Ledger-based, never a self-operated wallet - PARTLY: integer-kobo double-entry ledger and prepare/release exist, but the ledger models Medilink **receiving** facility cash and paying out of it (`CASH` account, ledger.ts:29-30, :151-184) and displays a running "Owed to you" balance (practitioner/earnings/page.tsx:59-66) - closer to the model the spec rejected than to provider-held funds (see 9.4.2 below).
- Data model - PARTLY: invoices, invoice_items (invoice_lines), ledger_entries, payouts exist; billing_accounts, ledger_accounts, payment_transactions, refunds, reconciliations are MISSING (schema:1833-1973).

### 12.4 Section 8.4 - Financial model: ledger, not wallet (v29.md:248-250)
- Transaction ledger + settlement through licensed providers - PARTLY (ledger yes; providers only stubbed).
- "Financial records are never overwritten; corrections through reversal entries" - PARTLY: no update/delete in application code (audit-coverage.ts:108), but no reversal facility and no DB-level protection (migration.sql:1457-1584); invoice status and payout rows are updated in place by design; the demo script rewrites ledger timestamps (scripts/seed-demo.ts:2273-2276, :2314-2317) - script only.
- PostgreSQL transactions for consistency - IMPLEMENTED for draft/pay/settle (invoice.ts:200, :309; payout.ts:167) but the payout claim-then-send is outside a transaction (payout.ts:129-133).
- Provider adapter pattern (8.3: PaymentProvider with Paystack/Remita/Flutterwave/bank-transfer implementations) - PARTLY: a single `sendPayout` function selected by env, no interface/implementations (gateway.ts:54-68).

### 12.5 Section 9.4.1 - Revenue model (v29.md:784-788)
- Percentage commission on engagement value - IMPLEMENTED (ledger.ts:192-197).
- Borne by the facility - **DIVERGES** (practitioner-borne; ledger.ts:104-108, :127-133).
- Deducted at settlement - **DIVERGES** (booked at invoice draft; invoice.ts:222-234).
- Shown on both the facility invoice and the practitioner statement - **DIVERGES/MISSING**: facility invoice page has no fee (facility/invoices/page.tsx); practitioner has no statement (earnings/page.tsx); admin invoices shows it (admin/invoices/page.tsx:277-280).
- Practitioner's accepted rate remains what they receive - **DIVERGES** (credit = priced gross - fee; invoice.ts:196-234).
- Ledger records gross, commission, tax treatment, provider charges, facility debit, practitioner payout separately - PARTLY: gross/commission/facility debit/payout yes (ledger.ts:120-144, :155-163, :173-181); tax treatment and provider charges MISSING.
- "Schema built for this baseline" - PARTLY: `platform_fee_kobo` and PLATFORM_REVENUE exist; no applied rate per invoice/line, no payer field, no tax columns, no dated policy.
- VAT/withholding/invoice wording review - MISSING (gate 3.1 Not started, docs/stage-3-gate-checklist.md:9).

### 12.6 Section 9.4.2 - When facility funds arrive (v29.md:790-802)
- Facility authorises payment before the shift - MISSING (no authorise step anywhere).
- Provider captures on timesheet approval - MISSING (approval emits an event with no handler, timesheet.ts:285-295; billing is a manual later step).
- Medilink never holds funds - **DIVERGES**: facility pays Medilink and Medilink pays out (CASH account, ledger.ts:29-30; recordPayment invoice.ts:316-320; payout.ts:177-193; docs say manual bank transfer, invoice.ts:293-300).
- Rejected model "facility pays only after the shift... transfers credit risk to Medilink" - **DIVERGES**: this is the implemented flow, and the credit risk is Medilink's because practitioners are credited at draft and a payout does not require the invoice to be paid (9.2, 9.3).
- Practitioner payout promptly after approved settlement - **DIVERGES**: manual prepare/release, no trigger from settlement/capture, no scheduled job (payout.ts; worker/jobs.ts:31-68).
- Capture less / void (gate 3.3 sandbox test) - MISSING (gate "Not started", stage-3 checklist :11).

### 12.7 Section 9.4.3 - Legal position (v29.md:804-810)
- Introducer/platform operator, engagement agreement between facility and practitioner - PARTLY: agreement kinds PRACTITIONER_ENGAGEMENT and FACILITY_TERMS exist with the platform as counterparty (schema:2010-2014); no facility-practitioner contract object; counsel opinion "Not started" (stage-3 checklist :10).

### 12.8 Section 9.12 - API, integration and event reliability (v29.md:844-848)
- Idempotency keys for payment initiation, payout, refund, webhook - MISSING (no key on gateway request gateway.ts:18-22 or Payout; outbox `idempotencyKey` unused by billing).
- Webhook signature validation, replay protection, retry, dead-letter, reconciliation - MISSING for provider webhooks (no webhook route; secret unused env.ts:46); outbox retry/backoff/dead-letter for internal events IMPLEMENTED (processor.ts:75-121, outbox.ts:32-37).
- Provider call timeout rules - MISSING (gateway.ts:54-68, payout.ts:135-165).
- Pending-state handling - PARTLY (`settled:false` and RELEASED exist, gateway.ts:24-28; never completed).
- Outage mode - PARTLY (503 `payment_gateway_unavailable`, payout.ts:161-164, but the payout is burned to FAILED).
- Duplicate-payment prevention - PARTLY (CAS on release payout.ts:129-133; prepare race 9.4).
- Manual recovery procedures - MISSING (no repair/retry path from RELEASED/FAILED).
- Correlation identifier on every provider call, ledger entry, audit record - PARTLY: audit and outbox have the column (schema:244, :266) and the request context carries one, but billing writes pass none (invoice.ts:236-251, payout.ts:95-104) and ledger entries have no column (schema:1912-1935).
- Domain events versioned - MISSING (events.ts:5-26 plain names).
- Exactly-once business effects - PARTLY (unique `invoice_lines.assignment_id`, CAS transitions; not for webhooks/payout prepare).

### 12.9 Section 9.13 - Payment ledger and reconciliation semantics (v29.md:850-854)
- Integer minor units, never floating point - IMPLEMENTED (Int kobo, `assertBalanced` rejects fractions ledger.ts:73-80) but INT4-capped (9.17); reporting casts to float8 only for display (finance-summary.ts:32-41).
- Explicit currency codes - PARTLY: `currency` columns default "NGN" (schema:1845, :1919, :1944) never set or validated in code; none on InvoiceLine.
- Ledger accounts for facility obligations, practitioner earnings, platform revenue - IMPLEMENTED (ledger.ts:22-31).
- ...provider fees, taxes, refunds, holds, disputed amounts, failed payments, reversals, chargebacks - MISSING (only 4 accounts incl. CASH).
- Double-entry / formally balanced with clear debit-credit semantics - IMPLEMENTED in application (signed entries, `assertBalanced` ledger.ts:35-89; positive = debit); not enforced by the database.
- Who bears provider fees - MISSING (no provider fees modelled).
- Rounding rules - PARTLY: round-half-up per line (pricing.ts:76-82), floor for fee and per-line fee share, remainder to practitioner (ledger.ts:187-197; invoice.ts:215-223); not written as a rule; produces +/-1 kobo premium and fee/ledger mismatch (9.9, section 4.5).
- VAT and withholding-tax handling - MISSING.
- Revenue recognition - **DIVERGES** (at draft, 4.4).
- When practitioner earnings become payable - **DIVERGES** (at draft, regardless of payment; 9.2).
- Partial timesheet approval - MISSING (approve/reject only, timesheet.ts:232-238).
- Disputed-amount holds (also Module 13 spec v29.md:596) - MISSING (9.18, 9.19).
- Multi-tranche settlement - MISSING (single full-gross payment; single whole-balance payout).
- Refunds, statement correction - MISSING.
- Provider settlement-report reconciliation; end-of-day and month-end reconciliation - MISSING.
- Release authority - PARTLY: single `payout.manage` @ PLATFORM, no limits (permissions.ts:38; routes.ts:24-25).
- Reversal authority - MISSING (no reversals).

### 12.10 Related spec requirements touching money
- 8.8 `payment.release` as its own permission and a distinct Facility Finance Officer / Medilink Finance Officer (v29.md:182-185, :288) - DIVERGES: one coarse `payout.manage`; finance roles merged into administrator/facility_administrator (permissions.ts:97-113, :230-236).
- 9.10 separation of duties for payment release - MISSING (9.13 above).
- 9.11 step-up and stronger-than-SMS protection for finance accounts; bank-detail changes notify/cool-off/step-up - MISSING for money acts (STEP_UP_PERMISSIONS permissions.ts:77-83); bank details do not exist.
- 9.17 distinct states Settled / Captured / Paid out / Reversed - DIVERGES: invoice PAID, payout SETTLED, no Captured/Reversed (schema:1865-1873, :1966-1973).
- 11.2 seed data incl. public holidays "for the current and following year" and rate floors, with a named owner and review date, loaded by migration - PARTLY: floors/holidays seeded by script not migration (stage-3 checklist :16, :21-27), owner present, no review-date column, 2026 only (seed.ts:253-299).
- Reports: earnings statements, service-fee statements, withholding-tax records, downloadable receipts (v29.md:694, :702) - MISSING.
- First-month signal "time from timesheet approval to practitioner paid" (v29.md:958) - MISSING: no measure; practitioners are credited at draft so the interval cannot be derived from the ledger.
