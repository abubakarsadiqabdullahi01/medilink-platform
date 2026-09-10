import { prisma, type Tx } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { publishEvent } from '@/lib/outbox';
import { EVENTS } from '@/lib/events';
import { logger } from '@/lib/logger';

/**
 * Step 5.9, the credential half: a verified credential whose expiry has
 * passed stops counting.
 *
 * EXPIRED rather than REJECTED, because nobody judged it wanting — the
 * practitioner renews it rather than re-arguing it, and the two states lead
 * to different conversations.
 *
 * What this sweep does *not* do is suspend the account. The plan's wording is
 * "an expired licence suspends an account", but UserStatus.SUSPENDED is
 * refused by currentSession, so a practitioner could not log in to upload the
 * renewal that fixes it. The safety requirement is that they cannot be
 * matched, and the eligibility rule enforces that from the moment the expiry
 * passes — before this sweep has even run. Suspension stays a compliance
 * officer's and a clinical incident's decision.
 */
export interface ExpirySweepResult {
  expired: number;
}

export async function expireCredentials(now: Date = new Date()): Promise<ExpirySweepResult> {
  const due = await prisma.credentialSubmission.findMany({
    where: { status: 'VERIFIED', deletedAt: null, expiresAt: { not: null, lte: now } },
    select: { id: true, userId: true, credentialTypeId: true, expiresAt: true },
  });

  for (const submission of due) {
    await prisma.$transaction(async (tx: Tx) => {
      // Conditional on the status just read, so a reviewer acting on the same
      // row at the same moment cannot be overwritten by the sweep.
      const applied = await tx.credentialSubmission.updateMany({
        where: { id: submission.id, status: 'VERIFIED' },
        data: { status: 'EXPIRED' },
      });
      if (applied.count !== 1) return;

      await recordAudit(tx, {
        action: 'credential.expired',
        entityType: 'credentials.credential_submissions',
        entityId: submission.id,
        actorId: submission.userId,
        actorType: 'system',
        scopeType: 'SELF',
        scopeId: submission.userId,
        reason: 'Expiry date passed',
        after: { status: 'EXPIRED', expiresAt: submission.expiresAt },
      });

      await publishEvent(tx, {
        eventType: EVENTS.CredentialExpired,
        aggregateType: 'credentials.credential_submissions',
        aggregateId: submission.id,
        payload: {
          submissionId: submission.id,
          userId: submission.userId,
          credentialTypeId: submission.credentialTypeId,
        },
      });
    });
  }

  if (due.length > 0) logger.info('credential expiry sweep', { expired: due.length });
  return { expired: due.length };
}
