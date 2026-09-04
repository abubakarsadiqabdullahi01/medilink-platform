import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * One-time codes: policy and pure decision logic, with no database and no
 * clock of its own. Every function takes `now`, which is what makes expiry
 * and attempt limits testable rather than aspirational.
 *
 * Section 9.2 requires codes that expire and attempts that are capped. Both
 * limits exist to make a six-digit secret safe: without them, five thousand
 * guesses a second exhausts the keyspace in minutes.
 */
export const OTP_LENGTH = 6;
export const OTP_TTL_SECONDS = 600;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_SECONDS = 60;
export const OTP_MAX_SENDS_PER_HOUR = 5;

export type OtpPurposeKey =
  | 'PHONE_VERIFICATION'
  | 'EMAIL_VERIFICATION'
  | 'LOGIN'
  | 'PASSWORD_RESET'
  | 'STEP_UP';

/** Uniform over the whole keyspace, including codes with leading zeros. */
export function generateOtpCode(): string {
  return String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0');
}

/**
 * Codes are stored as a keyed digest, never in clear text and never under a
 * bare hash. A six-digit space is small enough that an unkeyed SHA-256 of a
 * leaked table is reversible by exhaustive search in under a second; the
 * server-side secret is what makes the stored value useless on its own.
 *
 * The user id and purpose are bound into the digest, so a code issued for a
 * password reset cannot be replayed against a step-up prompt.
 */
export function hashOtpCode(
  code: string,
  userId: string,
  purpose: OtpPurposeKey,
  secret: string,
): string {
  return createHmac('sha256', secret).update(`${purpose}:${userId}:${code}`).digest('hex');
}

const HEX_DIGEST = /^[0-9a-f]+$/i;

/**
 * Constant-time comparison of two hex digests. Anything that is not a
 * non-empty, even-length hex string is rejected outright: Buffer.from with
 * 'hex' silently drops invalid characters, so without this guard two garbage
 * strings both decode to an empty buffer and compare equal.
 */
export function digestsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  if (a.length === 0 || a.length % 2 !== 0) return false;
  if (!HEX_DIGEST.test(a) || !HEX_DIGEST.test(b)) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

export interface OtpRecord {
  codeHash: string;
  expiresAt: Date;
  attempts: number;
  consumedAt: Date | null;
}

export type OtpFailureReason =
  | 'no_code'
  | 'expired'
  | 'already_used'
  | 'too_many_attempts'
  | 'mismatch';

export type OtpVerdict =
  | { ok: true }
  | { ok: false; reason: OtpFailureReason; attemptsRemaining: number };

/**
 * Order matters. An exhausted or expired code is rejected before the digest
 * is compared, so a caller cannot keep guessing past the limit, and a wrong
 * guess against an expired code does not reveal that the code was wrong.
 */
export function evaluateOtp(
  record: OtpRecord | null,
  submittedHash: string,
  now: Date = new Date(),
): OtpVerdict {
  if (!record) return { ok: false, reason: 'no_code', attemptsRemaining: 0 };
  if (record.consumedAt) return { ok: false, reason: 'already_used', attemptsRemaining: 0 };
  if (record.attempts >= OTP_MAX_ATTEMPTS) {
    return { ok: false, reason: 'too_many_attempts', attemptsRemaining: 0 };
  }
  if (record.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: 'expired', attemptsRemaining: 0 };
  }
  if (!digestsMatch(record.codeHash, submittedHash)) {
    return {
      ok: false,
      reason: 'mismatch',
      attemptsRemaining: Math.max(0, OTP_MAX_ATTEMPTS - (record.attempts + 1)),
    };
  }
  return { ok: true };
}

export function otpExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + OTP_TTL_SECONDS * 1000);
}

export type ResendVerdict =
  | { ok: true }
  | { ok: false; reason: 'cooldown' | 'hourly_limit'; retryAfterSeconds: number };

/**
 * Resend throttling. Without it, a resend button is a free SMS bill payable
 * by Medilink and a way to keep a queue of valid codes alive indefinitely.
 *
 * `sentAt` is the send history for one user and purpose, newest first or not
 * — order is not assumed.
 */
export function evaluateResend(sentAt: Date[], now: Date = new Date()): ResendVerdict {
  const times = sentAt.map((date) => date.getTime()).sort((a, b) => b - a);
  const newest = times[0];

  if (newest !== undefined) {
    const elapsed = Math.floor((now.getTime() - newest) / 1000);
    if (elapsed < OTP_RESEND_COOLDOWN_SECONDS) {
      return {
        ok: false,
        reason: 'cooldown',
        retryAfterSeconds: OTP_RESEND_COOLDOWN_SECONDS - elapsed,
      };
    }
  }

  const hourAgo = now.getTime() - 3600 * 1000;
  const inLastHour = times.filter((time) => time > hourAgo);
  if (inLastHour.length >= OTP_MAX_SENDS_PER_HOUR) {
    const oldest = inLastHour[inLastHour.length - 1];
    const retryAfterSeconds =
      oldest === undefined ? 3600 : Math.max(1, Math.ceil((oldest + 3600 * 1000 - now.getTime()) / 1000));
    return { ok: false, reason: 'hourly_limit', retryAfterSeconds };
  }

  return { ok: true };
}

/** The SMS body. Wording is deliberately short: it must survive one segment. */
export function otpMessageBody(code: string, purpose: OtpPurposeKey): string {
  const minutes = Math.round(OTP_TTL_SECONDS / 60);
  const action =
    purpose === 'PASSWORD_RESET'
      ? 'reset your Medilink password'
      : purpose === 'STEP_UP'
        ? 'confirm this action'
        : 'verify your Medilink number';
  return `${code} is your code to ${action}. It expires in ${minutes} minutes. Do not share it.`;
}
