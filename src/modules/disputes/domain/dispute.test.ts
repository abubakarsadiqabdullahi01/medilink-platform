import { describe, expect, it } from 'vitest';
import {
  DISPUTE_CATEGORIES,
  DISPUTE_WINDOW_DAYS,
  disputeDeadline,
  isDisputable,
  openBlockers,
  partyFor,
  resolveBlockers,
  withdrawBlockers,
  withinWindow,
  type OpenCheck,
} from './dispute';

const NOW = new Date('2026-09-13T12:00:00.000Z');
const DECIDED = new Date('2026-09-10T12:00:00.000Z');

const openable: OpenCheck = {
  attendanceStatus: 'APPROVED',
  decidedAt: DECIDED,
  hasOpenDispute: false,
  reason: 'The approved hours are two short: I stayed until the night staff arrived.',
  isParty: true,
  now: NOW,
};

describe('what can be disputed', () => {
  it('is an approved or a rejected shift, and nothing else', () => {
    expect(isDisputable('APPROVED')).toBe(true);
    expect(isDisputable('REJECTED')).toBe(true);

    for (const state of [
      'NOT_STARTED',
      'CHECK_IN_PENDING',
      'CHECKED_IN',
      'CHECKED_OUT',
      'SUBMITTED',
      'DISPUTED',
      'MANUALLY_CORRECTED',
    ]) {
      expect(isDisputable(state), state).toBe(false);
    }
  });

  it('refuses a shift nobody has decided yet', () => {
    // There are ordinary routes for saying an undecided shift is wrong:
    // correct it, or reject it. A dispute is for after the decision.
    expect(openBlockers({ ...openable, attendanceStatus: 'SUBMITTED', decidedAt: null })).toContain(
      'not_yet_decided',
    );
  });

  it('reports not_yet_decided once, not twice, when there is no decision', () => {
    const blockers = openBlockers({
      ...openable,
      attendanceStatus: 'SUBMITTED',
      decidedAt: null,
    });
    expect(blockers.filter((b) => b === 'not_yet_decided')).toHaveLength(1);
  });
});

describe('the window', () => {
  it('lets a case open inside it', () => {
    expect(openBlockers(openable)).toEqual([]);
  });

  it('runs from the decision, not from the shift', () => {
    // A timesheet approved three weeks late leaves the same fortnight as one
    // approved the next morning.
    const lateDecision = new Date('2026-09-12T12:00:00.000Z');
    expect(withinWindow(lateDecision, NOW)).toBe(true);
  });

  it('closes after fourteen days', () => {
    const old = new Date(NOW.getTime() - (DISPUTE_WINDOW_DAYS + 1) * 24 * 60 * 60 * 1000);
    expect(withinWindow(old, NOW)).toBe(false);
    expect(openBlockers({ ...openable, decidedAt: old })).toContain('outside_window');
  });

  it('includes the final moment rather than excluding it', () => {
    const deadline = disputeDeadline(DECIDED);
    expect(withinWindow(DECIDED, deadline)).toBe(true);
    expect(withinWindow(DECIDED, new Date(deadline.getTime() + 1))).toBe(false);
  });
});

describe('other reasons a case cannot open', () => {
  it('refuses somebody who is on neither side of the shift', () => {
    expect(openBlockers({ ...openable, isParty: false })).toContain('not_a_party');
  });

  it('refuses a second open case over one shift', () => {
    // Two open cases is two people adjudicating the same question.
    expect(openBlockers({ ...openable, hasOpenDispute: true })).toContain('already_open');
  });

  it('refuses a reason too short to be a complaint', () => {
    expect(openBlockers({ ...openable, reason: 'wrong' })).toContain('reason_missing');
  });

  it('reports everything wrong at once', () => {
    expect(
      openBlockers({
        attendanceStatus: 'SUBMITTED',
        decidedAt: null,
        hasOpenDispute: true,
        reason: '',
        isParty: false,
        now: NOW,
      }),
    ).toEqual(['not_a_party', 'not_yet_decided', 'already_open', 'reason_missing']);
  });
});

describe('resolving', () => {
  it('accepts an outcome with a reason', () => {
    expect(
      resolveBlockers({
        status: 'OPEN',
        outcome: 'UPHELD',
        notes: 'Ward diary confirms the practitioner stayed for the handover.',
      }),
    ).toEqual([]);
  });

  it('refuses to resolve with no outcome', () => {
    expect(
      resolveBlockers({ status: 'OPEN', outcome: null, notes: 'A long enough note to pass.' }),
    ).toContain('outcome_missing');
  });

  it('refuses to resolve with no reason', () => {
    // Both parties have to read why they won or lost.
    expect(resolveBlockers({ status: 'OPEN', outcome: 'DISMISSED', notes: 'no' })).toContain(
      'notes_missing',
    );
  });

  it('will not re-adjudicate a finished case', () => {
    for (const status of ['RESOLVED', 'WITHDRAWN'] as const) {
      expect(
        resolveBlockers({ status, outcome: 'UPHELD', notes: 'A long enough note to pass.' }),
      ).toContain('not_open');
    }
  });

  it('still resolves one already under review', () => {
    expect(
      resolveBlockers({
        status: 'UNDER_REVIEW',
        outcome: 'DISMISSED',
        notes: 'Nothing was produced to support the claim.',
      }),
    ).toEqual([]);
  });
});

describe('withdrawing', () => {
  it('is for the party who raised it, while it is open', () => {
    expect(withdrawBlockers({ status: 'OPEN', raisedBy: 'a', actorId: 'a' })).toEqual([]);
  });

  it('is not for anybody else', () => {
    expect(withdrawBlockers({ status: 'OPEN', raisedBy: 'a', actorId: 'b' })).toContain(
      'not_the_raiser',
    );
  });

  it('is not for a case already finished', () => {
    expect(withdrawBlockers({ status: 'RESOLVED', raisedBy: 'a', actorId: 'a' })).toContain(
      'not_open',
    );
  });
});

describe('which side somebody is on', () => {
  it('is the practitioner when it is their shift', () => {
    expect(partyFor({ actorId: 'p', practitionerId: 'p', facilityMember: false })).toBe(
      'PRACTITIONER',
    );
  });

  it('is the facility when they act for it', () => {
    expect(partyFor({ actorId: 'f', practitionerId: 'p', facilityMember: true })).toBe('FACILITY');
  });

  it('is nobody for an onlooker', () => {
    // An operations officer adjudicates disputes; they do not raise them,
    // because a case nobody involved wanted is not a dispute.
    expect(partyFor({ actorId: 'o', practitionerId: 'p', facilityMember: false })).toBeNull();
  });

  it('prefers the practitioner when one person is somehow both', () => {
    expect(partyFor({ actorId: 'p', practitionerId: 'p', facilityMember: true })).toBe(
      'PRACTITIONER',
    );
  });
});

describe('the category list', () => {
  it('names every category exactly once', () => {
    expect(new Set(DISPUTE_CATEGORIES).size).toBe(DISPUTE_CATEGORIES.length);
    expect(DISPUTE_CATEGORIES).toContain('HOURS');
    expect(DISPUTE_CATEGORIES).toContain('PAY');
  });
});
