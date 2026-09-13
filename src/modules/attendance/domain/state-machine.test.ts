import { describe, expect, it } from 'vitest';
import {
  ATTENDANCE_STATES,
  IllegalAttendanceTransition,
  allowedTransitionsFrom,
  assertTransition,
  canTransition,
  isTerminal,
  type AttendanceState,
} from './state-machine';

/**
 * Step 7.1's stated verification: "exhaustive unit test over every state
 * pair; only the legal transitions succeed".
 */

/** The whole legal set, written out separately from the table it checks. */
const LEGAL: ReadonlyArray<[AttendanceState, AttendanceState]> = [
  ['NOT_STARTED', 'CHECK_IN_PENDING'],
  ['NOT_STARTED', 'MANUALLY_CORRECTED'],
  ['CHECK_IN_PENDING', 'CHECKED_IN'],
  ['CHECK_IN_PENDING', 'NOT_STARTED'],
  ['CHECK_IN_PENDING', 'MANUALLY_CORRECTED'],
  ['CHECKED_IN', 'CHECKED_OUT'],
  ['CHECKED_IN', 'MANUALLY_CORRECTED'],
  ['CHECKED_OUT', 'SUBMITTED'],
  ['CHECKED_OUT', 'MANUALLY_CORRECTED'],
  ['SUBMITTED', 'APPROVED'],
  ['SUBMITTED', 'REJECTED'],
  ['SUBMITTED', 'MANUALLY_CORRECTED'],
  ['APPROVED', 'DISPUTED'],
  ['REJECTED', 'MANUALLY_CORRECTED'],
  ['REJECTED', 'SUBMITTED'],
  ['REJECTED', 'DISPUTED'],
  ['MANUALLY_CORRECTED', 'SUBMITTED'],
];

function isLegal(from: AttendanceState, to: AttendanceState): boolean {
  return LEGAL.some(([a, b]) => a === from && b === to);
}

describe('the nine states of Section 9.16', () => {
  it('are exactly the nine the specification names', () => {
    expect([...ATTENDANCE_STATES]).toEqual([
      'NOT_STARTED',
      'CHECK_IN_PENDING',
      'CHECKED_IN',
      'CHECKED_OUT',
      'SUBMITTED',
      'APPROVED',
      'REJECTED',
      'DISPUTED',
      'MANUALLY_CORRECTED',
    ]);
  });
});

describe('every ordered pair of states', () => {
  // 9 x 9 = 81 pairs, each asserted in both directions of the claim. Written
  // against a list kept deliberately separate from the table it tests, so a
  // careless edit to the table fails here rather than agreeing with itself.
  for (const from of ATTENDANCE_STATES) {
    for (const to of ATTENDANCE_STATES) {
      const expected = isLegal(from, to);
      it(`${expected ? 'allows' : 'refuses'} ${from} -> ${to}`, () => {
        expect(canTransition(from, to)).toBe(expected);

        if (expected) {
          expect(() => assertTransition(from, to)).not.toThrow();
        } else {
          expect(() => assertTransition(from, to)).toThrow(IllegalAttendanceTransition);
        }
      });
    }
  }
});

describe('shape of the machine', () => {
  it('never allows a state to move to itself', () => {
    for (const state of ATTENDANCE_STATES) {
      expect(canTransition(state, state), `${state} -> ${state}`).toBe(false);
    }
  });

  it('reaches every state from NOT_STARTED', () => {
    // A state nothing can reach is a state that should not be in the enum.
    const reached = new Set<AttendanceState>(['NOT_STARTED']);
    let grew = true;
    while (grew) {
      grew = false;
      for (const state of [...reached]) {
        for (const next of allowedTransitionsFrom(state)) {
          if (!reached.has(next)) {
            reached.add(next);
            grew = true;
          }
        }
      }
    }
    expect([...reached].sort()).toEqual([...ATTENDANCE_STATES].sort());
  });

  it('treats DISPUTED as the only terminal state', () => {
    // Module 14 is Stage 8; nothing moves a record out of a dispute yet, and
    // the empty transition list is how that is said rather than implied.
    const terminal = ATTENDANCE_STATES.filter(isTerminal);
    expect(terminal).toEqual(['DISPUTED']);
  });

  it('lets an approved record only be disputed', () => {
    // A shift that has been approved and paid must not quietly become
    // something else; a dispute is a visible act with a case attached.
    expect(allowedTransitionsFrom('APPROVED')).toEqual(['DISPUTED']);
  });

  it('lets a manual correction begin from anywhere a shift can go wrong', () => {
    // A facility whose network failed can be recording before check-in,
    // between check-in and check-out, or after a rejection.
    for (const from of [
      'NOT_STARTED',
      'CHECK_IN_PENDING',
      'CHECKED_IN',
      'CHECKED_OUT',
      'SUBMITTED',
      'REJECTED',
    ] as AttendanceState[]) {
      expect(canTransition(from, 'MANUALLY_CORRECTED'), from).toBe(true);
    }
  });

  it('sends a corrected record back for approval rather than straight to approved', () => {
    expect(allowedTransitionsFrom('MANUALLY_CORRECTED')).toEqual(['SUBMITTED']);
    expect(canTransition('MANUALLY_CORRECTED', 'APPROVED')).toBe(false);
  });
});
