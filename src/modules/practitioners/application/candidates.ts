import { prisma } from '@/lib/db';
import { getEligibilityFor } from './eligibility';
import { withdrawnFromMatching } from '@/modules/audit-compliance/application/consent';

/**
 * The practitioner data the matcher needs, exposed as a function rather than
 * as tables to join.
 *
 * Modules talk through each other's application layer; `src/modules/matching`
 * reading `practitioners.practitioner_profiles` directly is exactly what the
 * rule in docs/module-map.md forbids, and this is what makes obeying it
 * cheaper than breaking it.
 */

export interface MatchCandidateProfile {
  userId: string;
  professionalCategoryId: string;
  specialtyId: string | null;
  /** The level an officer recorded against their registration, or null when none has been. */
  cadreLevelId: string | null;
  /** Whether their registration category says they work under supervision. */
  supervised: boolean;
  yearsOfExperience: number;
  homeStateId: string | null;
  homeLgaId: string | null;
  travelPreference: 'SAME_LGA' | 'SAME_STATE' | 'ANYWHERE';
  eligible: boolean;
}

/*
 * No completion count and no reliability score here. Those come from
 * `matching.assignments`, which is matching's table, and matching already
 * calls this function — a field on this shape would have made the dependency
 * point both ways to carry a number the caller can read for itself. See
 * `assignmentOutcomes` in src/modules/matching/application/assignment.ts.
 */

/**
 * Everyone in the requested category, with eligibility already decided.
 *
 * Filtering by category in the query rather than in the engine keeps the pool
 * to a sensible size; every other filter is the engine's, because the engine
 * is what has to explain itself.
 *
 * Eligibility is evaluated per candidate rather than in SQL, because it is
 * the Stage 5 invariant and lives in one pure function — a second copy of it
 * expressed as a WHERE clause is precisely the "under any code path" failure
 * step 5.8 exists to prevent.
 */
export async function listMatchCandidates(input: {
  professionalCategoryId: string;
}): Promise<MatchCandidateProfile[]> {
  const profiles = await prisma.practitionerProfile.findMany({
    where: { professionalCategoryId: input.professionalCategoryId, deletedAt: null },
    select: {
      userId: true,
      professionalCategoryId: true,
      specialtyId: true,
      yearsOfExperience: true,
      homeStateId: true,
      homeLgaId: true,
      travelPreference: true,
    },
  });

  // One batch rather than a call per profile. Every candidate here shares the
  // category that selected them, so the per-practitioner version re-read the
  // same category row and the same requirement list once for each of them.
  const [eligibility, withdrawn, standings] = await Promise.all([
    getEligibilityFor(profiles.map((profile) => profile.userId)),
    withdrawnFromMatching(profiles.map((profile) => profile.userId)),
    standingsFor(profiles.map((profile) => profile.userId)),
  ]);

  // Left out entirely rather than listed as excluded: somebody who has
  // withdrawn "letting facilities find your profile" should not appear in a
  // facility's candidate list at all, reason attached or not.
  return profiles
    .filter((profile) => !withdrawn.has(profile.userId))
    .map((profile) => ({
      userId: profile.userId,
      professionalCategoryId: profile.professionalCategoryId,
      specialtyId: profile.specialtyId,
      cadreLevelId: standings.get(profile.userId)?.cadreLevelId ?? null,
      supervised: standings.get(profile.userId)?.supervised ?? false,
      yearsOfExperience: profile.yearsOfExperience,
      homeStateId: profile.homeStateId,
      homeLgaId: profile.homeLgaId,
      travelPreference: profile.travelPreference,
      eligible: eligibility.get(profile.userId)?.eligible ?? false,
    }));
}

/**
 * Where each of them stands on the register: the level and whether they need
 * supervision, from the registration an officer checked (PRA-01, PRA-02).
 *
 * A practitioner holds one registration per regulator and a profession has one
 * regulator, so there is one row; if there are ever two, the level is the first
 * recorded and supervision applies if any of them requires it, which can only
 * ever hold somebody back, never let them through.
 */
export async function standingsFor(
  userIds: string[],
): Promise<Map<string, { cadreLevelId: string | null; supervised: boolean }>> {
  const rows = await prisma.professionalRegistration.findMany({
    where: { userId: { in: userIds }, deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: {
      userId: true,
      cadreLevelId: true,
      registrationCategory: { select: { supervisionRequired: true } },
    },
  });

  const result = new Map<string, { cadreLevelId: string | null; supervised: boolean }>();
  for (const row of rows) {
    const current = result.get(row.userId) ?? { cadreLevelId: null, supervised: false };
    result.set(row.userId, {
      cadreLevelId: current.cadreLevelId ?? row.cadreLevelId,
      supervised: current.supervised || (row.registrationCategory?.supervisionRequired ?? false),
    });
  }
  return result;
}
