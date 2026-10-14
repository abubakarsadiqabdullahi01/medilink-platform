import { describe, expect, it } from 'vitest';
import { deriveShiftType } from './shift-type';

/** A time in WAT (UTC+1) on a fixed date, so the tests do not depend on when they run. */
const wat = (hour: number, minute = 0, day = 14) => new Date(Date.UTC(2026, 9, day, hour - 1, minute));

describe('deriveShiftType', () => {
  it('calls a shift worked in daylight a day shift', () => {
    expect(deriveShiftType(wat(8), wat(16))).toBe('DAY');
    expect(deriveShiftType(wat(7), wat(19))).toBe('DAY');
  });

  it('calls a shift worked through the night a night shift, across midnight', () => {
    expect(deriveShiftType(wat(20), wat(8, 0, 15))).toBe('NIGHT');
    expect(deriveShiftType(wat(19), wat(7, 0, 15))).toBe('NIGHT');
    expect(deriveShiftType(wat(22), wat(6, 0, 15))).toBe('NIGHT');
  });

  it('judges by where most of the hours fall, not by when it starts', () => {
    // Starts in the evening but is mostly the small hours.
    expect(deriveShiftType(wat(18), wat(2, 0, 15))).toBe('NIGHT');
    // Starts at night and is mostly morning.
    expect(deriveShiftType(wat(5), wat(17))).toBe('DAY');
  });

  it('counts half or more at night as a night shift, because the higher floor is the safer side to err on', () => {
    // 16:00 to 00:00: four of eight hours fall after 20:00.
    expect(deriveShiftType(wat(16), wat(0, 0, 15))).toBe('NIGHT');
    // 14:00 to 22:00: only two of eight.
    expect(deriveShiftType(wat(14), wat(22))).toBe('DAY');
  });

  it('does not walk an absurd range minute by minute', () => {
    const started = Date.now();

    deriveShiftType(new Date('2026-10-14T08:00:00Z'), new Date('2126-10-14T08:00:00Z'));

    expect(Date.now() - started).toBeLessThan(200);
  });

  it('is the same whatever the zone the instants were written in', () => {
    expect(deriveShiftType(new Date('2026-10-14T19:00:00Z'), new Date('2026-10-15T07:00:00Z'))).toBe('NIGHT');
    expect(deriveShiftType(new Date('2026-10-14T07:00:00Z'), new Date('2026-10-14T15:00:00Z'))).toBe('DAY');
  });
});
