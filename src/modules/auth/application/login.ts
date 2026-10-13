import { randomBytes } from 'node:crypto';
import { prisma } from '@/lib/db';
import { hashPassword, verifyPassword } from '@/lib/password';
import { normalizeNigerianPhone, PhoneFormatError } from '@/lib/phone';
import { logger } from '@/lib/logger';
import { lockoutState, LOGIN_FAILURE_WINDOW_SECONDS } from '../domain/lockout';
import { AuthErrors } from '../domain/errors';
import { issueSession, type IssuedSession } from './session-service';

/**
 * Password login. Every outcome is written to identity.login_attempts, which
 * is both the throttle's input and the evidence a compliance officer needs
 * when an account is disputed.
 */
export async function login(input: {
  phone: string;
  password: string;
  ipAddress?: string;
  userAgent?: string;
  now?: Date;
}): Promise<IssuedSession> {
  const now = input.now ?? new Date();

  // Throttle on the raw identifier too, so an unparseable value cannot be
  // used to hammer the endpoint outside the lockout window.
  let phone: string;
  try {
    phone = normalizeNigerianPhone(input.phone);
  } catch (error) {
    if (error instanceof PhoneFormatError) throw AuthErrors.invalidCredentials();
    throw error;
  }

  const attempts = await prisma.loginAttempt.findMany({
    where: {
      identifier: phone,
      createdAt: { gt: new Date(now.getTime() - LOGIN_FAILURE_WINDOW_SECONDS * 1000) },
    },
    select: { succeeded: true, createdAt: true, reason: true },
  });

  const lock = lockoutState(attempts, now);
  if (lock.locked) {
    await recordAttempt({ phone, succeeded: false, reason: 'locked_out', ipAddress: input.ipAddress, at: now });
    throw AuthErrors.accountLocked(lock.retryAfterSeconds);
  }

  const user = await prisma.user.findUnique({
    where: { phone },
    select: {
      id: true,
      passwordHash: true,
      phoneVerifiedAt: true,
      status: true,
      deletedAt: true,
    },
  });

  // Verify against a dummy hash when the account is absent, so a missing
  // account and a wrong password take comparable time. Without this, response
  // timing alone enumerates which numbers are registered.
  const encoded = user?.passwordHash ?? (await dummyHash());
  const passwordOk = await verifyPassword(encoded, input.password);

  if (!user || user.deletedAt || !user.passwordHash || !passwordOk) {
    await recordAttempt({
      phone,
      userId: user?.id,
      succeeded: false,
      reason: !user ? 'unknown_identifier' : !user.passwordHash ? 'no_password_set' : 'bad_password',
      ipAddress: input.ipAddress,
      at: now,
    });
    throw AuthErrors.invalidCredentials();
  }

  if (!user.phoneVerifiedAt) {
    await recordAttempt({ phone, userId: user.id, succeeded: false, reason: 'phone_unverified', ipAddress: input.ipAddress, at: now });
    throw AuthErrors.phoneNotVerified();
  }

  if (user.status === 'SUSPENDED' || user.status === 'DEACTIVATED') {
    await recordAttempt({ phone, userId: user.id, succeeded: false, reason: `status_${user.status.toLowerCase()}`, ipAddress: input.ipAddress, at: now });
    throw AuthErrors.accountNotUsable();
  }

  await recordAttempt({ phone, userId: user.id, succeeded: true, ipAddress: input.ipAddress, at: now });

  logger.info('login succeeded', { userId: user.id });

  return issueSession({
    userId: user.id,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
    now,
  });
}

/**
 * A valid Argon2id hash of a value no one holds, at the same cost parameters
 * as a real one. Computed on first use rather than embedded as a literal, so
 * it cannot drift from the live parameters and is never a hash anyone can
 * precompute. Cached, so only the first unknown-number login pays for it.
 */
let dummyHashPromise: Promise<string> | null = null;

function dummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword(randomBytes(32).toString('hex'));
  return dummyHashPromise;
}

async function recordAttempt(input: {
  phone: string;
  userId?: string;
  succeeded: boolean;
  reason?: string;
  ipAddress?: string;
  /** The clock the throttle is judging by, so the two cannot disagree about when this happened. */
  at: Date;
}): Promise<void> {
  await prisma.loginAttempt.create({
    data: {
      createdAt: input.at,
      identifier: input.phone,
      userId: input.userId,
      succeeded: input.succeeded,
      reason: input.reason,
      ipAddress: input.ipAddress,
    },
  });
}
