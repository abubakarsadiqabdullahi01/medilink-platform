import { describe, expect, it } from 'vitest';
import { watClock, watDay, watMoment, watWindow } from './wat';

describe('West Africa Time', () => {
  it('is an hour ahead of UTC', () => {
    expect(watClock(new Date('2026-10-15T08:00:00Z'))).toBe('09:00');
    expect(watMoment(new Date('2026-10-15T08:00:00Z'))).toBe('Thu 15 Oct, 09:00 WAT');
  });

  it('puts a late-evening UTC time on the next Lagos day', () => {
    expect(watDay(new Date('2026-10-15T23:30:00Z'))).toBe('Fri 16 Oct');
    expect(watClock(new Date('2026-10-15T23:30:00Z'))).toBe('00:30');
  });

  it('names a same-day window once', () => {
    expect(watWindow(new Date('2026-10-15T08:00:00Z'), new Date('2026-10-15T16:00:00Z'))).toBe(
      'Thu 15 Oct, 09:00 to 17:00 WAT',
    );
  });

  it('names both days when a shift runs through the night', () => {
    expect(watWindow(new Date('2026-10-15T19:00:00Z'), new Date('2026-10-16T07:00:00Z'))).toBe(
      'Thu 15 Oct, 20:00 to Fri 16 Oct, 08:00 WAT',
    );
  });

  it('does not move with the season of the year', () => {
    expect(watClock(new Date('2026-01-15T08:00:00Z'))).toBe('09:00');
    expect(watClock(new Date('2026-07-15T08:00:00Z'))).toBe('09:00');
  });
});
