import { describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { verifyOtp } from '@/modules/auth/application/otp-service';
import { hashOtpCode, OTP_MAX_ATTEMPTS } from '@/modules/auth/domain/otp';
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
