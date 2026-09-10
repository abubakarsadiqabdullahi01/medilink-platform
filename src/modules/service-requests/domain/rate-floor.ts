/**
 * Rate floors: pure, no database.
 *
 * Step 6.1's whole verification is "publish at one kobo below the floor,
 * assert refusal", so the rule that decides which floor applies is worth
 * having on its own, with the awkward cases named.
 */

/** The sentinel in config.rate_floors meaning "any specialty in this category". */
export const ANY_SPECIALTY = '*';

export interface RateFloorLike {
  categoryKey: string;
  specialtyKey: string;
  shiftType: string;
  minHourlyKobo: number;
  effectiveFrom: Date;
}

export interface FloorQuery {
  categoryKey: string;
  /** Null when the request names no specialty. */
  specialtyKey: string | null;
  shiftType: 'DAY' | 'NIGHT';
  /** The shift's own start, not now: a floor that changes next month does not
   * govern a shift being priced for next week. */
  at: Date;
}

/**
 * The floor that governs this request, or null when none is published for it.
 *
 * Two rules decide between candidates, in order:
 *
 * 1. A floor naming the request's specialty beats the category-wide `*`.
 *    Anaesthesia having its own floor is the reason the column exists, and
 *    falling back to the category rate would quietly underpay it.
 * 2. Among equally specific floors, the latest `effectiveFrom` at or before
 *    the shift wins. Floors are versioned by date rather than replaced, so a
 *    shift priced today under last year's floor can still be explained.
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
        (query.specialtyKey !== null && floor.specialtyKey === query.specialtyKey)),
  );

  if (applicable.length === 0) return null;

  return applicable.reduce((best, candidate) => {
    const bestIsSpecific = best.specialtyKey !== ANY_SPECIALTY;
    const candidateIsSpecific = candidate.specialtyKey !== ANY_SPECIALTY;

    if (candidateIsSpecific !== bestIsSpecific) return candidateIsSpecific ? candidate : best;
    return candidate.effectiveFrom.getTime() > best.effectiveFrom.getTime() ? candidate : best;
  });
}

export interface FloorVerdict {
  ok: boolean;
  minHourlyKobo: number | null;
}

/**
 * At the floor is fine; below it is not. A floor is a minimum, and refusing
 * an offer that exactly meets it would make the published number a lie.
 */
export function checkAgainstFloor(
  hourlyRateKobo: number,
  floor: RateFloorLike | null,
): FloorVerdict {
  if (!floor) return { ok: true, minHourlyKobo: null };
  return { ok: hourlyRateKobo >= floor.minHourlyKobo, minHourlyKobo: floor.minHourlyKobo };
}
