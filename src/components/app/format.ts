import { instantToLagosLocal } from '@/lib/lagos-date';

/**
 * Formatting, in one place, because a date shown two ways on two pages is a
 * date somebody misreads.
 */

/** WAT, always. The shifts are in Nigeria and so is everybody reading this. */
export function formatWhen(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-NG', {
    timeZone: 'Africa/Lagos',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "18 Oct, 10:00": a moment without its year, for a tile that has to be read at a glance. */
export function formatWhenShort(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-NG', {
    timeZone: 'Africa/Lagos',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-NG', {
    timeZone: 'Africa/Lagos',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * When a credential expires, in words, and whether the date is the document's.
 *
 * The date printed on the document is the one a practitioner recognises (CRE-04).
 * A credential verified without one has only an estimate, worked out from the
 * review date, and showing it as if it were printed would put a date in front of
 * somebody that appears nowhere on what they uploaded.
 */
export function expiryOf(row: {
  expiresAt: string | Date | null;
  documentExpiresOn?: string | null;
}): { date: string; fromDocument: boolean; text: string } | null {
  if (row.documentExpiresOn) {
    const date = formatDate(row.documentExpiresOn);
    return { date, fromDocument: true, text: date };
  }
  if (!row.expiresAt) return null;
  const date = formatDate(row.expiresAt);
  return { date, fromDocument: false, text: `${date} (an estimate, no date was read from the document)` };
}

/** "3 hours ago", for a queue where age is the thing you are scanning for. */
export function formatAgo(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const then = new Date(value).getTime();
  const seconds = Math.round((Date.now() - then) / 1000);
  const future = seconds < 0;
  const abs = Math.abs(seconds);

  const units: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, 'second'],
    [3600, 'minute'],
    [86400, 'hour'],
    [2592000, 'day'],
    [31536000, 'month'],
  ];

  const formatter = new Intl.RelativeTimeFormat('en-NG', { numeric: 'auto' });
  let value_ = abs;
  let unit: Intl.RelativeTimeFormatUnit = 'second';
  let divisor = 1;

  for (const [limit, name] of units) {
    if (abs < limit) {
      value_ = Math.round(abs / divisor);
      unit = unit === 'second' && divisor === 1 ? 'second' : unit;
      return formatter.format(future ? value_ : -value_, unit);
    }
    divisor = limit;
    unit = name === 'second' ? 'minute' : name === 'minute' ? 'hour' : name === 'hour' ? 'day' : 'month';
  }

  return formatter.format(future ? Math.round(abs / 31536000) : -Math.round(abs / 31536000), 'year');
}

/**
 * What somebody typed as an amount in naira, as integer kobo, or null if it is
 * not an amount. No floating point: "40,000.10" is 4,000,010 kobo and must not
 * become 4,000,009.999999999. At most two decimal places, because a third is
 * money that does not exist.
 */
export function parseNairaToKobo(text: string): number | null {
  const cleaned = text.replace(/[₦,\s]/g, '');
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  const kobo = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0') || '0');
  return Number.isSafeInteger(kobo) ? kobo : null;
}

/**
 * Integer kobo in, naira out. Rule 3: money is only ever computed in kobo,
 * and this is the single place it becomes something with a decimal point.
 *
 * Whole naira print without kobo ("₦10,500"), because ".00" is noise on a rate card
 * and on a figure somebody is reading at arm's length (UXA-15). Anything with kobo
 * keeps both digits ("₦10,500.50", never "₦10,500.5"), so a column of amounts still
 * lines up where it matters.
 */
export function formatNaira(kobo: number | null | undefined): string {
  if (kobo === null || kobo === undefined) return '—';
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: kobo % 100 === 0 ? 0 : 2,
  }).format(kobo / 100);
}

/**
 * What somebody has typed in an amount box, reduced to what an amount can be: digits,
 * and at most one point followed by at most two. "₦40,000.505" becomes "40000.50".
 * Whether the result is a usable amount is `parseNairaToKobo`'s question.
 */
export function cleanMoneyInput(text: string): string {
  const [whole = '', ...rest] = text.replace(/[^\d.]/g, '').split('.');
  return rest.length === 0 ? whole : `${whole}.${rest.join('').slice(0, 2)}`;
}

/** The same, with thousands separators, for an amount box that is not being typed in: "40000.5" → "40,000.5". */
export function groupMoneyInput(raw: string): string {
  const [whole = '', decimals] = raw.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return decimals === undefined ? grouped : `${grouped}.${decimals}`;
}

/** 480 → "8h 0m". Minutes are how attendance is stored; hours are how it reads. */
export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return '—';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/**
 * An instant as a `datetime-local` input wants it: `YYYY-MM-DDTHH:mm`, in Lagos
 * time and not in whatever zone the device is set to. Read back with
 * `lagosLocalToInstant`.
 */
export function toLocalInput(value: string | Date | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : instantToLagosLocal(date);
}

/** A uuid nobody needs to read in full, but which has to be recognisable. */
export function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : '—';
}

/**
 * `facilities.facilities` → `Facility`, `identity.users` → `User`.
 *
 * Audit rows carry the schema-qualified table they changed, which is the
 * right thing to store and the wrong thing to show: nobody investigating a
 * complaint thinks in table names. The schema half is dropped because it
 * repeats the table, and the table is singularised because one row is one
 * thing.
 */
export function recordLabel(entityType: string | null | undefined): string {
  if (!entityType) return 'Record';

  const table = entityType.includes('.') ? entityType.slice(entityType.indexOf('.') + 1) : entityType;
  const words = table.replace(/_/g, ' ');
  const singular = singularise(words);

  return singular.charAt(0).toUpperCase() + singular.slice(1);
}

/** Enough English for table names, which is all this has to handle. */
function singularise(value: string): string {
  if (value.endsWith('ies')) return `${value.slice(0, -3)}y`;
  if (/(ch|sh|s|x|z)es$/.test(value)) return value.slice(0, -2);
  if (value.endsWith('s') && !value.endsWith('ss')) return value.slice(0, -1);
  return value;
}

/**
 * What an audit action means, in the words of the person reading the trail.
 *
 * The consoles used to print the action code with its dots taken out — "auth
 * otp issued", "assignment fault recorded" — which is accurate and reads like
 * a log file. The code stays one hover away (the audit page puts it in the
 * title); anything not listed here falls back to that old rendering, so a new
 * action is never shown blank.
 */
export const ACTION_LABELS: Record<string, string> = {
  'administrator.bootstrapped': 'First administrator created',
  'agreement.accepted': 'Agreement accepted',
  'agreement.published': 'Agreement published',
  'assignment.cancelled': 'Booking cancelled',
  'assignment.completed': 'Shift completed',
  'assignment.confirmed': 'Practitioner confirmed onto a shift',
  'assignment.fault_recorded': 'Fault decided for a missed shift',
  'assignment.invitation_accepted': 'Offer accepted',
  'assignment.invitation_declined': 'Offer declined',
  'assignment.invitation_withdrawn': 'Offer withdrawn',
  'assignment.invited': 'Shift offered',
  'assignment.no_show': 'Recorded as a no-show',
  'assignment.reinvited': 'Shift offered again',
  'assignment.unhonoured_flagged': 'Missed shift flagged',
  'attendance.checked_in': 'Checked in',
  'attendance.checked_out': 'Checked out',
  'attendance.dispute_dismissed': 'Attendance dispute dismissed',
  'attendance.dispute_upheld': 'Attendance dispute upheld',
  'attendance.disputed': 'Attendance disputed',
  'attendance.recorded_manually': 'Attendance recorded by hand',
  'attendance.token_issued': 'Check-in code issued',
  'audit.trail_read': 'Audit trail viewed',
  'auth.all_sessions_revoked': 'Signed out everywhere',
  'auth.otp_attempt_failed': 'Wrong code entered',
  'auth.otp_issued': 'Verification code sent',
  'auth.password_reset': 'Password reset',
  'auth.password_set': 'Account created',
  'auth.phone_verified': 'Phone number verified',
  'auth.registration_started': 'Sign-up started',
  'auth.role_granted': 'Access granted',
  'auth.session_issued': 'Signed in',
  'auth.session_revoked': 'Signed out',
  'auth.step_up': 'Password re-confirmed',
  'availability.block_added': 'Time blocked out',
  'availability.block_removed': 'Blocked time removed',
  'availability.slot_added': 'Availability added',
  'availability.slot_removed': 'Availability removed',
  'cadre_level.created': 'Level added',
  'cadre_level.restored': 'Level restored',
  'cadre_level.retired': 'Level retired',
  'consent.granted': 'Consent given',
  'consent.withdrawn': 'Consent withdrawn',
  'credential.document_accessed': 'Credential document viewed',
  'contact.revealed': 'Phone number shown to a facility',
  'credential.document_confirmed': 'Credential document uploaded',
  'credential.document_upload_requested': 'Credential upload started',
  'credential.expired': 'Credential expired',
  'credential.info_requested': 'More information requested',
  'credential.rejected': 'Credential rejected',
  'credential.resupplied': 'Credential resupplied',
  'credential.submitted': 'Credential submitted',
  'credential.verified': 'Credential verified',
  'data_subject.completed': 'Data request answered',
  'data_subject.erased': 'Personal details erased',
  'data_subject.export_generated': 'Own data downloaded',
  'data_subject.refused': 'Data request refused',
  'data_subject.request_raised': 'Data request raised',
  'data_subject.started': 'Data request in progress',
  'dispute.dismissed': 'Dispute dismissed',
  'dispute.evidence_attached': 'Evidence attached to a dispute',
  'dispute.evidence_read': 'Dispute evidence viewed',
  'dispute.evidence_upload_requested': 'Evidence upload started',
  'dispute.opened': 'Dispute opened',
  'dispute.responded': 'Dispute replied to',
  'dispute.review_started': 'Dispute review started',
  'dispute.upheld': 'Dispute upheld',
  'dispute.withdrawn': 'Dispute withdrawn',
  'excusal.granted': 'Absence excused',
  'excusal.refused': 'Excusal refused',
  'excusal.requested': 'Practitioner explained an absence',
  'facility.created': 'Facility registered',
  'facility.licence_accessed': 'Facility licence viewed',
  'facility.licence_confirmed': 'Facility licence uploaded',
  'facility.licence_replaced': 'Facility licence replaced',
  'facility.licence_upload_requested': 'Licence upload started',
  'facility.rejected': 'Facility not verified',
  'facility.resubmitted': 'Facility sent in again',
  'facility.role_granted': 'Facility owner appointed',
  'facility.updated': 'Facility details changed',
  'facility.verified': 'Facility verified',
  'holiday.added': 'Public holiday added',
  'holiday.removed': 'Public holiday removed',
  'incident.closed': 'Incident closed',
  'incident.reported': 'Incident reported',
  'incident.review_started': 'Incident review started',
  'invoice.created': 'Invoice drafted',
  'invoice.issued': 'Invoice issued',
  'invoice.paid': 'Invoice paid',
  'invoice.voided': 'Invoice voided',
  'matching.run': 'Candidates ranked',
  'outbox.replayed': 'Background event retried',
  'payout.cancelled': 'Payout cancelled',
  'payout.failed': 'Payout failed',
  'payout.prepared': 'Payout prepared',
  'payout.release_started': 'Payout release authorised',
  'payout.released': 'Payout released',
  'payout.settled': 'Payout settled',
  'payout_account.rejected': 'Bank account rejected',
  'payout_account.revealed': 'Full account number opened',
  'payout_account.submitted': 'Bank account submitted',
  'payout_account.verified': 'Bank account verified',
  'practitioner.activated': 'Practitioner activated',
  'practitioner.identity_verified': 'Identity recorded',
  'practitioner.photo_confirmed': 'Profile photo uploaded',
  'practitioner.photo_upload_requested': 'Photo upload started',
  'practitioner.profile_created': 'Profile created',
  'practitioner.profile_updated': 'Profile updated',
  'practitioner.registration_expired': 'Registration expired',
  'practitioner.registration_recorded': 'Regulator registration recorded',
  'practitioner.returned_for_changes': 'Sent back for changes',
  'practitioner.screening_cleared': 'Screening flag cleared',
  'practitioner.screening_flagged': 'Flagged by sanctions screening',
  'practitioner.standing_recorded': 'Level and registration category recorded',
  'practitioner.submitted_for_review': 'Submitted for approval',
  'rate_card.created': 'Rate card set',
  'rate_floor.set': 'Minimum rate set',
  'registration_category.created': 'Registration category added',
  'registration_category.restored': 'Registration category restored',
  'registration_category.retired': 'Registration category retired',
  'retention.purged': 'Old data deleted',
  'role.granted': 'Access granted',
  'role.revoked': 'Access removed',
  'role.changed': 'Role changed',
  'access.emergency_revoked': 'All access removed',
  'staff_invitation.created': 'Staff invited',
  'staff_invitation.cancelled': 'Invitation cancelled',
  'staff_invitation.accepted': 'Invitation accepted',
  'staff_invitation.declined': 'Invitation declined',
  'staff_invitation.withdrawn': 'Invitation withdrawn',
  'staff_invitation.expired': 'Invitation expired',
  'staff_invitation.text_sent': 'Invitation text sent',
  'staff_invitation.text_failed': 'Invitation text failed',
  'sanction_list.entries_added': 'Sanctions list entries added',
  'sanction_list.entry_removed': 'Sanctions list entry removed',
  'service_request.cancelled': 'Shift cancelled',
  'service_request.created': 'Shift drafted',
  'service_request.expired': 'Shift expired unfilled',
  'service_request.filled': 'Shift filled',
  'service_request.published': 'Shift published',
  'service_request.reopened': 'Shift opened again',
  'suggestion.derived_from_decline': 'Decline reason logged as a suggestion',
  'suggestion.submitted': 'Suggestion sent',
  'suggestion.triaged': 'Suggestion triaged',
  'timesheet.approved': 'Timesheet approved',
  'timesheet.corrected': 'Timesheet corrected',
  'timesheet.recalculated': 'Timesheet worked out again at approval',
  'timesheet.rejected': 'Timesheet rejected',
  'timesheet.submitted': 'Timesheet submitted',
  'user.reinstated': 'Account reinstated',
  'user.suspended': 'Account suspended',
};

export function actionLabel(action: string): string {
  const known = ACTION_LABELS[action];
  if (known) return known;
  const words = action.replace(/[._]/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
