/**
 * The attendance state machine (Section 9.16): pure, no database.
 *
 * The nine states are the specification's, named as it names them. A gate
 * condition for this stage is that "attendance cannot reach an illegal state
 * through any code path", and the only honest way to know that is to have
 * one table every transition goes through and an exhaustive test over every
 * ordered pair of states.
 */

export const ATTENDANCE_STATES = [
  'NOT_STARTED',
  'CHECK_IN_PENDING',
  'CHECKED_IN',
  'CHECKED_OUT',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
  'DISPUTED',
  'MANUALLY_CORRECTED',
] as const;

export type AttendanceState = (typeof ATTENDANCE_STATES)[number];

/**
 * Every legal move, and nothing else.
 *
 * `MANUALLY_CORRECTED` is reachable from most places rather than being a
 * terminal state: a supervisor recording a shift after the fact is the
 * fallback for a facility whose network failed, and that can happen before
 * check-in, between check-in and check-out, or after a rejection. It leads
 * back into `SUBMITTED`, because a corrected record still has to be approved
 * by somebody.
 *
 * `APPROVED` is terminal except for a dispute. A shift that has been approved
 * and paid cannot quietly become something else; the only way back is a
 * dispute, which is a visible act with a case attached.
 */
const TRANSITIONS: Record<AttendanceState, readonly AttendanceState[]> = {
  NOT_STARTED: ['CHECK_IN_PENDING', 'MANUALLY_CORRECTED'],
  // A token has been issued and is waiting to be presented. It can lapse back
  // to NOT_STARTED, which is what an expired token does.
  CHECK_IN_PENDING: ['CHECKED_IN', 'NOT_STARTED', 'MANUALLY_CORRECTED'],
  CHECKED_IN: ['CHECKED_OUT', 'MANUALLY_CORRECTED'],
  CHECKED_OUT: ['SUBMITTED', 'MANUALLY_CORRECTED'],
  SUBMITTED: ['APPROVED', 'REJECTED', 'MANUALLY_CORRECTED'],
  APPROVED: ['DISPUTED'],
  // A rejected record goes back for correction and is submitted again.
  REJECTED: ['MANUALLY_CORRECTED', 'SUBMITTED', 'DISPUTED'],
  // Where a dispute lands is module 14's business, in Stage 8. Nothing moves
  // a record out of here yet, and the empty list says so.
  DISPUTED: [],
  MANUALLY_CORRECTED: ['SUBMITTED'],
};

export function canTransition(from: AttendanceState, to: AttendanceState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function allowedTransitionsFrom(state: AttendanceState): readonly AttendanceState[] {
  return TRANSITIONS[state];
}

/** States from which no further move is defined. */
export function isTerminal(state: AttendanceState): boolean {
  return TRANSITIONS[state].length === 0;
}

export class IllegalAttendanceTransition extends Error {
  readonly code = 'illegal_attendance_transition';
  constructor(
    readonly from: AttendanceState,
    readonly to: AttendanceState,
  ) {
    super(`Attendance cannot move from ${from} to ${to}.`);
    this.name = 'IllegalAttendanceTransition';
  }
}

/**
 * The single gate every state change goes through. Application code calls
 * this rather than assigning a status, so "through any code path" is a
 * property of the code rather than a hope.
 */
export function assertTransition(from: AttendanceState, to: AttendanceState): void {
  if (!canTransition(from, to)) throw new IllegalAttendanceTransition(from, to);
}
