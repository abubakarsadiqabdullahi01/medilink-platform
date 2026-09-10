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

async function loadEligibilityInput(userId: string): Promise<EligibilityInput | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { status: true, deletedAt: true },
  });
  if (!user || user.deletedAt) return null;

  const [profile, identity, screening] = await Promise.all([
    prisma.practitionerProfile.findUnique({
      where: { userId },
      select: { professionalCategoryId: true },
    }),
    prisma.identityVerification.findUnique({ where: { userId }, select: { nameMatch: true } }),
    prisma.screeningResult.findUnique({ where: { userId }, select: { status: true } }),
  ]);

  let registration: EligibilityInput['registration'] = null;
  let requiredCredentialTypeIds: string[] = [];
  let verifiedCredentialTypeIds: string[] = [];
  let expiredCredentialTypeIds: string[] = [];

  if (profile) {
    const category = await prisma.professionalCategory.findUnique({
      where: { id: profile.professionalCategoryId },
      select: { regulator: true },
    });

    if (category) {
      const [registrationRow, requirements, submissions] = await Promise.all([
        prisma.professionalRegistration.findUnique({
          where: { userId_regulator: { userId, regulator: category.regulator } },
          select: {
            registrationStatus: true,
            expiresAt: true,
            deletedAt: true,
            evidenceRetrievedAt: true,
          },
        }),
        prisma.credentialRequirement.findMany({
          where: { professionalCategoryId: profile.professionalCategoryId, isMandatory: true },
          select: { credentialTypeId: true },
        }),
        prisma.credentialSubmission.findMany({
          where: { userId, deletedAt: null, status: { in: ['VERIFIED', 'EXPIRED'] } },
          select: { credentialTypeId: true, status: true },
        }),
      ]);

      registration = registrationRow;
      requiredCredentialTypeIds = requirements.map((row) => row.credentialTypeId);
      verifiedCredentialTypeIds = submissions
        .filter((row) => row.status === 'VERIFIED')
        .map((row) => row.credentialTypeId);
      expiredCredentialTypeIds = submissions
        .filter((row) => row.status === 'EXPIRED')
        .map((row) => row.credentialTypeId);
    }
  }

  return {
    userStatus: user.status,
    hasProfile: Boolean(profile),
    identity: identity ? { nameMatch: identity.nameMatch } : null,
    screening: screening ? { status: screening.status } : null,
    registration,
    registrationReviewDays: DEFAULT_REGISTRATION_REVIEW_DAYS,
    requiredCredentialTypeIds,
    verifiedCredentialTypeIds,
    expiredCredentialTypeIds,
  };
}

/**
 * Every reason this practitioner is not yet eligible to be matched, or none.
 * A deleted or nonexistent account is reported fully blocked rather than
 * refused with a 404 — the same lenient shape getVerificationSummary already
 * uses for a practitioner with no records at all.
 */
export async function getEligibility(userId: string, now: Date = new Date()): Promise<EligibilityView> {
  const input = await loadEligibilityInput(userId);
  const blockers: EligibilityBlocker[] = input
    ? eligibilityBlockers(input, now)
    : ['account_not_usable'];
  return { eligible: blockers.length === 0, blockers };
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
