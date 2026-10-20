/**
 * Where a shift is in its life, and whose turn it is.
 *
 * Six steps, the same for everyone: published, offered, confirmed, attended, approved, paid.
 * What was missing was not the status — every page has a badge — but the answer to the question
 * each reader actually has, which is "is this waiting on me?". A facility looking at a shift
 * with an accepted offer and a practitioner looking at the same shift ask opposite things of it.
 *
 * Pure, so the rules can be tested; the component only draws what this returns.
 */

export const LIFECYCLE_STEPS = [
  'Published',
  'Offered',
  'Confirmed',
  'Attended',
  'Approved',
  'Paid',
] as const;

export type Party = 'facility' | 'practitioner' | 'medilink';

export interface LifecycleInput {
  /** The request is out for offers or later (published, filled). False for a draft. */
  published: boolean;
  /** At least one offer has been sent. */
  offered: boolean;
  /** An offer has been accepted and the facility has not confirmed it yet. */
  accepted: boolean;
  /** Somebody is confirmed onto it. */
  confirmed: boolean;
  /** The shift's start time has passed. */
  started: boolean;
  /** The assignment is marked completed (attendance has settled it). */
  completed?: boolean;
  /** The attendance state of the assignment, if there is one. */
  attendance: string | null;
}

export interface Lifecycle {
  /** Index into LIFECYCLE_STEPS of the step in progress; steps before it are done. */
  current: number;
  /** Who has to act next, or null when nothing is expected of anybody. */
  turn: Party | null;
  /** What is happening, in the third person, for the line under the steps. */
  message: string;
}

/** Attendance states that mean the person has worked the shift. */
const WORKED = new Set([
  'CHECKED_OUT',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
  'DISPUTED',
  'MANUALLY_CORRECTED',
]);

/** Attendance states that mean hours have been decided in the practitioner's favour. */
const DECIDED = new Set(['APPROVED', 'MANUALLY_CORRECTED']);

/**
 * Several people can be confirmed onto one shift. The shift is only as far along as the one who
 * is furthest behind, because that is the one something is still owed for.
 */
const ATTENDANCE_ORDER = [
  null,
  'NOT_STARTED',
  'CHECK_IN_PENDING',
  'CHECKED_IN',
  'CHECKED_OUT',
  'REJECTED',
  'SUBMITTED',
  'DISPUTED',
  'MANUALLY_CORRECTED',
  'APPROVED',
];

export function leastAdvancedAttendance(states: (string | null | undefined)[]): string | null {
  if (states.length === 0) return null;
  let least: string | null = states[0] ?? null;
  for (const state of states) {
    const value = state ?? null;
    if (ATTENDANCE_ORDER.indexOf(value) < ATTENDANCE_ORDER.indexOf(least)) least = value;
  }
  return least;
}

export function lifecycleOf(input: LifecycleInput): Lifecycle {
  if (!input.published) {
    return { current: 0, turn: 'facility', message: 'Not published yet. Publish it so it can be offered.' };
  }

  if (!input.confirmed) {
    if (!input.offered) {
      return {
        current: 1,
        turn: 'facility',
        message: 'Published. Find candidates and offer the shift to somebody.',
      };
    }
    return input.accepted
      ? {
          current: 2,
          turn: 'facility',
          message: 'An offer has been accepted. It is not a booking until the facility confirms it.',
        }
      : { current: 2, turn: 'practitioner', message: 'Offered. Waiting for a practitioner to answer.' };
  }

  const attendance = input.attendance;
  const worked = input.completed || (attendance !== null && WORKED.has(attendance));

  if (!worked) {
    if (!input.started) {
      return { current: 3, turn: 'practitioner', message: 'Confirmed. Waiting for the shift to start.' };
    }
    return attendance === 'CHECKED_IN'
      ? { current: 3, turn: 'practitioner', message: 'In progress. Check out at the end of the shift.' }
      : { current: 3, turn: 'practitioner', message: 'The shift has started. Check in with the ward code.' };
  }

  if (attendance !== null && DECIDED.has(attendance)) {
    return {
      current: 5,
      turn: 'medilink',
      message: 'Hours approved. Payment follows once the facility’s invoice is settled.',
    };
  }

  switch (attendance) {
    case 'SUBMITTED':
      return {
        current: 4,
        turn: 'facility',
        message: 'Hours submitted. Waiting for the facility to approve them.',
      };
    case 'REJECTED':
      return {
        current: 4,
        turn: 'practitioner',
        message: 'The facility sent the hours back. They need correcting and submitting again.',
      };
    case 'DISPUTED':
      return { current: 4, turn: 'medilink', message: 'The hours are in dispute. Medilink is deciding.' };
    default:
      return {
        current: 4,
        turn: input.completed && attendance === null ? 'facility' : 'practitioner',
        message:
          input.completed && attendance === null
            ? 'The shift is complete. Waiting for the facility to approve the hours.'
            : 'The shift is done. The practitioner submits their hours next.',
      };
  }
}

/** "Your turn", or whose it is, as the reader would say it. */
export function turnLabel(turn: Party | null, viewer: 'facility' | 'practitioner'): string {
  if (turn === null) return 'Nothing is needed';
  if (turn === viewer) return 'Your turn';
  if (turn === 'medilink') return 'Waiting for Medilink';
  return turn === 'facility' ? 'Waiting for the facility' : 'Waiting for the practitioner';
}
