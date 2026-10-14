import { randomUUID } from 'node:crypto';
import { prisma, type Tx } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { publishEvent } from '@/lib/outbox';
import { EVENTS } from '@/lib/events';
import { HttpError } from '@/lib/http/errors';
import { assignmentsUnderDispute } from '@/modules/disputes/application/dispute';
import { entriesForPayout } from '../domain/ledger';
import { heldForDisputes, netOfLine } from '../domain/holds';
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
  exceedsBalance: () =>
    new HttpError(
      'payout_exceeds_balance',
      'This payout is larger than what the practitioner is owed now. Prepare a new one.',
      409,
    ),
  held: () =>
    new HttpError(
      'payout_held',
      'What this practitioner is owed is on a shift that is in dispute, so it is held until the case is decided or withdrawn.',
      409,
    ),
  wrongStatus: (from: string, to: string) =>
    new HttpError('payout_wrong_status', `A ${from} payout cannot become ${to}.`, 409),
  gatewayUnavailable: (message: string) =>
    new HttpError('payment_gateway_unavailable', message, 503),
  secondApproverRequired: () =>
    new HttpError(
      'second_approver_required',
      'A payout has to be released by someone other than the person who prepared it. Ask a colleague who can manage payouts to release this one.',
      403,
    ),
};

/**
 * Whether the person who prepared a payout is barred from releasing it.
 *
 * On unless the setting says exactly `off`: a typo must not remove a control on
 * moving money. `off` is for a pilot with one person who can do this, and is a
 * decision somebody takes on purpose (UXO-03). Read each time rather than once,
 * so changing it does not wait for a restart and a test can change it.
 */
export function secondApproverRequired(): boolean {
  return process.env.PAYOUT_SECOND_APPROVER !== 'off';
}

export interface PayoutView {
  id: string;
  practitionerId: string;
  amountKobo: number;
  status: string;
  providerReference: string | null;
  failureReason: string | null;
  /**
   * Who prepared it. For staff: the route turns this into "prepared by you" and
   * does not send the identifier to the practitioner the payout is for.
   */
  preparedBy: string | null;
  releasedBy: string | null;
  releasedAt: Date | null;
  settledAt: Date | null;
  createdAt: Date;
}

function toView(row: PayoutView): PayoutView {
  return {
    id: row.id,
    practitionerId: row.practitionerId,
    amountKobo: row.amountKobo,
    status: row.status,
    providerReference: row.providerReference,
    failureReason: row.failureReason,
    preparedBy: row.preparedBy,
    releasedBy: row.releasedBy,
    releasedAt: row.releasedAt,
    settledAt: row.settledAt,
    createdAt: row.createdAt,
  };
}

/**
 * What a practitioner is owed, from the ledger alone.
 *
 * Their earnings account is credited (negative) when work is approved and
 * debited (positive) when they are paid, so what is outstanding is the
 * negative of the balance. Derived rather than stored, so it cannot drift
 * from the entries it came from.
 */
export async function amountOwed(
  practitionerId: string,
  db: Pick<Tx, 'ledgerEntry'> = prisma,
): Promise<number> {
  const result = await db.ledgerEntry.aggregate({
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
 * How much of `unpaidKobo` is on shifts a dispute is open over (BIL-10).
 *
 * Only what was credited for the disputed shift is held; see ./domain/holds.ts
 * for why that is the unpaid part of it and not the practitioner's whole
 * balance. Read at the moment a payout is prepared and again when it is
 * released, so a case raised in between stops it. A case raised in the instants
 * between that second check and the gateway taking the payout is not stopped:
 * the money has gone by then.
 */
async function heldFor(
  db: Pick<Tx, 'invoiceLine'>,
  practitionerId: string,
  unpaidKobo: number,
): Promise<number> {
  if (unpaidKobo <= 0) return 0;

  const lines = await db.invoiceLine.findMany({
    where: { practitionerId, invoice: { status: { not: 'VOID' } } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: { invoice: { select: { grossKobo: true, platformFeeKobo: true } } },
  });
  if (lines.length === 0) return 0;

  const disputed = await assignmentsUnderDispute(lines.map((line) => line.assignmentId));
  return heldForDisputes(
    lines.map((line) => ({
      assignmentId: line.assignmentId,
      netKobo: netOfLine(line, line.invoice),
    })),
    disputed,
    unpaidKobo,
  );
}

/**
 * What a practitioner is owed and how much of it is held for a dispute, for
 * somebody reading their payouts.
 */
export async function payoutPosition(
  practitionerId: string,
): Promise<{ owedKobo: number; heldKobo: number }> {
  const owedKobo = await amountOwed(practitionerId);
  const inFlight = await prisma.payout.aggregate({
    where: { practitionerId, status: { in: ['PREPARED', 'RELEASED'] } },
    _sum: { amountKobo: true },
  });
  const heldKobo = await heldFor(prisma, practitionerId, owedKobo - (inFlight._sum.amountKobo ?? 0));
  return { owedKobo, heldKobo };
}

/**
 * Serialises everything that decides how much a practitioner may be paid.
 *
 * Preparing reads the balance and the money already in flight and then writes
 * a payout; two presses at once both read the same figures and both wrote a
 * payout for the whole amount. Held to the end of the transaction and keyed on
 * the practitioner, so different people never wait on each other. The prefix
 * keeps this key apart from the booking locks, which hash a bare user id.
 */
export async function lockPayouts(tx: Tx, practitionerId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`payout:${practitionerId}`}, 0))`;
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
  return prisma.$transaction(async (tx: Tx) => {
    // The balance and the money in flight are read under the lock, in the same
    // transaction as the write, so a second press waits and then sees the first.
    await lockPayouts(tx, input.practitionerId);

    const owed = await amountOwed(input.practitionerId, tx);
    if (owed <= 0) throw PayoutErrors.nothingOwed();

    // Anything already prepared or released is money in flight; subtract it or
    // a second press of the button pays the same work twice. A FAILED payout is
    // not in flight: the gateway refused it and nothing moved.
    const inFlight = await tx.payout.aggregate({
      where: { practitionerId: input.practitionerId, status: { in: ['PREPARED', 'RELEASED'] } },
      _sum: { amountKobo: true },
    });
    const unpaid = owed - (inFlight._sum.amountKobo ?? 0);
    if (unpaid <= 0) throw PayoutErrors.nothingOwed();

    // What a dispute holds is not paid. Whatever is left is.
    const held = await heldFor(tx, input.practitionerId, unpaid);
    const amountKobo = unpaid - held;
    if (amountKobo <= 0) throw PayoutErrors.held();

    const payout = await tx.payout.create({
      data: { practitionerId: input.practitionerId, amountKobo, preparedBy: input.actorId },
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
  // Two people, not one, between a balance and the bank (UXO-03). Said before
  // anything is claimed or sent, so a refusal leaves the payout as it was.
  if (secondApproverRequired() && existing.preparedBy !== null && existing.preparedBy === input.actorId) {
    throw PayoutErrors.secondApproverRequired();
  }

  // Compare-and-set before the send, so two officers releasing at once cannot
  // both reach the gateway with the same payout. The balance is asked again
  // under the same lock preparing takes: the amount was right when it was
  // prepared, and what is owed can fall between then and now.
  await prisma.$transaction(async (tx: Tx) => {
    await lockPayouts(tx, existing.practitionerId);

    const owed = await amountOwed(existing.practitionerId, tx);
    const alreadyOut = await tx.payout.aggregate({
      where: { practitionerId: existing.practitionerId, status: 'RELEASED', id: { not: existing.id } },
      _sum: { amountKobo: true },
    });
    const unpaid = owed - (alreadyOut._sum.amountKobo ?? 0);
    if (existing.amountKobo > unpaid) throw PayoutErrors.exceedsBalance();

    // A case may have been raised since this was prepared.
    const held = await heldFor(tx, existing.practitionerId, unpaid);
    if (existing.amountKobo > unpaid - held) throw PayoutErrors.held();

    const claimed = await tx.payout.updateMany({
      where: { id: input.payoutId, status: 'PREPARED' },
      data: { status: 'RELEASED', releasedBy: input.actorId, releasedAt: new Date() },
    });
    if (claimed.count !== 1) throw PayoutErrors.wrongStatus(existing.status, 'RELEASED');
  });

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
          // So whoever tells the practitioner can tell a payment from a rehearsal.
          reference: result.reference,
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
