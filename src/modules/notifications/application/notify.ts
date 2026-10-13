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

export type NotifyOutcome = 'sent' | 'failed' | 'skipped';

/**
 * Never throws. A failed notification must not roll back the thing it was
 * notifying about — the same rule `trySendSms` already follows, applied one
 * level up. It *says* what happened instead, so a caller driven by the outbox
 * can fail the event and have it retried: a text that did not go and a text
 * nobody was ever going to send are different things, and used to look the same.
 *
 * The recipient is stored masked. This table is read by more people than
 * identity.users is, for the same reason the audit trail carries no NIN.
 */
export async function notify(input: NotifyParams): Promise<NotifyOutcome> {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { phone: true, deletedAt: true },
  });

  if (!user || user.deletedAt) {
    logger.warn('notification skipped: no such user', { kind: input.kind });
    return 'skipped';
  }

  const result = await trySendSms({ to: user.phone, body: input.body });
  const delivered = result?.accepted === true;

  await prisma.notificationMessage.create({
    data: {
      userId: input.userId,
      channel: 'sms',
      kind: input.kind,
      recipient: maskPhone(user.phone),
      body: input.body,
      relatedType: input.relatedType,
      relatedId: input.relatedId,
      sentAt: delivered ? new Date() : null,
      failureReason: delivered ? null : 'The SMS adapter did not accept the message.',
    },
  });

  return delivered ? 'sent' : 'failed';
}

export async function notificationsFor(userId: string) {
  return prisma.notificationMessage.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: { kind: true, recipient: true, body: true, sentAt: true, createdAt: true },
  });
}
