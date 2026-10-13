import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', async () => {
  const { cookieJar } = await import('./support/cookie-jar');
  return { cookies: () => cookieJar };
});

import { prisma } from '@/lib/db';
import { ROLE_PERMISSIONS } from '@/lib/authz/permissions';
import { runOnce } from '@/worker/processor';
import {
  listTroubledEvents,
  replayEvent,
  systemStatus,
} from '@/modules/audit-compliance/application/system-status';
import { GET as statusRoute } from '@/app/api/v1/admin/system/route';
import { POST as replayRoute } from '@/app/api/v1/admin/system/events/[id]/replay/route';
import { GET as backgroundHealthRoute } from '@/app/api/v1/health/background/route';
import { issueSession } from '@/modules/auth/application/session-service';
import { clearCookies } from './support/cookie-jar';
import { createUser, grant } from './support/fixtures';

/**
 * PLT-04. The worker fails quietly: an event it gave up on, or a worker that is
 * not running, looks from outside like nothing happening. These make it visible
 * and let a person put a given-up event back.
 */

beforeEach(() => {
  clearCookies();
});

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60 * 1000);

async function event(
  status: 'PENDING' | 'PROCESSING' | 'PROCESSED' | 'FAILED' | 'DEAD_LETTER',
  overrides: { availableAt?: Date; lastError?: string; attempts?: number; eventType?: string } = {},
) {
  return prisma.outboxEvent.create({
    data: {
      eventType: overrides.eventType ?? 'test.event',
      aggregateType: 'test.things',
      aggregateId: '00000000-0000-4000-8000-000000000001',
      payload: { secretPersonalDetail: 'Amina Yusuf 08031234567' },
      status,
      attempts: overrides.attempts ?? (status === 'PENDING' ? 0 : 8),
      lastError: overrides.lastError ?? null,
      availableAt: overrides.availableAt ?? new Date(),
      processedAt: status === 'PROCESSED' ? new Date() : null,
    },
  });
}

async function operator(roleKey: 'administrator' | 'facility_administrator' = 'administrator') {
  const user = await createUser({ fullName: 'Operations Officer' });
  await grant({
    userId: user.id,
    roleKey,
    permissions: ROLE_PERMISSIONS[roleKey] ?? [],
    scopeType: roleKey === 'administrator' ? 'PLATFORM' : 'FACILITY',
    scopeId: roleKey === 'administrator' ? null : '00000000-0000-4000-8000-0000000000f1',
  });
  return user;
}

describe('seeing the trouble', () => {
  it('reports a clean system as clean', async () => {
    await event('PROCESSED');
    await event('PENDING', { availableAt: new Date(Date.now() + 60_000) });

    const status = await systemStatus();
    expect(status.status).toBe('ok');
    expect(status.problems).toEqual([]);
    expect(status.outbox).toMatchObject({ pending: 1, failed: 0, deadLetter: 0 });
  });

  it('reports events that gave up', async () => {
    await event('DEAD_LETTER', { lastError: 'SMS gateway refused the message' });

    const status = await systemStatus();
    expect(status.status).toBe('degraded');
    expect(status.problems.map((problem) => problem.key)).toEqual(['dead_letters']);
    expect(status.outbox.deadLetter).toBe(1);
  });

  it('reports a worker that is not delivering', async () => {
    await event('PENDING', { availableAt: minutesAgo(12) });

    const status = await systemStatus();
    expect(status.problems.map((problem) => problem.key)).toContain('worker_lagging');
  });

  it('counts an event still being retried as waiting its turn, not as lag, while it is not yet due', async () => {
    await event('FAILED', { attempts: 3, availableAt: new Date(Date.now() + 5 * 60_000) });

    const status = await systemStatus();
    expect(status.problems).toEqual([]);
    expect(status.outbox.failed).toBe(1);
  });

  it('reports an event stuck mid-delivery after its lease ran out', async () => {
    await event('PROCESSING', { attempts: 1, availableAt: minutesAgo(20) });

    expect((await systemStatus()).problems.map((problem) => problem.key)).toContain('worker_lagging');
  });

  it('reports a job that has not run when it was due, and one whose last run failed', async () => {
    await prisma.scheduledJob.create({
      data: {
        key: 'expire-credentials',
        description: 'Expires credentials',
        intervalSeconds: 3600,
        nextRunAt: minutesAgo(30),
      },
    });
    await prisma.scheduledJob.create({
      data: {
        key: 'remind-shifts',
        description: 'Reminds',
        intervalSeconds: 600,
        nextRunAt: new Date(Date.now() + 300_000),
        lastStatus: 'FAILED',
        lastError: 'connection reset',
      },
    });

    const status = await systemStatus();
    expect(status.problems.map((problem) => `${problem.key}:${problem.subject ?? ''}`)).toEqual([
      'job_overdue:',
      'job_failing:remind-shifts',
    ]);
    expect(status.problems[0]!.message).toContain('expire-credentials');
    expect(status.jobs.map((job) => job.key).sort()).toEqual(['expire-credentials', 'remind-shifts']);
  });

  it('lists what gave up, without what the event carried', async () => {
    const failed = await event('DEAD_LETTER', { lastError: 'x'.repeat(2000), eventType: 'notify.thing' });
    await event('PROCESSED');

    const listed = await listTroubledEvents();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: failed.id, eventType: 'notify.thing', status: 'DEAD_LETTER', attempts: 8 });
    expect(listed[0]!.lastError!.length).toBeLessThanOrEqual(300);
    expect(JSON.stringify(listed)).not.toContain('Amina');
    expect(JSON.stringify(listed)).not.toContain('08031234567');
  });
});

describe('putting an event back', () => {
  it('queues a dead letter for another go, and the worker then delivers it', async () => {
    const dead = await event('DEAD_LETTER', { eventType: 'notify.thing', lastError: 'gateway down' });
    const actor = await operator();

    const replayed = await replayEvent({ eventId: dead.id, actorId: actor.id });
    expect(replayed).toMatchObject({ id: dead.id, status: 'PENDING', attempts: 0 });

    const handled = vi.fn(async () => {});
    await runOnce({ handlers: { 'notify.thing': handled } });
    expect(handled).toHaveBeenCalledTimes(1);
    expect((await prisma.outboxEvent.findUniqueOrThrow({ where: { id: dead.id } })).status).toBe('PROCESSED');
    expect((await systemStatus()).status).toBe('ok');
  });

  it('records who replayed it, and what it had said', async () => {
    const dead = await event('DEAD_LETTER', { lastError: 'gateway down' });
    const actor = await operator();

    await replayEvent({ eventId: dead.id, actorId: actor.id });

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'outbox.replayed' } });
    expect(audit.actorId).toBe(actor.id);
    expect(audit.entityId).toBe(dead.id);
    expect(audit.before).toMatchObject({ status: 'DEAD_LETTER', lastError: 'gateway down' });
    expect(audit.after).toMatchObject({ status: 'PENDING' });
  });

  it('will not replay what was delivered, or is waiting anyway', async () => {
    const delivered = await event('PROCESSED');
    const waiting = await event('PENDING');
    const actor = await operator();

    await expect(replayEvent({ eventId: delivered.id, actorId: actor.id })).rejects.toMatchObject({
      code: 'event_not_replayable',
      status: 409,
    });
    await expect(replayEvent({ eventId: waiting.id, actorId: actor.id })).rejects.toMatchObject({
      code: 'event_not_replayable',
    });
    expect(await prisma.auditLog.count({ where: { action: 'outbox.replayed' } })).toBe(0);
  });

  it('says so when there is no such event', async () => {
    const actor = await operator();
    await expect(
      replayEvent({ eventId: '00000000-0000-4000-8000-0000000000aa', actorId: actor.id }),
    ).rejects.toMatchObject({ code: 'event_not_found', status: 404 });
  });

  it('queues it once when two people press replay together', async () => {
    const dead = await event('DEAD_LETTER');
    const actor = await operator();

    const outcomes = await Promise.allSettled([
      replayEvent({ eventId: dead.id, actorId: actor.id }),
      replayEvent({ eventId: dead.id, actorId: actor.id }),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { action: 'outbox.replayed' } })).toBe(1);
  });

  it('puts a failed event back as well, so it need not wait out its backoff', async () => {
    const failed = await event('FAILED', { attempts: 3, availableAt: new Date(Date.now() + 10 * 60_000) });
    const actor = await operator();

    const replayed = await replayEvent({ eventId: failed.id, actorId: actor.id });
    expect(replayed.status).toBe('PENDING');
    expect(new Date(replayed.availableAt).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });
});

describe('through the routes', () => {
  it('shows the status to an operator', async () => {
    await event('DEAD_LETTER');
    const actor = await operator();
    await issueSession({ userId: actor.id });

    const response = await statusRoute(new Request('http://localhost/api/v1/admin/system'));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      status: string;
      problems: { key: string }[];
      events: { id: string }[];
    };
    expect(body.status).toBe('degraded');
    expect(body.problems.map((problem) => problem.key)).toContain('dead_letters');
    expect(body.events).toHaveLength(1);
  });

  it('shows nothing to somebody outside the platform team', async () => {
    const outsider = await operator('facility_administrator');
    await issueSession({ userId: outsider.id });

    const response = await statusRoute(new Request('http://localhost/api/v1/admin/system'));
    expect(response.status).toBe(403);
  });

  it('replays through the route for an operator, and not for anybody else', async () => {
    const dead = await event('DEAD_LETTER');
    const call = () =>
      replayRoute(new Request(`http://localhost/api/v1/admin/system/events/${dead.id}/replay`, { method: 'POST' }), {
        params: Promise.resolve({ id: dead.id }),
      });

    const outsider = await operator('facility_administrator');
    await issueSession({ userId: outsider.id });
    expect((await call()).status).toBe(403);
    expect((await prisma.outboxEvent.findUniqueOrThrow({ where: { id: dead.id } })).status).toBe('DEAD_LETTER');

    clearCookies();
    const actor = await operator();
    await issueSession({ userId: actor.id });
    expect((await call()).status).toBe(200);
    expect((await prisma.outboxEvent.findUniqueOrThrow({ where: { id: dead.id } })).status).toBe('PENDING');
  });
});

describe('the endpoint an uptime monitor can watch', () => {
  it('answers 200 when background work is healthy', async () => {
    const response = await backgroundHealthRoute(new Request('http://localhost/api/v1/health/background'));
    expect(response.status).toBe(200);
    expect(((await response.json()) as { status: string }).status).toBe('ok');
  });

  it('answers 503 with what is wrong, by name only, when it is not', async () => {
    await event('DEAD_LETTER', { lastError: 'Amina Yusuf 08031234567' });
    await event('PENDING', { availableAt: minutesAgo(30) });

    const response = await backgroundHealthRoute(new Request('http://localhost/api/v1/health/background'));
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(text).toContain('worker_lagging');
    expect(text).toContain('dead_letters');
    // Open to anybody who asks, so it says that something is wrong and not what it holds.
    expect(text).not.toContain('Amina');
    expect(text).not.toContain('08031234567');
  });
});
