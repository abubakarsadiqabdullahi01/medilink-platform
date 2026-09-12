import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', async () => {
  const { cookieJar } = await import('./support/cookie-jar');
  return { cookies: () => cookieJar };
});

import { prisma } from '@/lib/db';
import { EVENTS } from '@/lib/events';
import { ROLE_PERMISSIONS } from '@/lib/authz/permissions';
import { createFacility, verifyFacility } from '@/modules/facilities/application/facility';
import {
  createServiceRequest,
  publishServiceRequest,
} from '@/modules/service-requests/application/request';
import {
  assignmentHistory,
  cancelAssignment,
  confirmAssignment,
  invitePractitioners,
  listAssignments,
  respondToInvitation,
} from '@/modules/matching/application/assignment';
import { notifyAssignmentConfirmed } from '@/modules/notifications/application/handlers';
import { expireStartedRequests } from '@/modules/service-requests/application/expiry';
import { runOnce } from '@/worker/processor';
import { handlers } from '@/worker/handlers';
import { clearCookies } from './support/cookie-jar';
import {
  createFacilityType,
  createProfessionalCategory,
  createState,
  createUser,
  ensureRole,
  grant,
} from './support/fixtures';

/**
 * Steps 6.5, 6.6 and 6.7 — invitation, confirmation, conflict.
 *
 * The Stage 6 gate asks for four things, and three of them are here: a
 * request reaching a confirmed assignment with no manual database
 * intervention, every status change carrying an actor and a reason, and two
 * overlapping confirmations producing exactly one assignment.
 */

const SHIFT_START = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
const SHIFT_END = new Date(SHIFT_START.getTime() + 8 * 60 * 60 * 1000);

let sequence = 0;

interface World {
  facilityId: string;
  representativeId: string;
  schedulerId: string;
  categoryId: string;
  requestId: string;
}

async function buildWorld(headcount = 1, shift = { startsAt: SHIFT_START, endsAt: SHIFT_END }) {
  await ensureRole('facility_owner', ROLE_PERMISSIONS.facility_owner ?? []);

  const state = await createState();
  const facilityType = await createFacilityType();
  const representative = await createUser({ fullName: 'Facility Representative' });
  const ops = await createUser({ fullName: 'Operations Officer' });
  const officer = await createUser({ fullName: 'Compliance Officer' });

  sequence += 1;
  const facility = await createFacility({
    name: 'Owerri General Hospital',
    facilityTypeId: facilityType.id,
    cacNumber: `RC${600_000 + sequence}`,
    stateId: state.id,
    addressLine: '14 Wetheral Road, Owerri',
    contactPhone: '+2348031234567',
    representativeUserId: representative.id,
    actorId: ops.id,
  });
  await verifyFacility({ facilityId: facility.id, verifierId: officer.id, decision: 'approve' });

  const category = await createProfessionalCategory();
  const scheduler = await createUser({ fullName: 'Facility Scheduler' });
  await grant({
    userId: scheduler.id,
    roleKey: 'facility_scheduler',
    permissions: ['service_request.read', 'service_request.publish', 'assignment.confirm'],
    scopeType: 'FACILITY',
    scopeId: facility.id,
  });

  const request = await createServiceRequest({
    facilityId: facility.id,
    professionalCategoryId: category.id,
    shiftType: 'DAY',
    startsAt: shift.startsAt,
    endsAt: shift.endsAt,
    headcount,
    hourlyRateKobo: 500_000,
    urgency: 'ROUTINE',
    cancellationTerms: 'Either party may cancel up to 24 hours before the shift.',
    actorId: scheduler.id,
  });
  await publishServiceRequest({
    requestId: request.id,
    facilityId: facility.id,
    actorId: scheduler.id,
  });

  return {
    facilityId: facility.id,
    representativeId: representative.id,
    schedulerId: scheduler.id,
    categoryId: category.id,
    requestId: request.id,
  } satisfies World;
}

async function practitioner(name = 'Amina Yusuf') {
  return createUser({ fullName: name });
}

/** Invite, accept — the state a confirmation needs. */
async function acceptedInvitation(world: World, userId: string) {
  const [invitation] = await invitePractitioners({
    requestId: world.requestId,
    facilityId: world.facilityId,
    userIds: [userId],
    actorId: world.schedulerId,
  });
  await respondToInvitation({
    invitationId: invitation!.id,
    userId,
    decision: 'accept',
  });
  return invitation!;
}

beforeEach(() => {
  clearCookies();
});

describe('the gate: a request reaches a confirmed assignment', () => {
  it('goes from published to confirmed with no manual database intervention', async () => {
    const world = await buildWorld();
    const user = await practitioner();

    const invitation = await acceptedInvitation(world, user.id);
    expect(invitation.status).toBe('INVITED');

    const assignment = await confirmAssignment({
      requestId: world.requestId,
      facilityId: world.facilityId,
      userId: user.id,
      actorId: world.schedulerId,
    });

    expect(assignment.status).toBe('CONFIRMED');
    expect(assignment.startsAt.toISOString()).toBe(SHIFT_START.toISOString());

    // The last confirmation closes the request.
    const request = await prisma.serviceRequest.findUniqueOrThrow({
      where: { id: world.requestId },
    });
    expect(request.status).toBe('FILLED');
  });

  it('keeps a multi-place request open until the headcount is met', async () => {
    const world = await buildWorld(2);
    const first = await practitioner('First Practitioner');
    const second = await practitioner('Second Practitioner');

    await acceptedInvitation(world, first.id);
    await confirmAssignment({
      requestId: world.requestId,
      facilityId: world.facilityId,
      userId: first.id,
      actorId: world.schedulerId,
    });

    expect(
      (await prisma.serviceRequest.findUniqueOrThrow({ where: { id: world.requestId } })).status,
    ).toBe('PUBLISHED');

    await acceptedInvitation(world, second.id);
    await confirmAssignment({
      requestId: world.requestId,
      facilityId: world.facilityId,
      userId: second.id,
      actorId: world.schedulerId,
    });

    expect(
      (await prisma.serviceRequest.findUniqueOrThrow({ where: { id: world.requestId } })).status,
    ).toBe('FILLED');
  });

  it('refuses to confirm somebody who never accepted', async () => {
    const world = await buildWorld();
    const user = await practitioner();
    await invitePractitioners({
      requestId: world.requestId,
      facilityId: world.facilityId,
      userIds: [user.id],
      actorId: world.schedulerId,
    });

    // A facility cannot confirm somebody who never said yes.
    await expect(
      confirmAssignment({
        requestId: world.requestId,
        facilityId: world.facilityId,
        userId: user.id,
        actorId: world.schedulerId,
      }),
    ).rejects.toThrow(/invitation_not_accepted/);
  });

  it('refuses once the headcount is met', async () => {
    const world = await buildWorld(1);
    const first = await practitioner('First');
    const second = await practitioner('Second');
    await acceptedInvitation(world, first.id);
    await acceptedInvitation(world, second.id);

    await confirmAssignment({
      requestId: world.requestId,
      facilityId: world.facilityId,
      userId: first.id,
      actorId: world.schedulerId,
    });

    await expect(
      confirmAssignment({
        requestId: world.requestId,
        facilityId: world.facilityId,
        userId: second.id,
        actorId: world.schedulerId,
      }),
    ).rejects.toThrow(/request_full/);
  });
});

describe('step 6.7 — overlaps are prevented, not warned about', () => {
  it('refuses a second assignment that clashes with one already confirmed', async () => {
    const first = await buildWorld();
    const user = await practitioner();
    await acceptedInvitation(first, user.id);
    await confirmAssignment({
      requestId: first.requestId,
      facilityId: first.facilityId,
      userId: user.id,
      actorId: first.schedulerId,
    });

    // A different facility, overlapping the same hours.
    const second = await buildWorld(1, {
      startsAt: new Date(SHIFT_START.getTime() + 60 * 60 * 1000),
      endsAt: new Date(SHIFT_END.getTime() + 60 * 60 * 1000),
    });
    await acceptedInvitation(second, user.id);

    await expect(
      confirmAssignment({
        requestId: second.requestId,
        facilityId: second.facilityId,
        userId: user.id,
        actorId: second.schedulerId,
      }),
    ).rejects.toThrow(/conflicting_assignment/);
  });

  it('allows a back-to-back shift, which is a fatigue question not a clash', async () => {
    const first = await buildWorld();
    const user = await practitioner();
    await acceptedInvitation(first, user.id);
    await confirmAssignment({
      requestId: first.requestId,
      facilityId: first.facilityId,
      userId: user.id,
      actorId: first.schedulerId,
    });

    const second = await buildWorld(1, {
      startsAt: SHIFT_END,
      endsAt: new Date(SHIFT_END.getTime() + 8 * 60 * 60 * 1000),
    });
    await acceptedInvitation(second, user.id);

    const assignment = await confirmAssignment({
      requestId: second.requestId,
      facilityId: second.facilityId,
      userId: user.id,
      actorId: second.schedulerId,
    });
    expect(assignment.status).toBe('CONFIRMED');
  });

  it('produces exactly one assignment when two overlapping confirmations race', async () => {
    const first = await buildWorld();
    const second = await buildWorld(1, {
      startsAt: new Date(SHIFT_START.getTime() + 60 * 60 * 1000),
      endsAt: new Date(SHIFT_END.getTime() + 60 * 60 * 1000),
    });
    const user = await practitioner();
    await acceptedInvitation(first, user.id);
    await acceptedInvitation(second, user.id);

    // Step 6.7's stated verification: "confirm two overlapping assignments
    // concurrently, assert exactly one succeeds". A check-then-insert without
    // the advisory lock races and writes both.
    const results = await Promise.allSettled([
      confirmAssignment({
        requestId: first.requestId,
        facilityId: first.facilityId,
        userId: user.id,
        actorId: first.schedulerId,
      }),
      confirmAssignment({
        requestId: second.requestId,
        facilityId: second.facilityId,
        userId: user.id,
        actorId: second.schedulerId,
      }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);

    const confirmed = await prisma.assignment.count({
      where: { userId: user.id, status: 'CONFIRMED' },
    });
    expect(confirmed).toBe(1);
  });

  it('does not make one practitioner wait on another', async () => {
    const world = await buildWorld(2);
    const one = await practitioner('One');
    const two = await practitioner('Two');
    await acceptedInvitation(world, one.id);
    await acceptedInvitation(world, two.id);

    // The lock is keyed on the practitioner, so different people never
    // serialise against each other.
    const results = await Promise.all([
      confirmAssignment({
        requestId: world.requestId,
        facilityId: world.facilityId,
        userId: one.id,
        actorId: world.schedulerId,
      }),
      confirmAssignment({
        requestId: world.requestId,
        facilityId: world.facilityId,
        userId: two.id,
        actorId: world.schedulerId,
      }),
    ]);

    expect(results.map((assignment) => assignment.status)).toEqual(['CONFIRMED', 'CONFIRMED']);
  });
});

describe('step 6.6 — every status change records actor and reason', () => {
  it('writes a history row on confirmation', async () => {
    const world = await buildWorld();
    const user = await practitioner();
    await acceptedInvitation(world, user.id);
    const assignment = await confirmAssignment({
      requestId: world.requestId,
      facilityId: world.facilityId,
      userId: user.id,
      actorId: world.schedulerId,
    });

    const history = await assignmentHistory(assignment.id);

    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      fromStatus: null,
      toStatus: 'CONFIRMED',
      actorId: world.schedulerId,
    });
    expect(history[0]?.reason.length).toBeGreaterThan(0);
  });

  it('writes another on cancellation, with the reason given', async () => {
    const world = await buildWorld();
    const user = await practitioner();
    await acceptedInvitation(world, user.id);
    const assignment = await confirmAssignment({
      requestId: world.requestId,
      facilityId: world.facilityId,
      userId: user.id,
      actorId: world.schedulerId,
    });

    await cancelAssignment({
      assignmentId: assignment.id,
      facilityId: world.facilityId,
      actorId: world.schedulerId,
      reason: 'The ward closed for refurbishment.',
    });

    const history = await assignmentHistory(assignment.id);
    expect(history).toHaveLength(2);
    expect(history[1]).toMatchObject({ fromStatus: 'CONFIRMED', toStatus: 'CANCELLED' });
    expect(history[1]?.reason).toContain('refurbishment');
  });

  it('reopens the request when a confirmed assignment is cancelled', async () => {
    const world = await buildWorld(1);
    const user = await practitioner();
    await acceptedInvitation(world, user.id);
    const assignment = await confirmAssignment({
      requestId: world.requestId,
      facilityId: world.facilityId,
      userId: user.id,
      actorId: world.schedulerId,
    });

    await cancelAssignment({
      assignmentId: assignment.id,
      facilityId: world.facilityId,
      actorId: world.schedulerId,
      reason: 'Practitioner withdrew.',
    });

    // Cancelling frees a place, so the shift needs filling again.
    expect(
      (await prisma.serviceRequest.findUniqueOrThrow({ where: { id: world.requestId } })).status,
    ).toBe('PUBLISHED');
  });

  it('frees the practitioner to take a clashing shift after cancellation', async () => {
    const first = await buildWorld();
    const user = await practitioner();
    await acceptedInvitation(first, user.id);
    const assignment = await confirmAssignment({
      requestId: first.requestId,
      facilityId: first.facilityId,
      userId: user.id,
      actorId: first.schedulerId,
    });
    await cancelAssignment({
      assignmentId: assignment.id,
      facilityId: first.facilityId,
      actorId: first.schedulerId,
      reason: 'Shift withdrawn.',
    });

    const second = await buildWorld();
    await acceptedInvitation(second, user.id);

    // The conflict check counts only CONFIRMED assignments.
    const replacement = await confirmAssignment({
      requestId: second.requestId,
      facilityId: second.facilityId,
      userId: user.id,
      actorId: second.schedulerId,
    });
    expect(replacement.status).toBe('CONFIRMED');
  });
});

describe('invitations', () => {
  it('records a decline with its reason and publishes no acceptance', async () => {
    const world = await buildWorld();
    const user = await practitioner();
    const [invitation] = await invitePractitioners({
      requestId: world.requestId,
      facilityId: world.facilityId,
      userIds: [user.id],
      actorId: world.schedulerId,
    });

    const declined = await respondToInvitation({
      invitationId: invitation!.id,
      userId: user.id,
      decision: 'decline',
      reason: 'Already working elsewhere that night.',
    });

    expect(declined.status).toBe('DECLINED');
    expect(declined.declineReason).toContain('elsewhere');
    expect(
      await prisma.outboxEvent.count({ where: { eventType: EVENTS.ShiftAccepted } }),
    ).toBe(0);
  });

  it('refuses a second response to the same invitation', async () => {
    const world = await buildWorld();
    const user = await practitioner();
    const [invitation] = await invitePractitioners({
      requestId: world.requestId,
      facilityId: world.facilityId,
      userIds: [user.id],
      actorId: world.schedulerId,
    });
    await respondToInvitation({ invitationId: invitation!.id, userId: user.id, decision: 'accept' });

    await expect(
      respondToInvitation({
        invitationId: invitation!.id,
        userId: user.id,
        decision: 'decline',
        reason: 'Changed my mind.',
      }),
    ).rejects.toThrow(/no longer open/);
  });

  it("refuses to answer somebody else's invitation, as a 404", async () => {
    const world = await buildWorld();
    const user = await practitioner();
    const other = await practitioner('Somebody Else');
    const [invitation] = await invitePractitioners({
      requestId: world.requestId,
      facilityId: world.facilityId,
      userIds: [user.id],
      actorId: world.schedulerId,
    });

    await expect(
      respondToInvitation({ invitationId: invitation!.id, userId: other.id, decision: 'accept' }),
    ).rejects.toThrow(/does not exist/);
  });

  it('is idempotent when a facility invites the same person twice', async () => {
    const world = await buildWorld();
    const user = await practitioner();

    await invitePractitioners({
      requestId: world.requestId,
      facilityId: world.facilityId,
      userIds: [user.id],
      actorId: world.schedulerId,
    });
    // Clicking twice should not fail.
    const again = await invitePractitioners({
      requestId: world.requestId,
      facilityId: world.facilityId,
      userIds: [user.id],
      actorId: world.schedulerId,
    });

    expect(again).toHaveLength(1);
    expect(await prisma.invitation.count({ where: { userId: user.id } })).toBe(1);
  });
});

describe('step 6.5 — both parties notified on confirm', () => {
  it('sends and records a message to the practitioner and the facility', async () => {
    const world = await buildWorld();
    const user = await practitioner();
    await acceptedInvitation(world, user.id);
    const assignment = await confirmAssignment({
      requestId: world.requestId,
      facilityId: world.facilityId,
      userId: user.id,
      actorId: world.schedulerId,
    });

    // Through the outbox, as the worker would.
    const pass = await runOnce({ handlers });
    expect(pass.processed).toBeGreaterThan(0);

    const messages = await prisma.notificationMessage.findMany({
      where: { relatedId: assignment.id },
    });

    expect(messages).toHaveLength(2);
    expect(messages.map((message) => message.userId).sort()).toEqual(
      [user.id, world.representativeId].sort(),
    );
    // Masked, never the full number.
    expect(messages.every((message) => message.recipient.includes('*'))).toBe(true);
    expect(messages.every((message) => message.sentAt !== null)).toBe(true);
  });

  it('does not send twice when the outbox retries', async () => {
    const world = await buildWorld();
    const user = await practitioner();
    await acceptedInvitation(world, user.id);
    const assignment = await confirmAssignment({
      requestId: world.requestId,
      facilityId: world.facilityId,
      userId: user.id,
      actorId: world.schedulerId,
    });

    const payload = {
      assignmentId: assignment.id,
      userId: user.id,
      facilityId: world.facilityId,
    };
    // The outbox delivers at least once; a retry must not send a second time.
    await notifyAssignmentConfirmed(payload);
    await notifyAssignmentConfirmed(payload);

    expect(await prisma.notificationMessage.count({ where: { relatedId: assignment.id } })).toBe(2);
  });
});

describe('the expiry sweep', () => {
  it('closes a request whose shift has started and withdraws open invitations', async () => {
    const world = await buildWorld();
    const user = await practitioner();
    await invitePractitioners({
      requestId: world.requestId,
      facilityId: world.facilityId,
      userIds: [user.id],
      actorId: world.schedulerId,
    });

    // The shift is a fortnight out; sweeping as though it were a month later.
    const result = await expireStartedRequests(new Date(SHIFT_END.getTime() + 60 * 60 * 1000));

    expect(result).toMatchObject({ expired: 1, invitationsWithdrawn: 1 });
    expect(
      (await prisma.serviceRequest.findUniqueOrThrow({ where: { id: world.requestId } })).status,
    ).toBe('EXPIRED');

    // A practitioner should not be able to accept a shift that has begun.
    const invitation = await prisma.invitation.findFirstOrThrow({ where: { userId: user.id } });
    expect(invitation.status).toBe('WITHDRAWN');
  });

  it('leaves a filled request alone', async () => {
    const world = await buildWorld();
    const user = await practitioner();
    await acceptedInvitation(world, user.id);
    await confirmAssignment({
      requestId: world.requestId,
      facilityId: world.facilityId,
      userId: user.id,
      actorId: world.schedulerId,
    });

    const result = await expireStartedRequests(new Date(SHIFT_END.getTime() + 60 * 60 * 1000));

    // Only PUBLISHED requests expire; a filled one already found its people.
    expect(result.expired).toBe(0);
    expect(
      (await prisma.serviceRequest.findUniqueOrThrow({ where: { id: world.requestId } })).status,
    ).toBe('FILLED');
  });

  it('leaves a future shift alone', async () => {
    await buildWorld();
    expect((await expireStartedRequests()).expired).toBe(0);
  });
});

describe('the schedule list', () => {
  it('shows a practitioner their own confirmed shifts', async () => {
    const world = await buildWorld();
    const user = await practitioner();
    await acceptedInvitation(world, user.id);
    await confirmAssignment({
      requestId: world.requestId,
      facilityId: world.facilityId,
      userId: user.id,
      actorId: world.schedulerId,
    });

    const mine = await listAssignments({ scopeType: 'SELF', scopeId: user.id });
    expect(mine).toHaveLength(1);

    const theirs = await listAssignments({ scopeType: 'FACILITY', scopeId: world.facilityId });
    expect(theirs).toHaveLength(1);
  });
});
