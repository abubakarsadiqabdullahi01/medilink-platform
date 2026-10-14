import { prisma } from '@/lib/db';
import type { ReceiptOutcome } from '@/lib/sms/receipts';

/**
 * What a gateway reported about a message it took (M16-05).
 *
 * A report finds its message by the gateway and the id that gateway gave it; one for a message
 * this system never sent, or from a different gateway than the one that took it, matches nothing.
 *
 * Reports arrive late, twice and out of order, so the state only moves forward: a message that is
 * delivered stays delivered whatever is reported after, a progress report never undoes an
 * outcome, and a failure may still be corrected by a later delivery (a gateway that retried
 * succeeded). The update is conditional on the state that was read, so two reports arriving
 * together cannot overwrite each other.
 */
export interface DeliveryReceipt {
  provider: string;
  providerMessageId: string;
  outcome: ReceiptOutcome;
  detail?: string | null;
}

/** The states a report of each outcome may replace. `null` is no report yet. */
const MAY_REPLACE: Record<ReceiptOutcome, (string | null)[]> = {
  PENDING: [null],
  FAILED: [null, 'PENDING'],
  DELIVERED: [null, 'PENDING', 'FAILED'],
};

export async function recordDeliveryReceipt(
  receipt: DeliveryReceipt,
  now: Date = new Date(),
): Promise<{ matched: boolean; status: string | null }> {
  const message = await prisma.notificationMessage.findFirst({
    where: { provider: receipt.provider, providerMessageId: receipt.providerMessageId },
    select: { id: true, deliveryStatus: true },
  });
  if (!message) return { matched: false, status: null };

  if (!MAY_REPLACE[receipt.outcome].includes(message.deliveryStatus)) {
    return { matched: true, status: message.deliveryStatus };
  }

  const updated = await prisma.notificationMessage.updateMany({
    where: { id: message.id, deliveryStatus: message.deliveryStatus },
    data: {
      deliveryStatus: receipt.outcome,
      deliveryReportedAt: now,
      deliveryDetail: receipt.detail ?? null,
    },
  });
  if (updated.count === 1) return { matched: true, status: receipt.outcome };

  // Another report got there first; say what the message is now.
  const current = await prisma.notificationMessage.findUnique({
    where: { id: message.id },
    select: { deliveryStatus: true },
  });
  return { matched: true, status: current?.deliveryStatus ?? null };
}
