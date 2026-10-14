/**
 * Double-entry bookkeeping. Pure, no database.
 *
 * Module 12. Every movement of money is recorded twice — once where it came
 * from and once where it went — and a transaction that does not balance is
 * refused rather than stored. That single invariant is what makes the ledger
 * answerable months later: any account's balance is the sum of its entries,
 * and the sum of every entry in the system is always zero.
 *
 * Integer kobo throughout (rule 3). A ledger that rounds is a ledger that
 * loses money, and the amount it loses is not recoverable from the record.
 */

/**
 * The accounts money moves between.
 *
 * `PLATFORM_REVENUE` exists and is always credited zero until step 3.1
 * settles what Medilink charges and who bears it. The account is here so the
 * shape of a transaction does not change when that decision is taken — only
 * the number does.
 */
export const ACCOUNTS = [
  /** What a facility owes for work already approved. */
  'FACILITY_PAYABLE',
  /** What a practitioner has earned and not yet been paid. */
  'PRACTITIONER_EARNINGS',
  /** Medilink's own share. Zero until 3.1. */
  'PLATFORM_REVENUE',
  /** Money that has actually arrived or left. */
  'CASH',
] as const;

export type Account = (typeof ACCOUNTS)[number];

/**
 * One side of a transaction.
 *
 * Signed rather than a debit/credit column, because "must sum to zero" is a
 * property a computer can check and "debits must equal credits" is the same
 * rule said in a way that needs two columns kept in step. The sign convention
 * is the ordinary one: a positive amount increases what the account holds.
 */
export interface LedgerEntry {
  account: Account;
  amountKobo: number;
  /** Which practitioner or facility this side of the entry belongs to. */
  subjectId: string | null;
  memo: string;
}

export class LedgerError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'LedgerError';
  }
}

/**
 * The invariant, checked before anything is written.
 *
 * Thrown rather than returned: an unbalanced transaction is not a validation
 * failure a caller might reasonably recover from, it is a bug, and the only
 * safe thing to do with it is refuse to persist it.
 */
export function assertBalanced(entries: LedgerEntry[]): void {
  if (entries.length === 0) {
    throw new LedgerError('empty_transaction', 'A transaction must have entries.');
  }

  for (const entry of entries) {
    if (!Number.isInteger(entry.amountKobo)) {
      throw new LedgerError(
        'fractional_kobo',
        `A ledger entry must be whole kobo; ${entry.account} had ${entry.amountKobo}.`,
      );
    }
  }

  const sum = entries.reduce((total, entry) => total + entry.amountKobo, 0);
  if (sum !== 0) {
    throw new LedgerError(
      'unbalanced_transaction',
      `A transaction must sum to zero; this one is off by ${sum} kobo.`,
    );
  }
}

export interface ApprovedWork {
  facilityId: string;
  practitionerId: string;
  /** What the facility is billed, from module 11's pricing. */
  grossKobo: number;
  /** Medilink's share of it. Zero until step 3.1 is settled. */
  platformFeeKobo: number;
}

/**
 * The entries for one approved shift.
 *
 * The facility owes the gross; the practitioner earns the gross less the
 * platform's share. **Who bears the fee is step 3.1's to decide**, and this
 * takes it from the practitioner's side because that is the arrangement the
 * specification describes — but the balance holds either way, so changing it
 * is changing one line rather than reworking the ledger.
 */
export function entriesForApprovedWork(work: ApprovedWork): LedgerEntry[] {
  if (work.platformFeeKobo < 0) {
    throw new LedgerError('negative_fee', 'A platform fee cannot be negative.');
  }
  if (work.platformFeeKobo > work.grossKobo) {
    throw new LedgerError(
      'fee_exceeds_gross',
      'A platform fee cannot be more than the work is worth.',
    );
  }

  const entries: LedgerEntry[] = [
    {
      account: 'FACILITY_PAYABLE',
      amountKobo: work.grossKobo,
      subjectId: work.facilityId,
      memo: 'Approved shift',
    },
    {
      account: 'PRACTITIONER_EARNINGS',
      amountKobo: -(work.grossKobo - work.platformFeeKobo),
      subjectId: work.practitionerId,
      memo: 'Approved shift',
    },
  ];

  // Omitted entirely rather than written as zero: a ledger full of zero rows
  // is a ledger nobody can scan, and until 3.1 every one of them would be.
  if (work.platformFeeKobo > 0) {
    entries.push({
      account: 'PLATFORM_REVENUE',
      amountKobo: -work.platformFeeKobo,
      subjectId: null,
      memo: 'Platform fee',
    });
  }

  assertBalanced(entries);
  return entries;
}

/**
 * The entries that undo `entriesForApprovedWork` for the same shift: every
 * amount with its sign turned over, so each account is back where it was. The
 * original entries are kept; a ledger is added to, never rewritten.
 */
export function entriesForVoidedWork(work: ApprovedWork): LedgerEntry[] {
  const entries = entriesForApprovedWork(work).map((entry) => ({
    ...entry,
    amountKobo: entry.amountKobo === 0 ? 0 : -entry.amountKobo,
    memo: `Voided: ${entry.memo}`,
  }));
  assertBalanced(entries);
  return entries;
}

/** A facility settling its invoice: cash in, payable cleared. */
export function entriesForPayment(input: {
  facilityId: string;
  amountKobo: number;
}): LedgerEntry[] {
  const entries: LedgerEntry[] = [
    { account: 'CASH', amountKobo: input.amountKobo, subjectId: null, memo: 'Invoice paid' },
    {
      account: 'FACILITY_PAYABLE',
      amountKobo: -input.amountKobo,
      subjectId: input.facilityId,
      memo: 'Invoice paid',
    },
  ];
  assertBalanced(entries);
  return entries;
}

/** A practitioner being paid: earnings cleared, cash out. */
export function entriesForPayout(input: {
  practitionerId: string;
  amountKobo: number;
}): LedgerEntry[] {
  const entries: LedgerEntry[] = [
    {
      account: 'PRACTITIONER_EARNINGS',
      amountKobo: input.amountKobo,
      subjectId: input.practitionerId,
      memo: 'Payout',
    },
    { account: 'CASH', amountKobo: -input.amountKobo, subjectId: null, memo: 'Payout' },
  ];
  assertBalanced(entries);
  return entries;
}

/**
 * The platform's share of a gross amount, in basis points.
 *
 * **Zero until step 3.1**, and the default says so. Rounded down, so a
 * rounding error is never taken from the practitioner.
 */
export const PLATFORM_FEE_UNSET_BP = 0;

export function platformFeeKobo(grossKobo: number, feeBp: number): number {
  if (feeBp <= 0) return 0;
  return Math.floor((grossKobo * feeBp) / 10_000);
}

/** Where an account stands, from its entries alone. */
export function balanceOf(entries: LedgerEntry[], account: Account): number {
  return entries
    .filter((entry) => entry.account === account)
    .reduce((total, entry) => total + entry.amountKobo, 0);
}
