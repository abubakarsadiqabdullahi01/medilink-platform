import { isDateOnly, lagosDate } from '@/lib/lagos-date';

/**
 * What a record of an outbound bank transfer has to say. Pure, no database.
 *
 * Until there is a payment gateway, a practitioner is paid by finance making the
 * transfer from the bank and recording it here (BIL-05). That record is what
 * completes the payout and writes the ledger, so it has to be checkable against
 * the bank statement afterwards: the bank's own reference, and the date the money
 * left.
 */

export interface TransferRecord {
  /** The bank's own reference for the transfer. */
  reference: string;
  /** The date the money left, `YYYY-MM-DD`, in Lagos. */
  paidOn: string;
}

export type TransferProblem = 'reference' | 'date' | 'future' | 'before_release';

export const TRANSFER_REFERENCE_MIN = 3;
export const TRANSFER_REFERENCE_MAX = 100;

/**
 * `releasedOn` is the Lagos date the payout was released. A transfer made before
 * somebody agreed to make it is a mis-keyed date or a transfer for something else,
 * and either way is not this payout's.
 */
export function transferProblem(
  record: TransferRecord,
  payout: { releasedOn: string | null },
  now: Date,
): TransferProblem | null {
  const reference = record.reference.trim();
  if (reference.length < TRANSFER_REFERENCE_MIN || reference.length > TRANSFER_REFERENCE_MAX) {
    return 'reference';
  }

  if (!isDateOnly(record.paidOn)) return 'date';
  if (record.paidOn > lagosDate(now)) return 'future';
  if (payout.releasedOn && record.paidOn < payout.releasedOn) return 'before_release';

  return null;
}
