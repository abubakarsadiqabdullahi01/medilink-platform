import { beforeEach, describe, expect, it, vi } from 'vitest';

const sms = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('@/lib/sms', async () => (await import('./support/sms-double')).gatewayDouble(sms.send));

import { prisma } from '@/lib/db';
import { smsEncoding } from '@/lib/sms-text';
import {
  announceLapsedFacilityLicences,
  warnExpiringFacilityLicences,
} from '@/modules/notifications/application/licence-sweeps';
import { notify } from '@/modules/notifications/application/notify';
import { smsProblems } from '@/modules/notifications/domain/sms-hygiene';
import { buildBookingWorld } from './support/booking-world';
import { createUser } from './support/fixtures';

/**
 * M16-07: what the texts are like when the words in them are a person's own.
 *
 * `setup.ts` holds every text any test stores to the rules in `sms-hygiene.ts`, with ordinary
 * names. These are the names that are not ordinary: one typed on a phone, with the punctuation a
 * phone keyboard types, and one as long as a real hospital's.
 */

const DAY = 24 * 60 * 60 * 1000;
const ACCEPTED = { provider: 'test', providerMessageId: 'm-1', accepted: true };

beforeEach(() => {
  sms.send.mockReset();
  sms.send.mockResolvedValue(ACCEPTED);
});

const gatewayBodies = () => sms.send.mock.calls.map((call) => (call[0] as { body: string }).body);

async function facilityNamed(name: string, licenceExpiresInDays: number) {
  const world = await buildBookingWorld();
  await prisma.facility.update({
    where: { id: world.facilityId },
    data: { name, licenceExpiresAt: new Date(Date.now() + licenceExpiresInDays * DAY) },
  });
  return world;
}

const storedBodies = async (facilityId: string) =>
  (await prisma.notificationMessage.findMany({ where: { relatedId: facilityId }, select: { body: true } })).map(
    (message) => message.body,
  );

describe('a name typed on a phone', () => {
  const typed = 'St Mary’s Hospital – Annex…';

  it('goes out in the plain alphabet, so the curly apostrophe does not double the price', async () => {
    const world = await facilityNamed(typed, 25);

    await warnExpiringFacilityLicences(new Date());

    const [stored] = await storedBodies(world.facilityId);
    expect(stored).toContain("St Mary's Hospital - Annex...");
    expect(smsEncoding(stored!).encoding).toBe('GSM-7');
    expect(smsProblems(stored!)).toEqual([]);
  });

  it('is stored exactly as it was sent, so what support reads is what the phone received', async () => {
    const world = await facilityNamed(typed, -3);

    await announceLapsedFacilityLicences(new Date());

    const stored = await storedBodies(world.facilityId);
    expect(stored).toHaveLength(1);
    expect(gatewayBodies()).toEqual(stored);
  });

  it('is made plain whoever wrote the text, because it happens where every text is sent', async () => {
    const user = await createUser({ fullName: 'Amina Yusuf' });

    await notify({ userId: user.id, kind: 'test.plain', body: 'Hello from St Mary’s… ₦5,000 – paid.' });

    const [message] = await prisma.notificationMessage.findMany({ where: { userId: user.id } });
    expect(message?.body).toBe("Hello from St Mary's... NGN 5,000 - paid.");
    expect(gatewayBodies()).toEqual([message!.body]);
  });
});

describe('a hospital name as long as a real one', () => {
  const long = 'The Federal Medical Centre and Teaching Hospital of the Niger Delta Region, Specialist Annex Block';

  it('keeps the longest texts to three segments', async () => {
    expect(long.length).toBeGreaterThan(95);
    const warned = await facilityNamed(long, 25);
    await warnExpiringFacilityLicences(new Date());
    const lapsed = await facilityNamed(long, -3);
    await announceLapsedFacilityLicences(new Date());

    for (const body of [...(await storedBodies(warned.facilityId)), ...(await storedBodies(lapsed.facilityId))]) {
      expect(body).toContain(long);
      expect(smsProblems(body), body).toEqual([]);
      expect(smsEncoding(body).segments, body).toBeLessThanOrEqual(3);
    }
  });

  it('keeps the licence texts to three segments at the 200 characters the form allows', async () => {
    const warned = await facilityNamed('A'.repeat(200), 25);
    await warnExpiringFacilityLicences(new Date());

    const [body] = await storedBodies(warned.facilityId);
    expect(smsEncoding(body!).segments).toBeLessThanOrEqual(3);
  });
});
