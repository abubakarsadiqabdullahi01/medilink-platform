# Part C (supply side) — Practitioners and Credentials

Evidence paths: inside a chapter, a path that does not start with `src/`, `prisma/`, `docs/` or another module's name is relative to that chapter's module folder (`src/modules/practitioners/` in Module 2, `src/modules/credentials/` in Module 3).

Source: code at HEAD `5c199c1` of `/home/user/medilink-platform`, read by hand. Nothing was run. Clinical incidents (Module 15) is written by another author; this file only describes how its suspension reaches Module 2.

## Slice summary

- **What is solid.** Whether a practitioner may be offered work is decided by one pure, well-tested function that returns every reason at once, not the first. Identity is stored as a keyed hash plus the last four digits, never the NIN itself. An officer confirms a NIN or licence from the practitioner's own photograph in one click, and the number is never retyped. A practitioner cannot review their own documents. Every state change writes an audit row.
- **What is dangerous.**
  - Only doctors have document requirements. Nurses, pharmacists, laboratory scientists and radiographers are checked by identity, a regulator registration and screening only.
  - A doctor who renews an expired licence stays blocked (a bug found in this study, in none of the earlier reviews).
  - The sanctions list ships empty, so screening says "clear" for everyone.
  - Nobody is texted about a decision or an expiry.
  - The raw NIN sits in clear text in the database until an officer confirms it.
  - The platform has no idea of level, cadre, registration category, supervision or competence. A house officer and a consultant are the same person to it.
- **What facilities see.** Nothing about verification. The only trust signal a facility gets is that a person was ranked at all.
- **Where eligibility is checked.** At match time only. Invitations and confirmations do not re-check it (fix lives in Module 7).
- **Providers.** NIMC (identity) and the regulator register check are switched off, and every non-off setting throws. Manual officer review is the only live path, which suits a pilot of about fifty practitioners.
- **Order of work.** Fix the renewal bug, seed requirements for the other four professions, load the sanctions lists, mask the NIN, and add outbound notices (Phase 0). Build the level, registration-category and supervision model before any pilot data exists (Phase 1).

---

### Module 2 · Practitioners  *(repo folder `src/modules/practitioners`; v2.9 Module 2)*

**Status:** Partly built · **Label:** CURRENT + NEW EXPANSION · **Maturity for a Gombe pilot:** Ready after P0 fixes — the doctor path works end to end, but the renewal bug, the empty sanctions list and the missing level and supervision model must be fixed before pilot data exists.

**Why it exists.** A nurse in Gombe wants to be trusted without phoning around; a ward manager wants to staff a night shift without checking a stranger's papers. This module holds who the practitioner says they are, what a Medilink officer has checked, and the single rule that says "safe to offer work". Without it, anyone could be matched to a shift, including a struck-off or unlicensed person.

**Who uses it.**

| Actor | What they do here | Permission @ scope |
|---|---|---|
| Practitioner | Create and edit their profile, upload a photo, submit for review, read their own eligibility and verification | `practitioner.profile.read` / `practitioner.profile.write` @ SELF (`src/lib/authz/permissions.ts:116-122`) |
| Administrator (compliance and operations merged) | Work the "waiting for approval" queue, record identity and registration, clear a sanctions flag, read anyone's eligibility | `practitioner.profile.read` and `credential.review` @ PLATFORM (`src/lib/authz/permissions.ts:172-183`) |
| Facility staff | Nothing here. They see a ranked name and score through Matching | none held (`src/lib/authz/permissions.ts:140-147`) |
| Worker (system) | Grants the practitioner role, screens names, runs the nightly sweeps | system |
| Incident officer (Module 15) | Suspends or reinstates the account; this module's rule reads that status | `incident.manage` @ PLATFORM |

**How it works today.**

1. **Sign-up.** The practitioner registers by phone, verifies a code and sets a password. The account becomes `UNDER_REVIEW` and an event `practitioner.registered` is published (`auth/application/registration.ts:193-232`). The worker then grants the `practitioner` role at SELF scope and screens the name against the sanctions lists (`worker/handlers.ts:42-51`, `practitioners/application/role-grants.ts:19-63`).
2. **Profile.** A four-step wizard on `/practitioner/profile`: details, availability, documents, review. Details are profession (one of five), one optional specialty, years of experience, bio, home state and LGA, how far they will travel (own LGA, own state, anywhere), and an optional photo.
3. **Submit for approval.** The server refuses until there is a profile, at least one availability slot and a live submission for every document the profession requires. A document still waiting for review counts as supplied; a rejected one does not. Pressing submit twice changes nothing (`application/application-review.ts:27-96`).
4. **Officer queue.** `/admin/practitioners` opens on "Waiting for approval", longest-waiting first (`application/directory.ts:78-81,111-114`).
5. **Confirming evidence.** For a NIN the officer reads the slip photo and says whether the name matches the account; for a licence the officer says what it shows and optionally the printed expiry date. One click records the identity or registration and decides the submission (`application/confirm-from-submission.ts:73-175`). A name mismatch is recorded as a fact and the practitioner is asked to correct it; a licence that is not active is recorded as it is and the submission rejected with the reason. A "Record by hand" form exists for people who have submitted nothing.
6. **Eligible.** The rule runs live whenever it is asked. The practitioner sees "Can be offered shifts" the moment it returns no blockers. A daily sweep later flips the account label from `UNDER_REVIEW` to `ACTIVE`; the label changes nothing, because the rule accepts both.
7. **Ongoing.** A nightly sweep re-screens everyone with a profile; two more expire licences and credentials; regulator evidence goes stale 365 days after the officer recorded it.
8. **Suspension (Module 15).** Closing an incident with the outcome "practitioner suspended" sets the account to `SUSPENDED` in the same transaction (`clinical-incidents/application/suspension.ts:80-125`). The rule's first blocker then fires, matching drops them at once, and they cannot sign in (`auth/application/session-service.ts:92`). Reinstating sets the account to `ACTIVE` (`clinical-incidents/application/suspension.ts:174`).

State tables. The application state is derived, not stored; the only stored fact is the "submitted for review" time (`prisma/schema.prisma:484`).

| Application state | Can go to | Triggered by |
|---|---|---|
| DRAFT | READY | Profile, one availability slot and every required document are in (`domain/application-review.ts:40-49`) |
| READY | WAITING | Practitioner presses submit |
| WAITING | APPROVED | The rule returns no blockers (officer confirmations plus clear screening) |
| WAITING | CHANGES_NEEDED (screen only) | Officer rejects a **required** document; this clears the submitted time (`application-review.ts:117-150`) |
| CHANGES_NEEDED | WAITING | Replacement document live and the practitioner submits again |
| APPROVED | WAITING | A blocker reappears (expiry, stale evidence, suspension); the label drops because it is derived (`src/lib/ui/practitioner.ts:186-194`) |

| Registration status | Can go to | Triggered by |
|---|---|---|
| ACTIVE, SUSPENDED, EXPIRED, STRUCK_OFF, UNKNOWN | any of the others | Officer records or re-records it (no transition guard, `application/verification.ts:272-307`) |
| ACTIVE | EXPIRED | Daily sweep when the recorded expiry date has passed (`application/expiry.ts:22-35`) |

| Screening result | Can go to | Triggered by |
|---|---|---|
| (none) | CLEAR or FLAGGED | First screen at registration |
| CLEAR | FLAGGED | Nightly sweep finds a new match (`application/screening.ts:173-192`) |
| FLAGGED | CLEAR | Officer clears it with a reason of 20 or more characters, or the sweep no longer finds a match |
| (PENDING) | — | The value exists but no code ever writes it; a missing row is treated as "not clear" |

| Account status | Can go to | Triggered by |
|---|---|---|
| PENDING_VERIFICATION | UNDER_REVIEW | Password set (`auth/application/registration.ts:193`) |
| UNDER_REVIEW | ACTIVE | Daily activation sweep when eligible (`application/eligibility.ts:242-268`) |
| UNDER_REVIEW, ACTIVE | SUSPENDED | Incident closure (Module 15) |
| SUSPENDED | ACTIVE | Reinstatement with a written reason (Module 15) |
| DEACTIVATED | — | Set by no code path |

Identity has no status. There is one row per person: a hash, the last four digits, a "name matches" flag, who recorded it and when.

**Rules the system enforces.**

- One profile per account; a second create is refused (409). A category must be active; a specialty must be active and belong to the chosen category; the home LGA must sit in the home state (`application/profile.ts:65-100`).
- Years of experience 0–60; bio at most 1,000 characters (`domain/profile.ts:7-9`).
- A practitioner cannot record their own identity or registration. Those routes are PLATFORM-only, and an officer cannot review their own submission (`application/confirm-from-submission.ts:65`).
- A NIN is exactly 11 digits. It is stored only as a keyed hash plus the last four digits, is unique across accounts, and never appears in the audit trail (`domain/verification.ts:11-45`; `schema.prisma:675`).
- A folio number is stripped of spaces and upper-cased, and is unique across the whole platform. A practitioner holds at most one registration per regulator (`schema.prisma:710,726`).
- The officer must say whether the name matched and what the register showed; there is no default in the confirm path. `UNKNOWN` is not "active" (`domain/verification.ts:94-102`).
- Regulator evidence older than 365 days is stale; the boundary is inclusive (`domain/verification.ts:69-77`).
- Screening names ignore titles and word order, so "Amina Yusuf" equals "Yusuf Amina". A folio match is reported ahead of a name match. An officer's clearance covers one list entry only; a different entry flags again (`domain/screening.ts:38-48,77-99`; `application/screening.ts:93-98`).
- Someone who withdrew consent to be shown to facilities is left out of match candidates entirely (`application/candidates.ts:65-75`).
- Suspension takes effect immediately everywhere, with no sweep, because `SUSPENDED` is a blocker.

**The eligibility rule, in plain English.** One function, `eligibilityBlockers`, returns every reason at once (`src/modules/practitioners/domain/eligibility.ts:52-100`). A person is eligible when the list is empty. The 5,000-profile property test asserts that nobody missing identity, an active registration or a clear screening can ever pass (`domain/eligibility.test.ts:239`).

| # | Blocker | What it means | Who can clear it | Evidence |
|---|---|---|---|---|
| 1 | `account_not_usable` | The account is still being set up, suspended or closed. `UNDER_REVIEW` and `ACTIVE` both pass. | Finish sign-up; or the incident officer reinstates | `domain/eligibility.ts:60-62` |
| 2 | `profile_incomplete` | No profile exists. | Practitioner | `:64` |
| 3 | `identity_unverified` | No officer has recorded the NIN against this person. | Officer | `:66-67` |
| 4 | `identity_name_mismatch` | The officer recorded that the name on the NIN slip does not match the account name. | Practitioner corrects and resubmits; officer re-records | `:68-71` |
| 5 | `registration_missing` | No registration on record with the regulator for the person's profession. The regulator is taken from the profession, and the text must match exactly. | Officer | `:74-75`; `application/eligibility.ts:111,149-153` |
| 6 | `registration_not_active` | The registration is suspended, expired, struck off or unknown, or its recorded expiry date has passed. | Officer, after the practitioner renews | `:77`; `domain/verification.ts:94-102` |
| 7 | `registration_evidence_stale` | The register check on file is 365 days old or more, counted from the day the officer recorded it. | Officer re-checks | `:78-84` |
| 8 | `credential_expired` | A document the profession requires has expired. See PRA-08: this blocker does not clear after renewal. | Practitioner renews, once PRA-08 is fixed | `:90-91` |
| 9 | `credential_missing` | A required document is not verified: not sent, waiting, queried or rejected. | Practitioner and officer | `:93-94` |
| 10 | `screening_not_clear` | No screening result, or the name or folio matches a sanctions or "quack" list entry that an officer has not cleared. | Officer | `:97-98`; `domain/screening.ts:112-113` |

Not in the rule: availability and consent (applied separately), indemnity cover, level or cadre, scope of practice, and incident history other than an actual suspension. The rule is read at match time (`application/candidates.ts:65-83`), at the practitioner's own screens and by officers. It is not read at invitation, acceptance or confirmation.

**The review said X; at HEAD it is partly fixed.** The review said the licence's printed expiry is not captured. At HEAD the officer can enter it on the registration (optional) and the rule enforces it live (`admin/practitioners/evidence-review.tsx:489-500`). The review said practitioners are not told of a rejection. At HEAD a refused required document shows a red "your application was sent back" card with the reviewer's note when they open the app (`app/practitioner/profile/returned-notice.tsx`); no message is sent.

**What is not there yet.**

| ID | Gap | Sev | Source | Evidence |
|---|---|---|---|---|
| PRA-01 | No level, cadre or grade anywhere: not on the profile, the shift request, the rate floor or the matching engine. A house officer and a consultant are the same to the platform. | P0 | REVIEW | `prisma/schema.prisma:466-497`; `matching/domain/engine.ts:135-146` |
| PRA-02 | No structured registration category (provisional, full, intern, post-basic register) and no supervision requirement. The only candidate field is a free-text `practice_type`, settable only through the API and read by nothing. | P0 | V3 | `schema.prisma:711`; `application/verification.ts:248` |
| PRA-03 | One optional specialty; no skill or competency set, no subspecialty. A request that names a specialty excludes anyone whose single specialty differs, including people who have none. Specialties are seeded for doctors (12) and nurses (3) only. | P1 | REVIEW | `schema.prisma:470`; `matching/domain/engine.ts:143-146`; `prisma/seed.ts:67-74` |
| PRA-04 | Experience is a self-declared whole number (0–60) with no evidence and no "practising since" date. Matching caps it at 10 years for scoring. | P1 | REVIEW | `domain/profile.ts:7-8`; `matching/domain/engine.ts:46,174-175` |
| PRA-05 | A folio number is unique across **all** regulators, so a doctor and a nurse with the same digits collide. It should be unique per regulator and folio. | P1 | REVIEW | `schema.prisma:710` |
| PRA-06 | The regulator on a manually recorded registration is free text (2–20 characters) and must equal the profession's regulator string exactly. A typo or different case silently leaves the practitioner blocked at `registration_missing`. The confirm path avoids this by taking the regulator from the profession. | P1 | REVIEW | `presentation/schemas.ts:97`; `application/eligibility.ts:120-121,152` |
| PRA-07 | Changing category, specialty, years or home area after approval does not return the application for review. A category change breaks eligibility only by accident (no registration for the new regulator). | P1 | REVIEW | `application/profile.ts:235-290`; `tests/integration/application-review.test.ts:266` |
| PRA-08 | **Renewing an expired credential never clears `credential_expired`.** The old EXPIRED row stays, and the rule flags any expired required type even when a newer VERIFIED row exists. Every doctor whose first licence credential lapses stays blocked after renewing. Found by reading; no test covers it. | P0 | NEW | `domain/eligibility.ts:90-91`; `application/eligibility.ts:85-88,164-170` |
| PRA-09 | A credential's lapse is enforced only after the daily sweep marks it EXPIRED, up to a day late. The loader never reads the credential's expiry date. The code comments and stage docs say the opposite; that is true only for registrations. | P1 | NEW | `application/eligibility.ts:85-88`; `credentials/application/expiry.ts:15-21` |
| PRA-10 | The raw NIN sits in clear in `credential_submissions.reference_number` from submission until an officer confirms. It is masked only on the confirmed path, so a rejected, queried or mismatched submission keeps it whole. | P0 | NEW | `application/confirm-from-submission.ts:96-118`; `credentials/application/submission.ts:548-576` |
| PRA-11 | The NIN hash is keyed with `SESSION_SECRET`, with no key version. Rotating that secret silently breaks duplicate-NIN detection for every stored row. | P1 | NEW | `application/verification.ts:110`; `schema.prisma:663-671` |
| PRA-12 | A "name does not match" record still reserves the NIN hash (it is unique). A later confirmation of the real owner would be refused as a duplicate, with no release path. Read from code; no test. | P1 | NEW | `application/verification.ts:110-136,153-159` |
| PRA-13 | Identity assurance is name-only and officer-asserted: no date of birth, no photo comparison, no regulator-record name captured. The NIN is typed by the practitioner as free text and read by an officer from a photograph. | P1 | V2.9 | `application/verification.ts:79-108`; `app/practitioner/profile/evidence-fields.tsx:156-164` |
| PRA-14 | The sanctions and "quack" lists ship empty, and no route or screen can add to them. Screening therefore reports "clear" for everyone until compliance inserts rows by SQL. No feed from any list exists. | P0 | REVIEW | `prisma/seed.ts:165-178`; `docs/stage-5-6-screening.md` |
| PRA-15 | Recording a registration does not trigger screening, so a listed folio is first checked at the next nightly sweep. List entries' folio numbers are compared as stored, while the practitioner's are normalised. | P1 | NEW | `application/verification.ts` (no screening call); `domain/screening.ts:81-87` |
| PRA-16 | Facilities see no verification information: no MDCN status and date, licence expiry, NIN yes/no, evidence tier or regulator. Nothing marks a claim as verified, evidenced or stated. | P1 | V2.9 | `src/lib/authz/permissions.ts:140-147`; `matching/application/match.ts:161-179` |
| PRA-17 | No structured qualifications (degree, institution, year, housemanship, fellowships) and no employment history. There is only a 1,000-character bio. | P1 | V2.9 | `schema.prisma:473`; `domain/profile.ts:9` |
| PRA-18 | No languages spoken. | P1 | V2.9 | `schema.prisma:466-497` |
| PRA-19 | Indemnity cover is an optional document with no provider, policy number or real expiry, no renewal reminder, and the rule does not read it. | P1 | V2.9 | `prisma/seed.ts:106`; `domain/eligibility.ts:52-100` |
| PRA-20 | A duplicate NIN or folio is refused only when an officer records it, not when the second person submits it. There is no duplicate-account review queue. | P1 | V2.9 | `application/verification.ts:153-159,311-314` |
| PRA-21 | No bank-account reuse check, because the schema has no bank-account model. | P1 | V2.9 | `schema.prisma:1939-1964` |
| PRA-22 | No account recovery through a compliance officer; recovery is by phone code only. | P1 | V2.9 | `auth/application/recovery.ts:1-12` |
| PRA-23 | "Held, not refused" when there is no NIN is half built: the person waits at `identity_unverified`, but no officer path decides on other evidence, because a NIN is required to create the identity row. | P1 | V2.9 | `presentation/schemas.ts:75-91`; `schema.prisma:675` |
| PRA-24 | The "platform record" (shifts completed, facilities worked, reliability and the number it is based on) exists only inside a match run, not on the profile. | P2 | V2.9 | `matching/domain/engine.ts:209-218` |
| PRA-25 | Five of the eight spec categories are seeded (no dentist, physiotherapist or community health practitioner). Categories, specialties and requirements change only by seed and deploy. | P1 | V2.9 | `prisma/seed.ts:36-42` |
| PRA-26 | Eligibility is not re-checked when a practitioner is invited, accepts, or is confirmed. The only consumers are the match run, the practitioner's own screens and the eligibility route. Fix lives in Module 7. | P0 | REVIEW | `application/candidates.ts:65-83` |
| PRA-27 | No second approver and no step-up on identity or registration confirmation, clearing a sanctions flag, or reinstatement. The only control is that nobody reviews their own submission. | P1 | NEW | `src/lib/authz/permissions.ts:77-83`; `credentials/application/submission.ts:357` |
| PRA-28 | The annual licence number the practitioner types is stored, made unique and sanction-matched as the "folio number". Whether those are the same identifier on the regulator's register is not verified. | P1 | NEW | `app/practitioner/profile/evidence-fields.tsx:60-72`; `confirm-from-submission.ts:146-150` |
| PRA-29 | The "Record by hand" form pre-selects "name matches" and "ACTIVE", against the stated rule that there is no default. | P2 | NEW | `app/admin/practitioners/page.tsx:196,200` |
| PRA-30 | A practitioner whose own credential expired, or who changed category, still reads "Waiting for approval" and sits in the officer's waiting queue. Only a rejection returns the application. | P2 | NEW | `src/lib/ui/practitioner.ts:186-194`; `application/directory.ts:78-81` |
| PRA-31 | The `ACTIVE` label is cosmetic and a day late; `DEACTIVATED` is set by no code; the `PENDING` screening value is never written. | P2 | NEW | `domain/eligibility.ts:60`; `worker/jobs.ts:51-54` |
| PRA-32 | A registration is overwritten in place when re-recorded; only the audit trail keeps what it used to say. v2.9 asks for evidence to be preserved when a source changes. | P2 | V2.9 | `application/verification.ts:289-304` |

**Recommended change (v3).**

*Phase 0, make it safe.* Fix PRA-08 first: the rule must use the **latest decided submission per credential type**, and read the credential's own expiry date live (PRA-09). Load the real sanctions lists and give compliance a screen to maintain them (PRA-14); run screening when a registration is recorded (PRA-15). Stop holding the NIN in clear (PRA-10): keep it only as the keyed hash and last four, and let an officer read it from the photograph. Validate the regulator against the profession and make the folio unique per regulator (PRA-05, PRA-06). Re-check eligibility inside the one booking function that Module 7 will own (PRA-26): invitations, acceptances and confirmations all go through it.

*Phase 1, Gombe pilot.* Put the level model in **before any pilot data exists**, because retrofitting it into live shifts, rates and invoices is the most expensive change in the programme (PRA-01, PRA-02, PRA-03). The profile carries a *claimed* level and a *verified* level; an officer verifies against evidence. Changing level, category or specialty after approval returns the application for review (PRA-07). Replace "years of experience" with a "practising since" date drawn from registration evidence (PRA-04). The next section describes the shape.

*Phase 2, two-sided marketplace.* Facilities see a verification panel with the date each check was done, the regulator, the expiry and the evidence tier, and every profile claim is marked verified, evidenced or stated (PRA-16). Add qualifications, employment history, languages and structured indemnity (PRA-17 to PRA-19). Practitioner listings stay opt-in under a separate consent.

*Phase 3 and 4.* Bank-account reuse check using the payment provider's account-name answer (PRA-21); duplicate-account review queue and officer-assisted recovery (PRA-20, PRA-22); notices through the Notifications module when a suspension, flag or expiry changes someone's standing.

**Acceptance criteria.**

1. Given a doctor whose licence credential was verified, expired and then replaced by a newer verified one, when eligibility is read, then no `credential_expired` blocker appears and the old row is shown as superseded.
2. Given a verified credential whose expiry date was yesterday and whose sweep has not run, when a match run starts, then that practitioner is excluded for `credential_expired`.
3. Given a practitioner approved at one cadre, when they claim a higher one, then the application returns to review and they are not matched at the higher level until an officer verifies it.
4. Given a registration recorded with a regulator that is not the profession's regulator, when the officer saves, then the request is refused with a plain message.
5. Given the same folio digits under two different regulators, then both are accepted; given the same folio twice under one regulator, then the second is refused.
6. Given a name added to the sanctions list, when an officer records a registration carrying a listed folio, then the practitioner is flagged within the same request and drops out of the next match run.
7. Given a NIN submission that an officer rejected, when the database row is read, then the NIN is not present in clear.
8. Given a practitioner whose registration category requires supervision, when a facility posts a shift that needs independent practice, then they are excluded with the reason `supervision_required`.

---

#### Professional hierarchy: what the data model must become

Today a profile says "Nurse / Midwife", one optional specialty and a number of years. That cannot tell an intern from a consultant, a provisional registrant from a fully registered one, or a general nurse from a midwife who also holds a theatre post-basic register. The target is a chain in which licence, cadre and mandatory competence are **hard rules** and distance, experience, rate and preference only rank:

profession → regulator → registration category → cadre rung → specialty set → verified competencies → experience band → supervision requirement → active licence.

Every regulatory statement in the table below is a **working assumption [Counsel/Regulator to confirm]**. The rungs are Medilink's own platform rungs, drawn from Appendix A of `docs/redesign-recommendations-2026-10-13.md`; they are not official titles and have not been validated with any regulator or Gombe panel. Where a source is noted, it is the coordinator's note to this study, not something this study checked.

| Profession | Regulator | What the code seeds today | Registration categories to model | Draft cadre rungs (low → high) | Supervision rule | Evidence that proves it |
|---|---|---|---|---|---|---|
| Doctor | MDCN (`prisma/seed.ts:37`) | Category `doctor`; 12 specialties; credential types MDCN licence, NIN slip, MBBS; three requirements; no cadre, no registration category | Provisional registration versus full registration (user-supplied; unverified) [Counsel/Regulator to confirm]; practice type medical, dental or alternative, as the v2.9 spec describes MDCN's status form [not verified against MDCN]; specialist or fellowship status | House Officer · Medical Officer · Senior Medical Officer · Registrar · Senior Registrar · Consultant | Provisionally registered doctors and House Officers always supervised and never offered unrestricted independent duties; Registrars work under a named consultant [Counsel/Regulator to confirm] | Register entry showing registration type and date; practising licence for the year; MBBS certificate; fellowship or specialist certificate for the top three rungs; evidence of completed housemanship [Counsel/Regulator to confirm] |
| Nurse / Midwife | NMCN (`seed.ts:38`) | Category `nurse`; three specialties (general nursing, perioperative nursing, midwifery); **no** credential types or requirements | NMCN's own site lists basic General Nursing and Basic Midwifery registration plus 17 post-basic programmes across 19 registers (coordinator's note: verified against NMCN's site; not re-checked here). Model each register as a separate registration category; one person can hold several [Counsel/Regulator to confirm] | Staff Nurse/Midwife · Nursing Officer · Senior Nursing Officer · Principal Nursing Officer and above | Newly qualified nurses under supervised practice; midwifery duties require the midwifery register; specialist units (theatre, intensive care) tied to the matching post-basic register [Counsel/Regulator to confirm] | NMCN register entry and licence; certificate for each register held; post-basic certificate; grade letter from the employer |
| Pharmacist | PCN (`seed.ts:39`) | Category `pharmacist`; no specialties; **no** credential types or requirements | Pharmacist versus pharmacy technician (user-supplied; unverified); intern or provisional status [Counsel/Regulator to confirm]. Premises registration belongs to the facility | Intern · Pharmacist · Senior Pharmacist · Principal and above | Interns supervised by a registered pharmacist; technicians work under a pharmacist [Counsel/Regulator to confirm] | PCN register entry and licence; internship completion; degree certificate |
| Medical laboratory scientist | MLSCN (`seed.ts:40`) | Category `lab_scientist`; no specialties; **no** credential types or requirements | Scientists, technicians and assistants (secondary source; unverified); intern status [Counsel/Regulator to confirm] | Intern · Scientist · Senior Scientist · Principal and above | Interns, technicians and assistants work under a registered scientist [Counsel/Regulator to confirm] | MLSCN register entry and licence; internship completion; qualification certificate |
| Radiographer | RRBN (`seed.ts:41`) | Category `radiographer`; no specialties; **no** credential types or requirements | Not known to this study; the regulator's own categories must be obtained. Treat as open [Counsel/Regulator to confirm] | Intern · Radiographer · Senior · Principal and above | Interns supervised; duties around imaging equipment follow the regulator's and the facility's equipment licences [Counsel/Regulator to confirm] | RRBN register entry and licence; internship completion; qualification certificate |
| Dentist, physiotherapist, community health practitioner (listed in v2.9, not seeded) | Regulators not stated in the spec and not verified here [Counsel/Regulator to confirm] | Nothing | To be defined with each regulator | Not drafted | Not drafted | To be defined |

What the model must hold, as new or changed entities (names are proposals):

| Entity | Purpose |
|---|---|
| `regulators` and `registration_categories` | Reference data owned by compliance: regulator, category, whether independent practice is allowed, whether supervision is required, order. Replaces the free-text `regulator` and `practice_type` strings. |
| `cadres` | Ordered rungs per profession, each mapped to the registration categories that can hold it. |
| Registration (extended) | Registration category, date first registered, expiry as printed, evidence tier, source reference; unique on regulator plus folio. |
| Claimed and verified level | Two fields on the profile plus who verified, when, and which evidence document proved it. |
| `competencies` and practitioner competencies | Declared by category, never free text; each claim marked verified, evidenced or stated; a shift can require one. |
| Specialty **set** with one primary | Replaces the single `specialtyId`. |
| Qualifications, employment history, languages, indemnity policy | The v2.9 profile content, each with its supporting document. |

Rules the hierarchy must enforce, all as **hard eligibility rules** with a named exclusion reason: the person must hold an active registration whose category allows the work; their verified rung must meet the shift's required level (exact, or "this level or above"); a required competence must be verified; a supervised or provisional practitioner is never offered unrestricted independent duties; and a cheaper lower cadre cannot fill a post that needs a higher regulated capability.

---

### Module 3 · Credentials  *(repo folder `src/modules/credentials`; v2.9 Module 3)*

**Status:** Partly built · **Label:** CURRENT + IMPROVE · **Maturity for a Gombe pilot:** Ready after P0 fixes — the review queue and one-click confirmation work, but only doctors have required documents and nobody is told of a decision or an expiry.

**Why it exists.** A licence number proves a licence exists; a photograph and a reviewer prove that someone looked. This module is where a practitioner sends the evidence (a licence, a NIN slip, a degree, an indemnity certificate) and an officer decides. Without it, "verified" would be a claim, and a facility would be trusting a stranger's word about a theatre list.

**Who uses it.**

| Actor | What they do here | Permission @ scope |
|---|---|---|
| Practitioner | Submit evidence, answer a request for more, read their own submissions and documents | `credential.submit`, `credential.document.read` @ SELF (`src/lib/authz/permissions.ts:116-122`) |
| Administrator | Read the queue, open documents, approve, reject, ask for more, confirm a NIN or licence | `credential.review`, `credential.document.read` @ PLATFORM (`src/lib/authz/permissions.ts:172-183`) |
| Worker (system) | Daily expiry sweep | system |
| Facility staff | Nothing; they hold none of these keys | none |

**How it works today.**

1. **Types and requirements.** Six credential types are seeded: MDCN annual practising licence (issuer MDCN, expires, 365 days, checked by number), NIN slip (NIMC, no expiry, checked by number), MBBS certificate (document review), NYSC certificate, certificate of good standing (MDCN, expires 365 days) and professional indemnity cover (expires 365 days), the last three document review and optional. A separate table says which are **required** for which profession. Only doctors have rows: licence, NIN slip and MBBS (`prisma/seed.ts:99-107,127-149`).
2. **Submitting.** A type checked by number needs a number; every other type needs a document. The form asks for a photograph beside the number while no provider is switched on. Files go straight to storage by signed link, up to 10 MB, PDF or common image types (`lib/storage/tigris.ts:61-69`). A second live submission of the same type is refused (`credentials/application/submission.ts:187-198`).
3. **Deciding.** An officer approves, rejects or asks for more. Reject and ask-for-more need a written reason. Asking for more lets the practitioner reply on the **same** row, which returns it to waiting.
4. **Number-checked types go through "confirm".** A plain approve of a NIN or licence is refused (`confirm_through_practitioner`), because a bare approval would leave the practitioner blocked on a record nobody made. Confirming records the identity or registration, approves the submission and, for a NIN, masks the stored number to its last four digits. It is three separate commits, retry-safe but not atomic (`application/confirm-from-submission.ts:83-118`).
5. **Expiry.** On approval the system sets the expiry as the **review date plus the type's review days**, for types that expire. A daily sweep moves verified rows past their date to EXPIRED and publishes `credential.expired`. It does not suspend anyone, deliberately, so the practitioner can still sign in and upload a renewal (`credentials/application/expiry.ts:15-70`).
6. **Telling the practitioner.** The practitioner sees the status and the reviewer's note on their credentials tab; a refused required document also shows a banner. Nothing is sent by SMS.
7. **Providers.** Automated NIN and register checks are behind two switches that are off by default. Turning either on makes the call throw, because no adapter has been written. See the providers table below.

| Submission status | Can go to | Triggered by |
|---|---|---|
| (new) | PENDING | Practitioner submits |
| PENDING | VERIFIED | Officer approves (expiry set if the type expires; `credential.verified` published) |
| PENDING | REJECTED | Officer rejects with a reason; a required type also sends the application back; nothing published |
| PENDING | MORE_INFO_REQUESTED | Officer asks for more with a reason; nothing published |
| MORE_INFO_REQUESTED | PENDING | Practitioner replies (only from this status) |
| VERIFIED | EXPIRED | Daily sweep once the expiry date has passed (`credential.expired` published) |
| REJECTED, EXPIRED | — | Terminal. A new submission may be made, but the old row stays |

No status is reachable from VERIFIED except EXPIRED. There is no revoke, withdraw or supersede (`submission.ts:358`).

| Provider | Switch | Default | What happens if turned on |
|---|---|---|---|
| NIMC identity check | `NIN_VERIFICATION_PROVIDER` = none, sandbox, live | none | Throws `VerificationNotConfiguredError`; no adapter exists, and `sandbox` is treated like `live` (`lib/verification/index.ts:99-133`) |
| Regulator register check | `MDCN_VERIFICATION_PROVIDER` | none | Same. One switch serves every regulator; there is no NMCN, PCN, MLSCN or RRBN path (`index.ts:139-149`) |

With both off, an officer enters the result. Switching a provider on later is meant to change only who answers the officer's two questions, not the endpoints or schema. Not verified: whether that holds against a real provider's contract.

**Rules the system enforces.**

- One live submission per credential type (pending, queried or verified). A rejected or expired one does not block a new submission.
- Number-checked types need a number; every other type needs a document. The API requires only "a number or a document"; the photograph is a form rule.
- A document must have finished uploading and belong to the submitter, or the submission is refused (`submission.ts:120-135`).
- Reject and request-more need a reason of any length up to 1,000 characters (`presentation/schemas.ts:76-87`).
- Only a waiting submission can be decided. Only a queried one can be answered. A reviewer cannot decide their own submission (`submission.ts:357-358`).
- Number-checked types are approved only through the confirm route.
- The NIN never appears in an audit row, only its last four digits; a stored NIN is reduced to its tail after a successful confirmation (`submission.ts:79-82,548-576`).
- A practitioner can only see their own submissions and documents; another person's is a 404, not a 403. Every officer document view writes a security event (`submission.ts:643-676`).
- Only verified-and-unexpired rows count towards eligibility, and only for the types the profession requires.

**What is not there yet.**

| ID | Gap | Sev | Source | Evidence |
|---|---|---|---|---|
| CRE-01 | Credential requirements are seeded for doctors only. A nurse, pharmacist, laboratory scientist or radiographer needs no document to submit for review and is verified by identity, registration and screening alone. | P0 | REVIEW | `prisma/seed.ts:127-149` |
| CRE-02 | No NMCN, PCN, MLSCN or RRBN credential types, and no qualification, internship or post-basic types for any profession but doctors. The one-click registration confirm exists only for the doctor-labelled MDCN licence type, so a nurse's NMCN registration is recorded through that label or by hand. | P0 | REVIEW | `prisma/seed.ts:99-107`; `application/confirm-from-submission.ts:130,146` |
| CRE-03 | The submit form lists every credential type to every profession, so a nurse is offered "MDCN Annual Practising Licence". | P1 | NEW | `app/practitioner/profile/credentials-section.tsx:93-103,153-163` |
| CRE-04 | A credential's expiry is the review date plus the type's review days, not the date printed on the document, and that computed date is what the practitioner is shown. (The review said the printed date is never captured; at HEAD it can be entered on the registration but not on the credential.) | P0 | REVIEW | `submission.ts:363`; `domain/submission.ts:50-58`; `credentials-section.tsx:229` |
| CRE-05 | The printed expiry on the registration is optional for the officer. If left blank the only limit is the 365-day evidence age counted from the day the officer recorded it. There are two expiry clocks with no link between them. | P1 | NEW | `admin/practitioners/evidence-review.tsx:489-500`; `practitioners/domain/eligibility.ts:78-84` |
| CRE-06 | A verified credential blocks a new submission of its type, so a renewal cannot be sent early. There is no "supersedes" link, and after expiry the old row stays and keeps blocking (PRA-08). | P1 | REVIEW | `submission.ts:187-198` |
| CRE-07 | Decisions are not sent to the practitioner. Reject and request-more publish no event, and the three credential events that do exist have no handler. They find out when they open the app. | P0 | REVIEW | `submission.ts:409-410`; `worker/handlers.ts:15-52` |
| CRE-08 | No expiry warnings (30 and 7 days) and no renewal prompt. The only expiry actions are the daily sweeps. Both CRE-07 and CRE-08 need a working SMS provider from Module 16. | P0 | REVIEW | `worker/jobs.ts:31-56` |
| CRE-09 | Both verification providers are unimplemented switches. Selecting any value but "none" makes the call throw; `sandbox` is not distinct from `live`; one switch covers all regulators. | P1 | V2.9 | `lib/verification/index.ts:99-149`; `lib/env.ts:52-56` |
| CRE-10 | The confirm path reads a photographed licence, not the regulator's register. No register response, screenshot or source reference is stored. The spec asks the officer to look the person up on the register and store the result with its date. | P1 | V2.9 | `admin/practitioners/evidence-review.tsx:80,475`; `application/verification.ts:251` |
| CRE-11 | A verified credential cannot be revoked, withdrawn or superseded, so a forged certificate cannot be un-verified except by editing the registration or suspending the person. | P1 | NEW | `submission.ts:358` |
| CRE-12 | Confirm-from-submission commits three times (record, decide, mask). A failure between them leaves a recorded identity with a submission still waiting. | P2 | NEW | `confirm-from-submission.ts:83-118` |
| CRE-13 | The status model and tables differ from v2.9. There is no Draft, Under review or Suspended status. One table holds submissions with embedded document and review fields instead of separate documents, reviews, sources and flags. Reviewer and note fields are cleared on resupply, so history lives only in the audit trail. No issue date, no source reference, no superseded link. | P2 | V2.9 | `prisma/schema.prisma:505-553`; `submission.ts:481-485` |
| CRE-14 | No retention rule for rejected documents, no image compression for weak connections and no malware check on uploads. | P1 | REVIEW | `lib/storage/tigris.ts:61-69` |
| CRE-15 | One live submission per type is checked in code only; there is no unique index, so a concurrent double submit can create two waiting rows. | P2 | NEW | `submission.ts:181-186` |
| CRE-16 | The spec says expiry suspends the account automatically. The code blocks matching instead and leaves the account usable. This is a deliberate divergence that needs a recorded decision. | P2 | V2.9 | `credentials/application/expiry.ts:15-21` |
| CRE-17 | The sweeps run in one pass with no isolation per row and no paging. One failing row fails the job until tomorrow. | P2 | REVIEW | `credentials/application/expiry.ts:33-66` |
| CRE-18 | Verification turnaround is not measured, though the spec asks for it from week one. Timestamps exist; nothing aggregates them. | P2 | V2.9 | `schema.prisma:484,519-521` |

**Recommended change (v3).**

*Phase 0.* Compliance, with each regulator and with sign-off, defines credential types and requirements for the four other professions (CRE-01, CRE-02): at least the registration licence, the qualification and identity for each, then internship and post-basic evidence where a register depends on it [Counsel/Regulator to confirm]. Filter the form to the profession's types (CRE-03). Capture the printed expiry on the credential at review, so the date the practitioner sees is the document's own (CRE-04, CRE-05). Allow a renewal to be submitted while the old one is still verified; on approval the old row becomes superseded rather than expired (CRE-06, and PRA-08 in Module 2). Send an SMS on every decision and at 30 and 7 days before expiry through the Notifications module (CRE-07, CRE-08).

*Phase 1.* Level evidence (fellowship, grade letter, internship completion, post-basic certificate) becomes credential types attached to a rung, so Module 2 can verify a claimed level. Record the decision on automatic suspension: recommend keeping "block matching, not sign-in", and amend the spec (CRE-16). Add revoke and withdraw, with a reason and an audit row (CRE-11).

*Phase 2 and 3.* Write the NIMC and register adapters when subscriptions exist, one per regulator, behind the same two questions the officer answers today (CRE-09). Until then change the confirm step to record the officer's register lookup with its date and a source reference (CRE-10). Move toward the spec's separate documents, reviews and sources tables only when something needs them (CRE-13). Add retention and compression (CRE-14).

*Phase 4.* Measure verification turnaround and show it to the operations lead (CRE-18).

**Acceptance criteria.**

1. Given a nurse who has submitted every document the nursing profession requires, when they submit for approval, then the server accepts it; given a missing required document, it refuses with 422 naming "your documents".
2. Given a licence photo showing an expiry date of 30 June, when the officer confirms it, then the credential and the registration both carry 30 June, and the practitioner is shown 30 June.
3. Given a verified licence, when the practitioner submits its renewal before expiry, then the system accepts it and, on approval, marks the old one superseded without a gap in eligibility.
4. Given an officer rejecting a submission, when the reason is saved, then an SMS with the reason reaches the practitioner and the outcome is recorded.
5. Given a verified credential that expires in 30 days, when the daily job runs, then the practitioner is sent a reminder, and again at 7 days.
6. Given a NIN submission, when an officer opens the queue, then the number is visible only on demand and is not present in clear in the database after the decision.
7. Given a credential type that is not required for the practitioner's profession, when they open the form, then it is not offered as required.
8. Given NIMC switched on without an adapter, when the app starts, then it fails loudly at boot rather than at the first practitioner.

---

## Cross-slice dependencies

- **Module 7 Matching.** Must call one booking-time check for eligibility, level and supervision at invitation, acceptance and confirmation (PRA-26), and carry the specific blockers into the run instead of a single `not_eligible`. The name-and-phone leak is added in Matching, not here (`matching/application/match.ts:161-179`); the candidate function in this module carries neither.
- **Module 6 Service requests and Module 11 Rates.** A shift must name a required level and match rule, and rate floors must be keyed by level, or PRA-01 cannot take effect. Specialty is today a hard filter that also excludes people with no specialty (`matching/domain/engine.ts:143-146`).
- **Module 16 Notifications.** Needs handlers for `credential.verified`, `credential.expired`, `sanction.applied` and for reject, request-more, suspension and reinstatement events, and a real SMS provider (CRE-07, CRE-08).
- **Module 15 Clinical incidents.** Writes `users.status` that the rule reads. Its own chapter must cover the unconstrained incident subject (`clinical-incidents/application/incident.ts:143-150`), the generic lock-out message a suspended person sees (`auth/domain/errors.ts:51-52`), the lack of a facility-specific or pending-review suspension, and closure notes reaching the reporting facility.
- **Module 1 Authentication.** Officer-assisted account recovery (PRA-22), a stronger second factor for officers who confirm identities, and key management for `SESSION_SECRET`, which also keys the NIN hash (PRA-11).
- **Module 12 Billing and Module 17 Audit.** A bank-account model is needed before a reuse check is possible (PRA-21). Retention and erasure must cover rejected documents and the NIN hash (CRE-14).
- **Module 4 Facilities and the facility console.** The verification panel (PRA-16) is read by facility screens that do not exist yet; it needs a consent-gated read function, not table access.
- **Config.** Categories, specialties, credential types, requirements and the sanctions list change only by seed and deploy; an audited admin screen is the other half of PRA-14, PRA-25 and CRE-01.
- **Worker.** The sweeps share one process with the outbox, and a slow nightly screen can delay the sign-up role grant. They need separate loops (platform slice).
