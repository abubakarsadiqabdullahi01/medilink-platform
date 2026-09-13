import { createHmac, randomInt } from 'node:crypto';
import { digestsMatch } from '@/modules/auth/domain/otp';

/**
 * The short-lived secret a facility issues so a practitioner can check in or
 * out (step 7.2).
 *
 * "Supervisor OTP or short-lived QR" is **two renderings of one secret**, not
 * two systems: the same token is a six-digit code a supervisor can read aloud
 * and a QR payload the practitioner's phone can scan. Building it once means
 * one expiry rule, one attempt limit, and one thing to reason about when a
 * shift is disputed.
 */

export const CHECK_IN_CODE_LENGTH = 6;

/**
 * Five minutes. Long enough for a supervisor to read a code down a ward and a
 * practitioner to type it; short enough that a photograph of a QR taped to a
 * noticeboard is worthless by the time anyone else uses it. The whole point
 * of the token is that it proves presence *now*.
 */
export const CHECK_IN_TOKEN_TTL_SECONDS = 300;

/** Five, then the token is dead — the same limit one-time codes use. */
export const CHECK_IN_MAX_ATTEMPTS = 5;

export type CheckInPurpose = 'CHECK_IN' | 'CHECK_OUT';

export function generateCheckInCode(): string {
  return String(randomInt(0, 10 ** CHECK_IN_CODE_LENGTH)).padStart(CHECK_IN_CODE_LENGTH, '0');
}

/**
 * A keyed digest, for the reason documented for one-time codes in
 * docs/stage-4-2-auth.md: six digits is a million possibilities, and an
 * unkeyed hash of a leaked table is reversible by exhaustive search in under
 * a second.
 *
 * The assignment and the purpose are bound into the digest, so a check-in
 * code cannot be replayed as a check-out, and a code issued for one shift
 * cannot be presented against another.
 */
export function hashCheckInCode(
  code: string,
  assignmentId: string,
  purpose: CheckInPurpose,
  secret: string,
): string {
  return createHmac('sha256', secret)
    .update(`attendance:${purpose}:${assignmentId}:${code}`)
    .digest('hex');
}

/**
 * What goes into the QR image. The assignment and purpose travel with the
 * code so a scan needs no other context, and the server re-derives the digest
 * from all three — a payload naming a different assignment simply will not
 * match.
 */
export function qrPayload(
  assignmentId: string,
  purpose: CheckInPurpose,
  code: string,
): string {
  return `medilink://attendance/${purpose.toLowerCase()}/${assignmentId}/${code}`;
}

export interface ParsedQrPayload {
  assignmentId: string;
  purpose: CheckInPurpose;
  code: string;
}

const QR_PATTERN =
  /^medilink:\/\/attendance\/(check_in|check_out)\/([0-9a-f-]{36})\/(\d{6})$/;

export function parseQrPayload(payload: string): ParsedQrPayload | null {
  const match = QR_PATTERN.exec(payload.trim());
  if (!match) return null;
  const [, purpose, assignmentId, code] = match;
  return {
    assignmentId: assignmentId as string,
    purpose: (purpose === 'check_in' ? 'CHECK_IN' : 'CHECK_OUT') as CheckInPurpose,
    code: code as string,
  };
}

export interface CheckInTokenRecord {
  codeHash: string;
  expiresAt: Date;
  attempts: number;
  consumedAt: Date | null;
}

export type CheckInFailureReason =
  | 'no_token'
  | 'already_used'
  | 'too_many_attempts'
  | 'expired'
  | 'mismatch';

export type CheckInVerdict =
  | { ok: true }
  | { ok: false; reason: CheckInFailureReason; attemptsRemaining: number };

/**
 * Deliberately the same shape and order of checks as `evaluateOtp`. A
 * consumed token is refused before an expired one, and both before the
 * comparison, so a caller learns nothing from how long the answer took.
 */
export function evaluateCheckInToken(
  record: CheckInTokenRecord | null,
  submittedHash: string,
  now: Date = new Date(),
): CheckInVerdict {
  if (!record) return { ok: false, reason: 'no_token', attemptsRemaining: 0 };
  if (record.consumedAt) return { ok: false, reason: 'already_used', attemptsRemaining: 0 };
  if (record.attempts >= CHECK_IN_MAX_ATTEMPTS) {
    return { ok: false, reason: 'too_many_attempts', attemptsRemaining: 0 };
  }
  if (record.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: 'expired', attemptsRemaining: 0 };
  }
  if (!digestsMatch(record.codeHash, submittedHash)) {
    return {
      ok: false,
      reason: 'mismatch',
      attemptsRemaining: Math.max(0, CHECK_IN_MAX_ATTEMPTS - (record.attempts + 1)),
    };
  }
  return { ok: true };
}

export function checkInTokenExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + CHECK_IN_TOKEN_TTL_SECONDS * 1000);
}
