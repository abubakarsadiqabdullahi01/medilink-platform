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
 * Night, weekend and overtime rates are module 10, which is Stage 8, and the
 * revenue decision behind them (step 3.1) has not been taken. The bands are
 * recorded so that when the rate card exists it is a lookup, not a
 * recalculation of history.
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

export interface TimesheetTotals {
  workedMinutes: number;
  breakMinutes: number;
  billableMinutes: number;
  nightMinutes: number;
  overtimeMinutes: number;
  holidayMinutes: number;
  onCallMinutes: number;
  amountKobo: number;
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
): { total: number; night: number; holiday: number } {
  let total = 0;
  let night = 0;
  let holiday = 0;

  for (let at = from.getTime(); at < to.getTime(); at += MINUTE) {
    const { minuteOfDay, date } = watParts(new Date(at));
    total += 1;
    if (isNightMinute(minuteOfDay)) night += 1;
    if (holidayDates.has(date)) holiday += 1;
  }

  return { total, night, holiday };
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
  };
}

/** The WAT calendar date of an instant, for matching against the holiday list. */
export function watDateOf(at: Date): string {
  return watParts(at).date;
}
