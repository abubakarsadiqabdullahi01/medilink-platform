/**
 * Login throttling, derived from identity.login_attempts rather than from
 * process memory. Medilink runs more than one web container, and a counter
 * held in memory resets on every deploy and is trivially bypassed by
 * distributing guesses across instances.
 */
export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_FAILURE_WINDOW_SECONDS = 900;
export const LOGIN_LOCKOUT_SECONDS = 900;

export interface AttemptRecord {
  succeeded: boolean;
  createdAt: Date;
}

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
