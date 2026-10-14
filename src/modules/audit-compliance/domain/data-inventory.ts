/**
 * What personal data the platform keeps, why, for how long, and what deletes it.
 * Pure, no database.
 *
 * **This is a proposal.** It is the product's own position, written down so that
 * counsel and the data protection officer have one place to read it and change it
 * (AUD-04, AUD-05). Nothing here has been signed off by either, and the lawful
 * bases are the team's reading, not legal advice. The periods in `PURGE_RULES`
 * are enforced by a scheduled job the moment they are deployed; everything else
 * is a statement of what is kept and, where one exists, a proposal that nothing
 * yet carries out (`notEnforced`).
 *
 * It is kept honest by a test that fails when the schema gains a table this does
 * not list, so a new table cannot ship before somebody has said what it holds
 * and what happens to it. `docs/data-inventory.md` is generated from this file
 * and a second test fails when the two differ.
 */

export const INVENTORY_STATUS =
  'PROPOSED. Not signed off by counsel or the data protection officer, and none of the lawful bases below has been confirmed by either.';

/**
 * What takes the data out of the system.
 *
 *   purge_job  a scheduled job deletes it after its period (see PURGE_RULES)
 *   erasure    it lives with the account, and a request to erase the person
 *              deletes it or replaces what identifies them (AUD-01)
 *   kept       a record the platform or the law needs; nothing deletes it
 *   reference  controlled vocabulary, not about a person
 */
export type Enforcement = 'purge_job' | 'erasure' | 'kept' | 'reference';

export interface PurgeRule {
  key: string;
  /** What is deleted, in words a reader outside engineering can check. */
  what: string;
  days: number;
  /** What the days are counted from. */
  after: string;
}

/**
 * The periods a job enforces. Short, and only for data no obligation could want
 * kept: one-time codes, sessions that have ended, the log of who tried to sign in,
 * queue entries already delivered and files nobody finished uploading.
 *
 * Changing a number here changes what the job deletes at its next run.
 */
export const PURGE_RULES: PurgeRule[] = [
  {
    key: 'sign_in_codes',
    what: 'One-time codes, used or not',
    days: 7,
    after: 'it was issued. A code is valid for ten minutes; the budget on how many may be sent looks back one hour.',
  },
  {
    key: 'sessions',
    what: 'Sessions that have ended',
    days: 30,
    after: 'it expired or was signed out. A live session is never touched.',
  },
  {
    key: 'sign_in_attempts',
    what: 'The log of sign-in attempts, with the number or identifier typed and the network address',
    days: 90,
    after: 'the attempt. The lockout looks back minutes, and a disputed lockout is raised within weeks.',
  },
  {
    key: 'background_queue',
    what: 'Entries in the background queue that were delivered',
    days: 30,
    after: 'delivery. Entries that failed or gave up are never purged: somebody still has to look at them.',
  },
  {
    key: 'abandoned_uploads',
    what: 'Files requested for upload that were never confirmed (the record of the request stays, marked deleted)',
    days: 7,
    after: 'the request. The link to upload expires within minutes; a week is long enough for a form left half filled to be finished.',
  },
];

export function purgeDaysFor(key: string): number {
  const rule = PURGE_RULES.find((candidate) => candidate.key === key);
  if (!rule) throw new Error(`"${key}" has no purge rule; that data is not purged.`);
  return rule.days;
}

export interface DataCategory {
  key: string;
  name: string;
  /** Every table, as `schema.table`. Each appears in exactly one category. */
  tables: string[];
  /** What is in it that is about a person. */
  holds: string;
  purpose: string;
  /** The lawful basis the team proposes. Counsel to confirm. */
  basis: string;
  /** The role that answers for it. */
  owner: string;
  /** How long it is kept, as the product does it today. */
  retention: string;
  enforcement: Enforcement;
  /** Purge rules that delete part or all of it. */
  purges?: string[];
  /**
   * A shorter retention the team would propose that nothing carries out yet.
   * Present means the gap is known and open.
   */
  notEnforced?: string;
}

const DPO = 'Data protection officer (not yet appointed)';

export const DATA_CATEGORIES: DataCategory[] = [
  {
    key: 'accounts',
    name: 'Accounts',
    tables: ['identity.users', 'identity.devices'],
    holds:
      'Full name, phone number, email address, a hash of the password, account status, sign-in times; device labels and push tokens.',
    purpose: 'To run the account and sign the person in.',
    basis: 'Contract: providing the service the person signed up for.',
    owner: 'Operations',
    retention:
      'For the life of the account. A request to erase replaces the name, number and email, deletes devices and closes the account.',
    enforcement: 'erasure',
  },
  {
    key: 'access_grants',
    name: 'Roles and who holds them',
    tables: [
      'identity.roles',
      'identity.permissions',
      'identity.role_permissions',
      'identity.user_roles',
    ],
    holds:
      'Which person holds which role over which hospital or area, who granted it and when. The role catalogue itself is not about a person.',
    purpose: 'To decide what each person may do, and to answer who could do what on a given day.',
    basis: 'Legitimate interest (security) and the accountability the platform owes its users.',
    owner: 'Platform engineering',
    retention:
      'Kept. A revoked grant stays, stamped, so past access can be reconstructed. Erasure revokes a person\'s grants and keeps the rows.',
    enforcement: 'kept',
  },
  {
    key: 'sign_in_codes',
    name: 'One-time codes',
    tables: ['identity.otp_codes'],
    holds: 'A hash of each code, what it was for, and the network address it was requested from.',
    purpose: 'To prove somebody controls a phone number, and to limit how many are sent.',
    basis: 'Legitimate interest (security).',
    owner: 'Platform engineering',
    retention: 'Deleted by the purge job (see below). Erasure deletes a person\'s earlier.',
    enforcement: 'purge_job',
    purges: ['sign_in_codes'],
  },
  {
    key: 'sessions',
    name: 'Sessions',
    tables: ['identity.sessions'],
    holds: 'A hash of the session token, the network address, the browser string, when step-up was last done.',
    purpose: 'To keep a person signed in, and to let them see and end their sessions.',
    basis: 'Contract: providing the service.',
    owner: 'Platform engineering',
    retention: 'Deleted by the purge job (see below). Erasure deletes a person\'s earlier.',
    enforcement: 'purge_job',
    purges: ['sessions'],
  },
  {
    key: 'sign_in_attempts',
    name: 'Sign-in attempts',
    tables: ['identity.login_attempts'],
    holds: 'The phone number or identifier typed, the network address, whether it worked and why not.',
    purpose: 'To slow down guessing, and to investigate an account somebody says was attacked or wrongly locked.',
    basis: 'Legitimate interest (security).',
    owner: 'Platform engineering',
    retention: 'Deleted by the purge job (see below). Erasure deletes a person\'s earlier.',
    enforcement: 'purge_job',
    purges: ['sign_in_attempts'],
  },
  {
    key: 'practitioner_records',
    name: 'Practitioner profile, registrations and screening',
    tables: [
      'practitioners.practitioner_profiles',
      'practitioners.professional_registrations',
      'practitioners.screening_results',
      'practitioners.identity_verifications',
    ],
    holds:
      'Profession, specialties, bio, photograph, home area; the register folio number and licence dates; the outcome of screening against the sanctions lists; a hash of the national identity number.',
    purpose: 'To decide whether a person may be offered work, and to show a hospital who is covering a shift.',
    basis: 'Contract, and the obligation to confirm a regulated professional is registered.',
    owner: 'Compliance',
    retention:
      'For the life of the account. Erasure replaces the profile and folio number, deletes the identity-number hash, and clears screening notes.',
    enforcement: 'erasure',
  },
  {
    key: 'credential_records',
    name: 'Credential submissions',
    tables: ['credentials.credential_submissions'],
    holds:
      'What a practitioner submitted as evidence, the reviewer\'s decision and notes, the expiry date, and the reference to the stored document.',
    purpose: 'To verify qualifications and licences before a person works.',
    basis: 'Contract, and the obligation to verify a regulated professional.',
    owner: 'Compliance',
    retention:
      'For the life of the account. Erasure clears the reviewer\'s notes and deletes the stored documents.',
    enforcement: 'erasure',
    notEnforced:
      'Proposed: the stored document of a submission that was rejected is deleted twelve months after the rejection, whether or not the person ever asks.',
  },
  {
    key: 'uploaded_files',
    name: 'Uploaded files',
    tables: ['storage.stored_objects'],
    holds:
      'A record of each file in storage (credential documents, licences, photographs, dispute evidence, incident attachments, timesheet attachments): its type, size, owner and key. The files themselves are in the bucket.',
    purpose: 'To keep what people uploaded as evidence, and to find it again.',
    basis: 'Contract, and the purpose of the thing each file is attached to.',
    owner: 'Compliance',
    retention:
      'With the record each file is attached to. Erasure deletes a person\'s files from storage. An upload nobody finished is deleted by the purge job.',
    enforcement: 'erasure',
    purges: ['abandoned_uploads'],
  },
  {
    key: 'facilities',
    name: 'Facilities',
    tables: ['facilities.facilities'],
    holds:
      'Name, registration reference (CAC, ministry or other), address, contact number and email, the licence file, the verification decision and what was checked.',
    purpose: 'To verify a hospital before it can request staff, and to contact it.',
    basis: 'Contract.',
    owner: 'Operations',
    retention:
      'For as long as the facility is on the platform, and after that for as long as its invoices must be kept.',
    enforcement: 'kept',
  },
  {
    key: 'shifts_and_matching',
    name: 'Shift requests, offers and assignments',
    tables: [
      'service_requests.service_requests',
      'matching.invitations',
      'matching.assignments',
      'matching.assignment_status_history',
      'matching.match_runs',
      'matching.match_candidates',
    ],
    holds:
      'The shift a hospital asked for, who was offered it, who accepted, how each status changed and why; how every candidate was scored and ranked on a search.',
    purpose: 'To arrange shifts and to answer afterwards who covered a ward and how they came to.',
    basis: 'Contract.',
    owner: 'Operations',
    retention:
      'Kept: it is the hospital\'s record of who covered a ward and the basis of what was paid. Erasure removes a decline reason and leaves the rest.',
    enforcement: 'kept',
    notEnforced:
      'Proposed: the scores and rankings of a search (match runs and candidates) are deleted twelve months after the search, once a booking is settled.',
  },
  {
    key: 'availability',
    name: 'Availability',
    tables: ['availability.availability_slots', 'availability.blocked_periods'],
    holds: 'When a practitioner said they could work, and the periods they blocked.',
    purpose: 'To offer a person only shifts they could take.',
    basis: 'Contract.',
    owner: 'Operations',
    retention: 'For the life of the account. Erasure deletes it.',
    enforcement: 'erasure',
    notEnforced: 'Proposed: slots and blocks that ended more than twelve months ago are deleted.',
  },
  {
    key: 'attendance',
    name: 'Attendance',
    tables: [
      'attendance.attendance_records',
      'attendance.checkin_events',
      'attendance.checkin_tokens',
    ],
    holds:
      'When a practitioner checked in and out, how, and who confirmed it; hashes of the one-time codes used; a device label.',
    purpose: 'To show a shift was worked, which is the basis of the hours that are paid.',
    basis: 'Contract.',
    owner: 'Operations',
    retention:
      'Kept with the shift. One-time codes are short-lived and go with their attendance record. Erasure clears the device label.',
    enforcement: 'kept',
  },
  {
    key: 'timesheets',
    name: 'Timesheets',
    tables: ['timesheets.timesheets', 'timesheets.timesheet_revisions'],
    holds: 'Hours claimed, any correction and the reason, and who approved or rejected them.',
    purpose: 'To settle what a hospital owes and a practitioner is paid.',
    basis: 'Contract, and the accounting obligation.',
    owner: 'Finance',
    retention: 'Kept with the invoices that rest on them.',
    enforcement: 'kept',
  },
  {
    key: 'money',
    name: 'Invoices, ledger, payouts and rates',
    tables: [
      'billing.invoices',
      'billing.invoice_lines',
      'billing.ledger_entries',
      'billing.payouts',
      'rates.rate_cards',
    ],
    holds:
      'What was invoiced and paid, who was owed what and when it was released, the rate agreed. Records that money moved, not who the person is.',
    purpose: 'To bill hospitals and pay practitioners, and to account for it.',
    basis: 'Legal obligation (tax and accounting) and contract.',
    owner: 'Finance',
    retention:
      'Kept, and never deleted today. The legal period is to be confirmed by counsel and an accountant.',
    enforcement: 'kept',
  },
  {
    key: 'disputes',
    name: 'Disputes',
    tables: ['disputes.disputes', 'disputes.dispute_evidence'],
    holds: 'What was disputed, by whom, the evidence each side gave and the decision.',
    purpose: 'To settle a disagreement about a shift or its pay.',
    basis: 'Contract, and the legitimate interest of both parties in a fair decision.',
    owner: 'Operations',
    retention:
      'Kept: it is also the record of the other party and cannot be removed at one person\'s request.',
    enforcement: 'kept',
  },
  {
    key: 'incidents',
    name: 'Clinical incidents and suspensions',
    tables: [
      'clinical_incidents.clinical_incidents',
      'clinical_incidents.incident_attachments',
      'clinical_incidents.account_suspensions',
    ],
    holds:
      'A report of something that went wrong on a shift, its severity and attachments, and any suspension of an account that followed, with the reason.',
    purpose: 'Patient safety, and a fair record of why somebody was suspended.',
    basis: 'Legitimate interest (patient safety) and legal obligation where one applies.',
    owner: 'Compliance',
    retention:
      'Kept: each is also the record of another person or of patient safety. A report must not name a patient.',
    enforcement: 'kept',
  },
  {
    key: 'cancellations',
    name: 'Cancellations and unhonoured shifts',
    tables: [
      'cancellations_sanctions.excusals',
      'cancellations_sanctions.unhonoured_assignments',
    ],
    holds: 'Shifts a practitioner did not attend, whether the absence was excused and why, and any fault decided.',
    purpose: 'To treat absence fairly and to keep the platform reliable.',
    basis: 'Contract.',
    owner: 'Operations',
    retention: 'Kept with the shift.',
    enforcement: 'kept',
  },
  {
    key: 'agreements',
    name: 'Agreements, consent and data requests',
    tables: [
      'consent.agreement_versions',
      'consent.agreement_acceptances',
      'consent.consent_records',
      'consent.data_subject_requests',
    ],
    holds:
      'The wording of each version of the terms and privacy notice, who accepted which and when; each consent given or withdrawn; each request to see or erase data and how it was answered.',
    purpose: 'To show what a person agreed to, and that requests were answered.',
    basis: 'Legal obligation (accountability) and consent.',
    owner: DPO,
    retention:
      'Kept as evidence. Erasure removes the notes a person wrote and the device they used, and keeps that they accepted and when.',
    enforcement: 'kept',
  },
  {
    key: 'notifications',
    name: 'Messages sent',
    tables: ['notifications.messages'],
    holds:
      'Every text or notice sent: who to (masked), what it said, when, and whether it arrived. The wording can mention a shift, an amount or a decision.',
    purpose: 'To avoid telling a person the same thing twice, and to show what they were told.',
    basis: 'Contract, and legitimate interest.',
    owner: 'Operations',
    retention: 'Kept. Erasure deletes a person\'s messages.',
    enforcement: 'erasure',
    notEnforced: 'Proposed: messages are deleted twelve months after they were sent.',
  },
  {
    key: 'audit_trail',
    name: 'Audit trail',
    tables: ['audit.audit_log'],
    holds:
      'Who did what to what, and when: identifiers, the reason given and the before and after of the change. Names, email addresses and phone numbers are not written into it.',
    purpose: 'Accountability for every change the platform makes.',
    basis: 'Legal obligation and legitimate interest.',
    owner: DPO,
    retention:
      'Kept, and not deleted: the person is told so before they ask. Rows written before the privacy change (AUD-02) may still hold what that change now keeps out.',
    enforcement: 'kept',
  },
  {
    key: 'security_events',
    name: 'Security events',
    tables: ['audit.security_events'],
    holds: 'That somebody read a sensitive record, who, and when.',
    purpose: 'Evidence of who looked at what, for a record that is read but not changed.',
    basis: 'Legitimate interest (security).',
    owner: 'Platform engineering',
    retention: 'Kept. Erasure removes the person from the events that name them.',
    enforcement: 'erasure',
    notEnforced: 'Proposed: events are deleted twenty-four months after they happened.',
  },
  {
    key: 'background_queue',
    name: 'Background queue and scheduled jobs',
    tables: ['audit.outbox_events', 'audit.scheduled_jobs'],
    holds:
      'The queue of work done after a request returns (identifiers and what happened), and the definitions and last results of the scheduled jobs. The job table is configuration.',
    purpose: 'To deliver texts, reminders and sweeps reliably.',
    basis: 'Legitimate interest.',
    owner: 'Platform engineering',
    retention: 'Delivered entries are deleted by the purge job (see below); entries that failed are kept for somebody to look at.',
    enforcement: 'purge_job',
    purges: ['background_queue'],
  },
  {
    key: 'suggestions',
    name: 'Suggestions',
    tables: ['suggestions.suggestions'],
    holds: 'What a user suggested, in their words, and who raised it.',
    purpose: 'To learn what is not working.',
    basis: 'Legitimate interest.',
    owner: 'Operations',
    retention: 'Kept. Erasure removes the author.',
    enforcement: 'erasure',
  },
  {
    key: 'sanctions_list',
    name: 'Sanctions and quack lists',
    tables: ['config.sanctioned_entries'],
    holds: 'Names and register numbers of people a regulator has struck off or named as unqualified.',
    purpose: 'To refuse work to somebody who may not practise.',
    basis: 'Legal obligation and legitimate interest (patient safety).',
    owner: 'Compliance',
    retention: 'While the entry is on the regulator\'s list; a removed entry is kept, stamped, with who removed it and why.',
    enforcement: 'kept',
  },
  {
    key: 'reference_data',
    name: 'Reference data',
    tables: [
      'config.credential_requirements',
      'config.credential_types',
      'config.facility_types',
      'config.lgas',
      'config.professional_categories',
      'config.public_holidays',
      'config.rate_floors',
      'config.specialties',
      'config.states',
    ],
    holds: 'Professions, credential types, facility types, geography, public holidays, rate floors. Nothing about a person.',
    purpose: 'The vocabulary the rest of the platform is checked against.',
    basis: 'Not personal data.',
    owner: 'Compliance',
    retention: 'Kept.',
    enforcement: 'reference',
  },
];

const ENFORCEMENT_WORDS: Record<Enforcement, string> = {
  purge_job: 'Deleted by a scheduled job',
  erasure: 'Deleted or replaced when the person asks to be erased',
  kept: 'Kept; nothing deletes it',
  reference: 'Not about a person',
};

/** The Markdown counsel reads. `docs/data-inventory.md` is exactly this. */
export function renderInventory(): string {
  const lines: string[] = [
    '# Data inventory and retention (proposed)',
    '',
    `**${INVENTORY_STATUS}**`,
    '',
    'Generated from `src/modules/audit-compliance/domain/data-inventory.ts` by `pnpm tsx scripts/render-data-inventory.ts`. Do not edit this file by hand: change that one, and a test fails until this is regenerated.',
    '',
    'It says, for each kind of data the platform keeps: what it holds, why, on what basis, who answers for it, how long it is kept, and what takes it out of the system. A category marked "Proposed, not enforced" has a shorter period the team would suggest that nothing carries out yet.',
    '',
    '## What is deleted automatically',
    '',
    'A scheduled job (`retention.purge_sweep`, daily) deletes only what no obligation could want kept. Each run that deletes anything writes one audit row with counts and nothing about a person.',
    '',
    '| Data | Deleted after | Counted from |',
    '| --- | --- | --- |',
    ...PURGE_RULES.map((rule) => `| ${rule.what} | ${rule.days} days | ${rule.after} |`),
    '',
    '## Categories',
  ];

  for (const category of DATA_CATEGORIES) {
    lines.push(
      '',
      `### ${category.name}`,
      '',
      `- **Tables:** ${category.tables.map((table) => `\`${table}\``).join(', ')}`,
      `- **Holds:** ${category.holds}`,
      `- **Purpose:** ${category.purpose}`,
      `- **Proposed basis:** ${category.basis}`,
      `- **Owner:** ${category.owner}`,
      `- **Retention today:** ${category.retention}`,
      `- **What removes it:** ${ENFORCEMENT_WORDS[category.enforcement]}${
        category.purges ? ` (${category.purges.map((key) => `${purgeDaysFor(key)} days`).join(', ')})` : ''
      }`,
    );
    if (category.notEnforced) lines.push(`- **Proposed, not enforced:** ${category.notEnforced}`);
  }

  lines.push(
    '',
    '## For sign-off',
    '',
    'Counsel and the data protection officer are asked to confirm or change: the lawful basis for each category; the length of time money records, disputes, incidents and the audit trail are kept; each period in the table above; and each "Proposed, not enforced" line, which is a decision to delete something nobody now deletes.',
    '',
  );

  return lines.join('\n');
}
