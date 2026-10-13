import { describe, expect, it } from 'vitest';
import {
  lockoutState,
  LOGIN_FAILURE_WINDOW_SECONDS,
  LOGIN_LOCKOUT_SECONDS,
  LOGIN_MAX_FAILURES,
  type AttemptRecord,
} from './lockout';

const NOW = new Date('2026-09-04T12:00:00.000Z');

function failures(count: number, secondsAgoStart = 10): AttemptRecord[] {
  return Array.from({ length: count }, (_unused, index) => ({
    succeeded: false,
    createdAt: new Date(NOW.getTime() - (secondsAgoStart + index) * 1000),
  }));
}

describe('lockoutState', () => {
  it('does not lock a clean account', () => {
    expect(lockoutState([], NOW)).toEqual({
      locked: false,
      failuresInWindow: 0,
      retryAfterSeconds: 0,
    });
  });

  it('tolerates failures below the limit', () => {
    const state = lockoutState(failures(LOGIN_MAX_FAILURES - 1), NOW);
    expect(state.locked).toBe(false);
    expect(state.failuresInWindow).toBe(LOGIN_MAX_FAILURES - 1);
  });

  it('locks at the limit and reports how long to wait', () => {
    const state = lockoutState(failures(LOGIN_MAX_FAILURES), NOW);
    expect(state.locked).toBe(true);
    expect(state.retryAfterSeconds).toBeGreaterThan(0);
    expect(state.retryAfterSeconds).toBeLessThanOrEqual(LOGIN_LOCKOUT_SECONDS);
  });

  it('clears the count after a success', () => {
    // A user who mistypes four times, gets in, then mistypes once more must
    // not be one attempt from a lockout.
    const attempts: AttemptRecord[] = [
      { succeeded: false, createdAt: new Date(NOW.getTime() - 5_000) },
      { succeeded: true, createdAt: new Date(NOW.getTime() - 10_000) },
      ...failures(LOGIN_MAX_FAILURES, 20),
    ];
    const state = lockoutState(attempts, NOW);
    expect(state.locked).toBe(false);
    expect(state.failuresInWindow).toBe(1);
  });

  it('ignores failures older than the window', () => {
    const stale = failures(LOGIN_MAX_FAILURES, LOGIN_FAILURE_WINDOW_SECONDS + 5);
    expect(lockoutState(stale, NOW).locked).toBe(false);
  });

  it('releases the lock once the lockout period has elapsed', () => {
    const old = failures(LOGIN_MAX_FAILURES, LOGIN_LOCKOUT_SECONDS + 1);
    expect(lockoutState(old, NOW).locked).toBe(false);
  });

  it('extends the lock when a locked-out user keeps trying', () => {
    const attempts = [
      ...failures(LOGIN_MAX_FAILURES, LOGIN_LOCKOUT_SECONDS - 30),
      { succeeded: false, createdAt: new Date(NOW.getTime() - 1_000) },
    ];
    const state = lockoutState(attempts, NOW);
    expect(state.locked).toBe(true);
    expect(state.retryAfterSeconds).toBeGreaterThan(LOGIN_LOCKOUT_SECONDS - 30);
  });

  it('does not assume the attempts are ordered', () => {
    const shuffled = [
      { succeeded: false, createdAt: new Date(NOW.getTime() - 300_000) },
      ...failures(LOGIN_MAX_FAILURES),
    ];
    expect(lockoutState(shuffled, NOW).locked).toBe(true);
  });
});


describe('lockoutState and the attempts made while locked', () => {
  const lockedFor = (secondsAgo: number): AttemptRecord[] => failures(LOGIN_MAX_FAILURES, secondsAgo);

  it('does not let a refused attempt extend the lock', () => {
    // Each attempt made while locked is itself written down as a failure. Counted
    // as one, every such attempt pushed the lock out by another fifteen minutes,
    // so anybody could keep a stranger's account locked by knocking on it.
    const refused: AttemptRecord = {
      succeeded: false,
      reason: 'locked_out',
      createdAt: new Date(NOW.getTime() - 5_000),
    };
    const real = lockedFor(LOGIN_LOCKOUT_SECONDS - 100);

    const state = lockoutState([refused, ...real], NOW);
    expect(state.locked).toBe(true);
    // Still about a hundred seconds, not fifteen minutes.
    expect(state.retryAfterSeconds).toBeLessThanOrEqual(110);
  });

  it('releases the lock on schedule however many attempts were refused meanwhile', () => {
    const refused = Array.from({ length: 20 }, (_unused, index) => ({
      succeeded: false,
      reason: 'locked_out',
      createdAt: new Date(NOW.getTime() - (1 + index) * 1000),
    }));
    const real = lockedFor(LOGIN_LOCKOUT_SECONDS + 1);

    expect(lockoutState([...refused, ...real], NOW).locked).toBe(false);
  });

  it('still counts a refused attempt as nothing at all, not as a success', () => {
    const refused: AttemptRecord = {
      succeeded: false,
      reason: 'locked_out',
      createdAt: new Date(NOW.getTime() - 1_000),
    };
    // Four real failures and a refusal: one short of the limit, so not locked.
    const state = lockoutState([refused, ...failures(LOGIN_MAX_FAILURES - 1, 30)], NOW);
    expect(state.locked).toBe(false);
    expect(state.failuresInWindow).toBe(LOGIN_MAX_FAILURES - 1);
  });
});
