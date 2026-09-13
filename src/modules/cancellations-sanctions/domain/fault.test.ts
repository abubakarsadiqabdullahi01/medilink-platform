import { describe, expect, it } from 'vitest';
import {
  assignmentOutcomeFor,
  closeBlockers,
  excusalDecisionBlockers,
  FAULT_VALUES,
  type CloseCheck,
} from './fault';

const open: CloseCheck = {
  status: 'AWAITING_DECISION',
  fault: 'PRACTITIONER',
  reason: 'Did not attend and did not answer the ward on the day.',
  hasGrantedExcusal: false,
};

describe('closeBlockers', () => {
  it('lets a decided determination close', () => {
    expect(closeBlockers(open)).toEqual([]);
  });

  it('refuses to close with no fault decided', () => {
    // The gate condition: null is the absence of a decision, and closing on
    // it would record silence as a finding.
    expect(closeBlockers({ ...open, fault: null })).toContain('fault_not_decided');
  });

  it('refuses a reason too short to mean anything', () => {
    expect(closeBlockers({ ...open, reason: 'no show' })).toContain('reason_missing');
  });

  it('refuses to close twice', () => {
    expect(closeBlockers({ ...open, status: 'CLOSED' })).toContain('already_closed');
  });

  it('refuses practitioner fault once an excusal has been granted', () => {
    expect(closeBlockers({ ...open, hasGrantedExcusal: true })).toContain(
      'excused_cannot_be_practitioner_fault',
    );
  });

  it('lets an excused absence close as nobody s fault', () => {
    expect(
      closeBlockers({ ...open, fault: 'NEITHER', hasGrantedExcusal: true }),
    ).toEqual([]);
  });

  it('lets an excused absence close as the facility s fault', () => {
    expect(closeBlockers({ ...open, fault: 'FACILITY', hasGrantedExcusal: true })).toEqual([]);
  });

  it('reports everything wrong at once', () => {
    const blockers = closeBlockers({
      status: 'CLOSED',
      fault: null,
      reason: '',
      hasGrantedExcusal: false,
    });
    expect(blockers).toEqual(['already_closed', 'fault_not_decided', 'reason_missing']);
  });
});

describe('assignmentOutcomeFor', () => {
  it('is a no-show only when the practitioner was at fault', () => {
    expect(assignmentOutcomeFor('PRACTITIONER')).toBe('NO_SHOW');
    expect(assignmentOutcomeFor('FACILITY')).toBe('CANCELLED');
    expect(assignmentOutcomeFor('NEITHER')).toBe('CANCELLED');
  });

  it('has an outcome for every fault value', () => {
    for (const fault of FAULT_VALUES) {
      expect(['NO_SHOW', 'CANCELLED']).toContain(assignmentOutcomeFor(fault));
    }
  });
});

describe('excusalDecisionBlockers', () => {
  it('grants without notes', () => {
    expect(
      excusalDecisionBlockers({ status: 'REQUESTED', decision: 'grant', notes: '' }),
    ).toEqual([]);
  });

  it('refuses a refusal with no reason', () => {
    expect(
      excusalDecisionBlockers({ status: 'REQUESTED', decision: 'refuse', notes: 'no' }),
    ).toContain('notes_missing');
  });

  it('will not decide the same request twice', () => {
    for (const status of ['GRANTED', 'REFUSED'] as const) {
      expect(
        excusalDecisionBlockers({ status, decision: 'grant', notes: '' }),
      ).toContain('already_decided');
    }
  });
});
