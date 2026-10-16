/**
 * Does the money add up (M12-07). Pure, no database.
 *
 * The ledger is built so that it must: every transaction sums to zero, an invoice posts what it
 * says it is for, a payout moves two entries when it settles and none otherwise. Nothing watched
 * any of that after the moment it was written. A bug, a change made outside the code, or a
 * process that stopped half-way would leave a ledger that no longer agreed with the records
 * pointing at it, and nobody would know until somebody added it up by hand.
 *
 * This is the adding-up. It reads a snapshot of sums (`application/reconciliation.ts` takes them
 * in the database, so the ledger is never loaded into memory) and says what disagrees. It
 * changes nothing: a finding is somebody's to look at, and goes away when the cause is put right
 * and the next run no longer sees it.
 */

/**
 * How long a released payout may wait for a gateway to answer before it is reported. A gateway
 * answers in the same request; a payout with no answer an hour later was claimed and then the
 * process stopped, and may or may not have reached the bank. Not a number anybody has decided:
 * a starting point that errs towards looking.
 */
export const STRANDED_RELEASE_MINUTES = 60;

/**
 * How long finance may take to record a transfer it was told to make by hand. Paying by hand
 * is how a pilot runs before a gateway exists, and the transfer is recorded when somebody has
 * made it and has the bank's reference, which is not at once. Three days is a starting point,
 * to be replaced by whatever finance says is late.
 */
export const UNRECORDED_TRANSFER_DAYS = 3;

export type InvoiceStatusValue = 'DRAFT' | 'ISSUED' | 'PAID' | 'VOID';
export type PayoutStatusValue = 'PREPARED' | 'RELEASED' | 'SETTLED' | 'FAILED' | 'CANCELLED';

/**
 * What the database is asked for, already summed. Amounts are whole kobo and signed the way the
 * ledger signs them (`ledger.ts`): a facility's payable is positive while it owes, a
 * practitioner's earnings are negative while they are owed.
 */
export interface Snapshot {
  /** Transactions whose entries do not sum to zero, with what they do sum to. */
  unbalancedTransactions: { transactionId: string; sumKobo: number }[];
  /** Every entry in the ledger added together. */
  ledgerSumKobo: number;
  /** The cash account: what has arrived less what has gone. */
  cashKobo: number;
  facilityPayable: { facilityId: string; kobo: number }[];
  practitionerEarnings: { practitionerId: string; kobo: number }[];
  invoices: {
    id: string;
    number: string;
    status: InvoiceStatusValue;
    grossKobo: number;
    /** What was recorded when it was paid. Null on an invoice paid before this was kept. */
    paymentAmountKobo: number | null;
    /** The lines not voided, added together and counted. */
    liveLinesKobo: number;
    liveLineCount: number;
    /** What the ledger entries pointing at this invoice add to, on the two accounts a payment moves. */
    payableKobo: number;
    cashKobo: number;
  }[];
  payouts: {
    id: string;
    status: PayoutStatusValue;
    amountKobo: number;
    releasedAt: Date | null;
    providerReference: string | null;
    /** The ledger entries pointing at this payout. */
    earningsKobo: number;
    cashKobo: number;
    entryCount: number;
  }[];
}

export type FindingKind =
  | 'transaction_unbalanced'
  | 'ledger_not_zero'
  | 'cash_negative'
  | 'facility_overpaid'
  | 'practitioner_overpaid'
  | 'invoice_lines_differ'
  | 'invoice_ledger_differs'
  | 'payment_amount_differs'
  | 'payout_entries_differ'
  | 'payout_unanswered'
  | 'payout_transfer_unrecorded';

/** The order findings are reported in: the ledger first, then invoices, then payouts. */
const KIND_ORDER: FindingKind[] = [
  'ledger_not_zero',
  'transaction_unbalanced',
  'cash_negative',
  'facility_overpaid',
  'practitioner_overpaid',
  'invoice_lines_differ',
  'invoice_ledger_differs',
  'payment_amount_differs',
  'payout_entries_differ',
  'payout_unanswered',
  'payout_transfer_unrecorded',
];

/**
 * What each kind is called to somebody reading the Finance page. A `Record` over every kind, so a
 * kind cannot be added without a title: the compiler refuses.
 */
export const FINDING_TITLES: Record<FindingKind, string> = {
  transaction_unbalanced: 'A transaction does not balance',
  ledger_not_zero: 'The ledger does not add up to nothing',
  cash_negative: 'More cash has gone out than came in',
  facility_overpaid: 'A facility has paid more than it was billed',
  practitioner_overpaid: 'A practitioner has been paid more than they earned',
  invoice_lines_differ: 'An invoice does not match its lines',
  invoice_ledger_differs: 'An invoice does not match the ledger',
  payment_amount_differs: 'A payment is not the whole of its invoice',
  payout_entries_differ: 'A payout does not match the ledger',
  payout_unanswered: 'A released payout has had no answer from the gateway',
  payout_transfer_unrecorded: 'A payout released to be paid by hand has not been recorded as paid',
};

export interface Finding {
  kind: FindingKind;
  /** What it is about, by id: no name, so it is safe wherever finance is read. */
  subject: {
    type: 'ledger' | 'cash' | 'transaction' | 'facility' | 'practitioner' | 'invoice' | 'payout';
    id: string | null;
    /** An invoice's number, which is what somebody looks for. */
    label?: string;
  };
  expectedKobo: number | null;
  actualKobo: number | null;
  detail: string;
}

export interface ReconcileOptions {
  now: Date;
  /** Whether people, and not a gateway, make the bank transfers (`paidByHand`). */
  paidByHand: boolean;
}

const naira = (kobo: number) => `NGN ${(kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function reconcile(snapshot: Snapshot, options: ReconcileOptions): Finding[] {
  const findings: Finding[] = [];
  const add = (finding: Finding) => findings.push(finding);

  // ─── The ledger itself ──────────────────────────────────────────────────────
  for (const transaction of snapshot.unbalancedTransactions) {
    add({
      kind: 'transaction_unbalanced',
      subject: { type: 'transaction', id: transaction.transactionId },
      expectedKobo: 0,
      actualKobo: transaction.sumKobo,
      detail: `A transaction's entries add up to ${naira(transaction.sumKobo)} and not nothing. The ledger refuses to write one like that, so something wrote around it.`,
    });
  }

  if (snapshot.ledgerSumKobo !== 0) {
    add({
      kind: 'ledger_not_zero',
      subject: { type: 'ledger', id: null },
      expectedKobo: 0,
      actualKobo: snapshot.ledgerSumKobo,
      detail: `Every entry in the ledger adds up to ${naira(snapshot.ledgerSumKobo)} and not nothing, so money has been recorded going in or out of nowhere.`,
    });
  }

  if (snapshot.cashKobo < 0) {
    add({
      kind: 'cash_negative',
      subject: { type: 'cash', id: null },
      expectedKobo: 0,
      actualKobo: snapshot.cashKobo,
      detail: `The cash account stands at ${naira(snapshot.cashKobo)}: more has been recorded leaving than ever arrived.`,
    });
  }

  for (const facility of snapshot.facilityPayable) {
    if (facility.kobo < 0) {
      add({
        kind: 'facility_overpaid',
        subject: { type: 'facility', id: facility.facilityId },
        expectedKobo: 0,
        actualKobo: facility.kobo,
        detail: `This facility has paid ${naira(-facility.kobo)} more than it has been billed.`,
      });
    }
  }

  for (const practitioner of snapshot.practitionerEarnings) {
    if (practitioner.kobo > 0) {
      add({
        kind: 'practitioner_overpaid',
        subject: { type: 'practitioner', id: practitioner.practitionerId },
        expectedKobo: 0,
        actualKobo: practitioner.kobo,
        detail: `This practitioner has been paid ${naira(practitioner.kobo)} more than they earned.`,
      });
    }
  }

  // ─── Invoices ───────────────────────────────────────────────────────────────
  for (const invoice of snapshot.invoices) {
    const subject = { type: 'invoice' as const, id: invoice.id, label: invoice.number };

    if (invoice.status === 'VOID') {
      if (invoice.liveLineCount !== 0) {
        add({
          kind: 'invoice_lines_differ',
          subject,
          expectedKobo: 0,
          actualKobo: invoice.liveLinesKobo,
          detail: `${invoice.number} is void but ${invoice.liveLineCount} of its lines are still live, which keeps their shifts from being invoiced again.`,
        });
      }
      if (invoice.payableKobo !== 0 || invoice.cashKobo !== 0) {
        add({
          kind: 'invoice_ledger_differs',
          subject,
          expectedKobo: 0,
          actualKobo: invoice.payableKobo + invoice.cashKobo,
          detail: `${invoice.number} is void, so every entry made for it should have been reversed, and what is owed on it stands at ${naira(invoice.payableKobo)} with ${naira(invoice.cashKobo)} of cash.`,
        });
      }
      continue;
    }

    if (invoice.liveLinesKobo !== invoice.grossKobo) {
      add({
        kind: 'invoice_lines_differ',
        subject,
        expectedKobo: invoice.grossKobo,
        actualKobo: invoice.liveLinesKobo,
        detail: `${invoice.number} says ${naira(invoice.grossKobo)} but its lines come to ${naira(invoice.liveLinesKobo)}.`,
      });
    }

    if (invoice.status === 'PAID') {
      if (invoice.paymentAmountKobo !== null && invoice.paymentAmountKobo !== invoice.grossKobo) {
        add({
          kind: 'payment_amount_differs',
          subject,
          expectedKobo: invoice.grossKobo,
          actualKobo: invoice.paymentAmountKobo,
          detail: `${invoice.number} is marked paid, but the payment recorded is ${naira(invoice.paymentAmountKobo)} and the invoice is ${naira(invoice.grossKobo)}.`,
        });
      }
      const paid = invoice.paymentAmountKobo ?? invoice.grossKobo;
      if (invoice.cashKobo !== paid || invoice.payableKobo !== invoice.grossKobo - paid) {
        add({
          kind: 'invoice_ledger_differs',
          subject,
          expectedKobo: paid,
          actualKobo: invoice.cashKobo,
          detail: `${invoice.number} is paid, so ${naira(paid)} of cash should be recorded against it and nothing left owing; the ledger has ${naira(invoice.cashKobo)} of cash and ${naira(invoice.payableKobo)} still owed.`,
        });
      }
    } else if (invoice.payableKobo !== invoice.grossKobo || invoice.cashKobo !== 0) {
      add({
        kind: 'invoice_ledger_differs',
        subject,
        expectedKobo: invoice.grossKobo,
        actualKobo: invoice.payableKobo,
        detail: `${invoice.number} has not been paid, so the ledger should show ${naira(invoice.grossKobo)} owed on it and no cash; it shows ${naira(invoice.payableKobo)} owed and ${naira(invoice.cashKobo)} of cash.`,
      });
    }
  }

  // ─── Payouts ────────────────────────────────────────────────────────────────
  for (const payout of snapshot.payouts) {
    const subject = { type: 'payout' as const, id: payout.id };

    if (payout.status === 'SETTLED') {
      const right = payout.entryCount === 2 && payout.earningsKobo === payout.amountKobo && payout.cashKobo === -payout.amountKobo;
      if (!right) {
        add({
          kind: 'payout_entries_differ',
          subject,
          expectedKobo: payout.amountKobo,
          actualKobo: payout.earningsKobo,
          detail: `A settled payout of ${naira(payout.amountKobo)} should have two ledger entries, earnings cleared and cash out; it has ${payout.entryCount}, clearing ${naira(payout.earningsKobo)} of earnings and moving ${naira(payout.cashKobo)} of cash.`,
        });
      }
      continue;
    }

    if (payout.entryCount !== 0) {
      add({
        kind: 'payout_entries_differ',
        subject,
        expectedKobo: 0,
        actualKobo: payout.earningsKobo,
        detail: `A ${payout.status.toLowerCase()} payout has not paid anything, but ${payout.entryCount} ledger entries say it has.`,
      });
    }

    if (payout.status === 'RELEASED' && payout.releasedAt && payout.providerReference === null) {
      const waitedMinutes = (options.now.getTime() - payout.releasedAt.getTime()) / 60_000;
      if (options.paidByHand) {
        if (waitedMinutes > UNRECORDED_TRANSFER_DAYS * 24 * 60) {
          add({
            kind: 'payout_transfer_unrecorded',
            subject,
            expectedKobo: payout.amountKobo,
            actualKobo: null,
            detail: `A payout of ${naira(payout.amountKobo)} was released to be paid by hand more than ${UNRECORDED_TRANSFER_DAYS} days ago and no transfer has been recorded.`,
          });
        }
      } else if (waitedMinutes > STRANDED_RELEASE_MINUTES) {
        add({
          kind: 'payout_unanswered',
          subject,
          expectedKobo: payout.amountKobo,
          actualKobo: null,
          detail: `A payout of ${naira(payout.amountKobo)} was released more than ${STRANDED_RELEASE_MINUTES} minutes ago and the gateway has not answered. The process may have stopped after it was claimed, so check with the gateway whether the money moved before doing anything else.`,
        });
      }
    }
  }

  return findings.sort(
    (a, b) =>
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
      (a.subject.id ?? '').localeCompare(b.subject.id ?? ''),
  );
}

/** How many of each kind, for a log line and for the message of a job that failed. */
export function summarise(findings: Finding[]): Partial<Record<FindingKind, number>> {
  const counts: Partial<Record<FindingKind, number>> = {};
  for (const finding of findings) counts[finding.kind] = (counts[finding.kind] ?? 0) + 1;
  return counts;
}
