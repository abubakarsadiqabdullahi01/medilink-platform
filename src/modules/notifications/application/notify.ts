import { prisma } from '@/lib/db';
import { attemptSms } from '@/lib/sms';
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

/** What happened to one message, so the caller can decide whether the event should retry. */
export interface NotifyOutcome {
  sent: boolean;
  reason: string | null;
}

/**
 * Sends and records. Never throws: a failed notification must not roll back
 * the thing it was notifying about — the same rule `attemptSms` follows,
 * applied one level up.
 *
 * It does *say* whether the text went. A handler that ignored that recorded a
 * failed text as handled, the outbox marked the event processed, and nothing
 * ever tried again (NOT-03). Handlers now turn an unsent outcome into a thrown
 * error with `requireDelivered`, so the event is retried with backoff.
 *
 * A retry updates the failed row rather than adding a second one, so one
 * message is one row whatever it took to send it, and until it succeeds the
 * row says why it failed.
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
    // Nobody to tell. Retrying cannot help, so this is not a failure to retry.
    logger.warn('notification skipped: no such user', { kind: input.kind });
    return { sent: true, reason: null };
  }

  const attempt = await attemptSms({ to: user.phone, body: input.body });
  const fields = {
    body: input.body,
    sentAt: attempt.delivered ? new Date() : null,
    failureReason: attempt.delivered ? null : (attempt.reason ?? 'The SMS was not delivered.'),
  };

  const unsent = input.relatedId
    ? await prisma.notificationMessage.findFirst({
        where: { userId: input.userId, kind: input.kind, relatedId: input.relatedId, sentAt: null },
        select: { id: true },
      })
    : null;

  if (unsent) {
    await prisma.notificationMessage.update({ where: { id: unsent.id }, data: fields });
  } else {
    await prisma.notificationMessage.create({
      data: {
        userId: input.userId,
        channel: 'sms',
        kind: input.kind,
        recipient: maskPhone(user.phone),
        relatedType: input.relatedType,
        relatedId: input.relatedId,
        ...fields,
      },
    });
  }

  return { sent: attempt.delivered, reason: fields.failureReason };
}

/** Thrown by a handler when a message did not go, so the outbox retries the event. */
export class NotificationNotDelivered extends Error {
  constructor(readonly failures: string[]) {
    super(`Not delivered: ${failures.join('; ')}`.slice(0, 900));
    this.name = 'NotificationNotDelivered';
  }
}

/**
 * Fails the event if any of its messages did not go. Called after every
 * recipient has been tried, not at the first failure: one person's dead phone
 * must not stop the other being told, and on the retry the ones already sent
 * are skipped.
 */
export function requireDelivered(outcomes: NotifyOutcome[]): void {
  const failures = outcomes
    .filter((outcome) => !outcome.sent)
    .map((outcome) => outcome.reason ?? 'not delivered');
  if (failures.length > 0) throw new NotificationNotDelivered(failures);
}

export async function notificationsFor(userId: string) {
  return prisma.notificationMessage.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: { kind: true, recipient: true, body: true, sentAt: true, createdAt: true },
  });
}
