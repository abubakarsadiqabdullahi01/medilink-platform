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

describe('patient identifiers', () => {
  /**
   * A report must not record who the patient was. The summary is free text, so
   * what is screened is only what can be recognised with confidence — a number
   * that is a phone or an ID, an email, a labelled hospital number — and the
   * screen is narrow on purpose: a report refused for a false alarm is a report
   * lost, and the report is the point.
   */
  const withSummary = (summary: string) =>
    reportBlockers({ summary, occurredAt: new Date('2026-09-12T09:00:00.000Z'), now: NOW });

  it.each([
    ['a mobile number', 'The patient called her son on 0803 123 4567 to say the dose was wrong and then collapsed.'],
    ['an international number', 'Relative reachable on +234 803 123 4567 was told about the wrong dose by the ward sister.'],
    ['an eleven digit ID', 'Patient NIN 12345678901 was given the wrong dose and the second checker caught it.'],
    ['an email address', 'The patient emailed amina.yusuf@example.com afterwards about the wrong dose given on the ward.'],
    ['a labelled hospital number', 'Wrong dose given to hospital number HN/2026/004412 and caught by the second checker.'],
    ['a labelled folder number', 'Folder No: 99812 was mixed up with another patient on the ward at handover time.'],
    ['an MRN', 'MRN 7781234 was the record the wrong dose was charted against and corrected later.'],
  ])('refuses %s', (_label, summary) => {
    expect(withSummary(summary)).toContain('contains_patient_identifier');
  });

  it.each([
    ['doses and strengths', 'Soluble insulin 100 units/ml given where 40 units/ml was charted; hourly glucose 5.6 mmol/L, no harm.'],
    ['times and dates', 'At 14:30 on 12/09/2026 a 500 mg dose was drawn up twice and caught by the second checker.'],
    ['ward and bed numbers', 'Bed 14 on Ward 3 had the wrong chart and the nurse in charge corrected it before the round.'],
    ['a count of people', 'Night shift ran two staff short for six hours with 48 patients on the ward.'],
    ['large but harmless numbers', 'The infusion pump was set to 125 ml per hour instead of 12.5 and was caught after 20 minutes.'],
  ])('does not mistake %s for one', (_label, summary) => {
    expect(withSummary(summary)).toEqual([]);
  });

  it('still reports everything else wrong at the same time', () => {
    expect(
      reportBlockers({
        summary: 'call 08031234567',
        occurredAt: new Date(NOW.getTime() + 60_000),
        now: NOW,
      }).sort(),
    ).toEqual(['contains_patient_identifier', 'occurred_in_the_future', 'summary_missing']);
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
