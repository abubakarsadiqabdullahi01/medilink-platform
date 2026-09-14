import { WAT_OFFSET_MINUTES } from '@/modules/availability/domain/availability';

/**
 * Turning a check-in and a check-out into billable minutes, classified into
 * bands (step 7.4). Pure, no database.
 *
 * Minutes throughout, never hours: an integer avoids the rounding argument
 * entirely, and nobody bills a fraction of a minute. Money is integer kobo,
 * per rule 3.
 *
 * What this deliberately does **not** do is apply an allowance multiplier.
 * That is module 11's job, against a facility's rate card, and it reads the
 * bands recorded here rather than recalculating history.
 *
 * The bands come in two forms. `nightMinutes` and `holidayMinutes` overlap —
 * a night shift on Christmas is in both — which is what a reader wants to
 * see. `exclusive` splits the same minutes into buckets that sum to
 * `billableMinutes` exactly once each, which is what pricing needs: without
 * it a holiday night would be paid a night premium *and* a holiday premium,
 * compounding two rates nobody agreed to.
 */

const MINUTE = 60 * 1000;
const DAY_MINUTES = 24 * 60;

/** Night runs 20:00 to 06:00 WAT — the window the night rate floor is set for. */
export const NIGHT_STARTS_MINUTE = 20 * 60;
export const NIGHT_ENDS_MINUTE = 6 * 60;

export interface WorkedShift {
  checkedInAt: Date;
  checkedOutAt: Date;
  breakMinutes: number;
  /** What the request asked for; overtime is measured against this. */
  scheduledStartsAt: Date;
  scheduledEndsAt: Date;
  hourlyRateKobo: number;
  /**
   * Public-holiday dates as `YYYY-MM-DD` **in WAT**, which is how
   * `config.public_holidays` records them.
   */
  holidayDates: ReadonlySet<string>;
  onCallMinutes?: number;
}

/**
 * The same billable minutes, split so each falls in exactly one bucket.
 *
 * Precedence is holiday, then night, then ordinary — the scarcer the labour,
 * the higher the band, and a minute that is both is the scarcer one. They sum
 * to `billableMinutes`, which is asserted in the unit tests because a pricing
 * function that silently lost or duplicated a minute would be very hard to
 * spot in a total.
 */
export interface ExclusiveBands {
  ordinaryMinutes: number;
  nightMinutes: number;
  holidayMinutes: number;
}

export interface TimesheetTotals {
  workedMinutes: number;
  breakMinutes: number;
  billableMinutes: number;
  nightMinutes: number;
  overtimeMinutes: number;
  holidayMinutes: number;
  onCallMinutes: number;
  amountKobo: number;
  exclusive: ExclusiveBands;
}

export class TimesheetError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'TimesheetError';
  }
}

/** The WAT wall-clock minute of the day, and the WAT calendar date. */
function watParts(at: Date): { minuteOfDay: number; date: string } {
  const shifted = new Date(at.getTime() + WAT_OFFSET_MINUTES * MINUTE);
  return {
    minuteOfDay: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
    date: shifted.toISOString().slice(0, 10),
  };
}

function isNightMinute(minuteOfDay: number): boolean {
  // The window wraps midnight, so it is a union rather than a range.
  return minuteOfDay >= NIGHT_STARTS_MINUTE || minuteOfDay < NIGHT_ENDS_MINUTE;
}

/**
 * Walks the shift a minute at a time.
 *
 * Deliberately not clever. A shift is at most a day, so this is at most 1440
 * iterations, and the arithmetic that would replace it — clipping intervals
 * against a window that wraps midnight, across a date boundary, against a
 * holiday list — is exactly where an off-by-one hides for a year before
 * somebody notices they were underpaid.
 */
function classifyMinutes(
  from: Date,
  to: Date,
  holidayDates: ReadonlySet<string>,
): { total: number; night: number; holiday: number; nightNotHoliday: number } {
  let total = 0;
  let night = 0;
  let holiday = 0;
  // Counted in the same pass: a second walk to work out the overlap would be
  // a second thing that could disagree with the first.
  let nightNotHoliday = 0;

  for (let at = from.getTime(); at < to.getTime(); at += MINUTE) {
    const { minuteOfDay, date } = watParts(new Date(at));
    const isNight = isNightMinute(minuteOfDay);
    const isHoliday = holidayDates.has(date);

    total += 1;
    if (isNight) night += 1;
    if (isHoliday) holiday += 1;
    if (isNight && !isHoliday) nightNotHoliday += 1;
  }

  return { total, night, holiday, nightNotHoliday };
}

export function computeTimesheet(shift: WorkedShift): TimesheetTotals {
  if (shift.checkedOutAt.getTime() <= shift.checkedInAt.getTime()) {
    throw new TimesheetError('checkout_before_checkin', 'A shift must end after it starts.');
  }
  if (shift.breakMinutes < 0) {
    throw new TimesheetError('negative_break', 'Break minutes cannot be negative.');
  }

  const workedMinutes = Math.round(
    (shift.checkedOutAt.getTime() - shift.checkedInAt.getTime()) / MINUTE,
  );

  if (shift.breakMinutes > workedMinutes) {
    throw new TimesheetError(
      'break_longer_than_shift',
      'The break cannot be longer than the shift.',
    );
  }
  if (workedMinutes > DAY_MINUTES) {
    throw new TimesheetError('shift_too_long', 'A recorded shift may not exceed 24 hours.');
  }

  const billableMinutes = workedMinutes - shift.breakMinutes;

  const classified = classifyMinutes(shift.checkedInAt, shift.checkedOutAt, shift.holidayDates);

  /**
   * The break is deducted proportionally from each band rather than from the
   * cheapest one. Which minutes a practitioner actually rested is not
   * recorded, so choosing would be a guess — and any rule that picks
   * systematically picks in one party's favour every single time.
   */
  const scale = classified.total === 0 ? 0 : billableMinutes / classified.total;
  const nightMinutes = Math.round(classified.night * scale);
  const holidayMinutes = Math.round(classified.holiday * scale);

  // Overtime is time beyond what the request asked for, not beyond a daily
  // cap: the facility agreed to a shift of a certain length, and anything
  // past it is time nobody planned.
  const scheduledMinutes = Math.max(
    0,
    Math.round((shift.scheduledEndsAt.getTime() - shift.scheduledStartsAt.getTime()) / MINUTE),
  );
  const overtimeMinutes = Math.max(0, billableMinutes - scheduledMinutes);

  const onCallMinutes = Math.max(0, shift.onCallMinutes ?? 0);

  /**
   * The exclusive split, scaled by the same break deduction and then made to
   * add up exactly. Rounding three numbers independently can lose or gain a
   * minute; ordinary absorbs the remainder because it is the largest bucket
   * in every realistic shift and the cheapest, so any drift favours neither
   * party by more than a minute's ordinary rate.
   */
  const exclusiveHoliday = Math.round(classified.holiday * scale);
  const exclusiveNight = Math.round(classified.nightNotHoliday * scale);
  const exclusive: ExclusiveBands = {
    holidayMinutes: exclusiveHoliday,
    nightMinutes: exclusiveNight,
    ordinaryMinutes: Math.max(0, billableMinutes - exclusiveHoliday - exclusiveNight),
  };

  // Integer kobo. Rounded once, at the end, so the stored amount is exactly
  // what a ledger entry will carry.
  const amountKobo = Math.round((billableMinutes * shift.hourlyRateKobo) / 60);

  return {
    workedMinutes,
    breakMinutes: shift.breakMinutes,
    billableMinutes,
    nightMinutes,
    overtimeMinutes,
    holidayMinutes,
    onCallMinutes,
    amountKobo,
    exclusive,
  };
}

/** The WAT calendar date of an instant, for matching against the holiday list. */
export function watDateOf(at: Date): string {
  return watParts(at).date;
}
