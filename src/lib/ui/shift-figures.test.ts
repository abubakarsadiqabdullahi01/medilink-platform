import { describe, expect, it } from 'vitest';
import { answerBy, closesIn, estimateKobo, shiftMinutes } from './shift-figures';

describe('shift sums', () => {
  it('counts whole minutes and never goes negative', () => {
    expect(shiftMinutes('2026-10-21T07:00:00Z', '2026-10-21T19:00:00Z')).toBe(720);
    expect(shiftMinutes('2026-10-21T19:00:00Z', '2026-10-21T07:00:00Z')).toBe(0);
  });

  it('prices at the hourly rate in integer kobo, rounding once', () => {
    expect(estimateKobo(500_000, 480)).toBe(4_000_000);
    // ₦3,600.00 an hour for 7h 50m = ₦28,200.00 exactly; ₦8,333.33 an hour for 1h 1m rounds once.
    expect(estimateKobo(360_000, 470)).toBe(2_820_000);
    expect(estimateKobo(833_333, 61)).toBe(Math.round((833_333 * 61) / 60));
    expect(Number.isInteger(estimateKobo(833_333, 61))).toBe(true);
  });
});

describe('answer by', () => {
  // 12:00 on Sun 18 Oct 2026 in Lagos is 11:00 UTC.
  const now = new Date('2026-10-18T11:00:00Z');

  it('says today, tomorrow or the date, in Lagos time', () => {
    expect(answerBy('2026-10-18T20:13:00Z', now)).toBe('Answer by 21:13 today');
    expect(answerBy('2026-10-19T07:30:00Z', now)).toBe('Answer by 08:30 tomorrow');
    expect(answerBy('2026-10-21T12:00:00Z', now)).toMatch(/^Answer by 13:00 on 21 Oct$/);
  });

  it('puts a late-evening UTC time on the right Lagos day', () => {
    // 23:30 UTC is 00:30 the next day in Lagos.
    expect(answerBy('2026-10-18T23:30:00Z', now)).toBe('Answer by 00:30 tomorrow');
  });
});

describe('closes in', () => {
  const now = new Date('2026-10-18T11:00:00Z');
  const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000).toISOString();

  it('is null once the time has passed', () => {
    expect(closesIn(at(0), now)).toBeNull();
    expect(closesIn(at(-5), now)).toBeNull();
  });

  it('uses the largest whole unit and flags a short fuse', () => {
    expect(closesIn(at(1), now)).toEqual({ text: 'closes in 1 minute', soon: true });
    expect(closesIn(at(45), now)).toEqual({ text: 'closes in 45 minutes', soon: true });
    expect(closesIn(at(180), now)).toEqual({ text: 'closes in 3 hours', soon: true });
    expect(closesIn(at(181), now)).toEqual({ text: 'closes in 3 hours', soon: false });
    expect(closesIn(at(60 * 30), now)).toEqual({ text: 'closes in 30 hours', soon: false });
    expect(closesIn(at(60 * 24 * 4), now)).toEqual({ text: 'closes in 4 days', soon: false });
  });
});
