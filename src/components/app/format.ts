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

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-NG', {
    timeZone: 'Africa/Lagos',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
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
 * Integer kobo in, naira out. Rule 3: money is only ever computed in kobo,
 * and this is the single place it becomes something with a decimal point.
 */
export function formatNaira(kobo: number | null | undefined): string {
  if (kobo === null || kobo === undefined) return '—';
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 2,
  }).format(kobo / 100);
}

/** 480 → "8h 0m". Minutes are how attendance is stored; hours are how it reads. */
export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return '—';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/**
 * An instant as a `datetime-local` input wants it: `YYYY-MM-DDTHH:mm` in the
 * browser's own time, which for every user of this product is WAT.
 */
export function toLocalInput(value: string | Date | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
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
const ACTION_LABELS: Record<string, string> = {
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
  'assignment.reinvited': 'Shift offered again',
  'assignment.no_show': 'Recorded as a no-show',
  'assignment.unhonoured_flagged': 'Missed shift flagged',
  'attendance.checked_in': 'Checked in',
  'attendance.checked_out': 'Checked out',
  'attendance.disputed': 'Attendance disputed',
  'attendance.dispute_upheld': 'Attendance dispute upheld',
  'attendance.dispute_dismissed': 'Attendance dispute dismissed',
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
  'consent.granted': 'Consent given',
  'consent.withdrawn': 'Consent withdrawn',
  'credential.document_accessed': 'Credential document viewed',
  'credential.document_confirmed': 'Credential document uploaded',
  'credential.document_upload_requested': 'Credential upload started',
  'credential.expired': 'Credential expired',
  'credential.info_requested': 'More information requested',
  'credential.rejected': 'Credential rejected',
  'credential.resupplied': 'Credential resupplied',
  'credential.submitted': 'Credential submitted',
  'credential.verified': 'Credential verified',
  'data_subject.completed': 'Data request answered',
  'data_subject.refused': 'Data request refused',
  'data_subject.request_raised': 'Data request raised',
  'data_subject.started': 'Data request in progress',
  'dispute.dismissed': 'Dispute dismissed',
  'dispute.evidence_attached': 'Evidence attached to a dispute',
  'dispute.evidence_read': 'Dispute evidence viewed',
  'dispute.evidence_upload_requested': 'Evidence upload started',
  'dispute.opened': 'Dispute opened',
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
  'facility.role_granted': 'Facility owner appointed',
  'facility.updated': 'Facility details changed',
  'facility.verified': 'Facility verified',
  'incident.closed': 'Incident closed',
  'incident.reported': 'Incident reported',
  'incident.review_started': 'Incident review started',
  'invoice.created': 'Invoice drafted',
  'invoice.issued': 'Invoice issued',
  'invoice.paid': 'Invoice paid',
  'matching.run': 'Candidates ranked',
  'payout.failed': 'Payout failed',
  'payout.prepared': 'Payout prepared',
  'payout.released': 'Payout released',
  'payout.settled': 'Payout settled',
  'practitioner.activated': 'Practitioner activated',
  'practitioner.identity_verified': 'Identity recorded',
  'practitioner.photo_confirmed': 'Profile photo uploaded',
  'practitioner.photo_upload_requested': 'Photo upload started',
  'practitioner.profile_created': 'Profile created',
  'practitioner.profile_updated': 'Profile updated',
  'practitioner.registration_expired': 'Registration expired',
  'practitioner.registration_recorded': 'Regulator registration recorded',
  'practitioner.submitted_for_review': 'Submitted for approval',
  'practitioner.returned_for_changes': 'Sent back for changes',
  'practitioner.screening_cleared': 'Screening flag cleared',
  'practitioner.screening_flagged': 'Flagged by sanctions screening',
  'rate_card.created': 'Rate card set',
  'role.granted': 'Access granted',
  'role.revoked': 'Access removed',
  'service_request.cancelled': 'Shift cancelled',
  'service_request.created': 'Shift drafted',
  'service_request.expired': 'Shift expired unfilled',
  'service_request.filled': 'Shift filled',
  'service_request.published': 'Shift published',
  'suggestion.derived_from_decline': 'Decline reason logged as a suggestion',
  'suggestion.submitted': 'Suggestion sent',
  'suggestion.triaged': 'Suggestion triaged',
  'timesheet.approved': 'Timesheet approved',
  'timesheet.corrected': 'Timesheet corrected',
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
