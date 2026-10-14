import { beforeEach, describe, expect, it, vi } from 'vitest';

const sms = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('@/lib/sms', async () => (await import('./support/sms-double')).gatewayDouble(sms.send));

import { prisma } from '@/lib/db';
import {
  announceLapsedFacilityLicences,
  warnExpiringFacilityLicences,
} from '@/modules/notifications/application/licence-sweeps';
import { JOB_DEFINITIONS, jobs } from '@/worker/jobs';
import { buildBookingWorld, type BookingWorld } from './support/booking-world';
import { createUser, grant } from './support/fixtures';

/**
 * M04-03: a facility is told its licence is about to lapse, and that it has.
 *
 * A lapsed licence already stopped a facility publishing; nobody said so beforehand, and a hospital
 * found out when its next shift would not publish.
 */

const DAY = 24 * 60 * 60 * 1000;
const ACCEPTED = { provider: 'test', providerMessageId: 'm-1', accepted: true };

beforeEach(() => {
  sms.send.mockReset();
  sms.send.mockResolvedValue(ACCEPTED);
});

async function facilityWithLicence(world: BookingWorld, expiresInDays: number | null, now: Date) {
  await prisma.facility.update({
    where: { id: world.facilityId },
    data: { licenceExpiresAt: expiresInDays === null ? null : new Date(now.getTime() + expiresInDays * DAY) },
  });
  return prisma.facility.findUniqueOrThrow({ where: { id: world.facilityId } });
}

const messagesAbout = (facilityId: string, kind?: string) =>
  prisma.notificationMessage.findMany({
    where: { relatedId: facilityId, ...(kind ? { kind } : {}) },
    orderBy: { createdAt: 'asc' },
  });

describe('a licence that is about to expire', () => {
  it('tells the representative a month ahead, with the date and what it will stop', async () => {
    const world = await buildBookingWorld();
    const now = new Date();
    const facility = await facilityWithLicence(world, 25, now);

    const sent = await warnExpiringFacilityLicences(now);

    expect(sent).toBe(1);
    const [message] = await messagesAbout(world.facilityId);
    expect(message).toMatchObject({ userId: facility.representativeUserId, kind: 'facility.licence_expiry_warning_30' });
    expect(message!.body).toMatch(/Owerri General Hospital/);
    expect(message!.body).toMatch(/in 25 days/);
    expect(message!.body).toMatch(/cannot publish shifts or confirm practitioners/);
    expect(message!.body).toMatch(/checks it before it counts/);
  });

  it('also tells whoever can upload the renewal, and each person once', async () => {
    const world = await buildBookingWorld();
    const now = new Date();
    const facility = await facilityWithLicence(world, 20, now);
    const manager = await createUser({ fullName: 'Matron' });
    await grant({ userId: manager.id, roleKey: 'facility_manager', permissions: ['facility.write'], scopeType: 'FACILITY', scopeId: world.facilityId });

    await warnExpiringFacilityLicences(now);

    const told = (await messagesAbout(world.facilityId)).map((message) => message.userId).sort();
    expect(told).toEqual([facility.representativeUserId, manager.id].sort());
  });

  it('says nothing to someone who holds no permission to act on it', async () => {
    const world = await buildBookingWorld();
    const now = new Date();
    await facilityWithLicence(world, 20, now);
    const nurse = await createUser({ fullName: 'Ward Nurse' });
    await grant({ userId: nurse.id, roleKey: 'facility_reader', permissions: ['facility.read'], scopeType: 'FACILITY', scopeId: world.facilityId });

    await warnExpiringFacilityLicences(now);

    expect((await messagesAbout(world.facilityId)).map((message) => message.userId)).not.toContain(nurse.id);
  });

  it('warns again in the last week, and only once at each stage however often it runs', async () => {
    const world = await buildBookingWorld();
    const start = new Date();
    const facility = await facilityWithLicence(world, 25, start);

    await warnExpiringFacilityLicences(start);
    await warnExpiringFacilityLicences(new Date(start.getTime() + 1 * DAY));
    const nearer = new Date(start.getTime() + 20 * DAY); // five days left
    await warnExpiringFacilityLicences(nearer);
    await warnExpiringFacilityLicences(new Date(nearer.getTime() + 1 * DAY));

    const messages = await messagesAbout(world.facilityId);
    expect(messages.filter((m) => m.userId === facility.representativeUserId).map((m) => m.kind)).toEqual([
      'facility.licence_expiry_warning_30',
      'facility.licence_expiry_warning_7',
    ]);
  });

  it('tries again next run for someone it could not reach, and does not repeat for the one it could', async () => {
    const world = await buildBookingWorld();
    const now = new Date();
    await facilityWithLicence(world, 20, now);
    sms.send.mockRejectedValue(new Error('gateway down'));
    await expect(warnExpiringFacilityLicences(now)).rejects.toThrow(/Not delivered/);

    sms.send.mockResolvedValue(ACCEPTED);
    const sent = await warnExpiringFacilityLicences(now);

    expect(sent).toBe(1);
    expect((await messagesAbout(world.facilityId, 'facility.licence_expiry_warning_30')).filter((m) => m.sentAt)).toHaveLength(1);
  });

  it.each([
    ['one that is months from expiring', 120],
    ['one with no expiry date', null],
    ['one that has already lapsed, which has its own notice', -2],
  ])('says nothing about %s', async (_label, days) => {
    const world = await buildBookingWorld();
    const now = new Date();
    await facilityWithLicence(world, days, now);

    expect(await warnExpiringFacilityLicences(now)).toBe(0);
    expect(await messagesAbout(world.facilityId)).toHaveLength(0);
  });

  it.each(['PENDING', 'REJECTED', 'SUSPENDED'] as const)(
    'says nothing about a %s facility: it cannot publish anyway, and compliance owns it',
    async (status) => {
      const world = await buildBookingWorld();
      const now = new Date();
      await facilityWithLicence(world, 10, now);
      await prisma.facility.update({ where: { id: world.facilityId }, data: { status } });

      expect(await warnExpiringFacilityLicences(now)).toBe(0);
    },
  );

  it('does not let last year’s warning silence this year’s', async () => {
    const world = await buildBookingWorld();
    const now = new Date();
    const facility = await facilityWithLicence(world, 20, now);
    const lastYear = new Date(now.getTime() - 340 * DAY);
    await prisma.notificationMessage.create({
      data: {
        userId: facility.representativeUserId,
        channel: 'sms',
        kind: 'facility.licence_expiry_warning_30',
        recipient: '+234803***567',
        body: 'last year',
        relatedType: 'facilities.facilities',
        relatedId: world.facilityId,
        sentAt: lastYear,
        createdAt: lastYear,
      },
    });

    expect(await warnExpiringFacilityLicences(now)).toBe(1);
  });
});

describe('a licence that has lapsed', () => {
  it('tells the facility once, with the date, and what it needs to do', async () => {
    const world = await buildBookingWorld();
    const now = new Date();
    const facility = await facilityWithLicence(world, -3, now);

    const first = await announceLapsedFacilityLicences(now);
    const second = await announceLapsedFacilityLicences(new Date(now.getTime() + DAY));

    expect(first).toBe(1);
    expect(second).toBe(0);
    const [message] = await messagesAbout(world.facilityId, 'facility.licence_expired');
    expect(message).toMatchObject({ userId: facility.representativeUserId });
    expect(message!.body).toMatch(/expired on/);
    expect(message!.body).toMatch(/until a renewed licence is uploaded in Medilink and checked/);
  });

  it('does not announce one that lapsed long ago, so the first run does not text every old lapse', async () => {
    const world = await buildBookingWorld();
    const now = new Date();
    await facilityWithLicence(world, -90, now);

    expect(await announceLapsedFacilityLicences(now)).toBe(0);
  });

  it('says nothing about a licence that has not lapsed', async () => {
    const world = await buildBookingWorld();
    const now = new Date();
    await facilityWithLicence(world, 5, now);

    expect(await announceLapsedFacilityLicences(now)).toBe(0);
  });

  it('really does stop the facility publishing, which is what the message says', async () => {
    const world = await buildBookingWorld();
    const now = new Date();
    await facilityWithLicence(world, -1, now);
    const { getFacility } = await import('@/modules/facilities/application/facility');

    expect((await getFacility(world.facilityId)).canPublish).toBe(false);
  });
});

describe('the scheduled job', () => {
  it('is defined, daily, and has a handler', () => {
    const definition = JOB_DEFINITIONS.find((job) => job.key === 'facility.licence_sweep');

    expect(definition).toBeDefined();
    expect(definition!.intervalSeconds).toBe(24 * 60 * 60);
    expect(typeof jobs['facility.licence_sweep']).toBe('function');
  });
});
