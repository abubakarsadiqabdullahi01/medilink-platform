/**
 * Public holidays, and how to tell whether the list will last. Pure, no
 * database.
 *
 * The holiday premium is paid on minutes that fall on a date in this list, so a
 * date that is missing is a premium that silently is not paid: the list used to
 * hold six dates for 2026 and nothing after, and from 27 December 2026 no shift
 * was ever a holiday.
 *
 * **What can be computed, and what cannot.** The six fixed-date holidays are
 * fixed by law, and Good Friday and Easter Monday follow from the date of Easter,
 * which is arithmetic. Those are generated. Eid al-Fitr, Eid al-Adha and the
 * Prophet's birthday follow the lunar calendar and are *declared* by the Federal
 * Government, usually only days before: any date written down now would be a
 * guess that might be a day out, and a guess presented as the law's date is
 * worse than a gap that says it is a gap. They are entered by a person when they
 * are declared, and the coverage report names the ones still to enter.
 *
 * **Nothing here moves a holiday that falls on a weekend.** Whether a Monday is
 * added in that case is the Government's declaration for the year; a substitute
 * day is entered like any other declared one.
 */

export interface HolidayEntry {
  /** A calendar date, YYYY-MM-DD, the date as written and not as shifted. */
  date: string;
  name: string;
}

const pad = (value: number) => String(value).padStart(2, '0');

/** The date of Easter Sunday (Gregorian), by the anonymous Gregorian algorithm. */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** `date` moved by whole days, staying a plain calendar date. */
function addDays(date: string, days: number): string {
  const moved = new Date(`${date}T00:00:00.000Z`);
  moved.setUTCDate(moved.getUTCDate() + days);
  return moved.toISOString().slice(0, 10);
}

/** The holidays a year has by law or by arithmetic, in date order. */
export function statutoryHolidays(year: number): HolidayEntry[] {
  const easter = easterSunday(year);
  return [
    { date: `${year}-01-01`, name: "New Year's Day" },
    { date: addDays(easter, -2), name: 'Good Friday' },
    { date: addDays(easter, 1), name: 'Easter Monday' },
    { date: `${year}-05-01`, name: "Workers' Day" },
    { date: `${year}-06-12`, name: 'Democracy Day' },
    { date: `${year}-10-01`, name: 'Independence Day' },
    { date: `${year}-12-25`, name: 'Christmas Day' },
    { date: `${year}-12-26`, name: 'Boxing Day' },
  ].sort((left, right) => left.date.localeCompare(right.date));
}

/**
 * The holidays that are declared each year. Matched on what people write, which
 * varies ("Eid-el-Fitr", "Eid al-Fitr", "Id el Fitr"); this is advisory, so a
 * name it does not recognise costs a reminder that was not needed, never a
 * wrong figure.
 */
const MOVEABLE: { label: string; pattern: RegExp }[] = [
  { label: 'Eid al-Fitr', pattern: /fitr|ramadan/i },
  { label: 'Eid al-Adha', pattern: /adha|kabir/i },
  { label: "Mawlid (Prophet's birthday)", pattern: /mawlid|maulud|mouloud|moulud|birthday/i },
];

/** The declared holidays none of `names` look like. */
export function missingMoveableHolidays(names: string[]): string[] {
  return MOVEABLE.filter(({ pattern }) => !names.some((name) => pattern.test(name))).map(
    ({ label }) => label,
  );
}

export interface YearCoverage {
  year: number;
  missingStatutory: string[];
  missingMoveable: string[];
}

export interface HolidayCoverage {
  years: YearCoverage[];
  /** A holiday that is fixed or computed is missing for this year or the next. */
  statutoryGap: boolean;
}

/** The year it is in Lagos, which is not always the year it is in UTC. */
function lagosYear(now: Date): number {
  return Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', year: 'numeric' }).format(now),
  );
}

/**
 * Whether the list covers this year and the next, which is as far ahead as a
 * shift can be booked and as far as anybody is reminded. `holidays` is every
 * stored entry; only the dates matter to the year they fall in.
 */
export function holidayCoverage(holidays: HolidayEntry[], now: Date): HolidayCoverage {
  const thisYear = lagosYear(now);
  const years = [thisYear, thisYear + 1].map((year): YearCoverage => {
    const inYear = holidays.filter((entry) => entry.date.startsWith(`${year}-`));
    const have = new Set(inYear.map((entry) => `${entry.date}|${entry.name}`));
    return {
      year,
      missingStatutory: statutoryHolidays(year)
        .filter((entry) => !have.has(`${entry.date}|${entry.name}`))
        .map((entry) => entry.name),
      missingMoveable: missingMoveableHolidays(inYear.map((entry) => entry.name)),
    };
  });
  return { years, statutoryGap: years.some((year) => year.missingStatutory.length > 0) };
}
