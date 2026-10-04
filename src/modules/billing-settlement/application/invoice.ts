import { randomUUID } from 'node:crypto';
import { prisma, type Tx } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { publishEvent } from '@/lib/outbox';
import { EVENTS } from '@/lib/events';
import { HttpError } from '@/lib/http/errors';
import { activeRateCard } from '@/modules/rates-contracts/application/rate-card';
import { DEFAULT_RATE_CARD, priceTimesheet } from '@/modules/rates-contracts/domain/pricing';
import {
  PLATFORM_FEE_UNSET_BP,
  entriesForApprovedWork,
  entriesForPayment,
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
};

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
  lines: InvoiceLineView[];
}

interface InvoiceRow extends Omit<InvoiceView, 'lines'> {
  lines: InvoiceLineView[];
}

function toView(row: InvoiceRow): InvoiceView {
  return { ...row, lines: row.lines };
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

/**
 * The exclusive split, from the bands the timesheet recorded.
 *
 * `nightMinutes` and `holidayMinutes` overlap on the timesheet by design — a
 * reader wants to see both — so billing subtracts the overlap before pricing.
 * Without this a holiday night would be paid a night premium *and* a holiday
 * premium, which is a rate nobody agreed to.
 */
function exclusiveBands(sheet: {
  billableMinutes: number;
  nightMinutes: number;
  holidayMinutes: number;
}) {
  return {
    ordinaryMinutes: Math.max(0, sheet.billableMinutes - sheet.nightMinutes - sheet.holidayMinutes),
    nightMinutes: Math.max(0, sheet.nightMinutes - sheet.holidayMinutes),
    holidayMinutes: sheet.holidayMinutes,
  };
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
        where: { assignmentId: { in: approved.map((row) => row.assignmentId) } },
        select: { assignmentId: true },
      })
    ).map((row) => row.assignmentId),
  );

  const billable = approved.filter(
    (row) => row.timesheet !== null && !alreadyBilled.has(row.assignmentId),
  );
  if (billable.length === 0) throw InvoiceErrors.nothingToBill();

  const card = await activeRateCard(input.facilityId);
  const rates = card ?? DEFAULT_RATE_CARD;

  const lines = billable.map((row) => {
    const sheet = row.timesheet!;
    const bands = exclusiveBands(sheet);
    const priced = priceTimesheet(
      {
        ...bands,
        overtimeMinutes: sheet.overtimeMinutes,
        onCallMinutes: sheet.onCallMinutes,
        hourlyRateKobo: sheet.hourlyRateKobo,
      },
      rates,
    );

    return {
      assignmentId: row.assignmentId,
      rateCardId: card?.id ?? null,
      practitionerId: row.assignment.userId,
      hourlyRateKobo: sheet.hourlyRateKobo,
      ...bands,
      overtimeMinutes: sheet.overtimeMinutes,
      onCallMinutes: sheet.onCallMinutes,
      baseKobo: priced.baseKobo,
      premiumKobo: priced.premiumKobo,
      amountKobo: priced.totalKobo,
    };
  });

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
}): Promise<InvoiceView> {
  const existing = await prisma.invoice.findUnique({ where: { id: input.invoiceId } });
  if (!existing) throw InvoiceErrors.notFound();
  if (existing.status !== 'ISSUED') throw InvoiceErrors.wrongStatus(existing.status, 'PAID');

  return prisma.$transaction(async (tx: Tx) => {
    const applied = await tx.invoice.updateMany({
      where: { id: input.invoiceId, status: 'ISSUED' },
      data: { status: 'PAID', paidAt: new Date() },
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

    await recordAudit(tx, {
      action: 'invoice.paid',
      entityType: 'billing.invoices',
      entityId: invoice.id,
      actorId: input.actorId,
      scopeType: 'FACILITY',
      scopeId: invoice.facilityId,
      after: { status: invoice.status, amountKobo: invoice.grossKobo },
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

/**
 * A facility's invoices, with a name against every line.
 *
 * `invoice_lines.practitioner_id` carries no Prisma relation — struck once a
 * shift is billed, an invoice line is meant to outlive the assignment it
 * came from, and a relation would tie its existence to a row in another
 * schema. Named here the same way an unrelated id gets named everywhere else
 * in this codebase: a second query, batched, and merged by id.
 */
export async function listInvoices(facilityId: string): Promise<InvoiceQueueRow[]> {
  const rows = await prisma.invoice.findMany({
    where: { facilityId },
    include: { lines: true },
    orderBy: { createdAt: 'desc' },
  });

  const practitionerIds = [
    ...new Set(rows.flatMap((row) => row.lines.map((line) => line.practitionerId))),
  ];
  const people = practitionerIds.length
    ? await prisma.user.findMany({
        where: { id: { in: practitionerIds } },
        select: { id: true, fullName: true },
      })
    : [];
  const nameById = new Map(people.map((person) => [person.id, person.fullName]));

  return rows.map((row) => {
    const view = toView(row);
    return {
      ...view,
      lines: view.lines.map((line) => ({
        ...line,
        practitionerName: nameById.get(line.practitionerId) ?? 'Unknown practitioner',
      })),
    };
  });
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
