import { describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { EVENTS } from '@/lib/events';
import { cancelServiceRequest } from '@/modules/service-requests/application/request';
import {
  cancelAssignment,
  confirmAssignment,
  invitePractitioners,
  respondToInvitation,
} from '@/modules/matching/application/assignment';
import { sweepUnhonouredAssignments } from '@/modules/cancellations-sanctions/application/fault';
import { runOnce } from '@/worker/processor';
import { handlers } from '@/worker/handlers';
import {
  buildBookingWorld,
  eligiblePractitioner,
  type BookingWorld,
} from './support/booking-world';

/**
 * Cancelling a shift, or one booking on it.
 *
 * A request cancelled with people already confirmed used to leave them
 * confirmed: they still saw the shift, could still check in to it, and once
 * it had passed the no-show sweep asked an officer whose fault their absence
 * was. Cancelling a single booking told nobody. Real eligibility throughout.
 */

const REASON = 'The ward is closing for refurbishment.';

async function booked(world: BookingWorld, userId: string) {
  const [invitation] = await invitePractitioners({
    requestId: world.requestId,
    facilityId: world.facilityId,
    userIds: [userId],
    actorId: world.schedulerId,
  });
  await respondToInvitation({ invitationId: invitation!.id, userId, decision: 'accept' });
  return confirmAssignment({
    requestId: world.requestId,
    facilityId: world.facilityId,
    userId,
    actorId: world.schedulerId,
  });
}

const cancelShift = (world: BookingWorld) =>
  cancelServiceRequest({
    requestId: world.requestId,
    facilityId: world.facilityId,
    actorId: world.schedulerId,
    reason: REASON,
  });

describe('cancelling a shift that has people booked onto it', () => {
  it('cancels every booking with the reason and who did it', async () => {
    const world = await buildBookingWorld({ headcount: 2 });
    const first = await eligiblePractitioner(world, 'Amina Yusuf');
    const second = await eligiblePractitioner(world, 'Bisi Adeyemi');
    const a = await booked(world, first.id);
    const b = await booked(world, second.id);
    expect((await prisma.serviceRequest.findUniqueOrThrow({ where: { id: world.requestId } })).status).toBe(
      'FILLED',
    );

    await cancelShift(world);

    const rows = await prisma.assignment.findMany({ where: { id: { in: [a.id, b.id] } } });
    expect(rows.map((row) => row.status)).toEqual(['CANCELLED', 'CANCELLED']);

    const history = await prisma.assignmentStatusHistory.findMany({
      where: { assignmentId: a.id, toStatus: 'CANCELLED' },
    });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ fromStatus: 'CONFIRMED', actorId: world.schedulerId });
    expect(history[0]!.reason).toContain(REASON);

    // Not "reopened": the request is cancelled, and stays so.
    expect((await prisma.serviceRequest.findUniqueOrThrow({ where: { id: world.requestId } })).status).toBe(
      'CANCELLED',
    );
    expect(await prisma.auditLog.count({ where: { action: 'assignment.cancelled' } })).toBe(2);
    expect(await prisma.outboxEvent.count({ where: { eventType: EVENTS.AssignmentCancelled } })).toBe(2);
  });

  it('cancels the bookings of a part-filled shift and withdraws the offers still out', async () => {
    const world = await buildBookingWorld({ headcount: 3 });
    const confirmed = await eligiblePractitioner(world, 'Amina Yusuf');
    const waiting = await eligiblePractitioner(world, 'Bisi Adeyemi');
    const assignment = await booked(world, confirmed.id);
    await invitePractitioners({
      requestId: world.requestId,
      facilityId: world.facilityId,
      userIds: [waiting.id],
      actorId: world.schedulerId,
    });

    await cancelShift(world);

    expect((await prisma.assignment.findUniqueOrThrow({ where: { id: assignment.id } })).status).toBe(
      'CANCELLED',
    );
    const offer = await prisma.invitation.findFirstOrThrow({ where: { userId: waiting.id } });
    expect(offer.status).toBe('WITHDRAWN');
  });

  it('leaves no absence for anybody to answer for afterwards', async () => {
    const world = await buildBookingWorld();
    const nurse = await eligiblePractitioner(world);
    await booked(world, nurse.id);
    await cancelShift(world);

    // Two days after the shift would have ended: the sweep looks for confirmed
    // bookings nobody attended, and there are none.
    const later = new Date(world.endsAt.getTime() + 48 * 60 * 60 * 1000);
    expect(await sweepUnhonouredAssignments(later)).toBe(0);
  });

  it('tells the practitioner, without passing on the facility\'s own reason', async () => {
    const world = await buildBookingWorld();
    const nurse = await eligiblePractitioner(world);
    const assignment = await booked(world, nurse.id);
    await runOnce({ handlers });
    await cancelShift(world);

    await runOnce({ handlers });

    const messages = await prisma.notificationMessage.findMany({
      where: { relatedId: assignment.id, kind: 'assignment.cancelled' },
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]!.userId).toBe(nurse.id);
    expect(messages[0]!.body).toContain('Owerri General Hospital');
    expect(messages[0]!.body).toContain('cancelled');
    expect(messages[0]!.body).not.toContain('refurbishment');

    // At least once is how the outbox delivers, never twice to the person.
    await runOnce({ handlers });
    expect(
      await prisma.notificationMessage.count({
        where: { relatedId: assignment.id, kind: 'assignment.cancelled' },
      }),
    ).toBe(1);
  });
});

describe('cancelling one booking', () => {
  it('publishes the event and tells the practitioner', async () => {
    const world = await buildBookingWorld();
    const nurse = await eligiblePractitioner(world);
    const assignment = await booked(world, nurse.id);

    await cancelAssignment({
      assignmentId: assignment.id,
      facilityId: world.facilityId,
      actorId: world.schedulerId,
      reason: 'Practitioner asked to be released.',
    });

    const events = await prisma.outboxEvent.findMany({
      where: { eventType: EVENTS.AssignmentCancelled, aggregateId: assignment.id },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({
      assignmentId: assignment.id,
      userId: nurse.id,
      facilityId: world.facilityId,
    });

    await runOnce({ handlers });
    expect(
      await prisma.notificationMessage.count({
        where: { userId: nurse.id, kind: 'assignment.cancelled', relatedId: assignment.id },
      }),
    ).toBe(1);
  });

  it('refuses once the shift is over, because that is a question for attendance', async () => {
    const world = await buildBookingWorld();
    const nurse = await eligiblePractitioner(world);
    const assignment = await booked(world, nurse.id);
    await prisma.assignment.update({
      where: { id: assignment.id },
      data: {
        startsAt: new Date(Date.now() - 10 * 60 * 60 * 1000),
        endsAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      },
    });

    await expect(
      cancelAssignment({
        assignmentId: assignment.id,
        facilityId: world.facilityId,
        actorId: world.schedulerId,
        reason: 'Changed our minds.',
      }),
    ).rejects.toMatchObject({ code: 'shift_ended', status: 409 });
    expect((await prisma.assignment.findUniqueOrThrow({ where: { id: assignment.id } })).status).toBe(
      'CONFIRMED',
    );
  });

  it('lets exactly one of two simultaneous cancellations through', async () => {
    const world = await buildBookingWorld();
    const nurse = await eligiblePractitioner(world);
    const assignment = await booked(world, nurse.id);

    const attempt = () =>
      cancelAssignment({
        assignmentId: assignment.id,
        facilityId: world.facilityId,
        actorId: world.schedulerId,
        reason: 'Practitioner asked to be released.',
      });
    const results = await Promise.allSettled([attempt(), attempt()]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const refused = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
    expect(refused.reason).toMatchObject({ code: 'invalid_transition' });

    expect(
      await prisma.assignmentStatusHistory.count({
        where: { assignmentId: assignment.id, toStatus: 'CANCELLED' },
      }),
    ).toBe(1);
    expect(await prisma.outboxEvent.count({ where: { eventType: EVENTS.AssignmentCancelled } })).toBe(1);
  });
});
