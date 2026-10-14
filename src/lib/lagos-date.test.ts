import { describe, expect, it } from 'vitest';
import {
  endOfLagosDay,
  instantToLagosLocal,
  isDateOnly,
  lagosDate,
  lagosLocalToInstant,
  startOfLagosDay,
} from './lagos-date';

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

describe('a typed date and time', () => {
  it('is Lagos time, whatever zone the device is set to', () => {
    // 20:00 in Lagos is 19:00 UTC.
    expect(lagosLocalToInstant('2026-10-20T20:00').toISOString()).toBe('2026-10-20T19:00:00.000Z');
    expect(lagosLocalToInstant('2026-10-20T00:30').toISOString()).toBe('2026-10-19T23:30:00.000Z');
  });

  it('accepts seconds as well', () => {
    expect(lagosLocalToInstant('2026-10-20T20:00:30').toISOString()).toBe('2026-10-20T19:00:30.000Z');
  });

  it('refuses what is not a date and time, or not a real one', () => {
    for (const bad of ['', '2026-10-20', '20:00', '2026-10-20 20:00', '2026-10-32T20:00', '2026-10-20T25:00', '2026-10-20T20:61']) {
      expect(() => lagosLocalToInstant(bad), bad).toThrow();
    }
  });

  it('turns an instant back into the value an input wants, in Lagos', () => {
    expect(instantToLagosLocal(new Date('2026-10-20T19:00:00.000Z'))).toBe('2026-10-20T20:00');
    expect(instantToLagosLocal(new Date('2026-10-19T23:30:00.000Z'))).toBe('2026-10-20T00:30');
  });

  it('round-trips, at every hour of a day', () => {
    for (let hour = 0; hour < 24; hour += 1) {
      const value = `2026-12-31T${String(hour).padStart(2, '0')}:15`;
      expect(instantToLagosLocal(lagosLocalToInstant(value))).toBe(value);
    }
  });
});
