import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/sms', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/sms')>();
  return { ...original, attemptSms: vi.fn(original.attemptSms) };
});

import { prisma } from '@/lib/db';
import { attemptSms, type SmsAttempt } from '@/lib/sms';
import { startRegistration } from '@/modules/auth/application/registration';
import {
  notifyAssignmentCancelled,
  notifyAssignmentConfirmed,
} from '@/modules/notifications/application/handlers';
import { NotificationNotDelivered } from '@/modules/notifications/application/notify';
import { processEvent, type ClaimedEvent } from '@/worker/processor';
import { buildBookingWorld, eligiblePractitioner } from './support/booking-world';
import { startSmsCapture, stopSmsCapture } from './support/sms-capture';

/**
 * A text that did not go is a failure, not a handled event.
 *
 * Until now the notification handler recorded the failure on the message row
 * and returned normally; the outbox marked the event processed, the duplicate
 * check counted the failed row as "already notified", and nothing ever tried
 * again. These tests pin the three halves of the fix: the failure is visible,
 * it is retried, and a retry neither duplicates what was sent nor skips what
 * was not.
 */

const failed = (reason: string): SmsAttempt => ({ delivered: false, result: null, reason });
const mocked = vi.mocked(attemptSms);

async function confirmedAssignment() {
  const world = await buildBookingWorld();
  const practitioner = await eligiblePractitioner(world);
  const facility = await prisma.facility.findUniqueOrThrow({
    where: { id: world.facilityId },
    select: { representativeUserId: true },
  });
  const assignment = await prisma.assignment.create({
    data: {
      serviceRequestId: world.requestId,
      userId: practitioner.id,
      facilityId: world.facilityId,
      startsAt: world.startsAt,
      endsAt: world.endsAt,
      status: 'CONFIRMED',
      confirmedBy: world.schedulerId,
    },
  });
  return {
    world,
    practitioner,
    representativeId: facility.representativeUserId,
    assignment,
    payload: { assignmentId: assignment.id, userId: practitioner.id, facilityId: world.facilityId },
  };
}

beforeEach(() => {
  mocked.mockClear();
  mocked.mockImplementation(
    async (): Promise<SmsAttempt> => ({
      delivered: true,
      result: { provider: 'test', providerMessageId: 'm-1', accepted: true },
      reason: null,
    }),
  );
});

describe('a text that does not go', () => {
  it('is recorded with its reason, and the handler fails so the event is retried', async () => {
    const { payload, assignment, practitioner } = await confirmedAssignment();
    mocked.mockResolvedValue(failed('gateway timeout'));

    await expect(notifyAssignmentConfirmed(payload)).rejects.toBeInstanceOf(NotificationNotDelivered);

    const row = await prisma.notificationMessage.findFirstOrThrow({
      where: { relatedId: assignment.id, userId: practitioner.id },
    });
    expect(row.sentAt).toBeNull();
    expect(row.failureReason).toBe('gateway timeout');
  });

  it('sends on the retry, on the same row, and then not again', async () => {
    const { payload, assignment, practitioner } = await confirmedAssignment();
    mocked.mockResolvedValue(failed('gateway timeout'));
    await expect(notifyAssignmentConfirmed(payload)).rejects.toThrow();

    mocked.mockClear();
    mocked.mockImplementation(async () => ({
      delivered: true,
      result: { provider: 'test', providerMessageId: 'm-2', accepted: true },
      reason: null,
    }));
    await notifyAssignmentConfirmed(payload);
    expect(mocked).toHaveBeenCalledTimes(2);

    const rows = await prisma.notificationMessage.findMany({ where: { relatedId: assignment.id } });
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.sentAt !== null && row.failureReason === null)).toBe(true);
    expect(rows.some((row) => row.userId === practitioner.id)).toBe(true);

    mocked.mockClear();
    await notifyAssignmentConfirmed(payload);
    expect(mocked).not.toHaveBeenCalled();
    expect(await prisma.notificationMessage.count({ where: { relatedId: assignment.id } })).toBe(2);
  });

  it('does not stop the other person being told, and retries only the one who was missed', async () => {
    const { payload, practitioner, representativeId } = await confirmedAssignment();
    mocked.mockImplementation(async ({ to }) => {
      const owner = await prisma.user.findUniqueOrThrow({
        where: { id: practitioner.id },
        select: { phone: true },
      });
      return to === owner.phone
        ? failed('number unreachable')
        : { delivered: true, result: { provider: 'test', providerMessageId: 'm', accepted: true }, reason: null };
    });

    await expect(notifyAssignmentConfirmed(payload)).rejects.toThrow(/number unreachable/);
    const afterFirst = await prisma.notificationMessage.findMany({
      where: { relatedId: payload.assignmentId },
    });
    expect(afterFirst.find((row) => row.userId === representativeId)?.sentAt).not.toBeNull();
    expect(afterFirst.find((row) => row.userId === practitioner.id)?.sentAt).toBeNull();

    mocked.mockClear();
    mocked.mockImplementation(async () => ({
      delivered: true,
      result: { provider: 'test', providerMessageId: 'm', accepted: true },
      reason: null,
    }));
    await notifyAssignmentConfirmed(payload);
    expect(mocked).toHaveBeenCalledTimes(1);
  });

  it('counts a gateway that answers "not accepted" as a failure, same as one that throws', async () => {
    const { payload } = await confirmedAssignment();
    mocked.mockResolvedValue(failed('The termii gateway did not accept the message.'));
    await expect(notifyAssignmentCancelled(payload)).rejects.toThrow(/did not accept/);
  });

  it('puts the event in the retry queue rather than marking it processed', async () => {
    const { payload } = await confirmedAssignment();
    mocked.mockResolvedValue(failed('gateway timeout'));
    const event = await prisma.outboxEvent.create({
      data: {
        eventType: 'assignment.confirmed',
        aggregateType: 'matching.assignments',
        aggregateId: payload.assignmentId,
        payload,
        status: 'PROCESSING',
        attempts: 1,
      },
    });

    const outcome = await processEvent(
      {
        id: event.id,
        event_type: 'assignment.confirmed',
        payload,
        attempts: 1,
        correlation_id: null,
      } as ClaimedEvent,
      { 'assignment.confirmed': notifyAssignmentConfirmed },
    );

    expect(outcome).toBe('failed');
    const stored = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(stored.status).toBe('FAILED');
    expect(stored.lastError).toMatch(/gateway timeout/);
    expect(stored.availableAt.getTime()).toBeGreaterThan(Date.now());
  });
});

describe('the time in a message', () => {
  it('is West Africa Time, an hour ahead of the stored UTC instant', async () => {
    const { payload, assignment, practitioner } = await confirmedAssignment();

    await notifyAssignmentConfirmed(payload);

    const row = await prisma.notificationMessage.findFirstOrThrow({
      where: { relatedId: assignment.id, userId: practitioner.id },
    });
    expect(row.body).toContain('WAT');
    expect(row.body).not.toContain('UTC');
    const hour = new Date(assignment.startsAt.getTime() + 60 * 60 * 1000)
      .toISOString()
      .slice(11, 13);
    expect(row.body).toContain(`${hour}:`);
  });
});

describe('a one-time code that does not go', () => {
  beforeEach(() => {
    startSmsCapture();
    return () => stopSmsCapture();
  });

  it('is said to the person who asked, not answered with "code sent"', async () => {
    mocked.mockResolvedValue(failed('gateway timeout'));

    await expect(
      startRegistration({ phone: '+2348031100001', fullName: 'Chidi Okeke' }),
    ).rejects.toMatchObject({ code: 'sms_not_delivered', status: 503 });
  });

  it('works on the next try, because the account and its code are already on record', async () => {
    mocked.mockResolvedValueOnce(failed('gateway timeout'));
    await expect(
      startRegistration({ phone: '+2348031100002', fullName: 'Ngozi Eze' }),
    ).rejects.toMatchObject({ code: 'sms_not_delivered' });

    // The resend cooldown still applies after a failed send, as the error says
    // ("wait a minute"); it also stops an outage turning into a flood of retries.
    const afterTheCooldown = new Date(Date.now() + 2 * 60 * 1000);
    const second = await startRegistration({
      phone: '+2348031100002',
      fullName: 'Ngozi Eze',
      now: afterTheCooldown,
    });

    expect(second.existing).toBe(true);
    expect(second.expiresAt.getTime()).toBeGreaterThan(afterTheCooldown.getTime());
  });
});
