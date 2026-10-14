import { randomUUID } from 'node:crypto';
import { prisma, type Tx } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { publishEvent } from '@/lib/outbox';
import { EVENTS } from '@/lib/events';
import { HttpError } from '@/lib/http/errors';
import { lagosDate } from '@/lib/lagos-date';
import { lockPayouts } from './payout';
import { paymentProblem, type PaymentProblem } from '../domain/payment';
import { termsOfBooking } from '@/modules/rates-contracts/application/rate-card';
import { priceStoredTimesheet } from '@/modules/rates-contracts/domain/pricing';
import {
  PLATFORM_FEE_UNSET_BP,
  entriesForApprovedWork,
  entriesForPayment,
  entriesForVoidedWork,
  platformFeeKobo,
  type LedgerEntry,
} from '../domain/ledger';

/**
 * Module 12: what a facility owes, and the ledger that records it.
 *
 * An invoice is raised from work that has already been approved — never from
 * a timesheet still under review — so nothing here can bill for hours the
 * facility has not accepted.
 *
 * **The platform fee is zero until step 3.1.** The arithmetic, the ledger
 * account and the column all exist; the rate is configuration with no
 * default, because what Medilink charges and who bears it is a commercial
 * decision and not one to discover in a source file.
 */

export const InvoiceErrors = {
  notFound: () => new HttpError('invoice_not_found', 'That invoice does not exist.', 404),
  nothingToBill: () =>
    new HttpError(
      'nothing_to_bill',
      'No approved shifts in that period are waiting to be invoiced.',
      409,
    ),
  wrongStatus: (from: string, to: string) =>
    new HttpError('invoice_wrong_status', `A ${from} invoice cannot become ${to}.`, 409),
  payment: (problem: PaymentProblem, grossKobo: number) =>
    new HttpError(...paymentError(problem, grossKobo)),
  paidOut: () =>
    new HttpError(
      'invoice_paid_out',
      'A payout has been prepared or made for a practitioner on this invoice since it was raised, so it cannot be voided. Resolve the payout first.',
      409,
    ),
};

const naira = (kobo: number) => `₦${(kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

function paymentError(problem: PaymentProblem, grossKobo: number): [string, string, number] {
  switch (problem) {
    case 'reference':
      return ['payment_reference_required', 'Enter the bank\'s reference for the transfer (3 to 100 characters).', 422];
    case 'payer':
      return ['payment_payer_required', 'Enter who paid, as the bank statement names them.', 422];
    case 'amount':
      return [
        'payment_amount_mismatch',
        `The amount must be what the invoice comes to, ${naira(grossKobo)}. Part payments, over-payments and one transfer covering several invoices are not supported yet; do not record them as paid in full.`,
        422,
      ];
    case 'date':
      return ['payment_date_invalid', 'Enter the date the money arrived, as year-month-day.', 422];
    case 'future':
      return ['payment_date_invalid', 'The date the money arrived cannot be in the future.', 422];
    case 'before_issue':
      return ['payment_date_invalid', 'The money cannot have arrived before the invoice was issued.', 422];
  }
}

/** Read from configuration, so 3.1 is a deployment decision rather than a deploy. */
function platformFeeBp(): number {
  const parsed = Number(process.env.PLATFORM_FEE_BP);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : PLATFORM_FEE_UNSET_BP;
}

export interface InvoiceLineView {
  assignmentId: string;
  practitionerId: string;
  hourlyRateKobo: number;
  ordinaryMinutes: number;
  nightMinutes: number;
  holidayMinutes: number;
  overtimeMinutes: number;
  onCallMinutes: number;
  baseKobo: number;
  premiumKobo: number;
  amountKobo: number;
}

export interface InvoiceView {
  id: string;
  facilityId: string;
  number: string;
  periodStart: Date;
  periodEnd: Date;
  grossKobo: number;
  platformFeeKobo: number;
  status: string;
  issuedAt: Date | null;
  paidAt: Date | null;
  /** The bank's reference for the transfer, as recorded when it was marked paid. */
  paymentReference: string | null;
  paymentAmountKobo: number | null;
  /** The date the money arrived, `YYYY-MM-DD`. */
  paidOn: string | null;
  payerName: string | null;
  lines: InvoiceLineView[];
}

interface InvoiceRow extends Omit<InvoiceView, 'lines' | 'paidOn'> {
  paidOn: Date | null;
  lines: InvoiceLineView[];
}

function toView(row: InvoiceRow): InvoiceView {
  return { ...row, paidOn: row.paidOn?.toISOString().slice(0, 10) ?? null, lines: row.lines };
}

/** Writes one balanced transaction. `entriesFor*` has already refused it if it does not balance. */
async function postTransaction(
  tx: Tx,
  entries: LedgerEntry[],
  link: { invoiceId?: string; payoutId?: string },
): Promise<string> {
  const transactionId = randomUUID();
  await tx.ledgerEntry.createMany({
    data: entries.map((entry) => ({
      transactionId,
      account: entry.account,
      amountKobo: entry.amountKobo,
      subjectId: entry.subjectId,
      memo: entry.memo,
      invoiceId: link.invoiceId ?? null,
      payoutId: link.payoutId ?? null,
    })),
  });
  return transactionId;
}

/** One line as it is written, before the invoice that holds it exists. */
interface InvoiceLineData extends InvoiceLineView {
  rateCardId: string | null;
}

export interface GenerateInvoiceParams {
  facilityId: string;
  periodStart: Date;
  periodEnd: Date;
  actorId: string;
}

/**
 * Raises a draft invoice for every approved shift in the period not already
 * on one.
 *
 * `assignmentId` is unique on `invoice_lines`, so a shift cannot be billed
 * twice even if two people press the button at the same moment: the second
 * transaction fails on the constraint rather than quietly double-charging.
 */
export async function generateInvoice(input: GenerateInvoiceParams): Promise<InvoiceView> {
  const approved = await prisma.attendanceRecord.findMany({
    where: {
      status: 'APPROVED',
      assignment: {
        facilityId: input.facilityId,
        startsAt: { gte: input.periodStart, lt: input.periodEnd },
      },
    },
    include: { assignment: true, timesheet: true },
  });

  const alreadyBilled = new Set(
    (
      await prisma.invoiceLine.findMany({
        // A voided line no longer counts: its shift can be invoiced again.
        where: { assignmentId: { in: approved.map((row) => row.assignmentId) }, voidedAt: null },
        select: { assignmentId: true },
      })
    ).map((row) => row.assignmentId),
  );

  const billable = approved.filter(
    (row) => row.timesheet !== null && !alreadyBilled.has(row.assignmentId),
  );
  if (billable.length === 0) throw InvoiceErrors.nothingToBill();

  // Each shift is priced on the terms fixed when it was booked. A booking made
  // before terms were kept has none, and is priced on the card in force on the
  // shift's date - which is what the card's own dates meant. This used to be one
  // card, "the active one", for every shift on the invoice, so a facility could
  // replace its card between booking and billing and change what was agreed.
  const lines: InvoiceLineData[] = [];
  for (const row of billable) {
    const sheet = row.timesheet!;
    const terms = await termsOfBooking({
      facilityId: input.facilityId,
      startsAt: row.assignment.startsAt,
      rateTerms: row.assignment.rateTerms,
    });
    const { bands, priced } = priceStoredTimesheet(sheet, terms);

    lines.push({
      assignmentId: row.assignmentId,
      rateCardId: terms.rateCardId,
      practitionerId: row.assignment.userId,
      hourlyRateKobo: sheet.hourlyRateKobo,
      ...bands,
      overtimeMinutes: sheet.overtimeMinutes,
      onCallMinutes: sheet.onCallMinutes,
      baseKobo: priced.baseKobo,
      premiumKobo: priced.premiumKobo,
      amountKobo: priced.totalKobo,
    });
  }

  const grossKobo = lines.reduce((total, line) => total + line.amountKobo, 0);
  const feeKobo = platformFeeKobo(grossKobo, platformFeeBp());
  const number = `INV-${new Date().getUTCFullYear()}-${Date.now().toString(36).toUpperCase()}`;

  return prisma.$transaction(async (tx: Tx) => {
    const invoice = await tx.invoice.create({
      data: {
        facilityId: input.facilityId,
        number,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        grossKobo,
        platformFeeKobo: feeKobo,
        createdBy: input.actorId,
        lines: { create: lines },
      },
      include: { lines: true },
    });

    /**
     * One balanced transaction per shift rather than one for the invoice, so
     * a practitioner's earnings trace to the shift that produced them rather
     * than to a lump sum. The fee is apportioned by line and the remainder
     * left with the practitioners, for the reason `platformFeeKobo` rounds
     * down: a rounding error is never taken from the person who did the work.
     */
    for (const line of invoice.lines) {
      const share = grossKobo === 0 ? 0 : Math.floor((feeKobo * line.amountKobo) / grossKobo);
      await postTransaction(
        tx,
        entriesForApprovedWork({
          facilityId: input.facilityId,
          practitionerId: line.practitionerId,
          grossKobo: line.amountKobo,
          platformFeeKobo: share,
        }),
        { invoiceId: invoice.id },
      );
    }

    await recordAudit(tx, {
      action: 'invoice.created',
      entityType: 'billing.invoices',
      entityId: invoice.id,
      actorId: input.actorId,
      scopeType: 'FACILITY',
      scopeId: input.facilityId,
      after: { number, grossKobo, platformFeeKobo: feeKobo, lines: invoice.lines.length },
    });

    await publishEvent(tx, {
      eventType: EVENTS.InvoiceCreated,
      aggregateType: 'billing.invoices',
      aggregateId: invoice.id,
      payload: { invoiceId: invoice.id, facilityId: input.facilityId, grossKobo },
    });

    return toView(invoice);
  });
}

/**
 * Cancels a draft invoice and reverses what the ledger credited for it (BIL-08).
 *
 * Only a draft: an issued invoice has been put to the facility as a bill, and
 * taking one back is a credit note, which needs the commercial decisions the
 * money model has not yet made. Nothing is deleted. The original entries stay
 * and a reversing transaction cancels each one, the lines are marked void so
 * their shifts can be invoiced again, and the reason is on the audit row.
 *
 * Refused once a payout has been prepared or made for any practitioner on it
 * since it was raised, because the practitioner was credited the moment the
 * draft was raised and that credit may already have been paid out; reversing it
 * would take it from a balance that no longer holds it.
 */
export async function voidInvoice(input: {
  invoiceId: string;
  actorId: string;
  reason: string;
}): Promise<InvoiceView> {
  return prisma.$transaction(async (tx: Tx) => {
    // Locked first, so a void and an issue pressed together take turns and the
    // loser sees what the winner did.
    await tx.$executeRaw`SELECT 1 FROM billing.invoices WHERE id = ${input.invoiceId}::uuid FOR UPDATE`;
    const existing = await tx.invoice.findUnique({ where: { id: input.invoiceId } });
    if (!existing) throw InvoiceErrors.notFound();
    if (existing.status !== 'DRAFT') throw InvoiceErrors.wrongStatus(existing.status, 'VOID');

    const lines = await tx.invoiceLine.findMany({
      where: { invoiceId: existing.id, voidedAt: null },
      orderBy: { id: 'asc' },
    });

    // Payouts are decided under this lock, in a fixed order so two voids over the
    // same people cannot wait on each other.
    const practitioners = [...new Set(lines.map((line) => line.practitionerId))].sort();
    for (const practitionerId of practitioners) await lockPayouts(tx, practitionerId);

    const moved = await tx.payout.count({
      where: {
        practitionerId: { in: practitioners },
        status: { in: ['PREPARED', 'RELEASED', 'SETTLED'] },
        createdAt: { gte: existing.createdAt },
      },
    });
    if (moved > 0) throw InvoiceErrors.paidOut();

    const applied = await tx.invoice.updateMany({
      where: { id: existing.id, status: 'DRAFT' },
      data: { status: 'VOID' },
    });
    if (applied.count !== 1) throw InvoiceErrors.wrongStatus(existing.status, 'VOID');
    await tx.invoiceLine.updateMany({
      where: { invoiceId: existing.id, voidedAt: null },
      data: { voidedAt: new Date() },
    });

    // The same apportionment the credit used, so each reversal is its credit.
    for (const line of lines) {
      const share =
        existing.grossKobo === 0
          ? 0
          : Math.floor((existing.platformFeeKobo * line.amountKobo) / existing.grossKobo);
      await postTransaction(
        tx,
        entriesForVoidedWork({
          facilityId: existing.facilityId,
          practitionerId: line.practitionerId,
          grossKobo: line.amountKobo,
          platformFeeKobo: share,
        }),
        { invoiceId: existing.id },
      );
    }

    await recordAudit(tx, {
      action: 'invoice.voided',
      entityType: 'billing.invoices',
      entityId: existing.id,
      actorId: input.actorId,
      scopeType: 'FACILITY',
      scopeId: existing.facilityId,
      reason: input.reason,
      before: { status: existing.status, grossKobo: existing.grossKobo },
      after: { status: 'VOID' },
    });

    const invoice = await tx.invoice.findUniqueOrThrow({
      where: { id: existing.id },
      include: { lines: true },
    });
    return toView(invoice);
  });
}

/** A draft becomes an invoice somebody can be asked to pay. */
export async function issueInvoice(input: {
  invoiceId: string;
  actorId: string;
}): Promise<InvoiceView> {
  const existing = await prisma.invoice.findUnique({ where: { id: input.invoiceId } });
  if (!existing) throw InvoiceErrors.notFound();
  if (existing.status !== 'DRAFT') throw InvoiceErrors.wrongStatus(existing.status, 'ISSUED');

  return prisma.$transaction(async (tx: Tx) => {
    const applied = await tx.invoice.updateMany({
      where: { id: input.invoiceId, status: 'DRAFT' },
      data: { status: 'ISSUED', issuedAt: new Date() },
    });
    if (applied.count !== 1) throw InvoiceErrors.wrongStatus(existing.status, 'ISSUED');

    const invoice = await tx.invoice.findUniqueOrThrow({
      where: { id: input.invoiceId },
      include: { lines: true },
    });

    await recordAudit(tx, {
      action: 'invoice.issued',
      entityType: 'billing.invoices',
      entityId: invoice.id,
      actorId: input.actorId,
      scopeType: 'FACILITY',
      scopeId: invoice.facilityId,
      before: { status: existing.status },
      after: { status: invoice.status },
    });

    // The facility is told when the bill is ready, which is now and not when the
    // draft was raised: a draft is still being checked.
    await publishEvent(tx, {
      eventType: EVENTS.InvoiceIssued,
      aggregateType: 'billing.invoices',
      aggregateId: invoice.id,
      payload: {
        invoiceId: invoice.id,
        facilityId: invoice.facilityId,
        number: invoice.number,
        grossKobo: invoice.grossKobo,
      },
    });

    return toView(invoice);
  });
}

/**
 * Records that a facility has paid.
 *
 * **This records a payment; it does not take one.** Capturing money needs a
 * provider, which is step 3.3 and unsettled — so an operator marks an invoice
 * paid against a bank transfer they can see, which is how a pilot actually
 * runs before a gateway exists.
 */
export async function recordPayment(input: {
  invoiceId: string;
  actorId: string;
  /** The bank's own reference for the transfer. */
  reference: string;
  /** What arrived. Must equal the invoice: there is no model for part payments. */
  amountKobo: number;
  /** The date the money arrived, `YYYY-MM-DD`. */
  paidOn: string;
  /** Who paid, as the bank statement names them. */
  payerName: string;
  now?: Date;
}): Promise<InvoiceView> {
  const existing = await prisma.invoice.findUnique({ where: { id: input.invoiceId } });
  if (!existing) throw InvoiceErrors.notFound();
  if (existing.status !== 'ISSUED') throw InvoiceErrors.wrongStatus(existing.status, 'PAID');

  // Checked before anything is written, and against what the invoice says rather
  // than what the screen showed: the amount the person types is the check.
  const now = input.now ?? new Date();
  const problem = paymentProblem(
    {
      reference: input.reference,
      amountKobo: input.amountKobo,
      paidOn: input.paidOn,
      payerName: input.payerName,
    },
    { grossKobo: existing.grossKobo, issuedOn: existing.issuedAt ? lagosDate(existing.issuedAt) : null },
    now,
  );
  if (problem) throw InvoiceErrors.payment(problem, existing.grossKobo);

  return prisma.$transaction(async (tx: Tx) => {
    const applied = await tx.invoice.updateMany({
      where: { id: input.invoiceId, status: 'ISSUED' },
      data: {
        status: 'PAID',
        paidAt: now,
        paymentReference: input.reference.trim(),
        paymentAmountKobo: input.amountKobo,
        paidOn: new Date(`${input.paidOn}T00:00:00.000Z`),
        payerName: input.payerName.trim(),
      },
    });
    if (applied.count !== 1) throw InvoiceErrors.wrongStatus(existing.status, 'PAID');

    await postTransaction(
      tx,
      entriesForPayment({ facilityId: existing.facilityId, amountKobo: existing.grossKobo }),
      { invoiceId: existing.id },
    );

    const invoice = await tx.invoice.findUniqueOrThrow({
      where: { id: input.invoiceId },
      include: { lines: true },
    });

    // The amount and the date, and not who paid or the bank's reference: a
    // reference often carries the payer's name, and the audit trail is kept for
    // good. Both are on the invoice, which is the billing record.
    await recordAudit(tx, {
      action: 'invoice.paid',
      entityType: 'billing.invoices',
      entityId: invoice.id,
      actorId: input.actorId,
      scopeType: 'FACILITY',
      scopeId: invoice.facilityId,
      after: { status: invoice.status, amountKobo: invoice.grossKobo, paidOn: input.paidOn, referenceRecorded: true },
    });

    await publishEvent(tx, {
      eventType: EVENTS.PaymentCompleted,
      aggregateType: 'billing.invoices',
      aggregateId: invoice.id,
      payload: {
        invoiceId: invoice.id,
        facilityId: invoice.facilityId,
        amountKobo: invoice.grossKobo,
      },
    });

    return toView(invoice);
  });
}

export async function getInvoice(invoiceId: string): Promise<InvoiceView> {
  const row = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { lines: true },
  });
  if (!row) throw InvoiceErrors.notFound();
  return toView(row);
}

export interface InvoiceLineWithPractitioner extends InvoiceLineView {
  practitionerName: string;
}

export interface InvoiceQueueRow extends Omit<InvoiceView, 'lines'> {
  lines: InvoiceLineWithPractitioner[];
}

export interface InvoicePage {
  invoices: InvoiceQueueRow[];
  nextCursor: string | null;
  /**
   * What is owed and what has been paid across *all* of a facility's invoices,
   * not just this page: a figure summed from the rows on screen would shrink
   * and change as somebody paged, and a finance officer reads it as the debt.
   */
  totals: { outstandingKobo: number; outstandingCount: number; paidKobo: number };
}

export interface ListInvoicesOptions {
  limit?: number;
  cursor?: string;
  /** Leave drafts out: a draft is still being put together and is not a bill. */
  billedOnly?: boolean;
}

/**
 * A facility's invoices, newest period first, a page at a time, with a name
 * against every line.
 *
 * A busy hospital accumulates one invoice per period per month for years, each
 * carrying every shift as a line; returning them all was a 2 MB response at a
 * couple of thousand invoices. The page is bounded and the totals come from
 * their own aggregate.
 *
 * `invoice_lines.practitioner_id` carries no Prisma relation — struck once a
 * shift is billed, an invoice line is meant to outlive the assignment it
 * came from, and a relation would tie its existence to a row in another
 * schema. Named here the same way an unrelated id gets named everywhere else
 * in this codebase: a second query, batched, and merged by id.
 */
export async function listInvoices(
  facilityId: string,
  options: ListInvoicesOptions = {},
): Promise<InvoicePage> {
  const limit = options.limit ?? 25;
  const [rows, grouped] = await Promise.all([
    prisma.invoice.findMany({
      where: { facilityId, ...(options.billedOnly ? { status: { not: 'DRAFT' as const } } : {}) },
      include: { lines: true },
      orderBy: [{ periodStart: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    }),
    prisma.invoice.groupBy({
      by: ['status'],
      where: { facilityId, status: { in: ['ISSUED', 'PAID'] } },
      _sum: { grossKobo: true },
      _count: { _all: true },
    }),
  ]);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const practitionerIds = [
    ...new Set(page.flatMap((row) => row.lines.map((line) => line.practitionerId))),
  ];
  const people = practitionerIds.length
    ? await prisma.user.findMany({
        where: { id: { in: practitionerIds } },
        select: { id: true, fullName: true },
      })
    : [];
  const nameById = new Map(people.map((person) => [person.id, person.fullName]));

  const issued = grouped.find((row) => row.status === 'ISSUED');
  const paid = grouped.find((row) => row.status === 'PAID');

  return {
    invoices: page.map((row) => {
      const view = toView(row);
      return {
        ...view,
        lines: view.lines.map((line) => ({
          ...line,
          practitionerName: nameById.get(line.practitionerId) ?? 'Unknown practitioner',
        })),
      };
    }),
    nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
    totals: {
      outstandingKobo: issued?._sum.grossKobo ?? 0,
      outstandingCount: issued?._count._all ?? 0,
      paidKobo: paid?._sum.grossKobo ?? 0,
    },
  };
}

/**
 * What an account holds, summed from its entries.
 *
 * Derived rather than stored. A balance column would be a second place the
 * truth lives, and the two would eventually disagree — at which point neither
 * could be trusted.
 */
export async function accountBalance(account: string, subjectId?: string): Promise<number> {
  const result = await prisma.ledgerEntry.aggregate({
    where: { account, ...(subjectId ? { subjectId } : {}) },
    _sum: { amountKobo: true },
  });
  return result._sum.amountKobo ?? 0;
}
