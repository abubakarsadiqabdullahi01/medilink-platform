import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', async () => {
  const { cookieJar } = await import('./support/cookie-jar');
  return { cookies: () => cookieJar };
});

import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/password';
import { login } from '@/modules/auth/application/login';
import {
  LOGIN_MAX_FAILURES,
  LOGIN_MAX_FAILURES_PER_ADDRESS_PER_HOUR,
} from '@/modules/auth/domain/lockout';
import { clearCookies } from './support/cookie-jar';
import { createUser } from './support/fixtures';

/**
 * AUT-02, the half the first fix left. Sending codes was limited per address; the
 * password step was throttled per phone number only, so one address could guess a
 * thousand different numbers' passwords, one try each, and nothing would notice.
 *
 * The limit is generous because a ward can share one address, and what it caps is
 * guessing across many numbers, not a person who forgot their password.
 */

const PASSWORD = 'Correct-horse-battery-7';
const NOW = new Date('2026-10-14T12:00:00.000Z');
const ago = (seconds: number) => new Date(NOW.getTime() - seconds * 1000);
const ADDRESS = '203.0.113.9';

beforeEach(() => {
  clearCookies();
});

async function account() {
  const user = await createUser({ fullName: 'Amina Yusuf' });
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(PASSWORD) } });
  return user;
}

async function failuresFrom(address: string, count: number, at: Date, reason = 'unknown_identifier') {
  await prisma.loginAttempt.createMany({
    data: Array.from({ length: count }, (_, index) => ({
      identifier: `+23480${String(index).padStart(8, '0')}`,
      succeeded: false,
      reason,
      ipAddress: address,
      createdAt: at,
    })),
  });
}

const codeOf = (attempt: Promise<unknown>) =>
  attempt.then(
    () => 'ok',
    (error: { code: string }) => error.code,
  );

describe('failed sign-ins from one address', () => {
  it('are refused once the hourly limit is reached, even with the right password', async () => {
    const user = await account();
    await failuresFrom(ADDRESS, LOGIN_MAX_FAILURES_PER_ADDRESS_PER_HOUR, ago(60));

    const result = await codeOf(login({ phone: user.phone, password: PASSWORD, ipAddress: ADDRESS, now: NOW }));

    expect(result).toBe('too_many_attempts');
  });

  it('say how long to wait', async () => {
    const user = await account();
    await failuresFrom(ADDRESS, LOGIN_MAX_FAILURES_PER_ADDRESS_PER_HOUR, ago(600));

    const error = await login({ phone: user.phone, password: PASSWORD, ipAddress: ADDRESS, now: NOW }).catch(
      (caught: { retryAfterSeconds?: number }) => caught,
    );

    // The oldest of them leaves the hour in fifty minutes.
    expect((error as { retryAfterSeconds: number }).retryAfterSeconds).toBeGreaterThan(2900);
    expect((error as { retryAfterSeconds: number }).retryAfterSeconds).toBeLessThanOrEqual(3000);
  });

  it('do not stop another address', async () => {
    const user = await account();
    await failuresFrom(ADDRESS, LOGIN_MAX_FAILURES_PER_ADDRESS_PER_HOUR, ago(60));

    const session = await login({ phone: user.phone, password: PASSWORD, ipAddress: '198.51.100.7', now: NOW });

    expect(session.token).toBeTruthy();
  });

  it('are let through again once they are older than an hour', async () => {
    const user = await account();
    await failuresFrom(ADDRESS, LOGIN_MAX_FAILURES_PER_ADDRESS_PER_HOUR, ago(3700));

    const session = await login({ phone: user.phone, password: PASSWORD, ipAddress: ADDRESS, now: NOW });

    expect(session.token).toBeTruthy();
  });

  it('leave a person on a busy address alone while it is below the limit', async () => {
    const user = await account();
    await failuresFrom(ADDRESS, LOGIN_MAX_FAILURES_PER_ADDRESS_PER_HOUR - 1, ago(60));

    const session = await login({ phone: user.phone, password: PASSWORD, ipAddress: ADDRESS, now: NOW });

    expect(session.token).toBeTruthy();
  });

  it('do not count what was refused, or the throttle would extend itself', async () => {
    const user = await account();
    await failuresFrom(ADDRESS, LOGIN_MAX_FAILURES_PER_ADDRESS_PER_HOUR, ago(3500));
    // Knocked on repeatedly while refused.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await login({ phone: user.phone, password: 'x', ipAddress: ADDRESS, now: new Date(NOW.getTime() - 100_000 + attempt) }).catch(
        () => undefined,
      );
    }

    // Once the original failures are an hour old it is over, however many knocks.
    const later = new Date(NOW.getTime() + 200_000);
    const session = await login({ phone: user.phone, password: PASSWORD, ipAddress: ADDRESS, now: later });

    expect(session.token).toBeTruthy();
  });

  it('are not counted against the number that was typed: a refused knock cannot lock the owner out', async () => {
    const victim = await account();
    await failuresFrom(ADDRESS, LOGIN_MAX_FAILURES_PER_ADDRESS_PER_HOUR, ago(60));

    for (let attempt = 0; attempt < LOGIN_MAX_FAILURES + 3; attempt += 1) {
      await login({ phone: victim.phone, password: 'x', ipAddress: ADDRESS, now: NOW }).catch(() => undefined);
    }

    // The owner, from their own address, is not locked.
    const session = await login({ phone: victim.phone, password: PASSWORD, ipAddress: '198.51.100.7', now: NOW });
    expect(session.token).toBeTruthy();
  });

  it('count only failures: successes do not use up the budget', async () => {
    const user = await account();
    await prisma.loginAttempt.createMany({
      data: Array.from({ length: LOGIN_MAX_FAILURES_PER_ADDRESS_PER_HOUR }, () => ({
        identifier: user.phone,
        succeeded: true,
        ipAddress: ADDRESS,
        createdAt: ago(60),
      })),
    });

    const session = await login({ phone: user.phone, password: PASSWORD, ipAddress: ADDRESS, now: NOW });

    expect(session.token).toBeTruthy();
  });

  it('are not throttled when the address is not known', async () => {
    const user = await account();
    await failuresFrom(ADDRESS, LOGIN_MAX_FAILURES_PER_ADDRESS_PER_HOUR, ago(60));

    const session = await login({ phone: user.phone, password: PASSWORD, now: NOW });

    expect(session.token).toBeTruthy();
  });
});
