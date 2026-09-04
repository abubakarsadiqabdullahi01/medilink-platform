import { createHash, randomBytes } from 'node:crypto';

/**
 * Opaque server-side sessions rather than self-contained tokens. A JWT cannot
 * be revoked before it expires; a compliance officer suspending an account
 * after a clinical incident needs that account's access to stop immediately
 * (Section 9.10), so the session row is the source of truth.
 */
export const SESSION_COOKIE_NAME = 'medilink_session';
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;

/**
 * How recently a one-time code must have been confirmed for a sensitive
 * action to proceed. Consumed by Stage 4.8 step-up auth: changing a payout
 * bank account, approving a timesheet, releasing a payout.
 */
export const STEP_UP_WINDOW_SECONDS = 300;

/** 256 bits from the CSPRNG. The plaintext is returned once, then discarded. */
export function generateSessionToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashSessionToken(token) };
}

/**
 * A plain SHA-256 is correct here, unlike for passwords and one-time codes:
 * the input is 256 bits of entropy, so there is nothing to brute-force, and a
 * slow hash on every request would only add latency.
 */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function sessionExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);
}

export interface SessionRecord {
  expiresAt: Date;
  revokedAt: Date | null;
  stepUpAt: Date | null;
}

export function isSessionUsable(session: SessionRecord | null, now: Date = new Date()): boolean {
  if (!session) return false;
  if (session.revokedAt) return false;
  return session.expiresAt.getTime() > now.getTime();
}

export function isStepUpFresh(session: SessionRecord | null, now: Date = new Date()): boolean {
  if (!session?.stepUpAt) return false;
  return now.getTime() - session.stepUpAt.getTime() <= STEP_UP_WINDOW_SECONDS * 1000;
}

/**
 * Cookie attributes. `secure` is off only in local development, where the app
 * is served over plain HTTP; staging and production are always HTTPS.
 */
export function sessionCookieOptions(expiresAt: Date, isProductionLike: boolean) {
  return {
    name: SESSION_COOKIE_NAME,
    httpOnly: true,
    secure: isProductionLike,
    sameSite: 'lax' as const,
    path: '/',
    expires: expiresAt,
  };
}
