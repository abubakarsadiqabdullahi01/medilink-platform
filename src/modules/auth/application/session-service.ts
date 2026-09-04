import { cookies } from 'next/headers';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { recordAudit } from '@/lib/audit';
import {
  generateSessionToken,
  hashSessionToken,
  isSessionUsable,
  isStepUpFresh,
  sessionCookieOptions,
  sessionExpiry,
  SESSION_COOKIE_NAME,
} from '../domain/session';
import { AuthErrors } from '../domain/errors';

const isProductionLike = env.APP_ENV !== 'local';

export interface IssuedSession {
  token: string;
  sessionId: string;
  expiresAt: Date;
}

/** Creates the session row and sets the cookie. The token is never stored. */
export async function issueSession(input: {
  userId: string;
  ipAddress?: string;
  userAgent?: string;
  stepUp?: boolean;
  now?: Date;
}): Promise<IssuedSession> {
  const now = input.now ?? new Date();
  const { token, tokenHash } = generateSessionToken();
  const expiresAt = sessionExpiry(now);

  const session = await prisma.$transaction(async (tx) => {
    const created = await tx.session.create({
      data: {
        userId: input.userId,
        tokenHash,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent?.slice(0, 500),
        expiresAt,
        stepUpAt: input.stepUp ? now : null,
      },
    });

    await tx.user.update({ where: { id: input.userId }, data: { lastLoginAt: now } });

    await recordAudit(tx, {
      action: 'auth.session_issued',
      entityType: 'identity.sessions',
      entityId: created.id,
      actorId: input.userId,
      scopeType: 'SELF',
      scopeId: input.userId,
      ipAddress: input.ipAddress,
    });

    return created;
  });

  cookies().set({ ...sessionCookieOptions(expiresAt, isProductionLike), value: token });

  return { token, sessionId: session.id, expiresAt };
}

export interface CurrentSession {
  sessionId: string;
  userId: string;
  stepUpFresh: boolean;
}

/**
 * Resolves the caller from the session cookie. Returns null rather than
 * throwing, so a public route can call it to personalise a response.
 */
export async function currentSession(now: Date = new Date()): Promise<CurrentSession | null> {
  const token = cookies().get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    include: { user: { select: { id: true, status: true, deletedAt: true } } },
  });

  if (!isSessionUsable(session, now)) return null;
  if (!session) return null;
  if (session.user.deletedAt) return null;
  if (session.user.status === 'SUSPENDED' || session.user.status === 'DEACTIVATED') return null;

  return {
    sessionId: session.id,
    userId: session.userId,
    stepUpFresh: isStepUpFresh(session, now),
  };
}

/** Throws AuthError when there is no usable session. */
export async function requireSession(now: Date = new Date()): Promise<CurrentSession> {
  const session = await currentSession(now);
  if (!session) throw AuthErrors.notAuthenticated();
  return session;
}

export async function revokeSession(input: {
  sessionId: string;
  actorId: string;
  reason?: string;
  now?: Date;
}): Promise<void> {
  const now = input.now ?? new Date();

  await prisma.$transaction(async (tx) => {
    await tx.session.updateMany({
      where: { id: input.sessionId, revokedAt: null },
      data: { revokedAt: now },
    });

    await recordAudit(tx, {
      action: 'auth.session_revoked',
      entityType: 'identity.sessions',
      entityId: input.sessionId,
      actorId: input.actorId,
      scopeType: 'SELF',
      scopeId: input.actorId,
      reason: input.reason,
    });
  });

  cookies().delete(SESSION_COOKIE_NAME);
}

/**
 * Revokes every session for a user. Called on password change and by the
 * compliance path that suspends an account, where existing sessions must stop
 * immediately rather than at their natural expiry.
 */
export async function revokeAllSessions(input: {
  userId: string;
  actorId: string;
  reason: string;
  now?: Date;
}): Promise<number> {
  const now = input.now ?? new Date();

  return prisma.$transaction(async (tx) => {
    const result = await tx.session.updateMany({
      where: { userId: input.userId, revokedAt: null },
      data: { revokedAt: now },
    });

    await recordAudit(tx, {
      action: 'auth.all_sessions_revoked',
      entityType: 'identity.sessions',
      entityId: input.userId,
      actorId: input.actorId,
      scopeType: 'SELF',
      scopeId: input.userId,
      reason: input.reason,
      after: { revokedCount: result.count },
    });

    return result.count;
  });
}
