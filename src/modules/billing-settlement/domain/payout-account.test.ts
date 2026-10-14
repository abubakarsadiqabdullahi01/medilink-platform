import { describe, expect, it } from 'vitest';
import {
  accountProblem,
  coolingOffEnds,
  maskedNumber,
  namesAgree,
  normaliseAccountNumber,
} from './payout-account';

const ok = { bankName: 'Guaranty Trust Bank', accountName: 'EZE NGOZI CHIDINMA', accountNumber: '0123456789' };

describe('an account number', () => {
  it('is ten digits, with the spaces and hyphens people type removed', () => {
    expect(normaliseAccountNumber('0123 456 789')).toBe('0123456789');
    expect(normaliseAccountNumber(' 0123-456-789 ')).toBe('0123456789');
  });

  it('is shown as its last four, never whole, when it is only being displayed', () => {
    expect(maskedNumber('6789')).toBe('••••••6789');
  });
});

describe('an account being given', () => {
  it('is accepted with a bank, a name and a ten-digit number', () => {
    expect(accountProblem(ok)).toBeNull();
  });

  it('is refused without a bank, or with an absurd one', () => {
    expect(accountProblem({ ...ok, bankName: ' ' })).toBe('bank');
    expect(accountProblem({ ...ok, bankName: 'x'.repeat(81) })).toBe('bank');
  });

  it('is refused without the name the bank holds it under', () => {
    expect(accountProblem({ ...ok, accountName: ' ' })).toBe('name');
    expect(accountProblem({ ...ok, accountName: 'A' })).toBe('name');
    expect(accountProblem({ ...ok, accountName: 'x'.repeat(121) })).toBe('name');
  });

  it('is refused unless the number is exactly ten digits', () => {
    expect(accountProblem({ ...ok, accountNumber: '012345678' })).toBe('number');
    expect(accountProblem({ ...ok, accountNumber: '01234567890' })).toBe('number');
    expect(accountProblem({ ...ok, accountNumber: '01234abcde' })).toBe('number');
    expect(accountProblem({ ...ok, accountNumber: '' })).toBe('number');
  });

  it('accepts a number typed with spaces', () => {
    expect(accountProblem({ ...ok, accountNumber: '0123 456 789' })).toBeNull();
  });
});

describe('whether the name on an account is the practitioner', () => {
  it('agrees when the bank writes the same names in a different order, in capitals', () => {
    expect(namesAgree('EZE NGOZI CHIDINMA', 'Ngozi Eze')).toBe(true);
  });

  it('agrees through accents and punctuation', () => {
    expect(namesAgree('Adébáyò, Olúwáseun', 'Oluwaseun Adebayo')).toBe(true);
  });

  it('does not agree on a single shared name when each has two: that is a relative or a stranger', () => {
    expect(namesAgree('Yusuf Bello', 'Amina Yusuf')).toBe(false);
  });

  it('does not agree on different people', () => {
    expect(namesAgree('AMINA YUSUF', 'Aisha Bello')).toBe(false);
  });

  it('accepts one shared name when the registered name is only one', () => {
    expect(namesAgree('Chidi Okafor', 'Chidi')).toBe(true);
  });

  it('does not agree on nothing', () => {
    expect(namesAgree('', 'Ngozi Eze')).toBe(false);
    expect(namesAgree('Ngozi Eze', '')).toBe(false);
  });
});

describe('cooling off after an account is given', () => {
  it('ends the given number of hours after it was submitted', () => {
    const submitted = new Date('2026-10-14T10:00:00.000Z');

    expect(coolingOffEnds(submitted, 24).toISOString()).toBe('2026-10-15T10:00:00.000Z');
    expect(coolingOffEnds(submitted, 0).toISOString()).toBe('2026-10-14T10:00:00.000Z');
  });
});
