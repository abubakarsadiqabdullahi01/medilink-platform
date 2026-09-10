import { prisma, type Tx } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { logger } from '@/lib/logger';

/**
 * Step 5.9, the registration half: an ACTIVE registration whose licence date
 * has passed is moved to EXPIRED.
 *
 * `isRegistrationUsable` already refuses a lapsed licence whatever the stored
 * status says, so eligibility is correct the moment it lapses and does not
 * wait for this. What the sweep adds is that the *stored* state stops
 * claiming ACTIVE — which is what a compliance officer reads, and what a
 * report of "who needs to renew" is built from.
 */
export interface RegistrationExpiryResult {
  expired: number;
}

export async function expireRegistrations(
  now: Date = new Date(),
): Promise<RegistrationExpiryResult> {
  const due = await prisma.professionalRegistration.findMany({
    where: {
      registrationStatus: 'ACTIVE',
      deletedAt: null,
      expiresAt: { not: null, lte: now },
    },
    select: { id: true, userId: true, regulator: true, folioNumber: true, expiresAt: true },
  });

  for (const registration of due) {
    await prisma.$transaction(async (tx: Tx) => {
      const applied = await tx.professionalRegistration.updateMany({
        where: { id: registration.id, registrationStatus: 'ACTIVE' },
        data: { registrationStatus: 'EXPIRED' },
      });
      if (applied.count !== 1) return;

      await recordAudit(tx, {
        action: 'practitioner.registration_expired',
        entityType: 'practitioners.professional_registrations',
        entityId: registration.id,
        actorId: registration.userId,
        actorType: 'system',
        scopeType: 'SELF',
        scopeId: registration.userId,
        reason: 'Licence expiry date passed',
        after: {
          registrationStatus: 'EXPIRED',
          regulator: registration.regulator,
          expiresAt: registration.expiresAt,
        },
      });
    });
  }

  if (due.length > 0) logger.info('registration expiry sweep', { expired: due.length });
  return { expired: due.length };
}
