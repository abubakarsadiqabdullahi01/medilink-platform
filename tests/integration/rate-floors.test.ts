import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', async () => {
  const { cookieJar } = await import('./support/cookie-jar');
  return { cookies: () => cookieJar };
});

import { prisma } from '@/lib/db';
import { GET as listFloors, POST as addFloor } from '@/app/api/v1/rate-floors/route';
import {
  createServiceRequest,
  publishServiceRequest,
} from '@/modules/service-requests/application/request';
import { issueSession } from '@/modules/auth/application/session-service';
import { clearCookies } from './support/cookie-jar';
import { buildBookingWorld } from './support/booking-world';
import { createProfessionalCategory, createUser, grant } from './support/fixtures';

/**
 * RAT-01 and the mechanism half of CFG-02. A shift for a profession with no
 * floor used to pass at any rate, silently, so a wage protection did not exist
 * for pharmacists, laboratory scientists and radiographers and nothing said so.
 * It now refuses, and says why; and the people who own the numbers can set them
 * without SQL. What the floors should be is not decided here: that is a policy
 * for Medilink and the regulators.
 */

const LATER = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
const LATER_END = new Date(LATER.getTime() + 8 * 60 * 60 * 1000);

beforeEach(() => {
  clearCookies();
});

const shift = (facilityId: string, professionalCategoryId: string, overrides: Record<string, unknown> = {}) => ({
  facilityId,
  professionalCategoryId,
  shiftType: 'DAY' as const,
  startsAt: LATER,
  endsAt: LATER_END,
  headcount: 1,
  hourlyRateKobo: 1_000_000,
  urgency: 'ROUTINE' as const,
  cancellationTerms: 'Either party may cancel up to 24 hours before the shift.',
  actorId: '00000000-0000-0000-0000-000000000000',
  ...overrides,
});

async function withoutFloors() {
  const world = await buildBookingWorld();
  const category = await createProfessionalCategory({ name: 'Pharmacist', floors: false });
  return { world, category };
}

describe('a shift for a profession with no floor', () => {
  it('is refused when it is drafted, naming the profession and what to do', async () => {
    const { world, category } = await withoutFloors();

    await expect(createServiceRequest(shift(world.facilityId, category.id))).rejects.toMatchObject({
      code: 'no_rate_floor',
      status: 422,
    });
    await expect(createServiceRequest(shift(world.facilityId, category.id))).rejects.toThrow(/Pharmacist/);
    expect(await prisma.serviceRequest.count({ where: { professionalCategoryId: category.id } })).toBe(0);
  });

  it('is refused again at publishing when the floor has gone since the draft', async () => {
    const world = await buildBookingWorld();
    const category = await createProfessionalCategory({ name: 'Radiographer' });
    const draft = await createServiceRequest(shift(world.facilityId, category.id));
    await prisma.rateFloor.deleteMany({ where: { categoryKey: category.key } });

    await expect(
      publishServiceRequest({ requestId: draft.id, facilityId: world.facilityId, actorId: world.schedulerId }),
    ).rejects.toMatchObject({ code: 'no_rate_floor' });
    expect((await prisma.serviceRequest.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe('DRAFT');
  });

  it('is refused for a night shift when only the day floor is set', async () => {
    const world = await buildBookingWorld();
    const category = await createProfessionalCategory({ name: 'Laboratory scientist', floors: false });
    await prisma.rateFloor.create({
      data: {
        categoryKey: category.key,
        specialtyKey: '*',
        shiftType: 'day',
        minHourlyKobo: 500_000,
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        owner: 'test-fixture',
      },
    });

    await expect(
      createServiceRequest(shift(world.facilityId, category.id, { shiftType: 'NIGHT' })),
    ).rejects.toMatchObject({ code: 'no_rate_floor' });
    await expect(createServiceRequest(shift(world.facilityId, category.id))).resolves.toMatchObject({
      status: 'DRAFT',
    });
  });

  it('still refuses below a floor that exists, and accepts at it', async () => {
    const world = await buildBookingWorld();
    const category = await createProfessionalCategory({ name: 'Pharmacist', floors: false });
    await prisma.rateFloor.create({
      data: {
        categoryKey: category.key,
        specialtyKey: '*',
        shiftType: 'day',
        minHourlyKobo: 500_000,
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        owner: 'test-fixture',
      },
    });

    await expect(
      createServiceRequest(shift(world.facilityId, category.id, { hourlyRateKobo: 499_999 })),
    ).rejects.toMatchObject({ code: 'below_rate_floor' });
    await expect(
      createServiceRequest(shift(world.facilityId, category.id, { hourlyRateKobo: 500_000 })),
    ).resolves.toMatchObject({ status: 'DRAFT' });
  });
});

describe('setting a floor', () => {
  async function asConfigurer() {
    const user = await createUser({ fullName: 'Super Administrator' });
    await grant({ userId: user.id, roleKey: 'rate_floor_editor', permissions: ['config.manage'], scopeType: 'PLATFORM' });
    await issueSession({ userId: user.id });
    return user;
  }

  const post = (body: unknown) =>
    addFloor(
      new Request('http://localhost/api/v1/rate-floors', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
  const tomorrow = () => new Date(Date.now() + 3600_000 + 86_400_000).toISOString().slice(0, 10);

  it('lets the person who holds config.manage set one, and the shift can then be drafted', async () => {
    const { world, category } = await withoutFloors();
    const user = await asConfigurer();

    const response = await post({
      categoryKey: category.key,
      shiftType: 'day',
      minHourlyKobo: 650_000,
      effectiveFrom: tomorrow(),
    });

    expect(response.status).toBe(201);
    const row = await prisma.rateFloor.findFirstOrThrow({ where: { categoryKey: category.key } });
    expect(row).toMatchObject({ specialtyKey: '*', shiftType: 'day', minHourlyKobo: 650_000 });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'rate_floor.set' } });
    expect(audit.actorId).toBe(user.id);

    // It takes effect from its date, so a shift that starts after it is governed.
    await expect(
      createServiceRequest(shift(world.facilityId, category.id, { hourlyRateKobo: 650_000 })),
    ).resolves.toMatchObject({ status: 'DRAFT' });
    await expect(
      createServiceRequest(shift(world.facilityId, category.id, { hourlyRateKobo: 649_999 })),
    ).rejects.toMatchObject({ code: 'below_rate_floor' });
  });

  it('refuses everybody who does not hold it, and writes nothing', async () => {
    const { category } = await withoutFloors();
    const owner = await createUser({ fullName: 'Facility Owner' });
    await grant({ userId: owner.id, roleKey: 'owner_x', permissions: ['facility.read'], scopeType: 'PLATFORM' });
    await issueSession({ userId: owner.id });

    const response = await post({ categoryKey: category.key, shiftType: 'day', minHourlyKobo: 1, effectiveFrom: tomorrow() });

    expect(response.status).toBe(403);
    expect(await prisma.rateFloor.count({ where: { categoryKey: category.key } })).toBe(0);
  });

  it('refuses a profession that does not exist', async () => {
    await asConfigurer();

    const response = await post({ categoryKey: 'no_such', shiftType: 'day', minHourlyKobo: 650_000, effectiveFrom: tomorrow() });

    expect(response.status).toBe(404);
  });

  it('refuses a specialty that does not belong to the profession', async () => {
    const { category } = await withoutFloors();
    await asConfigurer();

    const response = await post({
      categoryKey: category.key,
      specialtyKey: 'not-one-of-its',
      shiftType: 'day',
      minHourlyKobo: 650_000,
      effectiveFrom: tomorrow(),
    });

    expect(response.status).toBe(422);
  });

  it('refuses an amount that is not credible, or a start in the past', async () => {
    const { category } = await withoutFloors();
    await asConfigurer();

    expect((await post({ categoryKey: category.key, shiftType: 'day', minHourlyKobo: 0, effectiveFrom: tomorrow() })).status).toBe(422);
    expect((await post({ categoryKey: category.key, shiftType: 'day', minHourlyKobo: 650_000, effectiveFrom: '2020-01-01' })).status).toBe(422);
    expect(await prisma.rateFloor.count({ where: { categoryKey: category.key } })).toBe(0);
  });

  it('refuses the same floor twice for the same date', async () => {
    const { category } = await withoutFloors();
    await asConfigurer();
    const body = { categoryKey: category.key, shiftType: 'day', minHourlyKobo: 650_000, effectiveFrom: tomorrow() };

    expect((await post(body)).status).toBe(201);
    expect((await post(body)).status).toBe(409);
  });
});

describe('seeing which floors are missing', () => {
  it('lists every profession and shift type with no floor in force today, so the gap is visible', async () => {
    const world = await buildBookingWorld();
    void world;
    const none = await createProfessionalCategory({ name: 'Pharmacist', floors: false });
    const dayOnly = await createProfessionalCategory({ name: 'Radiographer', floors: false });
    await prisma.rateFloor.create({
      data: {
        categoryKey: dayOnly.key,
        specialtyKey: '*',
        shiftType: 'day',
        minHourlyKobo: 500_000,
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        owner: 'test-fixture',
      },
    });
    const user = await createUser({ fullName: 'Super Administrator' });
    await grant({ userId: user.id, roleKey: 'rate_floor_editor', permissions: ['config.manage'], scopeType: 'PLATFORM' });
    await issueSession({ userId: user.id });

    const response = await listFloors(new Request('http://localhost/api/v1/rate-floors'));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { missing: { categoryKey: string; shiftType: string }[]; floors: unknown[] };
    const missing = body.missing.map((row) => `${row.categoryKey}:${row.shiftType}`);
    expect(missing).toContain(`${none.key}:day`);
    expect(missing).toContain(`${none.key}:night`);
    expect(missing).toContain(`${dayOnly.key}:night`);
    expect(missing).not.toContain(`${dayOnly.key}:day`);
  });
});
