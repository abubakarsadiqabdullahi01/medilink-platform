import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('next/headers', async () => {
  const { cookieJar } = await import('./support/cookie-jar');
  return { cookies: () => cookieJar };
});

import { prisma } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { publishEvent } from '@/lib/outbox';
import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { handleSessionRequest } from '@/lib/http/session-handler';
import { handleAuthRequest } from '@/modules/auth/presentation/handler';
import { issueSession } from '@/modules/auth/application/session-service';
import { processEvent, type ClaimedEvent } from '@/worker/processor';
import { runJob } from '@/worker/scheduler';
import { POST as submitSuggestion } from '@/app/api/v1/suggestions/route';
import { POST as logout } from '@/app/api/v1/auth/logout/route';
import { clearCookies } from './support/cookie-jar';
import { createUser, grant } from './support/fixtures';

/**
 * AUD-13 — one business action can be followed from the request that began it, through the audit
 * rows and events it wrote, to what the worker did with those events.
 *
 * The correlation id was made for every request and logged, and then never saved: `recordAudit`
 * and `publishEvent` accepted one and no caller passed one, so a row in the trail could not be
 * tied to the request, the event or the later worker run that belonged with it. It is now ambient:
 * the wrappers, the event processor and the job runner each set it, and the two writers take it
 * from there, so no one of the hundred call sites has to remember.
 */

beforeEach(() => {
  clearCookies();
});

const ENTITY = '00000000-0000-4000-8000-0000000000aa';

/** An audited write and a published event, in one transaction, as most acts are. */
async function anAct(action = 'user.suspended') {
  await prisma.$transaction(async (tx) => {
    await recordAudit(tx, { action, entityType: 'identity.users', entityId: ENTITY, actorId: ENTITY });
    await publishEvent(tx, {
      eventType: 'test.event',
      aggregateType: 'identity.users',
      aggregateId: ENTITY,
      payload: { id: ENTITY },
    });
  });
}

const request = (headers: Record<string, string> = {}) =>
  new Request('http://localhost/x', { method: 'POST', headers, body: '{}' });

describe('a request', () => {
  it('stamps what it writes with the id the caller sent, and says which request it was', async () => {
    const user = await createUser();
    await issueSession({ userId: user.id });

    const response = await handleSessionRequest(request({ 'x-correlation-id': 'trace-abc-123' }), async () => {
      await anAct();
      return {};
    });

    expect(response.headers.get('x-correlation-id')).toBe('trace-abc-123');
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'user.suspended' } });
    expect(audit.correlationId).toBe('trace-abc-123');
    expect(audit.requestId).toBe(response.headers.get('x-request-id'));
    const event = await prisma.outboxEvent.findFirstOrThrow({ where: { eventType: 'test.event' } });
    expect(event.correlationId).toBe('trace-abc-123');
  });

  it('makes one when the caller sent none, and the response, the row and the event all agree on it', async () => {
    const user = await createUser();
    await issueSession({ userId: user.id });

    const response = await handleSessionRequest(request(), async () => {
      await anAct();
      return {};
    });

    const id = response.headers.get('x-correlation-id');
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect((await prisma.auditLog.findFirstOrThrow({ where: { action: 'user.suspended' } })).correlationId).toBe(id);
    expect((await prisma.outboxEvent.findFirstOrThrow({ where: { eventType: 'test.event' } })).correlationId).toBe(id);
  });

  it('does the same through the guarded wrapper and the sign-in wrapper, not only the session one', async () => {
    const user = await createUser();
    await grant({ userId: user.id, roleKey: 'tracer', permissions: ['facility.read'], scopeType: 'PLATFORM' });
    await issueSession({ userId: user.id });

    await handleGuardedRequest(request({ 'x-correlation-id': 'trace-guarded' }), {
      source: 'body',
      schema: z.object({}),
      permission: 'facility.read',
      scope: () => ({ type: 'PLATFORM' }),
      action: async () => {
        await anAct('role.granted');
        return {};
      },
    });
    await handleAuthRequest(request({ 'x-correlation-id': 'trace-auth' }), z.object({}), async () => {
      await anAct('auth.otp_issued');
      return {};
    });

    expect((await prisma.auditLog.findFirstOrThrow({ where: { action: 'role.granted' } })).correlationId).toBe('trace-guarded');
    expect((await prisma.auditLog.findFirstOrThrow({ where: { action: 'auth.otp_issued' } })).correlationId).toBe('trace-auth');
  });

  it('reaches the audit row of a real route, with nobody in the route having mentioned it', async () => {
    const user = await createUser();
    await grant({
      userId: user.id,
      roleKey: 'suggester',
      permissions: ['suggestion.submit'],
      scopeType: 'SELF',
      scopeId: user.id,
    });
    await issueSession({ userId: user.id });

    const response = await submitSuggestion(
      new Request('http://localhost/api/v1/suggestions', {
        method: 'POST',
        headers: { 'x-correlation-id': 'trace-real-route', 'content-type': 'application/json' },
        body: JSON.stringify({ area: 'OTHER', body: 'Please add a night-shift filter to the roster.' }),
      }),
    );

    expect(response.status).toBe(201);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'suggestion.submitted' } });
    expect(audit.correlationId).toBe('trace-real-route');
  });

  it('reaches the row of a route that is written by hand, as sign-out is', async () => {
    const user = await createUser();
    await issueSession({ userId: user.id });

    const response = await logout(
      new Request('http://localhost/api/v1/auth/logout', {
        method: 'POST',
        headers: { 'x-correlation-id': 'trace-sign-out' },
      }),
    );

    expect(response.status).toBe(200);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'auth.session_revoked' } });
    expect(audit.correlationId).toBe('trace-sign-out');
  });

  it('does not let a caller write what they like into the trail through the header', async () => {
    const user = await createUser();
    await issueSession({ userId: user.id });

    await handleSessionRequest(request({ 'x-correlation-id': 'jane.doe@example.com' }), async () => {
      await anAct();
      return {};
    });

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'user.suspended' } });
    expect(audit.correlationId).not.toContain('jane');
    expect(audit.correlationId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('does not carry into the next request: two requests are two actions', async () => {
    const user = await createUser();
    await issueSession({ userId: user.id });

    await handleSessionRequest(request({ 'x-correlation-id': 'first-action' }), async () => {
      await anAct('user.suspended');
      return {};
    });
    await handleSessionRequest(request(), async () => {
      await anAct('user.reinstated');
      return {};
    });

    const first = await prisma.auditLog.findFirstOrThrow({ where: { action: 'user.suspended' } });
    const second = await prisma.auditLog.findFirstOrThrow({ where: { action: 'user.reinstated' } });
    expect(first.correlationId).toBe('first-action');
    expect(second.correlationId).not.toBe('first-action');
    expect(second.correlationId).toBeTruthy();
  });
});

describe('the worker', () => {
  async function claimed(): Promise<ClaimedEvent> {
    const row = await prisma.outboxEvent.findFirstOrThrow({ where: { eventType: 'test.event' } });
    return {
      id: row.id,
      event_type: row.eventType,
      payload: row.payload,
      attempts: 1,
      correlation_id: row.correlationId,
    };
  }

  /** What a handler does: writes a row and publishes a follow-up. */
  const handlers = {
    'test.event': async () => {
      await prisma.$transaction(async (tx) => {
        await recordAudit(tx, { action: 'assignment.completed', entityType: 'matching.assignments', entityId: ENTITY });
        await publishEvent(tx, {
          eventType: 'test.followup',
          aggregateType: 'matching.assignments',
          aggregateId: ENTITY,
          payload: {},
        });
      });
    },
  };

  it('writes what it does for an event under the same id as the request that published it', async () => {
    const user = await createUser();
    await issueSession({ userId: user.id });
    await handleSessionRequest(request({ 'x-correlation-id': 'trace-end-to-end' }), async () => {
      await anAct();
      return {};
    });

    await processEvent(await claimed(), handlers);

    expect((await prisma.auditLog.findFirstOrThrow({ where: { action: 'assignment.completed' } })).correlationId).toBe(
      'trace-end-to-end',
    );
    expect((await prisma.outboxEvent.findFirstOrThrow({ where: { eventType: 'test.followup' } })).correlationId).toBe(
      'trace-end-to-end',
    );
    // Every row of the one action, found by the one id.
    expect(await prisma.auditLog.count({ where: { correlationId: 'trace-end-to-end' } })).toBe(2);
  });

  it('gives an event published with no id one of its own, rather than none', async () => {
    await anAct();
    await processEvent(await claimed(), handlers);

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'assignment.completed' } });
    const followUp = await prisma.outboxEvent.findFirstOrThrow({ where: { eventType: 'test.followup' } });
    expect(audit.correlationId).toBeTruthy();
    expect(followUp.correlationId).toBe(audit.correlationId);
  });

  it('keeps one run of a scheduled job together, and one run apart from the next', async () => {
    const stub = { scheduledJob: { update: async () => ({}) } } as never;
    const job = { id: ENTITY, key: 'test.sweep', interval_seconds: 60, run_count: 1 };
    const sweep = async () => {
      await prisma.$transaction(async (tx) => {
        await recordAudit(tx, { action: 'retention.purged', entityType: 'audit.outbox_events', actorType: 'worker' });
        await recordAudit(tx, { action: 'credential.expired', entityType: 'credentials.credential_submissions', actorType: 'worker' });
      });
    };

    await runJob(job, { 'test.sweep': sweep }, stub);
    await runJob(job, { 'test.sweep': sweep }, stub);

    const rows = await prisma.auditLog.findMany({ orderBy: { createdAt: 'asc' } });
    const ids = rows.map((row) => row.correlationId);
    expect(ids.every(Boolean)).toBe(true);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).toBe(ids[3]);
    expect(ids[0]).not.toBe(ids[2]);
  });
});

describe('a write made outside any action', () => {
  it('is left without one, as it was, and an id given by hand is still the one that is used', async () => {
    await prisma.$transaction(async (tx) => {
      await recordAudit(tx, { action: 'user.suspended', entityType: 'identity.users' });
      await recordAudit(tx, { action: 'user.reinstated', entityType: 'identity.users', correlationId: 'given-by-hand' });
    });

    expect((await prisma.auditLog.findFirstOrThrow({ where: { action: 'user.suspended' } })).correlationId).toBeNull();
    expect((await prisma.auditLog.findFirstOrThrow({ where: { action: 'user.reinstated' } })).correlationId).toBe(
      'given-by-hand',
    );
  });
});
