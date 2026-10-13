/**
 * What erasing a person means on this platform. Pure, no database.
 *
 * The audit trail and the financial ledger are kept under legal obligation and
 * cannot be deleted; the person is told so before they ask
 * (`ERASURE_EXEMPT_REASON`). What erasure does is replace everything that
 * identifies them, delete what they uploaded, and close the account, so the
 * records that remain are answerable without saying whose they were.
 *
 * **This schedule is the retention decision**, and it is written down here
 * rather than scattered through the code that applies it so that whoever has to
 * sign it off - counsel, for the agreements and the data protection officer's
 * opinion (AUD-03, AUD-05) - can read it in one place. It states the product's
 * own position, not legal advice; it needs that review before it is run on a
 * real person's data.
 */

export const ERASED_NAME = 'Erased user';

/**
 * Not a phone number and not a possible one, and different for every account: the
 * column is unique, and the real number is freed for anyone to register again.
 */
export function erasedPhone(userId: string): string {
  return `erased-${userId}`;
}

/** The register's folio number is unique too, and is the one thing on the row that names the person. */
export function erasedFolio(registrationId: string): string {
  return `erased-${registrationId}`;
}

export interface Retained {
  area: string;
  reason: string;
}

/** What is kept after an erasure, and why. Shown to the person and written on the request. */
export const ERASURE_RETAINED: Retained[] = [
  {
    area: 'Audit trail',
    reason:
      'Kept under a legal obligation. Names, email addresses and phone numbers are not written into it, so it does not say who you were.',
  },
  {
    area: 'Invoices, ledger entries and payouts',
    reason:
      'Kept under tax and accounting obligations. They record that money was owed and paid, not who you are.',
  },
  {
    area: 'Shifts, attendance and timesheets',
    reason:
      'Kept: they are the hospital\'s record of who covered a ward and the basis of what was paid. They no longer carry your name.',
  },
  {
    area: 'Disputes, clinical incidents and suspensions involving you',
    reason:
      'Kept: each is also the record of another person or of patient safety, and cannot be removed at one person\'s request. They no longer carry your name.',
  },
  {
    area: 'What you agreed to, and when',
    reason:
      'The record that you accepted the terms and gave or withdrew consent is kept as evidence. The notes you wrote with it and the device you used are not.',
  },
];

export interface ErasureReport {
  /** Rows whose identifying fields were replaced, by kind. */
  replaced: Record<string, number>;
  /** Rows deleted outright, by kind. */
  deleted: Record<string, number>;
  files: { deleted: number; pending: number };
  retained: Retained[];
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

/**
 * The words that close the request. Counts and kinds only: this is stored on a
 * row the person can read and an officer can search, and it must not name them.
 */
export function erasureOutcome(report: ErasureReport, at: Date): string {
  const date = at.toLocaleDateString('en-GB', {
    timeZone: 'Africa/Lagos',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const replaced = Object.entries(report.replaced).map(([kind, count]) => `${count} ${kind}`);
  const deleted = Object.entries(report.deleted).map(([kind, count]) => `${count} ${kind}`);

  const lines = [
    `Erased on ${date}. The account is closed and cannot be signed in to.`,
    replaced.length > 0 ? `Identifying details replaced: ${replaced.join(', ')}.` : null,
    deleted.length > 0 ? `Deleted: ${deleted.join(', ')}.` : null,
    `${plural(report.files.deleted, 'file')} deleted from storage.`,
    report.files.pending > 0
      ? `${plural(report.files.pending, 'file')} could not be deleted yet and will be retried.`
      : null,
    `Kept, and why: ${report.retained.map((row) => `${row.area} - ${row.reason}`).join(' ')}`,
  ];
  return lines.filter((line): line is string => line !== null).join('\n');
}
