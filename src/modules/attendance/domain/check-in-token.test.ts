import { describe, expect, it } from 'vitest';
import {
  CHECK_IN_MAX_ATTEMPTS,
  CHECK_IN_TOKEN_TTL_SECONDS,
  checkInTokenExpiry,
  evaluateCheckInToken,
  generateCheckInCode,
  hashCheckInCode,
  parseQrPayload,
  qrPayload,
  type CheckInTokenRecord,
} from './check-in-token';

const SECRET = 'test-session-secret-value-at-least-32-chars';
const ASSIGNMENT = '11111111-2222-4333-8444-555555555555';
const OTHER_ASSIGNMENT = '99999999-8888-4777-8666-555555555555';
const NOW = new Date('2026-09-14T09:00:00.000Z');

function record(overrides: Partial<CheckInTokenRecord> = {}): CheckInTokenRecord {
  return {
    codeHash: hashCheckInCode('123456', ASSIGNMENT, 'CHECK_IN', SECRET),
    expiresAt: new Date(NOW.getTime() + 60_000),
    attempts: 0,
    consumedAt: null,
    ...overrides,
  };
}

describe('generateCheckInCode', () => {
  it('is always six digits, including when the number is small', () => {
    for (let index = 0; index < 200; index += 1) {
      expect(generateCheckInCode()).toMatch(/^\d{6}$/);
    }
  });
});

describe('hashCheckInCode', () => {
  it('is stable for the same inputs', () => {
    expect(hashCheckInCode('123456', ASSIGNMENT, 'CHECK_IN', SECRET)).toBe(
      hashCheckInCode('123456', ASSIGNMENT, 'CHECK_IN', SECRET),
    );
  });

  it('does not contain the code it hashed', () => {
    expect(hashCheckInCode('123456', ASSIGNMENT, 'CHECK_IN', SECRET)).not.toContain('123456');
  });

  it('binds the purpose, so a check-in code cannot be replayed as a check-out', () => {
    expect(hashCheckInCode('123456', ASSIGNMENT, 'CHECK_IN', SECRET)).not.toBe(
      hashCheckInCode('123456', ASSIGNMENT, 'CHECK_OUT', SECRET),
    );
  });

  it('binds the assignment, so a code from one shift cannot open another', () => {
    expect(hashCheckInCode('123456', ASSIGNMENT, 'CHECK_IN', SECRET)).not.toBe(
      hashCheckInCode('123456', OTHER_ASSIGNMENT, 'CHECK_IN', SECRET),
    );
  });

  it('is useless without the server secret', () => {
    expect(hashCheckInCode('123456', ASSIGNMENT, 'CHECK_IN', SECRET)).not.toBe(
      hashCheckInCode('123456', ASSIGNMENT, 'CHECK_IN', 'a-different-secret-long-enough-here'),
    );
  });
});

describe('the QR payload', () => {
  it('round-trips', () => {
    const payload = qrPayload(ASSIGNMENT, 'CHECK_IN', '123456');
    expect(parseQrPayload(payload)).toEqual({
      assignmentId: ASSIGNMENT,
      purpose: 'CHECK_IN',
      code: '123456',
    });
  });

  it('round-trips a check-out', () => {
    const parsed = parseQrPayload(qrPayload(ASSIGNMENT, 'CHECK_OUT', '654321'));
    expect(parsed?.purpose).toBe('CHECK_OUT');
  });

  it('tolerates surrounding whitespace from a scanner', () => {
    expect(parseQrPayload(`  ${qrPayload(ASSIGNMENT, 'CHECK_IN', '123456')}\n`)).not.toBeNull();
  });

  it.each([
    'not a url',
    'medilink://attendance/check_in/not-a-uuid/123456',
    'medilink://attendance/check_in/11111111-2222-4333-8444-555555555555/12345',
    'medilink://attendance/sign_in/11111111-2222-4333-8444-555555555555/123456',
    'https://example.com/attendance/check_in/11111111-2222-4333-8444-555555555555/123456',
  ])('refuses %o', (payload) => {
    expect(parseQrPayload(payload)).toBeNull();
  });

  it('carries the assignment, so the server can re-derive the digest from the scan alone', () => {
    // A payload naming a different assignment simply will not match, because
    // the assignment is bound into the hash.
    const parsed = parseQrPayload(qrPayload(OTHER_ASSIGNMENT, 'CHECK_IN', '123456'));
    expect(
      hashCheckInCode(parsed!.code, parsed!.assignmentId, parsed!.purpose, SECRET),
    ).not.toBe(hashCheckInCode('123456', ASSIGNMENT, 'CHECK_IN', SECRET));
  });
});

describe('evaluateCheckInToken', () => {
  const good = hashCheckInCode('123456', ASSIGNMENT, 'CHECK_IN', SECRET);
  const wrong = hashCheckInCode('000000', ASSIGNMENT, 'CHECK_IN', SECRET);

  it('accepts a matching, live token', () => {
    expect(evaluateCheckInToken(record(), good, NOW)).toEqual({ ok: true });
  });

  it('refuses when there is no token at all', () => {
    expect(evaluateCheckInToken(null, good, NOW)).toMatchObject({
      ok: false,
      reason: 'no_token',
    });
  });

  it('refuses an expired token', () => {
    // Step 7.2's stated test: an expired QR or OTP is rejected.
    const expired = record({ expiresAt: new Date(NOW.getTime() - 1) });
    expect(evaluateCheckInToken(expired, good, NOW)).toMatchObject({ reason: 'expired' });
  });

  it('treats the expiry instant as already expired', () => {
    expect(evaluateCheckInToken(record({ expiresAt: NOW }), good, NOW)).toMatchObject({
      reason: 'expired',
    });
  });

  it('refuses a token that has already been used', () => {
    const used = record({ consumedAt: new Date(NOW.getTime() - 1000) });
    expect(evaluateCheckInToken(used, good, NOW)).toMatchObject({ reason: 'already_used' });
  });

  it('refuses once the attempts are exhausted', () => {
    const spent = record({ attempts: CHECK_IN_MAX_ATTEMPTS });
    expect(evaluateCheckInToken(spent, good, NOW)).toMatchObject({
      reason: 'too_many_attempts',
    });
  });

  it('refuses a wrong code and counts down the attempts', () => {
    expect(evaluateCheckInToken(record({ attempts: 1 }), wrong, NOW)).toEqual({
      ok: false,
      reason: 'mismatch',
      attemptsRemaining: CHECK_IN_MAX_ATTEMPTS - 2,
    });
  });

  it('refuses a consumed token before it looks at expiry or the code', () => {
    // Order matters: a caller must not be able to tell a used token from an
    // expired one, or a wrong code from either.
    const used = record({ consumedAt: NOW, expiresAt: new Date(NOW.getTime() - 1) });
    expect(evaluateCheckInToken(used, wrong, NOW)).toMatchObject({ reason: 'already_used' });
  });

  it('refuses garbage that is not a digest', () => {
    expect(evaluateCheckInToken(record(), 'not-a-hex-digest', NOW)).toMatchObject({
      reason: 'mismatch',
    });
    expect(evaluateCheckInToken(record({ codeHash: '' }), '', NOW)).toMatchObject({
      reason: 'mismatch',
    });
  });
});

describe('checkInTokenExpiry', () => {
  it('is five minutes out', () => {
    // Long enough to read a code down a ward, short enough that a photograph
    // of a QR on a noticeboard is worthless by the time anyone else uses it.
    expect(checkInTokenExpiry(NOW).getTime() - NOW.getTime()).toBe(
      CHECK_IN_TOKEN_TTL_SECONDS * 1000,
    );
    expect(CHECK_IN_TOKEN_TTL_SECONDS).toBe(300);
  });
});
