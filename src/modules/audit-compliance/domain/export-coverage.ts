/**
 * For every table the data inventory lists as being about a person: the section of
 * the export that returns it, or the reason it is left out (M17-03, AUD-07).
 * Pure, no database.
 *
 * `data-inventory.ts` is checked against the schema, so a new table cannot ship
 * without saying what it holds. This is checked against the inventory, so it cannot
 * ship without saying whether the person gets it back. The export used to be a
 * list somebody wrote once; eight kinds of data were missing from it for as long
 * as nobody compared it with anything.
 *
 * A section is a key of what `exportSubjectData` returns, and the integration test
 * fails if the two disagree in either direction. An exclusion is a sentence the
 * person reads, in the export itself, under `notIncluded`: a gap with no
 * explanation looks like an omission, and sometimes it is one.
 */

/** Why something is not in the export. Each is shown to the person, so each is written to them. */
export const EXCLUSIONS = {
  auditTrail:
    'The audit trail records what the platform did, not what it holds about you, and it names other people. It is retained under a legal obligation.',
  ledger:
    'Financial entries have another party on the other side of them. Your own payments appear under "payouts".',
  nin: 'Your NIN is not stored — only a keyed digest of it and the last four digits, which are shown.',
  bankAccountNumbers:
    'Your bank account numbers are stored sealed and are opened only to make a transfer to you. Only the last four digits are shown here, as they are everywhere else.',
  oneTimeCodes:
    'One-time codes and check-in codes are stored only as hashes, and are deleted within days. There is nothing readable to return, and returning a hash would help nobody but an attacker.',
  roleCatalogue:
    'The list of roles and what each may do is the platform\'s own configuration and is not about you. The roles you hold are under "roles".',
  hospitalRecords:
    'A hospital\'s own records — its details, the shifts it requested, its invoices and its rate cards — belong to the hospital. What they say about you is under "assignments", "invoiceLines" and "timesheets".',
  searchesByHospitals:
    'How a hospital\'s search ranked everyone it looked at includes other people. Your own place in each search is under "matchingScores".',
  fileContents:
    'The files themselves — documents, photographs, evidence and attachments — are not in this download. This lists each one; open it from the page it was attached to.',
  networkAddresses:
    'The network address of a sign-in attempt is not shown, because an attempt on your number may have been made by somebody else, and the address is theirs. The addresses of your own sessions are under "sessions".',
  incidentsAboutYou:
    'A report that names you as the person involved is not reproduced here. It may be part of a safety investigation and it describes other people, so compliance answers a request for it and the data protection officer decides what can be shared. Counsel should confirm this.',
  readsOfYourRecords:
    'The log of who read your records is kept under the person who read them, so only what you yourself did appears here. Ask compliance for the rest.',
  backgroundQueue:
    'The queue of work done after a request returns holds identifiers, not content, and is deleted once delivered.',
  publishedWording:
    'The wording of each version of the terms and privacy notice is public. Which you accepted, and when, is under "agreementsAccepted".',
  regulatorLists:
    'The regulator\'s lists of struck-off and unqualified people are about other people. Whether a screening matched you is under "screening".',
} as const;

export type ExclusionKey = keyof typeof EXCLUSIONS;

export type ExportCoverage =
  | {
      section: string;
      /** What is held under this table that the section leaves out, and why. */
      limits?: ExclusionKey[];
    }
  | { excluded: ExclusionKey };

export const EXPORT_COVERAGE: Record<string, ExportCoverage> = {
  'identity.users': { section: 'account' },
  'identity.devices': { section: 'devices' },
  'identity.roles': { excluded: 'roleCatalogue' },
  'identity.permissions': { excluded: 'roleCatalogue' },
  'identity.role_permissions': { excluded: 'roleCatalogue' },
  'identity.user_roles': { section: 'roles' },
  'identity.otp_codes': { excluded: 'oneTimeCodes' },
  'identity.sessions': { section: 'sessions' },
  'identity.login_attempts': { section: 'signInAttempts', limits: ['networkAddresses'] },

  'practitioners.practitioner_profiles': { section: 'profile' },
  'practitioners.professional_registrations': { section: 'professionalRegistrations' },
  'practitioners.screening_results': { section: 'screening', limits: ['regulatorLists'] },
  'practitioners.identity_verifications': { section: 'identityVerification', limits: ['nin'] },
  'credentials.credential_submissions': { section: 'credentials' },
  'storage.stored_objects': { section: 'files', limits: ['fileContents'] },

  'facilities.facilities': { excluded: 'hospitalRecords' },
  'service_requests.service_requests': { excluded: 'hospitalRecords' },
  'matching.invitations': { section: 'invitations' },
  'matching.assignments': { section: 'assignments' },
  'matching.assignment_status_history': { section: 'assignmentHistory' },
  'matching.match_runs': { excluded: 'searchesByHospitals' },
  'matching.match_candidates': { section: 'matchingScores', limits: ['searchesByHospitals'] },
  'availability.availability_slots': { section: 'availability' },
  'availability.blocked_periods': { section: 'availability' },

  'attendance.attendance_records': { section: 'attendance' },
  'attendance.checkin_events': { section: 'attendance' },
  'attendance.checkin_tokens': { excluded: 'oneTimeCodes' },
  'timesheets.timesheets': { section: 'timesheets' },
  'timesheets.timesheet_revisions': { section: 'timesheets' },

  'billing.invoices': { excluded: 'hospitalRecords' },
  'billing.invoice_lines': { section: 'invoiceLines' },
  'billing.ledger_entries': { excluded: 'ledger' },
  'billing.payouts': { section: 'payouts' },
  'rates.rate_cards': { excluded: 'hospitalRecords' },
  'billing.payout_accounts': { section: 'payoutAccounts', limits: ['bankAccountNumbers'] },

  'disputes.disputes': { section: 'disputes' },
  'disputes.dispute_evidence': { section: 'disputes', limits: ['fileContents'] },
  'clinical_incidents.clinical_incidents': {
    section: 'incidentsYouReported',
    limits: ['incidentsAboutYou'],
  },
  'clinical_incidents.incident_attachments': {
    section: 'incidentsYouReported',
    limits: ['fileContents'],
  },
  'clinical_incidents.account_suspensions': { section: 'suspensions' },
  'cancellations_sanctions.excusals': { section: 'excusals' },
  'cancellations_sanctions.unhonoured_assignments': { section: 'unhonouredShifts' },

  'consent.agreement_versions': { excluded: 'publishedWording' },
  'consent.agreement_acceptances': { section: 'agreementsAccepted' },
  'consent.consent_records': { section: 'consent' },
  'consent.data_subject_requests': { section: 'dataSubjectRequests' },

  'notifications.messages': { section: 'notifications' },
  'audit.audit_log': { excluded: 'auditTrail' },
  'audit.security_events': { section: 'securityEvents', limits: ['readsOfYourRecords'] },
  'audit.outbox_events': { excluded: 'backgroundQueue' },
  'audit.scheduled_jobs': { excluded: 'backgroundQueue' },
  'suggestions.suggestions': { section: 'suggestions' },
  'config.sanctioned_entries': { excluded: 'regulatorLists' },
};

/** Every section the export returns, once. The test holds the export to this list. */
export const EXPORT_SECTIONS: string[] = [
  ...new Set(
    Object.values(EXPORT_COVERAGE).flatMap((coverage) => ('section' in coverage ? [coverage.section] : [])),
  ),
];
