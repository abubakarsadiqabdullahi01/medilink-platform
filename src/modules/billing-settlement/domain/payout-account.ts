/**
 * Where a practitioner is paid. Pure, no database.
 *
 * There was no bank-account model at all (BIL-06): a payout had no destination, so
 * finance took account details from wherever they were sent, and nothing checked
 * that the account belonged to the person being paid. A practitioner now gives an
 * account, a finance officer verifies it against the name the practitioner is
 * registered under, and a payout is made only to a verified account.
 *
 * Nigerian bank accounts are ten-digit NUBANs. There is no provider here that can
 * look an account up and return the name it is held under, so that check is a
 * person's, and this file supplies what makes it quick and hard to skip: the shape
 * of a plausible account and whether the names agree.
 */

export type AccountProblem = 'bank' | 'name' | 'number';

export const BANK_MAX = 80;
export const ACCOUNT_NAME_MIN = 2;
export const ACCOUNT_NAME_MAX = 120;

/** Spaces and hyphens are how people write a number down; neither is part of it. */
export function normaliseAccountNumber(raw: string): string {
  return raw.replace(/[\s-]/g, '');
}

export function accountProblem(input: {
  bankName: string;
  accountName: string;
  accountNumber: string;
}): AccountProblem | null {
  const bank = input.bankName.trim();
  if (bank.length === 0 || bank.length > BANK_MAX) return 'bank';

  const name = input.accountName.trim();
  if (name.length < ACCOUNT_NAME_MIN || name.length > ACCOUNT_NAME_MAX) return 'name';

  if (!/^\d{10}$/.test(normaliseAccountNumber(input.accountNumber))) return 'number';

  return null;
}

/** What anybody but finance, at the moment of transferring, is shown of a number. */
export function maskedNumber(last4: string): string {
  return `••••••${last4}`;
}

/** Lower case, no accents, no punctuation: how two spellings of a name are compared. */
function nameTokens(name: string): string[] {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 2);
}

/**
 * Whether the name an account is held under is the practitioner's.
 *
 * A bank writes names in capitals and in its own order, so they are compared as
 * sets of words. Two have to agree when the registered name has two or more: a
 * single shared word is a relative or somebody with a common surname, and an
 * account in either's name is exactly what this check is there to stop. A registered
 * name of one word needs only that one. This is a prompt for the person verifying,
 * who can override it with a reason, not a decision.
 */
export function namesAgree(accountName: string, registeredName: string): boolean {
  const held = new Set(nameTokens(accountName));
  const registered = nameTokens(registeredName);
  if (held.size === 0 || registered.length === 0) return false;

  const shared = registered.filter((token) => held.has(token)).length;
  return shared >= Math.min(2, registered.length);
}

/**
 * When a payout may first go to an account given at `submittedAt`.
 *
 * Counted from when it was given, not from when it was verified, so finance being
 * quick does not shorten it: the wait is for the person it belongs to to notice a
 * text about an account they did not add.
 */
export function coolingOffEnds(submittedAt: Date, hours: number): Date {
  return new Date(submittedAt.getTime() + hours * 3_600_000);
}

export type VerificationProblem = 'name_mismatch' | 'account_reused';

/** What finance are told before they can verify, and which need a reason to go past. */
export const VERIFICATION_PROBLEM_TEXT: Record<VerificationProblem, string> = {
  name_mismatch: 'The name on the account does not match the name this practitioner is registered under.',
  account_reused: 'Another practitioner has given this same account.',
};
