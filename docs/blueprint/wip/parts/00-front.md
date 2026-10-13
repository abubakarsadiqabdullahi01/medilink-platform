---
title: "MEDILINK"
subtitle: "System Blueprint v3.0 — what exists, what is missing, what we are building, and how it should flow"
date: "13 October 2026"
---

::: doccontrol
| | |
|---|---|
| **Document** | Medilink System Blueprint, version 3.0 (draft for team review) |
| **Builds on** | System Documentation v2.9 (September 2026) and the redesign review of 13 October 2026 |
| **Evidence base** | The repository at commit `5c199c1` (branch `claude/focused-thompson-q3c4g0`), read module by module; every "current" statement was checked against code and carries a file reference |
| **Audience** | Founders, clinical and compliance leads, operations, finance, developers, and counsel |
| **Status** | Recommendation and specification. No application code was changed to produce it |
| **Pilot** | Gombe State, one or two professions, a small number of facilities |
:::

# How to read this document

This document has one job: to let every member of the team see **the same picture** of Medilink — what we have built, where it falls short of what we promised in v2.9, what we are now adding, and the order in which to do it.

It keeps four things strictly apart, because mixing them is how teams argue about different systems without knowing it.

| Label | Meaning | Where you will see it |
|---|---|---|
| **CURRENT** | Built and working in the repository today | Part 3 |
| **CURRENT + IMPROVE** | Built, but wrong, unsafe or incomplete; the fix is specified | Parts 3 and 5 |
| **NEW EXPANSION** | Not built; part of the v3 target and planned for the pilot or the first growth phases | Parts 6 to 9 |
| **LATER (GATED)** | Valuable but deliberately held back until named conditions are met (legal advice, traffic, trust) | Parts 6 and 9 |

**Evidence marks.** `[Verified]` means read in the code at the commit above; it does not mean observed running, because no application was run to produce this document. `[v2.9]` means the specification promises it. `[Strategy]` means it is a v3 proposal. `[Counsel]` means law, tax or regulation — a qualified adviser must confirm it; this document gives the shape of the issue, not an opinion. `[Unverified]` means a fact we could not confirm (a price, a vendor behaviour, a regulator's rule).

**Priorities.** **P0** — fix before the Gombe pilot (safety, privacy, money correctness, or the pilot cannot run). **P1** — before growth or a second state. **P2** — later. **Effort** — S: days; M: one to three weeks; L: a month or more (rough, one developer).

**Gap identifiers** such as `MAT-02` or `BIL-07` are stable. They appear in the module chapters (Part 3) and are collected into one register in Part 5, so a ticket, a test and a decision can all point to the same number.

# The one-page brief

**What Medilink is.** A verified healthcare workforce marketplace and settlement platform for Nigeria, beginning in Gombe. Facilities obtain the right verified professional at the right level, place, time and price. Professionals find suitable work, control their availability and are paid reliably. Medilink earns only when it creates measurable value — a shift that was filled, attended, approved and paid.

**Where we stand.** Seventeen of the eighteen v2.9 Priority-0 modules are built (scheduling is a deliberate stub), behind three consoles — practitioner, facility and operations — with about 1,050 automated test cases. The foundations are better than most pilots: a permission-and-scope guard on every route, an audit trail with a coverage test, a transactional outbox, integer-kobo money with a balanced double-entry ledger, and a pure, explainable matching engine.

**The study found {{GAP_TOTAL}} specific gaps** — {{P0_COUNT}} of them P0 — which fall into three groups:

1. **Safety and privacy gaps that must close before real people use it.** For example: a facility owner can revoke another hospital's access grants with one identifier; the candidate list returns every practitioner's name and phone number to any facility user; dispute evidence can be fetched without being a party; a confirmed shift can be overbooked; a lapsed licence can still be confirmed; and nothing tells a practitioner they have been offered a shift.
2. **Money does not yet work the way v2.9 says it must.** The code charges the platform fee to the *practitioner* and books it when an invoice is *drafted*, where v2.9 says the *facility* bears it and it is earned at *settlement*. Practitioners are credited before the facility has paid, which is the credit risk v2.9 explicitly rejected. There is no payment gateway, no bank-account model, no tax fields, and a billing bug that under-charges night shifts that overlap a public holiday.
3. **The product is one-way and silent.** There is no concept of professional level or cadre anywhere in the data. Practitioners cannot browse shifts, publish a priced availability, or be booked directly. Seventeen of the twenty domain events have no consumer, so the system raises events that nobody hears.

**What we are building (v3).** Nine moves, each specified in Part 6: (1) a correct professional hierarchy; (2) one Booking that every route to work ends in; (3) two-way discovery, so facilities and professionals can each start an engagement; (4) transparent rate negotiation; (5) a facility-paid success fee, free until proven; (6) payments through a licensed provider that holds the money, not Medilink; (7) trust as the product — verification, reliability, two-way reviews; (8) privacy by design; (9) later, a Clinical Resource Exchange and premium services, kept off the shift path.

**The order that protects the business.** Make it safe → run a free Gombe pilot → build the two-sided marketplace → make money trustworthy → switch the fee on → trust and retention → resources and premium. A fee charged on a system that leaks phone numbers or pays people before it is paid teaches users to leave.

**The one measure that decides.** The number of **verified, completed, paid and dispute-free engagements per month.** Registrations alone are not success.

**Decisions we need from the team** (full list in Part 9): who pays the fee and at what pilot rate; who holds the money during the pilot; the level ladder for the first one or two professions; what Gombe facilities without a CAC number can show instead; WhatsApp or SMS as the primary channel; whether Hausa-assisted onboarding is in the pilot; and when to engage counsel for the agreement text, tax treatment and data-protection registration.
