# Medilink — redesign and growth recommendations

Date: 2026-10-13. Status: **recommendation only. No code was written or changed.**

## 0. How this was produced, and how to read it

Seven reviewers each read a group of modules in the code, as it stands today, and judged them against the
six business directions in the brief. Their reports were then checked against each other, and I
re-read eight of the most serious claims in the code myself before putting them here.

Every finding carries one of these marks:

- **[Verified]** — I re-read the code and it says what is claimed.
- **[Read]** — a reviewer read the code and reported it; I did not re-check it.
- **[Counsel]** — law, tax or regulation. A lawyer or tax adviser must confirm. I give the shape of the
  issue, not an opinion.
- **[Unverified]** — could not be confirmed from the code (prices, vendor facts, regulator rules).

Nothing was run: no tests, no app, no database. "Verified" means *read in the code*, not *observed at runtime*.

Priorities: **P0** = before the Gombe pilot, **P1** = before growth, **P2** = later. Effort: **S** days,
**M** 1–3 weeks, **L** a month or more (rough, one developer).

---

## 1. Executive summary

**Where the product stands.** The foundations are better than most pilots: a strict permission-and-scope
guard, an audit trail with a coverage test, a transactional outbox, integer-kobo money with a balanced
ledger, a pure and explainable matching engine, and about 1,500 automated test cases. What is missing is
not the engine. It is five things around it:

1. **No concept of professional level** anywhere in the data. A house officer and a consultant are the same
   thing to the platform, and a shift cannot ask for one or pay for one.
2. **The marketplace is one-way.** Facilities post shifts and pull candidates. Practitioners cannot publish
   a price, browse shifts, or be booked directly.
3. **Money cannot really move yet,** and several correctness gaps would bite the first time it does.
4. **Almost nothing talks to people.** The system raises events for offers, disputes, verifications,
   invoices and payouts, but only three events have a handler. SMS is console-only. A practitioner learns of
   an offer only by opening the app.
5. **A repeating pattern of access-control gaps.** The guard proves the *scope the caller claims*, but
   several actions never check that the *record* belongs to that scope.

**The single most important design decision** is to make every way of getting work end in one thing — a
**Booking** that carries the agreed level, the agreed rate and where it came from. That one change gives you
levels, two-way booking, fair pricing, a clean fee, a clear audit trail and a defence against people leaving
the platform, all at once. Section 4 describes it.

**The order that protects the business.** Fix trust and safety first, then make money safe, *then* switch the
fee on. A fee charged on a system that leaks phone numbers, mis-bills overlapping hours, or pays people before
it is paid teaches users to leave.

### The 16 things to fix before the Gombe pilot

| # | Problem | Why it cannot wait | Mark |
|---|---|---|---|
| 1 | Any facility owner can revoke another tenant's grants (`revokeGrant` checks the actor's permission, never that the grant lies in the scope the guard approved) | Cross-tenant damage with one UUID | [Verified] |
| 2 | Matching returns every candidate's **name and phone**, ranked and excluded, nationwide, to any facility user | Privacy breach (NDPA) and it destroys the fee: people simply phone each other | [Verified] |
| 3 | Dispute evidence can be downloaded, uploaded and listed without checking the caller is a party | Medical letters and photographs exposed | [Verified: download] [Read: rest] |
| 4 | An incident can name **any** practitioner when no shift is attached, so a throwaway facility can file a death-severity report against anyone | Reputational attack on the supply side | [Verified] |
| 5 | Check-in does not compare the caller to the assignee | A colleague who hears the code can check in an absentee | [Read] |
| 6 | Self-registering a facility makes the user `facility_owner` immediately, while still unverified; that role can look up any user by phone, and matching does not require a verified facility | An anonymous user becomes a directory-search tool | [Read] |
| 7 | Invitations and confirmations never re-check category, eligibility or consent | A lapsed licence still gets confirmed | [Read, two reviewers] |
| 8 | Confirming locks the *practitioner*, not the *request*: two different people can fill the last place at once | Overbooking | [Verified by reading the lock] |
| 9 | No IP or global rate limit; per-phone lockout lets anyone lock a victim out; register/resend can run up SMS cost; no CSP or HSTS | Abuse and cost | [Read] |
| 10 | The production image does not contain the worker's source, nothing deploys, stranded outbox events are never reclaimed, no alerts, backups are a local drill only | You cannot run it reliably | [Verified: image] [Read: rest] |
| 11 | SMS gateways are not implemented; offers send no message; a failed SMS is never retried; confirmation times are printed in UTC, an hour off Nigerian time | Replacing phone calls is the whole promise | [Read] |
| 12 | Billing **drops minutes** when a holiday and a night overlap (holiday daytime minutes are subtracted from night minutes) | Wrong invoices | [Verified] |
| 13 | Practitioners are credited at invoice *draft*; payouts do not check the invoice was paid; a payout race can double-pay; a gateway timeout is recorded as failure even if money went | The platform carries all the credit and loss risk | [Read] |
| 14 | Nurses, pharmacists, lab scientists and radiographers have no credential requirements seeded, and licence expiry is *verification date + 365 days*, not the date printed on the licence | Four of five professions are effectively unverified; unsafe expiry | [Read] |
| 15 | Agreements are not enforced, no privacy-notice step at sign-up, erasure is not implemented, NDPC registration and a data-protection officer are "not started" | A fee cannot be made binding on someone who never accepted terms; legal exposure | [Read] [Counsel] |
| 16 | A cancelled *filled* request leaves its assignments live; no-shows are detected only after the shift ends | A bogus no-show flag; an urgent shift cannot be saved | [Read] |

---

## 2. What is already strong — do not rebuild

- **Permission + scope guard** is strict by construction; step-up is checked before the permission.
- **Audit trail** with a coverage test that fails the build if a write to an audited table has no audit row.
- **Outbox** uses `SKIP LOCKED`, counts the attempt before running a handler, backs off, dead-letters at eight attempts,
  and has a two-worker concurrency test.
- **Matching engine** is a pure function with a weighted, explainable score (proximity 35, experience 30,
  fatigue 20, reliability 15), stored with each run.
- **Eligibility rule** is pure and well tested; hard-blocks are explicit and each has a human reason.
- **Attendance** has an exhaustively tested state machine; codes are bound with an HMAC, expire in five minutes,
  and allow five attempts.
- **Money primitives**: integer kobo, basis-point multipliers, a signed double-entry ledger that refuses an unbalanced
  set, compare-and-set status changes, and one invoice line per assignment.
- **Timesheet revisions** keep the whole prior state; break and night/holiday minutes are walked minute by minute.
- **Boot-time guardrails** refuse a production boot with console SMS, console payments or published secrets.
- **The practitioner onboarding flow** (wizard, submit-for-approval, officer confirmation from evidence) is good.

---

## 3. Your six directions — the answers in short

**1. Levels.** Model a ladder per profession as reference data (Appendix A has a draft). A practitioner claims a
level and compliance verifies it with evidence; a shift names the exact level it wants and the pay it offers;
rate floors are keyed by level; matching treats level as a hard filter with its own exclusion reason; experience
becomes a tie-break. Do this **before** pilot data exists — retrofitting a level into live shifts, rates and
invoices is the most expensive change in this document.

**2. Two-way marketplace.** Three doors into one Booking: (a) the facility posts a shift and invites matches (exists);
(b) the practitioner applies to a posted shift; (c) the practitioner publishes a priced availability listing and the
facility books it directly. Details in §4.1 and §4.4.

**3. Free now, ads and premium later.** Yes — but decide today what is *never for sale*: verification, the ranking
algorithm, safety features, getting paid. Ads and premium come after traffic, on separate surfaces, never inside a
queue, an offer, a timesheet or a credential screen. Build the fee line and the entitlement idea now so "free" is a
setting (0%), not a missing feature. See §4.7.

**4. The Gombe meeting.** Agreed — and the readability complaint is real and specific. Body text is 14px and 12px
grey text appears on about 270 lines; buttons are 36px; several status colours fail contrast. A **"Larger text"
switch** and a **projector mode** before the meeting. Use the meeting to *validate decisions* (the level ladder, what
facilities pay agencies today, rate bands, the fee) rather than only to preview screens. See §8 and §10.

**5. Income.** A small, clearly stated fee on completed, approved shifts is the right model. Four things make it
work: the fee must be **cheaper than the phone-call alternative** to the facility; the platform must **hold the
relationship** (§4.5); the money flow must be **safe** before the fee is non-zero (§4.6); and the **agreement must
bind** (finding 15). A note on "they cannot see it is big": keep the fee low and **show it plainly** on every
quote and invoice. Hidden fees are found eventually and cost far more trust than the fee earns.

**6. Equipment and labs.** A sound second revenue line, but it carries real liability (damage, patient safety,
regulators' licences for imaging equipment, VAT/WHT on hire). Recommend it as a **later module** built on the same
Booking and invoice rails once the shift marketplace is trusted. See §4.8.

---

## 4. The target design

### 4.1 One funnel: needs and offers meet in a Booking

Today: facility posts a *request* → matcher ranks candidates → facility *invites* → practitioner *accepts* → facility
*confirms* → *assignment*. The rate lives on the request, so everyone on a request gets one rate, and timesheets read it
from there.

Recommended: keep the engine, change the shape around it.

```
Facility "Shift" (need)  ─┐
                          ├─►  Proposal (either side, with terms) ─►  Booking ─► Attendance ─► Timesheet ─► Invoice ─► Payout
Practitioner "Listing"   ─┘                                            ▲
                                                                       └ origin: FACILITY_POSTED | PRACTITIONER_APPLIED | LISTING_BOOKED
```

- A **Proposal** is a directional offer carrying *terms*: level, window, rate, unit (hourly or per shift), expiry. It is the
  generalisation of today's invitation. It allows a bounded **counter-offer** (e.g. one or two rounds), each side
  re-checked against rate floors.
- A **Booking** is today's assignment, made richer: the **agreed level, agreed rate and unit, the fee rate in force, and
  the origin**, all written down at the moment of agreement ("snapshotted"). Timesheets and invoices read the
  booking, not the request. This also fixes today's bug where changing a rate card between acceptance and invoice
  changes what was agreed.
- **Instant booking** (listing flagged "book now") collapses accept and confirm into one step.
- Every path goes through **one booking function**, so the safety checks exist once: eligibility re-validated, level
  re-validated, conflict check, **a lock on the request row *and* the practitioner in a fixed order**, a
  **database-level overlap constraint** as a backstop, and an **idempotency key** so a retry on a weak connection does
  not book twice. (Today's confirmation locks only the practitioner.)
- A listing that is partly booked must say how it splits (whole window only, or any sub-window ≥ a minimum).
- A **soft hold** protects an accepted-but-unconfirmed offer for a short time so two facilities do not chase the same person.

### 4.2 Levels (the ladder)

- **Reference data owned by compliance**: per profession, an ordered list of *platform rungs* — not every employer's
  civil-service title. Each rung says what **evidence** proves it (full registration, fellowship, grade letter) and
  what it **maps to** on the regulator's register.
- **Profile**: a *claimed level* and a *verified level*. Replace self-declared "years of experience" with a "practising
  since" date drawn from registration evidence. Changing level, category or specialty after approval **returns the
  application for review**, otherwise people can promote themselves.
- **Shift**: names a level and a match rule — *exact* (default) or *this level or above*.
- **Matching**: a `level_mismatch` exclusion with a visible reason. Experience stops standing in for seniority; it is a tie-break.
- **Rates**: floors keyed by profession, **level**, specialty and shift type, resolved most-specific-first (as today).
  Add a rate **unit** because Nigerian locums often quote per shift.
- **Skills**: replace the single specialty with a *set* of skills (a nurse can be ICU and theatre). Today a mismatch is a hard exclusion.
- **Disputes**: add "wrong level supplied or paid for" as a category.

### 4.3 Pricing and negotiation

- The facility chooses **level + exact amount** (the user's direction). The platform shows **market guidance** per level
  and area, built from its own data once it has some. This is a differentiator, and it gives the Gombe meeting something concrete to correct.
- The default rate field must stop pre-filling a flat ₦5,000/hour for every profession; it anchors facilities low.
  Pre-fill the floor for the chosen profession and level instead.
- Premium multipliers (night, holiday, overtime, on-call) must be **visible on the offer** before a practitioner accepts, and
  frozen on the booking. On-call should be allowed below 1.0×, as the code comments already intend.
- **Two-way pricing**: a practitioner's ask must also clear the floor. A rate below floor is refused on both sides.

### 4.4 Discovery, consent and privacy

- **Shift board** (practitioner side): filter by profession, level, state/LGA, rate, date. Anonymous visitors see a teaser;
  applying needs sign-in and eligibility.
- **Practitioner directory** (facility side): only practitioners who **opted in** (a new consent purpose — "publish a
  listing with a rate" — separate from today's profile-visibility consent, with re-consent). Cards show a verified badge,
  level, area, rate-from and "available this week". **No phone, no surname-level detail** until a booking exists.
- **Log who viewed which practitioner**; rate-limit and paginate the directory to discourage scraping.
- Add composite indexes for the read model (profession, level, state, rate, window) — this is read-heavy, unlike matching today.

### 4.5 Keeping the relationship on the platform

The fee is only as safe as the platform's hold on the relationship. The honest approach is to make staying cheaper and safer than leaving:

- **Contact reveal**: reveal a phone number only inside a window around the shift (or relay calls/WhatsApp through the
  platform). Never before booking. (Today the confirmed roster and timesheet pages show the phone permanently.)
- **Value only the platform gives**: guaranteed and prompt payout; credential monitoring and expiry reminders; a portable reliability
  record; a dispute process; one-tap **rebook** of regulars and **recurring shift templates**.
- **Loyalty pricing**: a fee that *falls* on repeat pairs makes the third booking cheaper on the platform than off it.
- **Charge on the approved timesheet**, not on posting; store the fee rate on the booking.
- **Detect leakage**: pairs that match but never check in; repeated facility-fault or "neither" unhonoured flags on the same pair.
- Do **not** use heavy-handed clauses as the main defence; they are hard to enforce and sour goodwill.

### 4.6 Money flow and the fee

**Fee mechanics** (all [Read] unless noted):

- Replace the single environment variable `PLATFORM_FEE_BP` with a **dated fee policy**: rate, who pays, optional waiver, scope
  (everyone, a region, a profession, a plan). "Free at launch" becomes a policy row of 0%. Store the **applied rate per line**.
- **Who pays**: recommended as a *separate service fee billed to the facility*, so the practitioner receives exactly the
  quoted rate and the facility sees the full cost. Today it is deducted from the practitioner. Choose deliberately; it shapes
  how both sides feel about the product.
- **When it is earned**: on approved and **collected** work (today revenue is recognised at invoice draft).
- **How small is "small"?** It must exceed the cost of collecting and paying out (gateway charges, SMS, verification, support)
  and sit below what a facility pays an agency or spends in phone time today. **Measure the latter in Gombe.** Gateway rates
  [Unverified] — get current quotes before choosing a number.

**Two ways to move the money — a real trade-off:**

| | Platform collects, then pays the practitioner | Facility pays the practitioner; platform bills its fee |
|---|---|---|
| Fee enforcement | Strong | Leaks once parties go off-platform |
| Practitioner trust | High *if* payment is guaranteed; low if it waits on a slow facility | Direct, but no guarantee |
| Regulatory | Holding others' money may touch CBN payment-services rules [Counsel] | Light |
| Tax | Platform invoices the gross: VAT and withholding tax can sit on the whole amount [Counsel] | Tax stays on the fee |

**Recommendation.** *Pilot* (fee 0%): keep transfer-and-record in a segregated bank account, manual settlement with a bank
reference, no gateway. *Growth*: use a **licensed gateway's split settlement** (subaccounts) so the platform does not hold
funds; Remita for government payers [Unverified for exact products]. Confirm with counsel whether an **agent model** (the platform
invoices only its fee and collects the practitioner's fee as agent) keeps VAT and withholding tax on the fee rather than the
gross.

**Money correctness to fix first** (even at 0%): the band-split bug; credit only on collection (or an explicit, small credit limit);
void and credit-note reversals; payouts that **respect disputes**; a lock or unique index so two payouts cannot prepare at once;
an idempotent transfer reference and a status query so a timeout is not mistaken for failure; webhooks that verify the provider's
signature and dedupe; a ledger-sums-to-zero alert; `BIGINT` money columns (an `INTEGER` caps an invoice near ₦21.5 million);
gapless invoice numbers; VAT/WHT/TIN fields; a maker-checker step so the person who raises a payout is not the one who releases it.

### 4.7 Monetisation roadmap

| Phase | Trigger | What | Guardrail |
|---|---|---|---|
| 0 — Free | Launch | Everything free. Fee line exists at 0%. Tell users "free during launch; core features stay free" on a public pricing page. | Do not promise "free forever" for things you will charge for. |
| 1 — Adverts | Real traffic exists | A clearly labelled **Sponsored** block on the public shift board and directory; maybe one on the dashboard side. Medical suppliers, training bodies, insurers. | Never on pages showing personal data; no third-party scripts on those pages; opt-in for profiling (NDPA). |
| 2 — Completed-shift fee | Settlement trusted; agreements enforced | The small fee, shown plainly. | Repeat-pair discount; transparent invoice. |
| 3 — Premium | Facilities and practitioners asking for more | Facilities: urgent-fill boost, rota tools, analytics, multi-branch. Practitioners: profile analytics, featured listing (clearly tagged), priority notice. | A "Verified" badge can **never** be bought; ranking is not for sale. |
| 4 — Equipment | Shift marketplace trusted | Equipment-use fee (§4.8). | Insurance and liability agreements first. |

### 4.8 Equipment and labs module (recommended as later)

- **Reusable now**: facility identity and the verification gate (generalised from "may publish" to "may list"), roles, stored
  files for photographs and certificates, audit and outbox, the invoice and ledger rails, lab and imaging facility types.
- **New**: *Asset* (owned by a facility or branch; type, condition, regulator certificate with expiry — for imaging, the relevant
  radiation-safety licence), a *booking* record (asset, practitioner, window, price, status), and a fee basis separate from shift pay.
- **Money rails must be generalised**: today the model assumes the practitioner is always the payee and the facility always the payer
  (ledger accounts, payout, and a unique non-null link from invoice line to assignment). Add party *type + id*, a *line kind*
  (shift, equipment use, subscription, advert, fee), a facility payee with a bank account, and **set-off** against earnings
  when the same facility is on both sides.
- **Risk to settle first** [Counsel]: who is clinically accountable when a practitioner uses a facility's equipment for their own
  patients; patient consent and records; indemnity and insurance; damage deposits; VAT and withholding tax on hire. Disputes must
  be generalised from "a shift" to "a booking of any kind", with a damage claim and a deposit hold.

### 4.9 Notifications are the nervous system

Eight of the system's events have **no consumer** (invitation, acceptance, request published, facility verified, credential
verified/expired/submitted, dispute opened, incident reported, invoice/payment/payout, timesheet submitted). The product's promise —
"replace phone calls" — depends on telling people things. Recommended, in this order:

1. Offer received; offer accepted; booking confirmed/cancelled; shift reminder (24 h and 2 h); not checked in (30 min after start).
2. Verification decisions and licence-expiry warnings (30/7 days); facility licence expiry.
3. Timesheet submitted / approaching auto-approval; invoice issued / paid; payout sent.
4. Dispute opened/answered; incident reported (severe → immediate alert to compliance).
5. **Channels**: SMS (two providers with failover and delivery receipts), **WhatsApp** (dominant in Nigeria), in-app inbox with a bell,
   email. Add per-user preferences and digests early — SMS cost is real and, in a free product, the platform bears it.
6. Fix the basics: **times in West Africa Time**, retry failed messages through the outbox, surface OTP-send failures to the user, and
   mark OTPs "transactional" so numbers on do-not-disturb lists still receive them.

### 4.10 Matching and reliability — improvements

- Level exclusion and skills set (above). Cap and re-weight the experience factor.
- **Fatigue** should count worked shifts, not only confirmed ones, and look forward.
- **Cold start**: a practitioner with no-shows should not score "neutral" until five completions.
- **Offers must expire before the shift** and respect urgency (today a flat 24 hours, and "expired" is never written).
- Persist only the **top N** per run, and push state and eligibility into the database query rather than loading a whole category into memory.
- **Detect no-shows early**: "not checked in 30 minutes after start" → alert the facility and **auto-reopen and backfill-invite**.
- **Sanctions ladder**: warning → temporary pause → removal; late-cancellation window and consequence; **a facility reliability score** too
  (today facility fault is recorded and consumed by nothing).
- **Withdrawal**: practitioners can currently exit a confirmed shift only through an excusal. Give a proper withdrawal with notice rules.

---

## 5. Module by module

Format: **State → Linkages → Problems → Recommendations** (priority, effort, reason).

### practitioners
- **State.** One profile per user (category, one optional specialty, self-declared years, home area, travel preference, photo). Application
  flow with explicit submit; identity stored as a keyed hash; professional registration; screening; a pure eligibility function.
- **Links.** Matching reads profiles and eligibility; credentials feed eligibility; consent withdrawal removes someone from matching.
- **Problems.** No level; years of experience is unevidenced and capped at 10; specialty is single-valued and a hard filter; edits after
  approval need no re-review; matching leaks name and phone [Verified]; **folio number is unique across all regulators** (collisions are plausible);
  regulator is free text on the manual record (a typo never satisfies eligibility).
- **Do.** P0/S strip phone to initials until booked. P0/S re-run eligibility, category, specialty at invite and confirm. P1/S unique on regulator + folio,
  validate regulator against category, add a category index. P1/M post-approval changes return the application. P1/M level, skills set, practising-since.

### credentials
- **State.** Submit with a document or number; officer approve/reject/ask for more; resupply; signed document links with access logged; daily expiry sweep;
  officer confirmation from evidence (new).
- **Links.** Eligibility reads verified/expired; rejection of a required credential returns the application.
- **Problems.** Requirements seeded for **doctors only** [Read]; no NMCN/PCN/MLSCN/RRBN credential types, and one-click registration confirm works only for the
  doctor licence type; **expiry = verification date + 365 days**, not the printed date; a verified credential blocks resubmission, so renewal cannot be pre-sent;
  no reminders; practitioners are not told of a rejection; no retention rule for rejected documents; no image compression for weak networks; sanctions list seeded empty
  (screening is vacuously "clear" until compliance fills it).
- **Do.** P0/M seed credential types and requirements for the other four professions with compliance sign-off. P0/S capture the licence's own expiry at review.
  P0/S SMS on decisions and 30/7-day warnings. P1/M renewal before expiry; retention; client-side compression. Level evidence (fellowship, grade letters) becomes
  credential types attached to a rung.

### config (reference data)
- **State.** Seeded vocabularies with named owners; served by one endpoint. Specialties exist for doctors (12) and nurses (3) only; rate floors for doctor and nurse only.
- **Problems.** Nothing writes config except the seed — every change needs a deploy; a missing floor **silently passes**; the reference endpoint returns inactive rows and has no
  caching (ships all 774 LGAs every call); a leftover duplicate "mandatory" flag; no dentists, physiotherapists, community health workers, optometrists or medical-records staff;
  the platform fee is an environment variable, unversioned.
- **Do.** P1/M an audited admin screen for vocabularies and floors. P1/S fix inactive handling, add caching, drop the legacy flag. P0/S a floor for every profession and level
  (or refuse to publish without one). P2/M dated fee schedule in config; plan/entitlement tables when premium nears.

### availability
- **State.** Weekly slots, one-off slots, blocks; minutes-since-midnight in WAT; sound pure logic (a slot must cover the whole shift; a block beats a slot).
- **Problems.** It is private pattern data, not an offer: no rate, level, area, visibility, status or expiry. The UI cannot make an "all day" slot (23:59 leaves a
  one-minute gap that refuses overnight shifts); entry is one slot per day per request; block reasons are free text kept forever in the audit trail (may hold health data); old slots never pruned.
- **Do.** P0/S "all day" and "every weekday" shortcuts; fix 24:00. P1/S bulk entry; optional or pick-list block reason kept out of the audit trail; prune. For direction 2:
  add a separate **Listing** (window or pattern, ask rate, level, skills, area, minimum notice, expiry, status open/booked/withdrawn/expired), floor-checked, consent-gated.

### facilities
- **State.** One flat facility row (one type, unique CAC number, one address, one representative, status, licence fields). Ops-created or self-registered; clean publish gate; a
  representative cannot verify their own facility.
- **Problems.** **REJECTED is a dead end** (cannot edit the CAC number; re-registering hits the unique rule); self-registration does not normalise the CAC number (`rc 123456` ≠ `RC123456`),
  so someone can squat another hospital's number; **no screen uploads a licence**, and approval is allowed without one; no suspension action and no licence-expiry sweep; **CAC is mandatory but government
  hospitals and primary health centres — most of Gombe — have none**; no pharmacy or maternity-home type; the last owner can revoke themselves; matching reads the facility table directly (breaks the module rule);
  stale docs.
- **Do.** P0/S reuse the normalisers at self-registration. P0/M facility profile page with licence upload; require licence evidence or a recorded override reason before approval. P0/S rejected → re-review path;
  accept a ministry/registration reference where there is no CAC. P1/M suspend action; daily licence-expiry sweep with 30/7-day reminders; notify the owner on verification. P1/S block removal of the last owner.
  P2/L branches and departments (scope types exist; no route resolves them).

### service-requests
- **State.** Category, optional specialty, day/night, window ≤24 h, headcount ≤50, one hourly rate, urgency, notes. Draft → published → filled/cancelled/expired. Floor-checked at create and publish.
- **Problems.** No level; the request's rate is the contract for everyone on it; **shift type is picked by hand, not derived from the times** (a night shift labelled day gets the lower floor); an expiry sweep marks a half-filled request
  EXPIRED (distorts fill-rate); cancelling a filled request leaves assignments live [Read]; no clone/repeat; no practitioner withdrawal; urgency is display-only.
- **Do.** P0 levels (§4.2). P0/S cancel cascades to assignments with notice. P1/M floors admin; per-shift rate option; derive shift type; clone/repeat. P2/S partially-filled state; edits to non-contractual fields.

### scheduling
- **State.** An empty stub; the schedule is the assignment list inside matching. No calendar, rota template, recurrence, swap or calendar export — every Saturday night is a separate request.
- **Do.** P1/M rota templates generating independent requests plus a calendar view (also where the two-way calendar lives). P2 shift swaps.

### matching
- **State.** See §2. Facility-initiated and hand-reviewed.
- **Problems.** Overbooking race [Verified by reading the lock]; match payload carries phone for ranked and excluded candidates [Verified]; no check that the request is published or the facility verified before a run;
  invites and confirms unvalidated; fatigue and cold-start gaps; whole category loaded per run; no rate/fee snapshot; uniqueness on (request, user) blocks re-booking someone who cancelled.
- **Do.** §1 items 2, 6, 7, 8. P1/S fatigue, cold start, expiry. P1/M SQL pre-filter, top-N. P1/S rate and fee snapshot on the booking; allow re-booking after cancellation.

### notifications
- **State.** SMS only; one handler (assignment confirmed); SMS gateways throw "not implemented".
- **Problems.** See §4.9. A failed SMS is recorded as "handled" and never retried; times printed in UTC; no inbox route; no reminders; no WhatsApp; no per-message cost control.
- **Do.** P0/M real SMS providers with failover and receipts; offer, cancel and reminder messages. P1/M WhatsApp, inbox, preferences, Hausa templates.

### cancellations-sanctions
- **State.** Hourly sweep flags ended confirmed shifts with no attendance; platform officer records fault; reliability = completed ÷ (completed + no-shows).
- **Problems.** Detection only after the shift; no cancellation window, penalty or ladder; facility fault consumed by nothing; recording a fault is not atomic with updating the assignment; no-show is terminal;
  platform-only fault decisions will bottleneck.
- **Do.** P0/M early detection and backfill. P1/M sanctions ladder, facility reliability. P1/S make fault + assignment update atomic or add a repair job.

### attendance
- **State.** Facility-issued 6-digit code or QR; presented by the practitioner; manual fallback with a reason; feeds timesheets.
- **Problems.** No ownership check [Read]; the three-hour window is enforced only by the screen; manual times accept any date with no practitioner confirmation; no idempotency on a retry after a timed-out success.
- **Do.** P0/S bind check-in to the assignee and to a still-confirmed assignment. P1/S server-side window. P1/M idempotency and a queued check-in for weak connections.

### rates-contracts
- **State.** Per-facility rate card with four multipliers; supersede-on-new; floors live in service-requests.
- **Problems.** On-call cannot be a fraction; **card choice ignores dates** (a facility can change premiums between acceptance and invoice; nothing is snapshotted); practitioners cannot see premiums before accepting;
  per-band rounding gives a phantom 1–2 kobo premium at par; no ceiling on an hourly rate.
- **Do.** P0/S snapshot the resolved rate and multipliers at booking. P1/S on-call < 1.0×; show premiums on offers. P2/S one active card per facility (unique index); ceiling.

### billing-settlement
- **State.** Manual draft invoice → issue → operator marks paid; four ledger accounts; prepare-then-release payouts; gateway stubbed (console only, local only).
- **Problems.** §1 items 12–13 and §4.6; invoice numbers are timestamp-based (not gapless); no VAT/WHT/TIN; one non-step-up permission lets the same person raise, mark paid, prepare and release; `payout.manage` also sits in a
  facility role (the platform scope on the routes is the only thing stopping it); no bank-account model; inbound payment is a bare button (no reference, amount, date or payer); events have no subscribers; reads attendance tables directly.
- **Do.** P0/S minute-band fix; payout lock. P0/M manual settlement with a bank reference; capture payment reference/amount/date; payout depends on collection or an explicit credit limit; void + credit-note; disputes post adjustments.
  P1/M bank-account model with name enquiry; gateway adapter with idempotent reference and webhooks; `BIGINT`; maker-checker; ledger protections in the database.

### timesheets
- **State.** Minute-walk classifier; check-out computes; practitioner submits; facility approves or rejects; correction writes a revision; approval completes the assignment.
- **Problems.** **No deadline or reminder**: a facility that never approves stalls payment — the main threat to "facility pays"; the timesheet amount is base only while the invoice includes premiums (the facility approves a figure it will not be billed);
  approval and completion are not one transaction; holiday list is partial with no state holidays; the night window is hard-coded.
- **Do.** P0/M auto-approve after N days unless disputed, with nudges; price at approval so one figure exists. P1/S configurable night window and state holidays. P2/S atomic approval.

### auth
- **State.** Three-step registration, login, reset, step-up, grants; opaque hashed revocable sessions; Argon2id; OTPs as keyed digests.
- **Problems.** §1 items 1, 6, 9; password reset has **no screen** though the lockout message tells people to use it; reset by SMS alone covers admin accounts (SIM-swap fraud is common); the resend route reveals which numbers are registered; sessions last 14 days
  with no idle timeout; nothing purges sessions, OTPs or login attempts; the escalation check ignores scope; an OTP attempt counter is read then incremented (parallel guesses can exceed the limit).
- **Do.** P0/S scope check on revoke. P0/M IP and global rate limits at the edge, per-phone + IP throttle with no permanent lock, trusted-proxy handling. P0/M real SMS; reset screen. P0/M gate facility permissions on verified status; replace phone lookup with
  an invitation the invitee accepts. P1/M second factor for privileged roles. P1/S retention jobs. Two-way booking adds `offer.publish` and `booking.accept`.

### audit-compliance
- **State.** Scoped audit trail; consent records with lawful basis; versioned agreements; data-request queue; export and an erasure *assessment*.
- **Problems.** **Erasure is not implemented** (only a report of blockers); audit rows keep full names and email because redaction is by key name; **agreements are not enforced**, no privacy-notice step at sign-up, a facility's acceptance records a user not the facility; NDPC
  registration, data-protection officer and counsel's opinion are "not started" in the gate checklist; no retention schedule; no note on cross-border storage; facility staff cannot use export/erasure routes; export omits disputes, incidents, notifications, attendance,
  timesheets, screening, sessions; the audit table is append-only only by convention (the application's database role can change it).
- **Do.** P0/L an erasure job that pseudonymises personal data *including* audit rows, with a test. P0/M an acceptance gate with re-acceptance on new versions and per-entity facility acceptance; a privacy-notice step. P0/M [Counsel] NDPC registration, DPO, DPIA, retention
  schedule, cross-border note. P1/S database-level immutability for audit rows. P1/M widen export; facility-staff rights route. Ads need opt-in profiling consent; a paid tier is a contract basis with VAT invoices [Counsel].

### disputes
- **State.** One case per shift, within 14 days of the decision, outcomes upheld/dismissed, append-only evidence.
- **Problems.** §1 item 3; **one-sided in practice** (no facility screen, no evidence UI for practitioners, nobody told a dispute was opened); **no link to money** (invoiced shifts cannot be re-billed after an upheld dispute, no credit note, payouts ignore disputes);
  attendance side-effect runs outside the transaction; no adjudication SLA; the platform that takes the fee also adjudicates.
- **Do.** P0/S party and scope checks on every read, upload and attach. P0/M notices and a facility console. P0/M payout hold and credit-note path. P1/M SLA, appeal step, facility response, "amount at stake". Generalise the subject for equipment.

### clinical-incidents
- **State.** Facility reports with severity and category; compliance queue; closure with outcome; suspension in the same transaction as closure.
- **Problems.** §1 item 4; no alert on report; suspension with no notice, hearing or appeal and no direct route; suspension does not cancel or notify the facility about confirmed shifts; practitioners cannot report; free text may hold patient identifiers (no guidance, no redaction);
  "referred to regulator" records no regulator or reference.
- **Do.** P0/S constrain the subject to someone who shared an assignment with the facility. P1/S severe-incident alert. P1/M notice, right of reply, appeal; a direct suspend route. P1/S practitioner reporting; patient-data guidance; regulator field.

### suggestions
- **State.** Pilot feedback log with triage; decline reasons anonymised (good).
- **Problems.** Authors cannot read the response (the loop is not closed); no retention; not a complaints channel.
- **Do.** P1/S author view and notification. P2/M report-a-user; after-shift ratings.

### platform / infrastructure
- **State.** CI runs lint, types, unit, migration up/down/up, integration on real Postgres, dependency audit and secret scan, end-to-end. Environment is validated at boot. About 1,050 test cases by grep.
- **Problems.** §1 item 10 and §7. Also: the pool is Prisma's default with no PgBouncer; audit coverage and request timing use a Prisma hook that **may not exist in Prisma 6** [Unverified — would block an upgrade]; no magic-byte check or malware scan on uploads;
  no retention and no object deletion on erasure; `/health` checks only the database and doubles as the container healthcheck (a database blip restarts the web tier); no worker liveness; the squashed migration baseline is **uncommitted**; the backup script cites a document that does not exist.

### user interface
- **State.** Disciplined consoles (status vocabulary, honest empty/error states, `en-NG`); a single public landing page.
- **Problems.** §8.

---

## 6. Linkages — the map, and what is broken in it

```
Register ─► Practitioner profile ─► Credentials / Identity / Registration / Screening ─► Eligibility ─┐
                                    Availability ───────────────────────────────────────────────────┤
Facility (verified) ─► Service request (published) ─────────────────────────────────────────────────┤
                                                                                                    ▼
                         Matching (rank) ─► Invitation ─► Assignment ─► Attendance ─► Timesheet ─► Invoice ─► Ledger ─► Payout
Side channels:  Notifications (events) · Disputes · Incidents · Sanctions/unhonoured · Audit · Consent
```

**Five systemic problems, not module problems:**

1. **Events with no listener.** The outbox is excellent, but almost nothing subscribes. Invitations, disputes, verifications, invoices, payouts and incidents are silent.
2. **Claimed scope is checked; the record's scope is not.** The same shape of bug in grant revoke, dispute evidence, dispute listing, incident subject, check-in and invite. Fix as a *pattern*: a test that, for each route taking an id, proves a caller from another tenant is refused.
3. **The rate lives in the wrong place.** On the request, not the booking, so levels, two-way pricing, snapshots and per-person rates all need it moved.
4. **Modules read each other's tables** (matching→facility, billing→attendance/assignment, timesheets→attendance/holidays, credentials↔practitioners). Documented as against the rule in places. Acceptable at pilot size; becomes a coupling cost as the money and listing modules grow. Prefer small read functions published by each owning module.
5. **Stage documents are stale** (disputes says billing "does not exist"; facilities says there is no self-signup). New developers will be misled. Add "last verified" dates and keep decisions in short decision records.

---

## 7. Platform and DevOps

**Minimal production architecture for the pilot** [Unverified vendor details — measure before choosing]:

1. **Edge**: a CDN/WAF in front (TLS, rate limits, bot challenge), HSTS and a content-security policy.
2. **Compute**: two small web instances behind a proxy; **separate outbox and scheduled-job workers** from one image that actually contains the worker's source (today's image does not).
3. **Data**: managed Postgres 16 with point-in-time recovery, private network; PgBouncer once there are three or more app processes.
4. **Files**: private S3-compatible bucket in the same region, versioning and lifecycle rules, a scan-and-quarantine step before an officer can open an upload, and a nightly copy to a second provider.
5. **Messaging**: two SMS providers behind the existing adapter with failover; a transactional email provider; WhatsApp business messaging.
6. **Operations**: error tracking, uptime checks, shipped logs, alerts to a phone someone carries.
7. **Environments**: local, staging (provider sandboxes, own database), production; release by image tag; a single release-time migration job (today the web container migrates on start).

**Reliability fixes** (small, high value): reclaim stranded events after a timeout; a worker heartbeat; separate the outbox loop from the sweeps (a slow screening sweep currently delays the sign-up role grant that the UI waits for);
dead-letter view, alert and replay; purge jobs for processed events, sessions, OTPs and login attempts; per-row isolation in sweeps; a liveness/readiness split.

**Backup and recovery.** The drill script is a good idea. Propose targets of **RPO ≤ 15 minutes and RTO ≤ 4 hours** [proposed, not measured], then *prove* them with a timed restore on staging. Write the runbook the script cites.

**Hosting.** Nigerian host, a Johannesburg/Cape Town region, a European region, or a mix behind a CDN. Residency and latency to Gombe's networks versus maturity and price: **run the same probe from a Gombe 4G connection against two or three candidates, then decide.** USD-billed infrastructure against naira revenue is a real exposure. For a free-at-launch product, **SMS and verification fees will cost more than hosting.** NDPA concerns cross-border transfer safeguards [Counsel]; counsel should confirm for any chosen host and for the current file store.

**Gombe pilot rollout.**
1. Weeks 0–4: all P0 items; commit the squashed migration baseline and make migrations append-only from there.
2. Staging soak: seeded 100-facility dataset; load budget passes; kill a worker mid-event; timed restore meets target.
3. Closed alpha: operations team, 2–3 Gombe facilities, about 30 practitioners; live SMS; manual identity/registration review; **no payment gateway** (fee 0%).
4. Weekly go/no-go: OTP delivery rate, p95 latency under 300 ms, zero stranded events, dead letters worked, SMS spend against budget, a restore drill.
5. Expand only when those hold. A second state should be a configuration and capacity review, not a re-architecture.

---

## 8. Readability and interface plan (for the meeting and for older users)

**What was measured** [Read]: root size is the browser default (16px) but body content uses 14px (about 290 uses of `text-sm`); 12px (`text-xs`) appears on about 270 lines, two-thirds of them also grey; 11px headings appear ten times; the record-detail
component truncates values (names and amounts clip); buttons are 36px tall (small buttons 32px); input borders have about 1.3:1 contrast (the standard asks 3:1); the commonest status colours (pending, new, submitted, open) have 3.0–3.3:1 text contrast
(the standard asks 4.5:1); focus rings are 1px.

**Fix list.**
- **P0/S** Root 17–18px, line-height 1.5; body 16px; hints 14px; nothing under 14px; delete the 11px style.
- **P0/S** Controls 44px; inputs 16px; 2px focus ring with offset; darken muted text, warning text and input borders; solid status fills.
- **P0/M** An app-wide **Larger text** switch (A / A+ / A++) saved per user, and a **projector mode** (fewer columns, no truncation). This is the best single answer to the Gombe complaint.
- **P1/S** Wrap, do not truncate, record values.
- **Accessibility P0/S**: trap and return focus in the mobile drawer; add a skip-to-content link. **P1/S** real heading structure on cards; stop announcing static notices on every mount; avoid the dark-mode flash on load and respect the system setting.
- **Mobile and weak networks.** P1/S move the heavy client providers off the public landing page. P1/M render the session on the server with a shell skeleton instead of a bare spinner. P0/S manifest icons (the install manifest has none) and P1/L a service worker with an
  offline shell and a queue for check-in and timesheet writes.
- **Public face.** P0: a `/pricing` page that says "free during launch; core features stay free"; Terms, Privacy and Contact pages and a WhatsApp number; **regulator names and real counts** (verified practitioners, facilities, states) driven from the data; remove developer text from the login page
  (it names a seed script and a document); a **forgot-password screen**; a mobile menu and visible "Sign in" on phones; sharing cards, sitemap and robots; a **"Share on WhatsApp"** link on each shift (the cheapest growth loop here). Do not invent testimonials.
- **Language.** P1/M Hausa and English for the practitioner app, public pages and SMS/WhatsApp templates (strings are inline across about 108 files, so extract them first). Leave the operations console in English.
- **Details that matter.** Naira without ".00" on whole amounts; thousands separators in rate inputs; the new-shift rate must not pre-fill ₦5,000; offer cards should show location, total pay for the shift and travel, not just the hourly rate; empty states should offer one action.
- **Facility side** needs a real onboarding checklist and a facility profile page (licence, branches, later equipment).

**For the meeting itself:** bring a printed one-page flow of a shift from posting to payment; a demo script on the larger-text mode; the draft level ladder (Appendix A); and three questions: *What do you pay an agency or spend in phone time per shift today? Which levels and titles do you actually hire at? What would make you stop using the app and phone each other instead?*

---

## 9. Roadmap

| Phase | Duration (rough) | Scope | Exit criteria |
|---|---|---|---|
| **0 — Make it safe** | 4 weeks | The 16 items in §1; SMS gateways; offer notifications; production image, deploy pipeline, alerts, backups; rate limits; readability pass and larger-text mode; credential requirements for all five professions; pricing/terms/privacy pages | Staging soak passes; a worker kill loses no event; timed restore meets target; every id-taking route has a cross-tenant refusal test |
| **1 — Gombe pilot, free** | 6–8 weeks | Live pilot with facility-posted shifts, manual verification, **levels data model in place from day one**, fee row at 0%, notifications live | OTP delivery ≥ target; first shifts completed and approved; auto-approval working; no stranded events; feedback loop closed (authors see responses) |
| **2 — Two-way marketplace** | 6–8 weeks | Booking abstraction, proposals with bounded counters, applications to shifts, listings and direct booking, shift board and directory, consent and view-logging, contact-reveal windows, rate snapshots | No double-booking under concurrent test; directory not scrapeable; booking origin visible in audit |
| **3 — Money you can trust** | 6–8 weeks | Fee policy, collect-then-pay with a licensed gateway, webhooks and reconciliation, void/credit-note, dispute-aware payouts, VAT/WHT handling, maker-checker | Reconciliation job clean for a month; ledger-sum alert quiet; counsel sign-off |
| **4 — Fee on, growth** | ongoing | Switch the fee on (transparent, repeat-pair discount), WhatsApp, referrals, SEO, ads on public surfaces | Fee does not reduce repeat bookings; support load stable |
| **5 — Premium and equipment** | after traffic | Premium for facilities and practitioners; equipment module on the generalised rails | Insurance/liability agreements in place; counsel sign-off |

---

## 10. Decisions needed from you and the team

1. **Level ladder**: approve or amend Appendix A with practitioners in Gombe. Rungs must map to something a regulator register or a certificate can prove.
2. **Who pays the fee**: facility on top of the quote (recommended) or deducted from the practitioner?
3. **Who holds the money** in the pilot: transfer-and-record (recommended) or a gateway from day one? And at growth: collect-then-pay or split settlement?
4. **Free-period promise**: how long, and what exactly stays free forever (suggestion: verification, applying and booking, timesheets and getting paid, safety).
5. **Facility verification where there is no CAC** (government hospitals, primary health centres): what reference will you accept?
6. **Channel**: is WhatsApp the primary channel and SMS the fallback, or the reverse? Budget for monthly messaging.
7. **Language**: Hausa from the pilot, or after?
8. **Legal**: engage counsel now for NDPC registration, a data-protection officer, the agreement text (so the fee binds), VAT/WHT treatment and whether holding funds touches payment-services rules.
9. **Hosting**: after the Gombe probe of two or three candidates.
10. **Practitioner-quoted rates**: allowed to be above a facility's posted band? Counter-offer rounds (suggest two)?

---

## 11. Risks, unknowns, and what was not checked

- Everything here is from **reading code and documents**. No behaviour was observed. Where a finding is a race condition or an access gap, it should be **reproduced by a test before it is fixed**, and the test kept.
- I re-read eight claims myself. Seven were confirmed in the code: grant revoke (including that the route takes the scope from the caller's own input), phone in match results, dispute-evidence download, confirm locking only the practitioner, the production image's contents,
  billing's band split, and the incident subject rule. The eighth, check-in ownership, I could only partly confirm: the function loads the assignment and I saw no comparison of the caller to the assignee, but I did not trace every caller. Every other finding is as reported by a reviewer
  and was not re-checked, including the cancel-leaves-live-assignments claim.
- **Tax, CBN, NDPA, regulator and gateway facts are not verified.** They are flagged [Counsel] or [Unverified] and must be confirmed before any decision rests on them.
- Hosting prices, SMS rates, gateway fees and verification-provider fees were **not** looked up. Get quotes.
- Other people's uncommitted work is in the same working tree (including the migration squash and recent changes to the application flow). The findings describe the tree as it is today and may overlap with work already in progress.
- Several stage documents are stale (see §6.5), so a document and the code may disagree; the code was treated as the truth.

---

## Appendix A — draft level ladders (to validate, not facts)

These are **platform rungs** for discussion, not official titles. Employer grade names vary; the point is a small ordered set that each maps to a verifiable
fact. Validate with the relevant regulator's guidance and a panel of practising colleagues in Gombe before use.

| Profession | Draft rungs (low → high) | What would prove it |
|---|---|---|
| Doctor | House Officer · Medical Officer · Senior Medical Officer · Registrar · Senior Registrar · Consultant | Provisional vs full registration; years since full registration; fellowship or specialist registration for the top three |
| Nurse / midwife | Staff Nurse/Midwife · Nursing Officer · Senior Nursing Officer · Principal Nursing Officer and above | Registration (RN/RM), post-registration years, grade letter or specialist certificate |
| Pharmacist | Intern · Pharmacist · Senior Pharmacist · Principal and above | Internship completion, full registration, years |
| Medical laboratory scientist | Intern · Scientist · Senior Scientist · Principal and above | As above |
| Radiographer | Intern · Radiographer · Senior · Principal and above | As above |

**Skills (a separate set, not a rung):** for example theatre, intensive care, paediatrics, accident and emergency, community health, imaging modalities, specific laboratory disciplines.
