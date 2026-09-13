import { describe, expect, it } from 'vitest';
import {
  INCIDENT_SEVERITIES,
  closeBlockers,
  isAtLeast,
  outcomeSuspends,
  reportBlockers,
  requiresReview,
  severityRank,
  type CloseCheck,
} from './incident';

const NOW = new Date('2026-09-13T12:00:00.000Z');

describe('reporting is deliberately easy', () => {
  it('accepts a report with a summary and a past time', () => {
    expect(
      reportBlockers({
        summary: 'Wrong dose drawn up and caught by the second checker before it was given.',
        occurredAt: new Date('2026-09-12T09:00:00.000Z'),
        now: NOW,
      }),
    ).toEqual([]);
  });

  it('asks for a summary and nothing else', () => {
    // Every extra mandatory field is a reason somebody closes the form
    // instead, and the report never happens.
    expect(
      reportBlockers({ summary: 'wrong dose', occurredAt: NOW, now: NOW }),
    ).toEqual(['summary_missing']);
  });

  it('refuses an incident that has not happened yet', () => {
    expect(
      reportBlockers({
        summary: 'Wrong dose drawn up and caught by the second checker before it was given.',
        occurredAt: new Date(NOW.getTime() + 60_000),
        now: NOW,
      }),
    ).toContain('occurred_in_the_future');
  });

  it('accepts one reported at the moment it happened', () => {
    expect(
      reportBlockers({
        summary: 'Wrong dose drawn up and caught by the second checker before it was given.',
        occurredAt: NOW,
        now: NOW,
      }),
    ).toEqual([]);
  });
});

describe('severity', () => {
  it('puts near miss first, not last', () => {
    // The most useful reports and the easiest to lose.
    expect(INCIDENT_SEVERITIES[0]).toBe('NEAR_MISS');
    expect(severityRank('NEAR_MISS')).toBeLessThan(severityRank('DEATH'));
  });

  it('orders every level distinctly', () => {
    const ranks = INCIDENT_SEVERITIES.map(severityRank);
    expect(new Set(ranks).size).toBe(INCIDENT_SEVERITIES.length);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });

  it('compares against a floor', () => {
    expect(isAtLeast('SEVERE', 'MODERATE')).toBe(true);
    expect(isAtLeast('MINOR', 'MODERATE')).toBe(false);
    expect(isAtLeast('MODERATE', 'MODERATE')).toBe(true);
  });

  it('requires review for the two most serious and no others', () => {
    expect(INCIDENT_SEVERITIES.filter(requiresReview)).toEqual(['SEVERE', 'DEATH']);
  });
});

describe('closing', () => {
  const closable: CloseCheck = {
    status: 'UNDER_REVIEW',
    severity: 'MODERATE',
    outcome: 'SYSTEM_ISSUE',
    notes: 'The drug cupboard labelling was the cause; relabelled and re-checked.',
  };

  it('accepts an outcome with a reason', () => {
    expect(closeBlockers(closable)).toEqual([]);
  });

  it('refuses a closure with no outcome', () => {
    expect(closeBlockers({ ...closable, outcome: null })).toContain('outcome_missing');
  });

  it('refuses a closure with no reason', () => {
    expect(closeBlockers({ ...closable, notes: 'fine' })).toContain('notes_missing');
  });

  it('refuses to close twice', () => {
    expect(closeBlockers({ ...closable, status: 'CLOSED' })).toContain('already_closed');
  });

  it('will not let a death be closed without anybody opening it', () => {
    // A death closed as "no action" straight from REPORTED is the failure
    // mode this exists to make awkward.
    expect(
      closeBlockers({ ...closable, severity: 'DEATH', status: 'REPORTED' }),
    ).toContain('not_reviewed');
  });

  it('lets a near miss be closed straight away', () => {
    // Most are, and requiring a review step for all of them would bury the
    // ones that matter.
    expect(closeBlockers({ ...closable, severity: 'NEAR_MISS', status: 'REPORTED' })).toEqual([]);
  });

  it('reports everything wrong at once', () => {
    expect(
      closeBlockers({ status: 'REPORTED', severity: 'SEVERE', outcome: null, notes: '' }),
    ).toEqual(['outcome_missing', 'notes_missing', 'not_reviewed']);
  });
});

describe('which outcome suspends', () => {
  it('is the one that says so, and only that one', () => {
    expect(outcomeSuspends('PRACTITIONER_SUSPENDED')).toBe(true);
    for (const outcome of [
      'SYSTEM_ISSUE',
      'NO_ACTION',
      'ADVICE_GIVEN',
      'TRAINING_REQUIRED',
      'REFERRED_TO_REGULATOR',
    ] as const) {
      expect(outcomeSuspends(outcome), outcome).toBe(false);
    }
  });
});
