import { prisma, type Tx } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { logger } from '@/lib/logger';
import {
  DEFAULT_REGISTRATION_REVIEW_DAYS,
  eligibilityBlockers,
  isEligibleForMatching,
  type EligibilityBlocker,
  type EligibilityInput,
} from '../domain/eligibility';

/**
 * Applies the eligibility rule (../domain/eligibility.ts) against a real
 * practitioner's records, and the sweep that acts on it.
 *
 * Which credentials a category requires comes from CredentialRequirement
 * (Step 5.8); what the regulator says comes from the ProfessionalRegistration
 * matching that category's own `regulator` column — a doctor holds one MDCN
 * folio, and "MDCN" is config.professional_categories.regulator for the
 * doctor row.
 */

export interface EligibilityView {
  eligible: boolean;
  blockers: EligibilityBlocker[];
}

/**
 * Eligibility inputs for many practitioners, in a fixed number of queries.
 *
 * The single-user loader used to be the only one, and `listMatchCandidates`
 * called it once per practitioner — eight statements each, so a matching run
 * over two hundred candidates in a category issued about sixteen hundred
 * queries. Four hundred of those were provably identical: candidates are
 * selected *by* category, so every one of them re-read the same category row
 * and the same mandatory-credential list.
 *
 * This reads each table once for the whole set and indexes in memory. The
 * rule itself is untouched and still evaluated per practitioner by the pure
 * function in ../domain/eligibility — batching what is loaded, never how it
 * is judged, because a second copy of the rule expressed as SQL is exactly
 * the "under any code path" failure step 5.8 exists to prevent.
 *
 * Returns a map rather than an array: a caller asking about a user who does
 * not exist, or whose account is deleted, gets nothing for that id, which is
 * the same answer the single loader gives with null.
 */
async function loadEligibilityInputs(userIds: string[]): Promise<Map<string, EligibilityInput>> {
  const inputs = new Map<string, EligibilityInput>();
  if (userIds.length === 0) return inputs;

  const ids = [...new Set(userIds)];

  const [users, profiles, identities, screenings, registrations, submissions] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, status: true, deletedAt: true },
    }),
    prisma.practitionerProfile.findMany({
      where: { userId: { in: ids } },
      select: { userId: true, professionalCategoryId: true },
    }),
    prisma.identityVerification.findMany({
      where: { userId: { in: ids } },
      select: { userId: true, nameMatch: true },
    }),
    prisma.screeningResult.findMany({
      where: { userId: { in: ids } },
      select: { userId: true, status: true },
    }),
    // Every regulator this set holds a registration with, filtered down per
    // practitioner below. The single-user path looked one up by the compound
    // unique; here the same choice is made in memory.
    prisma.professionalRegistration.findMany({
      where: { userId: { in: ids } },
      select: {
        userId: true,
        regulator: true,
        registrationStatus: true,
        expiresAt: true,
        deletedAt: true,
        evidenceRetrievedAt: true,
      },
    }),
    prisma.credentialSubmission.findMany({
      where: { userId: { in: ids }, deletedAt: null, status: { in: ['VERIFIED', 'EXPIRED'] } },
      select: { userId: true, credentialTypeId: true, status: true },
    }),
  ]);

  const profileOf = new Map(profiles.map((row) => [row.userId, row]));
  const categoryIds = [...new Set(profiles.map((row) => row.professionalCategoryId))];

  // Second wave, because which categories to read is only known once the
  // profiles are in hand. Two round trips rather than two per practitioner.
  const [categories, requirements] = await Promise.all([
    categoryIds.length
      ? prisma.professionalCategory.findMany({
          where: { id: { in: categoryIds } },
          select: { id: true, regulator: true },
        })
      : Promise.resolve([]),
    categoryIds.length
      ? prisma.credentialRequirement.findMany({
          where: { professionalCategoryId: { in: categoryIds }, isMandatory: true },
          select: { professionalCategoryId: true, credentialTypeId: true },
        })
      : Promise.resolve([]),
  ]);

  const regulatorOf = new Map(categories.map((row) => [row.id, row.regulator]));

  const requiredByCategory = new Map<string, string[]>();
  for (const row of requirements) {
    const list = requiredByCategory.get(row.professionalCategoryId) ?? [];
    list.push(row.credentialTypeId);
    requiredByCategory.set(row.professionalCategoryId, list);
  }

  const registrationOf = new Map(
    registrations.map((row) => [`${row.userId}|${row.regulator}`, row]),
  );

  const identityOf = new Map(identities.map((row) => [row.userId, row]));
  const screeningOf = new Map(screenings.map((row) => [row.userId, row]));

  const submissionsOf = new Map<string, typeof submissions>();
  for (const row of submissions) {
    const list = submissionsOf.get(row.userId) ?? [];
    list.push(row);
    submissionsOf.set(row.userId, list);
  }

  for (const user of users) {
    // A deleted account is absent rather than reported, matching the null the
    // single-user loader returns for one.
    if (user.deletedAt) continue;

    const profile = profileOf.get(user.id) ?? null;
    const identity = identityOf.get(user.id) ?? null;
    const screening = screeningOf.get(user.id) ?? null;

    let registration: EligibilityInput['registration'] = null;
    let requiredCredentialTypeIds: string[] = [];
    let verifiedCredentialTypeIds: string[] = [];
    let expiredCredentialTypeIds: string[] = [];

    if (profile) {
      const regulator = regulatorOf.get(profile.professionalCategoryId);

      if (regulator) {
        const row = registrationOf.get(`${user.id}|${regulator}`);
        registration = row
          ? {
              registrationStatus: row.registrationStatus,
              expiresAt: row.expiresAt,
              deletedAt: row.deletedAt,
              evidenceRetrievedAt: row.evidenceRetrievedAt,
            }
          : null;

        requiredCredentialTypeIds = requiredByCategory.get(profile.professionalCategoryId) ?? [];

        const mine = submissionsOf.get(user.id) ?? [];
        verifiedCredentialTypeIds = mine
          .filter((submission) => submission.status === 'VERIFIED')
          .map((submission) => submission.credentialTypeId);
        expiredCredentialTypeIds = mine
          .filter((submission) => submission.status === 'EXPIRED')
          .map((submission) => submission.credentialTypeId);
      }
    }

    inputs.set(user.id, {
      userStatus: user.status,
      hasProfile: Boolean(profile),
      identity: identity ? { nameMatch: identity.nameMatch } : null,
      screening: screening ? { status: screening.status } : null,
      registration,
      registrationReviewDays: DEFAULT_REGISTRATION_REVIEW_DAYS,
      requiredCredentialTypeIds,
      verifiedCredentialTypeIds,
      expiredCredentialTypeIds,
    });
  }

  return inputs;
}

/** One practitioner's, through the same code as many. */
async function loadEligibilityInput(userId: string): Promise<EligibilityInput | null> {
  const inputs = await loadEligibilityInputs([userId]);
  return inputs.get(userId) ?? null;
}

/**
 * Every reason this practitioner is not yet eligible to be matched, or none.
 * A deleted or nonexistent account is reported fully blocked rather than
 * refused with a 404 — the same lenient shape getVerificationSummary already
 * uses for a practitioner with no records at all.
 */
export async function getEligibility(
  userId: string,
  now: Date = new Date(),
): Promise<EligibilityView> {
  const input = await loadEligibilityInput(userId);
  const blockers: EligibilityBlocker[] = input
    ? eligibilityBlockers(input, now)
    : ['account_not_usable'];
  return { eligible: blockers.length === 0, blockers };
}

/**
 * Eligibility for a set of practitioners, as one batch.
 *
 * What matching calls. The verdict for each is produced by the same pure
 * function as the single-user path, so the two cannot disagree.
 */
export async function getEligibilityFor(
  userIds: string[],
  now: Date = new Date(),
): Promise<Map<string, EligibilityView>> {
  const inputs = await loadEligibilityInputs(userIds);
  const views = new Map<string, EligibilityView>();

  for (const userId of userIds) {
    const input = inputs.get(userId);
    const blockers: EligibilityBlocker[] = input
      ? eligibilityBlockers(input, now)
      : ['account_not_usable'];
    views.set(userId, { eligible: blockers.length === 0, blockers });
  }

  return views;
}

/**
 * Promotes one practitioner from UNDER_REVIEW to ACTIVE if, and only if,
 * isEligibleForMatching says so. Conditional on the status just read, so a
 * concurrent sweep pass cannot activate the same account twice.
 */
async function maybeActivate(userId: string, now: Date): Promise<boolean> {
  const input = await loadEligibilityInput(userId);
  if (!input || input.userStatus !== 'UNDER_REVIEW') return false;
  if (!isEligibleForMatching(input, now)) return false;

  return prisma.$transaction(async (tx: Tx) => {
    const applied = await tx.user.updateMany({
      where: { id: userId, status: 'UNDER_REVIEW' },
      data: { status: 'ACTIVE' },
    });
    if (applied.count !== 1) return false;

    await recordAudit(tx, {
      action: 'practitioner.activated',
      entityType: 'identity.users',
      entityId: userId,
      actorId: userId,
      actorType: 'system',
      scopeType: 'SELF',
      scopeId: userId,
      reason: 'Every eligibility requirement is satisfied',
      after: { status: 'ACTIVE' },
    });

    return true;
  });
}

export interface ActivationSweepResult {
  checked: number;
  activated: number;
}

/**
 * The scheduled half of Step 5.8. Nothing activates a practitioner
 * synchronously — a credential being verified does not itself flip the
 * account to ACTIVE — a nightly sweep re-checks every UNDER_REVIEW
 * practitioner instead, the same shape as the screening sweep.
 *
 * Querying every UNDER_REVIEW user, rather than joining on
 * practitioner_profiles the way the screening sweep does, keeps "no profile
 * yet" a "not eligible yet" outcome the eligibility rule already reports,
 * rather than a case this sweep has to know to skip.
 */
export async function activateEligiblePractitioners(): Promise<ActivationSweepResult> {
  const now = new Date();
  const candidates = await prisma.user.findMany({
    where: { status: 'UNDER_REVIEW', deletedAt: null },
    select: { id: true },
  });

  let activated = 0;
  for (const candidate of candidates) {
    if (await maybeActivate(candidate.id, now)) activated += 1;
  }

  if (activated > 0) {
    logger.info('practitioner activation sweep', { checked: candidates.length, activated });
  }
  return { checked: candidates.length, activated };
}
