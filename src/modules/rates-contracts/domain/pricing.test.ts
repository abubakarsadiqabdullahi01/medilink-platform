import { describe, expect, it } from 'vitest';
import { computeTimesheet } from '@/modules/timesheets/domain/hours';
import {
  DEFAULT_RATE_CARD,
  NO_PREMIUM_BP,
  exclusiveBands,
  lineAmountKobo,
  multiplierProblems,
  priceStoredTimesheet,
  priceTimesheet,
  type PriceableTimesheet,
} from './pricing';

/** ₦5,000 an hour, in kobo. */
const RATE = 500_000;

const eightOrdinaryHours: PriceableTimesheet = {
  ordinaryMinutes: 480,
  nightMinutes: 0,
  holidayMinutes: 0,
  overtimeMinutes: 0,
  onCallMinutes: 0,
  hourlyRateKobo: RATE,
};

describe('the default rate card', () => {
  it('changes nothing', () => {
    // The whole point: until a facility sets a multiplier, the figures are
    // exactly what they were before this module existed.
    const priced = priceTimesheet(eightOrdinaryHours);
    expect(priced.totalKobo).toBe(4_000_000);
    expect(priced.premiumKobo).toBe(0);
    expect(priced.baseKobo).toBe(priced.totalKobo);
  });

  it('is par on every band', () => {
    for (const value of Object.values(DEFAULT_RATE_CARD)) {
      expect(value).toBe(NO_PREMIUM_BP);
    }
  });
});

describe('premiums', () => {
  it('pays a night premium on night minutes only', () => {
    const priced = priceTimesheet(
      { ...eightOrdinaryHours, ordinaryMinutes: 240, nightMinutes: 240 },
      { ...DEFAULT_RATE_CARD, nightMultiplierBp: 15_000 },
    );

    // 4h ordinary at ₦5,000 = ₦20,000; 4h night at ₦7,500 = ₦30,000.
    expect(priced.totalKobo).toBe(2_000_000 + 3_000_000);
    expect(priced.baseKobo).toBe(4_000_000);
    expect(priced.premiumKobo).toBe(1_000_000);
  });

  it('does not compound night and holiday', () => {
    // A minute that is both is in the holiday bucket and nowhere else, so it
    // is paid the holiday rate — never night times holiday.
    const priced = priceTimesheet(
      { ...eightOrdinaryHours, ordinaryMinutes: 0, holidayMinutes: 480 },
      { ...DEFAULT_RATE_CARD, nightMultiplierBp: 15_000, holidayMultiplierBp: 20_000 },
    );

    expect(priced.totalKobo).toBe(8_000_000);
    expect(priced.lines.map((line) => line.band)).toEqual(['HOLIDAY']);
  });

  it('adds overtime on top, but only the part above par', () => {
    // Those minutes are already paid once in their own band; charging the
    // whole overtime multiplier again would pay them twice.
    const priced = priceTimesheet(
      { ...eightOrdinaryHours, ordinaryMinutes: 600, overtimeMinutes: 120 },
      { ...DEFAULT_RATE_CARD, overtimeMultiplierBp: 15_000 },
    );

    // 10h ordinary = ₦50,000, plus 2h of the extra 0.5x = ₦5,000.
    expect(priced.baseKobo).toBe(5_000_000);
    expect(priced.totalKobo).toBe(5_500_000);
  });

  it('adds on-call whole, because it is not in the billable minutes', () => {
    const priced = priceTimesheet(
      { ...eightOrdinaryHours, onCallMinutes: 120 },
      { ...DEFAULT_RATE_CARD, onCallMultiplierBp: NO_PREMIUM_BP },
    );
    expect(priced.totalKobo).toBe(4_000_000 + 1_000_000);
  });

  it('leaves a band off the bill entirely when it has no minutes', () => {
    const priced = priceTimesheet(eightOrdinaryHours, {
      ...DEFAULT_RATE_CARD,
      nightMultiplierBp: 20_000,
    });
    expect(priced.lines.map((line) => line.band)).toEqual(['ORDINARY']);
  });
});

describe('the arithmetic', () => {
  it('is integer kobo throughout', () => {
    const priced = priceTimesheet(
      { ...eightOrdinaryHours, ordinaryMinutes: 437, nightMinutes: 113 },
      { ...DEFAULT_RATE_CARD, nightMultiplierBp: 13_333 },
    );
    for (const line of priced.lines) expect(Number.isInteger(line.amountKobo)).toBe(true);
    expect(Number.isInteger(priced.totalKobo)).toBe(true);
    expect(Number.isInteger(priced.premiumKobo)).toBe(true);
  });

  it('makes the total exactly the sum of its lines', () => {
    // Otherwise an invoice could disagree with the lines printed on it.
    const priced = priceTimesheet(
      {
        ordinaryMinutes: 301,
        nightMinutes: 97,
        holidayMinutes: 53,
        overtimeMinutes: 41,
        onCallMinutes: 29,
        hourlyRateKobo: 333_333,
      },
      {
        nightMultiplierBp: 12_500,
        holidayMultiplierBp: 17_500,
        overtimeMultiplierBp: 15_000,
        onCallMultiplierBp: 10_000,
      },
    );
    const summed = priced.lines.reduce((total, line) => total + line.amountKobo, 0);
    expect(priced.totalKobo).toBe(summed);
  });

  it('never pays less than par', () => {
    // A multiplier cannot be below par, so a priced sheet can never come to
    // less than the rate both parties agreed.
    const priced = priceTimesheet(eightOrdinaryHours, DEFAULT_RATE_CARD);
    expect(priced.totalKobo).toBeGreaterThanOrEqual(priced.baseKobo);
  });

  it('rounds once per line', () => {
    expect(lineAmountKobo(1, 100_001, NO_PREMIUM_BP)).toBe(Math.round(100_001 / 60));
  });
});

describe('what the exclusive bands guarantee', () => {
  it('prices every billable minute exactly once', () => {
    // Built from the real classifier rather than by hand, so this fails if
    // computeTimesheet ever stops splitting the minutes cleanly.
    const totals = computeTimesheet({
      checkedInAt: new Date('2026-09-09T16:00:00.000Z'),
      checkedOutAt: new Date('2026-09-10T04:00:00.000Z'),
      breakMinutes: 60,
      scheduledStartsAt: new Date('2026-09-09T16:00:00.000Z'),
      scheduledEndsAt: new Date('2026-09-10T00:00:00.000Z'),
      hourlyRateKobo: RATE,
      holidayDates: new Set(['2026-09-10']),
    });

    const { ordinaryMinutes, nightMinutes, holidayMinutes } = totals.exclusive;
    expect(ordinaryMinutes + nightMinutes + holidayMinutes).toBe(totals.billableMinutes);

    const priced = priceTimesheet(
      { ...totals.exclusive, overtimeMinutes: 0, onCallMinutes: 0, hourlyRateKobo: RATE },
      DEFAULT_RATE_CARD,
    );
    // At par the priced total must equal what the timesheet already said.
    expect(priced.totalKobo).toBe(totals.amountKobo);
  });
});

describe('multiplierProblems', () => {
  it('accepts par and a plausible premium', () => {
    expect(multiplierProblems(10_000)).toEqual([]);
    expect(multiplierProblems(15_000)).toEqual([]);
  });

  it('refuses a rate cut dressed as an allowance', () => {
    expect(multiplierProblems(9_000)).toContain('below_par');
  });

  it('refuses a misplaced decimal point', () => {
    expect(multiplierProblems(150_000)).toContain('implausibly_high');
  });

  it('refuses a fraction of a basis point', () => {
    expect(multiplierProblems(10_000.5)).toContain('not_an_integer');
  });
});

describe('pricing a stored timesheet', () => {
  const stored = {
    billableMinutes: 480,
    nightOnlyMinutes: 120,
    holidayMinutes: 60,
    overtimeMinutes: 0,
    onCallMinutes: 0,
    hourlyRateKobo: RATE,
  };

  it('splits the minutes without losing or repeating any', () => {
    const bands = exclusiveBands(stored);
    expect(bands).toEqual({ ordinaryMinutes: 300, nightMinutes: 120, holidayMinutes: 60 });
    expect(bands.ordinaryMinutes + bands.nightMinutes + bands.holidayMinutes).toBe(480);
  });

  it('never goes negative when the bands claim more than the shift', () => {
    expect(exclusiveBands({ ...stored, billableMinutes: 100 }).ordinaryMinutes).toBe(0);
  });

  it('prices no more minutes than were billable when the bands claim more than the shift', () => {
    // A row written when the timesheet could round both premium buckets up: 240 holiday and 240
    // night of 479 billable. The holiday is the scarcer, so it keeps its minutes and the night
    // gives up the one that was counted twice.
    const over = { ...stored, billableMinutes: 479, nightOnlyMinutes: 240, holidayMinutes: 240 };
    const bands = exclusiveBands(over);

    expect(bands).toEqual({ ordinaryMinutes: 0, nightMinutes: 239, holidayMinutes: 240 });
    expect(bands.ordinaryMinutes + bands.nightMinutes + bands.holidayMinutes).toBe(479);

    const claimsMore = exclusiveBands({ ...stored, billableMinutes: 100 });
    expect(claimsMore.ordinaryMinutes + claimsMore.nightMinutes + claimsMore.holidayMinutes).toBe(100);
  });

  it('prices the same as pricing the bands by hand', () => {
    const card = { ...DEFAULT_RATE_CARD, nightMultiplierBp: 15_000, holidayMultiplierBp: 20_000 };
    const { bands, priced } = priceStoredTimesheet(stored, card);
    expect(priced).toEqual(
      priceTimesheet({ ...bands, overtimeMinutes: 0, onCallMinutes: 0, hourlyRateKobo: RATE }, card),
    );
    // 5h ordinary, 2h of night at 1.5x, 1h of holiday at 2x, on ₦5,000 an hour.
    expect(priced.totalKobo).toBe(2_500_000 + 1_500_000 + 1_000_000);
    expect(priced.premiumKobo).toBe(priced.totalKobo - 4_000_000);
  });
});
