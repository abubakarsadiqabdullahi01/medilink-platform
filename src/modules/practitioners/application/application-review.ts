import { prisma, type Tx } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { PractitionerErrors } from '../domain/errors';
import { applicationGaps, describeGaps } from '../domain/application-review';

/**
 * "I am done — review me."
 *
 * The one act that puts a practitioner in the compliance officer's queue. It
 * checks, on the server, that what is the practitioner's to supply has been
 * supplied: the client shows the same checklist, but a form that lets itself
 * be submitted early and relies on the page to say no would put half-finished
 * applications in front of an officer whenever somebody used the API directly.
 *
 * Availability lives in another module and this one does not read its tables,
 * so the caller — the route, which may compose modules — says whether any
 * exists. Everything else is this module's own: the profile, and the
 * credential requirements and submissions the eligibility rule already reads.
 */

export interface SubmitForReviewResult {
  submittedForReviewAt: Date;
  /** True when they had already submitted; nothing was changed or recorded. */
  alreadySubmitted: boolean;
}

export async function submitForReview(input: {
  userId: string;
  hasAvailability: boolean;
}): Promise<SubmitForReviewResult> {
  const profile = await prisma.practitionerProfile.findUnique({ where: { userId: input.userId } });
  const live = profile && !profile.deletedAt ? profile : null;

  const [requirements, supplied] = live
    ? await Promise.all([
        prisma.credentialRequirement.findMany({
          where: { professionalCategoryId: live.professionalCategoryId, isMandatory: true },
          select: { credentialTypeId: true },
        }),
        prisma.credentialSubmission.findMany({
          where: {
            userId: input.userId,
            deletedAt: null,
            status: { in: ['PENDING', 'MORE_INFO_REQUESTED', 'VERIFIED'] },
          },
          select: { credentialTypeId: true },
        }),
      ])
    : [[], []];

  const gaps = applicationGaps({
    hasProfile: Boolean(live),
    hasAvailability: input.hasAvailability,
    mandatoryCredentialTypeIds: requirements.map((row) => row.credentialTypeId),
    suppliedCredentialTypeIds: supplied.map((row) => row.credentialTypeId),
  });
  if (gaps.length > 0 || !live) {
    throw PractitionerErrors.applicationIncomplete(describeGaps(gaps));
  }

  // Idempotent: a second press (a double click, a retry after a dropped
  // response) must neither move the timestamp, which is what orders the
  // queue, nor write a second audit row claiming it happened twice.
  if (live.submittedForReviewAt) {
    return { submittedForReviewAt: live.submittedForReviewAt, alreadySubmitted: true };
  }

  const at = new Date();
  return prisma.$transaction(async (tx) => {
    // `submittedForReviewAt: null` in the filter makes the check and the write
    // one statement, so two concurrent submissions cannot both win.
    const { count } = await tx.practitionerProfile.updateMany({
      where: { id: live.id, submittedForReviewAt: null },
      data: { submittedForReviewAt: at },
    });
    if (count === 0) {
      const current = await tx.practitionerProfile.findUniqueOrThrow({ where: { id: live.id } });
      return {
        submittedForReviewAt: current.submittedForReviewAt ?? at,
        alreadySubmitted: true,
      };
    }

    await recordAudit(tx, {
      action: 'practitioner.submitted_for_review',
      entityType: 'practitioners.practitioner_profiles',
      entityId: live.id,
      actorId: input.userId,
      scopeType: 'SELF',
      scopeId: input.userId,
      before: { submittedForReviewAt: null },
      after: { submittedForReviewAt: at },
    });

    return { submittedForReviewAt: at, alreadySubmitted: false };
  });
}

/**
 * An officer has refused something the practitioner must supply: the
 * application goes back to them.
 *
 * Clearing `submittedForReviewAt` is what makes "resubmit" a rule rather than
 * a courtesy. Without it a rejected practitioner stayed in WAITING — told an
 * officer had their application while the document was refused — and nothing
 * required them to say "fixed, look again" before an officer next saw them.
 * Now the only way back in front of an officer is a replacement credential
 * and a fresh submit, and the audit trail says who sent it back and why.
 *
 * Only for a credential the profession requires. Refusing an optional
 * document says nothing about whether the application is complete.
 *
 * Takes the caller's transaction: the rejection and the return happen
 * together or not at all, so there is no moment where a credential is
 * rejected and the application still reads as submitted.
 */
export async function returnApplicationForChanges(
  tx: Tx,
  input: { userId: string; credentialTypeId: string; reviewerId: string; reason?: string },
): Promise<boolean> {
  const profile = await tx.practitionerProfile.findUnique({ where: { userId: input.userId } });
  if (!profile || profile.deletedAt || !profile.submittedForReviewAt) return false;

  const required = await tx.credentialRequirement.findFirst({
    where: {
      professionalCategoryId: profile.professionalCategoryId,
      credentialTypeId: input.credentialTypeId,
      isMandatory: true,
    },
    select: { id: true },
  });
  if (!required) return false;

  const { count } = await tx.practitionerProfile.updateMany({
    where: { id: profile.id, submittedForReviewAt: { not: null } },
    data: { submittedForReviewAt: null },
  });
  if (count === 0) return false;

  await recordAudit(tx, {
    action: 'practitioner.returned_for_changes',
    entityType: 'practitioners.practitioner_profiles',
    entityId: profile.id,
    actorId: input.reviewerId,
    scopeType: 'SELF',
    scopeId: input.userId,
    reason: input.reason,
    before: { submittedForReviewAt: profile.submittedForReviewAt },
    after: { submittedForReviewAt: null },
  });
  return true;
}
