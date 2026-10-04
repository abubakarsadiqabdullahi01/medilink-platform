import { prisma, type Tx } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { logger } from '@/lib/logger';
import { withdrawOutstandingInvitations } from '@/modules/matching/application/assignment';

/**
 * Requests whose shift has started without being filled.
 *
 * A published request that is now in the past is not an opportunity, and
 * leaving it open means it keeps appearing in lists, keeps accepting
 * invitations, and quietly distorts the fill-rate metric the pilot is judged
 * on. Every offer on it that did not become an assignment is withdrawn with
 * it — one still awaiting an answer, and one accepted but never confirmed.
 * A practitioner should not accept a shift that has already begun, nor be
 * left believing they might still be confirmed onto one.
 */
export interface RequestExpiryResult {
  expired: number;
  invitationsWithdrawn: number;
}

export async function expireStartedRequests(
  now: Date = new Date(),
): Promise<RequestExpiryResult> {
  const due = await prisma.serviceRequest.findMany({
    where: { status: 'PUBLISHED', deletedAt: null, startsAt: { lte: now } },
    select: { id: true, facilityId: true, startsAt: true },
  });

  let invitationsWithdrawn = 0;

  for (const request of due) {
    await prisma.$transaction(async (tx: Tx) => {
      // Conditional on the status just read, so a facility confirming the
      // last place at the same moment is not overwritten by the sweep.
      const applied = await tx.serviceRequest.updateMany({
        where: { id: request.id, status: 'PUBLISHED' },
        data: { status: 'EXPIRED' },
      });
      if (applied.count !== 1) return;

      const withdrawn = await withdrawOutstandingInvitations(tx, {
        requestId: request.id,
        actorId: request.facilityId,
        actorType: 'system',
        reason: 'The shift started before this offer became an assignment',
        now,
      });
      invitationsWithdrawn += withdrawn;

      await recordAudit(tx, {
        action: 'service_request.expired',
        entityType: 'service_requests.service_requests',
        entityId: request.id,
        actorId: request.facilityId,
        actorType: 'system',
        scopeType: 'FACILITY',
        scopeId: request.facilityId,
        reason: 'The shift started without the request being filled',
        after: { status: 'EXPIRED', invitationsWithdrawn: withdrawn },
      });
    });
  }

  if (due.length > 0) {
    logger.info('service request expiry sweep', {
      expired: due.length,
      invitationsWithdrawn,
    });
  }

  return { expired: due.length, invitationsWithdrawn };
}
