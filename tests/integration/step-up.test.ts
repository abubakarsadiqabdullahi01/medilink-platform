import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', async () => {
  const { cookieJar } = await import('./support/cookie-jar');
  return { cookies: () => cookieJar };
});

import { z } from 'zod';
import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/password';
import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { STEP_UP_WINDOW_SECONDS } from '@/modules/auth/domain/session';
import { issueSession, stepUpSession } from '@/modules/auth/application/session-service';
import { clearCookies } from './support/cookie-jar';
import { createUser, grant } from './support/fixtures';

/**
 * Step 4.8 — step-up authentication *enforced*.
 *
 * `isStepUpFresh` has existed since Stage 4.2 and nothing called it: the
 * freshness was computed, reported on the session, and never once acted on.
 * These assert that it now decides something.
 *
 * The enforcement lives in `handleGuardedRequest`, keyed on the permission
 * rather than the route, so it is tested there — through a handler declared
 * here rather than a real endpoint, because the two permissions that require
 * it (`payout.account.change`, `role.grant`) belong to work that is either
 * blocked on Stage 3 or not yet written. A test tied to a route that does not
 * exist would be a test of nothing.
 */

const PASSWORD = 'correct horse battery staple';
const SCOPE = '00000000-0000-4000-8000-00000000f001';

/** A route that names a step-up permission. */
function guarded(permission: 'role.grant' | 'facility.read') {
  return (request: Request) =>
    handleGuardedRequest(request, {
      source: 'query',
      schema: z.object({}),
      permission,
      scope: () => ({ type: 'PLATFORM' }),
      action: async () => ({ reached: true }),
    });
}

async function call(permission: 'role.grant' | 'facility.read') {
  const response = await guarded(permission)(new Request('http://localhost/x'));
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function signedInHolder(options: { stepUp?: boolean } = {}) {
  const user = await createUser();
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(PASSWORD) },
  });
  await grant({
    userId: user.id,
    roleKey: 'super_administrator',
    permissions: ['role.grant', 'facility.read'],
    scopeType: 'PLATFORM',
    scopeId: SCOPE,
  });
  const session = await issueSession({ userId: user.id, stepUp: options.stepUp });
  return { user, session };
}

beforeEach(() => {
  clearCookies();
});

describe('a permission that requires step-up', () => {
  it('is refused on an ordinary session, even though the caller holds it', async () => {
    await signedInHolder();

    const { status, body } = await call('role.grant');

    expect(status).toBe(401);
    expect(body).toMatchObject({ error: { code: 'step_up_required' } });
  });

  it('is allowed once the password has been re-entered', async () => {
    const { user, session } = await signedInHolder();

    await stepUpSession({ sessionId: session.sessionId, userId: user.id, password: PASSWORD });

    const { status, body } = await call('role.grant');
    expect(status).toBe(200);
    expect(body).toMatchObject({ reached: true });
  });

  it('is refused again once the window has passed', async () => {
    const { user, session } = await signedInHolder();
    await stepUpSession({ sessionId: session.sessionId, userId: user.id, password: PASSWORD });

    // Five minutes, and it is a window rather than a flag for the reason it
    // exists: an unattended laptop is unattended a few minutes later too.
    await prisma.session.update({
      where: { id: session.sessionId },
      data: {
        stepUpAt: new Date(Date.now() - (STEP_UP_WINDOW_SECONDS + 60) * 1000),
      },
    });

    const { status, body } = await call('role.grant');
    expect(status).toBe(401);
    expect(body).toMatchObject({ error: { code: 'step_up_required' } });
  });
});

describe('a permission that does not', () => {
  it('is allowed on an ordinary session', async () => {
    await signedInHolder();

    // A prompt on everything is a prompt nobody reads.
    const { status } = await call('facility.read');
    expect(status).toBe(200);
  });
});

describe('what the refusal gives away', () => {
  it('answers a caller who does not hold the permission the same way', async () => {
    // The order matters. If step-up were checked after the permission, a
    // step_up_required response would tell the caller they hold it — exactly
    // what the 403 refuses to disclose. Everybody asking gets the same
    // answer whatever they hold.
    const stranger = await createUser();
    await prisma.user.update({
      where: { id: stranger.id },
      data: { passwordHash: await hashPassword(PASSWORD) },
    });
    await issueSession({ userId: stranger.id });

    const { status, body } = await call('role.grant');
    expect(status).toBe(401);
    expect(body).toMatchObject({ error: { code: 'step_up_required' } });
  });

  it('still refuses the permission after a stranger steps up', async () => {
    const stranger = await createUser();
    await prisma.user.update({
      where: { id: stranger.id },
      data: { passwordHash: await hashPassword(PASSWORD) },
    });
    const session = await issueSession({ userId: stranger.id });
    await stepUpSession({ sessionId: session.sessionId, userId: stranger.id, password: PASSWORD });

    // Step-up proves who you are. It grants nothing.
    const { status, body } = await call('role.grant');
    expect(status).toBe(403);
    expect(body).not.toMatchObject({ error: { code: 'step_up_required' } });
  });
});

describe('stepping up', () => {
  it('refuses a wrong password and leaves the session as it was', async () => {
    const { user, session } = await signedInHolder();

    await expect(
      stepUpSession({ sessionId: session.sessionId, userId: user.id, password: 'not it' }),
    ).rejects.toMatchObject({ code: 'invalid_credentials' });

    const row = await prisma.session.findUniqueOrThrow({ where: { id: session.sessionId } });
    expect(row.stepUpAt).toBeNull();
  });

  it('counts a failure where every other password failure is counted', async () => {
    const { user, session } = await signedInHolder();

    await expect(
      stepUpSession({ sessionId: session.sessionId, userId: user.id, password: 'not it' }),
    ).rejects.toThrow();

    // A step-up prompt with no throttle would be a softer door into the same
    // house, so failures share the login lockout rather than having their own.
    const attempt = await prisma.loginAttempt.findFirst({
      where: { userId: user.id, succeeded: false },
      orderBy: { createdAt: 'desc' },
    });
    expect(attempt?.reason).toBe('step_up_bad_password');
    expect(attempt?.identifier).toBe(
      (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).phone,
    );
  });

  it('locks out after enough failures, on the shared counter', async () => {
    const { user, session } = await signedInHolder();
    const { LOGIN_MAX_FAILURES } = await import('@/modules/auth/domain/lockout');

    for (let i = 0; i < LOGIN_MAX_FAILURES; i += 1) {
      await expect(
        stepUpSession({ sessionId: session.sessionId, userId: user.id, password: 'not it' }),
      ).rejects.toThrow();
    }

    // The right password no longer helps, which is the point.
    await expect(
      stepUpSession({ sessionId: session.sessionId, userId: user.id, password: PASSWORD }),
    ).rejects.toMatchObject({ code: 'account_locked' });
  });

  it('writes an audit row naming the session it freshened', async () => {
    const { user, session } = await signedInHolder();
    await stepUpSession({ sessionId: session.sessionId, userId: user.id, password: PASSWORD });

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'auth.step_up', entityId: session.sessionId },
    });
    expect(audit?.actorId).toBe(user.id);
  });

  it('freshens only the session it was asked about', async () => {
    const { user, session } = await signedInHolder();
    const other = await issueSession({ userId: user.id });

    await stepUpSession({ sessionId: session.sessionId, userId: user.id, password: PASSWORD });

    // A laptop left open in one place should not step up a phone somewhere
    // else. Freshness belongs to the session, not the account.
    const otherRow = await prisma.session.findUniqueOrThrow({ where: { id: other.sessionId } });
    expect(otherRow.stepUpAt).toBeNull();
  });
});
