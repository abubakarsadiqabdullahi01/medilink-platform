import { prisma } from '@/lib/db';
import { trySendSms } from '@/lib/sms';
import { maskPhone } from '@/lib/phone';
import { logger } from '@/lib/logger';

/**
 * Sending a message and recording that it was sent.
 *
 * Step 6.5 asks that both parties are notified on confirmation, and an
 * assertion about a stored record is worth more than one about a mock. This
 * is also the notifications module's first real use — it has been an adapter
 * stub since Stage 4.
 */

export interface NotifyParams {
  userId: string;
  kind: string;
  body: string;
  relatedType?: string;
  relatedId?: string;
}

/**
 * Never throws. A failed notification must not roll back the thing it was
 * notifying about — the same rule `trySendSms` already follows, applied one
 * level up.
 *
 * The recipient is stored masked. This table is read by more people than
 * identity.users is, for the same reason the audit trail carries no NIN.
 */
export async function notify(input: NotifyParams): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { phone: true, deletedAt: true },
  });

  if (!user || user.deletedAt) {
    logger.warn('notification skipped: no such user', { kind: input.kind });
    return;
  }

  const result = await trySendSms({ to: user.phone, body: input.body });

  await prisma.notificationMessage.create({
    data: {
      userId: input.userId,
      channel: 'sms',
      kind: input.kind,
      recipient: maskPhone(user.phone),
      body: input.body,
      relatedType: input.relatedType,
      relatedId: input.relatedId,
      sentAt: result ? new Date() : null,
      failureReason: result ? null : 'The SMS adapter did not accept the message.',
    },
  });
}

export async function notificationsFor(userId: string) {
  return prisma.notificationMessage.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: { kind: true, recipient: true, body: true, sentAt: true, createdAt: true },
  });
}
