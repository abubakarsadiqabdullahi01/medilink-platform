import { describe, expect, it } from 'vitest';
import { paymentProblem, type PaymentRecord } from './payment';

/**
 * BIL-07: "mark paid" was a bare button. Nothing said which transfer it was, how
 * much arrived, when, or from whom, so an invoice could be marked paid against
 * nothing and nobody could later check it against a bank statement.
 */

const NOW = new Date('2026-10-14T10:00:00.000Z');
const GROSS = 4_000_000;

const good: PaymentRecord = {
  reference: 'FBN/TRF/20261013/0042',
  amountKobo: GROSS,
  paidOn: '2026-10-13',
  payerName: 'Kano Teaching Hospital',
};

const problem = (overrides: Partial<PaymentRecord> = {}, issuedOn: string | null = '2026-10-01') =>
  paymentProblem({ ...good, ...overrides }, { grossKobo: GROSS, issuedOn }, NOW);

describe('a payment record', () => {
  it('is accepted when it says which transfer, how much, when and from whom', () => {
    expect(problem()).toBeNull();
  });

  describe('the bank reference', () => {
    it('is required, and a blank one is not one', () => {
      expect(problem({ reference: '' })).toBe('reference');
      expect(problem({ reference: '   ' })).toBe('reference');
    });

    it('is not so short it could be anything', () => {
      expect(problem({ reference: 'ab' })).toBe('reference');
      expect(problem({ reference: 'abc' })).toBeNull();
    });

    it('is not an essay', () => {
      expect(problem({ reference: 'x'.repeat(101) })).toBe('reference');
      expect(problem({ reference: 'x'.repeat(100) })).toBeNull();
    });
  });

  describe('who paid', () => {
    it('is required, as the bank statement names them', () => {
      expect(problem({ payerName: '' })).toBe('payer');
      expect(problem({ payerName: ' ' })).toBe('payer');
      expect(problem({ payerName: 'x'.repeat(121) })).toBe('payer');
    });
  });

  describe('the amount', () => {
    it('must be what the invoice comes to: part payments are not supported', () => {
      expect(problem({ amountKobo: GROSS - 1 })).toBe('amount');
      expect(problem({ amountKobo: 1_000_000 })).toBe('amount');
    });

    it('must not be more, either: an over-payment is a conversation, not a paid invoice', () => {
      expect(problem({ amountKobo: GROSS + 1 })).toBe('amount');
    });

    it('must be a whole number of kobo', () => {
      expect(problem({ amountKobo: GROSS + 0.5 })).toBe('amount');
      expect(problem({ amountKobo: Number.NaN })).toBe('amount');
    });
  });

  describe('the date the money arrived', () => {
    it('is a real date written year-month-day', () => {
      expect(problem({ paidOn: '13/10/2026' })).toBe('date');
      expect(problem({ paidOn: '2026-02-30' })).toBe('date');
      expect(problem({ paidOn: '' })).toBe('date');
    });

    it('can be today in Lagos, but not tomorrow', () => {
      expect(problem({ paidOn: '2026-10-14' })).toBeNull();
      expect(problem({ paidOn: '2026-10-15' })).toBe('future');
    });

    it('counts today by Lagos, not UTC, either side of midnight', () => {
      // 00:30 in Lagos on the 15th is 23:30 UTC on the 14th.
      const justAfterMidnight = new Date('2026-10-14T23:30:00.000Z');

      expect(
        paymentProblem({ ...good, paidOn: '2026-10-15' }, { grossKobo: GROSS, issuedOn: '2026-10-01' }, justAfterMidnight),
      ).toBeNull();
      expect(
        paymentProblem({ ...good, paidOn: '2026-10-16' }, { grossKobo: GROSS, issuedOn: '2026-10-01' }, justAfterMidnight),
      ).toBe('future');
    });

    it('cannot be before the invoice was issued: money cannot arrive for a bill that did not exist', () => {
      expect(problem({ paidOn: '2026-09-30' }, '2026-10-01')).toBe('before_issue');
      expect(problem({ paidOn: '2026-10-01' }, '2026-10-01')).toBeNull();
    });

    it('is not held to the issue date when there is none to compare with', () => {
      expect(problem({ paidOn: '2026-01-01' }, null)).toBeNull();
    });
  });
});
