import { describe, expect, it } from 'vitest';
import { collectionRequired, payableKobo } from './payable';

/**
 * BIL-03 and the money half of BIL-02. A practitioner is credited when work is
 * approved, which is when a facility has been billed and not when it has paid, so
 * "owed" is a promise and not cash. A payout used to be sized from "owed" alone: the
 * platform could pay before it was paid, and the cash account could go negative.
 * What can be paid is what has been collected.
 */

describe('what can be paid out', () => {
  it('is what was collected from facilities and not yet paid on, when collection is required', () => {
    expect(payableKobo({ owedKobo: 10_000, collectedKobo: 6_000, paidOutKobo: 0, required: true })).toBe(6_000);
  });

  it('is nothing when nothing has been collected, however much is owed', () => {
    expect(payableKobo({ owedKobo: 10_000, collectedKobo: 0, paidOutKobo: 0, required: true })).toBe(0);
  });

  it('takes off what has already been paid, so the same money is not paid twice', () => {
    expect(payableKobo({ owedKobo: 10_000, collectedKobo: 6_000, paidOutKobo: 4_000, required: true })).toBe(2_000);
  });

  it('is never more than is owed, even if more was collected than is owed', () => {
    // A credit reversed or a payout made against a later shift can leave collected above owed.
    expect(payableKobo({ owedKobo: 3_000, collectedKobo: 9_000, paidOutKobo: 0, required: true })).toBe(3_000);
  });

  it('is never negative', () => {
    expect(payableKobo({ owedKobo: 5_000, collectedKobo: 1_000, paidOutKobo: 4_000, required: true })).toBe(0);
    expect(payableKobo({ owedKobo: 0, collectedKobo: 0, paidOutKobo: 0, required: true })).toBe(0);
  });

  it('is simply what is owed when collection is not required', () => {
    expect(payableKobo({ owedKobo: 10_000, collectedKobo: 0, paidOutKobo: 0, required: false })).toBe(10_000);
  });
});

describe('whether collection is required', () => {
  it('is on unless the setting says exactly off, so a typo does not remove the control', () => {
    expect(collectionRequired(undefined)).toBe(true);
    expect(collectionRequired('')).toBe(true);
    expect(collectionRequired('false')).toBe(true);
    expect(collectionRequired('0')).toBe(true);
    expect(collectionRequired('off')).toBe(false);
  });
});
