import { describe, expect, it } from 'vitest';
import {
  NIGHT_ENDS_MINUTE,
  NIGHT_STARTS_MINUTE,
  TimesheetError,
  computeTimesheet,
  watDateOf,
  type WorkedShift,
} from './hours';

/**
 * Step 7.4's stated verification: "a unit table of shifts with known expected
 * values, including a night shift crossing midnight and a public holiday".
 *
 * Times are written in UTC; WAT is one hour ahead, so 07:00Z is 08:00 local.
 * That hour is where a dropped offset would show, and several cases below sit
 * deliberately on the boundary.
 */

const RATE = 500_000; // 5,000 naira an hour, in kobo

function shift(overrides: Partial<WorkedShift> = {}): WorkedShift {
  return {
    checkedInAt: new Date('2026-09-14T07:00:00Z'), // 08:00 WAT
    checkedOutAt: new Date('2026-09-14T15:00:00Z'), // 16:00 WAT
    breakMinutes: 0,
    scheduledStartsAt: new Date('2026-09-14T07:00:00Z'),
    scheduledEndsAt: new Date('2026-09-14T15:00:00Z'),
    hourlyRateKobo: RATE,
    holidayDates: new Set<string>(),
    ...overrides,
  };
}

describe('watDateOf', () => {
  it('uses the WAT calendar day, not the UTC one', () => {
    // 23:30 UTC is already the next day in Lagos, and a holiday list keyed on
    // UTC would miss a whole evening of holiday hours.
    expect(watDateOf(new Date('2026-09-14T23:30:00Z'))).toBe('2026-09-15');
    expect(watDateOf(new Date('2026-09-14T22:30:00Z'))).toBe('2026-09-14');
  });
});

describe('a plain day shift', () => {
  it('bills every minute at the agreed rate', () => {
    const totals = computeTimesheet(shift());

    expect(totals.workedMinutes).toBe(480);
    expect(totals.billableMinutes).toBe(480);
    expect(totals.nightMinutes).toBe(0);
    expect(totals.overtimeMinutes).toBe(0);
    expect(totals.holidayMinutes).toBe(0);
    // Eight hours at 5,000 naira.
    expect(totals.amountKobo).toBe(8 * RATE);
  });

  it('deducts an unpaid break', () => {
    const totals = computeTimesheet(shift({ breakMinutes: 60 }));

    expect(totals.workedMinutes).toBe(480);
    expect(totals.billableMinutes).toBe(420);
    expect(totals.amountKobo).toBe(7 * RATE);
  });
});

describe('a night shift crossing midnight', () => {
  // 19:00 to 05:00 WAT, which is 18:00Z to 04:00Z the next day.
  const night = shift({
    checkedInAt: new Date('2026-09-14T18:00:00Z'),
    checkedOutAt: new Date('2026-09-15T04:00:00Z'),
    scheduledStartsAt: new Date('2026-09-14T18:00:00Z'),
    scheduledEndsAt: new Date('2026-09-15T04:00:00Z'),
  });

  it('bills the whole ten hours', () => {
    const totals = computeTimesheet(night);
    expect(totals.workedMinutes).toBe(600);
    expect(totals.amountKobo).toBe(10 * RATE);
  });

  it('counts only the hours actually inside the night window', () => {
    // 19:00-20:00 WAT is evening, not night. 20:00-05:00 is nine hours of it.
    const totals = computeTimesheet(night);
    expect(totals.nightMinutes).toBe(9 * 60);
  });

  it('counts a shift entirely inside the night window as all night', () => {
    const deepNight = shift({
      checkedInAt: new Date('2026-09-14T21:00:00Z'), // 22:00 WAT
      checkedOutAt: new Date('2026-09-15T03:00:00Z'), // 04:00 WAT
      scheduledStartsAt: new Date('2026-09-14T21:00:00Z'),
      scheduledEndsAt: new Date('2026-09-15T03:00:00Z'),
    });
    const totals = computeTimesheet(deepNight);
    expect(totals.nightMinutes).toBe(totals.billableMinutes);
  });

  it('puts the night boundary at 20:00 and 06:00 WAT', () => {
    expect(NIGHT_STARTS_MINUTE).toBe(20 * 60);
    expect(NIGHT_ENDS_MINUTE).toBe(6 * 60);

    // 18:00-19:00 WAT: entirely before the window.
    const evening = shift({
      checkedInAt: new Date('2026-09-14T17:00:00Z'),
      checkedOutAt: new Date('2026-09-14T18:00:00Z'),
      scheduledStartsAt: new Date('2026-09-14T17:00:00Z'),
      scheduledEndsAt: new Date('2026-09-14T18:00:00Z'),
    });
    expect(computeTimesheet(evening).nightMinutes).toBe(0);

    // 05:00-07:00 WAT: one hour inside, one outside.
    const dawn = shift({
      checkedInAt: new Date('2026-09-14T04:00:00Z'),
      checkedOutAt: new Date('2026-09-14T06:00:00Z'),
      scheduledStartsAt: new Date('2026-09-14T04:00:00Z'),
      scheduledEndsAt: new Date('2026-09-14T06:00:00Z'),
    });
    expect(computeTimesheet(dawn).nightMinutes).toBe(60);
  });
});

describe('a public holiday', () => {
  it('counts the whole shift as holiday hours', () => {
    const totals = computeTimesheet(shift({ holidayDates: new Set(['2026-09-14']) }));
    expect(totals.holidayMinutes).toBe(480);
  });

  it('counts only the part that falls on the holiday', () => {
    // A night shift starting the evening before a holiday: 19:00 WAT on the
    // 14th to 05:00 WAT on the 15th, with only the 15th a holiday.
    const overnight = shift({
      checkedInAt: new Date('2026-09-14T18:00:00Z'),
      checkedOutAt: new Date('2026-09-15T04:00:00Z'),
      scheduledStartsAt: new Date('2026-09-14T18:00:00Z'),
      scheduledEndsAt: new Date('2026-09-15T04:00:00Z'),
      holidayDates: new Set(['2026-09-15']),
    });

    // Midnight WAT is 23:00Z on the 14th, so five hours fall on the holiday.
    expect(computeTimesheet(overnight).holidayMinutes).toBe(5 * 60);
  });

  it('matches the holiday on the WAT date, not the UTC one', () => {
    // 23:30Z on the 14th is 00:30 on the 15th in Lagos.
    const lateEvening = shift({
      checkedInAt: new Date('2026-09-14T23:00:00Z'),
      checkedOutAt: new Date('2026-09-15T01:00:00Z'),
      scheduledStartsAt: new Date('2026-09-14T23:00:00Z'),
      scheduledEndsAt: new Date('2026-09-15T01:00:00Z'),
      holidayDates: new Set(['2026-09-15']),
    });
    expect(computeTimesheet(lateEvening).holidayMinutes).toBe(120);
  });

  it('leaves holiday and night overlapping rather than summing them', () => {
    // A night shift on a holiday is both, and the bands are recorded
    // separately so a rate card can decide how they combine.
    const holidayNight = shift({
      checkedInAt: new Date('2026-09-14T21:00:00Z'),
      checkedOutAt: new Date('2026-09-14T23:00:00Z'),
      scheduledStartsAt: new Date('2026-09-14T21:00:00Z'),
      scheduledEndsAt: new Date('2026-09-14T23:00:00Z'),
      holidayDates: new Set(['2026-09-14']),
    });
    const totals = computeTimesheet(holidayNight);
    expect(totals.nightMinutes).toBe(120);
    expect(totals.holidayMinutes).toBe(120);
    expect(totals.billableMinutes).toBe(120);
  });
});

describe('overtime', () => {
  it('is time beyond what the request asked for', () => {
    const ranLate = shift({
      checkedOutAt: new Date('2026-09-14T17:00:00Z'), // two hours past
    });
    const totals = computeTimesheet(ranLate);
    expect(totals.billableMinutes).toBe(600);
    expect(totals.overtimeMinutes).toBe(120);
  });

  it('is none when the shift finishes early', () => {
    const leftEarly = shift({ checkedOutAt: new Date('2026-09-14T13:00:00Z') });
    const totals = computeTimesheet(leftEarly);
    expect(totals.billableMinutes).toBe(360);
    expect(totals.overtimeMinutes).toBe(0);
  });

  it('is measured after the break is deducted', () => {
    // Two hours late but an hour of it unpaid break: one hour of overtime.
    const totals = computeTimesheet(
      shift({ checkedOutAt: new Date('2026-09-14T17:00:00Z'), breakMinutes: 60 }),
    );
    expect(totals.overtimeMinutes).toBe(60);
  });
});

describe('the break is deducted proportionally', () => {
  it('takes it from each band rather than from the cheapest', () => {
    // Half the shift is night. An hour of break should cost half an hour of
    // night, not a whole hour of it — nobody recorded which minutes the
    // practitioner rested, so any other rule picks a winner every time.
    const half = shift({
      checkedInAt: new Date('2026-09-14T17:00:00Z'), // 18:00 WAT
      checkedOutAt: new Date('2026-09-14T21:00:00Z'), // 22:00 WAT
      scheduledStartsAt: new Date('2026-09-14T17:00:00Z'),
      scheduledEndsAt: new Date('2026-09-14T21:00:00Z'),
      breakMinutes: 60,
    });

    const totals = computeTimesheet(half);
    expect(totals.workedMinutes).toBe(240);
    expect(totals.billableMinutes).toBe(180);
    // Two of the four hours were night; three quarters of them survive.
    expect(totals.nightMinutes).toBe(90);
  });
});

describe('on-call', () => {
  it('is carried through as supplied and never negative', () => {
    expect(computeTimesheet(shift({ onCallMinutes: 120 })).onCallMinutes).toBe(120);
    expect(computeTimesheet(shift({ onCallMinutes: -5 })).onCallMinutes).toBe(0);
    expect(computeTimesheet(shift()).onCallMinutes).toBe(0);
  });
});

describe('refusals', () => {
  it('refuses a checkout before the check-in', () => {
    expect(() =>
      computeTimesheet(shift({ checkedOutAt: new Date('2026-09-14T06:00:00Z') })),
    ).toThrow(TimesheetError);
  });

  it('refuses a negative break', () => {
    expect(() => computeTimesheet(shift({ breakMinutes: -1 }))).toThrow(/negative/);
  });

  it('refuses a break longer than the shift', () => {
    expect(() => computeTimesheet(shift({ breakMinutes: 600 }))).toThrow(/longer than/);
  });

  it('refuses a recorded shift longer than a day', () => {
    expect(() =>
      computeTimesheet(shift({ checkedOutAt: new Date('2026-09-15T08:00:00Z') })),
    ).toThrow(/24 hours/);
  });
});

describe('the amount', () => {
  it('is integer kobo, rounded once at the end', () => {
    // 25 minutes at 5,000 naira an hour is 2,083.33 naira — 208,333 kobo.
    const short = shift({
      checkedOutAt: new Date('2026-09-14T07:25:00Z'),
      scheduledEndsAt: new Date('2026-09-14T07:25:00Z'),
    });
    const totals = computeTimesheet(short);
    expect(totals.amountKobo).toBe(208_333);
    expect(Number.isInteger(totals.amountKobo)).toBe(true);
  });
});

describe('the exclusive bands', () => {
  // 18:00 WAT Thursday to 02:00 Friday: ordinary until 20:00, night until
  // 06:00. The shape that shows whether a night and a holiday are split
  // exactly or only approximately.
  const overnight = {
    checkedInAt: new Date('2026-09-10T17:00:00Z'),
    checkedOutAt: new Date('2026-09-11T01:00:00Z'),
    scheduledStartsAt: new Date('2026-09-10T17:00:00Z'),
    scheduledEndsAt: new Date('2026-09-11T01:00:00Z'),
  };

  it('splits a holiday that starts part-way through the night exactly', () => {
    const totals = computeTimesheet(shift({ ...overnight, holidayDates: new Set(['2026-09-11']) }));
    // 18-20 ordinary, 20-00 night, 00-02 holiday.
    expect(totals.exclusive).toEqual({ ordinaryMinutes: 120, nightMinutes: 240, holidayMinutes: 120 });
    // The overlapping figures are what a reader sees, and are not the buckets.
    expect(totals.nightMinutes).toBe(360);
    expect(totals.holidayMinutes).toBe(120);
  });

  it('splits a holiday that ends part-way through the night exactly', () => {
    const totals = computeTimesheet(shift({ ...overnight, holidayDates: new Set(['2026-09-10']) }));
    // 18-00 holiday, 00-02 night.
    expect(totals.exclusive).toEqual({ ordinaryMinutes: 0, nightMinutes: 120, holidayMinutes: 360 });
  });

  it('gives a holiday precedence over night, so a minute is paid once', () => {
    const totals = computeTimesheet(
      shift({ ...overnight, holidayDates: new Set(['2026-09-10', '2026-09-11']) }),
    );
    expect(totals.exclusive).toEqual({ ordinaryMinutes: 0, nightMinutes: 0, holidayMinutes: 480 });
  });

  it.each([0, 15, 30, 45, 60])('always adds up to the billable minutes, with a %i minute break', (breakMinutes) => {
    const totals = computeTimesheet(
      shift({ ...overnight, breakMinutes, holidayDates: new Set(['2026-09-11']) }),
    );
    const { ordinaryMinutes, nightMinutes, holidayMinutes } = totals.exclusive;
    expect(ordinaryMinutes + nightMinutes + holidayMinutes).toBe(totals.billableMinutes);
  });
});
