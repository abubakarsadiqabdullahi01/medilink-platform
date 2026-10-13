/**
 * Assignment and invitation policy: pure, no database.
 */

export type InvitationStatusValue =
  | 'INVITED'
  | 'ACCEPTED'
  | 'DECLINED'
  | 'EXPIRED'
  | 'WITHDRAWN';

export type AssignmentStatusValue = 'CONFIRMED' | 'CANCELLED' | 'COMPLETED' | 'NO_SHOW';

/** How long a practitioner has to answer before an invitation lapses. */
export const DEFAULT_INVITATION_HOURS = 24;

export const DECLINE_REASON_MAX_LENGTH = 500;
export const CANCELLATION_REASON_MAX_LENGTH = 500;

export interface TimeSpan {
  startsAt: Date;
  endsAt: Date;
}

/**
 * Two shifts clash when they genuinely overlap. Touching is not clashing: a
 * shift ending at 14:00 and one starting at 14:00 are back to back, which is
 * a fatigue question rather than a scheduling impossibility.
 */
export function overlaps(a: TimeSpan, b: TimeSpan): boolean {
  return a.startsAt.getTime() < b.endsAt.getTime() && b.startsAt.getTime() < a.endsAt.getTime();
}

export function isInvitationOpen(
  invitation: { status: InvitationStatusValue; expiresAt: Date },
  now: Date = new Date(),
): boolean {
  return invitation.status === 'INVITED' && invitation.expiresAt.getTime() > now.getTime();
}

const ASSIGNMENT_TRANSITIONS: Record<AssignmentStatusValue, AssignmentStatusValue[]> = {
  // COMPLETED and NO_SHOW are Stage 7's to set, when attendance says what
  // actually happened.
  CONFIRMED: ['CANCELLED', 'COMPLETED', 'NO_SHOW'],
  CANCELLED: [],
  COMPLETED: [],
  NO_SHOW: [],
};

export function canTransitionAssignment(
  from: AssignmentStatusValue,
  to: AssignmentStatusValue,
): boolean {
  return ASSIGNMENT_TRANSITIONS[from].includes(to);
}

export type ConfirmBlocker =
  | 'request_not_published'
  | 'shift_started'
  | 'facility_not_verified'
  | 'practitioner_not_bookable'
  | 'request_full'
  | 'invitation_not_accepted'
  | 'already_assigned'
  | 'conflicting_assignment';

export interface ConfirmCheck {
  requestStatus: 'DRAFT' | 'PUBLISHED' | 'FILLED' | 'CANCELLED' | 'EXPIRED';
  /** The shift's start has passed. Nothing can be booked onto a shift already under way. */
  shiftStarted: boolean;
  /** The facility is still verified and in date. Verification is not a one-off. */
  facilityActive: boolean;
  /** Eligible, in this profession, and not withdrawn from matching — as of now. */
  practitionerBookable: boolean;
  headcount: number;
  confirmedCount: number;
  invitationStatus: InvitationStatusValue | null;
  alreadyAssigned: boolean;
  hasConflict: boolean;
}

/**
 * Every reason this confirmation cannot proceed.
 *
 * `conflicting_assignment` is the one step 6.7 turns on: overlaps must be
 * *prevented*, not warned about, and this is the decision — the serialisation
 * that makes it safe under concurrency lives in the application layer.
 */
export function confirmBlockers(check: ConfirmCheck): ConfirmBlocker[] {
  const blockers: ConfirmBlocker[] = [];

  if (check.requestStatus !== 'PUBLISHED') blockers.push('request_not_published');
  if (check.shiftStarted) blockers.push('shift_started');
  if (!check.facilityActive) blockers.push('facility_not_verified');
  if (!check.practitionerBookable) blockers.push('practitioner_not_bookable');
  if (check.confirmedCount >= check.headcount) blockers.push('request_full');
  if (check.invitationStatus !== 'ACCEPTED') blockers.push('invitation_not_accepted');
  if (check.alreadyAssigned) blockers.push('already_assigned');
  if (check.hasConflict) blockers.push('conflicting_assignment');

  return blockers;
}
