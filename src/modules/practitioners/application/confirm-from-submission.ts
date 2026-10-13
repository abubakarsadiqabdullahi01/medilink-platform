import { prisma } from '@/lib/db';
import {
  getSubmissionForVerification,
  maskSubmissionReference,
  reviewCredential,
  type SubmissionForVerification,
} from '@/modules/credentials/application/submission';
import { CredentialErrors } from '@/modules/credentials/domain/errors';
import {
  recordIdentityVerification,
  recordProfessionalRegistration,
  type IdentityVerificationView,
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
 * half-recorded identity behind.
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

  let identity: IdentityVerificationView;
  try {
    identity = await recordIdentityVerification({
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

  if (!identity.nameMatch) {
    // Recorded as it is — a mismatch is a fact the record should hold, and it
    // stands as its own blocker — but not approved. The number is left whole,
    // because the practitioner will resupply against it.
    await reviewCredential({
      submissionId: submission.id,
      reviewerId: input.actorId,
      decision: 'request_info',
      reviewNotes:
        'The name on the slip does not match the name on your account. Check it, and send a corrected number or a clearer photograph.',
    });
    return { outcome: 'NAME_MISMATCH', identity };
  }

  await reviewCredential({
    submissionId: submission.id,
    reviewerId: input.actorId,
    decision: 'approve',
    reviewNotes: 'Checked against the slip they submitted.',
  });
  await maskSubmissionReference({ submissionId: submission.id, actorId: input.actorId });

  return { outcome: 'CONFIRMED', identity };
}

export async function confirmRegistrationFromSubmission(input: {
  submissionId: string;
  /** What the licence shows. Required unless a provider answers instead. */
  registrationStatus?: RegistrationStatusValue;
  expiresAt?: Date;
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

  const registration = await recordProfessionalRegistration({
    userId: submission.userId,
    regulator: profile.professionalCategory.regulator,
    folioNumber: submission.referenceNumber,
    registrationStatus: input.registrationStatus,
    expiresAt: input.expiresAt,
    actorId: input.actorId,
  });

  if (registration.registrationStatus !== 'ACTIVE') {
    // Recorded accurately — a suspended licence is exactly what the record
    // should say — and the submission is rejected with the reason, so the
    // practitioner is told why rather than left waiting.
    await reviewCredential({
      submissionId: submission.id,
      reviewerId: input.actorId,
      decision: 'reject',
      reviewNotes: `The register shows this registration as ${registration.registrationStatus
        .toLowerCase()
        .replace(/_/g, ' ')}.`,
    });
    return { outcome: 'NOT_ACTIVE', registration };
  }

  await reviewCredential({
    submissionId: submission.id,
    reviewerId: input.actorId,
    decision: 'approve',
    reviewNotes: 'Checked against the licence they submitted.',
  });

  return { outcome: 'CONFIRMED', registration };
}
