/**
 * Dispute policy: pure, no database.
 *
 * Module 14. A case is opened over a shift that has already been decided, by
 * whichever party disagrees with the outcome. What can be disputed, by whom,
 * and for how long lives here; what it does to the attendance record lives in
 * attendance, because the state machine is attendance's invariant.
 */

export type DisputePartyValue = 'PRACTITIONER' | 'FACILITY';
export type DisputeCategoryValue = 'HOURS' | 'PAY' | 'NON_ATTENDANCE' | 'CONDUCT' | 'OTHER';
export type DisputeStatusValue = 'OPEN' | 'UNDER_REVIEW' | 'RESOLVED' | 'WITHDRAWN';
export type DisputeOutcomeValue = 'UPHELD' | 'DISMISSED';

export const DISPUTE_CATEGORIES: DisputeCategoryValue[] = [
  'HOURS',
  'PAY',
  'NON_ATTENDANCE',
  'CONDUCT',
  'OTHER',
];

export const DISPUTE_REASON_MIN_LENGTH = 20;
export const DISPUTE_REASON_MAX_LENGTH = 2000;

/**
 * How long after a shift is decided a case can still be opened.
 *
 * Fourteen days, and it is a real cut-off rather than a formality: the
 * evidence a dispute turns on is a ward's own record of who was on the floor,
 * and those get thinner every week. A window long enough to notice a wrong
 * payment and short enough that somebody can still check.
 *
 * It runs from the decision, not from the shift. A timesheet approved three
 * weeks late leaves the practitioner the same fortnight as one approved the
 * next morning.
 */
export const DISPUTE_WINDOW_DAYS = 14;

/** The only two states a shift can be disputed from. */
export const DISPUTABLE_STATES = ['APPROVED', 'REJECTED'] as const;
export type DisputableState = (typeof DISPUTABLE_STATES)[number];

export function isDisputable(status: string): status is DisputableState {
  return (DISPUTABLE_STATES as readonly string[]).includes(status);
}

export type OpenBlocker =
  | 'not_yet_decided'
  | 'already_open'
  | 'outside_window'
  | 'reason_missing'
  | 'not_a_party';

export interface OpenCheck {
  attendanceStatus: string;
  /** When the shift was approved or rejected. Null if it never was. */
  decidedAt: Date | null;
  hasOpenDispute: boolean;
  reason: string;
  /** Whether the person raising it is on one side of this shift at all. */
  isParty: boolean;
  now: Date;
}

/**
 * Every reason a case cannot be opened, returned together rather than one at
 * a time — the shape `confirmBlockers` and `closeBlockers` already use.
 */
export function openBlockers(check: OpenCheck): OpenBlocker[] {
  const blockers: OpenBlocker[] = [];

  if (!check.isParty) blockers.push('not_a_party');

  // Nothing to disagree with until somebody has decided. A shift still being
  // worked, or one waiting for approval, has ordinary routes for saying it is
  // wrong: correct it, or reject it.
  if (!isDisputable(check.attendanceStatus)) blockers.push('not_yet_decided');

  // One at a time. Two open cases over one shift is two people adjudicating
  // the same question, and a partial unique index is not expressible in
  // Prisma, so the rule lives here and is enforced in a transaction.
  if (check.hasOpenDispute) blockers.push('already_open');

  if (check.decidedAt === null) {
    if (!blockers.includes('not_yet_decided')) blockers.push('not_yet_decided');
  } else if (!withinWindow(check.decidedAt, check.now)) {
    blockers.push('outside_window');
  }

  if (check.reason.trim().length < DISPUTE_REASON_MIN_LENGTH) blockers.push('reason_missing');

  return blockers;
}

export function withinWindow(decidedAt: Date, now: Date, days = DISPUTE_WINDOW_DAYS): boolean {
  const deadline = decidedAt.getTime() + days * 24 * 60 * 60 * 1000;
  return now.getTime() <= deadline;
}

/** The last moment a case can still be opened over a shift decided then. */
export function disputeDeadline(decidedAt: Date, days = DISPUTE_WINDOW_DAYS): Date {
  return new Date(decidedAt.getTime() + days * 24 * 60 * 60 * 1000);
}

export type ResolveBlocker = 'not_open' | 'outcome_missing' | 'notes_missing';

export interface ResolveCheck {
  status: DisputeStatusValue;
  outcome: DisputeOutcomeValue | null;
  notes: string;
}

/**
 * A dispute cannot be resolved without an outcome and a reason.
 *
 * The same rule as a fault determination's, for the same reason: both parties
 * have to be able to read why they won or lost, and "resolved" on its own
 * tells the loser nothing they can act on.
 */
export function resolveBlockers(check: ResolveCheck): ResolveBlocker[] {
  const blockers: ResolveBlocker[] = [];

  // RESOLVED and WITHDRAWN are both finished. Re-adjudicating a closed case
  // is a new case, on new evidence, not an edit of the old one.
  if (check.status !== 'OPEN' && check.status !== 'UNDER_REVIEW') blockers.push('not_open');

  if (check.outcome === null) blockers.push('outcome_missing');

  if (check.notes.trim().length < DISPUTE_REASON_MIN_LENGTH) blockers.push('notes_missing');

  return blockers;
}

/** Only the party who raised it may withdraw it, and only while it is open. */
export function withdrawBlockers(check: {
  status: DisputeStatusValue;
  raisedBy: string;
  actorId: string;
}): Array<'not_open' | 'not_the_raiser'> {
  const blockers: Array<'not_open' | 'not_the_raiser'> = [];
  if (check.status !== 'OPEN' && check.status !== 'UNDER_REVIEW') blockers.push('not_open');
  if (check.raisedBy !== check.actorId) blockers.push('not_the_raiser');
  return blockers;
}

/**
 * Which side of the shift this person is on.
 *
 * Returns null for somebody who is neither, which `openBlockers` turns into
 * `not_a_party`. An operations officer adjudicates disputes; they do not
 * raise them, because a case nobody involved wanted is not a dispute.
 */
export function partyFor(input: {
  actorId: string;
  practitionerId: string;
  facilityMember: boolean;
}): DisputePartyValue | null {
  if (input.actorId === input.practitionerId) return 'PRACTITIONER';
  if (input.facilityMember) return 'FACILITY';
  return null;
}
