import { isDateOnly, lagosDate } from '@/lib/lagos-date';

/**
 * What a record of an inbound payment has to say. Pure, no database.
 *
 * "Mark paid" used to be a bare button. Nothing said which transfer it was, how
 * much arrived, when or from whom, so an invoice could be marked paid against
 * nothing and nobody could check it against a bank statement afterwards
 * (BIL-07). Capturing money needs a payment provider, and until there is one a
 * person records a transfer they can see; these are the facts that make that
 * record checkable.
 *
 * The amount must equal the invoice. Part payments and one transfer covering
 * several invoices are real, and the ledger and the invoice status have no
 * model for them, so they are refused rather than recorded as something they
 * are not.
 */

export interface PaymentRecord {
  /** The bank's own reference for the transfer. */
  reference: string;
  amountKobo: number;
  /** The date the money arrived, `YYYY-MM-DD`, in Lagos. */
  paidOn: string;
  /** Who paid, as the bank statement names them. */
  payerName: string;
}

export type PaymentProblem = 'reference' | 'payer' | 'amount' | 'date' | 'future' | 'before_issue';

export const REFERENCE_MIN = 3;
export const REFERENCE_MAX = 100;
export const PAYER_MIN = 2;
export const PAYER_MAX = 120;

export function paymentProblem(
  record: PaymentRecord,
  invoice: { grossKobo: number; issuedOn: string | null },
  now: Date,
): PaymentProblem | null {
  const reference = record.reference.trim();
  if (reference.length < REFERENCE_MIN || reference.length > REFERENCE_MAX) return 'reference';

  const payer = record.payerName.trim();
  if (payer.length < PAYER_MIN || payer.length > PAYER_MAX) return 'payer';

  if (!Number.isInteger(record.amountKobo) || record.amountKobo !== invoice.grossKobo) return 'amount';

  if (!isDateOnly(record.paidOn)) return 'date';
  if (record.paidOn > lagosDate(now)) return 'future';
  if (invoice.issuedOn && record.paidOn < invoice.issuedOn) return 'before_issue';

  return null;
}
