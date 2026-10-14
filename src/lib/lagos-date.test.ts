import { describe, expect, it } from 'vitest';
import { endOfLagosDay, isDateOnly, lagosDate, startOfLagosDay } from './lagos-date';

describe('Lagos dates', () => {
  it('names the day by Lagos, not UTC', () => {
    expect(lagosDate(new Date('2026-10-13T23:30:00Z'))).toBe('2026-10-14');
    expect(lagosDate(new Date('2026-10-14T22:59:00Z'))).toBe('2026-10-14');
    expect(lagosDate(new Date('2026-10-14T23:00:00Z'))).toBe('2026-10-15');
  });

  it('starts a day at 23:00 UTC the evening before, and ends it 24 hours later', () => {
    expect(startOfLagosDay('2026-10-14').toISOString()).toBe('2026-10-13T23:00:00.000Z');
    expect(endOfLagosDay('2026-10-14').toISOString()).toBe('2026-10-14T23:00:00.000Z');
  });

  it('ends the last day of a month at the start of the next', () => {
    expect(endOfLagosDay('2027-03-31').toISOString()).toBe('2027-03-31T23:00:00.000Z');
    expect(endOfLagosDay('2026-12-31').toISOString()).toBe('2026-12-31T23:00:00.000Z');
  });

  it('knows a real date from one that only rolls over', () => {
    expect(isDateOnly('2028-02-29')).toBe(true);
    expect(isDateOnly('2027-02-29')).toBe(false);
    expect(isDateOnly('2027-13-01')).toBe(false);
    expect(isDateOnly('31/03/2027')).toBe(false);
    expect(isDateOnly('')).toBe(false);
  });

  it('refuses to turn a bad date into an instant', () => {
    expect(() => startOfLagosDay('2027-02-30')).toThrow(/real date/);
  });
});
