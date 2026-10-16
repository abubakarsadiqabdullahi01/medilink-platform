import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/modules/practitioners/application/bookable', () => import('./support/always-bookable'));

vi.mock('next/headers', async () => {
  const { cookieJar } = await import('./support/cookie-jar');
  return { cookies: () => cookieJar };
});

import { prisma } from '@/lib/db';
import { EVENTS } from '@/lib/events';
import { ROLE_PERMISSIONS } from '@/lib/authz/permissions';
import { createFacility, verifyFacility } from '@/modules/facilities/application/facility';
import {
  cancelServiceRequest,
  createServiceRequest,
  publishServiceRequest,
} from '@/modules/service-requests/application/request';
import {
  assignmentHistory,
  cancelAssignment,
  confirmAssignment,
  invitePractitioners,
  listAssignments,
  listInvitationsFor,
  listInvitationsForRequest,
  respondToInvitation,
} from '@/modules/matching/application/assignment';
import { GET as requestInvitationsRoute } from '@/app/api/v1/service-requests/[id]/invitations/route';
import { GET as listAssignmentsRoute } from '@/app/api/v1/assignments/route';
import { issueSession } from '@/modules/auth/application/session-service';
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

describe('offers that will not become an assignment', () => {
  async function statusesOn(requestId: string): Promise<Record<string, string>> {
    const rows = await prisma.invitation.findMany({ where: { serviceRequestId: requestId } });
    return Object.fromEntries(rows.map((row) => [row.userId, row.status]));
  }

  it('withdraws every unconfirmed offer when the last place is filled', async () => {
    const world = await buildWorld(1);
    const chosen = await practitioner('Chosen Practitioner');
    const alsoAccepted = await practitioner('Also Accepted');
    const neverAnswered = await practitioner('Never Answered');

    await acceptedInvitation(world, chosen.id);
    await acceptedInvitation(world, alsoAccepted.id);
    const [unanswered] = await invitePractitioners({
      requestId: world.requestId,
      facilityId: world.facilityId,
      userIds: [neverAnswered.id],
      actorId: world.schedulerId,
    });

    await confirmAssignment({
      requestId: world.requestId,
      facilityId: world.facilityId,
      userId: chosen.id,
      actorId: world.schedulerId,
    });

    // The confirmed practitioner keeps the record of how they got the place;
    // the one who accepted and the one who never answered are both told no.
    expect(await statusesOn(world.requestId)).toEqual({
      [chosen.id]: 'ACCEPTED',
      [alsoAccepted.id]: 'WITHDRAWN',
      [neverAnswered.id]: 'WITHDRAWN',
    });
    await expect(
      respondToInvitation({ invitationId: unanswered!.id, userId: neverAnswered.id, decision: 'accept' }),
    ).rejects.toThrow(/no longer open/);
    expect((await listInvitationsFor(neverAnswered.id))[0]?.status).toBe('WITHDRAWN');
  });

  it('leaves offers open while places remain', async () => {
    const world = await buildWorld(2);
    const first = await practitioner('First Practitioner');
    const waiting = await practitioner('Still Deciding');

    await acceptedInvitation(world, first.id);
    await invitePractitioners({
      requestId: world.requestId,
      facilityId: world.facilityId,
      userIds: [waiting.id],
      actorId: world.schedulerId,
    });
    await confirmAssignment({
      requestId: world.requestId,
      facilityId: world.facilityId,
      userId: first.id,
      actorId: world.schedulerId,
    });

    expect((await statusesOn(world.requestId))[waiting.id]).toBe('INVITED');
  });

  it('offers the shift again to somebody it was withdrawn from when it reopens', async () => {
    const world = await buildWorld(1);
    const chosen = await practitioner('Chosen Practitioner');
    const next = await practitioner('Next In Line');

    await acceptedInvitation(world, chosen.id);
    const [original] = await invitePractitioners({
      requestId: world.requestId,
      facilityId: world.facilityId,
      userIds: [next.id],
      actorId: world.schedulerId,
    });
    const assignment = await confirmAssignment({
      requestId: world.requestId,
      facilityId: world.facilityId,
      userId: chosen.id,
      actorId: world.schedulerId,
    });
    await cancelAssignment({
      assignmentId: assignment.id,
      facilityId: world.facilityId,
      actorId: world.schedulerId,
      reason: 'Practitioner called in sick.',
    });

    // Asking again reaches them, rather than returning the withdrawn row.
    const [again] = await invitePractitioners({
      requestId: world.requestId,
      facilityId: world.facilityId,
      userIds: [next.id],
      actorId: world.schedulerId,
    });
    expect(again).toMatchObject({ id: original!.id, status: 'INVITED', respondedAt: null });
    expect(again!.expiresAt.getTime()).toBeGreaterThan(Date.now());

    await respondToInvitation({ invitationId: again!.id, userId: next.id, decision: 'accept' });
    const covered = await confirmAssignment({
      requestId: world.requestId,
      facilityId: world.facilityId,
      userId: next.id,
      actorId: world.schedulerId,
    });
    expect(covered.status).toBe('CONFIRMED');
  });

  it('leaves a declined offer as the practitioner left it', async () => {
    const world = await buildWorld(1);
    const user = await practitioner();
    const [invitation] = await invitePractitioners({
      requestId: world.requestId,
      facilityId: world.facilityId,
      userIds: [user.id],
      actorId: world.schedulerId,
    });
    await respondToInvitation({
      invitationId: invitation!.id,
      userId: user.id,
      decision: 'decline',
      reason: 'Already on nights that week.',
    });

    // Declining was their answer; asking again does not overwrite it.
    const [again] = await invitePractitioners({
      requestId: world.requestId,
      facilityId: world.facilityId,
      userIds: [user.id],
      actorId: world.schedulerId,
    });
    expect(again).toMatchObject({ status: 'DECLINED', declineReason: 'Already on nights that week.' });
  });

  it('withdraws every offer when the facility cancels the shift', async () => {
    const world = await buildWorld(2);
    const accepted = await practitioner('Accepted Practitioner');
    const invited = await practitioner('Invited Practitioner');

    await acceptedInvitation(world, accepted.id);
    await invitePractitioners({
      requestId: world.requestId,
      facilityId: world.facilityId,
      userIds: [invited.id],
      actorId: world.schedulerId,
    });

    await cancelServiceRequest({
      requestId: world.requestId,
      facilityId: world.facilityId,
      actorId: world.schedulerId,
      reason: 'Ward closed for fumigation.',
    });

    expect(await statusesOn(world.requestId)).toEqual({
      [accepted.id]: 'WITHDRAWN',
      [invited.id]: 'WITHDRAWN',
    });
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

  it('withdraws an accepted offer the facility never confirmed', async () => {
    const world = await buildWorld();
    const user = await practitioner();
    await acceptedInvitation(world, user.id);

    const result = await expireStartedRequests(new Date(SHIFT_END.getTime() + 60 * 60 * 1000));

    // Accepted is not confirmed; the shift has gone and they should know it.
    expect(result).toMatchObject({ expired: 1, invitationsWithdrawn: 1 });
    const invitation = await prisma.invitation.findFirstOrThrow({ where: { userId: user.id } });
    expect(invitation.status).toBe('WITHDRAWN');
  });

  it('keeps the accepted offer of somebody whose assignment was later cancelled', async () => {
    const world = await buildWorld();
    const user = await practitioner();
    await acceptedInvitation(world, user.id);
    const assignment = await confirmAssignment({
      requestId: world.requestId,
      facilityId: world.facilityId,
      userId: user.id,
      actorId: world.schedulerId,
    });
    // Cancelled, so the request reopens — and then nobody covers it.
    await cancelAssignment({
      assignmentId: assignment.id,
      facilityId: world.facilityId,
      actorId: world.schedulerId,
      reason: 'Practitioner called in sick.',
    });

    const result = await expireStartedRequests(new Date(SHIFT_END.getTime() + 60 * 60 * 1000));

    // Their offer did become an assignment; expiry must not rewrite that.
    expect(result).toMatchObject({ expired: 1, invitationsWithdrawn: 0 });
    const invitation = await prisma.invitation.findFirstOrThrow({ where: { userId: user.id } });
    expect(invitation.status).toBe('ACCEPTED');
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
    expect(mine.assignments).toHaveLength(1);

    const theirs = await listAssignments({ scopeType: 'FACILITY', scopeId: world.facilityId });
    expect(theirs.assignments).toHaveLength(1);
    expect(theirs.assignments[0]?.practitionerName).toBe(user.fullName);
  });

  it("gives a facility a practitioner's phone only around the shift, never weeks ahead", async () => {
    /**
     * Once somebody is booked the ward needs to reach them — but only around the
     * shift. A roster that shows every number permanently turns the platform into
     * a staff directory that nobody has to come back to.
     */
    const confirm = async (world: Awaited<ReturnType<typeof buildWorld>>, userId: string) => {
      await acceptedInvitation(world, userId);
      await confirmAssignment({
        requestId: world.requestId,
        facilityId: world.facilityId,
        userId,
        actorId: world.schedulerId,
      });
    };

    const far = await buildWorld(); // starts in two weeks
    const farUser = await practitioner('Amina Yusuf');
    await confirm(far, farUser.id);

    const soonStart = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const soon = await buildWorld(1, {
      startsAt: soonStart,
      endsAt: new Date(soonStart.getTime() + 8 * 60 * 60 * 1000),
    });
    const soonUser = await practitioner('Bisi Adeyemi');
    await confirm(soon, soonUser.id);

    // Asked for in both: the window decides, and asking does not open it.
    const farRoster = await listAssignments({
      scopeType: 'FACILITY',
      scopeId: far.facilityId,
      revealContactTo: far.schedulerId,
    });
    expect(farRoster.assignments[0]).toMatchObject({
      practitionerName: 'Amina Yusuf',
      practitionerPhone: '',
    });

    const soonRoster = await listAssignments({
      scopeType: 'FACILITY',
      scopeId: soon.facilityId,
      revealContactTo: soon.schedulerId,
    });
    expect(soonRoster.assignments[0]).toMatchObject({
      practitionerName: 'Bisi Adeyemi',
      practitionerPhone: soonUser.phone,
    });

    // The practitioner always has their own number.
    const mine = await listAssignments({ scopeType: 'SELF', scopeId: farUser.id });
    expect(mine.assignments[0]?.practitionerPhone).toBe(farUser.phone);
  });

  it('cannot be used to look a phone number up while it is withheld', async () => {
    const world = await buildWorld();
    const user = await practitioner('Amina Yusuf');
    await acceptedInvitation(world, user.id);
    await confirmAssignment({
      requestId: world.requestId,
      facilityId: world.facilityId,
      userId: user.id,
      actorId: world.schedulerId,
    });

    const byNumber = await listAssignments({
      scopeType: 'FACILITY',
      scopeId: world.facilityId,
      search: user.phone.slice(-6),
    });
    expect(byNumber.assignments).toHaveLength(0);

    const byName = await listAssignments({
      scopeType: 'FACILITY',
      scopeId: world.facilityId,
      search: 'Amina',
    });
    expect(byName.assignments).toHaveLength(1);
  });

  it('narrows the facility roster by a start-date range', async () => {
    const soon = await buildWorld();
    const soonUser = await practitioner('Amina Yusuf');
    await acceptedInvitation(soon, soonUser.id);
    await confirmAssignment({
      requestId: soon.requestId,
      facilityId: soon.facilityId,
      userId: soonUser.id,
      actorId: soon.schedulerId,
    });

    const laterStart = new Date(SHIFT_START.getTime() + 30 * 24 * 60 * 60 * 1000);
    const laterEnd = new Date(laterStart.getTime() + 8 * 60 * 60 * 1000);
    const later = await buildWorld(1, { startsAt: laterStart, endsAt: laterEnd });
    const laterUser = await practitioner('Bello Ibrahim');
    await acceptedInvitation(later, laterUser.id);
    await confirmAssignment({
      requestId: later.requestId,
      facilityId: later.facilityId,
      userId: laterUser.id,
      actorId: later.schedulerId,
    });

    // Two different facilities, so scoping to one already isolates its shift
    // — the range narrows what's left rather than needing to separate them.
    const inRange = await listAssignments({
      scopeType: 'FACILITY',
      scopeId: later.facilityId,
      from: new Date(laterStart.getTime() - 60 * 60 * 1000),
      to: new Date(laterEnd.getTime() + 60 * 60 * 1000),
    });
    expect(inRange.assignments).toHaveLength(1);
    expect(inRange.assignments[0]?.practitionerName).toBe('Bello Ibrahim');

    const outOfRange = await listAssignments({
      scopeType: 'FACILITY',
      scopeId: soon.facilityId,
      from: new Date(laterStart.getTime() - 60 * 60 * 1000),
      to: new Date(laterEnd.getTime() + 60 * 60 * 1000),
    });
    expect(outOfRange.assignments).toHaveLength(0);
  });

  it("narrows to one shift's own confirmations, not the whole facility's history", async () => {
    const world = await buildWorld();
    const first = await practitioner('Amina Yusuf');
    await acceptedInvitation(world, first.id);
    await confirmAssignment({
      requestId: world.requestId,
      facilityId: world.facilityId,
      userId: first.id,
      actorId: world.schedulerId,
    });

    const secondRequest = await createServiceRequest({
      facilityId: world.facilityId,
      professionalCategoryId: world.categoryId,
      shiftType: 'DAY',
      startsAt: new Date(SHIFT_START.getTime() + 24 * 60 * 60 * 1000),
      endsAt: new Date(SHIFT_END.getTime() + 24 * 60 * 60 * 1000),
      headcount: 1,
      hourlyRateKobo: 500_000,
      urgency: 'ROUTINE',
      cancellationTerms: 'Either party may cancel up to 24 hours before the shift.',
      actorId: world.schedulerId,
    });
    await publishServiceRequest({
      requestId: secondRequest.id,
      facilityId: world.facilityId,
      actorId: world.schedulerId,
    });
    const second = await practitioner('Bello Ibrahim');
    const [invitation] = await invitePractitioners({
      requestId: secondRequest.id,
      facilityId: world.facilityId,
      userIds: [second.id],
      actorId: world.schedulerId,
    });
    await respondToInvitation({ invitationId: invitation!.id, userId: second.id, decision: 'accept' });
    await confirmAssignment({
      requestId: secondRequest.id,
      facilityId: world.facilityId,
      userId: second.id,
      actorId: world.schedulerId,
    });

    // Same facility, two shifts — a page for one of them should never show
    // the other's confirmation.
    const onlyFirst = await listAssignments({
      scopeType: 'FACILITY',
      scopeId: world.facilityId,
      serviceRequestId: world.requestId,
    });
    expect(onlyFirst.assignments).toHaveLength(1);
    expect(onlyFirst.assignments[0]?.practitionerName).toBe('Amina Yusuf');

    const onlySecond = await listAssignments({
      scopeType: 'FACILITY',
      scopeId: world.facilityId,
      serviceRequestId: secondRequest.id,
    });
    expect(onlySecond.assignments).toHaveLength(1);
    expect(onlySecond.assignments[0]?.practitionerName).toBe('Bello Ibrahim');
  });
});

describe('a practitioner reading their own offers', () => {
  it('names the shift an invitation is for, not just its id', async () => {
    const world = await buildWorld();
    const user = await practitioner();
    const [invitation] = await invitePractitioners({
      requestId: world.requestId,
      facilityId: world.facilityId,
      userIds: [user.id],
      actorId: world.schedulerId,
    });

    const [offer] = await listInvitationsFor(user.id);
    expect(offer).toMatchObject({
      id: invitation!.id,
      facilityName: 'Owerri General Hospital',
      professionalCategoryId: world.categoryId,
      shiftType: 'DAY',
      hourlyRateKobo: 500_000,
    });
    expect(offer!.startsAt.toISOString()).toBe(SHIFT_START.toISOString());
    expect(offer!.endsAt.toISOString()).toBe(SHIFT_END.toISOString());
  });

  it('leaves out an invitation whose shift no longer exists, rather than throw', async () => {
    const world = await buildWorld();
    const user = await practitioner();
    await invitePractitioners({
      requestId: world.requestId,
      facilityId: world.facilityId,
      userIds: [user.id],
      actorId: world.schedulerId,
    });

    // Nothing in this module deletes a service request — this stands in for
    // the case the merge has to survive without a real deletion path to
    // reach it through.
    await prisma.serviceRequest.update({
      where: { id: world.requestId },
      data: { deletedAt: new Date() },
    });

    await expect(listInvitationsFor(user.id)).resolves.toEqual([]);
  });
});

describe("a facility reading one shift's offers", () => {
  async function callInvitations(requestId: string, facilityId: string) {
    const response = await requestInvitationsRoute(
      new Request(
        `http://localhost/api/v1/service-requests/${requestId}/invitations?facilityId=${facilityId}`,
      ),
      { params: Promise.resolve({ id: requestId }) },
    );
    return { status: response.status, body: await response.json() };
  }

  it('reads back every offer and its answer, named — not only the ones this page just sent', async () => {
    const world = await buildWorld(2);
    const accepted = await practitioner('Amina Yusuf');
    const waiting = await practitioner('Bisi Adeyemi');
    await acceptedInvitation(world, accepted.id);
    await invitePractitioners({
      requestId: world.requestId,
      facilityId: world.facilityId,
      userIds: [waiting.id],
      actorId: world.schedulerId,
    });

    const rows = await listInvitationsForRequest({
      requestId: world.requestId,
      facilityId: world.facilityId,
    });

    // Whoever has said yes is named, because the facility must confirm them. Whoever
    // has only been invited is initials: an offer is not a booking, and a name is
    // what a booking releases.
    expect(rows.map((row) => [row.practitionerName, row.status])).toEqual([
      ['Amina Yusuf', 'ACCEPTED'],
      ['B. A.', 'INVITED'],
    ]);
  });

  it('never hands the facility the reason somebody declined', async () => {
    // The practitioner's screen promises the reason "reaches the platform without
    // your name". A facility API that returns it beside the invitation breaks that
    // promise whether or not the page renders it.
    const world = await buildWorld();
    const user = await practitioner('Chidi Okeke');
    const [invitation] = await invitePractitioners({
      requestId: world.requestId,
      facilityId: world.facilityId,
      userIds: [user.id],
      actorId: world.schedulerId,
    });
    await respondToInvitation({
      invitationId: invitation!.id,
      userId: user.id,
      decision: 'decline',
      reason: 'The rate is too low for a night shift.',
    });

    const [row] = await listInvitationsForRequest({
      requestId: world.requestId,
      facilityId: world.facilityId,
    });

    expect(row).toMatchObject({ status: 'DECLINED', practitionerName: 'C. O.', declineReason: null });
    expect(JSON.stringify(row)).not.toContain('too low');
  });

  it("treats another facility's shift as absent", async () => {
    const first = await buildWorld();
    const second = await buildWorld();

    await expect(
      listInvitationsForRequest({ requestId: first.requestId, facilityId: second.facilityId }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('answers the route for a scheduler at the facility, and refuses everybody else', async () => {
    const first = await buildWorld();
    const user = await practitioner();
    await acceptedInvitation(first, user.id);

    clearCookies();
    expect((await callInvitations(first.requestId, first.facilityId)).status).toBe(401);

    await issueSession({ userId: first.schedulerId });
    const own = await callInvitations(first.requestId, first.facilityId);
    expect(own.status).toBe(200);
    expect(own.body.invitations).toHaveLength(1);
    expect(own.body.invitations[0]).toMatchObject({ userId: user.id, status: 'ACCEPTED' });

    // A scheduler elsewhere names this facility and is refused by scope.
    const second = await buildWorld();
    await issueSession({ userId: second.schedulerId });
    expect((await callInvitations(first.requestId, first.facilityId)).status).toBe(403);

    // Being offered the shift grants nothing over the facility's list of offers.
    await issueSession({ userId: user.id });
    expect((await callInvitations(first.requestId, first.facilityId)).status).toBe(403);
  });
});

describe('who is shown a practitioner’s number, and the record of it (M07-05)', () => {
  const HOUR = 60 * 60 * 1000;
  const reveals = () =>
    prisma.securityEvent.findMany({ where: { kind: 'contact.revealed' }, orderBy: { createdAt: 'asc' } });

  /** A facility whose one shift starts `hoursAhead` from now, with somebody confirmed onto it. */
  async function bookedIn(hoursAhead: number, name = 'Bisi Adeyemi') {
    const startsAt = new Date(Date.now() + hoursAhead * HOUR);
    const world = await buildWorld(1, { startsAt, endsAt: new Date(startsAt.getTime() + 8 * HOUR) });
    const user = await practitioner(name);
    await acceptedInvitation(world, user.id);
    await confirmAssignment({
      requestId: world.requestId,
      facilityId: world.facilityId,
      userId: user.id,
      actorId: world.schedulerId,
    });
    const [row] = (await listAssignments({ scopeType: 'FACILITY', scopeId: world.facilityId })).assignments;
    return { world, user, assignmentId: row!.id };
  }

  /** A second booking at the same facility, starting `hoursAhead` from now. */
  async function alsoBooked(world: World, hoursAhead: number, name: string) {
    const startsAt = new Date(Date.now() + hoursAhead * HOUR);
    const request = await createServiceRequest({
      facilityId: world.facilityId,
      professionalCategoryId: world.categoryId,
      shiftType: 'DAY',
      startsAt,
      endsAt: new Date(startsAt.getTime() + 8 * HOUR),
      headcount: 1,
      hourlyRateKobo: 500_000,
      urgency: 'ROUTINE',
      cancellationTerms: 'Either party may cancel up to 24 hours before the shift.',
      actorId: world.schedulerId,
    });
    await publishServiceRequest({ requestId: request.id, facilityId: world.facilityId, actorId: world.schedulerId });
    const user = await practitioner(name);
    const [invitation] = await invitePractitioners({
      requestId: request.id,
      facilityId: world.facilityId,
      userIds: [user.id],
      actorId: world.schedulerId,
    });
    await respondToInvitation({ invitationId: invitation!.id, userId: user.id, decision: 'accept' });
    await confirmAssignment({
      requestId: request.id,
      facilityId: world.facilityId,
      userId: user.id,
      actorId: world.schedulerId,
    });
    return user;
  }

  it('does not put the number on a roster nobody asked the number of, even inside the window', async () => {
    const { world } = await bookedIn(24);

    const roster = await listAssignments({ scopeType: 'FACILITY', scopeId: world.facilityId });

    // The name and the shift are there; the number is not, and nothing was released to record.
    expect(roster.assignments[0]).toMatchObject({ practitionerName: 'Bisi Adeyemi', practitionerPhone: '' });
    expect(await reveals()).toHaveLength(0);
  });

  it('puts it on the roster of the person who asked, and a row says who, which booking, whose number and where', async () => {
    const { world, user, assignmentId } = await bookedIn(24);

    const roster = await listAssignments({
      scopeType: 'FACILITY',
      scopeId: world.facilityId,
      revealContactTo: world.schedulerId,
    });

    expect(roster.assignments[0]?.practitionerPhone).toBe(user.phone);
    const [row, ...rest] = await reveals();
    expect(rest).toHaveLength(0);
    expect(row).toMatchObject({
      userId: world.schedulerId,
      severity: 'info',
      detail: { assignmentId, practitionerId: user.id, facilityId: world.facilityId },
    });
    // The number is not in the record: who saw it is the question, and the number is the answer.
    expect(JSON.stringify(row)).not.toContain(user.phone);
  });

  it('writes a row for each number released and none for one held back', async () => {
    const { world, user } = await bookedIn(24);
    await alsoBooked(world, 24 * 14, 'Chidi Okeke');
    const other = await alsoBooked(world, 30, 'Dayo Bello');

    const roster = await listAssignments({
      scopeType: 'FACILITY',
      scopeId: world.facilityId,
      revealContactTo: world.schedulerId,
    });

    expect(roster.assignments.map((row) => row.practitionerPhone).filter(Boolean).sort()).toEqual(
      [user.phone, other.phone].sort(),
    );
    const rows = await reveals();
    expect(rows.map((row) => (row.detail as { practitionerId: string }).practitionerId).sort()).toEqual(
      [user.id, other.id].sort(),
    );
  });

  it('records the release each time the number is shown, not once for good', async () => {
    const { world } = await bookedIn(24);
    const ask = () =>
      listAssignments({ scopeType: 'FACILITY', scopeId: world.facilityId, revealContactTo: world.schedulerId });

    await ask();
    await ask();

    expect(await reveals()).toHaveLength(2);
  });

  it('writes nothing for a cancelled booking, a booking not yet open or one long over', async () => {
    const cancelled = await bookedIn(24, 'Cancelled Person');
    await prisma.assignment.updateMany({ where: { facilityId: cancelled.world.facilityId }, data: { status: 'CANCELLED' } });
    const early = await bookedIn(24 * 5, 'Early Person');
    const over = await bookedIn(24, 'Finished Person');
    await prisma.assignment.updateMany({
      where: { facilityId: over.world.facilityId },
      data: { startsAt: new Date(Date.now() - 72 * HOUR), endsAt: new Date(Date.now() - 64 * HOUR) },
    });

    for (const { world } of [cancelled, early, over]) {
      const roster = await listAssignments({
        scopeType: 'FACILITY',
        scopeId: world.facilityId,
        revealContactTo: world.schedulerId,
      });
      expect(roster.assignments[0]?.practitionerPhone).toBe('');
    }
    expect(await reveals()).toHaveLength(0);
  });

  it('is not recorded for a practitioner reading their own number', async () => {
    const { world, user } = await bookedIn(24);

    const mine = await listAssignments({ scopeType: 'SELF', scopeId: user.id, revealContactTo: world.schedulerId });

    expect(mine.assignments[0]?.practitionerPhone).toBe(user.phone);
    expect(await reveals()).toHaveLength(0);
  });

  it('releases nothing when the record cannot be written', async () => {
    const { world } = await bookedIn(24);
    const spy = vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(new Error('disk full'));

    await expect(
      listAssignments({ scopeType: 'FACILITY', scopeId: world.facilityId, revealContactTo: world.schedulerId }),
    ).rejects.toThrow('disk full');

    spy.mockRestore();
    expect(await reveals()).toHaveLength(0);
  });

  describe('through the route', () => {
    const roster = async (world: World, query = '') => {
      await issueSession({ userId: world.schedulerId });
      const response = await listAssignmentsRoute(
        new Request(`http://localhost/api/v1/assignments?scopeType=FACILITY&scopeId=${world.facilityId}${query}`),
      );
      expect(response.status).toBe(200);
      return (await response.json()) as { assignments: { practitionerPhone: string }[] };
    };

    it('carries the number only when it is asked for by name, and records the person asking', async () => {
      const { world, user } = await bookedIn(24);

      expect((await roster(world)).assignments[0]?.practitionerPhone).toBe('');
      expect(await reveals()).toHaveLength(0);

      expect((await roster(world, '&include=contact')).assignments[0]?.practitionerPhone).toBe(user.phone);
      const rows = await reveals();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.userId).toBe(world.schedulerId);
    });

    it('does not let asking for the other details bring the number with them', async () => {
      const { world } = await bookedIn(24);

      const body = await roster(world, '&include=attendance,timesheet');

      expect(body.assignments[0]?.practitionerPhone).toBe('');
      expect(await reveals()).toHaveLength(0);
    });
  });
});
