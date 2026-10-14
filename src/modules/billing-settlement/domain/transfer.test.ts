import { describe, expect, it } from 'vitest';
import { transferProblem } from './transfer';

const NOW = new Date('2026-10-14T10:00:00.000Z');
const ok = { reference: 'GTB/OUT/55120', paidOn: '2026-10-14' };
const released = { releasedOn: '2026-10-13' };

describe('a transfer being recorded', () => {
  it('is accepted with a reference and a date between release and today', () => {
    expect(transferProblem(ok, released, NOW)).toBeNull();
    expect(transferProblem({ ...ok, paidOn: '2026-10-13' }, released, NOW)).toBeNull();
  });

  it('needs the bank\'s reference, of a sensible length', () => {
    expect(transferProblem({ ...ok, reference: '  ' }, released, NOW)).toBe('reference');
    expect(transferProblem({ ...ok, reference: 'ab' }, released, NOW)).toBe('reference');
    expect(transferProblem({ ...ok, reference: 'x'.repeat(101) }, released, NOW)).toBe('reference');
    expect(transferProblem({ ...ok, reference: 'x'.repeat(100) }, released, NOW)).toBeNull();
  });

  it('needs a date that exists, written year-month-day', () => {
    expect(transferProblem({ ...ok, paidOn: '14/10/2026' }, released, NOW)).toBe('date');
    expect(transferProblem({ ...ok, paidOn: '2026-02-30' }, released, NOW)).toBe('date');
  });

  it('is refused if dated after today in Lagos', () => {
    expect(transferProblem({ ...ok, paidOn: '2026-10-15' }, released, NOW)).toBe('future');
  });

  it('counts today by Lagos, not UTC', () => {
    const lateEvening = new Date('2026-10-14T23:30:00.000Z');

    expect(transferProblem({ ...ok, paidOn: '2026-10-15' }, released, lateEvening)).toBeNull();
  });

  it('is refused if dated before the payout was released', () => {
    expect(transferProblem({ ...ok, paidOn: '2026-10-12' }, released, NOW)).toBe('before_release');
  });

  it('does not compare against a release date a payout does not have', () => {
    expect(transferProblem({ ...ok, paidOn: '2020-01-01' }, { releasedOn: null }, NOW)).toBeNull();
  });
});
