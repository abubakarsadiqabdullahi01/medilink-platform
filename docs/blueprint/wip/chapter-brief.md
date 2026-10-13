# Chapter brief — "Medilink System Blueprint v3" (current-system chapters)

You have already studied your slice of the repo and written a fact sheet. Now turn it into **blueprint chapters** that a mixed team (founder, clinical/compliance leads, operations, developers, finance, a lawyer reading over a shoulder) can read. This is Part C ("The system as it is today, module by module") of a document that also contains the strategy and the target design, which the lead is writing. Your chapters must therefore be accurate about the *present* and point forward to the *target*.

## Audience and tone
- Plain English first. A non-developer must understand "why it exists", "how it works" and "what is missing". Put file:line evidence in an Evidence column, not in the prose.
- No hype, no hedging. If you read it in code, say so flatly. If you did not verify it, say "not verified". Never invent a rule, a number or a file.
- The product is a **verified healthcare workforce marketplace** for Nigeria (pilot: Gombe). The people it serves: practitioners (doctors, nurses/midwives, pharmacists, medical laboratory scientists, radiographers), facilities (teaching hospitals, general/private hospitals, PHCs, clinics, laboratories, imaging centres), and Medilink operations/compliance/finance staff.
- Use "they/them" for any person whose pronouns are not stated. Do not name any AI model anywhere.
- Money in naira with kobo in brackets where useful, e.g. ₦5,000 (500,000 kobo).

## Required template — one chapter per module (copy this exactly)

```
### Module <repo number> · <Name>  *(repo folder `src/modules/<x>`; v2.9 Module <n>)*

**Status:** <Built | Partly built | Stub> · **Label:** <CURRENT | CURRENT + IMPROVE | CURRENT + NEW EXPANSION> · **Maturity for a Gombe pilot:** <Ready | Ready after P0 fixes | Not ready> — <one clause why>

**Why it exists.** 2–4 sentences: the real-world need (a Gombe nurse, a PHC ward manager, a compliance officer) and what goes wrong without it.

**Who uses it.** Table: Actor | What they do here | Permission @ scope.

**How it works today.** Numbered steps in plain English, then a compact state table (State → can go to → triggered by) for every status the module owns.

**Rules the system enforces.** Bullets, each one a rule a reviewer could test.

**What is not there yet.** Gap table (see below).

**Recommended change (v3).** What to build/fix and in which order; reference the target design by theme (levels, booking, proposals/negotiation, fee policy, PSP authorise/capture, notifications, privacy, reviews, resource exchange…).

**Acceptance criteria.** 4–8 testable sentences ("Given…, when…, then…").
```

## Gap table format (stable IDs — they are assembled into one register later)
`| ID | Gap | Sev | Source | Evidence |`
- ID: three-letter module prefix + number, e.g. `FAC-01`, `REQ-03`, `MAT-02`, `AVL-01`, `SCH-01`, `ATT-01`, `TIM-01`, `SAN-01`, `DSP-01`, `INC-01`, `SUG-01`, `RAT-01`, `BIL-01`, `PRA-01`, `CRE-01`, `AUT-01`, `AUD-01`, `NOT-01`, `CFG-01`, `PLT-01`, `UX-01`.
- Sev: **P0** = must be fixed before the Gombe pilot (safety, privacy, money correctness, or the pilot cannot run); **P1** = before growth/second state; **P2** = later.
- Source: `V2.9` (spec requirement not met), `REVIEW` (flagged in docs/redesign-recommendations-2026-10-13.md and re-verified by you at HEAD), `NEW` (you found it and the review did not), `V3` (needed by the new two-sided/levels/fee strategy).
- Evidence: `path:line` (one or two). Keep each Gap cell to one or two sentences.
- Include every CONFIRMED gap from your fact sheet. Include "already fixed" items in the prose only, as "the review said X; at HEAD it is fixed" — this prevents the team re-opening closed work.
- Do not silently drop gaps; do not pad with trivia either.

## The target (so your "Recommended change" lines agree with the rest of the document)
Medilink v3 = **a verified healthcare workforce marketplace and settlement platform**, not a job board. Principles:
1. **One Booking.** Every route to work (facility posts a shift; practitioner applies; practitioner publishes a priced availability listing and a facility books it) ends in the same Booking (today's Assignment, extended) carrying `origin` (FACILITY_POSTED | PRACTITIONER_APPLIED | LISTING_BOOKED), agreed level, agreed rate + unit, premium and fee **snapshot**, cancellation rules. One booking function does eligibility re-validation, level re-validation, locks (request row **and** practitioner, fixed order), a database overlap constraint, and an idempotency key.
2. **Levels.** Profession → regulatory registration category → cadre/practice level → specialty → verified competencies → experience band → supervision requirement → active licence. Licence, cadre and mandatory competence are **hard eligibility rules**; distance, experience, rate and preferences only rank. A shift names a required level (exact, or "this level or above"); a cheaper lower cadre cannot be chosen for duties that need a higher regulated capability; supervised/provisional practitioners are never offered unrestricted independent duties. Ladders are reference data owned by compliance, validated with regulators and Gombe clinicians (draft ladders are in the redesign review, Appendix A).
3. **Two-way discovery and negotiation.** Proposals (offer → at most two counter rounds → accept), each side re-checked against rate floors; three money figures per engagement (facility offered, professional requested, final agreed); non-binding recommended range; no open bidding auction. Contact details revealed only inside a window around the booking; approximate location before then; practitioner listings are opt-in with a separate consent.
4. **Fee.** Free to join/verify/publish/match. Pilot at 0% via a dated **fee policy** (not an env var). Then a transparent **facility-paid success fee** (test 3%/5%/fixed; 4–6% range) charged only after an attended, approved shift; the professional receives the full agreed rate; shown plainly on every quote, invoice and statement; stored per line.
5. **Money.** Licensed payment provider (CBN-licensed) with authorise-before-shift and capture/release on timesheet approval, split settlement, refunds, idempotent webhooks, reconciliation. **Medilink never holds client funds.** Pooled/segregated-account collection is not the target and needs counsel's sign-off if used at all.
6. **Trust.** Two-way structured reviews (only parties to a completed booking), reliability measured objectively, appeals, licence-expiry automation, repeat booking and replacement.
7. **Notifications are the nervous system.** SMS (two providers, failover, receipts), WhatsApp, in-app inbox, preferences; West Africa Time; Hausa-assisted onboarding.
8. **Privacy by design (NDPA 2023).** Data minimisation, retention schedule, erasure/export, explainable matching, human review of adverse automated decisions, DPIA, DPO.
9. **Later modules** (not in the pilot): Clinical Resource Exchange, premium services, sponsorship — kept off the shift-booking path.
Priority bands for the roadmap: Phase 0 Make it safe (the P0 gaps) → Phase 1 Gombe pilot (free, fee row 0%, level data model from day one) → Phase 2 Two-sided marketplace → Phase 3 Money you can trust (PSP, fee policy) → Phase 4 Trust & retention → Phase 5 Resource exchange → Phase 6 Premium & sponsorship.

## Hard rules for your output
- Write **only** to the file named in your message (a new file; do not touch the repo). Markdown, GitHub-flavoured tables, no HTML, no images.
- One chapter per module in your slice, in the repo's module order, each following the template. Start the file with a 6–10 line "Slice summary" (what is solid, what is dangerous) — plain English.
- End the file with a "Cross-slice dependencies" list: things other slices must know (e.g. "billing prices from the invoice not the booking").
- Length: roughly 500–900 words of prose per chapter plus its tables. Tables may be long; prose should not.
- Re-verify any claim you are not sure of against the code before writing it. If a fact sheet claim turns out wrong, correct it and note the correction in your final message.
- Final chat reply: under 150 words — the file path, the chapter list, and any correction to your earlier fact sheet.
