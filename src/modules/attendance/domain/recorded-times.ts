/**
 * ATT-04: a time a person types into a hand-recording or a correction is one that has
 * happened.
 *
 * It is read off a paper log or remembered, after the fact. A few minutes ahead of the
 * server's clock is somebody's watch running fast, or the minute they were in when they
 * wrote it down; a day ahead is a wrong date, and it would price a shift that has not been
 * worked. The tolerance is the first, and no more.
 */
export const FUTURE_TOLERANCE_MINUTES = 5;

export function isInFuture(at: Date, now: Date = new Date()): boolean {
  return at.getTime() > now.getTime() + FUTURE_TOLERANCE_MINUTES * 60_000;
}

/**
 * TIM-08: a recorded shift is at most a day.
 *
 * The number the timesheet refuses beyond, asked where the times are written instead of
 * after the record exists. Rounded to the minute the same way, so a shift the timesheet
 * would price is never refused here and one it would refuse is never accepted.
 */
export const MAX_SHIFT_MINUTES = 24 * 60;

export function isLongerThanAShift(checkedInAt: Date, checkedOutAt: Date): boolean {
  return Math.round((checkedOutAt.getTime() - checkedInAt.getTime()) / 60_000) > MAX_SHIFT_MINUTES;
}
