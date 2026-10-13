import { describe, expect, it } from 'vitest';
import {
  issueSetupToken,
  SETUP_TOKEN_TTL_SECONDS,
  verifySetupToken,
} from './setup-token';

const SECRET = 'a-secret-that-is-long-enough-for-the-test-0123456789';
const USER = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
const NOW = new Date('2026-09-04T12:00:00.000Z');
const later = (seconds: number) => new Date(NOW.getTime() + seconds * 1000);

describe('the password-setup token', () => {
  it('is accepted for the person it was issued to, soon after', () => {
    const token = issueSetupToken(USER, NOW, SECRET);
    expect(verifySetupToken(token, USER, later(60), SECRET)).toBe(true);
  });

  it('is refused for anybody else', () => {
    const token = issueSetupToken(USER, NOW, SECRET);
    expect(verifySetupToken(token, OTHER, later(60), SECRET)).toBe(false);
  });

  it('runs out', () => {
    const token = issueSetupToken(USER, NOW, SECRET);
    expect(verifySetupToken(token, USER, later(SETUP_TOKEN_TTL_SECONDS - 1), SECRET)).toBe(true);
    expect(verifySetupToken(token, USER, later(SETUP_TOKEN_TTL_SECONDS + 1), SECRET)).toBe(false);
  });

  it('cannot be extended by editing the expiry', () => {
    const token = issueSetupToken(USER, NOW, SECRET);
    const [expiry, signature] = token.split('.');
    const forged = `${Number(expiry) + 86_400}.${signature}`;
    expect(verifySetupToken(forged, USER, later(SETUP_TOKEN_TTL_SECONDS + 60), SECRET)).toBe(false);
  });

  it('is refused under a different secret', () => {
    const token = issueSetupToken(USER, NOW, SECRET);
    expect(verifySetupToken(token, USER, later(60), `${SECRET}-rotated`)).toBe(false);
  });

  it.each(['', 'nonsense', '123', '123.', '.abc', 'a.b.c', `${NOW.getTime()}.zz`])(
    'refuses malformed input %j without throwing',
    (token) => {
      expect(verifySetupToken(token, USER, later(60), SECRET)).toBe(false);
    },
  );
});
