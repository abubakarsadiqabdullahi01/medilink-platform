import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Binds the last registration step to the one before it.
 *
 * Setting the first password asked only that the phone *had* been verified, so
 * anybody who knew a number that had verified and never set a password — an
 * abandoned sign-up stays that way for ever — could set its password and
 * choose what the account was. Verifying the phone now hands back this token,
 * and setting the password has to present it.
 *
 * Stateless and short-lived: an expiry and a keyed digest over the user and the
 * expiry. Single use comes from the password itself — once one is set the step
 * is closed whatever tokens are still in date.
 */
export const SETUP_TOKEN_TTL_SECONDS = 30 * 60;

function sign(userId: string, expiresAtSeconds: number, secret: string): string {
  return createHmac('sha256', secret)
    .update(`password-setup:${userId}:${expiresAtSeconds}`)
    .digest('hex');
}

export function issueSetupToken(userId: string, now: Date, secret: string): string {
  const expiresAt = Math.floor(now.getTime() / 1000) + SETUP_TOKEN_TTL_SECONDS;
  return `${expiresAt}.${sign(userId, expiresAt, secret)}`;
}

export function verifySetupToken(
  token: string,
  userId: string,
  now: Date,
  secret: string,
): boolean {
  const parts = token.split('.');
  if (parts.length !== 2) return false;

  const [expiry, signature] = parts as [string, string];
  if (!/^\d+$/.test(expiry) || !/^[0-9a-f]+$/.test(signature)) return false;

  const expiresAt = Number(expiry);
  if (Math.floor(now.getTime() / 1000) >= expiresAt) return false;

  const expected = Buffer.from(sign(userId, expiresAt, secret), 'hex');
  const given = Buffer.from(signature, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}
