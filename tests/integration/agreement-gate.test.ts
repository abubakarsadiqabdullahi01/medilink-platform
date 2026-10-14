import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', async () => {
  const { cookieJar } = await import('./support/cookie-jar');
  return { cookies: () => cookieJar };
});

import { prisma } from '@/lib/db';
import { ROLE_PERMISSIONS } from '@/lib/authz/permissions';
import {
  acceptAgreementAs,
  publishAgreement,
} from '@/modules/audit-compliance/application/consent';
import {
  invitePractitioners,
  respondToInvitation,
} from '@/modules/matching/application/assignment';
import {
  createServiceRequest,
  publishServiceRequest,
} from '@/modules/service-requests/application/request';
import { buildBookingWorld, eligiblePractitioner, type BookingWorld } from './support/booking-world';
import { clearCookies } from './support/cookie-jar';
import { createUser, grant } from './support/fixtures';

/**
 * UXP-04 and AUD-03. The engagement agreement was an optional line inside the
 * Privacy tab: nothing asked a practitioner to accept it before they accepted a
 * shift, a new version was not asked for again, and a hospital could publish
 * shifts having never accepted its terms. The fee cannot be made binding on
 * somebody who never accepted terms.
 *
 * What the agreements *say* is counsel's. These are about whether acceptance is
 * enforced once there is something to accept.
 */

beforeEach(() => {
  clearCookies();
});

let counter = 0;
async function publish(kind: 'PRACTITIONER_ENGAGEMENT' | 'FACILITY_TERMS' | 'PRIVACY_NOTICE', title = `Terms ${++counter}`) {
  const publisher = await createUser({ fullName: 'Compliance Officer' });
  return publishAgreement({
    kind,
    identifier: `${kind.toLowerCase()}-${++counter}`,
    title,
    body: 'The text of the agreement, long enough to be one. '.repeat(3),
    effectiveFrom: new Date(Date.now() - 60_000),
    actorId: publisher.id,
  });
}

async function offerTo(world: BookingWorld, userId: string) {
  const [invitation] = await invitePractitioners({
    requestId: world.requestId,
    facilityId: world.facilityId,
    userIds: [userId],
    actorId: world.schedulerId,
  });
  return invitation!;
}

describe('accepting a shift', () => {
  it('is possible when there is nothing published to accept', async () => {
    const world = await buildBookingWorld();
    const nurse = await eligiblePractitioner(world);
    const invitation = await offerTo(world, nurse.id);

    const answered = await respondToInvitation({ invitationId: invitation.id, userId: nurse.id, decision: 'accept' });
    expect(answered.status).toBe('ACCEPTED');
  });

  it('is refused until the engagement agreement in force has been accepted, and says which', async () => {
    const world = await buildBookingWorld();
    const nurse = await eligiblePractitioner(world);
    await publish('PRACTITIONER_ENGAGEMENT', 'Engagement terms v1');
    const invitation = await offerTo(world, nurse.id);

    await expect(
      respondToInvitation({ invitationId: invitation.id, userId: nurse.id, decision: 'accept' }),
    ).rejects.toMatchObject({ code: 'agreement_required', status: 409, message: expect.stringContaining('Engagement terms v1') });
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } })).status).toBe('INVITED');
  });

  it('is still possible to say no without having accepted anything', async () => {
    const world = await buildBookingWorld();
    const nurse = await eligiblePractitioner(world);
    await publish('PRACTITIONER_ENGAGEMENT');
    const invitation = await offerTo(world, nurse.id);

    const answered = await respondToInvitation({ invitationId: invitation.id, userId: nurse.id, decision: 'decline' });
    expect(answered.status).toBe('DECLINED');
  });

  it('goes ahead once it has been accepted', async () => {
    const world = await buildBookingWorld();
    const nurse = await eligiblePractitioner(world);
    const version = await publish('PRACTITIONER_ENGAGEMENT');
    await acceptAgreementAs('PRACTITIONER', { userId: nurse.id, versionId: version.id });
    const invitation = await offerTo(world, nurse.id);

    const answered = await respondToInvitation({ invitationId: invitation.id, userId: nurse.id, decision: 'accept' });
    expect(answered.status).toBe('ACCEPTED');
  });

  it('needs the privacy notice as well as the engagement terms', async () => {
    const world = await buildBookingWorld();
    const nurse = await eligiblePractitioner(world);
    const engagement = await publish('PRACTITIONER_ENGAGEMENT');
    await publish('PRIVACY_NOTICE', 'Privacy notice v1');
    await acceptAgreementAs('PRACTITIONER', { userId: nurse.id, versionId: engagement.id });
    const invitation = await offerTo(world, nurse.id);

    await expect(
      respondToInvitation({ invitationId: invitation.id, userId: nurse.id, decision: 'accept' }),
    ).rejects.toMatchObject({ code: 'agreement_required', message: expect.stringContaining('Privacy notice v1') });
  });

  it('asks again when a new version replaces the one they accepted', async () => {
    const world = await buildBookingWorld();
    const nurse = await eligiblePractitioner(world);
    const v1 = await publish('PRACTITIONER_ENGAGEMENT', 'Engagement terms v1');
    await acceptAgreementAs('PRACTITIONER', { userId: nurse.id, versionId: v1.id });
    await publish('PRACTITIONER_ENGAGEMENT', 'Engagement terms v2');
    const invitation = await offerTo(world, nurse.id);

    await expect(
      respondToInvitation({ invitationId: invitation.id, userId: nurse.id, decision: 'accept' }),
    ).rejects.toMatchObject({ code: 'agreement_required', message: expect.stringContaining('Engagement terms v2') });
  });

  it('is not held up by a version that has not yet taken effect', async () => {
    const world = await buildBookingWorld();
    const nurse = await eligiblePractitioner(world);
    const publisher = await createUser({ fullName: 'Compliance Officer' });
    await publishAgreement({
      kind: 'PRACTITIONER_ENGAGEMENT',
      identifier: 'future-terms',
      title: 'From next month',
      body: 'The text of the agreement, long enough to be one. '.repeat(3),
      effectiveFrom: new Date(Date.now() + 30 * 86_400_000),
      actorId: publisher.id,
    });
    const invitation = await offerTo(world, nurse.id);

    const answered = await respondToInvitation({ invitationId: invitation.id, userId: nurse.id, decision: 'accept' });
    expect(answered.status).toBe('ACCEPTED');
  });

  it('is not held up by the hospital\'s terms, which do not bind a practitioner', async () => {
    const world = await buildBookingWorld();
    const nurse = await eligiblePractitioner(world);
    await publish('FACILITY_TERMS');
    const invitation = await offerTo(world, nurse.id);

    const answered = await respondToInvitation({ invitationId: invitation.id, userId: nurse.id, decision: 'accept' });
    expect(answered.status).toBe('ACCEPTED');
  });
});

describe('publishing a shift', () => {
  async function draft(world: BookingWorld) {
    return createServiceRequest({
      facilityId: world.facilityId,
      professionalCategoryId: world.categoryId,
      shiftType: 'DAY',
      startsAt: new Date(Date.now() + 6 * 86_400_000),
      endsAt: new Date(Date.now() + 6 * 86_400_000 + 8 * 3_600_000),
      headcount: 1,
      hourlyRateKobo: 500_000,
      urgency: 'ROUTINE',
      cancellationTerms: 'Either party may cancel up to 24 hours before the shift.',
      actorId: world.schedulerId,
    });
  }

  async function owner(world: BookingWorld) {
    const facility = await prisma.facility.findUniqueOrThrow({ where: { id: world.facilityId } });
    return facility.representativeUserId;
  }

  it('is refused until somebody at the hospital has accepted its terms', async () => {
    const world = await buildBookingWorld();
    await publish('FACILITY_TERMS', 'Hospital terms v1');
    const request = await draft(world);

    await expect(
      publishServiceRequest({ requestId: request.id, facilityId: world.facilityId, actorId: world.schedulerId }),
    ).rejects.toMatchObject({ code: 'agreement_required', message: expect.stringContaining('Hospital terms v1') });
  });

  it('goes ahead when the hospital\'s owner has accepted, whoever then publishes', async () => {
    const world = await buildBookingWorld();
    const version = await publish('FACILITY_TERMS');
    await acceptAgreementAs('FACILITY', { userId: await owner(world), versionId: version.id });
    const request = await draft(world);

    const published = await publishServiceRequest({ requestId: request.id, facilityId: world.facilityId, actorId: world.schedulerId });
    expect(published.status).toBe('PUBLISHED');
  });

  it('is not satisfied by somebody who does not work for that hospital', async () => {
    const world = await buildBookingWorld();
    const other = await buildBookingWorld();
    const version = await publish('FACILITY_TERMS');
    await acceptAgreementAs('FACILITY', { userId: await owner(other), versionId: version.id });
    const request = await draft(world);

    await expect(
      publishServiceRequest({ requestId: request.id, facilityId: world.facilityId, actorId: world.schedulerId }),
    ).rejects.toMatchObject({ code: 'agreement_required' });
  });

  it('is satisfied by any member of staff who has accepted for the hospital', async () => {
    const world = await buildBookingWorld();
    const version = await publish('FACILITY_TERMS');
    const matron = await createUser({ fullName: 'Matron' });
    await grant({ userId: matron.id, roleKey: 'facility_administrator', permissions: ROLE_PERMISSIONS.facility_administrator ?? [], scopeType: 'FACILITY', scopeId: world.facilityId });
    await acceptAgreementAs('FACILITY', { userId: matron.id, versionId: version.id });
    const request = await draft(world);

    const published = await publishServiceRequest({ requestId: request.id, facilityId: world.facilityId, actorId: world.schedulerId });
    expect(published.status).toBe('PUBLISHED');
  });

  it('asks again when the terms change', async () => {
    const world = await buildBookingWorld();
    const v1 = await publish('FACILITY_TERMS', 'Hospital terms v1');
    await acceptAgreementAs('FACILITY', { userId: await owner(world), versionId: v1.id });
    await publish('FACILITY_TERMS', 'Hospital terms v2');
    const request = await draft(world);

    await expect(
      publishServiceRequest({ requestId: request.id, facilityId: world.facilityId, actorId: world.schedulerId }),
    ).rejects.toMatchObject({ code: 'agreement_required', message: expect.stringContaining('Hospital terms v2') });
  });
});
