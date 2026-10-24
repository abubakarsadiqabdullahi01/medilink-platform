import { describe, expect, it } from 'vitest';
import {
  CASE_FIELDS_HIDDEN_FROM_PARTIES,
  DECISION_REASONS,
  DECISION_REASON_WORDS,
  DISPUTE_CATEGORIES,
  DISPUTE_RESPONSE_DAYS,
  DISPUTE_WINDOW_DAYS,
  EVIDENCE_FIELDS,
  compareForQueue,
  disputeDeadline,
  isDisputable,
  openBlockers,
  partyCaseView,
  partyFor,
  resolveBlockers,
  respondBlockers,
  responseDeadline,
  responseOverdue,
  stageOf,
  withdrawBlockers,
  withinWindow,
  type DecisionReasonValue,
  type DisputeStage,
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
        decisionReason: 'RECORD_WAS_WRONG',
        notes: 'Ward diary confirms the practitioner stayed for the handover.',
      }),
    ).toEqual([]);
  });

  it('refuses to resolve with no outcome', () => {
    expect(
      resolveBlockers({ status: 'OPEN', outcome: null, decisionReason: null, notes: 'A long enough note to pass.' }),
    ).toContain('outcome_missing');
  });

  it('refuses to resolve with no reason', () => {
    // Both parties have to read why they won or lost.
    expect(
      resolveBlockers({ status: 'OPEN', outcome: 'DISMISSED', decisionReason: 'RECORD_CONFIRMED', notes: 'no' }),
    ).toContain('notes_missing');
  });

  it('will not re-adjudicate a finished case', () => {
    for (const status of ['RESOLVED', 'WITHDRAWN'] as const) {
      expect(
        resolveBlockers({
          status,
          outcome: 'UPHELD',
          decisionReason: 'RECORD_WAS_WRONG',
          notes: 'A long enough note to pass.',
        }),
      ).toContain('not_open');
    }
  });

  it('still resolves one already under review', () => {
    expect(
      resolveBlockers({
        status: 'UNDER_REVIEW',
        outcome: 'DISMISSED',
        decisionReason: 'NOT_ENOUGH_TO_DECIDE',
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

describe('the other side’s reply, and how long they have', () => {
  const OPENED = new Date('2026-09-10T12:00:00.000Z');
  const reply = 'The ward diary shows the practitioner signed out at the end of the shift, not later.';
  const ok = {
    status: 'OPEN' as const,
    raisedParty: 'PRACTITIONER' as const,
    responderParty: 'FACILITY' as const,
    alreadyResponded: false,
    text: reply,
  };

  it('is seven days from when the case was opened, which is a default and not an approved policy', () => {
    expect(DISPUTE_RESPONSE_DAYS).toBe(7);
    expect(responseDeadline(OPENED).toISOString()).toBe('2026-09-17T12:00:00.000Z');
  });

  it('is open to the side that did not raise the case, once, while it is live, in words', () => {
    expect(respondBlockers(ok)).toEqual([]);
    expect(respondBlockers({ ...ok, status: 'UNDER_REVIEW' })).toEqual([]);
    expect(respondBlockers({ ...ok, raisedParty: 'FACILITY', responderParty: 'PRACTITIONER' })).toEqual([]);
  });

  it('is not open to the side that raised it, to an adjudicator, or to somebody on neither side', () => {
    expect(respondBlockers({ ...ok, responderParty: 'PRACTITIONER' })).toEqual(['not_the_other_side']);
    expect(respondBlockers({ ...ok, responderParty: null })).toEqual(['not_the_other_side']);
  });

  it('is not open a second time: a reply is written once, as evidence is', () => {
    expect(respondBlockers({ ...ok, alreadyResponded: true })).toEqual(['already_responded']);
  });

  it('is not open on a case that has finished', () => {
    for (const status of ['RESOLVED', 'WITHDRAWN'] as const) {
      expect(respondBlockers({ ...ok, status })).toEqual(['not_open']);
    }
  });

  it('needs more than a word or two, as raising a case does', () => {
    expect(respondBlockers({ ...ok, text: 'No.' })).toEqual(['response_missing']);
    expect(respondBlockers({ ...ok, text: '   ' })).toEqual(['response_missing']);
    expect(respondBlockers({ ...ok, text: 'x'.repeat(19) })).toEqual(['response_missing']);
    expect(respondBlockers({ ...ok, text: 'x'.repeat(20) })).toEqual([]);
  });

  it('reports everything wrong at once, in a fixed order', () => {
    expect(
      respondBlockers({
        status: 'RESOLVED',
        raisedParty: 'FACILITY',
        responderParty: 'FACILITY',
        alreadyResponded: true,
        text: '',
      }),
    ).toEqual(['not_open', 'not_the_other_side', 'already_responded', 'response_missing']);
  });
});

describe('where a case stands for whoever is deciding it', () => {
  const OPENED = new Date('2026-09-10T12:00:00.000Z');
  const BY = responseDeadline(OPENED);
  const base = { status: 'OPEN' as const, respondBy: BY, respondedAt: null as Date | null };
  const before = new Date(BY.getTime() - 1);
  const after = new Date(BY.getTime() + 1);

  it('is waiting for the other side until they have replied or their time is up', () => {
    expect(stageOf({ ...base, now: before })).toBe('waiting_for_response');
    // At the very moment the time is up it is still theirs: the same edge as the opening window.
    expect(stageOf({ ...base, now: BY })).toBe('waiting_for_response');
  });

  it('is ready to decide once they have replied, even with time to spare', () => {
    expect(stageOf({ ...base, respondedAt: OPENED, now: before })).toBe('ready_to_decide');
  });

  it('is ready to decide once their time is up with no reply, and says the reply is overdue', () => {
    expect(stageOf({ ...base, now: after })).toBe('ready_to_decide');
    expect(responseOverdue({ ...base, now: after })).toBe(true);
  });

  it('is not overdue when they replied, when time is left, or when the case has finished', () => {
    expect(responseOverdue({ ...base, now: before })).toBe(false);
    expect(responseOverdue({ ...base, respondedAt: OPENED, now: after })).toBe(false);
    expect(responseOverdue({ ...base, status: 'RESOLVED', now: after })).toBe(false);
    expect(responseOverdue({ ...base, status: 'WITHDRAWN', now: after })).toBe(false);
  });

  it('is under review once an officer has picked it up, whatever else is true', () => {
    expect(stageOf({ ...base, status: 'UNDER_REVIEW', now: before })).toBe('under_review');
    expect(stageOf({ ...base, status: 'UNDER_REVIEW', now: after })).toBe('under_review');
  });

  it('is closed once resolved or withdrawn', () => {
    expect(stageOf({ ...base, status: 'RESOLVED', now: after })).toBe('closed');
    expect(stageOf({ ...base, status: 'WITHDRAWN', now: before })).toBe('closed');
  });

  it('puts what can be decided first, then what is being worked, then what is waiting, then what is done', () => {
    const row = (stage: DisputeStage, createdAt: string, id: string) => ({
      stage,
      createdAt: new Date(createdAt),
      id,
    });
    const rows = [
      row('closed', '2026-09-01T00:00:00Z', 'a'),
      row('waiting_for_response', '2026-09-02T00:00:00Z', 'b'),
      row('under_review', '2026-09-03T00:00:00Z', 'c'),
      row('ready_to_decide', '2026-09-05T00:00:00Z', 'd'),
      row('ready_to_decide', '2026-09-04T00:00:00Z', 'e'),
      row('ready_to_decide', '2026-09-04T00:00:00Z', 'f'),
    ];
    expect([...rows].sort(compareForQueue).map((r) => r.id)).toEqual(['e', 'f', 'd', 'c', 'b', 'a']);
  });
});

describe('the reason a case was decided as it was', () => {
  it('has reasons for each outcome, and words a party can read for every one', () => {
    expect(DECISION_REASONS.UPHELD.length).toBeGreaterThanOrEqual(2);
    expect(DECISION_REASONS.DISMISSED.length).toBeGreaterThanOrEqual(2);
    const all = new Set([...DECISION_REASONS.UPHELD, ...DECISION_REASONS.DISMISSED]);
    expect(Object.keys(DECISION_REASON_WORDS).sort()).toEqual([...all].sort());
    for (const [code, words] of Object.entries(DECISION_REASON_WORDS)) {
      expect(words.length, code).toBeGreaterThan(25);
      expect(words, code).not.toMatch(/_/);
      expect(words.endsWith('.'), code).toBe(true);
    }
  });

  it('accepts a reason that belongs to the outcome', () => {
    for (const outcome of ['UPHELD', 'DISMISSED'] as const) {
      for (const decisionReason of DECISION_REASONS[outcome]) {
        expect(
          resolveBlockers({ status: 'OPEN', outcome, decisionReason, notes: 'A long enough note to pass.' }),
          `${outcome} / ${decisionReason}`,
        ).toEqual([]);
      }
    }
  });

  it('refuses a missing reason', () => {
    expect(
      resolveBlockers({ status: 'OPEN', outcome: 'UPHELD', decisionReason: null, notes: 'A long enough note to pass.' }),
    ).toEqual(['decision_reason_missing']);
  });

  it('refuses a reason that belongs to the other outcome', () => {
    const notes = 'A long enough note to pass.';
    expect(
      resolveBlockers({ status: 'OPEN', outcome: 'UPHELD', decisionReason: 'COMPLAINT_NOT_MADE_OUT', notes }),
    ).toEqual(['decision_reason_not_for_outcome']);
    expect(
      resolveBlockers({ status: 'OPEN', outcome: 'DISMISSED', decisionReason: 'RECORD_WAS_WRONG', notes }),
    ).toEqual(['decision_reason_not_for_outcome']);
  });

  it('allows OTHER under either outcome, since the notes are required anyway', () => {
    expect(DECISION_REASONS.UPHELD).toContain('OTHER');
    expect(DECISION_REASONS.DISMISSED).toContain('OTHER');
  });

  it('does not report a mismatch while there is still no outcome to match it against', () => {
    expect(
      resolveBlockers({ status: 'OPEN', outcome: null, decisionReason: 'RECORD_WAS_WRONG', notes: 'A long enough note to pass.' }),
    ).toEqual(['outcome_missing']);
  });

  it('offers no reason that decides a case because somebody was silent', () => {
    // Nobody is found against from a missing reply alone: a late or missing reply is the
    // officer's to weigh, with the record, and the finding is about the record.
    const text = [...Object.keys(DECISION_REASON_WORDS), ...Object.values(DECISION_REASON_WORDS)].join(' ');
    expect(text).not.toMatch(/silen|no repl|did not repl|did not respond|no response|by default|in absence|failed to/i);
  });

  it('says each is about the record or the agreement, not about the people', () => {
    const codes: DecisionReasonValue[] = [...DECISION_REASONS.UPHELD, ...DECISION_REASONS.DISMISSED];
    for (const code of codes) {
      expect(DECISION_REASON_WORDS[code], code).not.toMatch(/\b(liar|lied|dishonest|fraud|guilty|blame)\b/i);
    }
  });
});

describe('what each side of a case may see', () => {
  it('shows a party the other side’s evidence by side, and never who attached it or where the file is kept', () => {
    expect([...EVIDENCE_FIELDS.party].sort()).toEqual(['attachedBySide', 'bySide', 'createdAt', 'id', 'note']);
    for (const hidden of ['objectKey', 'attachedBy', 'attachedByName']) {
      expect(EVIDENCE_FIELDS.party as readonly string[]).not.toContain(hidden);
      expect(EVIDENCE_FIELDS.adjudicator as readonly string[]).toContain(hidden);
    }
  });

  it('shows the adjudicator everything a party sees except whose side the reader is on', () => {
    for (const field of EVIDENCE_FIELDS.party) {
      if (field === 'bySide') continue;
      expect(EVIDENCE_FIELDS.adjudicator as readonly string[]).toContain(field);
    }
  });

  it('keeps the identity of whoever raised, replied to or decided a case from the parties', () => {
    expect([...CASE_FIELDS_HIDDEN_FROM_PARTIES].sort()).toEqual(['raisedBy', 'resolvedBy', 'respondedBy']);
    const full = {
      id: 'd1',
      status: 'RESOLVED',
      raisedBy: 'user-1',
      resolvedBy: 'officer-1',
      respondedBy: 'user-2',
      resolutionNotes: 'Decided.',
    };
    const seen = partyCaseView(full);
    expect(seen).toEqual({ id: 'd1', status: 'RESOLVED', resolutionNotes: 'Decided.' });
    expect(full.raisedBy).toBe('user-1');
  });
});
