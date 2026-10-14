import { prisma, type Tx } from '@/lib/db';
import { env } from '@/lib/env';
import { recordAudit } from '@/lib/audit';
import { attemptSms } from '@/lib/sms';
import { maskPhone } from '@/lib/phone';
import { logger } from '@/lib/logger';
import {
  evaluateOtp,
  evaluateResend,
  evaluateSendBudget,
  generateOtpCode,
  hashOtpCode,
  otpExpiry,
  otpMessageBody,
  OTP_MAX_ATTEMPTS,
  OTP_MAX_SENDS_PER_HOUR,
  type OtpPurposeKey,
} from '../domain/otp';
import { AuthErrors } from '../domain/errors';

/**
 * Issuing and verifying one-time codes. The policy lives in ../domain/otp and
 * is unit-tested without a database; this layer only persists and delivers.
 */

/**
 * Whether another code may be sent from this address, and at all.
 *
 * Counted from the codes themselves rather than from a separate table or from
 * process memory: Medilink runs more than one web container, and a counter in
 * memory resets on deploy and is bypassed by spreading requests across
 * instances. It runs before anything is created, so a refused request leaves
 * nothing behind — registration calls it before it makes a user row.
 *
 * The address is whatever the edge forwards. Where the platform does not
 * overwrite X-Forwarded-For, a caller can rotate it to dodge the per-address
 * limit, and the overall budget is what is left standing.
 */
export async function assertCanSendCode(input: { ipAddress?: string; now?: Date }): Promise<void> {
  const since = new Date((input.now ?? new Date()).getTime() - 3600 * 1000);

  const [fromThisAddress, overall] = await Promise.all([
    input.ipAddress
      ? prisma.otpCode.count({ where: { requestIp: input.ipAddress, createdAt: { gt: since } } })
      : Promise.resolve(null),
    prisma.otpCode.count({ where: { createdAt: { gt: since } } }),
  ]);

  const verdict = evaluateSendBudget({ fromThisAddress, overall });
  if (!verdict.ok) {
    logger.warn('one-time code budget exhausted', { reason: verdict.reason });
    throw AuthErrors.otpThrottled(verdict.retryAfterSeconds);
  }
}

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
}): Promise<{ expiresAt: Date; sendsRemainingThisHour: number; delivered: boolean }> {
  const now = input.now ?? new Date();
  const purpose = input.purpose;

  await assertCanSendCode({ ipAddress: input.ipAddress, now });

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
      data: { userId: input.userId, purpose, codeHash, expiresAt, requestIp: input.ipAddress },
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

  const attempt = await attemptSms({
    to: input.phone,
    body: otpMessageBody(code, input.purpose),
    transactional: true,
  });

  return {
    expiresAt,
    sendsRemainingThisHour: Math.max(0, OTP_MAX_SENDS_PER_HOUR - (recent.length + 1)),
    // The caller decides what to say. This used to be thrown away, and the API
    // answered "code sent" to somebody waiting for a text that was never sent.
    delivered: attempt.delivered,
  };
}

export interface VerifiedOtp {
  id: string;
}

/**
 * Verifies a submitted code without consuming it. Throws on any invalid
 * state: wrong, expired, exhausted, already used, or none outstanding.
 *
 * Every verification takes one of the code's five attempts, atomically and
 * before the guess is judged, so the limit holds under concurrent guessing and
 * a request abandoned mid-flight has still been counted. A wrong guess also
 * writes its own audit row, immediately, in its own transaction — which is also
 * what closes the gap table-level coverage matching would otherwise paper over:
 * without it, the counter write is only "covered" because some unrelated
 * auth.otp_issued row happens to land in the same test window.
 */
export async function verifyOtp(input: {
  userId: string;
  purpose: OtpPurposeKey;
  code: string;
  now?: Date;
}): Promise<VerifiedOtp> {
  const now = input.now ?? new Date();
  const purpose = input.purpose;

  const record = await prisma.otpCode.findFirst({
    where: { userId: input.userId, purpose, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });

  // The attempt is taken *before* the guess is judged, in one conditional
  // statement. The counter used to be read, judged and then incremented in a
  // separate step, so guesses arriving together all read the old count and all
  // were compared: the five-try limit could be exceeded by as many requests as
  // fit in one round trip. Here the database hands out at most five attempts
  // per code, and a request that does not get one is refused without its guess
  // being looked at — so the number of codes tried can never exceed the limit.
  // It also means a guess abandoned mid-flight has still been counted.
  if (record) {
    const taken = await prisma.otpCode.updateMany({
      where: { id: record.id, consumedAt: null, attempts: { lt: OTP_MAX_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });
    if (taken.count === 0) {
      logger.warn('otp verification failed', { userId: input.userId, reason: 'too_many_attempts' });
      throw AuthErrors.otpExhausted();
    }
  }

  const submittedHash = hashOtpCode(input.code, input.userId, input.purpose, env.SESSION_SECRET);
  // Judged against the row as read, which is the count *before* this attempt.
  const verdict = evaluateOtp(record, submittedHash, now);

  if (!verdict.ok) {
    if (record && verdict.reason === 'mismatch') {
      await prisma.$transaction(async (tx) => {
        await recordAudit(tx, {
          action: 'auth.otp_attempt_failed',
          entityType: 'identity.otp_codes',
          entityId: input.userId,
          actorId: input.userId,
          scopeType: 'SELF',
          scopeId: input.userId,
        });
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

  return { id: record.id };
}

/**
 * Marks a verified code consumed. Takes the caller's transaction so
 * consumption is atomic with the state change it authorizes — a crash
 * between the two must not leave a burned code with no completed action, or
 * a completed action whose code is still redeemable. No separate audit row
 * names this write: the state change recorded in the same transaction is
 * what the redemption was for, and a code is not a distinct auditable event
 * from the verification it enables.
 *
 * Conditional on consumedAt still being null: two concurrent submissions of
 * the same valid code must result in exactly one success.
 */
export async function consumeOtp(tx: Tx, verified: VerifiedOtp, now: Date = new Date()): Promise<void> {
  const consumed = await tx.otpCode.updateMany({
    where: { id: verified.id, consumedAt: null },
    data: { consumedAt: now },
  });

  if (consumed.count !== 1) throw AuthErrors.otpInvalid();
}
