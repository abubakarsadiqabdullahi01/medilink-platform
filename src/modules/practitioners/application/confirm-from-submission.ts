import { prisma } from '@/lib/db';
import {
  applyReview,
  getSubmissionForVerification,
  prepareReview,
  type SubmissionForVerification,
} from '@/modules/credentials/application/submission';
import { CredentialErrors } from '@/modules/credentials/domain/errors';
import { printedExpiryProblem } from '@/modules/credentials/domain/submission';
import {
  prepareIdentityVerification,
  prepareProfessionalRegistration,
  saveIdentityVerification,
  saveProfessionalRegistration,
  type IdentityVerificationView,
  type PreparedIdentity,
  type ProfessionalRegistrationView,
} from './verification';
import { NinFormatError, type RegistrationStatusValue } from '../domain/verification';
import { PractitionerErrors } from '../domain/errors';

/**
 * Confirming what a practitioner submitted, in one act.
 *
 * A practitioner supplies their NIN and licence number with a photograph of the
 * slip and the licence. Until now that was only half the job: an officer then
 * had to retype the same numbers into separate "record an identity" and "record
 * a registration" forms, from a slip they had no way to see in the product. The
 * same fact was entered twice by two people, and the officer's copy was the one
 * that counted.
 *
 * This reads the number from the submission, records the identity or
 * registration from it, and decides the submission — together, so there is one
 * place to look and one thing to click. **The officer still decides.** What they
 * confirm is their reading of the document: whether the name matches, what the
 * licence says. Nothing here approves anything on its own.
 *
 * The manual forms remain for somebody who has no submission, and when a
 * provider is switched on the same two functions below ask it instead of the
 * officer (see `recordIdentityVerification`) — the practitioner's number is
 * already in the right place for that.
 *
 * Everything is checked before anything is written, so a refusal leaves no
 * half-recorded identity behind. And everything is written in one transaction (M03-06):
 * what the officer read, and what was decided about the submission it came from, either
 * both happen or neither does. They used to be three commits (record, decide, mask), so a
 * failure between the first two left a fact on the record that its own submission did not
 * agree with, a retry wrote it twice, and a second officer who read the slip differently
 * overwrote the first one's reading while the first one's decision stood.
 *
 * The decision is what the transaction turns on: it only succeeds on a submission still
 * waiting, so of two officers at once the second blocks on the first, is refused as already
 * reviewed, and takes whatever it wrote beside the decision with it. It is written first so
 * that a submission somebody has already decided is refused before anything else is written
 * and thrown away; either order rolls back together.
 *
 * A provider, when one is switched on, is asked before the transaction opens: a call over
 * the network is not held inside one.
 */

export type ConfirmOutcome =
  /** Recorded and approved. */
  | 'CONFIRMED'
  /** Recorded, but the name did not match: the practitioner is asked to correct it. */
  | 'NAME_MISMATCH'
  /** Recorded, but the register does not show an active registration: rejected. */
  | 'NOT_ACTIVE';

async function loadConfirmable(
  submissionId: string,
  actorId: string,
  method: 'nimc_verification' | 'mdcn_status_check',
): Promise<SubmissionForVerification & { referenceNumber: string }> {
  const submission = await getSubmissionForVerification(submissionId);

  if (submission.verificationMethod !== method) {
    throw PractitionerErrors.submissionNotConfirmable(
      'That submission is not the kind this check is for.',
    );
  }
  // Said before any write, so an officer who is also a practitioner cannot
  // have recorded their own identity by the time the refusal arrives.
  if (submission.userId === actorId) throw CredentialErrors.cannotReviewOwnSubmission();
  if (submission.status !== 'PENDING') throw CredentialErrors.alreadyReviewed();
  if (!submission.referenceNumber) {
    throw PractitionerErrors.submissionNotConfirmable('There is no number on this submission.');
  }
  return { ...submission, referenceNumber: submission.referenceNumber };
}

export async function confirmIdentityFromSubmission(input: {
  submissionId: string;
  /** The officer's reading of the slip. Ignored when a provider answers instead. */
  nameMatch?: boolean;
  actorId: string;
}): Promise<{ outcome: ConfirmOutcome; identity: IdentityVerificationView }> {
  const submission = await loadConfirmable(input.submissionId, input.actorId, 'nimc_verification');

  let prepared: PreparedIdentity;
  try {
    prepared = await prepareIdentityVerification({
      userId: submission.userId,
      nin: submission.referenceNumber,
      nameMatch: input.nameMatch,
      actorId: input.actorId,
    });
  } catch (error) {
    if (error instanceof NinFormatError) {
      throw PractitionerErrors.submissionNotConfirmable(
        'The number they submitted is not an 11-digit NIN. Ask them for more information so they can correct it.',
      );
    }
    throw error;
  }

  // A mismatch is a fact the record should hold, and it stands as its own blocker, but it is
  // not approved: the practitioner is asked to correct it. The number is masked either way,
  // by the decision itself, so a practitioner who resupplies is asked for it again.
  const mismatch = !prepared.nameMatch;
  const plan = await prepareReview(
    mismatch
      ? {
          submissionId: submission.id,
          reviewerId: input.actorId,
          decision: 'request_info',
          reviewNotes:
            'The name on the slip does not match the name on your account. Check it, and send a corrected number or a clearer photograph.',
        }
      : {
          submissionId: submission.id,
          reviewerId: input.actorId,
          decision: 'approve',
          reviewNotes: 'Checked against the slip they submitted.',
        },
  );

  const identity = await prisma.$transaction(async (tx) => {
    await applyReview(tx, plan);
    return saveIdentityVerification(tx, prepared);
  });

  return { outcome: mismatch ? 'NAME_MISMATCH' : 'CONFIRMED', identity };
}

export async function confirmRegistrationFromSubmission(input: {
  submissionId: string;
  /** What the licence shows. Required unless a provider answers instead. */
  registrationStatus?: RegistrationStatusValue;
  expiresAt?: Date;
  /** Where they stand on the register, as the licence shows it. Left out keeps what is recorded. */
  cadreLevelId?: string | null;
  registrationCategoryId?: string | null;
  actorId: string;
}): Promise<{ outcome: ConfirmOutcome; registration: ProfessionalRegistrationView }> {
  const submission = await loadConfirmable(input.submissionId, input.actorId, 'mdcn_status_check');

  // The regulator comes from their profession, not from anything typed: a
  // nurse's licence is the NMCN's, whatever it is called on the form.
  const profile = await prisma.practitionerProfile.findUnique({
    where: { userId: submission.userId },
    select: { deletedAt: true, professionalCategory: { select: { regulator: true } } },
  });
  if (!profile || profile.deletedAt) {
    throw PractitionerErrors.submissionNotConfirmable(
      'They have not created a profile yet, so there is no regulator to record this against.',
    );
  }

  // The date the officer read off the licence is the credential's own expiry too
  // (CRE-04), not one worked out from the review date. Checked before anything
  // is recorded, like everything else here: a licence that has already expired is
  // not one to approve, and the refusal should leave no registration behind. A
  // licence the officer is recording as suspended or lapsed is rejected, never
  // approved, so its date is not held to that.
  const printedExpiry =
    submission.credentialTypeExpires && input.expiresAt
      ? input.expiresAt.toISOString().slice(0, 10)
      : undefined;
  const mayBeApproved = input.registrationStatus === undefined || input.registrationStatus === 'ACTIVE';
  const problem = mayBeApproved
    ? printedExpiryProblem({ expires: submission.credentialTypeExpires }, printedExpiry, new Date())
    : null;
  if (problem) throw CredentialErrors.printedExpiryInvalid(problem);

  const prepared = await prepareProfessionalRegistration({
    userId: submission.userId,
    regulator: profile.professionalCategory.regulator,
    folioNumber: submission.referenceNumber,
    registrationStatus: input.registrationStatus,
    expiresAt: input.expiresAt,
    cadreLevelId: input.cadreLevelId,
    registrationCategoryId: input.registrationCategoryId,
    actorId: input.actorId,
  });

  // Recorded accurately whatever the register shows — a suspended licence is exactly what the
  // record should say — and a registration that is not active rejects the submission with the
  // reason, so the practitioner is told why rather than left waiting.
  const active = prepared.registrationStatus === 'ACTIVE';
  const plan = await prepareReview(
    active
      ? {
          submissionId: submission.id,
          reviewerId: input.actorId,
          decision: 'approve',
          reviewNotes: 'Checked against the licence they submitted.',
          printedExpiryDate: printedExpiry,
        }
      : {
          submissionId: submission.id,
          reviewerId: input.actorId,
          decision: 'reject',
          reviewNotes: `The register shows this registration as ${prepared.registrationStatus
            .toLowerCase()
            .replace(/_/g, ' ')}.`,
        },
  );

  const registration = await prisma.$transaction(async (tx) => {
    await applyReview(tx, plan);
    return saveProfessionalRegistration(tx, prepared);
  });

  return { outcome: active ? 'CONFIRMED' : 'NOT_ACTIVE', registration };
}
