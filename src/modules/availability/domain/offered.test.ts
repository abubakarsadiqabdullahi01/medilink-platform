import { describe, expect, it } from 'vitest';
import { availabilityFor, type SlotLike, type TimeWindow } from './availability';
import {
  LOOKAHEAD_DAYS,
  nextOffered,
  offeredWindows,
  slotStanding,
  subtractWindows,
} from './offered';

/**
 * M05-02: one precedence model for what a practitioner offers.
 *
 *   offered  =  (weekly patterns in force  ∪  dated free windows)  −  time away
 *
 * Away is the most specific thing somebody can say and it always wins: a shift that touches it is
 * never offered, however much else they have said. Everything that reads availability (the
 * matcher's verdict, what the practitioner is told, whether they will be offered anything at all)
 * is answered from this one reading.
 *
 * The central test holds the production code to a reading that shares none of its structure: the
 * shift sampled through, a moment at a time, each asked about on its own from the calendar.
 */

const MIN = 60_000;
/**
 * How finely a shift is sampled. Every slot, block, bound and shift in the generated cases starts
 * and ends on a half hour, so nothing changes between samples five minutes apart.
 */
const SAMPLE = 5 * MIN;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const WAT = HOUR;

/** Monday 2026-09-14 00:00 WAT. */
const MONDAY = Date.UTC(2026, 8, 13, 23, 0, 0);
const at = (day: number, hour: number, minute = 0) => new Date(MONDAY + day * DAY + hour * HOUR + minute * MIN);
const win = (startsAt: Date, endsAt: Date): TimeWindow => ({ startsAt, endsAt });

function weekly(dayOfWeek: number, from: string, to: string, over: Partial<SlotLike> = {}): SlotLike {
  const minute = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));
  return {
    kind: 'RECURRING_WEEKLY',
    dayOfWeek,
    startMinute: minute(from),
    endMinute: to === '24:00' ? 1440 : minute(to),
    effectiveFrom: null,
    effectiveUntil: null,
    startsAt: null,
    endsAt: null,
    ...over,
  };
}

function oneOff(startsAt: Date, endsAt: Date): SlotLike {
  return {
    kind: 'ONE_OFF',
    dayOfWeek: null,
    startMinute: null,
    endMinute: null,
    effectiveFrom: null,
    effectiveUntil: null,
    startsAt,
    endsAt,
  };
}

const iso = (windows: TimeWindow[]) => windows.map((w) => [w.startsAt.toISOString(), w.endsAt.toISOString()]);

describe('subtracting time away', () => {
  it('cuts a window around the time away', () => {
    expect(iso(subtractWindows([win(at(0, 8), at(0, 20))], [win(at(0, 12), at(0, 14))]))).toEqual([
      [at(0, 8).toISOString(), at(0, 12).toISOString()],
      [at(0, 14).toISOString(), at(0, 20).toISOString()],
    ]);
  });

  it('removes a window that time away covers whole, and one it covers from the front or the back', () => {
    expect(subtractWindows([win(at(0, 8), at(0, 12))], [win(at(0, 7), at(0, 13))])).toEqual([]);
    expect(iso(subtractWindows([win(at(0, 8), at(0, 12))], [win(at(0, 7), at(0, 10))]))).toEqual([
      [at(0, 10).toISOString(), at(0, 12).toISOString()],
    ]);
    expect(iso(subtractWindows([win(at(0, 8), at(0, 12))], [win(at(0, 10), at(0, 13))]))).toEqual([
      [at(0, 8).toISOString(), at(0, 10).toISOString()],
    ]);
  });

  it('leaves no empty sliver where time away begins or ends exactly with a window', () => {
    expect(iso(subtractWindows([win(at(0, 8), at(0, 12))], [win(at(0, 8), at(0, 10))]))).toEqual([
      [at(0, 10).toISOString(), at(0, 12).toISOString()],
    ]);
    expect(iso(subtractWindows([win(at(0, 8), at(0, 12))], [win(at(0, 10), at(0, 12))]))).toEqual([
      [at(0, 8).toISOString(), at(0, 10).toISOString()],
    ]);
    expect(subtractWindows([win(at(0, 8), at(0, 12))], [win(at(0, 8), at(0, 12))])).toEqual([]);
  });

  it('leaves a window alone that time away only touches', () => {
    expect(subtractWindows([win(at(0, 8), at(0, 12))], [win(at(0, 12), at(0, 18))])).toHaveLength(1);
    expect(subtractWindows([win(at(0, 8), at(0, 12))], [win(at(0, 2), at(0, 8))])).toHaveLength(1);
  });

  it('takes nothing away for a period of no length, and does not split a window for it', () => {
    expect(iso(subtractWindows([win(at(0, 8), at(0, 12))], [win(at(0, 10), at(0, 10))]))).toEqual([
      [at(0, 8).toISOString(), at(0, 12).toISOString()],
    ]);
  });

  it('handles several windows and several periods away, in any order', () => {
    const result = subtractWindows(
      [win(at(1, 8), at(1, 20)), win(at(0, 8), at(0, 20))],
      [win(at(1, 10), at(1, 11)), win(at(0, 9), at(0, 10)), win(at(0, 15), at(0, 16))],
    );
    expect(iso(result)).toEqual([
      [at(0, 8).toISOString(), at(0, 9).toISOString()],
      [at(0, 10).toISOString(), at(0, 15).toISOString()],
      [at(0, 16).toISOString(), at(0, 20).toISOString()],
      [at(1, 8).toISOString(), at(1, 10).toISOString()],
      [at(1, 11).toISOString(), at(1, 20).toISOString()],
    ]);
  });
});

describe('what is offered', () => {
  const range = win(at(0, 0), at(7, 0));

  it('is the weekly pattern and the dated free windows together', () => {
    const result = offeredWindows(
      [weekly(1, '08:00', '16:00'), oneOff(at(2, 20), at(3, 8))],
      [],
      range,
    );
    expect(iso(result)).toEqual([
      [at(0, 8).toISOString(), at(0, 16).toISOString()],
      [at(2, 20).toISOString(), at(3, 8).toISOString()],
    ]);
  });

  it('joins what touches: all of Monday and Tuesday morning make one window', () => {
    const result = offeredWindows(
      [weekly(1, '00:00', '24:00'), weekly(2, '00:00', '12:00')],
      [],
      win(at(0, 0), at(2, 0)),
    );
    expect(iso(result)).toEqual([[at(0, 0).toISOString(), at(1, 12).toISOString()]]);
  });

  it('is cut by time away, whatever else was said', () => {
    // "I work Mondays", "I am free this Monday night" and "I am away this Monday" at once.
    const result = offeredWindows(
      [weekly(1, '08:00', '16:00'), oneOff(at(0, 20), at(1, 8))],
      [win(at(0, 12), at(0, 22))],
      range,
    );
    expect(iso(result)).toEqual([
      [at(0, 8).toISOString(), at(0, 12).toISOString()],
      [at(0, 22).toISOString(), at(1, 8).toISOString()],
    ]);
  });

  it('offers nothing of a free day that falls wholly in a week away', () => {
    const result = offeredWindows([oneOff(at(2, 0), at(3, 0))], [win(at(0, 0), at(6, 0))], range);
    expect(result).toEqual([]);
  });

  it('is only what falls inside the range asked about', () => {
    const result = offeredWindows([oneOff(at(0, 8), at(0, 20))], [], win(at(0, 10), at(0, 12)));
    expect(iso(result)).toEqual([[at(0, 10).toISOString(), at(0, 12).toISOString()]]);
  });

  it('offers nothing for no slots, or for a range of no length', () => {
    expect(offeredWindows([], [], range)).toEqual([]);
    expect(offeredWindows([weekly(1, '08:00', '16:00')], [], win(at(0, 9), at(0, 9)))).toEqual([]);
  });
});

/**
 * The reading with no shared structure: one moment at a time, from the calendar. A moment is
 * offered when some weekly occurrence that started today or yesterday (the only ones that can
 * reach it) is in force and covers it, or a dated window does; and it is lost if any time away
 * covers it. A shift is available when every moment of it is offered.
 */
function oracle(slots: SlotLike[], blocks: TimeWindow[]) {
  const dayStartOf = (ms: number) => Math.floor((ms + WAT) / DAY) * DAY - WAT;

  const offeredMinute = (m: number): boolean =>
    slots.some((slot) => {
      if (slot.kind === 'ONE_OFF') return m >= slot.startsAt!.getTime() && m < slot.endsAt!.getTime();
      for (const back of [0, -1]) {
        const dayStart = dayStartOf(m) + back * DAY;
        if (new Date(dayStart + WAT).getUTCDay() !== slot.dayOfWeek) continue;
        const start = dayStart + slot.startMinute! * MIN;
        const length =
          (slot.endMinute! > slot.startMinute! ? slot.endMinute! - slot.startMinute! : 1440 - slot.startMinute! + slot.endMinute!) * MIN;
        if (m < start || m >= start + length) continue;
        if (slot.effectiveFrom && start < slot.effectiveFrom.getTime()) continue;
        if (slot.effectiveUntil && start >= slot.effectiveUntil.getTime()) continue;
        return true;
      }
      return false;
    });

  const awayMinute = (m: number) => blocks.some((b) => m >= b.startsAt.getTime() && m < b.endsAt.getTime());

  return { offeredMinute, awayMinute };
}

/** A small, repeatable generator, so a failure names a case that can be run again. */
function generator(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('the model against a reading one moment at a time', () => {
  const CASES = 700;

  function buildCase(random: () => number) {
    const int = (low: number, high: number) => low + Math.floor(random() * (high - low + 1));
    const halfHours = (low: number, high: number) => int(low, high) * 30;

    const slots: SlotLike[] = [];
    for (let i = int(1, 3); i > 0; i -= 1) {
      const startMinute = halfHours(0, 47);
      let endMinute = halfHours(1, 48);
      if (endMinute === startMinute) endMinute = startMinute === 0 ? 1440 : startMinute - 30;
      slots.push(
        weekly(int(0, 6), '00:00', '00:30', {
          startMinute,
          endMinute,
          effectiveFrom: random() < 0.3 ? at(int(0, 12), 0, halfHours(0, 47)) : null,
          effectiveUntil: random() < 0.3 ? at(int(1, 13), 0, halfHours(0, 47)) : null,
        }),
      );
    }
    for (let i = int(0, 2); i > 0; i -= 1) {
      const startsAt = at(int(0, 12), 0, halfHours(0, 47));
      slots.push(oneOff(startsAt, new Date(startsAt.getTime() + halfHours(1, 40) * MIN)));
    }
    const blocks: TimeWindow[] = [];
    for (let i = int(0, 2); i > 0; i -= 1) {
      const startsAt = at(int(0, 12), 0, halfHours(0, 47));
      blocks.push(win(startsAt, new Date(startsAt.getTime() + halfHours(1, 60) * MIN)));
    }
    const shiftStart = at(int(0, 11), 0, halfHours(0, 47));
    const shift = win(shiftStart, new Date(shiftStart.getTime() + halfHours(1, 32) * MIN));
    return { slots, blocks, shift };
  }

  it('says a shift is available exactly when every moment of it is offered and none is away', () => {
    const random = generator(20_260_918);
    let available = 0;
    let blocked = 0;
    let partly = 0;
    let none = 0;

    for (let n = 0; n < CASES; n += 1) {
      const { slots, blocks, shift } = buildCase(random);
      const { offeredMinute, awayMinute } = oracle(slots, blocks);

      let every = true;
      let any = false;
      let away = false;
      for (let m = shift.startsAt.getTime(); m < shift.endsAt.getTime(); m += SAMPLE) {
        const offered = offeredMinute(m);
        if (!offered) every = false;
        if (offered) any = true;
        if (awayMinute(m)) away = true;
      }

      const verdict = availabilityFor(slots, blocks, shift);
      const expected = away ? 'blocked' : every ? 'available' : any ? 'partly_offered' : 'not_offered';
      expect(verdict.reason, `case ${n}`).toBe(expected);
      expect(verdict.available, `case ${n}`).toBe(expected === 'available');

      if (expected === 'available') available += 1;
      if (expected === 'blocked') blocked += 1;
      if (expected === 'partly_offered') partly += 1;
      if (expected === 'not_offered') none += 1;
    }

    // The generator reaches all four answers often enough for the comparison to mean something.
    expect(Math.min(available, blocked, partly, none)).toBeGreaterThan(CASES / 50);
  }, 30_000);

  it('lays out exactly the offered moments that are not away, merged and in order', () => {
    const random = generator(918_2026);

    for (let n = 0; n < CASES; n += 1) {
      const { slots, blocks, shift } = buildCase(random);
      const { offeredMinute, awayMinute } = oracle(slots, blocks);
      const windows = offeredWindows(slots, blocks, shift);

      for (const [index, w] of windows.entries()) {
        expect(w.endsAt.getTime(), `case ${n}`).toBeGreaterThan(w.startsAt.getTime());
        expect(w.startsAt.getTime(), `case ${n}`).toBeGreaterThanOrEqual(shift.startsAt.getTime());
        expect(w.endsAt.getTime(), `case ${n}`).toBeLessThanOrEqual(shift.endsAt.getTime());
        // Merged: the next one starts strictly after this one ends.
        if (index > 0) expect(w.startsAt.getTime(), `case ${n}`).toBeGreaterThan(windows[index - 1]!.endsAt.getTime());
      }

      for (let m = shift.startsAt.getTime(); m < shift.endsAt.getTime(); m += SAMPLE) {
        const inside = windows.some((w) => m >= w.startsAt.getTime() && m < w.endsAt.getTime());
        expect(inside, `case ${n}, moment ${new Date(m).toISOString()}`).toBe(offeredMinute(m) && !awayMinute(m));
      }
    }
  }, 30_000);
});

describe('the next time a practitioner can be matched', () => {
  const MONDAY_DAYTIME = [weekly(1, '08:00', '18:00')];

  it('is the rest of the window they are in, from now', () => {
    const next = nextOffered(MONDAY_DAYTIME, [], at(0, 10));
    expect(next?.startsAt.toISOString()).toBe(at(0, 10).toISOString());
    expect(next?.endsAt.toISOString()).toBe(at(0, 18).toISOString());
  });

  it('is the next one when today’s is over', () => {
    const next = nextOffered(MONDAY_DAYTIME, [], at(0, 19));
    expect(next?.startsAt.toISOString()).toBe(at(7, 8).toISOString());
  });

  it('skips what is away', () => {
    const next = nextOffered(MONDAY_DAYTIME, [win(at(6, 0), at(9, 0))], at(0, 19));
    expect(next?.startsAt.toISOString()).toBe(at(14, 8).toISOString());
  });

  it('starts after time away that ends part-way through a window', () => {
    const next = nextOffered(MONDAY_DAYTIME, [win(at(0, 6), at(0, 12))], at(0, 7));
    expect(next?.startsAt.toISOString()).toBe(at(0, 12).toISOString());
  });

  it('is nothing when everything offered lies in time away, or nothing was offered', () => {
    expect(nextOffered(MONDAY_DAYTIME, [win(at(0, 0), at(LOOKAHEAD_DAYS + 7, 0))], at(0, 7))).toBeNull();
    expect(nextOffered([], [], at(0, 7))).toBeNull();
  });

  it('is nothing for a dated window already over, or a pattern that has ended', () => {
    expect(nextOffered([oneOff(at(-2, 8), at(-2, 20))], [], at(0, 7))).toBeNull();
    expect(nextOffered([weekly(1, '08:00', '18:00', { effectiveUntil: at(-3, 0) })], [], at(0, 7))).toBeNull();
  });

  it('looks as far ahead as it says it does, and no further', () => {
    const farOff = oneOff(at(LOOKAHEAD_DAYS - 1, 8), at(LOOKAHEAD_DAYS - 1, 16));
    const beyond = oneOff(at(LOOKAHEAD_DAYS + 2, 8), at(LOOKAHEAD_DAYS + 2, 16));
    expect(nextOffered([farOff], [], at(0, 0))).not.toBeNull();
    expect(nextOffered([beyond], [], at(0, 0))).toBeNull();
  });
});

describe('where each thing somebody said stands', () => {
  const now = at(0, 10);

  it('calls a pattern in force and not away open', () => {
    expect(slotStanding(weekly(1, '08:00', '18:00'), [], now)).toBe('open');
  });

  it('calls a dated window that is over, and a pattern that has ended, finished', () => {
    expect(slotStanding(oneOff(at(-1, 8), at(-1, 20)), [], now)).toBe('finished');
    expect(slotStanding(weekly(1, '08:00', '18:00', { effectiveUntil: at(-1, 0) }), [], now)).toBe('finished');
  });

  it('calls a pattern that has not yet begun starts_later', () => {
    expect(slotStanding(weekly(1, '08:00', '18:00', { effectiveFrom: at(3, 0) }), [], now)).toBe('starts_later');
  });

  it('calls a dated window that time away covers whole all_away, and one it covers in part part_away', () => {
    expect(slotStanding(oneOff(at(2, 8), at(2, 20)), [win(at(2, 0), at(3, 0))], now)).toBe('all_away');
    expect(slotStanding(oneOff(at(2, 8), at(2, 20)), [win(at(2, 12), at(2, 14))], now)).toBe('part_away');
  });

  it('does not count a dated window that time away only touches', () => {
    expect(slotStanding(oneOff(at(2, 8), at(2, 20)), [win(at(2, 20), at(3, 0))], now)).toBe('open');
  });

  it('calls a pattern all_away only when every remaining occurrence is covered', () => {
    const pattern = weekly(1, '08:00', '18:00');
    const everyMondayAway = [win(at(0, 0), at(LOOKAHEAD_DAYS + 7, 0))];
    expect(slotStanding(pattern, [win(at(5, 0), at(9, 0))], now)).toBe('open');
    expect(slotStanding(pattern, everyMondayAway, now)).toBe('all_away');
  });

  it('does not call a dated window that is in progress over', () => {
    expect(slotStanding(oneOff(at(0, 8), at(0, 20)), [], now)).toBe('open');
  });
});
