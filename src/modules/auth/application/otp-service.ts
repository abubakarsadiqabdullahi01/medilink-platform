import { prisma, type Tx } from '@/lib/db';
import { env } from '@/lib/env';
import { recordAudit } from '@/lib/audit';
import { trySendSms } from '@/lib/sms';
import { maskPhone } from '@/lib/phone';
import { logger } from '@/lib/logger';
import {
  evaluateOtp,
  evaluateResend,
  generateOtpCode,
  hashOtpCode,
  otpExpiry,
  otpMessageBody,
  OTP_MAX_SENDS_PER_HOUR,
  type OtpPurposeKey,
} from '../domain/otp';
import { AuthErrors } from '../domain/errors';

/**
 * Issuing and verifying one-time codes. The policy lives in ../domain/otp and
 * is unit-tested without a database; this layer only persists and delivers.
 */

/**
 * Codes are delivered after the transaction commits, not inside it. Holding a
 * transaction open across a network call to an SMS gateway parks a database
 * connection for the gateway's latency, and a gateway timeout would roll back
 * a code the practitioner has already received.
 */
export async function issueOtp(input: {
  userId: string;
  phone: string;
  purpose: OtpPurposeKey;
  actorId?: string;
  ipAddress?: string;
  now?: Date;
}): Promise<{ expiresAt: Date; sendsRemainingThisHour: number }> {
  const now = input.now ?? new Date();
  const purpose = input.purpose;

  const recent = await prisma.otpCode.findMany({
    where: {
      userId: input.userId,
      purpose,
      createdAt: { gt: new Date(now.getTime() - 3600 * 1000) },
    },
    select: { createdAt: true },
  });

  const verdict = evaluateResend(
    recent.map((row: { createdAt: Date }) => row.createdAt),
    now,
  );
  if (!verdict.ok) {
    throw AuthErrors.otpThrottled(verdict.retryAfterSeconds);
  }

  const code = generateOtpCode();
  const codeHash = hashOtpCode(code, input.userId, input.purpose, env.SESSION_SECRET);
  const expiresAt = otpExpiry(now);

  await prisma.$transaction(async (tx: Tx) => {
    // Supersede any code still outstanding for this purpose, so a stale
    // message arriving late cannot be used after a new one is requested.
    await tx.otpCode.updateMany({
      where: { userId: input.userId, purpose, consumedAt: null },
      data: { consumedAt: now },
    });

    await tx.otpCode.create({
      data: { userId: input.userId, purpose, codeHash, expiresAt },
    });

    await recordAudit(tx, {
      action: 'auth.otp_issued',
      entityType: 'identity.otp_codes',
      entityId: input.userId,
      actorId: input.actorId ?? input.userId,
      actorType: input.actorId ? 'user' : 'system',
      scopeType: 'SELF',
      scopeId: input.userId,
      after: { purpose: input.purpose, phone: maskPhone(input.phone) },
      ipAddress: input.ipAddress,
    });
  });

  await trySendSms({
    to: input.phone,
    body: otpMessageBody(code, input.purpose),
    transactional: true,
  });

  return {
    expiresAt,
    sendsRemainingThisHour: Math.max(0, OTP_MAX_SENDS_PER_HOUR - (recent.length + 1)),
  };
}

/**
 * Verifies and consumes a code. The failed-attempt counter is incremented
 * before the caller learns the result, so abandoning the request mid-flight
 * does not buy a free guess.
 */
export async function consumeOtp(input: {
  userId: string;
  purpose: OtpPurposeKey;
  code: string;
  tx?: Tx;
  now?: Date;
}): Promise<void> {
  const now = input.now ?? new Date();
  const purpose = input.purpose;
  const client = input.tx ?? prisma;

  const record = await client.otpCode.findFirst({
    where: { userId: input.userId, purpose, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });

  const submittedHash = hashOtpCode(input.code, input.userId, input.purpose, env.SESSION_SECRET);
  const verdict = evaluateOtp(record, submittedHash, now);

  if (!verdict.ok) {
    if (record && verdict.reason === 'mismatch') {
      await client.otpCode.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      });
    }
    logger.warn('otp verification failed', { userId: input.userId, reason: verdict.reason });

    switch (verdict.reason) {
      case 'expired':
        throw AuthErrors.otpExpired();
      case 'too_many_attempts':
        throw AuthErrors.otpExhausted();
      default:
        throw AuthErrors.otpInvalid();
    }
  }

  if (!record) throw AuthErrors.otpInvalid();

  // Consume conditionally: two concurrent submissions of the same valid code
  // must result in exactly one success.
  const consumed = await client.otpCode.updateMany({
    where: { id: record.id, consumedAt: null },
    data: { consumedAt: now },
  });

  if (consumed.count !== 1) throw AuthErrors.otpInvalid();
}
