import { computeTimesheet, TimesheetError } from '@/modules/timesheets/domain/hours';
import {
  NO_PREMIUM_BP,
  priceStoredTimesheet,
  type PricedLine,
  type RateCardLike,
} from './pricing';

/**
 * What a shift will come to, worked out before anybody agrees to it (M11-04). Pure, no database.
 *
 * The estimate is the shift as scheduled, run through the *same two functions* that turn a worked
 * shift into money afterwards: `computeTimesheet` splits the hours into ordinary, night and
 * holiday, and `priceStoredTimesheet` prices them against the facility's allowances. It is not a
 * second calculation that resembles the first. A figure shown before acceptance that the invoice
 * later differs from, for a shift worked exactly as scheduled, is the failure this exists to
 * prevent, and a test holds the two to each other across every start time and length.
 *
 * What it leaves out, and says so in words, is what nobody can know in advance: an unpaid break
 * that is taken off, time worked past the scheduled end, and hours on call.
 */

export interface EstimateInput {
  startsAt: Date;
  endsAt: Date;
  hourlyRateKobo: number;
  /** The facility's allowances for the shift's date; par on every band when it has none. */
  terms: RateCardLike;
  /** Public holidays as `YYYY-MM-DD` in WAT. */
  holidayDates: ReadonlySet<string>;
}

export interface ShiftEstimate {
  scheduledMinutes: number;
  hourlyRateKobo: number;
  /** The terms it was priced on, so the words can say what a premium is. */
  terms: RateCardLike;
  lines: PricedLine[];
  /** The hours at the plain hourly rate. */
  baseKobo: number;
  /** What the facility's allowances add on top of that. */
  premiumKobo: number;
  totalKobo: number;
}

/**
 * The estimate, or null for a shift that cannot be priced: one that ends before it starts or runs
 * longer than a day, which is the longest a recorded shift may be. The request screens refuse those
 * anyway; null here means "say nothing" rather than "say nought".
 */
export function estimateShift(input: EstimateInput): ShiftEstimate | null {
  if (!(input.hourlyRateKobo > 0)) return null;

  let totals;
  try {
    totals = computeTimesheet({
      checkedInAt: input.startsAt,
      checkedOutAt: input.endsAt,
      breakMinutes: 0,
      scheduledStartsAt: input.startsAt,
      scheduledEndsAt: input.endsAt,
      hourlyRateKobo: input.hourlyRateKobo,
      holidayDates: input.holidayDates,
    });
  } catch (error) {
    if (error instanceof TimesheetError) return null;
    throw error;
  }

  // The shape a stored timesheet keeps, because that is what billing prices.
  const { priced } = priceStoredTimesheet(
    {
      billableMinutes: totals.billableMinutes,
      nightOnlyMinutes: totals.exclusive.nightMinutes,
      holidayMinutes: totals.holidayMinutes,
      overtimeMinutes: totals.overtimeMinutes,
      onCallMinutes: totals.onCallMinutes,
      hourlyRateKobo: input.hourlyRateKobo,
    },
    input.terms,
  );

  return {
    scheduledMinutes: totals.workedMinutes,
    hourlyRateKobo: input.hourlyRateKobo,
    terms: input.terms,
    lines: priced.lines,
    baseKobo: priced.baseKobo,
    premiumKobo: priced.premiumKobo,
    totalKobo: priced.totalKobo,
  };
}

/** Whole naira without a decimal point; kobo only when there are some. */
export function naira(kobo: number): string {
  const whole = Math.trunc(Math.abs(kobo) / 100);
  const rest = Math.abs(kobo) % 100;
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `₦${grouped}${rest === 0 ? '' : `.${rest.toString().padStart(2, '0')}`}`;
}

/** 480 → "8 hours", 90 → "1 hour 30 minutes", 45 → "45 minutes". */
export function hoursAndMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const h = hours === 0 ? '' : `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  const m = rest === 0 ? '' : `${rest} ${rest === 1 ? 'minute' : 'minutes'}`;
  return [h, m].filter(Boolean).join(' ') || '0 minutes';
}

/** 15000 → "1.5", 20000 → "2", 12500 → "1.25". */
export function times(multiplierBp: number): string {
  return String(Number((multiplierBp / NO_PREMIUM_BP).toFixed(2)));
}

export type EstimateAudience = 'practitioner' | 'facility';

export interface DescribedEstimate {
  totalKobo: number;
  /** One sentence: what it comes to. */
  headline: string;
  /** How it is made up, one line each. */
  lines: string[];
  /** What it leaves out and what will change it. */
  notes: string[];
}

/**
 * The estimate in plain words, for whoever is about to agree to the shift.
 *
 * Says "about" because it is the shift as scheduled; says what is left out; says nothing about
 * fees, because none exist yet and a sentence about what Medilink does or does not take would be
 * a promise nobody has made.
 */
export function describeEstimate(
  estimate: ShiftEstimate,
  options: { audience: EstimateAudience; headcount?: number },
): DescribedEstimate {
  const { terms } = estimate;
  const perHour = naira(estimate.hourlyRateKobo);
  const minutesIn = (band: PricedLine['band']) =>
    estimate.lines.filter((line) => line.band === band).reduce((sum, line) => sum + line.minutes, 0);

  // A band with no premium is paid the plain rate, so to a reader it is just more of the same hours.
  const nightPaysMore = terms.nightMultiplierBp > NO_PREMIUM_BP;
  const holidayPaysMore = terms.holidayMultiplierBp > NO_PREMIUM_BP;
  const night = minutesIn('NIGHT');
  const holiday = minutesIn('HOLIDAY');
  const plain =
    minutesIn('ORDINARY') + (nightPaysMore ? 0 : night) + (holidayPaysMore ? 0 : holiday);

  const lines: string[] = [];
  if (plain > 0) lines.push(`${hoursAndMinutes(plain)} at ${perHour} an hour`);
  if (nightPaysMore && night > 0) {
    lines.push(
      `${hoursAndMinutes(night)} at night, between 8 pm and 6 am, at ${times(terms.nightMultiplierBp)} times the hourly rate`,
    );
  }
  if (holidayPaysMore && holiday > 0) {
    lines.push(
      `${hoursAndMinutes(holiday)} on a public holiday, at ${times(terms.holidayMultiplierBp)} times the hourly rate`,
    );
  }

  const people = Math.max(1, options.headcount ?? 1);
  const notes: string[] = [
    `This is for the hours as scheduled, ${hoursAndMinutes(estimate.scheduledMinutes)} in all.`,
    'If an unpaid break is recorded, those minutes come off the hours.',
    terms.overtimeMultiplierBp > NO_PREMIUM_BP
      ? `Time worked past the scheduled end is added, at ${times(terms.overtimeMultiplierBp)} times the hourly rate.`
      : 'Time worked past the scheduled end is added, at the same hourly rate.',
  ];

  if (options.audience === 'practitioner') {
    return {
      totalKobo: estimate.totalKobo,
      headline: `You would be paid about ${naira(estimate.totalKobo)} for this shift`,
      lines,
      notes,
    };
  }

  notes.push('You are invoiced from the approved timesheet, so what you pay follows the hours actually worked.');
  return {
    totalKobo: estimate.totalKobo * people,
    headline:
      people === 1
        ? `This shift would cost about ${naira(estimate.totalKobo)}`
        : `This shift would cost about ${naira(estimate.totalKobo)} for each person, and about ${naira(estimate.totalKobo * people)} for ${people} people`,
    lines,
    notes,
  };
}
