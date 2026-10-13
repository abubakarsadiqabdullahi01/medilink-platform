# Part 1 — Why Medilink exists, who it serves, and how each group says "yes"

## 1.1 The problem

Health facilities across Nigeria — particularly outside the major cities — face short-notice staffing gaps: night and weekend cover, maternity leave, a sudden resignation, a surge in an outbreak. Today those gaps are filled through personal networks and WhatsApp groups. There is no standard way to check a practitioner's licence, no reliable record of who worked where and for how long, and no guarantee of timely pay `[v2.9 §2]`.

The consequences fall on three groups:

- **Facilities** risk engaging someone who is unlicensed, wrongly qualified for the duty, or who simply does not turn up — and have no record if something goes wrong.
- **Practitioners** have no transparent route to legitimate paid work beyond who they know, are paid late or not at all, and carry no portable record of their work.
- **Patients** meet an unstaffed ward, a cancelled clinic, or an unverified clinician.

Medilink's own v2.9 puts the core position plainly: *a staffing platform for healthcare is a clinical-safety system before it is a marketplace.* That position does not change in v3. What changes is the ambition around it.

## 1.2 The promise

> **Facilities obtain the right verified professional at the right level, place, time and price. Professionals find suitable work, control their availability and receive reliable payment. Medilink earns only when it creates measurable value.**

Stated as three promises, each of which can be tested:

| To | Promise | How we will know it is kept |
|---|---|---|
| **Facilities** | Only verified, currently licensed professionals at the level the duty needs; a filled shift or an early warning; a plain, visible price | Shift fill rate; time to first qualified candidate; no-show rate; zero unverified people on a ward |
| **Professionals** | Real work at an agreed rate they can see before they accept; control over when and where; payment on a known day; a record that is theirs | Offer acceptance rate; time from approval to payout; dispute rate; repeat bookings |
| **The business** | Revenue only from completed, approved, paid engagements; no hidden fee; no held client money | Effective take rate; engagements per month; payment success; reconciliation clean |

## 1.3 What Medilink is not

- **Not an electronic medical record.** It does not hold patient identifiers, clinical results or treatment notes, and the incident module is built so it cannot become an informal one `[v2.9 Module 14]`.
- **Not a wallet.** It records a ledger and settles through a licensed payment provider; it does not hold client funds `[v2.9 §8.4, §9.4.2]`.
- **Not the practitioner's employer or the clinical provider.** v2.9 adopts the position that Medilink is an *introducer and platform operator*; the engagement is between facility and practitioner `[v2.9 §9.4.3]` `[Counsel]`.
- **Not a job board.** A job board lists vacancies. Medilink verifies the person, matches by level and licence, records attendance, approves hours, and settles payment.
- **Not "Uber for doctors".** Qualifications, terms and payment are built into every engagement rather than bolted on afterwards.

## 1.4 Who it serves

| Persona | Examples | What they are trying to get done | What they fear |
|---|---|---|---|
| **Practitioner** | Staff nurse or midwife; medical officer; pharmacist; medical laboratory scientist; radiographer | Find legitimate extra or part-time work, know the rate before they say yes, be paid on time, build a record that follows them | Not being paid; being blamed for something that was not their fault; their phone number or documents leaking; a platform that takes a cut they cannot see |
| **Facility owner or representative** | Proprietor of a private hospital; medical director; officer-in-charge of a PHC | Keep wards covered safely and cheaply; be able to show a regulator who worked | Unlicensed or under-qualified staff; hidden charges; being responsible for something they cannot audit |
| **Ward or unit manager / scheduler** | Matron; head of department; roster officer | Fill tonight's gap in minutes, on a phone, without a long form | Software that is slow or confusing; offers that never get answered |
| **Facility finance or HR** | Accounts officer; HR officer | Timesheets and invoices that agree with each other and with the bank; records for tax | Being billed a figure they did not approve |
| **Medilink compliance officer** | Verifies identity, licences, facilities | Decide quickly and defensibly, with the evidence in front of them | Pressure to approve without evidence; no record of why they decided |
| **Medilink operations and finance** | Runs queues, disputes, invoices, payouts | A queue they can work; money that reconciles | Silent failures; one person able to do everything |
| **Regulators and ministries** *(indirect)* | MDCN, NMCN, PCN, MLSCN, RRBN; state ministry | A lawful route to ask who worked where; no bulk access | A platform that undermines their registers |

## 1.5 What each group must see before it says yes

"The way the target group approves the system" is not a meeting; it is a short list of conditions that must be true, which they judge for themselves. The table below states those conditions, how the system answers each one **today**, and where this document deals with the gap. It is also the checklist for the Gombe appraisal in Part 9.

**Practitioners**

| They must be able to say | Today `[Verified]` | Status |
|---|---|---|
| "Getting verified is free and I know what is expected of me." | Wizard, submit-for-approval and officer confirmation exist and cost the practitioner nothing; but credential requirements are seeded for doctors only, and a rejection is shown in the app but not sent | Partly |
| "I see the rate — and any night or holiday premium — before I accept." | The hourly rate is on the offer; premiums sit on a facility rate card practitioners cannot read; cancellation terms and shift notes are not shown | Partly |
| "I am told on my phone when I am offered a shift." | No message is sent for an offer; SMS gateways are not implemented; the practitioner must open the app | Missing |
| "I will be paid, on a day I can see, and I can see any fee." | An earnings screen exists; the fee is taken from the practitioner but never shown to them; there is no payment rail | Diverges from v2.9 |
| "My number and documents are not handed out." | The match list returns names and full phone numbers to any facility user; erasure is an assessment, not a deletion | Missing (P0) |
| "I can use it on an ordinary phone with weak data." | Responsive and installable, but 14-pixel content text, no offline queue, no icons in the install manifest | Partly |
| "If something goes wrong I am treated fairly." | Disputes and excusals exist; neither party is notified; the sanction ladder and appeals in v2.9 do not | Partly |

**Facilities**

| They must be able to say | Today `[Verified]` | Status |
|---|---|---|
| "Only verified people at the right level work on my wards." | Identity, registration, screening and credentials gate matching; no concept of level; only doctors have full credential requirements | Partly |
| "I can fill tonight's gap quickly." | Ranked, explained matching exists; "urgent" changes nothing; the nurse is not messaged; the offer lasts 24 hours | Partly |
| "The fee is fair, visible and cheaper than the alternative." | No fee is shown to a facility; the fee rate is an environment variable; no pricing page | Missing |
| "No-shows are caught and covered." | A sweep flags a no-show only after the shift ends; no early detection or backfill | Partly |
| "Timesheets, invoices and payments agree." | A timesheet shows base pay only while the invoice includes premiums; no tax fields, statements or payment reference | Partly (P0 money fixes) |
| "My team can share the work safely." | Two facility roles; staff must already hold an account; no department or branch scoping | Partly |

**Medilink staff**

| They must be able to say | Today `[Verified]` | Status |
|---|---|---|
| "The evidence is beside the decision." | Officer confirmation reads the practitioner's photograph beside the number and records the access | Built |
| "Every decision is traceable." | Audit trail with a build-failing coverage test | Built |
| "No one person can do everything." | Operations, compliance and finance are merged into one `administrator` role; the same grant raises, marks paid, prepares and releases money | Missing (P0) |

## 1.6 How adoption will be earned — the pilot path

v2.9 §11.1 and the review set out a disciplined route. This document adopts it, with the gates made explicit.

| Stage | What happens | Gate to move on |
|---|---|---|
| **A. Gombe appraisal** | A structured usability study (not a presentation) with facility owners, ward managers, roster and finance staff, nurses, doctors, laboratory staff and pharmacists, and a compliance adviser. Each performs nine tasks; we record success, time, hesitation, misunderstanding, trust and whether the fee felt fair. It also *validates decisions*: the level ladder, what facilities pay agencies today, rate bands, the fee | The level ladder for the first one or two professions is agreed; the fee test results are recorded; the larger-text mode and plain-English fixes are scheduled |
| **B. Closed alpha** | Operations team, two or three Gombe facilities, about thirty practitioners; live SMS; manual identity and registration review; no payment gateway; fee at 0% | All P0 gaps closed; a worker killed mid-event loses nothing; a timed restore meets the target |
| **C. Pilot** | At least fifty verified practitioners across two or three specialties **before** approaching five to ten facilities; the first fifty engagements hand-matched by operations even though the engine produces rankings; support by a staffed phone and WhatsApp line | Sustained fill rate of about 70% or better (published requests that become an attended shift); second-shift return rates for both sides |
| **D. Growth** | A second state, the fee switched on, the two-sided marketplace, payments through the licensed provider | The primary measure — verified, completed, paid, dispute-free engagements per month — is rising and the fee has not reduced repeat bookings |

Do not attempt all professions, all states and all resource types together. Prove that Medilink can repeatedly turn an open shift into a verified, attended and paid engagement in one place. When that loop works reliably, expansion and revenue become much easier.
