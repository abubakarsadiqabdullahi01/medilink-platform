import { describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import {
  confirmAssignment,
  invitePractitioners,
  respondToInvitation,
} from '@/modules/matching/application/assignment';
import { recordConsent } from '@/modules/audit-compliance/application/consent';
import {
  buildBookingWorld,
  eligiblePractitioner,
  lapseRegistration,
  type BookingWorld,
} from './support/booking-world';
import { createProfessionalCategory } from './support/fixtures';
import { createProfile } from '@/modules/practitioners/application/profile';
import { createUser } from './support/fixtures';

/**
 * A booking is made hours or days after the match that suggested it, and the
 * world moves in between: a licence lapses, a facility is suspended, somebody
 * withdraws consent, the shift starts. Every step that creates or advances a
 * booking asks again; none of them trusts what was true at match time.
 *
 * Real eligibility throughout — see support/booking-world.ts for why.
 */

async function offer(world: BookingWorld, userId: string) {
  const [invitation] = await invitePractitioners({
    requestId: world.requestId,
    facilityId: world.facilityId,
    userIds: [userId],
    actorId: world.schedulerId,
  });
  return invitation!;
}

async function accepted(world: BookingWorld, userId: string) {
  const invitation = await offer(world, userId);
  await respondToInvitation({ invitationId: invitation.id, userId, decision: 'accept' });
  return invitation;
}

const confirm = (world: BookingWorld, userId: string) =>
  confirmAssignment({
    requestId: world.requestId,
    facilityId: world.facilityId,
    userId,
    actorId: world.schedulerId,
  });

describe('inviting', () => {
  it('offers a shift to somebody who is eligible, in the profession and consenting', async () => {
    const world = await buildBookingWorld();
    const nurse = await eligiblePractitioner(world);
    await expect(offer(world, nurse.id)).resolves.toMatchObject({ status: 'INVITED' });
  });

  it('refuses somebody whose registration lapsed after the match ran', async () => {
    const world = await buildBookingWorld();
    const nurse = await eligiblePractitioner(world);
    await lapseRegistration(nurse.id);

    await expect(offer(world, nurse.id)).rejects.toMatchObject({ code: 'practitioner_not_bookable' });
    expect(await prisma.invitation.count()).toBe(0);
  });

  it('refuses the whole batch, and says how many, rather than silently dropping a name', async () => {
    const world = await buildBookingWorld({ headcount: 2 });
    const fine = await eligiblePractitioner(world, 'Amina Yusuf');
    const lapsed = await eligiblePractitioner(world, 'Bisi Adeyemi');
    await lapseRegistration(lapsed.id);

    await expect(
      invitePractitioners({
        requestId: world.requestId,
        facilityId: world.facilityId,
        userIds: [fine.id, lapsed.id],
        actorId: world.schedulerId,
      }),
    ).rejects.toMatchObject({ code: 'practitioner_not_bookable', message: expect.stringContaining('One of') });
    expect(await prisma.invitation.count()).toBe(0);
  });

  it('refuses somebody in another profession, whatever the match said', async () => {
    const world = await buildBookingWorld();
    const otherCategory = await createProfessionalCategory({ regulator: 'MDCN' });
    const stranger = await createUser({ fullName: 'Chidi Okeke' });
    await createProfile({
      userId: stranger.id,
      professionalCategoryId: otherCategory.id,
      yearsOfExperience: 3,
    });

    await expect(offer(world, stranger.id)).rejects.toMatchObject({ code: 'practitioner_not_bookable' });
  });

  it('refuses somebody who has withdrawn consent to be shown to facilities', async () => {
    const world = await buildBookingWorld();
    const nurse = await eligiblePractitioner(world);
    await recordConsent({
      userId: nurse.id,
      purpose: 'PROFILE_VISIBILITY',
      granted: false,
      note: 'I would rather not be offered shifts.',
      actorId: nurse.id,
    });

    await expect(offer(world, nurse.id)).rejects.toMatchObject({ code: 'practitioner_not_bookable' });
  });

  it('refuses everything once the facility is no longer verified', async () => {
    const world = await buildBookingWorld();
    const nurse = await eligiblePractitioner(world);
    await prisma.facility.update({ where: { id: world.facilityId }, data: { status: 'SUSPENDED' } });

    await expect(offer(world, nurse.id)).rejects.toMatchObject({ code: 'facility_not_verified' });
  });

  it('refuses a shift that has already started', async () => {
    const world = await buildBookingWorld();
    const nurse = await eligiblePractitioner(world);
    await prisma.serviceRequest.update({
      where: { id: world.requestId },
      data: { startsAt: new Date(Date.now() - 60 * 60 * 1000), endsAt: new Date(Date.now() + 60 * 60 * 1000) },
    });

    await expect(offer(world, nurse.id)).rejects.toMatchObject({ code: 'shift_started' });
  });
});

describe('accepting', () => {
  it('lets a practitioner whose registration has since lapsed decline, but not accept', async () => {
    const world = await buildBookingWorld();
    const nurse = await eligiblePractitioner(world);
    const invitation = await offer(world, nurse.id);
    await lapseRegistration(nurse.id);

    await expect(
      respondToInvitation({ invitationId: invitation.id, userId: nurse.id, decision: 'accept' }),
    ).rejects.toMatchObject({ code: 'cannot_accept' });

    // Still open, so they can answer properly.
    await expect(
      respondToInvitation({
        invitationId: invitation.id,
        userId: nurse.id,
        decision: 'decline',
        reason: 'My registration needs renewing first.',
      }),
    ).resolves.toMatchObject({ status: 'DECLINED' });
  });

  it('refuses an acceptance after the shift has started', async () => {
    const world = await buildBookingWorld();
    const nurse = await eligiblePractitioner(world);
    const invitation = await offer(world, nurse.id);
    await prisma.serviceRequest.update({
      where: { id: world.requestId },
      data: { startsAt: new Date(Date.now() - 60 * 60 * 1000), endsAt: new Date(Date.now() + 60 * 60 * 1000) },
    });

    await expect(
      respondToInvitation({ invitationId: invitation.id, userId: nurse.id, decision: 'accept' }),
    ).rejects.toMatchObject({ code: 'shift_started' });
  });
});

describe('confirming', () => {
  it('refuses somebody whose registration lapsed between accepting and being confirmed', async () => {
    const world = await buildBookingWorld();
    const nurse = await eligiblePractitioner(world);
    await accepted(world, nurse.id);
    await lapseRegistration(nurse.id);

    await expect(confirm(world, nurse.id)).rejects.toMatchObject({
      code: 'cannot_confirm',
      message: expect.stringContaining('practitioner_not_bookable'),
    });
    expect(await prisma.assignment.count()).toBe(0);
  });

  it('refuses when the facility was suspended after the offer went out', async () => {
    const world = await buildBookingWorld();
    const nurse = await eligiblePractitioner(world);
    await accepted(world, nurse.id);
    await prisma.facility.update({ where: { id: world.facilityId }, data: { status: 'SUSPENDED' } });

    await expect(confirm(world, nurse.id)).rejects.toMatchObject({
      code: 'cannot_confirm',
      message: expect.stringContaining('facility_not_verified'),
    });
  });

  it('refuses once the shift has started', async () => {
    const world = await buildBookingWorld();
    const nurse = await eligiblePractitioner(world);
    await accepted(world, nurse.id);
    await prisma.serviceRequest.update({
      where: { id: world.requestId },
      data: { startsAt: new Date(Date.now() - 60 * 60 * 1000), endsAt: new Date(Date.now() + 60 * 60 * 1000) },
    });

    await expect(confirm(world, nurse.id)).rejects.toMatchObject({
      code: 'cannot_confirm',
      message: expect.stringContaining('shift_started'),
    });
  });

  it('confirms somebody who is still eligible, as before', async () => {
    const world = await buildBookingWorld();
    const nurse = await eligiblePractitioner(world);
    await accepted(world, nurse.id);

    await expect(confirm(world, nurse.id)).resolves.toMatchObject({ status: 'CONFIRMED' });
  });
});

describe('two people confirmed onto the same shift at the same moment', () => {
  /**
   * The practitioner lock stops one person being double-booked. It does nothing
   * for the *request*: two different practitioners hold two different locks, so
   * both could read "none filled yet" and both be confirmed.
   */
  it('fills the last place exactly once', async () => {
    const world = await buildBookingWorld({ headcount: 1 });
    const first = await eligiblePractitioner(world, 'Amina Yusuf');
    const second = await eligiblePractitioner(world, 'Bisi Adeyemi');
    await accepted(world, first.id);
    await accepted(world, second.id);

    const results = await Promise.allSettled([confirm(world, first.id), confirm(world, second.id)]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const refused = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(refused.reason).toMatchObject({ code: 'cannot_confirm' });
    expect(await prisma.assignment.count({ where: { status: 'CONFIRMED' } })).toBe(1);
  });

  it('marks a shift of two as filled when two people are confirmed together', async () => {
    // Each confirmation used to see "one short of full", so a full roster stayed
    // PUBLISHED and the expiry sweep later marked it EXPIRED.
    const world = await buildBookingWorld({ headcount: 2 });
    const first = await eligiblePractitioner(world, 'Amina Yusuf');
    const second = await eligiblePractitioner(world, 'Bisi Adeyemi');
    await accepted(world, first.id);
    await accepted(world, second.id);

    const results = await Promise.allSettled([confirm(world, first.id), confirm(world, second.id)]);

    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    const request = await prisma.serviceRequest.findUniqueOrThrow({ where: { id: world.requestId } });
    expect(request.status).toBe('FILLED');
    expect(await prisma.assignment.count({ where: { status: 'CONFIRMED' } })).toBe(2);
  });
});
