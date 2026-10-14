import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { HttpError } from '@/lib/http/errors';
import { ANY_LEVEL, ANY_SPECIALTY, floorProblem, type FloorProblem } from '@/modules/service-requests/domain/rate-floor';

/**
 * The minimum hourly rate a shift may be published at, per profession and shift
 * type (RAT-01, and the mechanism half of CFG-02).
 *
 * A profession with none cannot have a shift published, so a floor that nobody
 * can set would be a profession that can never be staffed. These are the people
 * who own the numbers setting them without SQL. What the numbers should be is a
 * decision for Medilink and the regulators; nothing here proposes one.
 *
 * Floors are versioned by date and never edited or deleted: a newer one takes
 * over from its date, and an older one still explains a shift priced under it.
 */

const OWNER = 'super-administrator';

const MESSAGES: Record<FloorProblem, string> = {
  amount: 'Enter a whole number of kobo an hour, above zero.',
  date: 'Enter the date it starts, as year-month-day.',
  past: 'A floor cannot start in the past: it would change what shifts already published were held to. Set it from today, or later.',
};

export const RateFloorErrors = {
  invalid: (problem: FloorProblem) => new HttpError('rate_floor_invalid', MESSAGES[problem], 422),
  categoryNotFound: () =>
    new HttpError('category_not_found', 'There is no such profession.', 404),
  levelInvalid: () =>
    new HttpError(
      'level_invalid',
      'That is not a level of that profession. Leave it blank for every level.',
      422,
    ),
  specialtyInvalid: () =>
    new HttpError(
      'specialty_invalid',
      'That specialty does not belong to that profession. Leave it blank for every specialty.',
      422,
    ),
  exists: () =>
    new HttpError(
      'rate_floor_exists',
      'A floor is already set for that profession, specialty, level and shift type from that date. Choose a later date to change it.',
      409,
    ),
};

export interface RateFloorView {
  id: string;
  categoryKey: string;
  specialtyKey: string;
  /** `*` for every level. */
  cadreLevelKey: string;
  shiftType: string;
  minHourlyKobo: number;
  /** `YYYY-MM-DD`. */
  effectiveFrom: string;
}

export interface MissingFloor {
  categoryKey: string;
  categoryName: string;
  shiftType: 'day' | 'night';
}

export interface RateFloorOverview {
  floors: RateFloorView[];
  /** Every profession and shift type with no all-specialty floor in force today. */
  missing: MissingFloor[];
  categories: {
    key: string;
    name: string;
    specialties: { key: string; name: string }[];
    levels: { key: string; name: string }[];
  }[];
}

const toView = (row: {
  id: string;
  categoryKey: string;
  specialtyKey: string;
  cadreLevelKey: string;
  shiftType: string;
  minHourlyKobo: number;
  effectiveFrom: Date;
}): RateFloorView => ({
  id: row.id,
  categoryKey: row.categoryKey,
  specialtyKey: row.specialtyKey,
  cadreLevelKey: row.cadreLevelKey,
  shiftType: row.shiftType,
  minHourlyKobo: row.minHourlyKobo,
  effectiveFrom: row.effectiveFrom.toISOString().slice(0, 10),
});

export async function rateFloorOverview(now: Date = new Date()): Promise<RateFloorOverview> {
  const [floors, categories] = await Promise.all([
    prisma.rateFloor.findMany({
      orderBy: [
        { categoryKey: 'asc' },
        { shiftType: 'asc' },
        { specialtyKey: 'asc' },
        { cadreLevelKey: 'asc' },
        { effectiveFrom: 'desc' },
      ],
    }),
    prisma.professionalCategory.findMany({
      orderBy: { name: 'asc' },
      select: { key: true, name: true },
    }),
  ]);
  const [specialties, levels] = await Promise.all([
    prisma.specialty.findMany({
      orderBy: { name: 'asc' },
      select: { key: true, name: true, category: { select: { key: true } } },
    }),
    prisma.cadreLevel.findMany({
      where: { isActive: true },
      orderBy: [{ professionalCategoryId: 'asc' }, { rank: 'asc' }],
      select: { key: true, name: true, category: { select: { key: true } } },
    }),
  ]);

  // "In force" is by the shift's own date, so for the gap that matters today it is
  // whatever started on or before now.
  const inForce = (categoryKey: string, shiftType: string) =>
    floors.some(
      (floor) =>
        floor.categoryKey === categoryKey &&
        floor.shiftType === shiftType &&
        floor.specialtyKey === ANY_SPECIALTY &&
        floor.cadreLevelKey === ANY_LEVEL &&
        floor.effectiveFrom.getTime() <= now.getTime(),
    );

  const missing: MissingFloor[] = [];
  for (const category of categories) {
    for (const shiftType of ['day', 'night'] as const) {
      if (!inForce(category.key, shiftType)) {
        missing.push({ categoryKey: category.key, categoryName: category.name, shiftType });
      }
    }
  }

  return {
    floors: floors.map(toView),
    missing,
    categories: categories.map((category) => ({
      ...category,
      specialties: specialties
        .filter((specialty) => specialty.category.key === category.key)
        .map(({ key, name }) => ({ key, name })),
      levels: levels
        .filter((level) => level.category.key === category.key)
        .map(({ key, name }) => ({ key, name })),
    })),
  };
}

export async function setRateFloor(input: {
  categoryKey: string;
  specialtyKey?: string;
  /** A level of the profession, or left out for every level (REQ-01). */
  cadreLevelKey?: string;
  shiftType: 'day' | 'night';
  minHourlyKobo: number;
  effectiveFrom: string;
  actorId: string;
  now?: Date;
}): Promise<RateFloorView> {
  const problem = floorProblem(
    { minHourlyKobo: input.minHourlyKobo, effectiveFrom: input.effectiveFrom },
    input.now ?? new Date(),
  );
  if (problem) throw RateFloorErrors.invalid(problem);

  const category = await prisma.professionalCategory.findUnique({
    where: { key: input.categoryKey },
    select: { key: true },
  });
  if (!category) throw RateFloorErrors.categoryNotFound();

  const specialtyKey = input.specialtyKey ?? ANY_SPECIALTY;
  if (specialtyKey !== ANY_SPECIALTY) {
    const specialty = await prisma.specialty.findUnique({
      where: { key: specialtyKey },
      select: { category: { select: { key: true } } },
    });
    if (!specialty || specialty.category.key !== category.key) throw RateFloorErrors.specialtyInvalid();
  }

  const cadreLevelKey = input.cadreLevelKey ?? ANY_LEVEL;
  if (cadreLevelKey !== ANY_LEVEL) {
    const level = await prisma.cadreLevel.findUnique({
      where: { key: cadreLevelKey },
      select: { isActive: true, category: { select: { key: true } } },
    });
    if (!level || !level.isActive || level.category.key !== category.key) throw RateFloorErrors.levelInvalid();
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const created = await tx.rateFloor.create({
        data: {
          categoryKey: category.key,
          specialtyKey,
          cadreLevelKey,
          shiftType: input.shiftType,
          minHourlyKobo: input.minHourlyKobo,
          effectiveFrom: new Date(`${input.effectiveFrom}T00:00:00.000Z`),
          owner: OWNER,
        },
      });

      await recordAudit(tx, {
        action: 'rate_floor.set',
        entityType: 'config.rate_floors',
        entityId: created.id,
        actorId: input.actorId,
        scopeType: 'PLATFORM',
        after: toView(created),
      });

      return toView(created);
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw RateFloorErrors.exists();
    }
    throw error;
  }
}
