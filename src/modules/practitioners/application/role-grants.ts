import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { logger } from '@/lib/logger';

/**
 * Grants the baseline `practitioner` role, at SELF scope, when registration
 * completes. Reacts to EVENTS.PractitionerRegistered (src/worker/handlers.ts)
 * rather than running inside setInitialPassword's own transaction: nothing
 * before this granted any role to a new user at all, so a practitioner had
 * zero permissions to exercise on their own profile or anything else.
 *
 * Find-then-create rather than a blind upsert: UserRole has no `updatedAt`
 * to tell "just created" apart from "already existed" after the fact, and
 * that distinction is what decides whether the audit row gets written. The
 * outbox delivers at least once, so a retried delivery must find the earlier
 * grant and do nothing rather than write a second grant or a second row.
 */
export async function grantPractitionerRoleOnRegistration(userId: string): Promise<void> {
  if (!userId) {
    logger.warn('practitioner.registered event missing userId; skipping role grant');
    return;
  }

  const role = await prisma.role.findUniqueOrThrow({ where: { key: 'practitioner' } });

  // Any row, revoked included: a practitioner whose role was taken away must
  // not get it back because the registration event was delivered again.
  const already = await prisma.userRole.findFirst({
    where: { userId, roleId: role.id, scopeType: 'SELF', scopeId: userId },
  });
  if (already) {
    logger.info('practitioner role already granted; retried delivery', { userId });
    return;
  }

  try {
    await prisma.$transaction(async (tx) => {
      const grant = await tx.userRole.create({
        data: { userId, roleId: role.id, scopeType: 'SELF', scopeId: userId, grantedBy: null },
      });

      await recordAudit(tx, {
        action: 'auth.role_granted',
        entityType: 'identity.user_roles',
        entityId: grant.id,
        actorId: userId,
        actorType: 'system',
        scopeType: 'SELF',
        scopeId: userId,
        after: { roleKey: 'practitioner' },
      });
    });
  } catch (error) {
    // The backstop for a genuine race between two concurrent deliveries; the
    // find-first check above is what makes the common sequential-retry case
    // also skip the audit row cleanly.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      logger.info('practitioner role grant raced another delivery', { userId });
      return;
    }
    throw error;
  }
}
