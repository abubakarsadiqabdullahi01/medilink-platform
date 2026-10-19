import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma, type Tx } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { HttpError } from '@/lib/http/errors';
import {
  holidayCoverage,
  statutoryHolidays,
  type HolidayCoverage,
} from '../domain/holidays';

/**
 * The public holidays the premium is paid on.
 *
 * Read by every timesheet. A date missing from here is a holiday premium that is
 * not paid and not reported, so the list is kept, audited, and checked for
 * whether it will last (RAT-03).
 */

const OWNER = 'operations-officer';

export const HolidayErrors = {
  exists: () =>
    new HttpError('holiday_exists', 'That holiday is already in the list for that date.', 409),
  notFound: () => new HttpError('holiday_not_found', 'That holiday is not in the list.', 404),
};

export interface HolidayView {
  id: string;
  /** The calendar date as written, YYYY-MM-DD. */
  date: string;
  name: string;
  year: number;
}

function toView(row: { id: string; date: Date; name: string; year: number }): HolidayView {
  // A DATE column comes back as midnight UTC; the day it names is the date as
  // written, not as shifted.
  return { id: row.id, date: row.date.toISOString().slice(0, 10), name: row.name, year: row.year };
}

const midnight = (date: string) => new Date(`${date}T00:00:00.000Z`);

/** One year's holidays in date order, or the whole list. */
export async function listHolidays(year?: number): Promise<HolidayView[]> {
  const rows = await prisma.publicHoliday.findMany({
    where: year === undefined ? {} : { year },
    orderBy: [{ date: 'asc' }, { name: 'asc' }],
  });
  return rows.map(toView);
}

export interface AddHolidayParams {
  date: string;
  name: string;
  actorId: string;
}

/**
 * Adds a holiday: one the Government has declared (Eid, a substitute Monday), or
 * one the computed list does not know about.
 */
export async function addHoliday(input: AddHolidayParams): Promise<HolidayView> {
  const date = midnight(input.date);
  const name = input.name.trim();

  try {
    return await prisma.$transaction(async (tx: Tx) => {
      const created = await tx.publicHoliday.create({
        data: { date, name, year: date.getUTCFullYear(), owner: OWNER },
      });
      await recordAudit(tx, {
        action: 'holiday.added',
        entityType: 'config.public_holidays',
        entityId: created.id,
        actorId: input.actorId,
        scopeType: 'PLATFORM',
        after: { date: input.date, name },
      });
      return toView(created);
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw HolidayErrors.exists();
    }
    throw error;
  }
}

export async function removeHoliday(input: { id: string; actorId: string }): Promise<void> {
  await prisma.$transaction(async (tx: Tx) => {
    const existing = await tx.publicHoliday.findUnique({ where: { id: input.id } });
    if (!existing) throw HolidayErrors.notFound();

    // Conditional on the row still being there, so two people removing the same
    // holiday leave one audit row rather than two.
    const removed = await tx.publicHoliday.deleteMany({ where: { id: input.id } });
    if (removed.count === 0) throw HolidayErrors.notFound();

    await recordAudit(tx, {
      action: 'holiday.removed',
      entityType: 'config.public_holidays',
      entityId: input.id,
      actorId: input.actorId,
      scopeType: 'PLATFORM',
      before: { date: existing.date.toISOString().slice(0, 10), name: existing.name },
    });
  });
}

/** Whether the list covers this year and the next, and what is still to be entered. */
export async function holidayCoverageNow(now: Date = new Date()): Promise<HolidayCoverage> {
  const rows = await listHolidays();
  return holidayCoverage(
    rows.map((row) => ({ date: row.date, name: row.name })),
    now,
  );
}

/**
 * Loads the fixed and computed holidays for these years. Idempotent, and it
 * never overwrites or removes an entry a person made.
 *
 * Takes the client rather than using the application's, because the seed runs in
 * its own process with its own.
 */
export async function loadStatutoryHolidays(
  client: Pick<PrismaClient, 'publicHoliday'>,
  years: number[],
): Promise<void> {
  for (const year of years) {
    for (const holiday of statutoryHolidays(year)) {
      const date = midnight(holiday.date);
      await client.publicHoliday.upsert({
        where: { date_name: { date, name: holiday.name } },
        update: {},
        create: { date, name: holiday.name, year, owner: OWNER },
      });
    }
  }
}

/**
 * The public holidays that fall on or around a stretch of time, as WAT calendar dates
 * (`YYYY-MM-DD`), in one query: what both a worked shift's timesheet and an estimate of a shift
 * not yet worked need to say which of its minutes are holiday minutes. One place, so the two read
 * the same calendar.
 *
 * A day either side is read as well, because a shift that starts late in the evening runs into the
 * next date.
 */
export async function holidayDatesFor(from: Date, to: Date): Promise<Set<string>> {
  const dayMs = 24 * 60 * 60 * 1000;
  const rows = await prisma.publicHoliday.findMany({
    where: { date: { gte: new Date(from.getTime() - dayMs), lte: new Date(to.getTime() + dayMs) } },
    select: { date: true },
  });

  // `date` is a DATE column, so it comes back as midnight UTC; the WAT calendar day it names is
  // the date as written, not as shifted.
  return new Set(rows.map((row) => row.date.toISOString().slice(0, 10)));
}
