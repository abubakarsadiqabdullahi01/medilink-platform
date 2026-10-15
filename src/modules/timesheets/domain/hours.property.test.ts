import { describe, expect, it } from 'vitest';
import { WAT_OFFSET_MINUTES } from '@/modules/availability/domain/availability';
import { exclusiveBands, priceStoredTimesheet } from '@/modules/rates-contracts/domain/pricing';
import {
  NIGHT_ENDS_MINUTE,
  NIGHT_STARTS_MINUTE,
  computeTimesheet,
  watDateOf,
  type TimesheetTotals,
  type WorkedShift,
} from './hours';

/**
 * M10-05: "no minute is lost or counted twice when night, holiday and overtime overlap".
 *
 * The table in hours.test.ts holds the shifts somebody thought of. These are the ones nobody
 * did: a few thousand shifts from a generator with a fixed seed, so a failure is the same
 * failure on every machine, each checked against what must be true of *any* shift. A failing
 * case prints itself, with the seed, so it can be pasted into the table as it stands.
 *
 * The first run found a real one: a shift of 22:00 to 02:00 WAT, the first two hours on a
 * holiday, with a one-minute break. 239 minutes were billable and the holiday and night buckets
 * rounded up to 120 each, so 240 were priced: a minute counted twice, at a premium.
 */

const MINUTE = 60_000;
const SEED = 20_261_015;
const CASES = 1_500;

/** mulberry32: small, fast, and the same sequence everywhere. */
function generator(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  const int = (low: number, high: number) => low + Math.floor(next() * (high - low + 1));
  return { next, int, pick: <T,>(items: readonly T[]) => items[int(0, items.length - 1)]! };
}

interface Case {
  shift: WorkedShift;
  label: string;
}

const EPOCH = Date.UTC(2026, 0, 1);

/** Every WAT calendar date the instants in [from, to] fall on. */
function datesBetween(from: Date, to: Date): string[] {
  const dates: string[] = [];
  for (let at = from.getTime(); at <= to.getTime() + 24 * 60 * MINUTE; at += 24 * 60 * MINUTE) {
    const date = watDateOf(new Date(at));
    if (!dates.includes(date)) dates.push(date);
  }
  return dates;
}

function cases(count: number, seed = SEED): Case[] {
  const random = generator(seed);
  const out: Case[] = [];

  for (let index = 0; index < count; index += 1) {
    // Minute-aligned half the time; the other half has seconds, as a real check-in does.
    const aligned = random.next() < 0.5;
    const startMs =
      EPOCH + random.int(0, 400 * 24 * 60) * MINUTE + (aligned ? 0 : random.int(0, 59) * 1000);
    const workedMinutes = random.pick([
      random.int(1, 1440),
      random.int(1, 90),
      random.int(360, 780),
      1440,
      1,
    ]);
    // Seconds on the end as well, but never so many that a day's shift rounds to a day and a minute,
    // which the domain refuses.
    const endMs = Math.min(
      startMs + workedMinutes * MINUTE + (aligned ? 0 : random.int(0, 59) * 1000),
      startMs + 1440 * MINUTE,
    );

    const checkedInAt = new Date(startMs);
    const checkedOutAt = new Date(endMs);
    const worked = Math.round((endMs - startMs) / MINUTE);

    const breakMinutes = random.pick([
      0,
      random.int(0, Math.min(worked, 90)),
      random.int(0, worked),
      1,
      worked,
    ].map((value) => Math.min(value, worked)));

    const touched = datesBetween(checkedInAt, checkedOutAt);
    const holidayDates = new Set<string>();
    const mode = random.int(0, 3);
    if (mode === 1) for (const date of touched) holidayDates.add(date);
    if (mode === 2) holidayDates.add(random.pick(touched));
    if (mode === 3) for (const date of touched) if (random.next() < 0.5) holidayDates.add(date);
    // A holiday nowhere near the shift changes nothing, and must change nothing.
    if (random.next() < 0.3) holidayDates.add('2031-12-25');

    const scheduledStart = new Date(startMs + random.int(-45, 45) * MINUTE);
    const scheduledEnd = new Date(scheduledStart.getTime() + random.int(30, 900) * MINUTE);

    out.push({
      label: `seed ${seed}, case ${index}`,
      shift: {
        checkedInAt,
        checkedOutAt,
        breakMinutes,
        scheduledStartsAt: scheduledStart,
        scheduledEndsAt: scheduledEnd,
        hourlyRateKobo: random.int(100_000, 2_500_000),
        holidayDates,
        onCallMinutes: random.next() < 0.2 ? random.int(0, 240) : 0,
      },
    });
  }
  return out;
}

const describeShift = (shift: WorkedShift) =>
  JSON.stringify({
    in: shift.checkedInAt.toISOString(),
    out: shift.checkedOutAt.toISOString(),
    break: shift.breakMinutes,
    holidays: [...shift.holidayDates],
    rate: shift.hourlyRateKobo,
  });

const ALL = cases(CASES);

describe('every shift, whatever its hours', () => {
  it('prices each billable minute exactly once: the buckets add up to what is billable', () => {
    for (const { shift, label } of ALL) {
      const totals = computeTimesheet(shift);
      const { ordinaryMinutes, nightMinutes, holidayMinutes } = totals.exclusive;
      const message = `${label}: ${describeShift(shift)} -> ${JSON.stringify(totals.exclusive)}`;

      expect(Number.isInteger(ordinaryMinutes), message).toBe(true);
      expect(ordinaryMinutes, message).toBeGreaterThanOrEqual(0);
      expect(nightMinutes, message).toBeGreaterThanOrEqual(0);
      expect(holidayMinutes, message).toBeGreaterThanOrEqual(0);
      expect(ordinaryMinutes + nightMinutes + holidayMinutes, message).toBe(totals.billableMinutes);
    }
  });

  it('reads back from the stored row as the same buckets, so the invoice prices the same minutes', () => {
    for (const { shift, label } of ALL) {
      const totals = computeTimesheet(shift);
      const stored = {
        billableMinutes: totals.billableMinutes,
        nightOnlyMinutes: totals.exclusive.nightMinutes,
        holidayMinutes: totals.holidayMinutes,
      };

      expect(exclusiveBands(stored), `${label}: ${describeShift(shift)}`).toEqual({
        ordinaryMinutes: totals.exclusive.ordinaryMinutes,
        nightMinutes: totals.exclusive.nightMinutes,
        holidayMinutes: totals.exclusive.holidayMinutes,
      });
    }
  });

  it('prices the same hours at par however they are split, to within the kobo the lines round', () => {
    for (const { shift, label } of ALL) {
      const totals = computeTimesheet(shift);
      const priced = priceStoredTimesheet(
        {
          billableMinutes: totals.billableMinutes,
          nightOnlyMinutes: totals.exclusive.nightMinutes,
          holidayMinutes: totals.holidayMinutes,
          overtimeMinutes: totals.overtimeMinutes,
          onCallMinutes: 0,
          hourlyRateKobo: shift.hourlyRateKobo,
        },
        {
          nightMultiplierBp: 10_000,
          holidayMultiplierBp: 10_000,
          overtimeMultiplierBp: 10_000,
          onCallMultiplierBp: 10_000,
        },
      ).priced;

      // No premium on the card, so the invoice is the base figure. Each line is rounded to the
      // kobo on its own, so it can differ by a kobo or two; a minute counted twice is at least
      // 1,666 kobo, on the cheapest rate the generator draws, and would be nowhere near.
      expect(Math.abs(priced.totalKobo - totals.amountKobo), `${label}: ${describeShift(shift)}`).toBeLessThanOrEqual(2);
    }
  });

  it('keeps every band inside the billable minutes, and the overlap bands consistent with the split', () => {
    for (const { shift, label } of ALL) {
      const totals = computeTimesheet(shift);
      const message = `${label}: ${describeShift(shift)}`;

      expect(totals.nightMinutes, message).toBeLessThanOrEqual(totals.billableMinutes);
      expect(totals.holidayMinutes, message).toBeLessThanOrEqual(totals.billableMinutes);
      expect(totals.overtimeMinutes, message).toBeLessThanOrEqual(totals.billableMinutes);
      // Holiday takes precedence, so its bucket is the holiday figure as it stands; the night
      // bucket is the night that is not holiday, and can never exceed the night altogether.
      expect(totals.exclusive.holidayMinutes, message).toBe(totals.holidayMinutes);
      expect(totals.exclusive.nightMinutes, message).toBeLessThanOrEqual(totals.nightMinutes);
    }
  });

  it('adds up the hours the way the clock does', () => {
    for (const { shift, label } of ALL) {
      const totals = computeTimesheet(shift);
      const message = `${label}: ${describeShift(shift)}`;
      const worked = Math.round((shift.checkedOutAt.getTime() - shift.checkedInAt.getTime()) / MINUTE);
      const scheduled = Math.round(
        (shift.scheduledEndsAt.getTime() - shift.scheduledStartsAt.getTime()) / MINUTE,
      );

      expect(totals.workedMinutes, message).toBe(worked);
      expect(totals.billableMinutes, message).toBe(worked - shift.breakMinutes);
      expect(totals.overtimeMinutes, message).toBe(Math.max(0, worked - shift.breakMinutes - scheduled));
      expect(totals.amountKobo, message).toBe(
        Math.round((totals.billableMinutes * shift.hourlyRateKobo) / 60),
      );
    }
  });

  it('pays no less for a longer shift and no more for a longer break', () => {
    for (const { shift, label } of ALL) {
      const base = computeTimesheet(shift);
      const message = `${label}: ${describeShift(shift)}`;

      if (shift.breakMinutes < base.workedMinutes) {
        const longerBreak = computeTimesheet({ ...shift, breakMinutes: shift.breakMinutes + 1 });
        expect(longerBreak.amountKobo, message).toBeLessThanOrEqual(base.amountKobo);
        expect(longerBreak.billableMinutes, message).toBe(base.billableMinutes - 1);
      }
    }
  });
});

describe('a shift wholly inside the night that a holiday splits at midnight', () => {
  // The shape random shifts almost never take, and the one the first run of this file found: no
  // ordinary minute is left to absorb a rounding, so a break that makes both halves round up
  // prices a minute twice. Swept, not sampled, so it is the same shifts on every run.
  it('still prices each billable minute exactly once, whichever side is the holiday and however long the break', () => {
    const MIDNIGHT_WAT = Date.UTC(2026, 9, 14, 23, 0); // 00:00 WAT on the 15th
    for (let startOffset = -240; startOffset < 0; startOffset += 30) {
      for (let endOffset = 30; endOffset <= 360; endOffset += 30) {
        for (let breakMinutes = 0; breakMinutes <= 8; breakMinutes += 1) {
          for (const holiday of ['2026-10-14', '2026-10-15']) {
            const checkedInAt = new Date(MIDNIGHT_WAT + startOffset * MINUTE);
            const checkedOutAt = new Date(MIDNIGHT_WAT + endOffset * MINUTE);
            const shift: WorkedShift = {
              checkedInAt,
              checkedOutAt,
              breakMinutes,
              scheduledStartsAt: checkedInAt,
              scheduledEndsAt: checkedOutAt,
              hourlyRateKobo: 600_000,
              holidayDates: new Set([holiday]),
            };
            const totals = computeTimesheet(shift);
            const { ordinaryMinutes, nightMinutes, holidayMinutes } = totals.exclusive;

            expect(
              ordinaryMinutes + nightMinutes + holidayMinutes,
              `${describeShift(shift)} -> ${JSON.stringify(totals.exclusive)}`,
            ).toBe(totals.billableMinutes);
          }
        }
      }
    }
  });
});

describe('the bands against the clock, worked out another way', () => {
  /** Night and holiday overlap in minutes, by interval arithmetic over WAT days. */
  function overlap(shift: WorkedShift) {
    const from = (shift.checkedInAt.getTime() - EPOCH) / MINUTE + WAT_OFFSET_MINUTES;
    const to = (shift.checkedOutAt.getTime() - EPOCH) / MINUTE + WAT_OFFSET_MINUTES;
    const epochDay = Math.floor(EPOCH / (24 * 60 * MINUTE));

    let night = 0;
    let holiday = 0;
    const firstDay = Math.floor(from / 1440) - 1;
    const lastDay = Math.floor(to / 1440) + 1;
    for (let day = firstDay; day <= lastDay; day += 1) {
      const start = day * 1440;
      const clip = (a: number, b: number) => Math.max(0, Math.min(to, b) - Math.max(from, a));
      night += clip(start, start + NIGHT_ENDS_MINUTE);
      night += clip(start + NIGHT_STARTS_MINUTE, start + 1440);
      const date = new Date((epochDay + day) * 24 * 60 * MINUTE).toISOString().slice(0, 10);
      if (shift.holidayDates.has(date)) holiday += clip(start, start + 1440);
    }
    return { night, holiday };
  }

  it('finds the night and the holiday to within the minute each boundary can move it', () => {
    for (const { shift, label } of ALL) {
      // No break, so the figures are the hours themselves rather than a proportion of them.
      const totals = computeTimesheet({ ...shift, breakMinutes: 0 });
      const exact = overlap(shift);
      const message = `${label}: ${describeShift(shift)} exact ${JSON.stringify(exact)}`;

      // The shift is read a minute at a time from its own start, so each of the (at most
      // three) places the night begins or ends can move the count by under a minute.
      expect(Math.abs(totals.nightMinutes - exact.night), message).toBeLessThanOrEqual(3);
      expect(Math.abs(totals.holidayMinutes - exact.holiday), message).toBeLessThanOrEqual(3);
    }
  });

  it('is the same arithmetic as the 20:00 and 06:00 the pay floor is set for', () => {
    expect(NIGHT_STARTS_MINUTE).toBe(20 * 60);
    expect(NIGHT_ENDS_MINUTE).toBe(6 * 60);
  });
});

describe('a shift cut in two at a whole minute', () => {
  it('has the same minutes in its halves as in the whole, in every band', () => {
    const random = generator(SEED + 1);
    for (const { shift, label } of ALL) {
      const aligned = {
        ...shift,
        checkedInAt: new Date(Math.floor(shift.checkedInAt.getTime() / MINUTE) * MINUTE),
        checkedOutAt: new Date(Math.ceil(shift.checkedOutAt.getTime() / MINUTE) * MINUTE),
        breakMinutes: 0,
      };
      const worked = (aligned.checkedOutAt.getTime() - aligned.checkedInAt.getTime()) / MINUTE;
      if (worked < 2 || worked > 1440) continue;

      const cut = new Date(aligned.checkedInAt.getTime() + random.int(1, worked - 1) * MINUTE);
      const whole = computeTimesheet(aligned);
      const first = computeTimesheet({ ...aligned, checkedOutAt: cut });
      const second = computeTimesheet({ ...aligned, checkedInAt: cut });
      const message = `${label}: ${describeShift(aligned)} cut at ${cut.toISOString()}`;

      const sum = (pick: (totals: TimesheetTotals) => number) => pick(first) + pick(second);
      expect(sum((t) => t.workedMinutes), message).toBe(whole.workedMinutes);
      expect(sum((t) => t.nightMinutes), message).toBe(whole.nightMinutes);
      expect(sum((t) => t.holidayMinutes), message).toBe(whole.holidayMinutes);
      expect(sum((t) => t.exclusive.nightMinutes), message).toBe(whole.exclusive.nightMinutes);
      expect(sum((t) => t.exclusive.ordinaryMinutes), message).toBe(whole.exclusive.ordinaryMinutes);
    }
  });
});

describe('a holiday that is not on the shift', () => {
  it('changes nothing, and one that covers all of it makes every billable minute a holiday one', () => {
    for (const { shift, label } of ALL) {
      const none = computeTimesheet({ ...shift, holidayDates: new Set(['2031-12-25']) });
      expect(none.holidayMinutes, `${label}: ${describeShift(shift)}`).toBe(0);
      expect(none.exclusive.nightMinutes, `${label}: ${describeShift(shift)}`).toBe(none.nightMinutes);

      const every = computeTimesheet({
        ...shift,
        holidayDates: new Set(datesBetween(shift.checkedInAt, shift.checkedOutAt)),
      });
      expect(every.holidayMinutes, `${label}: ${describeShift(shift)}`).toBe(every.billableMinutes);
      expect(every.exclusive.nightMinutes, `${label}: ${describeShift(shift)}`).toBe(0);
      expect(every.exclusive.ordinaryMinutes, `${label}: ${describeShift(shift)}`).toBe(0);
    }
  });
});
