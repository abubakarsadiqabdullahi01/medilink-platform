import { describe, expect, it } from 'vitest';
import {
  FUTURE_TOLERANCE_MINUTES,
  MAX_SHIFT_MINUTES,
  isInFuture,
  isLongerThanAShift,
} from './recorded-times';

/**
 * ATT-04: a shift cannot have been worked at a time that has not come yet.
 *
 * What a person types into a hand-recording or a correction is a time they are reading off a
 * paper log or remembering. A little ahead of the server's clock is somebody's watch running
 * fast; a day ahead is a wrong date, and it would price a shift that has not been worked.
 */
describe('a time that has not come yet', () => {
  const now = new Date('2026-10-15T12:00:00.000Z');
  const minutesFromNow = (minutes: number) => new Date(now.getTime() + minutes * 60_000);

  it('is not one that has already happened', () => {
    expect(isInFuture(minutesFromNow(-1), now)).toBe(false);
    expect(isInFuture(minutesFromNow(-60 * 24 * 365), now)).toBe(false);
    expect(isInFuture(now, now)).toBe(false);
  });

  it('allows a few minutes of a clock running ahead, and not a minute more', () => {
    expect(isInFuture(minutesFromNow(FUTURE_TOLERANCE_MINUTES), now)).toBe(false);
    expect(isInFuture(minutesFromNow(FUTURE_TOLERANCE_MINUTES + 1), now)).toBe(true);
  });

  it('is one an hour, a day or a year ahead', () => {
    expect(isInFuture(minutesFromNow(60), now)).toBe(true);
    expect(isInFuture(minutesFromNow(24 * 60), now)).toBe(true);
    expect(isInFuture(minutesFromNow(365 * 24 * 60), now)).toBe(true);
  });

  it('is five minutes, so a supervisor who types the minute they are in is not refused', () => {
    expect(FUTURE_TOLERANCE_MINUTES).toBe(5);
  });
});

/**
 * TIM-08: a recorded shift is at most a day.
 *
 * The timesheet refuses one longer, and it used to say so only after the record existed: the
 * `shift.completed` handler threw, retried and dead-lettered, and the practitioner never got a
 * sheet. The rule is the same number the timesheet uses, asked where the times are written.
 */
describe('a shift longer than a day', () => {
  const start = new Date('2026-10-15T08:00:00.000Z');
  const after = (minutes: number, seconds = 0) => new Date(start.getTime() + minutes * 60_000 + seconds * 1000);

  it('is a day, to the minute the timesheet rounds to', () => {
    expect(MAX_SHIFT_MINUTES).toBe(24 * 60);
    expect(isLongerThanAShift(start, after(24 * 60))).toBe(false);
    // 24h 0m 29s rounds down to a day, as the timesheet rounds it; 30s rounds up to a minute over.
    expect(isLongerThanAShift(start, after(24 * 60, 29))).toBe(false);
    expect(isLongerThanAShift(start, after(24 * 60, 30))).toBe(true);
    expect(isLongerThanAShift(start, after(24 * 60 + 1))).toBe(true);
  });

  it('is not a short one, or one that has not started', () => {
    expect(isLongerThanAShift(start, after(8 * 60))).toBe(false);
    expect(isLongerThanAShift(start, after(1))).toBe(false);
    expect(isLongerThanAShift(after(60), start)).toBe(false);
  });
});
