import { isDateOnly, lagosDate } from '@/lib/lagos-date';

/**
 * Rate floors: pure, no database.
 *
 * Step 6.1's whole verification is "publish at one kobo below the floor,
 * assert refusal", so the rule that decides which floor applies is worth
 * having on its own, with the awkward cases named.
 */

/** The sentinel in config.rate_floors meaning "any specialty in this category". */
export const ANY_SPECIALTY = '*';

/** The same, for the level: a floor that names none holds for every level. */
export const ANY_LEVEL = '*';

export interface RateFloorLike {
  categoryKey: string;
  specialtyKey: string;
  /** Left out, or `*`, for every level (REQ-01). */
  cadreLevelKey?: string;
  shiftType: string;
  minHourlyKobo: number;
  effectiveFrom: Date;
}

export interface FloorQuery {
  categoryKey: string;
  /** Null when the request names no specialty. */
  specialtyKey: string | null;
  /** Null when the request names no level. */
  cadreLevelKey?: string | null;
  shiftType: 'DAY' | 'NIGHT';
  /** The shift's own start, not now: a floor that changes next month does not
   * govern a shift being priced for next week. */
  at: Date;
}

/**
 * The floor that governs this request, or null when none is published for it.
 *
 * Three rules decide between candidates, in order:
 *
 * 1. A floor naming the request's level beats one that names none. A registrar and
 *    a house officer are not paid alike, so a floor for one must never be read as
 *    the other's, and a level with its own floor is not held to the general one.
 * 2. A floor naming the request's specialty beats the category-wide `*`.
 *    Anaesthesia having its own floor is the reason the column exists, and
 *    falling back to the category rate would quietly underpay it.
 * 3. Among equally specific floors, the latest `effectiveFrom` at or before
 *    the shift wins. Floors are versioned by date rather than replaced, so a
 *    shift priced today under last year's floor can still be explained.
 *
 * A floor for a level the request does not name never applies to it.
 */
export function resolveRateFloor(
  floors: RateFloorLike[],
  query: FloorQuery,
): RateFloorLike | null {
  // config.rate_floors stores 'day' and 'night'; the enum is uppercase.
  const shiftType = query.shiftType.toLowerCase();

  const applicable = floors.filter(
    (floor) =>
      floor.categoryKey === query.categoryKey &&
      floor.shiftType === shiftType &&
      floor.effectiveFrom.getTime() <= query.at.getTime() &&
      (floor.specialtyKey === ANY_SPECIALTY ||
        (query.specialtyKey !== null && floor.specialtyKey === query.specialtyKey)) &&
      ((floor.cadreLevelKey ?? ANY_LEVEL) === ANY_LEVEL ||
        (typeof query.cadreLevelKey === 'string' && floor.cadreLevelKey === query.cadreLevelKey)),
  );

  if (applicable.length === 0) return null;

  return applicable.reduce((best, candidate) => {
    const bestLevel = (best.cadreLevelKey ?? ANY_LEVEL) !== ANY_LEVEL;
    const candidateLevel = (candidate.cadreLevelKey ?? ANY_LEVEL) !== ANY_LEVEL;
    if (candidateLevel !== bestLevel) return candidateLevel ? candidate : best;

    const bestIsSpecific = best.specialtyKey !== ANY_SPECIALTY;
    const candidateIsSpecific = candidate.specialtyKey !== ANY_SPECIALTY;
    if (candidateIsSpecific !== bestIsSpecific) return candidateIsSpecific ? candidate : best;

    return candidate.effectiveFrom.getTime() > best.effectiveFrom.getTime() ? candidate : best;
  });
}

export interface FloorVerdict {
  ok: boolean;
  /** The floor the rate was held to; null when there is none, which is itself a refusal. */
  minHourlyKobo: number | null;
}

/**
 * At the floor is fine; below it is not. A floor is a minimum, and refusing
 * an offer that exactly meets it would make the published number a lie.
 *
 * **No floor is a refusal, not a pass** (RAT-01). A missing floor used to let any
 * rate through, so for every profession nobody had set one for, the wage
 * protection silently did not exist. Now a profession and shift type with no
 * floor cannot be published until somebody sets one: `ok` is false and
 * `minHourlyKobo` is null, which a caller reads as "there is no minimum to name".
 */
export function checkAgainstFloor(
  hourlyRateKobo: number,
  floor: RateFloorLike | null,
): FloorVerdict {
  if (!floor) return { ok: false, minHourlyKobo: null };
  return { ok: hourlyRateKobo >= floor.minHourlyKobo, minHourlyKobo: floor.minHourlyKobo };
}

/** No real hourly rate is above this; a floor above it is a typo, and one that would stop every shift. */
export const MAX_FLOOR_HOURLY_KOBO = 100_000_000;

export type FloorProblem = 'amount' | 'date' | 'past';

/**
 * What is wrong with a floor somebody is setting, or null.
 *
 * It cannot start in the past: floors are versioned by date, so an earlier one
 * can still explain a shift priced under it, and a floor dated back would change
 * what a shift already published was held to.
 */
export function floorProblem(
  floor: { minHourlyKobo: number; effectiveFrom: string },
  now: Date,
): FloorProblem | null {
  if (
    !Number.isInteger(floor.minHourlyKobo) ||
    floor.minHourlyKobo < 1 ||
    floor.minHourlyKobo > MAX_FLOOR_HOURLY_KOBO
  ) {
    return 'amount';
  }
  if (!isDateOnly(floor.effectiveFrom)) return 'date';
  if (floor.effectiveFrom < lagosDate(now)) return 'past';
  return null;
}
