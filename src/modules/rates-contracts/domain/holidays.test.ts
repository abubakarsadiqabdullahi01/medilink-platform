import { describe, expect, it } from 'vitest';
import {
  easterSunday,
  holidayCoverage,
  missingMoveableHolidays,
  statutoryHolidays,
} from './holidays';

describe('Easter', () => {
  // Dates published in the Gregorian calendar tables, not derived from the same formula.
  it.each([
    [2025, '2025-04-20'],
    [2026, '2026-04-05'],
    [2027, '2027-03-28'],
    [2028, '2028-04-16'],
    [2029, '2029-04-01'],
    [2030, '2030-04-21'],
  ])('falls on the right day in %i', (year, expected) => {
    expect(easterSunday(year)).toBe(expected);
  });
});

describe('the statutory holidays of a year', () => {
  it('are the six fixed dates plus Good Friday and Easter Monday', () => {
    const names = statutoryHolidays(2027).map((entry) => entry.name);
    expect(names).toEqual([
      "New Year's Day",
      'Good Friday',
      'Easter Monday',
      "Workers' Day",
      'Democracy Day',
      'Independence Day',
      'Christmas Day',
      'Boxing Day',
    ]);
  });

  it('put Good Friday two days before Easter and Easter Monday the day after', () => {
    const byName = new Map(statutoryHolidays(2026).map((entry) => [entry.name, entry.date]));
    expect(byName.get('Good Friday')).toBe('2026-04-03');
    expect(byName.get('Easter Monday')).toBe('2026-04-06');
  });

  it('carry the same dates the demo seed already had for 2026', () => {
    const byName = new Map(statutoryHolidays(2026).map((entry) => [entry.name, entry.date]));
    expect(byName.get("New Year's Day")).toBe('2026-01-01');
    expect(byName.get("Workers' Day")).toBe('2026-05-01');
    expect(byName.get('Democracy Day')).toBe('2026-06-12');
    expect(byName.get('Independence Day')).toBe('2026-10-01');
    expect(byName.get('Christmas Day')).toBe('2026-12-25');
    expect(byName.get('Boxing Day')).toBe('2026-12-26');
  });

  it('are in date order', () => {
    const dates = statutoryHolidays(2028).map((entry) => entry.date);
    expect([...dates].sort()).toEqual(dates);
  });

  it('cross a month end correctly when Easter is late in March', () => {
    // Easter 2027 is 28 March, so Easter Monday is 29 March, Good Friday 26 March.
    const byName = new Map(statutoryHolidays(2027).map((entry) => [entry.name, entry.date]));
    expect(byName.get('Good Friday')).toBe('2027-03-26');
    expect(byName.get('Easter Monday')).toBe('2027-03-29');
  });

  it('cross a month end correctly when Easter is at the start of April', () => {
    // Easter 2029 is 1 April: Good Friday is 30 March.
    const byName = new Map(statutoryHolidays(2029).map((entry) => [entry.name, entry.date]));
    expect(byName.get('Good Friday')).toBe('2029-03-30');
    expect(byName.get('Easter Monday')).toBe('2029-04-02');
  });
});

describe('the declared holidays that cannot be known in advance', () => {
  it('are all missing from an empty list', () => {
    expect(missingMoveableHolidays([])).toEqual([
      'Eid al-Fitr',
      'Eid al-Adha',
      "Mawlid (Prophet's birthday)",
    ]);
  });

  it('recognise the names people actually write', () => {
    expect(
      missingMoveableHolidays(['Eid-el-Fitr', 'Eid-el-Kabir (Sallah)', 'Id el Maulud']),
    ).toEqual([]);
    expect(missingMoveableHolidays(['Eid al-Fitr Holiday'])).toEqual([
      'Eid al-Adha',
      "Mawlid (Prophet's birthday)",
    ]);
  });

  it('are not confused with the second day of a festival', () => {
    expect(missingMoveableHolidays(['Eid al-Fitr', 'Eid al-Fitr (second day)'])).toEqual([
      'Eid al-Adha',
      "Mawlid (Prophet's birthday)",
    ]);
  });
});

describe('whether the list will last', () => {
  const stored = (year: number) =>
    statutoryHolidays(year).map((entry) => ({ date: entry.date, name: entry.name }));

  it('is fine when this year and next are loaded', () => {
    const report = holidayCoverage([...stored(2026), ...stored(2027)], new Date('2026-10-13T10:00:00Z'));
    expect(report.years.map((year) => year.year)).toEqual([2026, 2027]);
    expect(report.years.every((year) => year.missingStatutory.length === 0)).toBe(true);
    expect(report.statutoryGap).toBe(false);
  });

  it('flags next year when nothing has been loaded for it', () => {
    const report = holidayCoverage(stored(2026), new Date('2026-10-13T10:00:00Z'));
    const next = report.years.find((year) => year.year === 2027)!;
    expect(next.missingStatutory).toHaveLength(8);
    expect(report.statutoryGap).toBe(true);
  });

  it('flags a single missing holiday by name', () => {
    const rows = stored(2027).filter((entry) => entry.name !== 'Good Friday');
    const report = holidayCoverage([...stored(2026), ...rows], new Date('2026-10-13T10:00:00Z'));
    expect(report.years.find((year) => year.year === 2027)!.missingStatutory).toEqual([
      'Good Friday',
    ]);
  });

  it('reads the year in Lagos, not UTC, at New Year', () => {
    // 23:30 UTC on 31 December is already 1 January in Lagos.
    const report = holidayCoverage(stored(2027), new Date('2026-12-31T23:30:00Z'));
    expect(report.years.map((year) => year.year)).toEqual([2027, 2028]);
  });

  it('lists the declared holidays still to be entered for each year', () => {
    const rows = [...stored(2026), { date: '2026-03-20', name: 'Eid al-Fitr' }];
    const report = holidayCoverage(rows, new Date('2026-10-13T10:00:00Z'));
    expect(report.years.find((year) => year.year === 2026)!.missingMoveable).toEqual([
      'Eid al-Adha',
      "Mawlid (Prophet's birthday)",
    ]);
  });
});
