import { beforeEach, describe, expect, it, vi } from 'vitest';

const sms = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('@/lib/sms', () => ({
  trySendSms: (message: { to: string; body: string }) => sms.send(message),
}));

import { prisma } from '@/lib/db';
import {
  confirmAssignment,
  invitePractitioners,
  respondToInvitation,
} from '@/modules/matching/application/assignment';
import {
  alertShiftsNotCheckedIn,
  NOT_CHECKED_IN_AFTER_MINUTES,
  REMINDER_LEAD_HOURS,
  sendShiftReminders,
} from '@/modules/notifications/application/shift-alerts';
import { recordManualAttendance } from '@/modules/attendance/application/attendance';
import { JOB_DEFINITIONS, jobs } from '@/worker/jobs';
import { buildBookingWorld, eligiblePractitioner, type BookingWorld } from './support/booking-world';

/**
 * Two things that used to be noticed only afterwards: that a shift is about to
 * start, and that nobody has turned up for one that has.
 *
 * An absence was found only by the hourly sweep after the shift ended, so an
 * urgent shift could not be saved; and there was no reminder at all. Neither
 * alert decides anything. Whether somebody was absent, and whose fault it was,
 * stays with the people and the sweep that already own that question.
 */

const ACCEPTED = { provider: 'test', providerMessageId: 'm-1', accepted: true };
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

beforeEach(() => {
  sms.send.mockReset();
  sms.send.mockResolvedValue(ACCEPTED);
});

async function booked(world: BookingWorld) {
  const nurse = await eligiblePractitioner(world, 'Amina Yusuf');
  const [invitation] = await invitePractitioners({
    requestId: world.requestId,
    facilityId: world.facilityId,
    userIds: [nurse.id],
    actorId: world.schedulerId,
  });
  await respondToInvitation({ invitationId: invitation!.id, userId: nurse.id, decision: 'accept' });
  const assignment = await confirmAssignment({
    requestId: world.requestId,
    facilityId: world.facilityId,
    userId: nurse.id,
    actorId: world.schedulerId,
  });
  const facility = await prisma.facility.findUniqueOrThrow({ where: { id: world.facilityId } });
  return { nurse, assignment, representativeId: facility.representativeUserId };
}

/** The shift as the assignment holds it, moved relative to a clock the test controls. */
async function placeShift(assignmentId: string, now: Date, startsInMinutes: number, lengthHours = 8) {
  const startsAt = new Date(now.getTime() + startsInMinutes * MINUTE);
  await prisma.assignment.update({
    where: { id: assignmentId },
    data: {
      startsAt,
      endsAt: new Date(startsAt.getTime() + lengthHours * HOUR),
      // Long enough ago that the confirmation text is not what a reminder follows.
      createdAt: new Date(now.getTime() - 24 * HOUR),
    },
  });
  sms.send.mockClear();
}

const messages = (userId: string, kind: string) =>
  prisma.notificationMessage.findMany({ where: { userId, kind } });

describe('a reminder before the shift', () => {
  const NOW = new Date();

  it('reaches the practitioner once, in the hours before it starts', async () => {
    const world = await buildBookingWorld();
    const { nurse, assignment } = await booked(world);
    await placeShift(assignment.id, NOW, (REMINDER_LEAD_HOURS - 1) * 60);

    expect(await sendShiftReminders(NOW)).toBe(1);
    const [message] = await messages(nurse.id, 'shift.reminder');
    expect(message!.body).toContain('Owerri General Hospital');
    expect(message!.body).toContain('WAT');

    // The job runs again a few minutes later and finds the same shift.
    expect(await sendShiftReminders(new Date(NOW.getTime() + 15 * MINUTE))).toBe(0);
    expect(await messages(nurse.id, 'shift.reminder')).toHaveLength(1);
  });

  it('leaves a shift that is further off alone, and one that has started', async () => {
    const world = await buildBookingWorld();
    const { nurse, assignment } = await booked(world);

    await placeShift(assignment.id, NOW, (REMINDER_LEAD_HOURS + 2) * 60);
    expect(await sendShiftReminders(NOW)).toBe(0);

    await placeShift(assignment.id, NOW, -10);
    expect(await sendShiftReminders(NOW)).toBe(0);
    expect(await messages(nurse.id, 'shift.reminder')).toHaveLength(0);
  });

  it('does not remind about a booking that has been cancelled', async () => {
    const world = await buildBookingWorld();
    const { assignment } = await booked(world);
    await placeShift(assignment.id, NOW, 90);
    await prisma.assignment.update({ where: { id: assignment.id }, data: { status: 'CANCELLED' } });

    expect(await sendShiftReminders(NOW)).toBe(0);
  });

  it('does not remind somebody who was only just told it was confirmed', async () => {
    const world = await buildBookingWorld();
    const { assignment } = await booked(world);
    await placeShift(assignment.id, NOW, 90);
    await prisma.assignment.update({ where: { id: assignment.id }, data: { createdAt: new Date(NOW.getTime() - 10 * MINUTE) } });

    expect(await sendShiftReminders(NOW)).toBe(0);
  });

  it('is retried by the next run for somebody who could not be reached', async () => {
    const world = await buildBookingWorld();
    const { nurse, assignment } = await booked(world);
    await placeShift(assignment.id, NOW, 90);
    sms.send.mockResolvedValue(null);

    await expect(sendShiftReminders(NOW)).rejects.toThrow(/delivery failed/i);

    sms.send.mockResolvedValue(ACCEPTED);
    expect(await sendShiftReminders(new Date(NOW.getTime() + 5 * MINUTE))).toBe(1);
    expect((await messages(nurse.id, 'shift.reminder')).filter((m) => m.sentAt)).toHaveLength(1);
  });
});

describe('nobody has turned up', () => {
  const NOW = new Date();

  it(`tells both sides ${NOT_CHECKED_IN_AFTER_MINUTES} minutes after the start, while the shift can still be saved`, async () => {
    const world = await buildBookingWorld();
    const { nurse, assignment, representativeId } = await booked(world);
    await placeShift(assignment.id, NOW, -(NOT_CHECKED_IN_AFTER_MINUTES + 5));

    expect(await alertShiftsNotCheckedIn(NOW)).toBe(2);

    const [toPractitioner] = await messages(nurse.id, 'shift.not_checked_in');
    expect(toPractitioner!.body).toContain('Owerri General Hospital');
    const [toFacility] = await messages(representativeId, 'shift.not_checked_in');
    // Initials, not a name: the facility sees the roster in the app, and a text goes to a phone anybody may pick up.
    expect(toFacility!.body).toContain('A. Y.');
    expect(toFacility!.body).not.toContain('Amina');
  });

  it('waits for the grace period', async () => {
    const world = await buildBookingWorld();
    const { assignment } = await booked(world);
    await placeShift(assignment.id, NOW, -(NOT_CHECKED_IN_AFTER_MINUTES - 10));

    expect(await alertShiftsNotCheckedIn(NOW)).toBe(0);
  });

  it('says nothing about somebody who has checked in, by code or by hand', async () => {
    const world = await buildBookingWorld();
    const { assignment } = await booked(world);
    await placeShift(assignment.id, NOW, -(NOT_CHECKED_IN_AFTER_MINUTES + 5));
    await recordManualAttendance({
      assignmentId: assignment.id,
      actorId: world.schedulerId,
      checkedInAt: new Date(NOW.getTime() - 40 * MINUTE),
      checkedOutAt: new Date(NOW.getTime() - 10 * MINUTE),
      breakMinutes: 0,
      reason: 'The ward network was down; taken from the paper register.',
    });

    expect(await alertShiftsNotCheckedIn(NOW)).toBe(0);
  });

  it('says nothing once the shift is over — that is the sweep, and a person decides', async () => {
    const world = await buildBookingWorld();
    const { assignment } = await booked(world);
    await placeShift(assignment.id, NOW, -10 * 60, 8);

    expect(await alertShiftsNotCheckedIn(NOW)).toBe(0);
  });

  it('does not text the same people again on the next run, and never marks an absence', async () => {
    const world = await buildBookingWorld();
    const { assignment } = await booked(world);
    await placeShift(assignment.id, NOW, -(NOT_CHECKED_IN_AFTER_MINUTES + 5));
    await alertShiftsNotCheckedIn(NOW);

    expect(await alertShiftsNotCheckedIn(new Date(NOW.getTime() + 5 * MINUTE))).toBe(0);
    expect((await prisma.assignment.findUniqueOrThrow({ where: { id: assignment.id } })).status).toBe('CONFIRMED');
    expect(await prisma.unhonouredAssignment.count()).toBe(0);
  });

  it('leaves out a booking that was cancelled', async () => {
    const world = await buildBookingWorld();
    const { assignment } = await booked(world);
    await placeShift(assignment.id, NOW, -(NOT_CHECKED_IN_AFTER_MINUTES + 5));
    await prisma.assignment.update({ where: { id: assignment.id }, data: { status: 'CANCELLED' } });

    expect(await alertShiftsNotCheckedIn(NOW)).toBe(0);
  });
});

describe('the scheduled jobs', () => {
  it.each(['shift.reminder_sweep', 'shift.start_watch'])('registers %s, defined and with a handler', (key) => {
    expect(JOB_DEFINITIONS.map((job) => job.key)).toContain(key);
    expect(jobs[key]).toBeTypeOf('function');
  });

  it('watches for an absence often enough that thirty minutes means about thirty minutes', () => {
    const watch = JOB_DEFINITIONS.find((job) => job.key === 'shift.start_watch')!;
    expect(watch.intervalSeconds).toBeLessThanOrEqual(10 * 60);
  });
});
