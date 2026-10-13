import { describe, expect, it } from 'vitest';
import { heldForDisputes, netOfLine } from './holds';

/** What the practitioner was credited for each shift, oldest first. */
const lines = [
  { assignmentId: 'a', netKobo: 4_000_000 },
  { assignmentId: 'b', netKobo: 2_000_000 },
  { assignmentId: 'c', netKobo: 1_000_000 },
];

describe('what a dispute holds', () => {
  it('holds nothing when nothing is disputed', () => {
    expect(heldForDisputes(lines, new Set(), 7_000_000)).toBe(0);
  });

  it('holds the disputed shift and no other', () => {
    expect(heldForDisputes(lines, new Set(['b']), 7_000_000)).toBe(2_000_000);
  });

  it('holds each of several disputed shifts', () => {
    expect(heldForDisputes(lines, new Set(['a', 'c']), 7_000_000)).toBe(5_000_000);
  });

  it('ignores a dispute over a shift that has no credit', () => {
    // Disputed before it was invoiced: nothing was credited, so nothing is held.
    expect(heldForDisputes(lines, new Set(['not-billed']), 7_000_000)).toBe(0);
  });

  describe('when part of what was credited has already been paid', () => {
    // Payouts clear the oldest credit first, so with 3,000,000 still unpaid the
    // unpaid slice is the last 3,000,000 of 7,000,000: all of c and 2,000,000 of b.
    it('does not hold money that has already gone', () => {
      expect(heldForDisputes(lines, new Set(['a']), 3_000_000)).toBe(0);
    });

    it('holds only the unpaid part of a shift that is partly paid', () => {
      expect(heldForDisputes(lines, new Set(['b']), 3_000_000)).toBe(2_000_000);
      // a is [0, 4M), b [4M, 6M), c [6M, 7M). With 5,000,000 unpaid the slice is
      // [2M, 7M), which takes the last 2,000,000 of a.
      expect(heldForDisputes(lines, new Set(['a']), 5_000_000)).toBe(2_000_000);
    });
  });

  it('never holds more than is unpaid', () => {
    expect(heldForDisputes(lines, new Set(['a', 'b', 'c']), 1_000_000)).toBe(1_000_000);
    expect(heldForDisputes(lines, new Set(['a', 'b', 'c']), 0)).toBe(0);
  });

  it('copes with more unpaid than was ever credited', () => {
    // Possible if the ledger holds an adjustment the lines do not: hold what was disputed.
    expect(heldForDisputes(lines, new Set(['a']), 9_000_000)).toBe(4_000_000);
  });

  it('holds nothing for a negative unpaid figure', () => {
    expect(heldForDisputes(lines, new Set(['a']), -5)).toBe(0);
  });
});

describe('what a practitioner was credited for a line', () => {
  it('is the line less its share of the platform fee', () => {
    // 10% fee on a 10,000,000 invoice; a 4,000,000 line carries 400,000 of it.
    expect(netOfLine({ amountKobo: 4_000_000 }, { grossKobo: 10_000_000, platformFeeKobo: 1_000_000 })).toBe(
      3_600_000,
    );
  });

  it('is the whole line when there is no fee', () => {
    expect(netOfLine({ amountKobo: 4_000_000 }, { grossKobo: 10_000_000, platformFeeKobo: 0 })).toBe(
      4_000_000,
    );
  });

  it('rounds the fee down, as the ledger does, so the sum of lines matches the ledger', () => {
    // 333 * 1 / 1000 = 0.333, taken as 0: the practitioner keeps the remainder.
    expect(netOfLine({ amountKobo: 1 }, { grossKobo: 1000, platformFeeKobo: 333 })).toBe(1);
  });

  it('is zero for an empty invoice rather than dividing by zero', () => {
    expect(netOfLine({ amountKobo: 0 }, { grossKobo: 0, platformFeeKobo: 0 })).toBe(0);
  });
});
