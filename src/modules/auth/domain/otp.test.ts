import { describe, expect, it } from 'vitest';
import {
  digestsMatch,
  evaluateOtp,
  evaluateResend,
  generateOtpCode,
  hashOtpCode,
  otpExpiry,
  OTP_LENGTH,
  OTP_MAX_ATTEMPTS,
  OTP_MAX_SENDS_OVERALL_PER_HOUR,
  OTP_MAX_SENDS_PER_ADDRESS_PER_HOUR,
  OTP_MAX_SENDS_PER_HOUR,
  evaluateSendBudget,
  OTP_RESEND_COOLDOWN_SECONDS,
  type OtpRecord,
} from './otp';

const SECRET = 'test-secret-value-of-at-least-32-characters';
const USER = '11111111-1111-1111-1111-111111111111';
const NOW = new Date('2026-09-04T12:00:00.000Z');

function record(overrides: Partial<OtpRecord> = {}): OtpRecord {
  return {
    codeHash: hashOtpCode('123456', USER, 'PHONE_VERIFICATION', SECRET),
    expiresAt: new Date(NOW.getTime() + 60_000),
    attempts: 0,
    consumedAt: null,
    ...overrides,
  };
}

describe('generateOtpCode', () => {
  it('always produces the full length, including codes with leading zeros', () => {
    for (let index = 0; index < 500; index += 1) {
      const code = generateOtpCode();
      expect(code).toHaveLength(OTP_LENGTH);
      expect(code).toMatch(/^\d+$/);
    }
  });
});

describe('hashOtpCode', () => {
  it('binds the code to the user and the purpose', () => {
    const forVerification = hashOtpCode('123456', USER, 'PHONE_VERIFICATION', SECRET);
    const forReset = hashOtpCode('123456', USER, 'PASSWORD_RESET', SECRET);
    const forAnotherUser = hashOtpCode('123456', 'other-user', 'PHONE_VERIFICATION', SECRET);

    // A code issued to reset a password must not work as a step-up or a
    // verification, and must not work for a different account.
    expect(forVerification).not.toBe(forReset);
    expect(forVerification).not.toBe(forAnotherUser);
  });

  it('does not reveal the code', () => {
    expect(hashOtpCode('123456', USER, 'LOGIN', SECRET)).not.toContain('123456');
  });

  it('changes completely when the server secret changes', () => {
    expect(hashOtpCode('123456', USER, 'LOGIN', SECRET)).not.toBe(
      hashOtpCode('123456', USER, 'LOGIN', `${SECRET}-rotated`),
    );
  });
});

describe('digestsMatch', () => {
  it('matches identical digests and rejects different ones', () => {
    const digest = hashOtpCode('123456', USER, 'LOGIN', SECRET);
    expect(digestsMatch(digest, digest)).toBe(true);
    expect(digestsMatch(digest, hashOtpCode('654321', USER, 'LOGIN', SECRET))).toBe(false);
  });

  it('rejects malformed input without throwing', () => {
    expect(digestsMatch('abc', 'abcd')).toBe(false);
    expect(digestsMatch('zz', 'zz')).toBe(false);
  });
});

describe('evaluateOtp', () => {
  const correct = hashOtpCode('123456', USER, 'PHONE_VERIFICATION', SECRET);
  const wrong = hashOtpCode('000000', USER, 'PHONE_VERIFICATION', SECRET);

  it('accepts the correct code inside its window', () => {
    expect(evaluateOtp(record(), correct, NOW)).toEqual({ ok: true });
  });

  it('rejects a wrong code and counts down the remaining attempts', () => {
    expect(evaluateOtp(record({ attempts: 2 }), wrong, NOW)).toEqual({
      ok: false,
      reason: 'mismatch',
      attemptsRemaining: OTP_MAX_ATTEMPTS - 3,
    });
  });

  it('rejects an expired code even when the digits are right', () => {
    const expired = record({ expiresAt: new Date(NOW.getTime() - 1000) });
    expect(evaluateOtp(expired, correct, NOW)).toMatchObject({ ok: false, reason: 'expired' });
  });

  it('treats the expiry boundary as expired', () => {
    const boundary = record({ expiresAt: NOW });
    expect(evaluateOtp(boundary, correct, NOW)).toMatchObject({ ok: false, reason: 'expired' });
  });

  it('refuses a code that has already been used', () => {
    const used = record({ consumedAt: new Date(NOW.getTime() - 5000) });
    expect(evaluateOtp(used, correct, NOW)).toMatchObject({ ok: false, reason: 'already_used' });
  });

  it('stops accepting the correct code once attempts are exhausted', () => {
    const exhausted = record({ attempts: OTP_MAX_ATTEMPTS });
    expect(evaluateOtp(exhausted, correct, NOW)).toMatchObject({
      ok: false,
      reason: 'too_many_attempts',
    });
  });

  it('checks exhaustion before expiry, so a guess cannot exceed the cap', () => {
    const both = record({ attempts: OTP_MAX_ATTEMPTS, expiresAt: new Date(NOW.getTime() - 1) });
    expect(evaluateOtp(both, wrong, NOW)).toMatchObject({ reason: 'too_many_attempts' });
  });

  it('reports a missing code without leaking why', () => {
    expect(evaluateOtp(null, correct, NOW)).toMatchObject({ ok: false, reason: 'no_code' });
  });
});

describe('otpExpiry', () => {
  it('sits in the future and matches the configured lifetime', () => {
    const expiry = otpExpiry(NOW);
    expect(expiry.getTime()).toBeGreaterThan(NOW.getTime());
    expect(expiry.getTime() - NOW.getTime()).toBe(600 * 1000);
  });
});

describe('evaluateResend', () => {
  it('allows the first send', () => {
    expect(evaluateResend([], NOW)).toEqual({ ok: true });
  });

  it('holds a resend inside the cooldown and reports the wait', () => {
    const justSent = [new Date(NOW.getTime() - 10_000)];
    expect(evaluateResend(justSent, NOW)).toEqual({
      ok: false,
      reason: 'cooldown',
      retryAfterSeconds: OTP_RESEND_COOLDOWN_SECONDS - 10,
    });
  });

  it('allows a resend once the cooldown has passed', () => {
    const earlier = [new Date(NOW.getTime() - (OTP_RESEND_COOLDOWN_SECONDS + 1) * 1000)];
    expect(evaluateResend(earlier, NOW)).toEqual({ ok: true });
  });

  it('caps the number of sends in an hour', () => {
    const sends = Array.from(
      { length: OTP_MAX_SENDS_PER_HOUR },
      (_unused, index) => new Date(NOW.getTime() - (index + 2) * 120_000),
    );
    const verdict = evaluateResend(sends, NOW);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toBe('hourly_limit');
      expect(verdict.retryAfterSeconds).toBeGreaterThan(0);
    }
  });

  it('ignores sends older than an hour', () => {
    const stale = Array.from(
      { length: OTP_MAX_SENDS_PER_HOUR + 3 },
      (_unused, index) => new Date(NOW.getTime() - 3600 * 1000 - (index + 1) * 1000),
    );
    expect(evaluateResend(stale, NOW)).toEqual({ ok: true });
  });

  it('does not assume the history is ordered', () => {
    const shuffled = [
      new Date(NOW.getTime() - 4000 * 1000),
      new Date(NOW.getTime() - 5_000),
      new Date(NOW.getTime() - 2000 * 1000),
    ];
    expect(evaluateResend(shuffled, NOW)).toMatchObject({ reason: 'cooldown' });
  });
});


describe('evaluateSendBudget', () => {
  it('allows ordinary use', () => {
    expect(evaluateSendBudget({ fromThisAddress: 3, overall: 40 })).toEqual({ ok: true });
  });

  it('stops one address once it has had its share', () => {
    expect(
      evaluateSendBudget({ fromThisAddress: OTP_MAX_SENDS_PER_ADDRESS_PER_HOUR, overall: 10 }),
    ).toMatchObject({ ok: false, reason: 'address_limit' });
    expect(
      evaluateSendBudget({ fromThisAddress: OTP_MAX_SENDS_PER_ADDRESS_PER_HOUR - 1, overall: 10 }),
    ).toEqual({ ok: true });
  });

  it('stops everybody once the overall budget is spent, whatever the address', () => {
    expect(
      evaluateSendBudget({ fromThisAddress: 0, overall: OTP_MAX_SENDS_OVERALL_PER_HOUR }),
    ).toMatchObject({ ok: false, reason: 'overall_limit' });
  });

  it('applies only the overall budget when the request carried no address', () => {
    expect(evaluateSendBudget({ fromThisAddress: null, overall: 10 })).toEqual({ ok: true });
    expect(
      evaluateSendBudget({ fromThisAddress: null, overall: OTP_MAX_SENDS_OVERALL_PER_HOUR }),
    ).toMatchObject({ ok: false, reason: 'overall_limit' });
  });
});
