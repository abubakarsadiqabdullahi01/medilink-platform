import { describe, expect, it } from 'vitest';
import {
  availabilityFor,
  coversWindow,
  mergeWindows,
  overlaps,
  slotWindows,
  WAT_OFFSET_MINUTES,
  type SlotLike,
} from './availability';

/**
 * 2026-09-14 is a Monday. Every instant below is written in UTC, and WAT is
 * one hour ahead — so 07:00Z is 08:00 local, which is where the off-by-one
 * hour would show up if the offset were dropped.
 */
const MONDAY_07Z = new Date('2026-09-14T07:00:00.000Z');
const MONDAY_17Z = new Date('2026-09-14T17:00:00.000Z');

function recurring(overrides: Partial<SlotLike> = {}): SlotLike {
  return {
    kind: 'RECURRING_WEEKLY',
    dayOfWeek: 1, // Monday
    startMinute: 8 * 60, // 08:00 WAT = 07:00Z
    endMinute: 18 * 60, // 18:00 WAT = 17:00Z
    effectiveFrom: null,
    effectiveUntil: null,
    startsAt: null,
    endsAt: null,
    ...overrides,
  };
}

function oneOff(startsAt: string, endsAt: string): SlotLike {
  return {
    kind: 'ONE_OFF',
    dayOfWeek: null,
    startMinute: null,
    endMinute: null,
    effectiveFrom: null,
    effectiveUntil: null,
    startsAt: new Date(startsAt),
    endsAt: new Date(endsAt),
  };
}

describe('overlaps', () => {
  it('is false for windows that merely touch', () => {
    // A shift ending at 14:00 does not overlap one starting at 14:00.
    expect(
      overlaps(
        { startsAt: new Date('2026-09-14T08:00:00Z'), endsAt: new Date('2026-09-14T14:00:00Z') },
        { startsAt: new Date('2026-09-14T14:00:00Z'), endsAt: new Date('2026-09-14T20:00:00Z') },
      ),
    ).toBe(false);
  });

  it('is true for any real intersection', () => {
    expect(
      overlaps(
        { startsAt: new Date('2026-09-14T08:00:00Z'), endsAt: new Date('2026-09-14T15:00:00Z') },
        { startsAt: new Date('2026-09-14T14:00:00Z'), endsAt: new Date('2026-09-14T20:00:00Z') },
      ),
    ).toBe(true);
  });
});

describe('recurring slots and the WAT offset', () => {
  it('places a Monday 08:00-18:00 WAT slot at 07:00-17:00 UTC', () => {
    const windows = slotWindows(recurring(), { startsAt: MONDAY_07Z, endsAt: MONDAY_17Z });

    expect(windows).toHaveLength(1);
    expect(windows[0]?.startsAt.toISOString()).toBe('2026-09-14T07:00:00.000Z');
    expect(windows[0]?.endsAt.toISOString()).toBe('2026-09-14T17:00:00.000Z');
    expect(WAT_OFFSET_MINUTES).toBe(60);
  });

  it('produces nothing on a different weekday', () => {
    const tuesdaySlot = recurring({ dayOfWeek: 2 });
    expect(slotWindows(tuesdaySlot, { startsAt: MONDAY_07Z, endsAt: MONDAY_17Z })).toEqual([]);
  });

  it('runs a night slot past midnight into the next day', () => {
    // 20:00 to 06:00 WAT: the end is before the start, which means it wraps.
    const night = recurring({ dayOfWeek: 1, startMinute: 20 * 60, endMinute: 6 * 60 });
    const windows = slotWindows(night, {
      startsAt: new Date('2026-09-14T20:00:00Z'),
      endsAt: new Date('2026-09-15T04:00:00Z'),
    });

    expect(windows).toHaveLength(1);
    expect(windows[0]?.startsAt.toISOString()).toBe('2026-09-14T19:00:00.000Z');
    expect(windows[0]?.endsAt.toISOString()).toBe('2026-09-15T05:00:00.000Z');
  });

  it('respects the effective window', () => {
    const notYet = recurring({ effectiveFrom: new Date('2026-10-01T00:00:00Z') });
    expect(slotWindows(notYet, { startsAt: MONDAY_07Z, endsAt: MONDAY_17Z })).toEqual([]);

    const finished = recurring({ effectiveUntil: new Date('2026-09-01T00:00:00Z') });
    expect(slotWindows(finished, { startsAt: MONDAY_07Z, endsAt: MONDAY_17Z })).toEqual([]);
  });
});

describe('mergeWindows', () => {
  it('joins windows that only touch', () => {
    // Two adjacent slots cover a shift spanning both; a merge that joined
    // only overlapping windows would say they do not.
    const merged = mergeWindows([
      { startsAt: new Date('2026-09-14T08:00:00Z'), endsAt: new Date('2026-09-14T14:00:00Z') },
      { startsAt: new Date('2026-09-14T14:00:00Z'), endsAt: new Date('2026-09-14T20:00:00Z') },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.endsAt.toISOString()).toBe('2026-09-14T20:00:00.000Z');
  });

  it('leaves a real gap alone', () => {
    const merged = mergeWindows([
      { startsAt: new Date('2026-09-14T08:00:00Z'), endsAt: new Date('2026-09-14T12:00:00Z') },
      { startsAt: new Date('2026-09-14T14:00:00Z'), endsAt: new Date('2026-09-14T20:00:00Z') },
    ]);
    expect(merged).toHaveLength(2);
  });

  it('sorts before merging, so input order does not matter', () => {
    const merged = mergeWindows([
      { startsAt: new Date('2026-09-14T14:00:00Z'), endsAt: new Date('2026-09-14T20:00:00Z') },
      { startsAt: new Date('2026-09-14T08:00:00Z'), endsAt: new Date('2026-09-14T14:00:00Z') },
    ]);
    expect(merged).toHaveLength(1);
  });
});

describe('availabilityFor', () => {
  const shift = { startsAt: new Date('2026-09-14T09:00:00Z'), endsAt: new Date('2026-09-14T15:00:00Z') };

  it('accepts a shift wholly inside an offered slot', () => {
    expect(availabilityFor([recurring()], [], shift)).toEqual({
      available: true,
      reason: 'available',
    });
  });

  it('refuses a shift only partly covered', () => {
    // Half a night shift is not a night shift.
    const morningOnly = recurring({ endMinute: 12 * 60 });
    expect(availabilityFor([morningOnly], [], shift).reason).toBe('not_offered');
  });

  it('accepts a shift covered by two adjoining slots', () => {
    const morning = recurring({ startMinute: 8 * 60, endMinute: 13 * 60 });
    const afternoon = recurring({ startMinute: 13 * 60, endMinute: 18 * 60 });
    expect(coversWindow([morning, afternoon], [], shift)).toBe(true);
  });

  it('refuses when the two slots leave a gap inside the shift', () => {
    const morning = recurring({ startMinute: 8 * 60, endMinute: 11 * 60 });
    const afternoon = recurring({ startMinute: 13 * 60, endMinute: 18 * 60 });
    expect(coversWindow([morning, afternoon], [], shift)).toBe(false);
  });

  it('lets a block beat an offered slot, and says so', () => {
    const block = {
      startsAt: new Date('2026-09-14T10:00:00Z'),
      endsAt: new Date('2026-09-14T11:00:00Z'),
    };

    // "I am free on Mondays" and "I am away this Monday" is not a
    // contradiction — the second is the more specific statement.
    expect(availabilityFor([recurring()], [block], shift)).toEqual({
      available: false,
      reason: 'blocked',
    });
  });

  it('ignores a block that does not touch the shift', () => {
    const block = {
      startsAt: new Date('2026-09-20T00:00:00Z'),
      endsAt: new Date('2026-09-21T00:00:00Z'),
    };
    expect(coversWindow([recurring()], [block], shift)).toBe(true);
  });

  it('accepts a one-off slot', () => {
    const slot = oneOff('2026-09-14T08:00:00Z', '2026-09-14T20:00:00Z');
    expect(coversWindow([slot], [], shift)).toBe(true);
  });

  it('covers an overnight shift from a wrapping recurring slot', () => {
    const night = recurring({ dayOfWeek: 1, startMinute: 19 * 60, endMinute: 7 * 60 });
    const overnight = {
      startsAt: new Date('2026-09-14T20:00:00Z'),
      endsAt: new Date('2026-09-15T05:00:00Z'),
    };
    expect(coversWindow([night], [], overnight)).toBe(true);
  });

  it('offers nothing when there are no slots at all', () => {
    expect(availabilityFor([], [], shift).reason).toBe('not_offered');
  });

  it('refuses a window that ends before it starts', () => {
    const backwards = { startsAt: shift.endsAt, endsAt: shift.startsAt };
    expect(coversWindow([recurring()], [], backwards)).toBe(false);
  });
});

describe('a full day, and the night shift that crosses it', () => {
  /**
   * The case a whole product turns on: somebody available every day, and a
   * shift that starts one evening and ends the next morning.
   *
   * With an end of 1439 the two days never join — a one-minute hole at
   * midnight — and the practitioner is reported unavailable for every
   * overnight shift. 1440 means midnight at the close of the day, so Monday
   * ends exactly where Tuesday begins and `mergeWindows` joins them.
   */
  const everyDay = (endMinute: number) =>
    [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
      kind: 'RECURRING_WEEKLY' as const,
      dayOfWeek,
      startMinute: 0,
      endMinute,
      effectiveFrom: null,
      effectiveUntil: null,
      startsAt: null,
      endsAt: null,
    }));

  // 19:00 to 03:00 WAT, which is 18:00 to 02:00 UTC.
  const overnight = {
    startsAt: new Date('2026-09-14T18:00:00.000Z'),
    endsAt: new Date('2026-09-15T02:00:00.000Z'),
  };

  it('leaves a hole at midnight when the day ends at 23:59', () => {
    const verdict = availabilityFor(everyDay(1439), [], overnight);
    expect(verdict.reason).not.toBe('available');
  });

  it('covers the shift when the day ends at midnight', () => {
    const verdict = availabilityFor(everyDay(1440), [], overnight);
    expect(verdict.reason).toBe('available');
  });

  it('still covers an ordinary daytime shift', () => {
    const verdict = availabilityFor(everyDay(1440), [], {
      startsAt: new Date('2026-09-14T07:00:00.000Z'),
      endsAt: new Date('2026-09-14T15:00:00.000Z'),
    });
    expect(verdict.reason).toBe('available');
  });
});
