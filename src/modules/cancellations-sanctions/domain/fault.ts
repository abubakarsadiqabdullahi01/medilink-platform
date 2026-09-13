/**
 * Fault policy: pure, no database.
 *
 * Step 7.7's rule in one sentence — an unhonoured assignment cannot reach a
 * final state without somebody having decided whose fault it was.
 */

export type FaultValue = 'PRACTITIONER' | 'FACILITY' | 'NEITHER';
export type UnhonouredStatusValue = 'AWAITING_DECISION' | 'CLOSED';
export type ExcusalStatusValue = 'REQUESTED' | 'GRANTED' | 'REFUSED';

export const FAULT_VALUES: FaultValue[] = ['PRACTITIONER', 'FACILITY', 'NEITHER'];

export const FAULT_REASON_MIN_LENGTH = 10;
export const FAULT_REASON_MAX_LENGTH = 500;

export type CloseBlocker =
  | 'already_closed'
  | 'fault_not_decided'
  | 'reason_missing'
  | 'excused_cannot_be_practitioner_fault';

export interface CloseCheck {
  status: UnhonouredStatusValue;
  fault: FaultValue | null;
  reason: string;
  hasGrantedExcusal: boolean;
}

/**
 * Every reason this determination cannot be closed.
 *
 * Returned as a list rather than thrown one at a time, so a caller sees
 * everything wrong at once — the shape `confirmBlockers` already uses.
 */
export function closeBlockers(check: CloseCheck): CloseBlocker[] {
  const blockers: CloseBlocker[] = [];

  if (check.status === 'CLOSED') blockers.push('already_closed');

  // The gate condition. Null is not a decision; it is the absence of one, and
  // closing on it would record silence as a finding.
  if (check.fault === null) blockers.push('fault_not_decided');

  if (check.reason.trim().length < FAULT_REASON_MIN_LENGTH) blockers.push('reason_missing');

  // An excusal that has been granted and a finding of practitioner fault are
  // the same question answered both ways. Step 7.8 says a granted excusal
  // carries no penalty, and this is what makes that true of the data rather
  // than merely of the intention.
  if (check.hasGrantedExcusal && check.fault === 'PRACTITIONER') {
    blockers.push('excused_cannot_be_practitioner_fault');
  }

  return blockers;
}

/**
 * What a fault finding does to the assignment.
 *
 * Only practitioner fault produces a no-show. A facility that never opened
 * the ward and a flood that closed the road are both real, and neither is the
 * practitioner's record to carry.
 */
export function assignmentOutcomeFor(fault: FaultValue): 'NO_SHOW' | 'CANCELLED' {
  return fault === 'PRACTITIONER' ? 'NO_SHOW' : 'CANCELLED';
}

/** A refusal has to say why, for the reason a rejected timesheet does. */
export function excusalDecisionBlockers(input: {
  status: ExcusalStatusValue;
  decision: 'grant' | 'refuse';
  notes: string;
}): Array<'already_decided' | 'notes_missing'> {
  const blockers: Array<'already_decided' | 'notes_missing'> = [];
  if (input.status !== 'REQUESTED') blockers.push('already_decided');
  if (input.decision === 'refuse' && input.notes.trim().length < FAULT_REASON_MIN_LENGTH) {
    blockers.push('notes_missing');
  }
  return blockers;
}
