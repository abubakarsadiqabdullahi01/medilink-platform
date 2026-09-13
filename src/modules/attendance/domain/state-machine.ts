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
 *
 * `DISPUTED` leads back to three places rather than one, because a dispute has
 * more than one honest ending: upheld, and the figures are decided again;
 * dismissed, and the record returns to whichever of `APPROVED` or `REJECTED`
 * it was in when the case was opened.
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
  // Module 14, Stage 8. A dispute that is upheld sends the record back to be
  // decided again; one that is dismissed puts it back exactly where it was,
  // which is why the attendance record remembers what that was. Nothing here
  // says which of the three is right — the dispute's outcome does.
  DISPUTED: ['SUBMITTED', 'APPROVED', 'REJECTED'],
  MANUALLY_CORRECTED: ['SUBMITTED'],
};

export function canTransition(from: AttendanceState, to: AttendanceState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function allowedTransitionsFrom(state: AttendanceState): readonly AttendanceState[] {
  return TRANSITIONS[state];
}

/**
 * States from which no further move is defined.
 *
 * There are none, and that is the honest answer rather than an oversight: an
 * approved shift can be disputed and a dispute resolves back into the machine,
 * so no attendance record is ever permanently frozen. What stops a record
 * cycling forever is the dispute module's policy — one open case at a time —
 * not the machine, which describes what is possible rather than what is
 * allowed.
 */
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
