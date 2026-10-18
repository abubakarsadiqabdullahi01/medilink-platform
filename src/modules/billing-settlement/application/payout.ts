import { randomUUID } from 'node:crypto';
import { prisma, type Tx } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { publishEvent } from '@/lib/outbox';
import { EVENTS } from '@/lib/events';
import { HttpError } from '@/lib/http/errors';
import { assignmentsUnderDispute } from '@/modules/disputes/application/dispute';
import { lagosDate } from '@/lib/lagos-date';
import { entriesForPayout } from '../domain/ledger';
import { heldForDisputes, netOfLine } from '../domain/holds';
import { collectionRequired, payableKobo } from '../domain/payable';
import { accountStanding, type AccountState } from './payout-account';
import { transferProblem, type TransferProblem } from '../domain/transfer';
import { PaymentGatewayUnavailable, paidByHand, sendPayout } from '../infrastructure/gateway';

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
  nothingCollected: () =>
    new HttpError(
      'nothing_collected',
      'The facilities this practitioner worked for have not paid for this work yet, so there is nothing collected to pay it out of. It can be paid once the invoice is recorded as paid.',
      409,
    ),
  noAccount: (unverified: boolean) =>
    new HttpError(
      'no_payout_account',
      unverified
        ? 'The bank account this practitioner gave has not been verified yet. Check it first, then prepare the payout.'
        : 'This practitioner has not given a bank account to be paid into. They can add one on their earnings page.',
      409,
    ),
  accountCoolingOff: (readyAt: Date) =>
    new HttpError(
      'payout_account_cooling_off',
      `This practitioner's bank account is new, and nothing is paid to a new account for a while after it is added. It can be paid from ${readyAt.toISOString().slice(0, 16).replace('T', ' ')} UTC.`,
      409,
    ),
  accountChanged: () =>
    new HttpError(
      'payout_account_changed',
      'The practitioner\'s bank account has changed since this payout was prepared. Cancel it and prepare a new one, so it goes to the account that is verified now.',
      409,
    ),
  notByHand: () =>
    new HttpError(
      'payout_not_by_hand',
      'Payouts are completed by the payment gateway here, not recorded by hand. Recording a transfer as well would pay the practitioner twice.',
      409,
    ),
  transfer: (problem: TransferProblem) => new HttpError(...transferError(problem)),
  reasonRequired: () =>
    new HttpError('payout_reason_required', 'Say why (a few words is enough).', 422),
  secondApproverRequired: () =>
    new HttpError(
      'second_approver_required',
      'A payout has to be released by someone other than the person who prepared it. Ask a colleague who can manage payouts to release this one.',
      403,
    ),
};

function transferError(problem: TransferProblem): [string, string, number] {
  switch (problem) {
    case 'reference':
      return ['transfer_invalid', 'Enter the bank\'s reference for the transfer (3 to 100 characters).', 422];
    case 'date':
      return ['transfer_invalid', 'Enter the date the money left the bank, as year-month-day.', 422];
    case 'future':
      return ['transfer_invalid', 'The transfer cannot be dated in the future.', 422];
    case 'before_release':
      return [
        'transfer_invalid',
        'The transfer cannot be dated before the payout was released. Check the date on the bank statement.',
        422,
      ];
  }
}

/**
 * Whether a payout is sized from what facilities have paid, or from what they
 * have been billed.
 *
 * On unless the setting says exactly `off`, for the reason the second-approver
 * rule is: a typo must not remove a control on moving money. Off is for a
 * platform that pays practitioners from its own funds and recovers it from
 * facilities later, which is a commercial decision somebody takes on purpose
 * (BIL-03). Read each time, so a test can change it.
 */
export function collectionIsRequired(): boolean {
  return collectionRequired(process.env.PAYOUT_REQUIRES_COLLECTION);
}

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
  /** The date a transfer made by hand left the bank. Null for a gateway payout. */
  paidOn: Date | null;
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
    paidOn: row.paidOn,
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
 * How much of what a practitioner is owed can be paid out of money that has
 * arrived (BIL-03).
 *
 * A practitioner is credited when work is invoiced, which is when the facility is
 * billed, not when it pays. Paying them from that credit pays out cash the
 * platform does not have. What has been collected is what was credited on invoices
 * a facility has paid; what has gone out already is every payout that settled.
 * Both come from the ledger, so neither can drift from the entries it came from.
 */
async function payableByCollection(
  db: Pick<Tx, 'invoice' | 'ledgerEntry'>,
  practitionerId: string,
  owedKobo: number,
): Promise<number> {
  const required = collectionIsRequired();
  if (!required) return payableKobo({ owedKobo, collectedKobo: 0, paidOutKobo: 0, required });

  const paidInvoices = await db.invoice.findMany({
    where: { status: 'PAID', lines: { some: { practitionerId } } },
    select: { id: true },
  });
  const credited = await db.ledgerEntry.aggregate({
    where: {
      account: 'PRACTITIONER_EARNINGS',
      subjectId: practitionerId,
      invoiceId: { in: paidInvoices.map((invoice) => invoice.id) },
    },
    _sum: { amountKobo: true },
  });
  const paidOut = await db.ledgerEntry.aggregate({
    where: { account: 'PRACTITIONER_EARNINGS', subjectId: practitionerId, payoutId: { not: null } },
    _sum: { amountKobo: true },
  });

  return payableKobo({
    owedKobo,
    // Credits are negative on this account and payouts positive.
    collectedKobo: -(credited._sum.amountKobo ?? 0),
    paidOutKobo: paidOut._sum.amountKobo ?? 0,
    required,
  });
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
export async function payoutPosition(practitionerId: string): Promise<{
  owedKobo: number;
  heldKobo: number;
  /** What a payout prepared now would be for: collected, not in flight, not held. */
  payableKobo: number;
  /** What is owed that the facilities have not yet paid for. */
  awaitingKobo: number;
  /** Whether there is somewhere to pay them, and if not, why (BIL-06). */
  account: { state: AccountState; readyAt: Date | null };
}> {
  const owedKobo = await amountOwed(practitionerId);
  const inFlight = await prisma.payout.aggregate({
    where: { practitionerId, status: { in: ['PREPARED', 'RELEASED'] } },
    _sum: { amountKobo: true },
  });
  const inFlightKobo = inFlight._sum.amountKobo ?? 0;
  const unpaidKobo = owedKobo - inFlightKobo;
  const heldKobo = await heldFor(prisma, practitionerId, unpaidKobo);
  const collectedKobo = await payableByCollection(prisma, practitionerId, owedKobo);
  return {
    owedKobo,
    heldKobo,
    payableKobo: Math.max(0, Math.min(unpaidKobo - heldKobo, collectedKobo - inFlightKobo)),
    awaitingKobo: Math.max(0, owedKobo - collectedKobo),
    account: await accountStanding(prisma, practitionerId).then(({ state, readyAt }) => ({ state, readyAt })),
  };
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
 * Where a payout may go, or why it may not (BIL-06). Not required: nowhere is named.
 * Otherwise the practitioner's verified account, once it is old enough, and the id of
 * it is what a payout is prepared for and checked against at release.
 */
async function destinationFor(tx: Tx, practitionerId: string): Promise<string | null> {
  const standing = await accountStanding(tx, practitionerId);
  switch (standing.state) {
    case 'not_required':
      return null;
    case 'ready':
      return standing.accountId;
    case 'cooling_off':
      throw PayoutErrors.accountCoolingOff(standing.readyAt!);
    case 'missing':
      throw PayoutErrors.noAccount(false);
    case 'unverified':
      throw PayoutErrors.noAccount(true);
  }
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
    const inFlightKobo = inFlight._sum.amountKobo ?? 0;
    const unpaid = owed - inFlightKobo;
    if (unpaid <= 0) throw PayoutErrors.nothingOwed();

    // Only what facilities have paid for can go out, however much is owed.
    const collected = (await payableByCollection(tx, input.practitionerId, owed)) - inFlightKobo;
    if (collected <= 0) throw PayoutErrors.nothingCollected();

    // Only to an account a person has checked.
    const accountId = await destinationFor(tx, input.practitionerId);

    // What a dispute holds is not paid. Whatever is left is, up to what has arrived.
    const held = await heldFor(tx, input.practitionerId, unpaid);
    const amountKobo = Math.min(unpaid - held, collected);
    if (amountKobo <= 0) throw PayoutErrors.held();

    const payout = await tx.payout.create({
      data: { practitionerId: input.practitionerId, amountKobo, preparedBy: input.actorId, accountId },
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

    // Still to the account that is verified now? One changed since this was prepared
    // is not paid to, however the payout got here.
    const destination = await destinationFor(tx, existing.practitionerId);
    if (destination !== null && existing.accountId !== null && existing.accountId !== destination) {
      throw PayoutErrors.accountChanged();
    }

    const owed = await amountOwed(existing.practitionerId, tx);
    const alreadyOut = await tx.payout.aggregate({
      where: { practitionerId: existing.practitionerId, status: 'RELEASED', id: { not: existing.id } },
      _sum: { amountKobo: true },
    });
    const unpaid = owed - (alreadyOut._sum.amountKobo ?? 0);
    if (existing.amountKobo > unpaid) throw PayoutErrors.exceedsBalance();

    // The rule may have been switched on since this was prepared, and an invoice
    // is never un-paid but a void or a reversal can still change what was collected.
    const collected = (await payableByCollection(tx, existing.practitionerId, owed)) - (alreadyOut._sum.amountKobo ?? 0);
    if (existing.amountKobo > collected) throw PayoutErrors.nothingCollected();

    // A case may have been raised since this was prepared.
    const held = await heldFor(tx, existing.practitionerId, unpaid);
    if (existing.amountKobo > unpaid - held) throw PayoutErrors.held();

    const claimed = await tx.payout.updateMany({
      where: { id: input.payoutId, status: 'PREPARED' },
      data: { status: 'RELEASED', releasedBy: input.actorId, releasedAt: new Date() },
    });
    if (claimed.count !== 1) throw PayoutErrors.wrongStatus(existing.status, 'RELEASED');

    // Who authorised it, written with the claim and not after the send. What follows (the
    // gateway's answer) is a second row in another transaction, and a process that stops between
    // the two would otherwise leave a released payout with nothing on the trail saying by whom
    // (M17-01).
    await recordAudit(tx, {
      action: 'payout.release_started',
      entityType: 'billing.payouts',
      entityId: existing.id,
      actorId: input.actorId,
      scopeType: 'SELF',
      scopeId: existing.practitionerId,
      before: { status: 'PREPARED' },
      after: { status: 'RELEASED' },
    });
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

/**
 * The refusal for somebody who lost a race: what the payout is now, read inside the
 * lock, so they are told what the winner did rather than what they expected.
 */
async function lostRace(tx: Tx, payoutId: string, to: string): Promise<HttpError> {
  const current = await tx.payout.findUnique({ where: { id: payoutId }, select: { status: true } });
  return current ? PayoutErrors.wrongStatus(current.status, to) : PayoutErrors.notFound();
}

/**
 * Records the bank transfer for a payout finance made by hand, which completes it
 * (BIL-05).
 *
 * With no gateway, releasing is the decision to pay and moves nothing. Finance make
 * the transfer from the bank and say here which one it was, and that is the moment
 * the ledger is written: a ledger that recorded the release would disagree with the
 * bank until somebody got round to the transfer, and for as long as they did not.
 *
 * The reference and date are checked and kept on the payout; the audit row carries
 * the date and not the reference, which on a transfer often names a person.
 */
export async function settlePayout(input: {
  payoutId: string;
  actorId: string;
  /** The bank's own reference for the transfer. */
  bankReference: string;
  /** The date the money left the bank, `YYYY-MM-DD`. */
  paidOn: string;
  now?: Date;
}): Promise<PayoutView> {
  const existing = await prisma.payout.findUnique({ where: { id: input.payoutId } });
  if (!existing) throw PayoutErrors.notFound();
  if (existing.status !== 'RELEASED') throw PayoutErrors.wrongStatus(existing.status, 'SETTLED');
  if (!paidByHand()) throw PayoutErrors.notByHand();

  const now = input.now ?? new Date();
  const problem = transferProblem(
    { reference: input.bankReference, paidOn: input.paidOn },
    { releasedOn: existing.releasedAt ? lagosDate(existing.releasedAt) : null },
    now,
  );
  if (problem) throw PayoutErrors.transfer(problem);

  const reference = input.bankReference.trim();

  return prisma.$transaction(async (tx: Tx) => {
    await lockPayouts(tx, existing.practitionerId);

    // Compare-and-set, so two people recording the same transfer at once write one
    // set of entries and the second is told it is already done.
    const claimed = await tx.payout.updateMany({
      where: { id: existing.id, status: 'RELEASED' },
      data: {
        status: 'SETTLED',
        providerReference: reference,
        settledAt: now,
        paidOn: new Date(`${input.paidOn}T00:00:00.000Z`),
      },
    });
    if (claimed.count !== 1) throw await lostRace(tx, existing.id, 'SETTLED');

    const transactionId = randomUUID();
    await tx.ledgerEntry.createMany({
      data: entriesForPayout({
        practitionerId: existing.practitionerId,
        amountKobo: existing.amountKobo,
      }).map((entry) => ({
        transactionId,
        account: entry.account,
        amountKobo: entry.amountKobo,
        subjectId: entry.subjectId,
        memo: entry.memo,
        payoutId: existing.id,
      })),
    });

    const payout = await tx.payout.findUniqueOrThrow({ where: { id: existing.id } });

    await recordAudit(tx, {
      action: 'payout.settled',
      entityType: 'billing.payouts',
      entityId: payout.id,
      actorId: input.actorId,
      scopeType: 'SELF',
      scopeId: existing.practitionerId,
      after: { status: payout.status, paidOn: input.paidOn, referenceRecorded: true },
    });

    await publishEvent(tx, {
      eventType: EVENTS.PayoutSettled,
      aggregateType: 'billing.payouts',
      aggregateId: payout.id,
      payload: {
        payoutId: payout.id,
        userId: existing.practitionerId,
        amountKobo: existing.amountKobo,
        reference,
      },
    });

    return toView(payout);
  });
}

/**
 * Records that a released payout did not reach the practitioner, so it stops being
 * money in flight and can be prepared again. Nothing was written to the ledger when
 * it was released, so nothing is written now.
 */
export async function failPayout(input: {
  payoutId: string;
  actorId: string;
  reason: string;
}): Promise<PayoutView> {
  const reason = input.reason.trim();
  if (reason.length === 0) throw PayoutErrors.reasonRequired();

  const existing = await prisma.payout.findUnique({ where: { id: input.payoutId } });
  if (!existing) throw PayoutErrors.notFound();
  if (existing.status !== 'RELEASED') throw PayoutErrors.wrongStatus(existing.status, 'FAILED');
  if (!paidByHand()) throw PayoutErrors.notByHand();

  return prisma.$transaction(async (tx: Tx) => {
    await lockPayouts(tx, existing.practitionerId);

    const claimed = await tx.payout.updateMany({
      where: { id: existing.id, status: 'RELEASED' },
      data: { status: 'FAILED', failureReason: reason },
    });
    if (claimed.count !== 1) throw await lostRace(tx, existing.id, 'FAILED');

    const payout = await tx.payout.findUniqueOrThrow({ where: { id: existing.id } });
    await recordAudit(tx, {
      action: 'payout.failed',
      entityType: 'billing.payouts',
      entityId: payout.id,
      actorId: input.actorId,
      scopeType: 'SELF',
      scopeId: existing.practitionerId,
      reason,
      before: { status: existing.status },
      after: { status: 'FAILED' },
    });
    return toView(payout);
  });
}

/**
 * Withdraws a prepared payout before anybody has released it, which frees what it
 * was holding. A released payout is not cancelled: finance may already have made
 * the transfer, so it is recorded as settled or as failed, whichever is true.
 */
export async function cancelPayout(input: {
  payoutId: string;
  actorId: string;
  reason: string;
}): Promise<PayoutView> {
  const reason = input.reason.trim();
  if (reason.length === 0) throw PayoutErrors.reasonRequired();

  const existing = await prisma.payout.findUnique({ where: { id: input.payoutId } });
  if (!existing) throw PayoutErrors.notFound();
  if (existing.status !== 'PREPARED') throw PayoutErrors.wrongStatus(existing.status, 'CANCELLED');

  return prisma.$transaction(async (tx: Tx) => {
    await lockPayouts(tx, existing.practitionerId);

    const claimed = await tx.payout.updateMany({
      where: { id: existing.id, status: 'PREPARED' },
      data: { status: 'CANCELLED' },
    });
    if (claimed.count !== 1) throw await lostRace(tx, existing.id, 'CANCELLED');

    const payout = await tx.payout.findUniqueOrThrow({ where: { id: existing.id } });
    await recordAudit(tx, {
      action: 'payout.cancelled',
      entityType: 'billing.payouts',
      entityId: payout.id,
      actorId: input.actorId,
      scopeType: 'SELF',
      scopeId: existing.practitionerId,
      reason,
      before: { status: existing.status },
      after: { status: 'CANCELLED' },
    });
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


/**
 * A practitioner's money in one glance, for the dashboard: what the ledger says they are owed
 * (`payoutPosition`, the same figure the Earnings page opens with), what is on its way, and what
 * has been paid. Their own records only; the route that serves it holds `invoice.read` at SELF,
 * exactly as `GET /api/v1/payouts?scopeType=SELF` does.
 */
export interface EarningsSummary {
  owedKobo: number;
  heldKobo: number;
  awaitingKobo: number;
  /** Prepared or released, not yet confirmed received. */
  inFlightKobo: number;
  /** Every payment confirmed, all time. */
  paidKobo: number;
  lastPaidAt: Date | null;
}

export async function earningsSummary(practitionerId: string): Promise<EarningsSummary> {
  const [payouts, position] = await Promise.all([listPayouts(practitionerId), payoutPosition(practitionerId)]);
  const settled = payouts.filter((row) => row.status === 'SETTLED');
  return {
    ...position,
    inFlightKobo: payouts
      .filter((row) => row.status === 'PREPARED' || row.status === 'RELEASED')
      .reduce((sum, row) => sum + row.amountKobo, 0),
    paidKobo: settled.reduce((sum, row) => sum + row.amountKobo, 0),
    lastPaidAt: settled.reduce<Date | null>((latest, row) => {
      const at = row.settledAt ? new Date(row.settledAt) : null;
      return at && (!latest || at > latest) ? at : latest;
    }, null),
  };
}
