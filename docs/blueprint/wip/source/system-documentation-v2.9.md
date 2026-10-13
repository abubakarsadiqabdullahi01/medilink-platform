**MEDILINK**

Healthcare Workforce & Locum-Management Platform

*System Requirements & Architecture Documentation — Nigeria Edition*

|                      |                                                                                                                                                                               |
|----------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Document Version** | 2.9 (Enhanced)                                                                                                                                                                |
| **Status**           | Approved for discovery, prototype development and Phase 1 planning; production implementation requires the approval conditions and readiness controls in Sections 9.5 to 9.15 |
| **Target Market**    | Federal Republic of Nigeria                                                                                                                                                   |
| **Primary Stack**    | Next.js (TypeScript) · PostgreSQL · Tigris (S3-compatible) object storage · Progressive Web App first; Flutter mobile client, Android first, after API stabilisation          |
| **Date**             | September 2026                                                                                                                                                                |

**Table of Contents**

**1. Executive Summary**

Medilink is a healthcare workforce and locum-management platform for the Nigerian market. It connects verified healthcare facilities — hospitals, clinics, laboratories — with verified medical practitioners for shifts, locum cover, and contracted engagements, and manages the full lifecycle from request to match, attendance, timesheet approval, and payment settlement.

The system is explicitly not an electronic medical record (EMR) or patient-treatment platform. Its value lies in workforce coordination: reducing the time it takes a facility to fill a staffing gap, giving practitioners transparent access to legitimate paid work, and replacing today's informal, WhatsApp-driven locum market with a verified, auditable, and fairly-paid one.

This document consolidates the original system concept, a critical review against the realities of Nigerian healthcare regulation and infrastructure, and the resulting technical specification. It defines what Medilink does, who it serves, how it is structured into modules, how those modules are sequenced for delivery, and the architectural principles that keep the platform extensible as new capabilities are added.

**Core position:** Medilink succeeds only if verified competence and patient safety are treated as first-class requirements, not administrative afterthoughts. A staffing platform for healthcare is a clinical-safety system before it is a marketplace.

**2. Introduction and Purpose**

Healthcare facilities across Nigeria — particularly outside major urban centres — routinely face short-notice staffing gaps: night and weekend coverage, maternity leave, sudden resignations, or surge demand during disease outbreaks. Today, these gaps are filled informally, through personal networks and WhatsApp groups, with no standard way to verify a practitioner's licence, track hours accurately, or guarantee timely payment.

Medilink's purpose is to formalise this market: to give facilities a fast, reliable way to find qualified, currently-licensed practitioners, and to give practitioners transparent, fairly-compensated access to available work — while producing an auditable record of who worked where, for how long, and what they were paid.

**3. Nigerian Context and Societal Value**

**3.1 Value to Medical Practitioners**

- Legitimate, discoverable access to locum and part-time opportunities beyond personal networks.

- Ability to publish availability, location, specialty, and preferred shift types.

- Reduced dependence on informal WhatsApp groups and word-of-mouth referrals for finding work.

- Visible, agreed rates before a shift is accepted — removing after-the-fact pay disputes.

- Reliable digital records of hours worked and amounts earned, useful for loans, tax filings, and career history.

- Reduced incidence of delayed or disputed payment for locum and contract work.

- Verified employment history that benefits early-career doctors and nurses in particular.

- Automated reminders as licences, certifications, or indemnity cover approach expiry.

- Greater visibility of opportunities outside major cities, including underserved states.

- A potential channel for diaspora practitioners to identify remote or short-term opportunities, subject to licensing rules.

**3.2 Value to Healthcare Facilities**

- Faster resolution of emergency, night, weekend, and maternity-leave staffing gaps.

- Search and filter practitioners by specialty, licence status, experience, distance, and availability.

- Materially reduced risk of engaging unverified or incorrectly qualified personnel.

- Approved electronic timesheets and clean payment records in place of manual paperwork.

- Attendance and no-show tracking for accountability.

- Cross-branch comparison of staffing needs and costs.

- A maintained pool of preferred, trusted practitioners for repeat engagement.

- A fast replacement path when an assigned practitioner cancels.

- Reduced administrative overhead from phone calls, paper timesheets, and manual pay calculations.

**3.3 Value to Nigerian Society**

Implemented with strong clinical governance, Medilink can plausibly contribute to:

- Fewer cancelled clinics and unstaffed shifts.

- Improved access to care in underserved communities through better distribution of available practitioners.

- Reduced patient waiting times caused by staffing shortages.

- A lower risk of facilities engaging unlicensed practitioners.

- Greater transparency around healthcare work and payment practices.

- Anonymised workforce data showing where specific specialties are most needed.

- Better continuity of service during emergencies or sudden staff shortages.

This directly supports the Federal Ministry of Health and Social Welfare's stated goal of accessible, efficient, and affordable healthcare — but only to the extent the platform is honest about its limits. Medilink affects care indirectly, through workforce efficiency; it does not touch clinical quality or treatment decisions, and it should not be presented as though it does.

**4. Scope**

**4.1 In Scope**

- Registration and verification of healthcare facilities and medical practitioners.

- Publishing, matching, and confirming staffing requests and shifts.

- Availability and scheduling management for practitioners and facilities.

- Attendance capture and timesheet approval.

- Rate agreement, contracting, billing, and payment settlement via licensed Nigerian payment providers.

- Cancellation, replacement, and dispute handling.

- Notifications, audit logging, and regulatory compliance controls.

- Identity assurance for practitioners: regulator certificate or folio number, National Identification Number, and photograph, each validated against an authoritative source before a practitioner becomes eligible for any assignment.

- Attendance accountability: determination of fault where a confirmed assignment is not honoured, a graduated sanction ladder, and an excusal path for genuine emergencies.

- Progressive Web App delivery for Phase 1 practitioner journeys, sharing one API and one set of business rules; a Flutter mobile client, Android first, follows after API stabilisation unless launch scope is deliberately extended.

**4.2 Out of Scope (Phase 1)**

- Electronic medical records, patient charting, or treatment documentation.

- Clinical decision support of any kind.

- Operating as a licensed deposit-taking or stored-value wallet (see Section 8.4).

- Telemedicine consultations (deferred to a later phase — see Section 11).

- A standalone iOS release at launch. Android is prioritised on Nigerian device share; because the mobile client is built in Flutter, an iOS build can be produced from the same codebase later if demand justifies it.

**5. System Overview and Core Workflow**

Medilink's essential workflow — the one journey the first release must prove end-to-end — is as follows:

<img src="media/image2.png" style="width:6.1in;height:2.38536in" />

*Figure 2 — Shift lifecycle, and the excusal path. A practitioner who cannot attend asks the facility to release them; fault is decided before any sanction is recorded.*

- 1\. A verified facility publishes a staffing request for a shift or engagement.

- 2\. Eligible, currently-licensed practitioners matching the request are identified and invited.

- 3\. Interested practitioners apply or accept; the facility reviews and confirms the assignment.

- 4\. The practitioner attends the shift; attendance and hours are recorded.

- 5\. Both practitioner and facility approve the resulting timesheet.

- 6\. Medilink calculates the amount due and settles payment through a licensed payment provider.

- 7\. The full transaction — request, match, attendance, approval, payment — remains available for reporting and dispute resolution.

**Design correction from the original concept:** the initial design linked the *first practitioner to accept* a request. This is rejected. The first person to click is not necessarily the safest or most suitable person for the assignment. Matching must instead weigh active licence status, required specialty and qualifications, relevant experience, location and travel time, current availability, recent working hours and fatigue, facility requirements, prior reliability, and agreed rate — with the facility confirming the recommended practitioner before the assignment is final.

5.1 Reading the design flow

Five figures carry the design of this system, and they are best read as one sequence. Each answers a different question, and together they cover the path from an unknown person arriving at the platform to money reaching a verified practitioner's account.

- Figure 1, in Module 3 — who is allowed in. Identity and licence are proved before a practitioner can be matched to anything. This is the gate; nothing downstream is safe without it

- Figure 2, above — what happens in the normal case, and what happens when it does not. The main line runs request to match to shift to payment; the branch below is the excusal path that keeps an emergency from being recorded as a no-show

- Figure 3, in Section 8.2 — how the modules behind those stages talk to each other. Each stage in Figure 2 is several modules reacting to one event, not one module calling another

- Figure 4, in Section 9.16 — the states a single shift's attendance passes through, including the ones nobody wants: rejected, disputed, manually corrected. This is where the timesheet in Figure 2 either settles or does not

- Figure 5, in Section 9.4.2 — where the money sits at each point, and why it never sits with Medilink

The through-line is that every irreversible step is preceded by a check that can be evidenced afterwards. A practitioner cannot be matched without verification, a shift cannot be paid without an approved timesheet, a sanction cannot be applied without a fault decision, and a correction never overwrites what it corrected. If a later change to this specification breaks one of those four, it is a change to the platform's safety model rather than to its features, and should be treated as such.

**6. Stakeholders and User Roles**

|                             |                                                                             |
|-----------------------------|-----------------------------------------------------------------------------|
| **Role**                    | **Description**                                                             |
| Practitioner                | Doctor, nurse, pharmacist, or other licensed health worker offering shifts. |
| Facility Owner              | Ultimate account holder for a healthcare facility or group of facilities.   |
| Facility Administrator      | Manages facility profile, branches, departments, and staff.                 |
| Facility Scheduler          | Publishes requests, reviews candidates, confirms assignments.               |
| Facility Finance Officer    | Manages billing, funding, and payment approval for the facility.            |
| Medilink Operations Officer | Monitors requests, matches, and day-to-day platform operations.             |
| Medilink Compliance Officer | Reviews and approves practitioner and facility credentials.                 |
| Medilink Finance Officer    | Oversees platform-wide settlement, reconciliation, and payouts.             |
| Super Administrator         | Full platform configuration and override authority.                         |

**7. Technology Stack**

|                          |                                                    |                                                                                                                                                                                                                                                                                                                                               |
|--------------------------|----------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Layer**                | **Choice**                                         | **Notes**                                                                                                                                                                                                                                                                                                                                     |
| Application framework    | Next.js (TypeScript)                               | Single codebase for web UI and API routes; supports SSR and PWA delivery.                                                                                                                                                                                                                                                                     |
| Database                 | PostgreSQL                                         | Chosen over MongoDB for transactional consistency in financial, assignment, and approval records — see Section 8.5. MongoDB is not part of the design. It would only be revisited later as a secondary store for a genuinely document-shaped, non-transactional feature, and never for identity, assignment, timesheet, ledger or audit data. |
| Payments                 | Paystack / Remita (licensed partners)              | Medilink integrates with licensed processors rather than operating its own stored-value wallet.                                                                                                                                                                                                                                               |
| Notifications            | Email, SMS, push, WhatsApp (via approved provider) | SMS given priority as a reliability fallback given variable connectivity.                                                                                                                                                                                                                                                                     |
| Hosting                  | Cloud VM / managed Postgres                        | Environment-agnostic; AWS RDS (Postgres) is a valid target once the database engine decision is made.                                                                                                                                                                                                                                         |
| Background processing    | Queue/worker system with a Postgres outbox table   | Used for cross-module events, notifications, and scheduled jobs (e.g., licence-expiry checks).                                                                                                                                                                                                                                                |
| Mobile                   | Flutter (Dart), consuming the versioned API        | Practitioner-facing after Phase 1. Android is the first target on Nigerian device share, and iOS can be produced from the same Flutter codebase later if demand justifies it. Facility scheduling and finance remain on web. See Module 28 for sequencing; Phase 1 uses the low-bandwidth Progressive Web App described in Module 27.         |
| Object and image storage | Tigris (S3-compatible) with signed, expiring URLs  | Practitioner photographs, credential scans, facility licence documents and evidence attachments. The database stores object keys and metadata only; binary files are never held in PostgreSQL.                                                                                                                                                |

*Note: the original draft specification paired MongoDB with AWS RDS, which is a relational-database service. This inconsistency is resolved in favour of PostgreSQL throughout — see Section 8.5 for the rationale. MongoDB is not part of the design. It would only be revisited later as a secondary store for a genuinely document-shaped, non-transactional feature, and never for identity, assignment, timesheet, ledger or audit data. Images and uploaded documents are held in Tigris, an S3-compatible object store, not in the database.*

**8. System Architecture**

Medilink is built as a modular monolith: a single deployable Next.js application internally organised into independent modules, each owning its own data and business rules. This is materially easier to build and operate than a microservices architecture at MVP stage, while preserving clean boundaries so the platform can be decomposed later if scale requires it.

**8.1 Standard Module Structure**

Every module follows the same internal shape, keeping business logic out of React components and route handlers:

- domain/ — entities, domain events, business policies, and types.

- application/ — commands, queries, and orchestration services.

- infrastructure/ — repositories and provider adapters.

- presentation/ — UI components and input validation.

- permissions.ts, routes.ts, and a dedicated tests/ directory.

**8.2 Cross-Module Communication via Domain Events**

Modules communicate through domain events rather than reaching directly into one another's database tables. A Postgres-backed outbox table guarantees events are not lost if background processing fails. Example chain:

*ShiftAccepted → CreateAssignment → AddToSchedule → CreateTimesheet → SendConfirmation*

Other events used across the platform include PractitionerRegistered, CredentialVerified, ServiceRequestPublished, AssignmentConfirmed, ShiftStarted, TimesheetApproved, InvoiceCreated, PaymentCompleted, CredentialExpired, and DisputeOpened. This is what allows a future module — insurance, for example — to react to AssignmentConfirmed without any change to the assignment module itself.

<img src="media/image3.png" style="width:6.1in;height:2.06323in" />

*Figure 3 — Cross-module event chain. Modules react to events rather than reading each other's tables, and the Postgres outbox guarantees no event is lost if a consumer fails.*

**8.3 Provider Adapter Pattern**

External vendors are never called directly from business logic; each integration point is defined as an interface with swappable implementations, for example:

- PaymentProvider — implemented by PaystackPaymentProvider, RemitaPaymentProvider, FlutterwavePaymentProvider, or a bank-transfer fallback.

- SMS, email, and WhatsApp providers.

- Document and image storage providers — Tigris (S3-compatible) is the default implementation, accessed through signed, expiring URLs, and any other S3-compatible store can be substituted behind the same interface.

- Identity and professional-council verification providers.

- Maps/geolocation, video consultation, and analytics providers.

**8.4 Financial Model: Ledger, Not Wallet**

The original concept described a digital “wallet” for each user. This is revised: displaying a running balance to a user is materially different, legally, from operating a licensed stored-value wallet. Medilink's financial model is a transaction ledger plus settlement through licensed payment providers (Paystack, Remita, or equivalent) — with the underlying legal and regulatory model reviewed by Nigerian payments counsel before scaling volume. Financial records are never overwritten; corrections are made through reversal entries, using PostgreSQL transactions to guarantee consistency.

**8.5 Database Design Principles**

- PostgreSQL is used throughout, in place of the original MongoDB/AWS RDS combination, because staffing, approval, and financial workflows depend on strong relational integrity and transactional guarantees. MongoDB is not part of the design. It would only be revisited later as a secondary store for a genuinely document-shaped, non-transactional feature, and never for identity, assignment, timesheet, ledger or audit data. Binary content — credential scans, licence documents, profile photographs and dispute evidence — lives in Tigris object storage, with only the object key, checksum, content type and access metadata recorded in PostgreSQL.

- Tables are organised under clear schema prefixes, e.g. identity.users, workforce.practitioners, facilities.facilities, staffing.service_requests, staffing.assignments, operations.timesheets, finance.invoices, finance.ledger_entries, compliance.credentials, support.disputes.

- UUIDs are used for all identifiers; foreign keys and constraints are enforced at the database level.

- Every table carries created_at and updated_at; status changes are kept in dedicated history tables rather than overwritten in place.

- Soft deletion is used wherever a record must remain auditable.

- JSONB is reserved for genuinely variable metadata only — the schema is not built from generic JSON fields, which would undermine validation, reporting, and long-term data integrity.

- All schema changes go through versioned migrations.

**8.6 Configurability Instead of Hard-Coding**

Professional categories, regulators, specialties, credential types, and service types are stored as configurable records rather than hard-coded values, so that nurses, pharmacists, laboratory scientists, physiotherapists, and other cadres can be added without redesigning the platform. Each professional category can define its own regulator and required credentials, for example:

*Doctor → Regulator: MDCN · Required: annual practising licence · Specialties: cardiology, surgery, paediatrics…*

*Nurse → Regulator: NMCN · Required: current professional licence · Specialties: ICU, theatre, midwifery…*

**8.7 Configurable Workflow Engine**

Different engagement types require different approval sequences. Rather than hard-coding a single flow, allowed status transitions are stored in configuration:

- Standard doctor shift: Published → Applied → Facility Approved → Confirmed.

- Emergency shift: Published → Automatically Matched → Practitioner Confirmed.

- Long-term contract: Application → Interview → Compliance Review → Contract → Confirmed.

**8.8 Permissions, Not Just Roles**

Access control is expressed as granular permissions (e.g. request.create, request.publish, assignment.approve, timesheet.submit, timesheet.approve, payment.release, credential.verify, dispute.resolve, report.export) rather than coarse role checks, so that, for instance, a facility administrator and a facility finance officer can be granted different capabilities without branching logic scattered through the codebase.

**8.9 Feature Flags**

New or risky functionality is rolled out gradually via a feature_flags configuration (key, enabled, rollout_percentage, facility_id, state_code, environment, configuration) — for example, enabling automatic matching in Lagos only, piloting a new payment provider with internal users, or releasing a new timesheet workflow to a small group of facilities before a full rollout.

**8.10 API Versioning**

API contracts are versioned from day one (/api/v1/practitioners, /api/v1/facilities, /api/v1/service-requests, /api/v1/assignments) so that breaking changes can be introduced under /api/v2 in future without immediately breaking mobile clients or third-party integrations.

**8.11 Recommended Codebase Layout**

src/ ├── app/ (auth), practitioner/, facility/, admin/, api/ ├── modules/ auth, practitioners, credentials, facilities, availability, │ service-requests, matching, scheduling, attendance, │ timesheets, contracts, billing, payments, disputes, │ notifications, compliance ├── infrastructure/ database, payments, messaging, storage, background-jobs └── shared/ authorization, validation, errors, audit, types

*Fixed-width layout of the codebase tree; module names correspond directly to the modules documented in Section 9.*

**9. System Modules**

Modules are grouped by priority. Priority 0 (P0) modules form the safe, commercially usable Nigerian MVP and must ship together, since the core workflow in Section 5 depends on all of them. Priority 1 (P1) modules are added once that workflow is stable in production. Priority 2 (P2) modules extend Medilink from a staffing tool into a broader healthcare workforce ecosystem.

**9.1 Priority 0 — Core Modules (MVP)**

**1. Authentication and Access Control**

Manages access for practitioners, facilities, administrators, and finance personnel.

- Email and Nigerian phone-number registration with OTP verification

- Secure login, password recovery, and optional multi-factor authentication

- Role-based access control layered with granular permissions

- Session and device management

- Account suspension and deactivation

- Administrative impersonation with full audit trail

***Data:** PostgreSQL: users, roles, permissions, user_roles, sessions, login_attempts, devices*

**2. Practitioner Management**

Maintains professional profiles for doctors and, over time, other licensed health workers.

- Personal, contact, state/LGA and current-location data

- Professional category, specialty, and subspecialty

- Years of experience and work history

- Preferred locations, shift types, and rate expectations

- Verification panel shown to facilities: MDCN status and the date it was confirmed, licence expiry date, NIN verified yes or no, and which evidence tier the practitioner holds — so a facility judges the evidence, not a badge

- Qualifications: primary degree, institution, year, housemanship centre, postgraduate fellowships and diplomas, each with the supporting document attached

- Employment history: current substantive post, previous facilities, dates, and role, with the practitioner's own description of scope of practice

- Procedures and competencies the practitioner is willing to be booked for, declared by category rather than free text, so a facility filling a theatre list can filter for it

- Languages spoken, which matters for facilities outside the major urban centres

- Platform record, generated by Medilink and not editable by the practitioner: shifts completed, facilities worked, attendance reliability, and the number of assignments those figures are based on

- Indemnity cover: provider, policy number and expiry, with a renewal reminder

- Every claim on a profile is one of three kinds, and the profile says which: verified by Medilink against a source, evidenced by an uploaded document a compliance officer has seen, or stated by the practitioner and unverified. A facility should never have to guess which it is looking at

- Configurable practitioner categories: doctors, dentists, nurses/midwives, pharmacists, laboratory scientists, radiographers, physiotherapists, community health practitioners

***Data:** PostgreSQL: practitioner_profiles, specialties, practitioner_specialties, work_experiences, professional_categories, practitioner_preferences*

**3. Credential and Compliance Verification**

A clinical-safety module, not an optional add-on — it is part of the MVP by necessity.

Identity assurance precedes credential assurance. A licence number proves that a licence exists; it does not prove that the person holding the account is the person the licence was issued to. Both checks are required, and a practitioner is ineligible for matching until both have passed.

MDCN offers no verification API. Everything below is built on the four services the Council publishes, and the design reflects their real limits.

- Confirm a doctor status (portal.mdcn.gov.ng/confirm-doctor-status) accepts a first name or folio number together with the practice type — medical, dental or alternative — and returns name, gender, practice type, practice location and current status. It is free and immediate, and it is the check that runs at registration. It returns no photograph and no date of birth, which is why identity is bound through NIMC rather than through MDCN

- Primary-source verification is carried out for MDCN by DataFlow Group (mdcn.dataflowgroup.com). It is authoritative but paid, initiated by the practitioner, and takes weeks. It is deliberately OUT OF SCOPE for Phase 1: charging practitioners a verification fee before they have earned anything on the platform would suppress registration in exactly the group Medilink needs most, and Medilink absorbing the cost per applicant is not viable at launch volume. It is recorded here as the Phase 2 route for long-term contracts and for any practitioner Medilink has cause to doubt

- Certificate of Good Standing, applied for by the practitioner through the MDCN portal, is also chargeable and also Phase 2. Where a practitioner already holds one, Medilink accepts it as evidence and records it against the profile

- The sanctioned doctors list and the quack doctors list are screened at registration and re-screened on a schedule, because a practitioner verified in January may be sanctioned in March

Phase 1 therefore verifies at no cost to the practitioner and no per-applicant cost to Medilink. Every check below is free: the MDCN status confirmation, the sanctioned and quack list screening, and the documents the practitioner already holds. NIN verification through a NIMC provider carries a small per-check fee paid by Medilink, which is the one unavoidable cost and is what makes duplicate accounts preventable. A practitioner who passes these becomes eligible for shift work, and the profile shows facilities exactly which evidence was checked and when.

Because the confirmation service is a web form rather than an API, the lookup is performed by a Medilink Compliance Officer and the result stored as evidence with its retrieval date, not scraped automatically. Automating it requires MDCN's written agreement, and the provider adapter in Section 8.3 exists so that an official API can be substituted later without touching the verification workflow. This is sustainable at roughly twenty to fifty registrations a week and becomes the platform's binding constraint well before a thousand practitioners. Medilink should track verification turnaround from the first week and open a conversation with MDCN about programmatic access before the queue, not after — a platform performing volume verification is precisely the counterparty for whom the Council would build one.

<img src="media/image1.png" style="width:5.9in;height:5.25715in" />

*Figure 1 — Practitioner verification. Every step is free except the NIMC check, which Medilink pays for and which is what makes one person, one account enforceable.*

Medilink also uses MDCN's outbound channels: a practitioner found to be practising on a forged folio number is reported through the Council's report-a-quack service, and a deceased practitioner whose account is still active is reported through report-a-deceased-doctor.

- MDCN folio number for doctors and dentists; equivalent regulator ID for other cadres

- National Identification Number (NIN), verified through an authorised NIMC verification provider, never captured as a free-text field

- Certificate or folio number checked against the issuing regulator's published register, with the response and its retrieval date stored as evidence

- Name, date of birth and photograph cross-matched across regulator record, government identification and the uploaded practising licence; a mismatch on any of the three holds the account in Under review

- No live photograph or liveness capture is required. MDCN's confirmation service returns no photograph, so a selfie could only be compared against the uploaded identification document — a check a compliance officer performs during review without asking the practitioner to film themselves

- Duplicate-identity detection across the platform: one verified NIN and one regulator identifier may hold exactly one active practitioner account

- Uniqueness is enforced at the database level on three keys independently: verified NIN, regulator folio number, and verified phone number. A second registration attempt on any one of them is refused at the point of entry, not discovered later

- Where a genuine practitioner has lost access to an old account, the route is account recovery through a compliance officer, never a second registration — and the recovery is recorded

- Bank account details are checked for reuse across accounts, because a duplicate identity that shares a payout account is the pattern worth catching

- Where a practitioner cannot produce a NIN, registration is held rather than refused, and a compliance officer decides on the strength of the remaining evidence — this keeps the door open for practitioners with genuine documentation gaps without weakening the default

- Annual practising licence and qualification documents

- Government-issued identification and professional indemnity information

- Certificate expiry tracking with automated renewal notifications

- Manual and automated verification with a compliance review queue

- Rejection/resubmission workflow; automatic suspension on expiry

- Statuses: Draft, Submitted, Under review, Verified, Rejected, Expired, Suspended

***Data:** PostgreSQL: credentials, credential_types, credential_documents, verification_reviews, verification_sources, compliance_flags*

**4. Healthcare Facility Management**

Registers and verifies hospitals, clinics, laboratories, and other approved facilities.

- Legal/trading names, CAC registration, and facility licence

- Facility type, ownership type, state/LGA, and physical address

- Multiple branches and departments

- Authorised representatives, billing contacts, and shift supervisors

- Facility verification, suspension, and risk flags

- CAC registration number checked against the Corporate Affairs Commission public search, with the result and its retrieval date stored as evidence — the same treatment given to the MDCN check in Module 3

- Facility licence document uploaded and reviewed by a compliance officer; a facility cannot publish a request until both checks have passed

- At least one named facility representative verified by NIN and phone, so a person is accountable for the requests the facility publishes

- Physical address confirmed at first engagement — the first practitioner to attend confirms the facility exists and matches its description, which is a cheap check that a desk review cannot replicate

Facility verification carries the same weight as practitioner verification. A fabricated facility drawing a practitioner to a location that does not exist, or to an unsafe one, is as serious as a fabricated practitioner, and the platform is equally responsible for both.

***Data:** PostgreSQL: facilities, facility_branches, departments, facility_users, facility_documents, facility_verifications*

**5. Practitioner Availability**

Lets practitioners specify when and where they can work.

- Available dates/times, recurring availability, and blocked periods

- Preferred states, LGAs, and maximum travel distance

- Day, night, weekend, and public-holiday preferences

- On-call availability and calendar conflict detection

- Maximum working-hours controls

***Data:** PostgreSQL: availability_slots, availability_rules, blocked_periods, location_preferences*

**6. Service Request and Shift Management**

Allows facilities to request qualified practitioners with full context.

- Facility, branch, department, practitioner category, and specialty

- Number of practitioners required, shift date/time, and responsibilities

- Minimum experience and required credentials

- Rate, allowances, and any accommodation/transport information

- Cancellation terms, application deadline, and urgency level

- Statuses: Draft, Published, Matching, Partially filled, Filled, In progress, Completed, Cancelled, Disputed

***Data:** PostgreSQL: service_requests, shift_positions, shift_requirements, shift_rates, request_status_history*

**7. Matching and Assignment**

Matches each request to safe, suitable practitioners — never simply the first to click accept.

- Filters on active licence, category, specialty, experience, availability, location/travel time

- Working-hour and fatigue limits, facility preferences, and prior reliability

- Cold start: a practitioner with no completed engagements carries a neutral reliability position, neither penalised nor rewarded, and reliability begins to weigh in the ranking only after five completed assignments. Until then the ranking rests on licence status, specialty, experience, availability and distance. Without this rule a new practitioner can never be matched, and no new practitioner ever becomes an established one

- Reliability is always displayed with the number of assignments it is based on, so a facility can tell the difference between a practitioner who has never missed a shift out of forty and one who has never missed a shift out of two

- Workflow: identify eligible practitioners → send invitations → practitioners apply/accept → facility reviews candidates → facility confirms → practitioner receives final confirmation

***Data:** PostgreSQL: match_results, shift_invitations, shift_applications, assignments, assignment_status_history*

**8. Scheduling and Calendar**

Gives both sides a reliable, conflict-free schedule.

- Practitioner and facility calendars with recurring shifts

- Conflict detection, rescheduling, and replacement requests

- Shift reminders and calendar export

- Nigerian public-holiday configuration; West Africa Time as default display, UTC stored internally

***Data:** PostgreSQL: schedules, schedule_occurrences, schedule_changes, reminders*

**9. Attendance and Timesheet Management**

Captures what actually happened during a shift.

- Check-in/check-out with supervisor OTP or QR confirmation

- Optional location validation — GPS is a signal, never the sole method, given variable network/location reliability

- Manual attendance fallback, breaks, overtime, and on-call hours

- Practitioner submission, facility approval or rejection with reason, amendment history, and dispute initiation

***Data:** PostgreSQL: attendance_records, checkin_events, timesheets, timesheet_entries, timesheet_approvals, timesheet_revisions*

**10. Rates, Contracts and Engagement Terms**

Ensures both sides agree on commercial terms before a shift is accepted.

- Hourly, daily, or fixed-shift rates; overtime, night, and weekend allowances

- Configurable minimum rate per professional category and engagement type. A request below the floor cannot be published. Transparent rates without a floor invite a race to the bottom, and the platform would fairly be blamed for hosting it

- The floor is a configuration record, not a hard-coded value, and is set in consultation with professional bodies rather than by Medilink alone

- Transport/accommodation allowances and cancellation penalties

- Tax and withholding configuration

- Digital engagement agreement with versioned terms and recorded acceptance

***Data:** PostgreSQL: rate_cards, engagement_terms, contracts, contract_versions, contract_acceptances*

**11. Billing, Payments and Settlement Ledger**

Manages the financial lifecycle without Medilink operating as an unlicensed financial institution.

- Facility funding/authorisation and invoice generation

- Practitioner earnings calculation, platform fees, and tax/withholding entries

- Integration with a licensed Nigerian payment provider; bank-account verification

- Practitioner payout, refunds/reversals, reconciliation, and downloadable statements

- Ledger-based model — see Section 8.4 — never a self-operated stored-value wallet

***Data:** PostgreSQL: billing_accounts, invoices, invoice_items, ledger_accounts, ledger_entries, payment_transactions, payouts, refunds, reconciliations*

**12. Cancellation, No-Show, Fault and Sanctions**

Protects both sides when assignments change, and holds each side accountable when a confirmed assignment is not honoured.

- Practitioner- and facility-initiated cancellation with reason capture

- Configurable penalty rules and emergency replacement search

- No-show reporting with evidence submission and reliability impact

- Administrator override authority

- Fault determination: every unhonoured assignment is recorded against one of practitioner at fault, facility at fault, excused, or undetermined pending review — a no-show is never counted against a practitioner until fault is decided

- Excusal request: a practitioner facing an emergency may ask the facility to release them from a confirmed assignment, stating a reason; if the facility accepts, the release is recorded as excused and carries no sanction and no reliability penalty

- Excusal requests are time-stamped and retained whether granted or refused, so a facility that habitually refuses reasonable requests is visible to Medilink operations

- Graduated sanction ladder: recorded warning, temporary suspension from matching, extended suspension, then removal from the platform — each step configurable and each requiring a stated reason

- Only a Medilink Compliance Officer may apply, vary or lift a sanction. A facility can report and a practitioner can appeal, but neither can impose or remove one

- Sanction and appeal history is retained in full; a lifted sanction is closed with a reason and never deleted from the record

- Financial consequence is separated from disciplinary consequence: withheld or reduced payment follows the cancellation terms agreed in the engagement, while suspension follows the sanction ladder, so that settling an amount owed does not by itself clear a disciplinary record

- Reliability score reflects only assignments where the practitioner was found at fault, and is shown to facilities with the count of assignments it is based on

***Data: PostgreSQL: cancellations, replacement_requests, no_show_reports, fault_determinations, excusal_requests, penalty_rules, penalties, sanctions, sanction_history, appeals, reliability_scores***

**13. Dispute and Case Management**

Handles disagreements through a defined process rather than ad hoc escalation.

- Covers incorrect timesheets, unpaid work, incorrect rates, unapproved overtime

- Also covers no-shows, facility cancellations, professional misconduct, unsafe conditions, and payment reversals

- Opening a dispute on a timesheet places a hold on the disputed amount only; any undisputed portion settles on its normal schedule, so a disagreement about two hours of overtime does not delay payment for the whole shift

- A dispute opened after settlement is resolved by reversal entry, never by editing the original ledger record

- Each dispute type carries a target resolution time, and a dispute that passes it escalates automatically to a named officer — an unresolved hold is a practitioner going unpaid

***Data:** PostgreSQL: cases, case_messages, case_evidence, case_assignments, case_decisions, case_status_history*

14\. Clinical Incident Reporting

Medilink does not assess clinical quality and does not hold patient records. It nevertheless places practitioners in clinical settings, and a practitioner sourced through the platform will eventually be involved in a patient death or a serious adverse event. This module exists so that the platform's response is defined in advance rather than improvised under pressure. It is a Priority 0 module for that reason, and it is the one part of the specification that is written for an event Medilink hopes never occurs.

- Either party may report an incident against a specific assignment: the facility, the practitioner, or a Medilink officer acting on information received

- The report records what happened, when, and which assignment it relates to. It does NOT record patient identifiers, clinical details, or treatment information — Medilink is not an EMR and must not become an informal one

- Opening an incident suspends the practitioner from new matching at that facility pending review, and a Medilink Compliance Officer decides within a defined period whether the suspension extends platform-wide, is lifted, or remains facility-specific

- Suspension pending investigation is explicitly not a finding of fault, is recorded as such, and is separate from the sanction ladder in Module 12, which deals with attendance rather than clinical conduct

- Where the matter falls within the Council's jurisdiction, Medilink reports it through MDCN's complaint channel and records that it has done so. Medilink does not adjudicate professional misconduct; that is the Council's statutory role

- All records relating to an incident — the assignment, attendance, timesheet, verification evidence, and the incident report itself — are placed under legal hold and exempted from the retention rules in Module 16 until the matter closes

- Records are produced to a court, coroner or the Council on lawful request, and each such production is itself logged

Data: PostgreSQL: clinical_incidents, incident_reports, incident_suspensions, incident_referrals, legal_holds

**15. Notifications and Communication**

Keeps both sides informed across the channels most likely to reach them.

- In-app, email, SMS, push, and WhatsApp (via an approved provider) notifications

- Covers shift invitations, confirmations, reminders, cancellations, timesheet approvals, payments, disputes, and licence expiry

***Data:** PostgreSQL: notifications, notification_templates, notification_preferences, notification_deliveries*

**16. Administration and Operations**

Gives Medilink staff day-to-day operational control.

- User and facility approval, credential review, and request/payment monitoring

- Dispute management, account suspension, and risk flags

- Configuration management and manual corrections — always with a recorded reason

- Operational dashboards and exportable reports; every action produces an audit record

***Data: Shares tables with Modules 3, 4, 13, 14 and 17***

**17. Security, Privacy and Audit**

The compliance backbone required for Nigerian data-protection law.

- Role-based data access, encryption in transit and at rest, secure document access

- Consent records and privacy-policy acceptance

- Audit logs, data-retention rules, account-data export, and correction/deletion requests

- Lawful disclosure route: a defined process for responding when MDCN, a state ministry, a court or a law-enforcement agency asks whether a named practitioner worked at a named facility on a given date. The request, its legal basis, the officer who authorised the response, and the data released are all recorded — the request itself is auditable, not only the data

- No standing or bulk access is granted to any external body. Regulator requests are answered individually and only where a lawful basis exists

- Security-event monitoring, data-breach workflow, and backup/disaster recovery

***Data:** PostgreSQL: audit_logs, consent_records, privacy_requests, security_events, data_retention_rules, breach_incidents*

18\. Suggestions and Product Feedback

A deliberately small module, included in the first release because the first six months of real use will teach Medilink more about what the platform should do than this specification does.

- A suggestion control available from every screen, capturing the suggestion, the submitter's role, the screen it came from, and the facility or practitioner it came from

- Every suggestion carries a status visible to the person who submitted it: received, under consideration, planned, shipped, or declined with a reason. A suggestion box that swallows input teaches people to stop using it, which costs more than the module saves

- Tagged by module, so that ten suggestions about the same screen surface as a pattern rather than ten separate notes

- Reviewed weekly alongside two other feedback channels the platform already generates: the dispute log, and the record of excusal requests a facility refused. Both describe how the system behaves under pressure, which is not the same as how it was specified

Data: PostgreSQL: suggestions, suggestion_status_history, suggestion_tags

**9.2 Priority 1 — Medium-Priority Modules**

Added once the complete staffing-to-payment workflow is proven stable in production.

**19. Ratings and Performance**

Structured facility feedback and practitioner feedback about facilities; attendance reliability, cancellation rate, and timesheet-approval performance tracked separately from public ratings, with a moderation and appeal process. Clinical competence is never inferred from a simple star rating.

**20. Recurring Workforce and Rostering**

Weekly/monthly rosters, rotating shifts, bulk shift creation, department staffing requirements, vacancy detection, roster templates, and practitioner workload monitoring.

**21. Reports and Analytics**

Facility reports (staffing cost, fill rate, attendance, cancellation, demand by department, utilisation); practitioner reports (earnings, hours, upcoming shifts, payment status); Medilink-level reports (revenue, reconciliation, active users, credential expiry, geographic demand, dispute resolution time).

**22. Credential Renewal and CPD**

Licence-renewal reminders, CPD record-keeping, required-certificate tracking, approved training discovery, renewal workflow, and a compliance calendar.

**23. Tax and Financial Statements**

Annual earnings statements, service-fee statements, withholding-tax records, downloadable receipts, facility expenditure reports, and configurable Nigerian tax rules.

**24. Facility Preferred Pools**

Favourite and blocked practitioners, private and department-specific pools, direct shift invitations, and re-engagement history.

**25. Fraud and Risk Management**

Detection of duplicate identities, suspicious check-ins, repeated payment failures, falsified documents, unusual cancellation patterns, and account-takeover indicators, with a manual risk-review queue.

**26. Customer Support**

Helpdesk ticketing, knowledge base and FAQs, service-level tracking, complaint escalation, and full support communication history.

**27. Low-Bandwidth and Mobile Experience**

Responsive, Progressive-Web-App-capable Next.js delivery; small page payloads and compressed uploads; retry logic for failed requests; draft-saving forms; SMS notifications; clear network-status feedback for low-connectivity regions.

28\. Mobile Application (Flutter)

A Flutter mobile client for practitioners, who are the mobile-first side of the platform, released on Android first. Flutter is chosen over a Kotlin-only client so that a single Dart codebase can serve Android now and iOS later without a second implementation of the same journeys. Facility scheduling and finance work stays on the web application, where the screens are larger and the tasks are desk-bound.

- Registration, credential upload and camera capture of licence, identification and selfie

- Availability entry, shift invitations, applications and confirmations

- Shift check-in and check-out by supervisor OTP or QR scan, with the manual fallback of Module 9

- Timesheet submission and approval status

- Earnings, payment status and downloadable statements

- Excusal requests and sanction or appeal status from Module 12

- Push notifications, with SMS remaining the fallback where data connectivity fails

- Offline-tolerant: drafts, availability and check-in events queue locally and sync when the network returns, since a practitioner may check in from a facility with no usable data signal

The Flutter client consumes the same versioned API as the web application and holds no business rules of its own. Matching, fault determination and settlement remain server-side, so the two clients can never diverge in behaviour.

Sequencing note: this is documented as a P1 module deliberately. Building a mobile client in parallel with the Phase 1 web MVP doubles the client surface before the API has stabilised, and every change to matching or timesheets would then need shipping twice. The Progressive Web App in Module 27 covers the same practitioner journeys during Phase 1; the Flutter client follows once the API is stable.

**9.3 Priority 2 — Ecosystem Modules**

Valuable, but deliberately sequenced after the core product so they do not delay a safe, working MVP.

**29. Telemedicine Engagements**

Virtual shift requests, secure consultation links, availability, consent workflow, and telemedicine-specific payment and documentation boundaries.

**30. Professional Community and Mentorship**

Verified professional groups, mentorship matching, specialty discussions, and moderated educational content.

**31. Insurance and Professional Benefits**

Professional indemnity partnerships, health insurance options, income-protection products, and pension/savings partnerships with eligibility tracking.

**32. Rural and Underserved-Area Staffing**

Rural opportunity discovery, hardship allowances, accommodation/transport information, sponsored placements, and location-based incentives.

**33. Emergency Workforce Pool**

Verified, immediately-available emergency-response personnel with rapid credential confirmation, emergency broadcast invitations, and escalation controls.

**34. Workforce Forecasting**

Predictive modelling of staffing shortages, high-demand specialties, and seasonal patterns; anonymised state- and LGA-level workforce maps.

**35. Agency and Partner Management**

Onboarding and management of locum agencies, training institutions, government programmes, and practitioner groups, including bulk onboarding.

**36. Public and Government Dashboards**

Anonymised, aggregated dashboards only: staffing demand by location, specialty shortages, fill rates, rural workforce trends, and emergency staffing response.

9.4 Implementation baseline decisions

Three questions affect the database schema and operating model. For Phase 1 implementation, the following baseline decisions are adopted so development can proceed; each remains subject to formal confirmation by Nigerian legal counsel, tax counsel, and the selected payment provider before production launch.

9.4.1 Revenue model

Baseline decision: Medilink uses a percentage commission on the engagement value, borne by the facility, deducted at settlement and shown transparently on both the facility invoice and the practitioner statement. The practitioner's accepted rate remains the amount the practitioner receives. The ledger records gross engagement value, platform commission, tax treatment, provider charges, facility debit and practitioner payout as separate entries.

Legal and tax confirmation still required: VAT, withholding-tax treatment, invoice wording and settlement reporting must be reviewed before production launch, but the schema should be built for this baseline rather than left open.

9.4.2 When facility funds arrive

Baseline decision: the facility authorises payment before the shift and the licensed payment provider captures it on timesheet approval, holding funds through the regulated provider rather than through Medilink.

<img src="media/image5.png" style="width:6.1in;height:2.24265in" />

*Figure 5 — Payment lifecycle under the adopted model. Funds sit with the licensed provider throughout; Medilink records the ledger entries but never holds the balance.*

- Rejected for Phase 1: facility pays only after the shift. This recreates the delayed-payment problem and transfers credit risk to Medilink.

- Rejected for Phase 1: facility funds before the shift and Medilink holds the balance. This risks being treated as deposit-taking or stored value, which Section 8.4 rules out.

- Adopted for Phase 1: facility authorises payment before the shift and the licensed payment provider captures it on timesheet approval. Medilink does not hold client funds, and practitioner payout is triggered promptly after approved timesheet settlement. This must be confirmed with the chosen provider before production launch.

9.4.3 Medilink's legal position in an engagement

Baseline decision: Medilink is treated as an introducer and platform operator, not the practitioner's employer and not the clinical provider. The engagement agreement is between the facility and practitioner, with Medilink facilitating verification, matching, records, payment processing and dispute workflow. This position must be confirmed by Nigerian legal counsel before contracts are issued, because it affects liability, indemnity, withholding tax, professional conduct reporting and facility claims.

**9.5 Production approval conditions**

Before production implementation, Medilink must obtain written legal and regulatory opinions on its role in each engagement, payment flow, data-protection position and professional licensing obligations. The board or founder group must also approve the pilot scope, appoint clinical governance and privacy owners, approve the authorization model, approve the payment ledger model, approve retention and legal-hold rules, and complete a threat model and privacy impact assessment before collecting NINs, identity documents, bank details or location data.

**9.6 Regulatory assumptions register**

Regulatory conclusions are implementation assumptions until confirmed by the appropriate authority. The live assumptions register must track the assumption, confirming authority, owner, status, review date and resulting system impact. Initial entries include Medilink's legal role, payment authorization model, NDPA obligations, practitioner engagement rules, facility licence requirements, cross-border data transfer limits and professional-council requirements for each practitioner category.

**9.7 Minimum safe pilot scope**

The first pilot is narrower than the full Priority 0 module list. It includes practitioner and facility registration, identity and credential verification, facility-created shift requests, assisted matching, assignment confirmation, attendance and timesheets, basic invoice and payment-provider settlement, audit logs, operational administration, cancellation and fault recording, dispute intake, and customer support through phone and WhatsApp.

Automation should be deliberately limited during the pilot. Matching, credential review, facility verification, sanction decisions, dispute resolution, payment reconciliation, replacement search and non-critical notification channels may start as staff-assisted workflows. Safety-critical controls must still be enforced by the system: verified identity, unexpired required credentials, facility verification, assignment audit trail, rate acceptance, timesheet approval, payout controls and fault recording.

**9.8 Clinical governance and scope of practice**

Medilink must appoint a clinical safety lead or medical director and maintain a clinical advisory committee before expanding professional categories or high-risk assignment types. This group approves professional categories, competency requirements, minimum qualifications per assignment type, supervision rules for interns, residents, locums and newly qualified practitioners, and escalation procedures for unsafe working conditions.

A practitioner's licence proves professional registration; it does not prove suitability for every procedure, department or level of independence. Matching must include structured scope-of-practice records, declared competencies, evidence level, facility requirements, supervision requirement, indemnity status and restrictions on unfamiliar or high-risk work. A facility request outside a practitioner's verified competence must be blocked or routed to clinical governance review.

**9.9 Identity, credential and privacy model**

Highly sensitive identifiers must be minimised. Raw NIN and credential numbers should not be exposed to facilities and should be stored only where legally necessary; otherwise Medilink should use provider tokens, salted hashes or encrypted values with documented key management. Facility users see verification status, evidence tier, regulator, expiry date and relevant restrictions, not full identity-document data.

The credential model must record credential type, issuing authority, credential-number token, subject user, issue and expiry dates, verification status, verification method, verification time, verifier, source reference, evidence document, review notes and superseded credential. Procedures must cover name changes, marriage-related record differences, phone loss, account recovery, deceased practitioners, suspended or retired practitioners, duplicate-account review, credential expiry and preservation of evidence when an external source changes.

**9.10 Authorization and tenant isolation**

A user must have both the required permission and access to the relevant facility, branch, department, assignment, payment, credential, case or incident. The authorization design must define facility-group hierarchy, branch and department access, practitioner profile visibility, finance access, compliance access, timesheet approval rights, separation of duties for payment release, break-glass access, revocation when employment ends, admin impersonation restrictions and authorization tests for every sensitive endpoint.

**9.11 Authentication and account security**

Authentication requirements must include OTP expiry, attempt limits, resend limits, rate limits by IP, device, phone and account, credential-stuffing protection, session rotation after login and privilege changes, refresh-token rotation and revocation, suspicious-login detection, and recovery paths that do not rely only on a registered phone number. Administrator, compliance and finance accounts require stronger protection than SMS OTP alone, including passkeys or authenticator-app MFA and step-up authentication before sensitive actions.

Changes to phone number, email, bank details or payout account must trigger notification and may require cooling-off, step-up authentication or manual review. Payout-account changes are especially sensitive and must be auditable.

**9.12 API, integration and event reliability**

Request creation, assignment confirmation, payment initiation, payout, refund and webhook processing require idempotency keys. Webhooks require signature validation, replay protection, retry handling, dead-letter processing and reconciliation. Provider calls require timeout rules, pending-state handling, outage mode, duplicate-payment prevention and manual recovery procedures.

Every request, event, provider call, ledger entry and audit record must carry a correlation identifier. Domain events must be versioned so consumers can evolve safely. The system must guarantee exactly-once business effects even when messages or webhooks are delivered more than once.

**9.13 Payment ledger and reconciliation semantics**

The ledger must use integer minor units, such as kobo, plus explicit currency codes. Financial amounts must never be stored as floating-point values. The accounting model must define ledger accounts for facility balances or obligations, practitioner earnings, platform revenue, provider fees, taxes, refunds, holds, disputed amounts, failed payments, reversals and chargebacks.

The ledger should be double-entry or otherwise formally balanced with clear debit and credit semantics. Requirements must define who bears provider fees, rounding rules, VAT and withholding-tax handling, revenue recognition, when practitioner earnings become payable, partial timesheet approval, disputed-amount holds, multi-tranche settlement, refunds, statement correction, provider settlement-report reconciliation, release authority, reversal authority, end-of-day reconciliation and month-end reconciliation.

**9.14 Data retention, deletion and legal hold**

Medilink must maintain a data inventory covering identity records, NIN verification results, regulator evidence, uploaded documents, bank and payout details, attendance and location data, timesheets, contracts, payment and ledger records, disputes, clinical incident reports, audit logs, support conversations and notification history. Each category must define purpose, legal basis, owner, visibility, storage location, encryption requirement, retention period, deletion or anonymisation method, legal-hold behaviour, backup deletion behaviour and cross-border transfer status.

Account deletion must be defined precisely. Some profile and identity data may be deleted or anonymised, while legally required financial, audit, dispute and incident records may need restricted retention. Legal holds override ordinary deletion until the matter closes.

**9.15 Operational readiness, acceptance criteria and observability**

Operational readiness must cover compliance-officer workload, verification service levels, support hours, emergency escalation, payment reconciliation responsibilities, dispute-resolution targets, approval limits, staff training, staff background checks, access reviews, offboarding, outage procedures, facility onboarding, practitioner onboarding, consent scripts, suspicious-document handling and impersonation handling.

Each major workflow requires measurable acceptance criteria. A practitioner must not appear in matching unless identity is verified, required credentials are verified and unexpired, required documents are approved, no active platform-wide suspension exists, and category plus scope of practice satisfy the request. An assignment must not become confirmed unless the facility is active and verified, the practitioner is eligible, no schedule conflict exists, rate and terms are accepted, notifications are queued and an audit event is written. A payout must not be initiated unless the timesheet is approved, disputed amounts are separated, payment authorization exists, payout account is verified, the idempotency key is unused and the ledger transaction commits successfully. A serious incident must preserve records, apply the defined temporary matching restriction, notify the responsible officer, start the investigation deadline, create an audit event and restrict access to incident details.

Service objectives must define availability target, recovery point objective, recovery time objective, backup frequency, backup encryption, restore-test frequency, failover strategy, log retention, alert severity, on-call ownership and tamper detection for audit logs. Dashboards and alerts must track registration conversion, verification turnaround, shift fill rate, cancellation rate, no-show rate, timesheet approval time, payment success, settlement delay, dispute age, notification delivery, queue failures, provider errors, credential-review backlog and suspicious-login activity.

**9.16 Attendance and matching controls**

Attendance states are: Not started, Check-in pending, Checked in, Checked out, Attendance submitted, Attendance approved, Attendance rejected, Attendance disputed and Manually corrected. Attendance may combine practitioner check-in, supervisor OTP, short-lived QR code, timestamp, device identifier, optional coarse location, facility confirmation and manual fallback with reason. Every correction preserves the original event and records who changed it, why and when.

<img src="media/image4.png" style="width:6in;height:2.91177in" />

*Figure 4 — Attendance state machine (Section 9.16). Every correction preserves the original event and records who changed it, why and when.*

Matching must remain explainable and auditable. Requirements must define distance and travel-time calculation, location privacy, recurring availability expansion, transactional conflict detection, race handling when two facilities select the same practitioner, use of PostgreSQL time-range exclusion constraints where appropriate, ranking reasons, eligibility-exclusion reasons, practitioner appeal routes for inaccurate reliability data, and fatigue rules for overnight or consecutive shifts.

**9.17 Glossary and state discipline**

The implementation specification must define the states Confirmed, Approved, Verified, Eligible, Active, Licensed, Suspended, Disputed, Settled, Captured, Paid out and Reversed. These terms must not be used interchangeably. Each major aggregate, including practitioner, facility, credential, service request, assignment, attendance, timesheet, invoice, payment, payout, dispute and incident, requires a state-transition model before implementation.

**10. Non-Functional Requirements and Nigerian Compliance**

| Assumption                    | Authority to confirm                  | Owner            | Status | Review date                |
|-------------------------------|---------------------------------------|------------------|--------|----------------------------|
| Medilink's legal role         | Nigerian legal counsel                | Founder or board | Open   | Before contracts           |
| Payment authorization model   | Payment provider and payments counsel | Finance lead     | Open   | Before Module 11           |
| NDPA obligations              | Privacy counsel or DPO                | DPO              | Open   | Before identity collection |
| Practitioner engagement rules | Relevant professional councils        | Compliance lead  | Open   | Before category launch     |

**10.1 Performance**

- Support at least 10,000 concurrent users at launch scale, with a scaling path as adoption grows.

- Sub-2-second response time for request submission and acceptance under normal load.

**10.2 Security and Regulatory Compliance**

- All personal, professional, and financial data encrypted in transit and at rest.

- Compliance with the Nigeria Data Protection Act, enforced by the Nigeria Data Protection Commission — covering consent, access control, encryption, audit logs, retention rules, breach management, and data-subject request handling. Medilink must also register with the NDPC as a data controller of major importance; a platform holding NINs, licence records and financial data for thousands of practitioners will meet that threshold, and registration is a precondition of lawful operation rather than a later formality.

- Practitioner credential verification aligned with MDCN's licensing, practitioner-status, CPD, and disciplinary records for doctors and dentists, with equivalent checks against NMCN and other relevant councils for other cadres.

- Sensitive identifiers such as NIN or BVN collected only where legally necessary, and only through an authorised verification provider.

- Payment processing conducted exclusively through licensed Nigerian payment partners; Medilink does not itself operate as a deposit-taking institution.

**10.3 Usability**

- Interface designed for varied levels of digital literacy across practitioners and facility staff.

- Comprehensive in-app help and documentation, with multilingual support planned for later phases.

**11. Delivery Phases**

|                                 |                                                                                                                                                                                                                         |
|---------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Phase**                       | **Scope**                                                                                                                                                                                                               |
| Phase 1 — Safe MVP              | Registration, facility verification, practitioner credentialing, availability, service requests, matching, scheduling, timesheets, agreed rates, payment-provider integration, notifications, audit logs, and disputes. |
| Phase 2 — Operational Expansion | Recurring shifts, replacement management, ratings, enhanced attendance, analytics, tax statements, credential-expiry automation, and support for multiple practitioner categories.                                      |
| Phase 3 — Healthcare Ecosystem  | Telemedicine, CPD, insurance partnerships, workforce forecasting, rural staffing programmes, clinical handover tooling, and government/regulator integrations.                                                          |

Recommended build order within Phase 1: authentication and access control; practitioner and facility profiles; credential verification; availability; service requests; matching and assignment; scheduling; attendance and timesheets; rates and contracts; billing and payments; notifications; cancellations and disputes; administration, audit, and compliance.

Two additions to this order follow from the revisions in this version. Identity assurance (Module 3) is built with credential verification, not after it, because a credential check on an unverified identity proves nothing. Fault determination and the sanction ladder (Module 12) ship with cancellations, since a no-show recorded without a fault decision cannot later be corrected fairly.

A caution on the size of Priority 0. Sixteen modules is a complete product, not a minimum system, and building all of them before earning anything carries the risk that the first real feedback arrives after the budget is spent. The following eight modules are sufficient to run a paid engagement end to end and to prove the platform works: authentication, practitioner profiles, credential and identity verification, facility management, service requests, matching and assignment, attendance and timesheets, and billing and settlement. Security, privacy and audit is not on that list because it is not a feature — it is built into each of the eight as they are written.

The remaining Priority 0 modules can start as manual operations and be automated once real usage has shown what they need to do:

- Disputes: a phone number and a spreadsheet. There will be very few in the first months, and handling them by hand is how Medilink learns what Module 13 should actually contain

- Contracts: one fixed engagement template rather than a versioned template engine

- Notifications: SMS and in-app only. Email, push and WhatsApp follow

- Scheduling: a list of upcoming assignments rather than a calendar with conflict detection

- Cancellations and sanctions: the fault field is recorded from day one, because a no-show recorded without a fault decision cannot be corrected fairly later, but a compliance officer applies sanctions by hand until the real patterns are visible

What must not be deferred: identity and credential verification, the fault field, and the audit record. Each of these is either a safety control or something that cannot be reconstructed retrospectively.

One further launch requirement sits outside the module list. Section 10.3 states that the interface must serve varied levels of digital literacy, and Module 26, Customer Support, is deferred to Priority 1 — which would leave a nurse who cannot complete registration at eleven at night with nowhere to go. A staffed telephone number and a WhatsApp line, available during working hours from the first day of operation, is a condition of launch rather than a later module. The ticketing system in Module 26 formalises a channel that must already exist.

The mobile application (Module 28, Flutter, Android first) is sequenced in Phase 2. Phase 1 serves practitioners through the Progressive Web App described in Module 27.

**11.1 Launch operating model**

Phase 1 should launch in one state first, using existing Medilink relationships where possible. Recruit and verify practitioners before facility onboarding so the first facility request can be filled quickly. The launch target is at least fifty verified practitioners across two or three specialties before approaching five to ten facilities.

The first fifty engagements should be hand-matched by operations staff even while the matching module produces rankings. This manual review is part of the learning loop: it validates ranking quality, captures local constraints, and protects reputation while usage is still small.

Do not open a second state until the first state fills reliably. The operating threshold is a sustained fill rate of roughly 70 percent or better, measured as the share of published requests that result in an attended shift.

First-month operating signals: fill rate; time from publish to confirmed; time from timesheet approval to practitioner paid; verification turnaround; practitioners returning for a second shift; facilities returning for a second request.

**11.2 Seed data required before registration**

Before the first registration, Medilink must populate versioned seed data for professional categories, regulators, specialties and subspecialties, credential types, Nigerian states and LGAs, public holidays for the current and following year, facility and ownership types, rate floors, one engagement agreement template, and notification templates.

Every configurable list must have a named owner and review date. Seed data must be loaded through versioned migrations so a fresh environment can be rebuilt from source without manual database entry.

**12. Key Risks and Mitigations**

|                                                                                                    |                                                                                                                                                                                                         |
|----------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Risk**                                                                                           | **Mitigation**                                                                                                                                                                                          |
| Unqualified or unlicensed practitioners accepting clinical work                                    | Mandatory credential verification (Module 3) before a profile can accept any request; automatic suspension on licence expiry.                                                                           |
| Unsafe “first-to-accept” matching                                                                  | Multi-factor matching with facility confirmation before an assignment is final (Module 7).                                                                                                              |
| Regulatory exposure from an informal wallet model                                                  | Ledger-plus-licensed-provider settlement model, reviewed by Nigerian payments and legal counsel (Section 8.4).                                                                                          |
| Data-protection non-compliance                                                                     | Dedicated Security, Privacy and Audit module (16) built to NDPA/NDPC requirements from day one.                                                                                                         |
| Unreliable connectivity affecting attendance capture and notifications                             | Non-GPS-dependent check-in fallback (OTP/QR/manual) and SMS-first notification strategy.                                                                                                                |
| Schema/technology mismatch slowing development                                                     | Single relational engine (PostgreSQL) used throughout, replacing the original MongoDB/AWS RDS pairing; object storage is separated out to Tigris.                                                       |
| Impersonation: a person operating an account issued in another practitioner's name                 | Identity assurance in Module 3 — NIN through an authorised provider, regulator register check, and selfie matched to the identification photograph; one verified identity may hold one active account   |
| Practitioners accepting shifts and failing to attend, leaving facilities unstaffed at short notice | Fault determination, graduated sanctions and reliability scoring in Module 12, with an excusal path so genuine emergencies are not punished                                                             |
| Sanctions applied unfairly, or lifted informally in exchange for payment                           | Only a Medilink Compliance Officer may apply, vary or lift a sanction; every action carries a stated reason and a retained audit record; financial settlement is kept separate from disciplinary record |
| Native mobile client diverging from web behaviour, or delaying the MVP                             | The Flutter client consumes the same versioned API and holds no business rules; sequenced as Module 28 after the API stabilises                                                                         |

**13. Conclusion**

Medilink is best understood not as “Uber for doctors” but as a verified, clinically governed healthcare workforce platform, in which correct qualifications, transparent terms, and reliable payment are built into every engagement rather than bolted on afterward. Built as a modular monolith on Next.js and PostgreSQL, with clear module boundaries, event-based communication, and configuration-driven extensibility, the platform can grow from a Phase 1 staffing-and-payment MVP into a broader healthcare workforce ecosystem — spanning telemedicine, CPD, insurance, and workforce forecasting — without requiring the core system to be rebuilt.

The central architectural principle to preserve at every stage of growth is simple: existing modules own their data, and new modules extend the system through public services, events, and interfaces — never by reaching directly into another module's internal tables.
