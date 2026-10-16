import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { paidByHand } from '../infrastructure/gateway';
import {
  reconcile,
  summarise,
  type Finding,
  type InvoiceStatusValue,
  type PayoutStatusValue,
  type Snapshot,
} from '../domain/reconciliation';

/**
 * Does the money add up (M12-07): the sums are taken in the database and the rules are applied in
 * `domain/reconciliation.ts`. Nothing here writes. A finding is not stored: it is worked out
 * again each time from the ledger and the records, so it is always about now and goes away on its
 * own when the cause is put right. What keeps a record of one is the nightly job's failure.
 *
 * Everything is read in one repeatable-read transaction, so the figures a run compares are of one
 * moment and money moving while it runs cannot look like a break.
 */

/** How many unbalanced transactions are listed. If there are more than this, there are more than this. */
const UNBALANCED_LIMIT = 500;

/** How many findings are written to the log of a run that found any. The count is always all of them. */
const LOGGED_FINDINGS = 50;

export interface ReconciliationReport {
  ranAt: string;
  /** What was looked at, so a run that found nothing in an empty ledger does not read as a clean one. */
  checked: { transactions: number; invoices: number; payouts: number };
  findings: Finding[];
}

async function takeSnapshot(): Promise<{ snapshot: Snapshot; transactions: number }> {
  return prisma.$transaction(
    async (tx) => {
      const unbalanced = await tx.$queryRaw<{ transaction_id: string; total: number }[]>`
        SELECT transaction_id::text AS transaction_id, sum(amount_kobo)::float8 AS total
        FROM billing.ledger_entries
        GROUP BY transaction_id
        HAVING sum(amount_kobo) <> 0
        ORDER BY transaction_id
        LIMIT ${UNBALANCED_LIMIT}::int`;

      const totals = await tx.$queryRaw<{ total: number; cash: number; transactions: number }[]>`
        SELECT coalesce(sum(amount_kobo), 0)::float8 AS total,
               coalesce(sum(amount_kobo) FILTER (WHERE account = 'CASH'), 0)::float8 AS cash,
               count(DISTINCT transaction_id)::int AS transactions
        FROM billing.ledger_entries`;

      const facilities = await tx.$queryRaw<{ id: string; kobo: number }[]>`
        SELECT subject_id::text AS id, sum(amount_kobo)::float8 AS kobo
        FROM billing.ledger_entries
        WHERE account = 'FACILITY_PAYABLE' AND subject_id IS NOT NULL
        GROUP BY subject_id`;

      const practitioners = await tx.$queryRaw<{ id: string; kobo: number }[]>`
        SELECT subject_id::text AS id, sum(amount_kobo)::float8 AS kobo
        FROM billing.ledger_entries
        WHERE account = 'PRACTITIONER_EARNINGS' AND subject_id IS NOT NULL
        GROUP BY subject_id`;

      const invoices = await tx.$queryRaw<
        {
          id: string;
          number: string;
          status: InvoiceStatusValue;
          gross: number;
          payment: number | null;
          live_lines: number;
          live_count: number;
          payable: number;
          cash: number;
        }[]
      >`
        SELECT i.id::text AS id, i.number, i.status::text AS status,
               i.gross_kobo::float8 AS gross,
               i.payment_amount_kobo::float8 AS payment,
               coalesce(l.amount, 0)::float8 AS live_lines,
               coalesce(l.count, 0)::int AS live_count,
               coalesce(e.payable, 0)::float8 AS payable,
               coalesce(e.cash, 0)::float8 AS cash
        FROM billing.invoices i
        LEFT JOIN (
          SELECT invoice_id, sum(amount_kobo) AS amount, count(*) AS count
          FROM billing.invoice_lines
          WHERE voided_at IS NULL
          GROUP BY invoice_id
        ) l ON l.invoice_id = i.id
        LEFT JOIN (
          SELECT invoice_id,
                 sum(amount_kobo) FILTER (WHERE account = 'FACILITY_PAYABLE') AS payable,
                 sum(amount_kobo) FILTER (WHERE account = 'CASH') AS cash
          FROM billing.ledger_entries
          WHERE invoice_id IS NOT NULL
          GROUP BY invoice_id
        ) e ON e.invoice_id = i.id
        ORDER BY i.number`;

      const payouts = await tx.$queryRaw<
        {
          id: string;
          status: PayoutStatusValue;
          amount: number;
          released_at: Date | null;
          reference: string | null;
          earnings: number;
          cash: number;
          entries: number;
        }[]
      >`
        SELECT p.id::text AS id, p.status::text AS status, p.amount_kobo::float8 AS amount,
               p.released_at, p.provider_reference AS reference,
               coalesce(e.earnings, 0)::float8 AS earnings,
               coalesce(e.cash, 0)::float8 AS cash,
               coalesce(e.entries, 0)::int AS entries
        FROM billing.payouts p
        LEFT JOIN (
          SELECT payout_id,
                 sum(amount_kobo) FILTER (WHERE account = 'PRACTITIONER_EARNINGS') AS earnings,
                 sum(amount_kobo) FILTER (WHERE account = 'CASH') AS cash,
                 count(*) AS entries
          FROM billing.ledger_entries
          WHERE payout_id IS NOT NULL
          GROUP BY payout_id
        ) e ON e.payout_id = p.id
        ORDER BY p.id`;

      const total = totals[0] ?? { total: 0, cash: 0, transactions: 0 };

      return {
        transactions: total.transactions,
        snapshot: {
          unbalancedTransactions: unbalanced.map((row) => ({ transactionId: row.transaction_id, sumKobo: row.total })),
          ledgerSumKobo: total.total,
          cashKobo: total.cash,
          facilityPayable: facilities.map((row) => ({ facilityId: row.id, kobo: row.kobo })),
          practitionerEarnings: practitioners.map((row) => ({ practitionerId: row.id, kobo: row.kobo })),
          invoices: invoices.map((row) => ({
            id: row.id,
            number: row.number,
            status: row.status,
            grossKobo: row.gross,
            paymentAmountKobo: row.payment,
            liveLinesKobo: row.live_lines,
            liveLineCount: row.live_count,
            payableKobo: row.payable,
            cashKobo: row.cash,
          })),
          payouts: payouts.map((row) => ({
            id: row.id,
            status: row.status,
            amountKobo: row.amount,
            releasedAt: row.released_at,
            providerReference: row.reference,
            earningsKobo: row.earnings,
            cashKobo: row.cash,
            entryCount: row.entries,
          })),
        } satisfies Snapshot,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

/** Adds the money up now and says what does not agree. Changes nothing. */
export async function reconcileLedger(
  options: { now?: Date; paidByHand?: boolean } = {},
): Promise<ReconciliationReport> {
  const now = options.now ?? new Date();
  const { snapshot, transactions } = await takeSnapshot();

  return {
    ranAt: now.toISOString(),
    checked: { transactions, invoices: snapshot.invoices.length, payouts: snapshot.payouts.length },
    findings: reconcile(snapshot, { now, paidByHand: options.paidByHand ?? paidByHand() }),
  };
}

export class ReconciliationBreak extends Error {
  constructor(
    readonly findings: Finding[],
    message: string,
  ) {
    super(message);
    this.name = 'ReconciliationBreak';
  }
}

/**
 * The nightly run. A clean run is one line; one that finds anything logs what, by id and by
 * amount and never by name, and fails, so the job shows as failed on the System health screen with
 * the kinds in its reason. There is nowhere that pages anybody yet (`X02-05`): until there is,
 * that and the line in the log are how a break is noticed.
 */
export async function runReconciliationSweep(now: Date = new Date()): Promise<ReconciliationReport> {
  const report = await reconcileLedger({ now });

  if (report.findings.length === 0) {
    logger.info('the money adds up', { event: 'reconciliation_clean', checked: report.checked });
    return report;
  }

  const kinds = summarise(report.findings);
  logger.error('the money does not add up', {
    event: 'reconciliation_break',
    count: report.findings.length,
    kinds,
    checked: report.checked,
    findings: report.findings.slice(0, LOGGED_FINDINGS).map((finding) => ({
      kind: finding.kind,
      subject: finding.subject,
      expectedKobo: finding.expectedKobo,
      actualKobo: finding.actualKobo,
    })),
  });

  const list = Object.entries(kinds)
    .map(([kind, count]) => `${kind} ${count}`)
    .join(', ');
  const noun = report.findings.length === 1 ? 'break' : 'breaks';
  throw new ReconciliationBreak(
    report.findings,
    `Reconciliation found ${report.findings.length} ${noun}: ${list}. The list is on the Finance page.`,
  );
}
