import { prisma, type Tx } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { hashPassword, passwordProblems } from '@/lib/password';
import { normalizeNigerianPhone } from '@/lib/phone';
import { logger } from '@/lib/logger';
import { consumeOtp, issueOtp, verifyOtp } from './otp-service';
import { revokeAllSessions } from './session-service';
import { AuthErrors } from '../domain/errors';

/**
 * Account recovery. The phone number is the only recovery channel, because it
 * is the identifier we have actually verified — email is optional and often
 * absent for practitioners.
 */

/**
 * Always reports success. Telling a caller that a number is not registered
 * turns password reset into an account-enumeration tool, and the SMS is the
 * only signal a real owner needs.
 */
export async function requestPasswordReset(input: {
  phone: string;
  ipAddress?: string;
  now?: Date;
}): Promise<void> {
  const now = input.now ?? new Date();

  let phone: string;
  try {
    phone = normalizeNigerianPhone(input.phone);
  } catch {
    return;
  }

  const user = await prisma.user.findUnique({
    where: { phone },
    select: { id: true, status: true, deletedAt: true, phoneVerifiedAt: true },
  });

  if (!user || user.deletedAt || !user.phoneVerifiedAt) {
    logger.info('password reset requested for unusable account', { phone: 'redacted' });
    return;
  }
  if (user.status === 'SUSPENDED' || user.status === 'DEACTIVATED') return;

  try {
    await issueOtp({
      userId: user.id,
      phone,
      purpose: 'PASSWORD_RESET',
      ipAddress: input.ipAddress,
      now,
    });
  } catch (error) {
    // Throttling must not leak either: a 429 here would confirm the account.
    logger.warn('password reset throttled', { userId: user.id, error: String(error) });
  }
}

/**
 * Completes a reset. Every existing session is revoked: if the reset was
 * triggered because a phone was stolen, leaving the thief's session alive
 * defeats the purpose.
 */
export async function confirmPasswordReset(input: {
  phone: string;
  code: string;
  password: string;
  ipAddress?: string;
  now?: Date;
}): Promise<{ userId: string; revokedSessions: number }> {
  const now = input.now ?? new Date();
  const phone = normalizeNigerianPhone(input.phone);

  const user = await prisma.user.findUnique({
    where: { phone },
    select: { id: true, fullName: true, email: true, status: true, deletedAt: true },
  });

  if (!user || user.deletedAt) throw AuthErrors.otpInvalid();
  if (user.status === 'SUSPENDED' || user.status === 'DEACTIVATED') {
    throw AuthErrors.accountNotUsable();
  }

  const problems = passwordProblems(input.password, {
    phone,
    fullName: user.fullName,
    email: user.email,
  });
  if (problems.length > 0) throw AuthErrors.passwordRejected(problems);

  const verified = await verifyOtp({ userId: user.id, purpose: 'PASSWORD_RESET', code: input.code, now });

  const passwordHash = await hashPassword(input.password);

  await prisma.$transaction(async (tx: Tx) => {
    // Atomic with the update below: a crash here must not leave the code
    // burned with the password unchanged.
    await consumeOtp(tx, verified, now);

    await tx.user.update({ where: { id: user.id }, data: { passwordHash } });

    await recordAudit(tx, {
      action: 'auth.password_reset',
      entityType: 'identity.users',
      entityId: user.id,
      actorId: user.id,
      scopeType: 'SELF',
      scopeId: user.id,
      reason: 'Password reset via one-time code',
      ipAddress: input.ipAddress,
    });
  });

  const revokedSessions = await revokeAllSessions({
    userId: user.id,
    actorId: user.id,
    reason: 'Password reset',
    now,
  });

  return { userId: user.id, revokedSessions };
}
