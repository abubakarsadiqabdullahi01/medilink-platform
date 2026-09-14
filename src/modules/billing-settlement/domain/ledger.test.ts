import { describe, expect, it } from 'vitest';
import {
  ACCOUNTS,
  LedgerError,
  assertBalanced,
  balanceOf,
  entriesForApprovedWork,
  entriesForPayment,
  entriesForPayout,
  platformFeeKobo,
  type LedgerEntry,
} from './ledger';

const FACILITY = 'facility-1';
const PRACTITIONER = 'practitioner-1';

describe('the balance invariant', () => {
  it('accepts a transaction that sums to zero', () => {
    expect(() =>
      assertBalanced([
        { account: 'CASH', amountKobo: 100, subjectId: null, memo: 'in' },
        { account: 'FACILITY_PAYABLE', amountKobo: -100, subjectId: FACILITY, memo: 'out' },
      ]),
    ).not.toThrow();
  });

  it('refuses one that does not', () => {
    expect(() =>
      assertBalanced([
        { account: 'CASH', amountKobo: 100, subjectId: null, memo: 'in' },
        { account: 'FACILITY_PAYABLE', amountKobo: -99, subjectId: FACILITY, memo: 'out' },
      ]),
    ).toThrow(LedgerError);
  });

  it('refuses fractional kobo', () => {
    // A ledger that rounds loses money, and the record does not say where.
    expect(() =>
      assertBalanced([
        { account: 'CASH', amountKobo: 0.5, subjectId: null, memo: 'in' },
        { account: 'CASH', amountKobo: -0.5, subjectId: null, memo: 'out' },
      ]),
    ).toThrow(/whole kobo/);
  });

  it('refuses an empty transaction', () => {
    expect(() => assertBalanced([])).toThrow(LedgerError);
  });
});

describe('approved work', () => {
  it('bills the facility and credits the practitioner', () => {
    const entries = entriesForApprovedWork({
      facilityId: FACILITY,
      practitionerId: PRACTITIONER,
      grossKobo: 4_000_000,
      platformFeeKobo: 0,
    });

    expect(balanceOf(entries, 'FACILITY_PAYABLE')).toBe(4_000_000);
    expect(balanceOf(entries, 'PRACTITIONER_EARNINGS')).toBe(-4_000_000);
    expect(() => assertBalanced(entries)).not.toThrow();
  });

  it('writes no platform line at all while the fee is zero', () => {
    // Not a zero row: a ledger full of them is one nobody can scan, and until
    // step 3.1 every single one would be zero.
    const entries = entriesForApprovedWork({
      facilityId: FACILITY,
      practitionerId: PRACTITIONER,
      grossKobo: 4_000_000,
      platformFeeKobo: 0,
    });
    expect(entries.some((entry) => entry.account === 'PLATFORM_REVENUE')).toBe(false);
  });

  it('balances once a fee is set', () => {
    const entries = entriesForApprovedWork({
      facilityId: FACILITY,
      practitionerId: PRACTITIONER,
      grossKobo: 4_000_000,
      platformFeeKobo: 400_000,
    });

    expect(balanceOf(entries, 'FACILITY_PAYABLE')).toBe(4_000_000);
    expect(balanceOf(entries, 'PRACTITIONER_EARNINGS')).toBe(-3_600_000);
    expect(balanceOf(entries, 'PLATFORM_REVENUE')).toBe(-400_000);
    expect(() => assertBalanced(entries)).not.toThrow();
  });

  it('refuses a fee larger than the work', () => {
    expect(() =>
      entriesForApprovedWork({
        facilityId: FACILITY,
        practitionerId: PRACTITIONER,
        grossKobo: 1_000,
        platformFeeKobo: 2_000,
      }),
    ).toThrow(/more than the work is worth/);
  });

  it('refuses a negative fee', () => {
    expect(() =>
      entriesForApprovedWork({
        facilityId: FACILITY,
        practitionerId: PRACTITIONER,
        grossKobo: 1_000,
        platformFeeKobo: -1,
      }),
    ).toThrow(/cannot be negative/);
  });
});

describe('the whole cycle', () => {
  it('leaves every account at zero once everybody has been paid', () => {
    // Work approved, facility pays, practitioner paid. Nothing should be
    // left anywhere — which is the strongest statement the ledger can make.
    const entries: LedgerEntry[] = [
      ...entriesForApprovedWork({
        facilityId: FACILITY,
        practitionerId: PRACTITIONER,
        grossKobo: 4_000_000,
        platformFeeKobo: 0,
      }),
      ...entriesForPayment({ facilityId: FACILITY, amountKobo: 4_000_000 }),
      ...entriesForPayout({ practitionerId: PRACTITIONER, amountKobo: 4_000_000 }),
    ];

    for (const account of ACCOUNTS) {
      expect(balanceOf(entries, account), account).toBe(0);
    }
    expect(entries.reduce((sum, entry) => sum + entry.amountKobo, 0)).toBe(0);
  });

  it('leaves the platform holding its fee and nothing else out of place', () => {
    const entries: LedgerEntry[] = [
      ...entriesForApprovedWork({
        facilityId: FACILITY,
        practitionerId: PRACTITIONER,
        grossKobo: 4_000_000,
        platformFeeKobo: 400_000,
      }),
      ...entriesForPayment({ facilityId: FACILITY, amountKobo: 4_000_000 }),
      ...entriesForPayout({ practitionerId: PRACTITIONER, amountKobo: 3_600_000 }),
    ];

    expect(balanceOf(entries, 'FACILITY_PAYABLE')).toBe(0);
    expect(balanceOf(entries, 'PRACTITIONER_EARNINGS')).toBe(0);
    expect(balanceOf(entries, 'PLATFORM_REVENUE')).toBe(-400_000);
    // The fee is the cash still in hand, which is what it should be.
    expect(balanceOf(entries, 'CASH')).toBe(400_000);
  });
});

describe('the platform fee', () => {
  it('is zero while step 3.1 is unsettled', () => {
    expect(platformFeeKobo(4_000_000, 0)).toBe(0);
  });

  it('never takes a rounding error from the practitioner', () => {
    // Rounded down, so the fraction of a kobo stays on their side.
    expect(platformFeeKobo(999, 1_000)).toBe(99);
    expect(platformFeeKobo(1, 5_000)).toBe(0);
  });

  it('is whole kobo at every rate', () => {
    for (let bp = 0; bp <= 3_000; bp += 137) {
      for (const gross of [1, 999, 4_000_000, 123_457]) {
        expect(Number.isInteger(platformFeeKobo(gross, bp))).toBe(true);
      }
    }
  });
});
