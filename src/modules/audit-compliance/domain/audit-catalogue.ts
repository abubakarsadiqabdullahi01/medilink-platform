/**
 * What the platform records, and why each record exists (M17-01). Pure, no database.
 *
 * `audit.audit_log` carries one row for every change of state, written in the transaction of the
 * change (`src/lib/audit.ts`). `audit-coverage.ts` fails a test when a table is written with no
 * row at all; this says which rows, so "does the trail show who did X?" is answered by reading a
 * list and not by searching a hundred call sites. `audit-catalogue.test.ts` holds it to the code
 * from both sides: every action the code writes is here, and every action here is written.
 *
 * An action's name is `thing.what_happened`, searchable as it stands. Its `entity` is the table
 * the row is written against, which is what the audit screen filters by.
 */

export const AUDIT_CATEGORIES = {
  security:
    'Who gets in and what they may do: sign-up, sign-in, sessions, one-time codes, roles, and suspension.',
  verification:
    'Whether a person or a facility is who they say: credentials, registrations, identity, and the checks before anybody is let onto a shift.',
  booking:
    'Offering, confirming and cancelling shifts: requests, invitations, assignments, the search that ranked people, and availability.',
  work:
    'The record of hours worked: check-in and check-out, corrections to attendance, and timesheets.',
  money:
    'Invoices, payments to practitioners, the accounts they are paid to, and the rates that decide the figures.',
  sanctions:
    'Consequences for people and the lists behind them: sanctions lists and screening, missed shifts, who was at fault, and excusals.',
  safety:
    'Disputes about hours and pay, and clinical incidents reported at a facility.',
  privacy:
    'What people agreed to and what they asked for: consent, agreements accepted, and data-subject requests including erasure.',
  admin:
    'What the people who run the platform change: reference data, the holiday calendar, agreements published, and the platform’s own housekeeping.',
  feedback: 'What people tell the platform about itself.',
} as const;

export type AuditCategory = keyof typeof AUDIT_CATEGORIES;

/** The kinds of decision the completion plan names. Each must have a real set of actions behind it. */
export const REQUIRED_CATEGORIES: AuditCategory[] = [
  'security',
  'verification',
  'booking',
  'money',
  'sanctions',
  'admin',
];

export interface AuditAction {
  category: AuditCategory;
  /** The table the row names, as `schema.table`. */
  entity: string;
  /** What the row says happened, and what it holds. */
  what: string;
}

export const AUDIT_CATALOGUE: Record<string, AuditAction> = {
  // ─── Security ───────────────────────────────────────────────────────────────
  'auth.registration_started': {
    category: 'security',
    entity: 'identity.users',
    what: 'An account was created at sign-up with the phone number given, before anything about it was verified.',
  },
  'auth.otp_issued': {
    category: 'security',
    entity: 'identity.otp_codes',
    what: 'A one-time code was sent to a phone for a stated purpose; the number is masked and the code is never recorded.',
  },
  'auth.otp_attempt_failed': {
    category: 'security',
    entity: 'identity.otp_codes',
    what: 'A wrong code was entered, and counted against the limit on guesses for that code.',
  },
  'auth.phone_verified': {
    category: 'security',
    entity: 'identity.users',
    what: 'The person proved they hold the phone by entering the code, and the number was marked verified.',
  },
  'auth.password_set': {
    category: 'security',
    entity: 'identity.users',
    what: 'A password was set on a new account at the end of sign-up, with whether it is staff or a practitioner.',
  },
  'auth.password_reset': {
    category: 'security',
    entity: 'identity.users',
    what: 'A forgotten password was replaced after the person proved the phone; every session the account had was ended, which is recorded as auth.all_sessions_revoked.',
  },
  'auth.session_issued': {
    category: 'security',
    entity: 'identity.sessions',
    what: 'A sign-in succeeded and a session began, with the network address it came from.',
  },
  'auth.session_revoked': {
    category: 'security',
    entity: 'identity.sessions',
    what: 'One session was ended, with who ended it and the reason.',
  },
  'auth.all_sessions_revoked': {
    category: 'security',
    entity: 'identity.sessions',
    what: 'Every session an account had was ended at once, with how many and why.',
  },
  'auth.step_up': {
    category: 'security',
    entity: 'identity.sessions',
    what: 'The person confirmed their password again to do something sensitive, and the session was marked as freshly confirmed at that moment.',
  },
  'auth.role_granted': {
    category: 'security',
    entity: 'identity.user_roles',
    what: 'The practitioner role was given automatically to a new practitioner, by the platform and not by a person.',
  },
  'role.granted': {
    category: 'security',
    entity: 'identity.user_roles',
    what: 'A role was given to a person at a scope by another person, with the permissions it carries, and audited at the scope it affects.',
  },
  'role.revoked': {
    category: 'security',
    entity: 'identity.user_roles',
    what: 'A role was taken away from a person at a scope, with who did it, which role and the reason.',
  },
  'facility.role_granted': {
    category: 'security',
    entity: 'identity.user_roles',
    what: 'The person who registered a facility was made its owner, as part of creating it.',
  },
  'user.suspended': {
    category: 'security',
    entity: 'identity.users',
    what: 'An account was suspended, with the reason, who did it, and the incident that caused it when there was one.',
  },
  'user.reinstated': {
    category: 'security',
    entity: 'identity.users',
    what: 'A suspended account was reinstated, with who lifted it and why.',
  },
  'administrator.bootstrapped': {
    category: 'security',
    entity: 'identity.users',
    what: 'The first platform administrator was created from the command line; it is refused once one exists.',
  },

  // ─── Verification ───────────────────────────────────────────────────────────
  'credential.submitted': {
    category: 'verification',
    entity: 'credentials.credential_submissions',
    what: 'A practitioner submitted a credential for review, with its state as submitted; a reference number that holds a NIN is masked.',
  },
  'credential.document_upload_requested': {
    category: 'verification',
    entity: 'storage.stored_objects',
    what: 'A practitioner asked to upload the document for a credential and was given a place to put it.',
  },
  'credential.document_confirmed': {
    category: 'verification',
    entity: 'storage.stored_objects',
    what: 'A credential document was confirmed as received in storage.',
  },
  'credential.resupplied': {
    category: 'verification',
    entity: 'credentials.credential_submissions',
    what: 'A practitioner sent a credential again after the reviewer asked for more, with the state before and after.',
  },
  'credential.verified': {
    category: 'verification',
    entity: 'credentials.credential_submissions',
    what: 'A reviewer verified a credential, with who did and the notes they gave.',
  },
  'credential.rejected': {
    category: 'verification',
    entity: 'credentials.credential_submissions',
    what: 'A reviewer rejected a credential, with who did and the reason they gave.',
  },
  'credential.info_requested': {
    category: 'verification',
    entity: 'credentials.credential_submissions',
    what: 'A reviewer asked the practitioner for more about a credential, with who asked and what was asked.',
  },
  'credential.expired': {
    category: 'verification',
    entity: 'credentials.credential_submissions',
    what: 'A verified credential passed its expiry date and was marked expired, by the platform.',
  },
  'practitioner.profile_created': {
    category: 'verification',
    entity: 'practitioners.practitioner_profiles',
    what: 'A practitioner created their profile, with the profile as it was created.',
  },
  'practitioner.profile_updated': {
    category: 'verification',
    entity: 'practitioners.practitioner_profiles',
    what: 'A practitioner changed their profile, with the state before and after.',
  },
  'practitioner.photo_upload_requested': {
    category: 'verification',
    entity: 'storage.stored_objects',
    what: 'A practitioner asked to upload a profile photo and was given a place to put it.',
  },
  'practitioner.photo_confirmed': {
    category: 'verification',
    entity: 'storage.stored_objects',
    what: 'A profile photo was confirmed as received in storage.',
  },
  'practitioner.submitted_for_review': {
    category: 'verification',
    entity: 'practitioners.practitioner_profiles',
    what: 'A practitioner sent their application for approval once it was complete, with the time it was sent.',
  },
  'practitioner.returned_for_changes': {
    category: 'verification',
    entity: 'practitioners.practitioner_profiles',
    what: 'An officer sent an application back to the practitioner, with who did and what had to change.',
  },
  'practitioner.activated': {
    category: 'verification',
    entity: 'identity.users',
    what: 'A practitioner became active, by the platform, because every eligibility requirement was met.',
  },
  'practitioner.identity_verified': {
    category: 'verification',
    entity: 'practitioners.identity_verifications',
    what: 'A practitioner’s identity was recorded as verified, with the method, whether the name matched and the last four digits of the NIN; the NIN itself is never recorded.',
  },
  'practitioner.registration_recorded': {
    category: 'verification',
    entity: 'practitioners.professional_registrations',
    what: 'An officer recorded a practitioner’s regulator registration, with the state before and after.',
  },
  'practitioner.registration_expired': {
    category: 'verification',
    entity: 'practitioners.professional_registrations',
    what: 'A practitioner’s registration passed its expiry date and was marked expired, by the platform.',
  },
  'practitioner.standing_recorded': {
    category: 'verification',
    entity: 'practitioners.professional_registrations',
    what: 'An officer recorded a practitioner’s level and registration category, which only an officer can set.',
  },
  'facility.created': {
    category: 'verification',
    entity: 'facilities.facilities',
    what: 'A facility was registered, with its details as registered, and began as pending.',
  },
  'facility.updated': {
    category: 'verification',
    entity: 'facilities.facilities',
    what: 'A facility’s details were changed, with the state before and after.',
  },
  'facility.licence_upload_requested': {
    category: 'verification',
    entity: 'storage.stored_objects',
    what: 'A facility asked to upload its licence and was given a place to put it.',
  },
  'facility.licence_confirmed': {
    category: 'verification',
    entity: 'storage.stored_objects',
    what: 'A facility’s licence document was confirmed as received in storage.',
  },
  'facility.licence_replaced': {
    category: 'verification',
    entity: 'facilities.facilities',
    what: 'A verified facility replaced its licence, which returned it to review until the new one is checked.',
  },
  'facility.resubmitted': {
    category: 'verification',
    entity: 'facilities.facilities',
    what: 'A rejected facility sent its registration in again after changing it.',
  },
  'facility.verified': {
    category: 'verification',
    entity: 'facilities.facilities',
    what: 'An officer verified a facility, with who did, the notes and which checks were confirmed.',
  },
  'facility.rejected': {
    category: 'verification',
    entity: 'facilities.facilities',
    what: 'An officer rejected a facility, with who did and the reason given.',
  },

  // ─── Booking ────────────────────────────────────────────────────────────────
  'service_request.created': {
    category: 'booking',
    entity: 'service_requests.service_requests',
    what: 'A facility drafted a shift request, with who drafted it.',
  },
  'service_request.published': {
    category: 'booking',
    entity: 'service_requests.service_requests',
    what: 'A facility published a shift request so practitioners can be offered it.',
  },
  'service_request.cancelled': {
    category: 'booking',
    entity: 'service_requests.service_requests',
    what: 'A facility cancelled a shift request, with the reason, and every booking on it was cancelled with it.',
  },
  'service_request.expired': {
    category: 'booking',
    entity: 'service_requests.service_requests',
    what: 'A request reached its start time without being filled and was closed by the platform, with how many offers were withdrawn.',
  },
  'service_request.filled': {
    category: 'booking',
    entity: 'service_requests.service_requests',
    what: 'The last place on a request was taken, closing it to further offers.',
  },
  'service_request.reopened': {
    category: 'booking',
    entity: 'service_requests.service_requests',
    what: 'A filled request was opened again because a confirmed booking on it was cancelled, with who cancelled and why.',
  },
  'matching.run': {
    category: 'booking',
    entity: 'matching.match_runs',
    what: 'A facility searched for practitioners for a request, with how many were considered and how many ranked.',
  },
  'assignment.invited': {
    category: 'booking',
    entity: 'matching.invitations',
    what: 'A practitioner was offered a shift, with who offered it.',
  },
  'assignment.reinvited': {
    category: 'booking',
    entity: 'matching.invitations',
    what: 'A practitioner whose earlier offer for the same shift had ended was offered it again.',
  },
  'assignment.invitation_accepted': {
    category: 'booking',
    entity: 'matching.invitations',
    what: 'A practitioner accepted an offer, with the offer before and after.',
  },
  'assignment.invitation_declined': {
    category: 'booking',
    entity: 'matching.invitations',
    what: 'A practitioner declined an offer, with the reason they gave if any.',
  },
  'assignment.invitation_withdrawn': {
    category: 'booking',
    entity: 'matching.invitations',
    what: 'An offer was withdrawn before it was answered, by an officer or by the platform when the shift filled or expired, with the reason.',
  },
  'assignment.confirmed': {
    category: 'booking',
    entity: 'matching.assignments',
    what: 'A facility confirmed a practitioner onto a shift, with who confirmed.',
  },
  'assignment.cancelled': {
    category: 'booking',
    entity: 'matching.assignments',
    what: 'A confirmed booking was cancelled, with who cancelled and the reason.',
  },
  'assignment.completed': {
    category: 'booking',
    entity: 'matching.assignments',
    what: 'A shift was completed once its hours were approved.',
  },
  'assignment.no_show': {
    category: 'booking',
    entity: 'matching.assignments',
    what: 'A confirmed practitioner was recorded as not having attended, with who decided and why.',
  },
  'availability.slot_added': {
    category: 'booking',
    entity: 'availability.availability_slots',
    what: 'A practitioner added a recurring or one-off period when they are free.',
  },
  'availability.slot_removed': {
    category: 'booking',
    entity: 'availability.availability_slots',
    what: 'A practitioner removed a period when they were free.',
  },
  'availability.block_added': {
    category: 'booking',
    entity: 'availability.blocked_periods',
    what: 'A practitioner blocked out a period when they cannot work.',
  },
  'availability.block_removed': {
    category: 'booking',
    entity: 'availability.blocked_periods',
    what: 'A practitioner removed a blocked period.',
  },

  // ─── Work ───────────────────────────────────────────────────────────────────
  'attendance.token_issued': {
    category: 'work',
    entity: 'attendance.checkin_tokens',
    what: 'A supervisor issued a check-in or check-out code; the code itself is never recorded, only its purpose and expiry.',
  },
  'attendance.checked_in': {
    category: 'work',
    entity: 'attendance.attendance_records',
    what: 'A practitioner checked in to a shift with a valid code, with the attendance record before and after.',
  },
  'attendance.checked_out': {
    category: 'work',
    entity: 'attendance.attendance_records',
    what: 'A practitioner checked out of a shift with a valid code, with the attendance record before and after.',
  },
  'attendance.recorded_manually': {
    category: 'work',
    entity: 'attendance.attendance_records',
    what: 'An officer recorded or corrected check-in and check-out times by hand, with the reason, and the times before and after.',
  },
  'attendance.disputed': {
    category: 'work',
    entity: 'attendance.attendance_records',
    what: 'The hours on an attendance record were disputed, with who disputed and the state it was in before.',
  },
  'attendance.dispute_upheld': {
    category: 'work',
    entity: 'attendance.attendance_records',
    what: 'A dispute about attendance was decided in favour of the person who raised it, with who decided and why.',
  },
  'attendance.dispute_dismissed': {
    category: 'work',
    entity: 'attendance.attendance_records',
    what: 'A dispute about attendance was decided against the person who raised it, with who decided and why.',
  },
  'timesheet.submitted': {
    category: 'work',
    entity: 'timesheets.timesheets',
    what: 'A practitioner submitted their hours for approval, with the billable minutes and amount worked out from attendance.',
  },
  'timesheet.approved': {
    category: 'work',
    entity: 'timesheets.timesheets',
    what: 'A facility approved a practitioner’s hours, with who approved and the figures they saw.',
  },
  'timesheet.rejected': {
    category: 'work',
    entity: 'timesheets.timesheets',
    what: 'A facility sent a practitioner’s hours back, with who did and the reason given.',
  },
  'timesheet.corrected': {
    category: 'work',
    entity: 'timesheets.timesheets',
    what: 'An officer corrected a sheet, with the reason, and the revision and amount before and after.',
  },
  'timesheet.recalculated': {
    category: 'work',
    entity: 'timesheets.timesheets',
    what: 'A sheet was worked out again at approval because the calendar or rate had moved since, with the amount before and after.',
  },

  // ─── Money ──────────────────────────────────────────────────────────────────
  'invoice.created': {
    category: 'money',
    entity: 'billing.invoices',
    what: 'A draft invoice was generated for a facility for a period, from the hours approved in it.',
  },
  'invoice.issued': {
    category: 'money',
    entity: 'billing.invoices',
    what: 'An invoice was issued to a facility, and its figures stopped changing.',
  },
  'invoice.paid': {
    category: 'money',
    entity: 'billing.invoices',
    what: 'A payment from a facility was recorded against an invoice, with the amount and date; the payer and bank reference are kept out.',
  },
  'invoice.voided': {
    category: 'money',
    entity: 'billing.invoices',
    what: 'An invoice was voided, with who did, the reason and the amount it had been for.',
  },
  'payout.prepared': {
    category: 'money',
    entity: 'billing.payouts',
    what: 'A payout to a practitioner was prepared from what they are owed, with the amount and who prepared it.',
  },
  'payout.release_started': {
    category: 'money',
    entity: 'billing.payouts',
    what: 'An officer authorised a payout’s release, written in the same transaction as the claim and before the gateway is asked.',
  },
  'payout.released': {
    category: 'money',
    entity: 'billing.payouts',
    what: 'The gateway took a payout and has not yet settled it, with its reference.',
  },
  'payout.settled': {
    category: 'money',
    entity: 'billing.payouts',
    what: 'A payout was settled and its ledger entries written, by the gateway or by finance recording a bank transfer; a bank reference typed by hand is recorded as present and kept out of the row.',
  },
  'payout.failed': {
    category: 'money',
    entity: 'billing.payouts',
    what: 'A payout failed, with the reason, and the money became payable again.',
  },
  'payout.cancelled': {
    category: 'money',
    entity: 'billing.payouts',
    what: 'A prepared payout was cancelled before it was released, with who did and the reason.',
  },
  'payout_account.submitted': {
    category: 'money',
    entity: 'billing.payout_accounts',
    what: 'A practitioner gave a bank account to be paid into; only its last four digits are recorded.',
  },
  'payout_account.verified': {
    category: 'money',
    entity: 'billing.payout_accounts',
    what: 'An officer verified a practitioner’s bank account, with the note, the last four digits and whether a check was overridden.',
  },
  'payout_account.rejected': {
    category: 'money',
    entity: 'billing.payout_accounts',
    what: 'An officer rejected a practitioner’s bank account, with the note and the last four digits.',
  },
  'payout_account.revealed': {
    category: 'money',
    entity: 'billing.payout_accounts',
    what: 'An officer opened a practitioner’s full account number to make a transfer, with who did and how many accounts were opened.',
  },
  'rate_card.created': {
    category: 'money',
    entity: 'rates.rate_cards',
    what: 'A facility’s rate card was set, replacing the active one from a date.',
  },
  'rate_floor.set': {
    category: 'money',
    entity: 'config.rate_floors',
    what: 'A minimum hourly rate was set for a kind of shift, with the new figure and who set it.',
  },

  // ─── Sanctions ──────────────────────────────────────────────────────────────
  'sanction_list.entries_added': {
    category: 'sanctions',
    entity: 'config.sanctioned_entries',
    what: 'Entries were added to a sanctions list, with how many and from which lists; the names are not recorded.',
  },
  'sanction_list.entry_removed': {
    category: 'sanctions',
    entity: 'config.sanctioned_entries',
    what: 'An entry was removed from a sanctions list, with who removed it and why.',
  },
  'practitioner.screening_flagged': {
    category: 'sanctions',
    entity: 'practitioners.screening_results',
    what: 'Screening matched a practitioner to a sanctions list, and they were flagged for an officer to look at.',
  },
  'practitioner.screening_cleared': {
    category: 'sanctions',
    entity: 'practitioners.screening_results',
    what: 'A screening flag was cleared, by an officer with the reason, or by the platform when the list entry it matched was removed.',
  },
  'assignment.unhonoured_flagged': {
    category: 'sanctions',
    entity: 'cancellations_sanctions.unhonoured_assignments',
    what: 'A confirmed shift passed with nobody checked in and was flagged for a decision, by the sweep and not a person.',
  },
  'assignment.fault_recorded': {
    category: 'sanctions',
    entity: 'cancellations_sanctions.unhonoured_assignments',
    what: 'An officer decided whose fault a missed shift was, with the reason, closing the case.',
  },
  'excusal.requested': {
    category: 'sanctions',
    entity: 'cancellations_sanctions.excusals',
    what: 'A practitioner asked to be excused for a missed shift, with the reason they gave.',
  },
  'excusal.granted': {
    category: 'sanctions',
    entity: 'cancellations_sanctions.excusals',
    what: 'An officer granted an excusal, with who did and why.',
  },
  'excusal.refused': {
    category: 'sanctions',
    entity: 'cancellations_sanctions.excusals',
    what: 'An officer refused an excusal, with who did and why.',
  },

  // ─── Safety ─────────────────────────────────────────────────────────────────
  'dispute.opened': {
    category: 'safety',
    entity: 'disputes.disputes',
    what: 'A practitioner or a facility opened a dispute about a shift, with the category, which side raised it and the reason given.',
  },
  'dispute.review_started': {
    category: 'safety',
    entity: 'disputes.disputes',
    what: 'An officer took up a dispute for review.',
  },
  'dispute.upheld': {
    category: 'safety',
    entity: 'disputes.disputes',
    what: 'An officer decided a dispute in favour of the party who raised it, with the reasons.',
  },
  'dispute.dismissed': {
    category: 'safety',
    entity: 'disputes.disputes',
    what: 'An officer decided a dispute against the party who raised it, with the reasons.',
  },
  'dispute.withdrawn': {
    category: 'safety',
    entity: 'disputes.disputes',
    what: 'The party who raised a dispute withdrew it before it was decided.',
  },
  'dispute.evidence_upload_requested': {
    category: 'safety',
    entity: 'storage.stored_objects',
    what: 'A party asked to attach a file to a dispute and was given a place to put it, with the file’s size.',
  },
  'dispute.evidence_attached': {
    category: 'safety',
    entity: 'disputes.dispute_evidence',
    what: 'A file was attached to a dispute as evidence, with who attached it and the file’s key.',
  },
  'dispute.evidence_read': {
    category: 'safety',
    entity: 'disputes.dispute_evidence',
    what: 'Somebody opened a piece of dispute evidence, with who and which dispute.',
  },
  'incident.reported': {
    category: 'safety',
    entity: 'clinical_incidents.clinical_incidents',
    what: 'A clinical incident was reported at a facility, with its severity and category; the account of it is kept out.',
  },
  'incident.review_started': {
    category: 'safety',
    entity: 'clinical_incidents.clinical_incidents',
    what: 'An officer took up an incident for review.',
  },
  'incident.closed': {
    category: 'safety',
    entity: 'clinical_incidents.clinical_incidents',
    what: 'An incident was closed, with who closed it, the outcome and the closing notes.',
  },

  // ─── Privacy ────────────────────────────────────────────────────────────────
  'consent.granted': {
    category: 'privacy',
    entity: 'consent.consent_records',
    what: 'A person gave consent for a stated purpose, on a stated lawful basis; that a note was recorded is said, and the note is not.',
  },
  'consent.withdrawn': {
    category: 'privacy',
    entity: 'consent.consent_records',
    what: 'A person withdrew consent for a stated purpose, on a stated lawful basis; that a note was recorded is said, and the note is not.',
  },
  'agreement.accepted': {
    category: 'privacy',
    entity: 'consent.agreement_acceptances',
    what: 'A person accepted a named version of an agreement or notice, at a named moment.',
  },
  'data_subject.request_raised': {
    category: 'privacy',
    entity: 'consent.data_subject_requests',
    what: 'A person raised a request about their data: access, correction, erasure, a copy or restriction.',
  },
  'data_subject.started': {
    category: 'privacy',
    entity: 'consent.data_subject_requests',
    what: 'An officer picked up a data request to work on.',
  },
  'data_subject.completed': {
    category: 'privacy',
    entity: 'consent.data_subject_requests',
    what: 'A data request was closed as done, with who closed it and the outcome recorded.',
  },
  'data_subject.refused': {
    category: 'privacy',
    entity: 'consent.data_subject_requests',
    what: 'A data request was refused, with who refused it and the reason recorded.',
  },
  'data_subject.erased': {
    category: 'privacy',
    entity: 'identity.users',
    what: 'A person’s details were replaced and their account closed, with how many records of each kind were replaced or deleted and how many files were to go.',
  },

  // ─── Admin ──────────────────────────────────────────────────────────────────
  'agreement.published': {
    category: 'admin',
    entity: 'consent.agreement_versions',
    what: 'A new version of an agreement or notice was published, with its identifier and kind and who published it.',
  },
  'cadre_level.created': {
    category: 'admin',
    entity: 'config.cadre_levels',
    what: 'A cadre level was added to the reference data.',
  },
  'cadre_level.retired': {
    category: 'admin',
    entity: 'config.cadre_levels',
    what: 'A cadre level was retired, with who did it.',
  },
  'cadre_level.restored': {
    category: 'admin',
    entity: 'config.cadre_levels',
    what: 'A retired level was brought back.',
  },
  'registration_category.created': {
    category: 'admin',
    entity: 'config.registration_categories',
    what: 'A registration category was added to the reference data.',
  },
  'registration_category.retired': {
    category: 'admin',
    entity: 'config.registration_categories',
    what: 'A registration category was retired, with who did it.',
  },
  'registration_category.restored': {
    category: 'admin',
    entity: 'config.registration_categories',
    what: 'A retired registration category was brought back.',
  },
  'holiday.added': {
    category: 'admin',
    entity: 'config.public_holidays',
    what: 'A public holiday was added to the calendar, which changes how shifts on that day are paid.',
  },
  'holiday.removed': {
    category: 'admin',
    entity: 'config.public_holidays',
    what: 'A public holiday was removed from the calendar, which changes how shifts on that day are paid.',
  },
  'outbox.replayed': {
    category: 'admin',
    entity: 'audit.outbox_events',
    what: 'An operator put a given-up background event back in the queue, with its state and last error before.',
  },
  'retention.purged': {
    category: 'admin',
    entity: 'audit.retention',
    what: 'The daily clean-up deleted data past its retention period, with how many of each kind and how many files, by the worker.',
  },

  // ─── Feedback ───────────────────────────────────────────────────────────────
  'suggestion.submitted': {
    category: 'feedback',
    entity: 'suggestions.suggestions',
    what: 'A person sent a suggestion, with the area it concerns.',
  },
  'suggestion.triaged': {
    category: 'feedback',
    entity: 'suggestions.suggestions',
    what: 'An officer moved a suggestion along, and answered it when it was finished.',
  },
  'suggestion.derived_from_decline': {
    category: 'feedback',
    entity: 'suggestions.suggestions',
    what: 'The reason a practitioner gave for declining an offer was kept as a suggestion about matching.',
  },
};

export interface SecurityEventKind {
  what: string;
}

/**
 * `audit.security_events`: evidence of somebody reading something sensitive, written by the
 * platform in its own right and not by an actor changing a record. Reads leave no state change
 * for the audit log to hold, so they are recorded here, and the person they concern can see
 * them in their own data export.
 */
export const SECURITY_EVENT_CATALOGUE: Record<string, SecurityEventKind> = {
  'credential.document_accessed': {
    what: 'Somebody opened a practitioner’s credential document, with who and which document.',
  },
  'facility.licence_accessed': {
    what: 'Somebody opened a facility’s licence document, with who and which facility.',
  },
  'audit.trail_read': {
    what: 'Somebody read the audit trail, with who and the filter they used.',
  },
  'data_subject.export_generated': {
    what: 'A person downloaded their own data, written before the data left the platform.',
  },
};

/**
 * Functions that change a table the audit rule covers and write no audit row themselves, with the
 * reason each is right to. Found by reading the code (`audit-catalogue.test.ts`), so a write path
 * no test has run is looked at too. The key is `file:function`; a callback is `function>callback`.
 *
 * An entry is a decision and says what does record the change. When the function starts auditing,
 * or goes, the test fails until the entry is removed.
 */
export const UNAUDITED_WRITES: Record<string, string> = {
  'src/lib/authz/sync-roles.ts:syncRoles':
    'Brings the roles and permissions in the database into line with their definition in code, when it is seeded or the first administrator is created; nobody decides it at run time. What a person is then given is audited as role.granted, and the first administrator as administrator.bootstrapped.',
  'src/lib/authz/sync-roles.ts:retireMergedRoles':
    'Moves people from the nine roles that were merged onto their replacements, once, on a database seeded from a branch older than the merge. The migration that did the same on deployed databases is the record of it; nothing is merged at run time.',
  'src/modules/attendance/application/attendance.ts:ensureAttendanceRecord':
    'Creates the empty attendance record for a shift the first time anybody touches it, with nothing recorded in it. Everything done to it afterwards (a code issued, a check-in, a correction, a dispute) is audited against the same record.',
  'src/modules/audit-compliance/application/erasure.ts:deleteStoredFiles':
    'Deletes a person’s files from storage and marks each deleted, after the erasure itself has committed. The erasure is audited as data_subject.erased with how many files were to go, and the request’s outcome records how many did and how many are left for another attempt.',
  'src/modules/audit-compliance/application/retention.ts:deleteAbandonedUploads':
    'Deletes uploads nobody confirmed, one step of the daily clean-up. The clean-up writes a single retention.purged row with how many files went and how many are left for the next run.',
  'src/modules/auth/application/grants.ts:ensureRole':
    'Creates a role from its definition in code the first time it is granted. The grant that follows is audited as role.granted with the permissions the role carries.',
  'src/modules/auth/application/otp-service.ts:consumeOtp':
    'Marks a one-time code used inside the transaction of the sign-up, reset or step-up it unlocks. A code being used is not a decision of its own: each issue, each failed attempt and what the code enabled (auth.phone_verified, auth.password_reset, auth.step_up) has its own row.',
  'src/modules/rates-contracts/application/holiday.ts:loadStatutoryHolidays':
    'Loads the statutory holidays when the database is seeded, from the statute, and never overwrites an entry a person made. People adding or removing a holiday is audited as holiday.added and holiday.removed.',
  'src/modules/timesheets/application/timesheet.ts:computeAndSaveTimesheet':
    'Works out the figures of a sheet that has not been submitted, from attendance, the break and the calendar, and does nothing to one that is locked. The first row is written when the practitioner submits it (timesheet.submitted), and every later change is a revision with a reason and an audit row.',
};

const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

export function renderCatalogue(): string {
  const actions = Object.entries(AUDIT_CATALOGUE);
  const lines: string[] = [
    '# What the audit trail records',
    '',
    'Generated from `src/modules/audit-compliance/domain/audit-catalogue.ts` by `pnpm tsx scripts/render-audit-catalogue.ts`. Do not edit this file by hand: change that one, and a test fails until this is regenerated.',
    '',
    `It answers “does the trail show who did this?” for each thing the platform does. A test holds it to the code from both sides: every one of the ${actions.length} actions below is written by something, and every action the code writes is below. A new decision cannot be added to the code without a line here.`,
    '',
    '## How a row is written',
    '',
    '- **In the same transaction as the change.** A row that cannot be written takes the change with it, so nothing is changed and unrecorded. The write failing is logged as `audit_write_failed`.',
    '- **Who, where and when.** Every row names the person who acted (or says the platform or the worker did), the table and record it concerns, the scope it affects, a correlation id that ties it to the request or job that caused it, and the time.',
    '- **What it holds is chosen.** Names, email addresses, phone numbers, bank account numbers, NINs and passwords are replaced before a row is written, and free text has email addresses and phone numbers removed. A row keeps for good, so it says that a field existed or changed and not what it held.',
    '- **It cannot be changed.** The table refuses `UPDATE` and `DELETE` at the database, and a nightly job seals each finished day as a count and a chained hash (`docs/audit-digest.md`).',
    '- **Reading is recorded separately.** Looking at something sensitive changes no state, so it is written to the security events below, and the person it concerns sees it in their own data export.',
    '',
    '## Actions, by kind',
    '',
  ];

  for (const [category, description] of Object.entries(AUDIT_CATEGORIES)) {
    const inCategory = actions.filter(([, entry]) => entry.category === category);
    lines.push(`### ${category[0]!.toUpperCase()}${category.slice(1)} (${inCategory.length})`, '', description, '');
    lines.push('| Action | Records | Against |', '| --- | --- | --- |');
    for (const [action, entry] of inCategory) {
      lines.push(`| \`${action}\` | ${cell(entry.what)} | \`${entry.entity}\` |`);
    }
    lines.push('');
  }

  lines.push(
    '## Security events',
    '',
    'Written to `audit.security_events` by the platform when somebody reads something sensitive.',
    '',
    '| Kind | Records |',
    '| --- | --- |',
    ...Object.entries(SECURITY_EVENT_CATALOGUE).map(([kind, entry]) => `| \`${kind}\` | ${cell(entry.what)} |`),
    '',
    '## Changes that write no row of their own',
    '',
    'A function that changes a table the audit rule covers and has no audit call in it is listed here with the reason, and the test fails if one is added without a reason or one stays here after it stops being true. Each says what does record the change.',
    '',
    '| Function | Why it writes no row, and what records the change |',
    '| --- | --- |',
    ...Object.entries(UNAUDITED_WRITES).map(([key, reason]) => `| \`${key}\` | ${cell(reason)} |`),
    '',
    '## What this does not cover',
    '',
    '- **Most reads leave no trace.** Only the four kinds under security events are recorded when somebody looks at something. A clinical incident opened by staff, or a practitioner’s profile seen by a facility, is not (`AUD-12`, `AUD-14` are open).',
    '- **Sign-in attempts** are kept in `identity.login_attempts`, not here: every attempt, with its outcome, is the input to the lockout and would bury the changes of state below under noise. A lockout is a row there with the reason `locked_out`.',
    '- **The ledger, timesheet revisions and assignment history** are append-only records in their own right, with an actor and a reason on each, and are exempt from the audit rule for that reason (`src/lib/audit-coverage.ts` says why for each).',
    '- **A change made by raw SQL** to a table the rule covers is not found by reading the code, and only the nightly digest would show it if it were to the audit table itself.',
    '- **Whether a decision should be audited** that nobody has built yet is not answered here. A facility suspension (`M04-07`) and a practitioner withdrawing from a booking are not in the code, so they are not in this list.',
    '',
  );
  return lines.join('\n');
}
