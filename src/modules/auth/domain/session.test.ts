import { describe, expect, it } from 'vitest';
import {
  generateSessionToken,
  hashSessionToken,
  isSessionUsable,
  isStepUpFresh,
  sessionCookieOptions,
  sessionExpiry,
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  STEP_UP_WINDOW_SECONDS,
  type SessionRecord,
} from './session';

const NOW = new Date('2026-09-04T12:00:00.000Z');

function session(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    expiresAt: new Date(NOW.getTime() + 60_000),
    revokedAt: null,
    stepUpAt: null,
    ...overrides,
  };
}

describe('generateSessionToken', () => {
  it('returns a token with its matching hash', () => {
    const { token, tokenHash } = generateSessionToken();
    expect(hashSessionToken(token)).toBe(tokenHash);
  });

  it('never repeats a token', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateSessionToken().token));
    expect(tokens.size).toBe(200);
  });

  it('does not store the token itself', () => {
    const { token, tokenHash } = generateSessionToken();
    expect(tokenHash).not.toContain(token);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is URL-safe, so it survives a cookie round trip', () => {
    for (let index = 0; index < 50; index += 1) {
      expect(generateSessionToken().token).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });
});

describe('isSessionUsable', () => {
  it('accepts a live session', () => {
    expect(isSessionUsable(session(), NOW)).toBe(true);
  });

  it('refuses an expired session', () => {
    expect(isSessionUsable(session({ expiresAt: new Date(NOW.getTime() - 1) }), NOW)).toBe(false);
  });

  it('refuses a revoked session even before it expires', () => {
    // This is the reason sessions are server-side: suspending an account has
    // to end access now, not when a token happens to expire.
    expect(isSessionUsable(session({ revokedAt: NOW }), NOW)).toBe(false);
  });

  it('refuses a missing session', () => {
    expect(isSessionUsable(null, NOW)).toBe(false);
  });
});

describe('isStepUpFresh', () => {
  it('is false when the user has never stepped up', () => {
    expect(isStepUpFresh(session(), NOW)).toBe(false);
    expect(isStepUpFresh(null, NOW)).toBe(false);
  });

  it('is true inside the window', () => {
    const recent = session({ stepUpAt: new Date(NOW.getTime() - 60_000) });
    expect(isStepUpFresh(recent, NOW)).toBe(true);
  });

  it('expires after the window', () => {
    const stale = session({
      stepUpAt: new Date(NOW.getTime() - (STEP_UP_WINDOW_SECONDS + 1) * 1000),
    });
    expect(isStepUpFresh(stale, NOW)).toBe(false);
  });
});

describe('sessionExpiry', () => {
  it('matches the configured lifetime', () => {
    expect(sessionExpiry(NOW).getTime() - NOW.getTime()).toBe(SESSION_TTL_SECONDS * 1000);
  });
});

describe('sessionCookieOptions', () => {
  it('is always httpOnly and lax, so script cannot read it', () => {
    const options = sessionCookieOptions(NOW, false);
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe('lax');
    expect(options.name).toBe(SESSION_COOKIE_NAME);
  });

  it('requires HTTPS everywhere except local development', () => {
    expect(sessionCookieOptions(NOW, true).secure).toBe(true);
    expect(sessionCookieOptions(NOW, false).secure).toBe(false);
  });
});
