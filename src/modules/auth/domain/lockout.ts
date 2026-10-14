/**
 * Login throttling, derived from identity.login_attempts rather than from
 * process memory. Medilink runs more than one web container, and a counter
 * held in memory resets on every deploy and is trivially bypassed by
 * distributing guesses across instances.
 */
export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_FAILURE_WINDOW_SECONDS = 900;
export const LOGIN_LOCKOUT_SECONDS = 900;

/**
 * Failed sign-ins from one address in an hour, across every number tried.
 *
 * The per-number lock cannot see one address trying a thousand numbers once each.
 * This is generous on purpose: a ward or a clinic can share one address, and what
 * it caps is guessing, not somebody who forgot their password. The address is
 * whatever the edge forwards (see `assertCanSendCode`): where the platform does
 * not overwrite X-Forwarded-For a caller can rotate it, and this does not hold.
 */
export const LOGIN_MAX_FAILURES_PER_ADDRESS_PER_HOUR = 300;
export const LOGIN_ADDRESS_WINDOW_SECONDS = 3600;

export interface AttemptRecord {
  succeeded: boolean;
  createdAt: Date;
  /** What the attempt was; `locked_out` marks one refused while the account was locked. */
  reason?: string | null;
}

/**
 * An attempt refused because the account was already locked. It is written
 * down, as evidence, but it is not a guess: counting it extended the lock by
 * another fifteen minutes every time anybody knocked.
 */
export const LOCKED_OUT_REASON = 'locked_out';

/**
 * An attempt refused because its address had used up its budget. Written down and
 * not counted, for the same reason, and against the number as well: a refused
 * knock from a throttled address must not lock the person who owns that number.
 */
export const ADDRESS_THROTTLED_REASON = 'address_throttled';

export interface LockoutState {
  locked: boolean;
  failuresInWindow: number;
  retryAfterSeconds: number;
}

/**
 * Counts consecutive recent failures. A success inside the window clears the
 * count, so a legitimate user who mistypes twice and then succeeds is not one
 * mistake away from a lockout an hour later.
 */
export function lockoutState(attempts: AttemptRecord[], now: Date = new Date()): LockoutState {
  const windowStart = now.getTime() - LOGIN_FAILURE_WINDOW_SECONDS * 1000;

  const recent = attempts
    .filter((attempt) => attempt.reason !== LOCKED_OUT_REASON && attempt.reason !== ADDRESS_THROTTLED_REASON)
    .filter((attempt) => attempt.createdAt.getTime() > windowStart)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const consecutive: AttemptRecord[] = [];
  for (const attempt of recent) {
    if (attempt.succeeded) break;
    consecutive.push(attempt);
  }

  if (consecutive.length < LOGIN_MAX_FAILURES) {
    return { locked: false, failuresInWindow: consecutive.length, retryAfterSeconds: 0 };
  }

  const newest = consecutive[0];
  const elapsed = newest ? Math.floor((now.getTime() - newest.createdAt.getTime()) / 1000) : LOGIN_LOCKOUT_SECONDS;
  const remaining = LOGIN_LOCKOUT_SECONDS - elapsed;

  if (remaining <= 0) {
    return { locked: false, failuresInWindow: consecutive.length, retryAfterSeconds: 0 };
  }

  return { locked: true, failuresInWindow: consecutive.length, retryAfterSeconds: remaining };
}
