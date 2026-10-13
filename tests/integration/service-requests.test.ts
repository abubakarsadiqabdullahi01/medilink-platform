import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', async () => {
  const { cookieJar } = await import('./support/cookie-jar');
  return { cookies: () => cookieJar };
});

import { prisma } from '@/lib/db';
import { EVENTS } from '@/lib/events';
import { GET as listRoute, POST as createRoute } from '@/app/api/v1/service-requests/route';
import { GET as getRoute } from '@/app/api/v1/service-requests/[id]/route';
import { POST as publishRoute } from '@/app/api/v1/service-requests/[id]/publish/route';
import { POST as cancelRoute } from '@/app/api/v1/service-requests/[id]/cancel/route';
import { ROUTES } from '@/modules/service-requests/routes';
import { ROLE_PERMISSIONS } from '@/lib/authz/permissions';
import { issueSession } from '@/modules/auth/application/session-service';
import { createFacility, verifyFacility } from '@/modules/facilities/application/facility';
import { clearCookies } from './support/cookie-jar';
import {
  createFacilityType,
  createProfessionalCategory,
  createSpecialty,
  createState,
  createUser,
  ensureRole,
  grant,
} from './support/fixtures';

/**
 * Step 6.1 — service requests.
 *
 * Two things here close Stage 5 business as well as their own: the rate floor
 * refusal that 6.1 names as its verification, and the `canPublish` check that
 * Stage 5.10's doc said could not be tested until something published.
 */

interface ApiResult {
  status: number;
  body: Record<string, unknown>;
}

const NEXT_WEEK = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
const NEXT_WEEK_END = new Date(NEXT_WEEK.getTime() + 8 * 60 * 60 * 1000);

/** The seeded floor for a doctor's night shift is 650,000 kobo an hour. */
const NIGHT_FLOOR_KOBO = 650_000;

let cacSequence = 0;

async function post(
  handler: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>,
  path: string,
  body: unknown,
  id: string,
): Promise<ApiResult> {
  const response = await handler(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
  return { status: response.status, body: await response.json() };
}

async function callCreate(body: unknown): Promise<ApiResult> {
  const response = await createRoute(
    new Request('http://localhost/api/v1/service-requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  return { status: response.status, body: await response.json() };
}

async function callList(query: Record<string, string>): Promise<ApiResult> {
  const response = await listRoute(
    new Request(`http://localhost/api/v1/service-requests?${new URLSearchParams(query)}`),
  );
  return { status: response.status, body: await response.json() };
}

async function callGet(id: string, facilityId: string): Promise<ApiResult> {
  const response = await getRoute(
    new Request(`http://localhost/api/v1/service-requests/${id}?facilityId=${facilityId}`),
    { params: Promise.resolve({ id }) },
  );
  return { status: response.status, body: await response.json() };
}

const callPublish = (id: string, facilityId: string) =>
  post(publishRoute, `/api/v1/service-requests/${id}/publish`, { facilityId }, id);

const callCancel = (id: string, facilityId: string, reason: string) =>
  post(cancelRoute, `/api/v1/service-requests/${id}/cancel`, { facilityId, reason }, id);

interface Fixture {
  facilityId: string;
  schedulerId: string;
  categoryId: string;
  specialtyId: string;
}

/**
 * A verified facility with a scheduler who may publish, plus the seeded
 * doctor category — the rate floors are keyed on its `doctor` key.
 */
async function setUp(options: { verified?: boolean } = {}): Promise<Fixture> {
  await ensureRole('facility_owner', ROLE_PERMISSIONS.facility_owner ?? []);

  const state = await createState();
  const facilityType = await createFacilityType();
  const representative = await createUser({ fullName: 'Facility Representative' });
  const ops = await createUser({ fullName: 'Operations Officer' });
  const officer = await createUser({ fullName: 'Compliance Officer' });

  cacSequence += 1;
  const facility = await createFacility({
    name: 'Owerri General Hospital',
    facilityTypeId: facilityType.id,
    cacNumber: `RC${900_000 + cacSequence}`,
    stateId: state.id,
    addressLine: '14 Wetheral Road, Owerri',
    contactPhone: '+2348031234567',
    representativeUserId: representative.id,
    actorId: ops.id,
  });

  if (options.verified !== false) {
    await verifyFacility({
      facilityId: facility.id,
      verifierId: officer.id,
      decision: 'approve',
    });
  }

  const category = await createProfessionalCategory({ key: 'doctor', name: 'Medical Doctor' });
  const specialty = await createSpecialty(category.id, { key: 'anaesthesia' });

  const scheduler = await createUser({ fullName: 'Facility Scheduler' });
  await grant({
    userId: scheduler.id,
    roleKey: 'facility_scheduler',
    permissions: ['service_request.read', 'service_request.publish', 'facility.read'],
    scopeType: 'FACILITY',
    scopeId: facility.id,
  });
  await issueSession({ userId: scheduler.id });

  return {
    facilityId: facility.id,
    schedulerId: scheduler.id,
    categoryId: category.id,
    specialtyId: specialty.id,
  };
}

function requestBody(fixture: Fixture, overrides: Record<string, unknown> = {}) {
  return {
    facilityId: fixture.facilityId,
    professionalCategoryId: fixture.categoryId,
    shiftType: 'NIGHT',
    startsAt: NEXT_WEEK.toISOString(),
    endsAt: NEXT_WEEK_END.toISOString(),
    headcount: 2,
    hourlyRateKobo: NIGHT_FLOOR_KOBO,
    urgency: 'ROUTINE',
    cancellationTerms: 'Either party may cancel up to 24 hours before the shift.',
    ...overrides,
  };
}

beforeEach(async () => {
  clearCookies();
  // The floors are reference data the seed owns; integration runs never seed,
  // so the ones this file asserts against are created here.
  await prisma.rateFloor.deleteMany({ where: { categoryKey: 'doctor' } });
  await prisma.rateFloor.createMany({
    data: [
      {
        categoryKey: 'doctor',
        specialtyKey: '*',
        shiftType: 'night',
        minHourlyKobo: NIGHT_FLOOR_KOBO,
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        owner: 'test-fixture',
      },
      {
        categoryKey: 'doctor',
        specialtyKey: '*',
        shiftType: 'day',
        minHourlyKobo: 500_000,
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        owner: 'test-fixture',
      },
    ],
  });
});

describe('step 6.1 — the rate floor', () => {
  it('accepts a rate exactly at the floor', async () => {
    const fixture = await setUp();

    const created = await callCreate(requestBody(fixture));

    expect(created.status).toBe(201);
    expect(created.body.status).toBe('DRAFT');
    expect(created.body.hourlyRateKobo).toBe(NIGHT_FLOOR_KOBO);
  });

  it('refuses one kobo below the floor, and names the floor', async () => {
    const fixture = await setUp();

    // Step 6.1's verification, verbatim.
    const created = await callCreate(
      requestBody(fixture, { hourlyRateKobo: NIGHT_FLOOR_KOBO - 1 }),
    );

    expect(created.status).toBe(422);
    expect(created.body).toMatchObject({ error: { code: 'below_rate_floor' } });
    // A facility told only "too low" has to guess, and will guess low again.
    // In naira, as a scheduler would say it, not the kobo it is stored in.
    expect(String((created.body.error as { message: string }).message)).toContain(
      `₦${(NIGHT_FLOOR_KOBO / 100).toLocaleString('en-NG')}`,
    );
  });

  it('applies the day floor to a day shift', async () => {
    const fixture = await setUp();

    const belowDay = await callCreate(
      requestBody(fixture, { shiftType: 'DAY', hourlyRateKobo: 499_999 }),
    );
    expect(belowDay.status).toBe(422);

    const atDay = await callCreate(
      requestBody(fixture, { shiftType: 'DAY', hourlyRateKobo: 500_000 }),
    );
    expect(atDay.status).toBe(201);
  });

  it('refuses again at publish when the floor has risen since the draft', async () => {
    const fixture = await setUp();
    const created = await callCreate(requestBody(fixture));

    // A floor can move between drafting and publishing, and the published
    // rate is the one that counts.
    await prisma.rateFloor.create({
      data: {
        categoryKey: 'doctor',
        specialtyKey: '*',
        shiftType: 'night',
        minHourlyKobo: NIGHT_FLOOR_KOBO * 2,
        effectiveFrom: new Date('2026-02-01T00:00:00.000Z'),
        owner: 'test-fixture',
      },
    });

    const published = await callPublish(created.body.id as string, fixture.facilityId);

    expect(published.status).toBe(422);
    expect(published.body).toMatchObject({ error: { code: 'below_rate_floor' } });
  });
});

describe('the Stage 5.10 gate condition, finally testable', () => {
  it('refuses to publish for an unverified facility', async () => {
    const fixture = await setUp({ verified: false });
    const created = await callCreate(requestBody(fixture));
    expect(created.status).toBe(201);

    // "A facility must be verified before it can publish" — canPublish has
    // existed since 5.10 with nothing calling it. This is the call.
    const published = await callPublish(created.body.id as string, fixture.facilityId);

    expect(published.status).toBe(409);
    expect(published.body).toMatchObject({ error: { code: 'facility_cannot_publish' } });
    // Said in words, not the blocker code the facility module returns.
    expect(String((published.body.error as { message: string }).message)).toContain('not verified');
  });

  it('publishes for a verified facility and announces it', async () => {
    const fixture = await setUp();
    const created = await callCreate(requestBody(fixture));

    const published = await callPublish(created.body.id as string, fixture.facilityId);

    expect(published.status).toBe(200);
    expect(published.body.status).toBe('PUBLISHED');
    expect(published.body.publishedBy).toBe(fixture.schedulerId);

    const events = await prisma.outboxEvent.findMany({
      where: { eventType: EVENTS.ServiceRequestPublished },
    });
    expect(events).toHaveLength(1);
  });

  it('refuses to publish a shift that has already started', async () => {
    const fixture = await setUp();
    const past = new Date(Date.now() - 60 * 60 * 1000);
    const created = await callCreate(
      requestBody(fixture, {
        startsAt: past.toISOString(),
        endsAt: new Date(past.getTime() + 60 * 60 * 1000).toISOString(),
      }),
    );

    const published = await callPublish(created.body.id as string, fixture.facilityId);
    expect(published.status).toBe(422);
    expect(published.body).toMatchObject({ error: { code: 'starts_in_the_past' } });
  });

  it('refuses to publish the same request twice', async () => {
    const fixture = await setUp();
    const created = await callCreate(requestBody(fixture));

    expect((await callPublish(created.body.id as string, fixture.facilityId)).status).toBe(200);
    const again = await callPublish(created.body.id as string, fixture.facilityId);

    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ error: { code: 'not_a_draft' } });
  });
});

describe('validation', () => {
  it('refuses a shift that ends before it starts', async () => {
    const fixture = await setUp();
    const result = await callCreate(
      requestBody(fixture, {
        startsAt: NEXT_WEEK_END.toISOString(),
        endsAt: NEXT_WEEK.toISOString(),
      }),
    );

    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ error: { code: 'end_before_start' } });
  });

  it('refuses a shift longer than a day', async () => {
    const fixture = await setUp();
    const result = await callCreate(
      requestBody(fixture, {
        endsAt: new Date(NEXT_WEEK.getTime() + 30 * 60 * 60 * 1000).toISOString(),
      }),
    );

    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ error: { code: 'shift_too_long' } });
  });

  it('refuses a specialty from another category', async () => {
    const fixture = await setUp();
    const otherCategory = await createProfessionalCategory({ key: 'nurse_test' });
    const foreign = await createSpecialty(otherCategory.id);

    // Asking for a paediatrician under "nurse" is a request nobody could fill.
    const result = await callCreate(requestBody(fixture, { specialtyId: foreign.id }));

    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ error: { code: 'invalid_specialty' } });
  });

  it('requires cancellation terms', async () => {
    const fixture = await setUp();
    const result = await callCreate(requestBody(fixture, { cancellationTerms: '' }));

    // What happens if either side pulls out is the term disputes turn on.
    expect(result.status).toBe(422);
  });

  it('refuses a fractional rate, because money is integer kobo', async () => {
    const fixture = await setUp();
    const result = await callCreate(requestBody(fixture, { hourlyRateKobo: 650_000.5 }));
    expect(result.status).toBe(422);
  });
});

describe('cancelling', () => {
  it('withdraws a published request with a reason', async () => {
    const fixture = await setUp();
    const created = await callCreate(requestBody(fixture));
    await callPublish(created.body.id as string, fixture.facilityId);

    const cancelled = await callCancel(
      created.body.id as string,
      fixture.facilityId,
      'The ward closed for refurbishment.',
    );

    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe('CANCELLED');
    expect(cancelled.body.cancellationReason).toContain('refurbishment');
  });

  it('never revives a cancelled request', async () => {
    const fixture = await setUp();
    const created = await callCreate(requestBody(fixture));
    await callCancel(created.body.id as string, fixture.facilityId, 'Not needed.');

    // Practitioners have already been told it is closed.
    const published = await callPublish(created.body.id as string, fixture.facilityId);
    expect(published.status).toBe(409);
  });

  it('requires a reason', async () => {
    const fixture = await setUp();
    const created = await callCreate(requestBody(fixture));

    const cancelled = await callCancel(created.body.id as string, fixture.facilityId, '');
    expect(cancelled.status).toBe(422);
  });
});

describe('listing', () => {
  it('narrows by notes text and by start-date range', async () => {
    const fixture = await setUp();
    const wardA = await callCreate(
      requestBody(fixture, { notes: 'Report to Ward A, ask for the charge nurse.' }),
    );
    const laterStart = new Date(NEXT_WEEK.getTime() + 14 * 24 * 60 * 60 * 1000);
    const laterEnd = new Date(laterStart.getTime() + 8 * 60 * 60 * 1000);
    const wardB = await callCreate(
      requestBody(fixture, {
        notes: 'Ward B, bring your own scrubs.',
        startsAt: laterStart.toISOString(),
        endsAt: laterEnd.toISOString(),
      }),
    );

    const bySearch = await callList({
      scopeType: 'FACILITY',
      scopeId: fixture.facilityId,
      search: 'Ward A',
    });
    expect(bySearch.status).toBe(200);
    const searchIds = (bySearch.body.requests as { id: string }[]).map((row) => row.id);
    expect(searchIds).toContain(wardA.body.id);
    expect(searchIds).not.toContain(wardB.body.id);

    const byRange = await callList({
      scopeType: 'FACILITY',
      scopeId: fixture.facilityId,
      from: NEXT_WEEK.toISOString(),
      to: NEXT_WEEK_END.toISOString(),
    });
    expect(byRange.status).toBe(200);
    const rangeIds = (byRange.body.requests as { id: string }[]).map((row) => row.id);
    expect(rangeIds).toContain(wardA.body.id);
    expect(rangeIds).not.toContain(wardB.body.id);
  });
});

describe('authorisation', () => {
  it('refuses an unauthenticated caller', async () => {
    expect((await callList({ scopeType: 'PLATFORM' })).status).toBe(401);
  });

  it('refuses a facility-scoped caller another facility', async () => {
    const first = await setUp();
    const second = await setUp();

    // setUp left the second facility's scheduler logged in.
    expect((await callList({ scopeType: 'FACILITY', scopeId: second.facilityId })).status).toBe(200);
    expect((await callList({ scopeType: 'FACILITY', scopeId: first.facilityId })).status).toBe(403);
    expect((await callList({ scopeType: 'PLATFORM' })).status).toBe(403);
  });

  it("gives a 404, not another facility's request, when the id does not belong to the named facility", async () => {
    const first = await setUp();
    const created = await callCreate(requestBody(first));

    const second = await setUp();
    // Naming a facility they do hold permission for, with an id from another.
    const result = await callGet(created.body.id as string, second.facilityId);

    expect(result.status).toBe(404);
  });

  it('refuses a role that can read requests but not publish them', async () => {
    const fixture = await setUp();
    const administrator = await createUser();
    await grant({
      userId: administrator.id,
      roleKey: 'facility_administrator',
      permissions: ['facility.read', 'service_request.read'],
      scopeType: 'FACILITY',
      scopeId: fixture.facilityId,
    });
    await issueSession({ userId: administrator.id });

    expect((await callCreate(requestBody(fixture))).status).toBe(403);
    expect(
      (await callList({ scopeType: 'FACILITY', scopeId: fixture.facilityId })).status,
    ).toBe(200);
  });
});

describe('the route table', () => {
  it('scopes every write to a facility', () => {
    const writes = ROUTES.filter((route) => route.method === 'POST');
    expect(writes.length).toBeGreaterThan(0);
    expect(writes.every((route) => route.scopeType === 'FACILITY')).toBe(true);
  });
});
