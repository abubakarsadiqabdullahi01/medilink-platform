import { prisma, type Tx } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { env } from '@/lib/env';
import { publishEvent } from '@/lib/outbox';
import { EVENTS } from '@/lib/events';
import { hashPassword, passwordProblems } from '@/lib/password';
import { maskPhone, normalizeNigerianPhone } from '@/lib/phone';
import { assertCanSendCode, consumeOtp, issueOtp, verifyOtp } from './otp-service';
import { AuthErrors } from '../domain/errors';
import { issueSetupToken, verifySetupToken } from '../domain/setup-token';
import { grantConsentsInTx } from '@/modules/audit-compliance/application/consent';
import { CONSENT_AT_REGISTRATION } from '@/modules/audit-compliance/domain/consent';

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
  // Before anything is written: registering makes a user row, and a refused
  // request should leave nothing behind however many arrive.
  await assertCanSendCode({ ipAddress: input.ipAddress, now });
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
      // Not the name or the address: an audit row is kept for good and a person's
      // right to erasure cannot reach it.
      after: { phone: maskPhone(phone), hasEmail: Boolean(email) },
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
}): Promise<{ userId: string; passwordSet: boolean; setupToken: string | null }> {
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

  const verified = await verifyOtp({ userId: user.id, purpose: 'PHONE_VERIFICATION', code: input.code, now });

  await prisma.$transaction(async (tx: Tx) => {
    // Atomic with the update below: a crash here must not leave the code
    // burned with the phone still unverified.
    await consumeOtp(tx, verified, now);

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

  // Handed back so the next step can prove it follows this one. An account
  // that already has a password has no next step, so there is nothing to bind.
  const setupToken =
    user.passwordHash === null ? issueSetupToken(user.id, now, env.SESSION_SECRET) : null;

  return { userId: user.id, passwordSet: user.passwordHash !== null, setupToken };
}

/**
 * Step three. Requires a verified number and refuses to overwrite an existing
 * password — changing one goes through the recovery path, which revokes
 * sessions.
 */
export async function setInitialPassword(input: {
  phone: string;
  password: string;
  /** From verifying the phone. Without it, knowing a verified number would be enough. */
  setupToken: string;
  /** Defaults to practitioner; see setPasswordSchema for what staff means. */
  accountType?: 'practitioner' | 'staff';
  /** The practitioner ticked the box agreeing to be shown to facilities. */
  consentToSharing?: boolean;
  ipAddress?: string;
  userAgent?: string;
  now?: Date;
}): Promise<{ userId: string; accountStatus: 'UNDER_REVIEW' | 'ACTIVE' }> {
  const now = input.now ?? new Date();
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
  // Whoever verified the code is who sets the password. Without this, a number
  // that verified and never set one — an abandoned sign-up stays that way for
  // ever — could be claimed by anybody who knew it, who would also choose what
  // the account was.
  if (!verifySetupToken(input.setupToken, user.id, now, env.SESSION_SECRET)) {
    throw AuthErrors.setupTokenInvalid();
  }

  const problems = passwordProblems(input.password, {
    phone,
    fullName: user.fullName,
    email: user.email,
  });
  if (problems.length > 0) throw AuthErrors.passwordRejected(problems);

  const passwordHash = await hashPassword(input.password);
  const staff = input.accountType === 'staff';
  // UNDER_REVIEW is the practitioner's wait for verification, and the
  // activation sweep is what ends it. A staff account has nothing to verify —
  // what it may do comes entirely from the grants somebody gives it — so it
  // would sit in review for ever.
  const accountStatus = staff ? 'ACTIVE' : 'UNDER_REVIEW';

  await prisma.$transaction(async (tx: Tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash, status: accountStatus },
    });

    await recordAudit(tx, {
      action: 'auth.password_set',
      entityType: 'identity.users',
      entityId: user.id,
      actorId: user.id,
      scopeType: 'SELF',
      scopeId: user.id,
      after: { status: accountStatus, accountType: staff ? 'staff' : 'practitioner' },
      ipAddress: input.ipAddress,
    });

    // Credentialling and role assignment react to this; the account is not
    // usable for shifts until Stage 5 verification completes. Not for staff:
    // a hospital owner signing up used to be granted the practitioner role
    // and screened against the quack list like a locum.
    // With the account, not after it: a practitioner who is matched on day one
    // has to have agreed to be shown before that, and the page that lets them
    // withdraw has to have something true to say.
    if (!staff && input.consentToSharing) {
      await grantConsentsInTx(tx, {
        userId: user.id,
        purposes: CONSENT_AT_REGISTRATION,
        actorId: user.id,
        note: 'Given at registration',
      });
    }

    if (!staff) {
      await publishEvent(tx, {
        eventType: EVENTS.PractitionerRegistered,
        aggregateType: 'identity.users',
        aggregateId: user.id,
        payload: { userId: user.id, phone: maskPhone(phone) },
      });
    }
  });

  return { userId: user.id, accountStatus };
}
