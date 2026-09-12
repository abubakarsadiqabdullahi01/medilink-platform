import { prisma, type Tx } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { logger } from '@/lib/logger';

/**
 * Requests whose shift has started without being filled.
 *
 * A published request that is now in the past is not an opportunity, and
 * leaving it open means it keeps appearing in lists, keeps accepting
 * invitations, and quietly distorts the fill-rate metric the pilot is judged
 * on. Any invitation still awaiting an answer is withdrawn with it — a
 * practitioner should not accept a shift that has already begun.
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

      const withdrawn = await tx.invitation.updateMany({
        where: { serviceRequestId: request.id, status: 'INVITED' },
        data: { status: 'WITHDRAWN', respondedAt: now },
      });
      invitationsWithdrawn += withdrawn.count;

      await recordAudit(tx, {
        action: 'service_request.expired',
        entityType: 'service_requests.service_requests',
        entityId: request.id,
        actorId: request.facilityId,
        actorType: 'system',
        scopeType: 'FACILITY',
        scopeId: request.facilityId,
        reason: 'The shift started without the request being filled',
        after: { status: 'EXPIRED', invitationsWithdrawn: withdrawn.count },
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
