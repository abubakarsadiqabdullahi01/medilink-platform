import { describe, expect, it } from 'vitest';
import {
  BASIS_FOR_PURPOSE,
  BLOCKER_EXPLANATIONS,
  CONSENT_AT_REGISTRATION,
  RESPONSE_WINDOW_DAYS,
  dueDateFor,
  erasureBlockers,
  isOverdue,
  isWithdrawable,
} from './consent';

describe('lawful basis', () => {
  it('gives every purpose one', () => {
    for (const [purpose, basis] of Object.entries(BASIS_FOR_PURPOSE)) {
      expect(basis, purpose).toBeTruthy();
    }
  });

  it('does not call a legal obligation consent', () => {
    // Asking somebody to "consent" to a licence check the platform will run
    // regardless is a consent form, not consent, and the Act treats the two
    // very differently.
    expect(BASIS_FOR_PURPOSE.IDENTITY_VERIFICATION).toBe('LEGAL_OBLIGATION');
    expect(isWithdrawable('IDENTITY_VERIFICATION')).toBe(false);
  });

  it('lets the genuinely optional ones be withdrawn', () => {
    for (const purpose of ['CREDENTIAL_SHARING', 'PROFILE_VISIBILITY', 'MARKETING'] as const) {
      expect(isWithdrawable(purpose), purpose).toBe(true);
    }
  });

  it('never asks for marketing consent by default', () => {
    // A consent collected by default is not freely given.
    expect(CONSENT_AT_REGISTRATION).not.toContain('MARKETING');
  });

  it('only asks at registration for things that are actually consent', () => {
    for (const purpose of CONSENT_AT_REGISTRATION) {
      expect(isWithdrawable(purpose), purpose).toBe(true);
    }
  });
});

describe('the response window', () => {
  it('is a month from receipt', () => {
    const received = new Date('2026-09-01T00:00:00.000Z');
    expect(dueDateFor(received).toISOString().slice(0, 10)).toBe('2026-10-01');
    expect(RESPONSE_WINDOW_DAYS).toBe(30);
  });

  it('marks an unanswered request overdue once the window closes', () => {
    const dueBy = new Date('2026-09-01T00:00:00.000Z');
    const after = new Date('2026-09-02T00:00:00.000Z');
    expect(isOverdue({ dueBy, status: 'RECEIVED' }, after)).toBe(true);
    expect(isOverdue({ dueBy, status: 'IN_PROGRESS' }, after)).toBe(true);
  });

  it('does not call a finished request overdue', () => {
    const dueBy = new Date('2026-09-01T00:00:00.000Z');
    const after = new Date('2026-12-01T00:00:00.000Z');
    // Answered late is a fact about the past, not a thing still owed.
    expect(isOverdue({ dueBy, status: 'COMPLETED' }, after)).toBe(false);
    expect(isOverdue({ dueBy, status: 'REFUSED' }, after)).toBe(false);
  });
});

describe('erasure', () => {
  const clear = { confirmedAssignments: 0, owedKobo: 0, openDisputes: 0 };

  it('proceeds when nothing is outstanding', () => {
    expect(erasureBlockers(clear)).toEqual([]);
  });

  it('defers while a shift is still on a roster', () => {
    expect(erasureBlockers({ ...clear, confirmedAssignments: 1 })).toContain('open_assignment');
  });

  it('defers while money is owed', () => {
    // Erasing somebody owed money leaves nobody to pay.
    expect(erasureBlockers({ ...clear, owedKobo: 400_000 })).toContain('unpaid_balance');
  });

  it('defers while a dispute needs both sides', () => {
    expect(erasureBlockers({ ...clear, openDisputes: 1 })).toContain('open_dispute');
  });

  it('reports every reason at once', () => {
    expect(
      erasureBlockers({ confirmedAssignments: 2, owedKobo: 1, openDisputes: 1 }),
    ).toEqual(['open_assignment', 'unpaid_balance', 'open_dispute']);
  });

  it('explains every blocker in words a subject can read', () => {
    for (const blocker of erasureBlockers({
      confirmedAssignments: 1,
      owedKobo: 1,
      openDisputes: 1,
    })) {
      expect(BLOCKER_EXPLANATIONS[blocker].length, blocker).toBeGreaterThan(30);
    }
  });
});
