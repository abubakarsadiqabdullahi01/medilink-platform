import { prisma, type Tx } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { publishEvent } from '@/lib/outbox';
import { EVENTS } from '@/lib/events';
import { HttpError } from '@/lib/http/errors';
import {
  accountProblem,
  coolingOffEnds,
  namesAgree,
  normaliseAccountNumber,
  VERIFICATION_PROBLEM_TEXT,
  type AccountProblem,
  type VerificationProblem,
} from '../domain/payout-account';
import {
  AccountVaultUnavailable,
  fingerprintAccount,
  openAccountNumber,
  sealAccountNumber,
} from '../infrastructure/account-vault';

/**
 * Where a practitioner is paid (BIL-06).
 *
 * A practitioner gives an account; a finance officer checks it against the name
 * the practitioner is registered under and verifies it; a payout is made only to a
 * verified account, and only once it has been the practitioner's for a while. Every
 * step that matters leaves an audit row, none of which holds the number, and the
 * practitioner is texted when an account is added to their name, because a stranger
 * adding one is how somebody else's pay is redirected.
 */

export const PayoutAccountErrors = {
  notFound: () => new HttpError('account_not_found', 'That payout account does not exist.', 404),
  invalid: (problem: AccountProblem) => {
    switch (problem) {
      case 'bank':
        return new HttpError('account_invalid', 'Enter the name of the bank.', 422);
      case 'name':
        return new HttpError('account_invalid', 'Enter the name the account is held under.', 422);
      case 'number':
        return new HttpError('account_invalid', 'An account number is ten digits.', 422);
    }
  },
  wrongStatus: (status: string) =>
    new HttpError('account_wrong_status', `That account is ${status.toLowerCase()}, so it cannot be reviewed now.`, 409),
  needsOverride: (problems: VerificationProblem[]) =>
    new HttpError(
      'account_needs_override',
      `${problems.map((problem) => VERIFICATION_PROBLEM_TEXT[problem]).join(' ')} Say why it is still the right account, in a sentence, to verify it anyway.`,
      409,
    ),
  noteRequired: () =>
    new HttpError('account_note_required', 'Say why it is being refused; the practitioner is sent this.', 422),
  unavailable: () =>
    new HttpError(
      'payout_account_unavailable',
      'Bank accounts cannot be stored here yet: the key that protects them has not been set. This is on Medilink\'s side; contact support.',
      503,
    ),
};

/** An override has to read as a reason, not a keystroke. */
const OVERRIDE_MIN = 10;
const NOTE_MAX = 500;

export interface PayoutAccountView {
  id: string;
  bankName: string;
  accountName: string;
  last4: string;
  status: string;
  createdAt: Date;
  reviewedAt: Date | null;
  reviewNote: string | null;
}

function toView(row: {
  id: string;
  bankName: string;
  accountName: string;
  accountLast4: string;
  status: string;
  createdAt: Date;
  reviewedAt: Date | null;
  reviewNote: string | null;
}): PayoutAccountView {
  return {
    id: row.id,
    bankName: row.bankName,
    accountName: row.accountName,
    last4: row.accountLast4,
    status: row.status,
    createdAt: row.createdAt,
    reviewedAt: row.reviewedAt,
    reviewNote: row.reviewNote,
  };
}

/**
 * How long a new account must have been the practitioner's before a payout may go to
 * it. Read each time so a test can change it. A bad value is the default rather than
 * zero: a typo must not remove the wait.
 */
export const DEFAULT_COOLING_HOURS = 24;
export function coolingHours(): number {
  const raw = process.env.PAYOUT_ACCOUNT_COOLING_HOURS;
  if (raw === undefined || raw.trim() === '') return DEFAULT_COOLING_HOURS;
  const hours = Number(raw);
  return Number.isInteger(hours) && hours >= 0 && hours <= 24 * 30 ? hours : DEFAULT_COOLING_HOURS;
}

/**
 * Whether a payout needs a verified account. On unless the setting says exactly
 * `off`, for the reason the other payout rules are: a typo must not remove a control
 * on where money goes.
 */
export function accountRequired(): boolean {
  return process.env.PAYOUT_REQUIRES_ACCOUNT !== 'off';
}

function sealOrThrow(accountNumber: string): { sealed: string; fingerprint: string } {
  try {
    return { sealed: sealAccountNumber(accountNumber), fingerprint: fingerprintAccount(accountNumber) };
  } catch (error) {
    if (error instanceof AccountVaultUnavailable) throw PayoutAccountErrors.unavailable();
    throw error;
  }
}

/** One at a time per person, so two submissions or two reviews cannot interleave into two live accounts. */
async function lockAccounts(tx: Tx, userId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`payout-account:${userId}`}, 0))`;
}

/**
 * A practitioner gives an account to be paid into. It waits for a finance officer;
 * giving another before then replaces it. Whatever is verified stays the account
 * payouts go to until a new one is.
 */
export async function submitPayoutAccount(input: {
  userId: string;
  bankName: string;
  accountName: string;
  accountNumber: string;
  now?: Date;
}): Promise<PayoutAccountView> {
  const problem = accountProblem(input);
  if (problem) throw PayoutAccountErrors.invalid(problem);

  const number = normaliseAccountNumber(input.accountNumber);
  const { sealed, fingerprint } = sealOrThrow(number);
  const last4 = number.slice(-4);

  return prisma.$transaction(async (tx: Tx) => {
    await lockAccounts(tx, input.userId);

    await tx.payoutAccount.updateMany({
      where: { userId: input.userId, status: 'PENDING' },
      data: { status: 'REPLACED' },
    });

    const account = await tx.payoutAccount.create({
      data: {
        userId: input.userId,
        bankName: input.bankName.trim(),
        accountName: input.accountName.trim(),
        accountLast4: last4,
        accountNumberSealed: sealed,
        fingerprint,
        ...(input.now ? { createdAt: input.now } : {}),
      },
    });

    // Neither the number nor the name on it: the audit trail is kept for good.
    await recordAudit(tx, {
      action: 'payout_account.submitted',
      entityType: 'billing.payout_accounts',
      entityId: account.id,
      actorId: input.userId,
      scopeType: 'SELF',
      scopeId: input.userId,
      after: { status: account.status, last4 },
    });

    await publishEvent(tx, {
      eventType: EVENTS.PayoutAccountSubmitted,
      aggregateType: 'billing.payout_accounts',
      aggregateId: account.id,
      payload: {
        accountId: account.id,
        userId: input.userId,
        bankName: account.bankName,
        last4,
        holdHours: coolingHours(),
      },
    });

    return toView(account);
  });
}

/** What a practitioner sees of their own accounts: never the number, and nobody else's. */
export async function myPayoutAccount(userId: string): Promise<{
  verified: PayoutAccountView | null;
  pending: PayoutAccountView | null;
  /** The last one that was refused, until they give another. */
  refused: PayoutAccountView | null;
  /** When the verified account may first be paid to. */
  readyAt: Date | null;
}> {
  const rows = await prisma.payoutAccount.findMany({
    where: { userId, status: { in: ['PENDING', 'VERIFIED', 'REJECTED'] } },
    orderBy: { createdAt: 'desc' },
  });
  const verified = rows.find((row) => row.status === 'VERIFIED') ?? null;
  const pending = rows.find((row) => row.status === 'PENDING') ?? null;
  const rejected = rows.find((row) => row.status === 'REJECTED') ?? null;
  // A refusal is shown until the practitioner gives another account, and not if what
  // they have since had verified is newer: that would be telling them about
  // something they have already dealt with.
  const refused =
    rejected && !pending && (!verified || rejected.createdAt > verified.createdAt) ? rejected : null;

  return {
    verified: verified ? toView(verified) : null,
    pending: pending ? toView(pending) : null,
    refused: refused ? toView(refused) : null,
    readyAt: verified ? coolingOffEnds(verified.createdAt, coolingHours()) : null,
  };
}

async function problemsWith(
  db: Pick<Tx, 'payoutAccount' | 'user'>,
  account: { id: string; userId: string; accountName: string; fingerprint: string },
): Promise<VerificationProblem[]> {
  const problems: VerificationProblem[] = [];

  const owner = await db.user.findUniqueOrThrow({ where: { id: account.userId }, select: { fullName: true } });
  if (!namesAgree(account.accountName, owner.fullName)) problems.push('name_mismatch');

  const reused = await db.payoutAccount.count({
    where: {
      fingerprint: account.fingerprint,
      userId: { not: account.userId },
      status: { in: ['PENDING', 'VERIFIED'] },
    },
  });
  if (reused > 0) problems.push('account_reused');

  return problems;
}

export interface OfficerAccountView extends PayoutAccountView {
  /** Whole, for finance to transfer to. Present only here, and opening it is audited. */
  accountNumber: string;
  /** What is wrong with a waiting account, which finance must say why to go past. */
  problems: VerificationProblem[];
}

/**
 * The accounts finance may need to pay a practitioner into: the one verified and the
 * one waiting, with their numbers opened. Each time this is read it is audited, with
 * who and for whom and never what was read.
 */
export async function payoutAccountsForOfficer(input: {
  practitionerId: string;
  actorId: string;
}): Promise<{ practitionerName: string; accounts: OfficerAccountView[] }> {
  const user = await prisma.user.findUnique({
    where: { id: input.practitionerId },
    select: { fullName: true },
  });
  if (!user) throw PayoutAccountErrors.notFound();

  const rows = await prisma.payoutAccount.findMany({
    where: { userId: input.practitionerId, status: { in: ['PENDING', 'VERIFIED'] } },
    orderBy: { createdAt: 'desc' },
  });

  const accounts: OfficerAccountView[] = [];
  for (const row of rows) {
    let accountNumber: string;
    try {
      accountNumber = openAccountNumber(row.accountNumberSealed);
    } catch (error) {
      if (error instanceof AccountVaultUnavailable) throw PayoutAccountErrors.unavailable();
      // Sealed under a key that is no longer the one set. Said, not guessed at.
      accountNumber = '';
    }
    accounts.push({
      ...toView(row),
      accountNumber,
      problems: row.status === 'PENDING' ? await problemsWith(prisma, row) : [],
    });
  }

  await prisma.$transaction(async (tx: Tx) => {
    await recordAudit(tx, {
      action: 'payout_account.revealed',
      entityType: 'billing.payout_accounts',
      entityId: input.practitionerId,
      actorId: input.actorId,
      scopeType: 'SELF',
      scopeId: input.practitionerId,
      after: { accounts: accounts.length },
    });
  });

  return { practitionerName: user.fullName, accounts };
}

export interface AwaitingAccount {
  id: string;
  practitionerId: string;
  practitionerName: string;
  bankName: string;
  last4: string;
  createdAt: Date;
  problems: VerificationProblem[];
}

/** What is waiting for a check, oldest first: the queue finance works through. Masked. */
export async function awaitingVerification(): Promise<AwaitingAccount[]> {
  const rows = await prisma.payoutAccount.findMany({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    include: { user: { select: { fullName: true } } },
  });

  const queue: AwaitingAccount[] = [];
  for (const row of rows) {
    queue.push({
      id: row.id,
      practitionerId: row.userId,
      practitionerName: row.user.fullName,
      bankName: row.bankName,
      last4: row.accountLast4,
      createdAt: row.createdAt,
      problems: await problemsWith(prisma, row),
    });
  }
  return queue;
}

/**
 * A finance officer verifies or refuses an account that is waiting.
 *
 * Verifying is refused when the name on the account is not the practitioner's or
 * when another practitioner has given the same account, unless the officer says why
 * it is the right account anyway; that reason is kept. Refusing needs a reason, which
 * the practitioner is sent. Compare-and-set on the status, so two officers acting at
 * once leave one decision.
 */
export async function reviewPayoutAccount(input: {
  accountId: string;
  actorId: string;
  decision: 'verify' | 'reject';
  note?: string;
  overrideReason?: string;
}): Promise<PayoutAccountView> {
  const note = (input.note ?? '').trim();
  const override = (input.overrideReason ?? '').trim();
  if (input.decision === 'reject' && note.length === 0) throw PayoutAccountErrors.noteRequired();

  return prisma.$transaction(async (tx: Tx) => {
    const existing = await tx.payoutAccount.findUnique({ where: { id: input.accountId } });
    if (!existing) throw PayoutAccountErrors.notFound();
    await lockAccounts(tx, existing.userId);

    const current = await tx.payoutAccount.findUniqueOrThrow({ where: { id: input.accountId } });
    if (current.status !== 'PENDING') throw PayoutAccountErrors.wrongStatus(current.status);

    let overridden: VerificationProblem[] = [];
    if (input.decision === 'verify') {
      const problems = await problemsWith(tx, current);
      if (problems.length > 0 && override.length < OVERRIDE_MIN) {
        throw PayoutAccountErrors.needsOverride(problems);
      }
      overridden = problems;

      // The one before it stops being where money goes, in the same breath.
      await tx.payoutAccount.updateMany({
        where: { userId: current.userId, status: 'VERIFIED' },
        data: { status: 'REPLACED' },
      });
    }

    const reviewNote = (input.decision === 'reject' ? note : overridden.length > 0 ? override : '').slice(0, NOTE_MAX);
    const claimed = await tx.payoutAccount.updateMany({
      where: { id: current.id, status: 'PENDING' },
      data: {
        status: input.decision === 'verify' ? 'VERIFIED' : 'REJECTED',
        reviewedBy: input.actorId,
        reviewedAt: new Date(),
        reviewNote: reviewNote || null,
      },
    });
    if (claimed.count !== 1) throw PayoutAccountErrors.wrongStatus('decided');

    const account = await tx.payoutAccount.findUniqueOrThrow({ where: { id: current.id } });

    await recordAudit(tx, {
      action: input.decision === 'verify' ? 'payout_account.verified' : 'payout_account.rejected',
      entityType: 'billing.payout_accounts',
      entityId: account.id,
      actorId: input.actorId,
      scopeType: 'SELF',
      scopeId: account.userId,
      reason: reviewNote || undefined,
      before: { status: current.status },
      after: { status: account.status, last4: account.accountLast4, overridden },
    });

    await publishEvent(tx, {
      eventType: EVENTS.PayoutAccountReviewed,
      aggregateType: 'billing.payout_accounts',
      aggregateId: account.id,
      payload: {
        accountId: account.id,
        userId: account.userId,
        decision: input.decision,
        last4: account.accountLast4,
        note: input.decision === 'reject' ? note : null,
      },
    });

    return toView(account);
  });
}

export type AccountState = 'not_required' | 'ready' | 'missing' | 'unverified' | 'cooling_off';

/**
 * Whether a payout may be made to this practitioner, and if not, why.
 *
 * `missing` is no account at all; `unverified` is one given and waiting; `cooling_off`
 * is a verified one that has not been theirs long enough. Used at the moment a
 * payout is prepared and again when it is released, and by the screen to say why
 * Prepare is not offered.
 */
export async function accountStanding(
  db: Pick<Tx, 'payoutAccount'>,
  practitionerId: string,
  now: Date = new Date(),
): Promise<{ state: AccountState; accountId: string | null; readyAt: Date | null }> {
  if (!accountRequired()) return { state: 'not_required', accountId: null, readyAt: null };

  const verified = await db.payoutAccount.findFirst({ where: { userId: practitionerId, status: 'VERIFIED' } });
  if (!verified) {
    const pending = await db.payoutAccount.count({ where: { userId: practitionerId, status: 'PENDING' } });
    return { state: pending > 0 ? 'unverified' : 'missing', accountId: null, readyAt: null };
  }

  const readyAt = coolingOffEnds(verified.createdAt, coolingHours());
  if (readyAt > now) return { state: 'cooling_off', accountId: verified.id, readyAt };
  return { state: 'ready', accountId: verified.id, readyAt };
}
