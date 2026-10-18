// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { computeTimesheet } from '@/modules/timesheets/domain/hours';
import { DEFAULT_RATE_CARD, priceStoredTimesheet, type RateCardLike } from './pricing';
import { describeEstimate, estimateShift, hoursAndMinutes, naira, times } from './estimate';

/**
 * M11-04: what a shift comes to, said to both sides before either agrees.
 *
 * The first thing held here is that the figure is the one billing would arrive at. The second is
 * that the words say only what is true: "about", what is left out, and nothing about fees.
 */

const RATE = 500_000; // ₦5,000 an hour, in kobo.
const NONE = new Set<string>();

/** A WAT wall-clock time on a date, as an instant (WAT is UTC+1 all year). */
const wat = (date: string, time: string) => new Date(`${date}T${time}:00+01:00`);

const CARD: RateCardLike = {
  nightMultiplierBp: 15_000,
  holidayMultiplierBp: 20_000,
  overtimeMultiplierBp: 15_000,
  onCallMultiplierBp: 5_000,
};

const estimate = (startsAt: Date, endsAt: Date, over: Partial<Parameters<typeof estimateShift>[0]> = {}) =>
  estimateShift({ startsAt, endsAt, hourlyRateKobo: RATE, terms: DEFAULT_RATE_CARD, holidayDates: NONE, ...over });

describe('what a shift comes to', () => {
  it('is the hours at the hourly rate when the facility has no allowances', () => {
    const result = estimate(wat('2026-10-14', '08:00'), wat('2026-10-14', '16:00'))!;
    expect(result.scheduledMinutes).toBe(480);
    expect(result.totalKobo).toBe(4_000_000);
    expect(result.premiumKobo).toBe(0);
    expect(result.lines).toEqual([{ band: 'ORDINARY', minutes: 480, multiplierBp: 10_000, amountKobo: 4_000_000 }]);
  });

  it('pays the night allowance on the hours between 8 pm and 6 am, and no more', () => {
    // 14:00 to 22:00: six ordinary hours and two at night.
    const result = estimate(wat('2026-10-14', '14:00'), wat('2026-10-14', '22:00'), { terms: CARD })!;
    expect(result.lines).toEqual([
      { band: 'ORDINARY', minutes: 360, multiplierBp: 10_000, amountKobo: 3_000_000 },
      { band: 'NIGHT', minutes: 120, multiplierBp: 15_000, amountKobo: 1_500_000 },
    ]);
    expect(result.totalKobo).toBe(4_500_000);
    expect(result.baseKobo).toBe(4_000_000);
    expect(result.premiumKobo).toBe(500_000);
  });

  it('prices a whole night shift across midnight', () => {
    const result = estimate(wat('2026-10-14', '20:00'), wat('2026-10-15', '06:00'), { terms: CARD })!;
    expect(result.scheduledMinutes).toBe(600);
    expect(result.lines).toEqual([{ band: 'NIGHT', minutes: 600, multiplierBp: 15_000, amountKobo: 7_500_000 }]);
  });

  it('pays the holiday allowance on a public holiday, and does not stack it on the night one', () => {
    // A night shift that falls wholly on a holiday is paid the holiday rate, not night times holiday.
    const result = estimate(wat('2026-10-01', '20:00'), wat('2026-10-02', '00:00'), {
      terms: CARD,
      holidayDates: new Set(['2026-10-01']),
    })!;
    expect(result.lines).toEqual([{ band: 'HOLIDAY', minutes: 240, multiplierBp: 20_000, amountKobo: 4_000_000 }]);
  });

  it('is null for a shift that ends before it starts, runs over a day, or has no rate', () => {
    expect(estimate(wat('2026-10-14', '16:00'), wat('2026-10-14', '08:00'))).toBeNull();
    expect(estimate(wat('2026-10-14', '08:00'), wat('2026-10-15', '08:01'))).toBeNull();
    expect(estimate(wat('2026-10-14', '08:00'), wat('2026-10-14', '16:00'), { hourlyRateKobo: 0 })).toBeNull();
  });

  it('is the figure billing arrives at for a shift worked exactly as scheduled, at every start time and length', () => {
    // Not a second calculation that resembles the first: the timesheet's own bands, priced by the
    // function that prices every stored timesheet. A change to either that the estimate did not
    // follow would show here as a difference between what is shown and what is charged.
    const cards: RateCardLike[] = [DEFAULT_RATE_CARD, CARD, { ...CARD, nightMultiplierBp: 12_500, holidayMultiplierBp: 30_000 }];
    const holidaySets = [NONE, new Set(['2026-10-14']), new Set(['2026-10-15']), new Set(['2026-10-14', '2026-10-15'])];
    let checked = 0;

    for (const card of cards) {
      for (const holidays of holidaySets) {
        for (let hour = 0; hour < 24; hour += 1) {
          for (const minutes of [30, 90, 240, 480, 600, 720, 1_440]) {
            const startsAt = new Date(wat('2026-10-14', '00:00').getTime() + hour * 3_600_000 + 17 * 60_000);
            const endsAt = new Date(startsAt.getTime() + minutes * 60_000);

            const shown = estimate(startsAt, endsAt, { terms: card, holidayDates: holidays })!;

            const worked = computeTimesheet({
              checkedInAt: startsAt,
              checkedOutAt: endsAt,
              breakMinutes: 0,
              scheduledStartsAt: startsAt,
              scheduledEndsAt: endsAt,
              hourlyRateKobo: RATE,
              holidayDates: holidays,
            });
            const charged = priceStoredTimesheet(
              {
                billableMinutes: worked.billableMinutes,
                nightOnlyMinutes: worked.exclusive.nightMinutes,
                holidayMinutes: worked.holidayMinutes,
                overtimeMinutes: worked.overtimeMinutes,
                onCallMinutes: worked.onCallMinutes,
                hourlyRateKobo: RATE,
              },
              card,
            );

            expect(shown.totalKobo, `${startsAt.toISOString()} for ${minutes} minutes`).toBe(charged.priced.totalKobo);
            expect(shown.lines.reduce((sum, line) => sum + line.minutes, 0)).toBe(minutes);
            checked += 1;
          }
        }
      }
    }
    expect(checked).toBe(3 * 4 * 24 * 7);
  });
});

describe('the figures in words', () => {
  it('writes naira without a decimal point unless there are kobo', () => {
    expect(naira(4_000_000)).toBe('₦40,000');
    expect(naira(500_000)).toBe('₦5,000');
    expect(naira(4_000_050)).toBe('₦40,000.50');
    expect(naira(100)).toBe('₦1');
    expect(naira(5)).toBe('₦0.05');
    expect(naira(123_456_700)).toBe('₦1,234,567');
  });

  it('writes hours and minutes the way a person says them', () => {
    expect(hoursAndMinutes(480)).toBe('8 hours');
    expect(hoursAndMinutes(60)).toBe('1 hour');
    expect(hoursAndMinutes(90)).toBe('1 hour 30 minutes');
    expect(hoursAndMinutes(45)).toBe('45 minutes');
    expect(hoursAndMinutes(1)).toBe('1 minute');
  });

  it('writes a multiplier without trailing zeros', () => {
    expect(times(15_000)).toBe('1.5');
    expect(times(20_000)).toBe('2');
    expect(times(12_500)).toBe('1.25');
  });
});

describe('what the practitioner is told before accepting', () => {
  it('says what they would be paid, about, for the hours as scheduled', () => {
    const words = describeEstimate(estimate(wat('2026-10-14', '08:00'), wat('2026-10-14', '16:00'))!, {
      audience: 'practitioner',
    });
    expect(words.headline).toBe('You would be paid about ₦40,000 for this shift');
    expect(words.totalKobo).toBe(4_000_000);
    expect(words.lines).toEqual(['8 hours at ₦5,000 an hour']);
  });

  it('says what is left out: a break comes off, and time past the end is added', () => {
    const { notes } = describeEstimate(estimate(wat('2026-10-14', '08:00'), wat('2026-10-14', '16:00'))!, {
      audience: 'practitioner',
    });
    expect(notes.join(' ')).toMatch(/as scheduled, 8 hours in all/);
    expect(notes.join(' ')).toMatch(/unpaid break/);
    expect(notes.join(' ')).toMatch(/past the scheduled end is added, at the same hourly rate/);
  });

  it('names the night and holiday allowances and says how many hours each covers', () => {
    const words = describeEstimate(
      estimate(wat('2026-10-01', '14:00'), wat('2026-10-02', '02:00'), { terms: CARD, holidayDates: new Set(['2026-10-01']) })!,
      { audience: 'practitioner' },
    );
    // 14:00 on the holiday to 02:00 the next morning: ten hours on the holiday, and the two after
    // midnight at night, since the holiday has ended.
    expect(words.lines).toEqual([
      '2 hours at night, between 8 pm and 6 am, at 1.5 times the hourly rate',
      '10 hours on a public holiday, at 2 times the hourly rate',
    ]);
    expect(words.headline).toMatch(/^You would be paid about ₦/);
  });

  it('counts a band with no allowance as ordinary hours rather than listing it on its own', () => {
    const words = describeEstimate(estimate(wat('2026-10-14', '14:00'), wat('2026-10-14', '22:00'))!, {
      audience: 'practitioner',
    });
    expect(words.lines).toEqual(['8 hours at ₦5,000 an hour']);
  });

  it('says the overtime allowance when the facility has one', () => {
    const { notes } = describeEstimate(estimate(wat('2026-10-14', '08:00'), wat('2026-10-14', '16:00'), { terms: CARD })!, {
      audience: 'practitioner',
    });
    expect(notes.join(' ')).toMatch(/past the scheduled end is added, at 1.5 times the hourly rate/);
  });

  it('says nothing about fees, deductions or what Medilink takes: none has been decided', () => {
    const words = describeEstimate(estimate(wat('2026-10-14', '08:00'), wat('2026-10-14', '16:00'), { terms: CARD })!, {
      audience: 'practitioner',
    });
    const everything = [words.headline, ...words.lines, ...words.notes].join(' ');
    expect(everything).not.toMatch(/fee|commission|deduct|tax|take-home|take home|guarantee|Medilink takes/i);
  });
});

describe('what the facility is told before it confirms', () => {
  const shift = () => estimate(wat('2026-10-14', '08:00'), wat('2026-10-14', '16:00'))!;

  it('says what one person costs', () => {
    const words = describeEstimate(shift(), { audience: 'facility', headcount: 1 });
    expect(words.headline).toBe('This shift would cost about ₦40,000');
    expect(words.totalKobo).toBe(4_000_000);
  });

  it('says what each costs and what all of them cost when more than one is needed', () => {
    const words = describeEstimate(shift(), { audience: 'facility', headcount: 3 });
    expect(words.headline).toBe(
      'This shift would cost about ₦40,000 for each person, and about ₦120,000 for 3 people',
    );
    expect(words.totalKobo).toBe(12_000_000);
  });

  it('says the invoice follows the hours actually worked', () => {
    const { notes } = describeEstimate(shift(), { audience: 'facility', headcount: 1 });
    expect(notes.join(' ')).toMatch(/invoiced from the approved timesheet/);
    expect(notes.join(' ')).toMatch(/unpaid break/);
  });

  it('is not the practitioner’s sentence, and the practitioner is not told what the facility is', () => {
    const forFacility = describeEstimate(shift(), { audience: 'facility' });
    const forPractitioner = describeEstimate(shift(), { audience: 'practitioner' });
    expect(forFacility.headline).not.toMatch(/you would be paid/i);
    expect(forPractitioner.notes.join(' ')).not.toMatch(/invoiced/i);
  });
});
