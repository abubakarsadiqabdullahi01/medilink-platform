import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', async () => {
  const { cookieJar } = await import('./support/cookie-jar');
  return { cookies: () => cookieJar };
});

import { prisma } from '@/lib/db';
import { GET as getAvailabilityRoute } from '@/app/api/v1/availability/route';
import { POST as postSlot } from '@/app/api/v1/availability/slots/route';
import { DELETE as deleteSlot } from '@/app/api/v1/availability/slots/[id]/route';
import { POST as postBlock } from '@/app/api/v1/availability/blocks/route';
import { DELETE as deleteBlock } from '@/app/api/v1/availability/blocks/[id]/route';
import { ROUTES } from '@/modules/availability/routes';
import { availabilityForWindow } from '@/modules/availability/application/availability';
import { issueSession } from '@/modules/auth/application/session-service';
import { clearCookies } from './support/cookie-jar';
import { createUser, grant } from './support/fixtures';

/**
 * Step 6.2 — availability. The matcher in 6.3 is what consumes it; what is
 * asserted here is that a practitioner can state it, only about themselves,
 * and that the stored shape answers the matcher's question correctly.
 */

interface ApiResult {
  status: number;
  body: Record<string, unknown>;
}

const MONDAY_SHIFT = {
  startsAt: new Date('2026-09-14T09:00:00.000Z'),
  endsAt: new Date('2026-09-14T15:00:00.000Z'),
};

/** Monday 08:00–18:00 WAT, which is 07:00–17:00 UTC. */
const MONDAY_DAY_SLOT = {
  kind: 'RECURRING_WEEKLY',
  dayOfWeek: 1,
  startMinute: 8 * 60,
  endMinute: 18 * 60,
};

async function post(
  handler: (request: Request) => Promise<Response>,
  path: string,
  body: unknown,
): Promise<ApiResult> {
  const response = await handler(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  return { status: response.status, body: await response.json() };
}

const callAddSlot = (body: unknown) => post(postSlot, '/api/v1/availability/slots', body);
const callAddBlock = (body: unknown) => post(postBlock, '/api/v1/availability/blocks', body);

async function callRemove(
  handler: (request: Request, context: { params: { id: string } }) => Promise<Response>,
  path: string,
  id: string,
): Promise<ApiResult> {
  const response = await handler(new Request(`http://localhost${path}/${id}`, { method: 'DELETE' }), {
    params: { id },
  });
  return { status: response.status, body: await response.json() };
}

async function callGet(query: Record<string, string>): Promise<ApiResult> {
  const params = new URLSearchParams(query);
  const response = await getAvailabilityRoute(
    new Request(`http://localhost/api/v1/availability?${params}`),
  );
  return { status: response.status, body: await response.json() };
}

async function practitioner() {
  const user = await createUser();
  await grant({
    userId: user.id,
    roleKey: 'practitioner',
    permissions: ['availability.read', 'availability.write'],
    scopeType: 'SELF',
    scopeId: user.id,
  });
  await issueSession({ userId: user.id });
  return user;
}

beforeEach(() => {
  clearCookies();
});

describe('stating availability', () => {
  it('accepts a recurring weekly slot', async () => {
    await practitioner();

    const result = await callAddSlot(MONDAY_DAY_SLOT);

    expect(result.status).toBe(201);
    expect(result.body.kind).toBe('RECURRING_WEEKLY');
    expect(result.body.dayOfWeek).toBe(1);
    // The one-off columns stay empty; one table, two shapes.
    expect(result.body.startsAt).toBeNull();
  });

  it('accepts a one-off slot', async () => {
    await practitioner();

    const result = await callAddSlot({
      kind: 'ONE_OFF',
      startsAt: '2026-09-14T07:00:00.000Z',
      endsAt: '2026-09-14T17:00:00.000Z',
    });

    expect(result.status).toBe(201);
    expect(result.body.dayOfWeek).toBeNull();
  });

  it('refuses a recurring slot missing the fields it needs', async () => {
    await practitioner();

    const result = await callAddSlot({ kind: 'RECURRING_WEEKLY', dayOfWeek: 1 });

    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ error: { code: 'recurring_fields_required' } });
  });

  it('refuses a one-off slot missing the fields it needs', async () => {
    await practitioner();

    const result = await callAddSlot({ kind: 'ONE_OFF', startsAt: '2026-09-14T07:00:00.000Z' });

    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ error: { code: 'one_off_fields_required' } });
  });

  it('refuses a slot of no length', async () => {
    await practitioner();

    // Equal start and end is not "all day"; it is almost always a typo for
    // one that wraps past midnight.
    const result = await callAddSlot({ ...MONDAY_DAY_SLOT, endMinute: MONDAY_DAY_SLOT.startMinute });

    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ error: { code: 'empty_slot' } });
  });

  it('refuses a one-off slot that ends before it starts', async () => {
    await practitioner();

    const result = await callAddSlot({
      kind: 'ONE_OFF',
      startsAt: '2026-09-14T17:00:00.000Z',
      endsAt: '2026-09-14T07:00:00.000Z',
    });

    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ error: { code: 'end_before_start' } });
  });

  it('requires a reason on a block', async () => {
    await practitioner();

    // "Why was this practitioner unavailable" is a question disputes ask.
    const result = await callAddBlock({
      startsAt: '2026-09-14T00:00:00.000Z',
      endsAt: '2026-09-15T00:00:00.000Z',
    });

    expect(result.status).toBe(422);
  });
});

describe('what the matcher will see', () => {
  it('reports a practitioner available for a shift inside their slot', async () => {
    const user = await practitioner();
    await callAddSlot(MONDAY_DAY_SLOT);

    expect(await availabilityForWindow(user.id, MONDAY_SHIFT)).toEqual({
      available: true,
      reason: 'available',
    });
  });

  it('reports not_offered when they do not work that day', async () => {
    const user = await practitioner();
    await callAddSlot({ ...MONDAY_DAY_SLOT, dayOfWeek: 3 });

    expect(await availabilityForWindow(user.id, MONDAY_SHIFT)).toMatchObject({
      available: false,
      reason: 'not_offered',
    });
  });

  it('reports blocked when a block overlaps, even though the slot covers it', async () => {
    const user = await practitioner();
    await callAddSlot(MONDAY_DAY_SLOT);
    await callAddBlock({
      startsAt: '2026-09-14T10:00:00.000Z',
      endsAt: '2026-09-14T11:00:00.000Z',
      reason: 'Hospital training day',
    });

    // Step 6.2's stated verification, at the boundary the matcher uses: a
    // blocked period removes them from consideration.
    expect(await availabilityForWindow(user.id, MONDAY_SHIFT)).toMatchObject({
      available: false,
      reason: 'blocked',
    });
  });

  it('becomes available again once the block is withdrawn', async () => {
    const user = await practitioner();
    await callAddSlot(MONDAY_DAY_SLOT);
    const block = await callAddBlock({
      startsAt: '2026-09-14T10:00:00.000Z',
      endsAt: '2026-09-14T11:00:00.000Z',
      reason: 'Cancelled training',
    });

    await callRemove(deleteBlock, '/api/v1/availability/blocks', block.body.id as string);

    expect((await availabilityForWindow(user.id, MONDAY_SHIFT)).available).toBe(true);
  });

  it('stops offering a withdrawn slot', async () => {
    const user = await practitioner();
    const slot = await callAddSlot(MONDAY_DAY_SLOT);

    await callRemove(deleteSlot, '/api/v1/availability/slots', slot.body.id as string);

    expect((await availabilityForWindow(user.id, MONDAY_SHIFT)).available).toBe(false);
    // Soft-deleted, so a match run that considered it can still be explained.
    const row = await prisma.availabilitySlot.findUniqueOrThrow({
      where: { id: slot.body.id as string },
    });
    expect(row.deletedAt).not.toBeNull();
  });
});

describe('authorisation', () => {
  it('refuses an unauthenticated caller', async () => {
    expect((await callGet({ scopeType: 'SELF' })).status).toBe(401);
    expect((await callAddSlot(MONDAY_DAY_SLOT)).status).toBe(401);
  });

  it('refuses a user holding a role without availability.write', async () => {
    const outsider = await createUser();
    await grant({
      userId: outsider.id,
      roleKey: 'facility_finance_officer',
      permissions: ['facility.read', 'invoice.read'],
      scopeType: 'PLATFORM',
    });
    await issueSession({ userId: outsider.id });

    expect((await callAddSlot(MONDAY_DAY_SLOT)).status).toBe(403);
  });

  it("refuses one practitioner another's calendar", async () => {
    const other = await createUser();
    await practitioner();

    expect((await callGet({ scopeType: 'SELF', scopeId: other.id })).status).toBe(403);
    expect((await callGet({ scopeType: 'PLATFORM', scopeId: other.id })).status).toBe(403);
  });

  it("refuses withdrawing another practitioner's slot, as a 404", async () => {
    const owner = await practitioner();
    const slot = await callAddSlot(MONDAY_DAY_SLOT);

    await practitioner();
    const result = await callRemove(
      deleteSlot,
      '/api/v1/availability/slots',
      slot.body.id as string,
    );

    // 404 rather than 403: a distinguishable 403 would confirm the id exists.
    expect(result.status).toBe(404);
    expect(owner.id).toBeTruthy();
  });

  it('lets operations read a calendar at PLATFORM scope', async () => {
    const owner = await practitioner();
    await callAddSlot(MONDAY_DAY_SLOT);

    const operations = await createUser();
    await grant({
      userId: operations.id,
      roleKey: 'operations_officer',
      permissions: ['availability.read'],
      scopeType: 'PLATFORM',
    });
    await issueSession({ userId: operations.id });

    const result = await callGet({ scopeType: 'PLATFORM', scopeId: owner.id });

    expect(result.status).toBe(200);
    expect(result.body.slots).toHaveLength(1);
  });
});

describe('the route table', () => {
  it('keeps writing SELF-only', () => {
    const writes = ROUTES.filter((route) => route.permission === 'availability.write');
    expect(writes.length).toBeGreaterThan(0);
    // Nobody else should ever be able to say a practitioner is free.
    expect(writes.every((route) => route.scopeType === 'SELF')).toBe(true);
  });
});
