import { prisma, type Tx } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { publishEvent } from '@/lib/outbox';
import { EVENTS } from '@/lib/events';
import { hashPassword, passwordProblems } from '@/lib/password';
import { maskPhone, normalizeNigerianPhone } from '@/lib/phone';
import { consumeOtp, issueOtp } from './otp-service';
import { AuthErrors } from '../domain/errors';

/**
 * Registration in three steps: claim a phone number, prove it with a code,
 * then set a password. Splitting it this way means an abandoned signup leaves
 * a pending account rather than a verified one, and an attacker cannot set a
 * password on a number they do not control.
 */

export interface StartRegistrationInput {
  phone: string;
  fullName: string;
  email?: string;
  ipAddress?: string;
  now?: Date;
}

export interface StartRegistrationResult {
  userId: string;
  phone: string;
  expiresAt: Date;
  /** True when the number was already registered and no new account was made. */
  existing: boolean;
}

/**
 * Deliberately does not reveal whether the number was already registered: the
 * response is identical either way, because a differing response turns this
 * endpoint into a directory of who works through Medilink.
 */
export async function startRegistration(
  input: StartRegistrationInput,
): Promise<StartRegistrationResult> {
  const now = input.now ?? new Date();
  const phone = normalizeNigerianPhone(input.phone);
  const fullName = input.fullName.trim().replace(/\s+/g, ' ');
  const email = input.email?.trim().toLowerCase() || undefined;

  const existing = await prisma.user.findUnique({
    where: { phone },
    select: { id: true, phoneVerifiedAt: true, passwordHash: true, status: true, deletedAt: true },
  });

  if (existing) {
    // A fully registered account gets a code anyway, so the caller learns
    // nothing, but the code is a login code rather than a verification one.
    const purpose = existing.phoneVerifiedAt && existing.passwordHash ? 'LOGIN' : 'PHONE_VERIFICATION';
    const { expiresAt } = await issueOtp({
      userId: existing.id,
      phone,
      purpose,
      ipAddress: input.ipAddress,
      now,
    });
    return { userId: existing.id, phone, expiresAt, existing: true };
  }

  const user = await prisma.$transaction(async (tx: Tx) => {
    const created = await tx.user.create({
      data: { phone, fullName, email, status: 'PENDING_VERIFICATION' },
    });

    await recordAudit(tx, {
      action: 'auth.registration_started',
      entityType: 'identity.users',
      entityId: created.id,
      actorId: created.id,
      actorType: 'system',
      scopeType: 'SELF',
      scopeId: created.id,
      after: { phone: maskPhone(phone), fullName, email },
      ipAddress: input.ipAddress,
    });

    return created;
  });

  const { expiresAt } = await issueOtp({
    userId: user.id,
    phone,
    purpose: 'PHONE_VERIFICATION',
    ipAddress: input.ipAddress,
    now,
  });

  return { userId: user.id, phone, expiresAt, existing: false };
}

/** Step two: the code proves control of the number. */
export async function verifyRegistrationPhone(input: {
  phone: string;
  code: string;
  ipAddress?: string;
  now?: Date;
}): Promise<{ userId: string; passwordSet: boolean }> {
  const now = input.now ?? new Date();
  const phone = normalizeNigerianPhone(input.phone);

  const user = await prisma.user.findUnique({
    where: { phone },
    select: { id: true, passwordHash: true, deletedAt: true, status: true },
  });

  // Same error as a wrong code: an unknown number must not be distinguishable.
  if (!user || user.deletedAt) throw AuthErrors.otpInvalid();
  if (user.status === 'SUSPENDED' || user.status === 'DEACTIVATED') {
    throw AuthErrors.accountNotUsable();
  }

  await consumeOtp({ userId: user.id, purpose: 'PHONE_VERIFICATION', code: input.code, now });

  await prisma.$transaction(async (tx: Tx) => {
    await tx.user.update({ where: { id: user.id }, data: { phoneVerifiedAt: now } });

    await recordAudit(tx, {
      action: 'auth.phone_verified',
      entityType: 'identity.users',
      entityId: user.id,
      actorId: user.id,
      scopeType: 'SELF',
      scopeId: user.id,
      ipAddress: input.ipAddress,
    });
  });

  return { userId: user.id, passwordSet: user.passwordHash !== null };
}

/**
 * Step three. Requires a verified number and refuses to overwrite an existing
 * password — changing one goes through the recovery path, which revokes
 * sessions.
 */
export async function setInitialPassword(input: {
  phone: string;
  password: string;
  ipAddress?: string;
  userAgent?: string;
  now?: Date;
}): Promise<{ userId: string }> {
  const phone = normalizeNigerianPhone(input.phone);

  const user = await prisma.user.findUnique({
    where: { phone },
    select: {
      id: true,
      fullName: true,
      email: true,
      passwordHash: true,
      phoneVerifiedAt: true,
      status: true,
      deletedAt: true,
    },
  });

  if (!user || user.deletedAt) throw AuthErrors.phoneNotVerified();
  if (!user.phoneVerifiedAt) throw AuthErrors.phoneNotVerified();
  if (user.passwordHash) throw AuthErrors.passwordAlreadySet();
  if (user.status === 'SUSPENDED' || user.status === 'DEACTIVATED') {
    throw AuthErrors.accountNotUsable();
  }

  const problems = passwordProblems(input.password, {
    phone,
    fullName: user.fullName,
    email: user.email,
  });
  if (problems.length > 0) throw AuthErrors.passwordRejected(problems);

  const passwordHash = await hashPassword(input.password);

  await prisma.$transaction(async (tx: Tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash, status: 'UNDER_REVIEW' },
    });

    await recordAudit(tx, {
      action: 'auth.password_set',
      entityType: 'identity.users',
      entityId: user.id,
      actorId: user.id,
      scopeType: 'SELF',
      scopeId: user.id,
      after: { status: 'UNDER_REVIEW' },
      ipAddress: input.ipAddress,
    });

    // Credentialling and role assignment react to this; the account is not
    // usable for shifts until Stage 5 verification completes.
    await publishEvent(tx, {
      eventType: EVENTS.PractitionerRegistered,
      aggregateType: 'identity.users',
      aggregateId: user.id,
      payload: { userId: user.id, phone: maskPhone(phone) },
    });
  });

  return { userId: user.id };
}
