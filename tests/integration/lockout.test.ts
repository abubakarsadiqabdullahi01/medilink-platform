import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', async () => {
  const { cookieJar } = await import('./support/cookie-jar');
  return { cookies: () => cookieJar };
});

import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { hashPassword } from '@/lib/password';
import { login } from '@/modules/auth/application/login';
import { confirmPasswordReset } from '@/modules/auth/application/recovery';
import { hashOtpCode } from '@/modules/auth/domain/otp';
import { LOGIN_LOCKOUT_SECONDS, LOGIN_MAX_FAILURES } from '@/modules/auth/domain/lockout';
import { clearCookies } from './support/cookie-jar';
import { createUser } from './support/fixtures';

/**
 * The per-phone lockout, from the point of view of the person it protects and
 * of somebody trying to use it against them.
 */

const PASSWORD = 'Correct-horse-battery-7';
const NEW_PASSWORD = 'Another-long-passphrase-42';
const BASE = new Date('2026-09-04T12:00:00.000Z');
const at = (seconds: number) => new Date(BASE.getTime() + seconds * 1000);

beforeEach(() => {
  clearCookies();
});

async function accountWithPassword() {
  const user = await createUser({ fullName: 'Amina Yusuf' });
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(PASSWORD) },
  });
  return user;
}

async function failToLogIn(phone: string, now: Date) {
  return login({ phone, password: 'not-the-password', now }).then(
    () => null,
    (error: { code: string }) => error.code,
  );
}

describe('a locked account', () => {
  it('locks after the limit of real failures', async () => {
    const user = await accountWithPassword();
    for (let i = 0; i < LOGIN_MAX_FAILURES; i += 1) {
      expect(await failToLogIn(user.phone, at(i))).toBe('invalid_credentials');
    }
    expect(await failToLogIn(user.phone, at(10))).toBe('account_locked');
  });

  it('is released on schedule, however many times it was knocked on meanwhile', async () => {
    const user = await accountWithPassword();
    for (let i = 0; i < LOGIN_MAX_FAILURES; i += 1) await failToLogIn(user.phone, at(i));

    // Somebody keeps trying while it is locked: each is refused and written down.
    for (let i = 1; i <= 10; i += 1) {
      expect(await failToLogIn(user.phone, at(i * 60))).toBe('account_locked');
    }
    expect(
      await prisma.loginAttempt.count({ where: { identifier: user.phone, reason: 'locked_out' } }),
    ).toBe(10);

    // Fifteen minutes after the last real failure the owner can get in. Counted
    // as failures, those ten refusals would have held the lock until minute 25.
    const session = await login({
      phone: user.phone,
      password: PASSWORD,
      now: at(LOGIN_MAX_FAILURES - 1 + LOGIN_LOCKOUT_SECONDS + 1),
    });
    expect(session.sessionId).toBeTruthy();
  });

  it('is cleared by completing a password reset', async () => {
    const user = await accountWithPassword();
    for (let i = 0; i < LOGIN_MAX_FAILURES; i += 1) await failToLogIn(user.phone, at(i));
    expect(await failToLogIn(user.phone, at(30))).toBe('account_locked');

    // The code they were sent, as the table would hold it.
    const code = '482913';
    await prisma.otpCode.create({
      data: {
        userId: user.id,
        purpose: 'PASSWORD_RESET',
        codeHash: hashOtpCode(code, user.id, 'PASSWORD_RESET', env.SESSION_SECRET),
        expiresAt: at(600),
      },
    });
    await confirmPasswordReset({ phone: user.phone, code, password: NEW_PASSWORD, now: at(60) });

    // Still inside what would have been the lock, and in with the new password.
    const session = await login({ phone: user.phone, password: NEW_PASSWORD, now: at(90) });
    expect(session.sessionId).toBeTruthy();
  });
});
