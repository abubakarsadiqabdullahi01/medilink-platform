import { randomUUID } from 'node:crypto';
import { prisma, type Tx } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { publishEvent } from '@/lib/outbox';
import { EVENTS } from '@/lib/events';
import { HttpError } from '@/lib/http/errors';
import { entriesForPayout } from '../domain/ledger';
import { PaymentGatewayUnavailable, sendPayout } from '../infrastructure/gateway';

/**
 * Paying a practitioner.
 *
 * Two steps, deliberately: a payout is **prepared** from what the ledger says
 * somebody is owed, and then **released** by a person. Nothing pays
 * automatically, for the same reason nothing else on this platform closes
 * itself — and because the gap between the two is exactly where an
 * authorise-then-capture provider will slot in when step 3.3 is settled.
 */

export const PayoutErrors = {
  notFound: () => new HttpError('payout_not_found', 'That payout does not exist.', 404),
  nothingOwed: () =>
    new HttpError('nothing_owed', 'That practitioner is not owed anything right now.', 409),
  wrongStatus: (from: string, to: string) =>
    new HttpError('payout_wrong_status', `A ${from} payout cannot become ${to}.`, 409),
  gatewayUnavailable: (message: string) =>
    new HttpError('payment_gateway_unavailable', message, 503),
};

export interface PayoutView {
  id: string;
  practitionerId: string;
  amountKobo: number;
  status: string;
  providerReference: string | null;
  failureReason: string | null;
  releasedBy: string | null;
  releasedAt: Date | null;
  settledAt: Date | null;
  createdAt: Date;
}

function toView(row: PayoutView): PayoutView {
  return row;
}

/**
 * What a practitioner is owed, from the ledger alone.
 *
 * Their earnings account is credited (negative) when work is approved and
 * debited (positive) when they are paid, so what is outstanding is the
 * negative of the balance. Derived rather than stored, so it cannot drift
 * from the entries it came from.
 */
export async function amountOwed(practitionerId: string): Promise<number> {
  const result = await prisma.ledgerEntry.aggregate({
    where: { account: 'PRACTITIONER_EARNINGS', subjectId: practitionerId },
    _sum: { amountKobo: true },
  });
  const balance = result._sum.amountKobo ?? 0;
  // `-0` is what negating a zero balance gives, and it compares unequal to
  // `0` under Object.is — which is the comparison a caller reaching for
  // strict equality will get. Normalised here rather than at every call site.
  return balance === 0 ? 0 : -balance;
}

/**
 * Prepares a payout for everything currently outstanding.
 *
 * Preparing moves no money and writes no ledger entry — the practitioner is
 * already credited; this only proposes clearing it. The ledger is touched
 * when the payout settles, which is the moment the money actually goes.
 */
export async function preparePayout(input: {
  practitionerId: string;
  actorId: string;
}): Promise<PayoutView> {
  const owed = await amountOwed(input.practitionerId);
  if (owed <= 0) throw PayoutErrors.nothingOwed();

  // Anything already prepared or released is money in flight; subtract it or
  // a second press of the button pays the same work twice.
  const inFlight = await prisma.payout.aggregate({
    where: { practitionerId: input.practitionerId, status: { in: ['PREPARED', 'RELEASED'] } },
    _sum: { amountKobo: true },
  });
  const amountKobo = owed - (inFlight._sum.amountKobo ?? 0);
  if (amountKobo <= 0) throw PayoutErrors.nothingOwed();

  return prisma.$transaction(async (tx: Tx) => {
    const payout = await tx.payout.create({
      data: { practitionerId: input.practitionerId, amountKobo },
    });

    await recordAudit(tx, {
      action: 'payout.prepared',
      entityType: 'billing.payouts',
      entityId: payout.id,
      actorId: input.actorId,
      scopeType: 'SELF',
      scopeId: input.practitionerId,
      after: { amountKobo, status: payout.status },
    });

    return toView(payout);
  });
}

/**
 * Releases a prepared payout to the gateway.
 *
 * The ledger entry is written only once the gateway says the money went. A
 * failed send leaves the payout FAILED with the reason on it and the ledger
 * untouched — which is right, because nothing moved, and a ledger that
 * recorded the attempt would be a ledger that disagrees with the bank.
 */
export async function releasePayout(input: {
  payoutId: string;
  actorId: string;
}): Promise<PayoutView> {
  const existing = await prisma.payout.findUnique({ where: { id: input.payoutId } });
  if (!existing) throw PayoutErrors.notFound();
  if (existing.status !== 'PREPARED') {
    throw PayoutErrors.wrongStatus(existing.status, 'RELEASED');
  }

  // Compare-and-set before the send, so two officers releasing at once cannot
  // both reach the gateway with the same payout.
  const claimed = await prisma.payout.updateMany({
    where: { id: input.payoutId, status: 'PREPARED' },
    data: { status: 'RELEASED', releasedBy: input.actorId, releasedAt: new Date() },
  });
  if (claimed.count !== 1) throw PayoutErrors.wrongStatus(existing.status, 'RELEASED');

  let result;
  try {
    result = await sendPayout({
      payoutId: existing.id,
      practitionerId: existing.practitionerId,
      amountKobo: existing.amountKobo,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'The gateway refused the payout.';
    await prisma.$transaction(async (tx: Tx) => {
      await tx.payout.update({
        where: { id: existing.id },
        data: { status: 'FAILED', failureReason: reason },
      });
      await recordAudit(tx, {
        action: 'payout.failed',
        entityType: 'billing.payouts',
        entityId: existing.id,
        actorId: input.actorId,
        scopeType: 'SELF',
        scopeId: existing.practitionerId,
        reason,
        after: { status: 'FAILED' },
      });
    });

    if (error instanceof PaymentGatewayUnavailable) {
      throw PayoutErrors.gatewayUnavailable(error.message);
    }
    throw error;
  }

  return prisma.$transaction(async (tx: Tx) => {
    const payout = await tx.payout.update({
      where: { id: existing.id },
      data: {
        status: result.settled ? 'SETTLED' : 'RELEASED',
        providerReference: result.reference,
        settledAt: result.settled ? new Date() : null,
      },
    });

    if (result.settled) {
      const transactionId = randomUUID();
      const entries = entriesForPayout({
        practitionerId: existing.practitionerId,
        amountKobo: existing.amountKobo,
      });
      await tx.ledgerEntry.createMany({
        data: entries.map((entry) => ({
          transactionId,
          account: entry.account,
          amountKobo: entry.amountKobo,
          subjectId: entry.subjectId,
          memo: entry.memo,
          payoutId: existing.id,
        })),
      });
    }

    await recordAudit(tx, {
      action: result.settled ? 'payout.settled' : 'payout.released',
      entityType: 'billing.payouts',
      entityId: payout.id,
      actorId: input.actorId,
      scopeType: 'SELF',
      scopeId: existing.practitionerId,
      after: { status: payout.status, reference: result.reference },
    });

    if (result.settled) {
      await publishEvent(tx, {
        eventType: EVENTS.PayoutSettled,
        aggregateType: 'billing.payouts',
        aggregateId: payout.id,
        payload: {
          payoutId: payout.id,
          userId: existing.practitionerId,
          amountKobo: existing.amountKobo,
        },
      });
    }

    return toView(payout);
  });
}

export async function listPayouts(practitionerId: string): Promise<PayoutView[]> {
  const rows = await prisma.payout.findMany({
    where: { practitionerId },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(toView);
}
