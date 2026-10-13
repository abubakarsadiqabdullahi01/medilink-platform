import { describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { verifyOtp } from '@/modules/auth/application/otp-service';
import { startRegistration } from '@/modules/auth/application/registration';
import {
  hashOtpCode,
  OTP_MAX_ATTEMPTS,
  OTP_MAX_SENDS_OVERALL_PER_HOUR,
  OTP_MAX_SENDS_PER_ADDRESS_PER_HOUR,
} from '@/modules/auth/domain/otp';
import { createUser } from './support/fixtures';

/**
 * The five-guess limit on a one-time code, under concurrent guessing.
 *
 * The counter was read, judged, and only then incremented in a separate step, so
 * guesses arriving together all read the old count and all were compared. A
 * six-digit code is safe only because there are very few guesses at it.
 */

const CODE = '482913';

async function issued(purpose: 'PHONE_VERIFICATION' | 'PASSWORD_RESET' = 'PASSWORD_RESET') {
  const user = await createUser();
  await prisma.otpCode.create({
    data: {
      userId: user.id,
      purpose,
      codeHash: hashOtpCode(CODE, user.id, purpose, env.SESSION_SECRET),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  });
  return user;
}

const guess = (userId: string, code: string) =>
  verifyOtp({ userId, purpose: 'PASSWORD_RESET', code }).then(
    () => 'ok',
    (error: { code: string }) => error.code,
  );

describe('guessing at a code', () => {
  it('allows no more than the limit, however many guesses arrive at once', async () => {
    const user = await issued();
    const wrong = Array.from({ length: 40 }, (_unused, i) => String(100000 + i));

    const verdicts = await Promise.all(wrong.map((code) => guess(user.id, code)));

    const compared = verdicts.filter((verdict) => verdict === 'otp_invalid').length;
    expect(compared).toBeLessThanOrEqual(OTP_MAX_ATTEMPTS);
    expect(verdicts.filter((verdict) => verdict === 'otp_exhausted').length).toBe(40 - compared);

    const row = await prisma.otpCode.findFirstOrThrow({ where: { userId: user.id } });
    expect(row.attempts).toBeLessThanOrEqual(OTP_MAX_ATTEMPTS);
    expect(
      await prisma.auditLog.count({ where: { action: 'auth.otp_attempt_failed', actorId: user.id } }),
    ).toBeLessThanOrEqual(OTP_MAX_ATTEMPTS);
  });

  it('refuses the right code once the guesses are used up, however it arrives', async () => {
    const user = await issued();
    await Promise.all(Array.from({ length: 20 }, (_unused, i) => guess(user.id, String(100000 + i))));

    expect(await guess(user.id, CODE)).toBe('otp_exhausted');
  });

  it('still accepts the right code after a few wrong ones', async () => {
    const user = await issued();
    expect(await guess(user.id, '000001')).toBe('otp_invalid');
    expect(await guess(user.id, '000002')).toBe('otp_invalid');
    expect(await guess(user.id, CODE)).toBe('ok');
  });

  it('lets the last permitted guess be the right one', async () => {
    const user = await issued();
    for (let i = 0; i < OTP_MAX_ATTEMPTS - 1; i += 1) {
      expect(await guess(user.id, String(100000 + i))).toBe('otp_invalid');
    }
    expect(await guess(user.id, CODE)).toBe('ok');
  });
});

describe('how many codes may be sent', () => {
  /**
   * Sends were limited per phone number only. Anybody with a list of numbers had
   * a fresh allowance for each, and every send is an SMS Medilink pays for.
   */
  const ADDRESS = '203.0.113.9';

  async function sentFrom(address: string | null, count: number) {
    const user = await createUser();
    await prisma.otpCode.createMany({
      data: Array.from({ length: count }, () => ({
        userId: user.id,
        purpose: 'PHONE_VERIFICATION' as const,
        codeHash: 'x',
        expiresAt: new Date(Date.now() + 600_000),
        consumedAt: new Date(),
        requestIp: address,
      })),
    });
  }

  it('stops one address from registering number after number', async () => {
    await sentFrom(ADDRESS, OTP_MAX_SENDS_PER_ADDRESS_PER_HOUR);
    const before = await prisma.user.count();

    await expect(
      startRegistration({ phone: '08031230001', fullName: 'Amina Yusuf', ipAddress: ADDRESS }),
    ).rejects.toMatchObject({ code: 'otp_throttled', status: 429 });

    // Refused before anything was made.
    expect(await prisma.user.count()).toBe(before);
  });

  it('does not hold that against everybody else', async () => {
    await sentFrom(ADDRESS, OTP_MAX_SENDS_PER_ADDRESS_PER_HOUR);

    await expect(
      startRegistration({ phone: '08031230002', fullName: 'Amina Yusuf', ipAddress: '198.51.100.7' }),
    ).resolves.toMatchObject({ existing: false });
  });

  it('counts a send from this address only for an hour', async () => {
    await sentFrom(ADDRESS, OTP_MAX_SENDS_PER_ADDRESS_PER_HOUR);
    await prisma.otpCode.updateMany({
      where: { requestIp: ADDRESS },
      data: { createdAt: new Date(Date.now() - 2 * 3600 * 1000) },
    });

    await expect(
      startRegistration({ phone: '08031230003', fullName: 'Amina Yusuf', ipAddress: ADDRESS }),
    ).resolves.toMatchObject({ existing: false });
  });

  it('stops everybody once the overall budget is spent, whatever the address', async () => {
    await sentFrom(null, OTP_MAX_SENDS_OVERALL_PER_HOUR);

    await expect(
      startRegistration({ phone: '08031230004', fullName: 'Amina Yusuf', ipAddress: '198.51.100.8' }),
    ).rejects.toMatchObject({ code: 'otp_throttled' });
  });

  it('records where a code was requested from', async () => {
    await startRegistration({ phone: '08031230005', fullName: 'Amina Yusuf', ipAddress: ADDRESS });
    expect((await prisma.otpCode.findFirstOrThrow({ orderBy: { createdAt: 'desc' } })).requestIp).toBe(
      ADDRESS,
    );
  });
});
