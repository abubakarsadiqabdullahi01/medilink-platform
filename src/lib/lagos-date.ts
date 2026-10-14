/**
 * Calendar dates in Nigeria. Pure, and safe to import from the browser.
 *
 * Nigeria is UTC+1 all year with no daylight saving, so a fixed offset is
 * honest here and a timezone library would be ceremony. A date a person writes
 * ("my licence expires 31 March") is a Lagos date, and the instant it ends is
 * midnight in Lagos, not in UTC and not in whatever zone a server or a phone is
 * set to.
 */

export const LAGOS_OFFSET_MINUTES = 60;

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

/** The Lagos calendar day containing this instant, as `YYYY-MM-DD`. */
export function lagosDate(at: Date): string {
  return new Date(at.getTime() + LAGOS_OFFSET_MINUTES * MINUTE).toISOString().slice(0, 10);
}

/** Whether this is a real date written `YYYY-MM-DD`. "2027-02-30" is not one. */
export function isDateOnly(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const utc = new Date(Date.UTC(year, month - 1, day));
  // Date.UTC rolls 2027-02-30 into March; a rolled date was a typo.
  return utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day;
}

/** The instant of midnight in Lagos at the start of a `YYYY-MM-DD` date. */
export function startOfLagosDay(date: string): Date {
  if (!isDateOnly(date)) throw new Error(`"${date}" is not a real date written year-month-day.`);
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day) - LAGOS_OFFSET_MINUTES * MINUTE);
}

/** The instant a `YYYY-MM-DD` date ends in Lagos: midnight at the start of the next one. */
export function endOfLagosDay(date: string): Date {
  return new Date(startOfLagosDay(date).getTime() + DAY);
}

/**
 * What a `datetime-local` input holds (`YYYY-MM-DDTHH:mm`, optionally with
 * seconds) as the instant it names in Lagos.
 *
 * `new Date("2026-10-20T20:00")` reads it in the device's own zone, so a phone set
 * to the wrong one, or a laptop on a different continent, sent a shift or an
 * hours correction an hour or more out and said nothing. Everybody who uses this
 * product is working to Lagos time, so that is what a typed time means.
 */
export function lagosLocalToInstant(value: string): Date {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  const hours = match ? Number(match[2]) : NaN;
  const minutes = match ? Number(match[3]) : NaN;
  const seconds = match?.[4] ? Number(match[4]) : 0;
  if (!match || !isDateOnly(match[1]!) || hours > 23 || minutes > 59 || seconds > 59) {
    throw new Error(`"${value}" is not a date and time like 2026-10-20T20:00.`);
  }
  return new Date(
    startOfLagosDay(match[1]!).getTime() + ((hours * 60 + minutes) * 60 + seconds) * 1000,
  );
}

/** An instant as a `datetime-local` input wants it, in Lagos. */
export function instantToLagosLocal(date: Date): string {
  return new Date(date.getTime() + LAGOS_OFFSET_MINUTES * MINUTE).toISOString().slice(0, 16);
}
