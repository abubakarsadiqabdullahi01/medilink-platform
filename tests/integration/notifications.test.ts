import { beforeEach, describe, expect, it, vi } from 'vitest';

const sms = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('@/lib/sms', () => ({
  trySendSms: (message: { to: string; body: string }) => sms.send(message),
}));

import { prisma } from '@/lib/db';
import { EVENTS } from '@/lib/events';
import {
  confirmAssignment,
  invitePractitioners,
  respondToInvitation,
} from '@/modules/matching/application/assignment';
import { startRegistration } from '@/modules/auth/application/registration';
import { reportIncident } from '@/modules/clinical-incidents/application/incident';
import { runOnce } from '@/worker/processor';
import { handlers } from '@/worker/handlers';
import {
  buildBookingWorld,
  eligiblePractitioner,
  type BookingWorld,
} from './support/booking-world';
import { createUser, grant } from './support/fixtures';

/**
 * What happens when a text does not go, and what it says when it does.
 *
 * A failed text used to be recorded as handled — the handler returned, the
 * outbox event became PROCESSED, and the duplicate check counted the failed
 * row, so even a manual re-run sent nothing. A failed code was answered with
 * "code sent". And the times in a confirmation were UTC, an hour behind
 * Nigerian time, in a product that shows Lagos time everywhere else.
 */

const ACCEPTED = { provider: 'test', providerMessageId: 'm-1', accepted: true };

beforeEach(() => {
  sms.send.mockReset();
  sms.send.mockResolvedValue(ACCEPTED);
});

async function confirmed(world: BookingWorld) {
  const nurse = await eligiblePractitioner(world);
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
  return { nurse, assignment };
}

/** What a retry would have waited for. */
async function makeDue() {
  await prisma.outboxEvent.updateMany({
    where: { status: 'FAILED' },
    data: { availableAt: new Date(Date.now() - 1000) },
  });
}

describe('a text that does not go', () => {
  it('leaves the event to be retried instead of calling it handled', async () => {
    const world = await buildBookingWorld();
    const { nurse, assignment } = await confirmed(world);
    const phone = (await prisma.user.findUniqueOrThrow({ where: { id: nurse.id } })).phone;
    sms.send.mockImplementation(async (message: { to: string }) =>
      message.to === phone ? null : ACCEPTED,
    );

    const pass = await runOnce({ handlers });
    expect(pass.failed).toBe(1);

    const event = await prisma.outboxEvent.findFirstOrThrow({
      where: { eventType: EVENTS.AssignmentConfirmed, aggregateId: assignment.id },
    });
    expect(event.status).toBe('FAILED');
    expect(event.lastError).toMatch(/delivery failed/i);

    // The failure is on the record, as a failure.
    const mine = await prisma.notificationMessage.findMany({ where: { userId: nurse.id } });
    expect(mine).toHaveLength(1);
    expect(mine[0]!.sentAt).toBeNull();
    expect(mine[0]!.failureReason).not.toBeNull();
  });

  it('sends to the person it failed for on the retry, and to nobody twice', async () => {
    const world = await buildBookingWorld();
    const { nurse, assignment } = await confirmed(world);
    const phone = (await prisma.user.findUniqueOrThrow({ where: { id: nurse.id } })).phone;
    sms.send.mockImplementation(async (message: { to: string }) =>
      message.to === phone ? null : ACCEPTED,
    );
    await runOnce({ handlers });
    const callsAfterFirst = sms.send.mock.calls.length;

    // The gateway recovers.
    sms.send.mockResolvedValue(ACCEPTED);
    await makeDue();
    const retry = await runOnce({ handlers });
    expect(retry.processed).toBeGreaterThanOrEqual(1);

    const event = await prisma.outboxEvent.findFirstOrThrow({
      where: { eventType: EVENTS.AssignmentConfirmed, aggregateId: assignment.id },
    });
    expect(event.status).toBe('PROCESSED');

    // Exactly one message actually went to the practitioner, after one failure.
    const mine = await prisma.notificationMessage.findMany({
      where: { userId: nurse.id, relatedId: assignment.id },
    });
    expect(mine.filter((row) => row.sentAt !== null)).toHaveLength(1);
    expect(mine.filter((row) => row.sentAt === null)).toHaveLength(1);

    // The facility's representative had been told on the first pass and is not
    // told again: one extra call on the retry, for the one who was missed.
    expect(sms.send.mock.calls.length - callsAfterFirst).toBe(1);
  });

  it('does not send a second text once one has gone', async () => {
    const world = await buildBookingWorld();
    const { assignment } = await confirmed(world);
    await runOnce({ handlers });
    const sent = sms.send.mock.calls.length;
    expect(sent).toBe(2);

    // The same event delivered again, as at-least-once delivery will.
    const { notifyAssignmentConfirmed } = await import(
      '@/modules/notifications/application/handlers'
    );
    await notifyAssignmentConfirmed({
      assignmentId: assignment.id,
      userId: assignment.userId,
      facilityId: world.facilityId,
    });
    expect(sms.send.mock.calls.length).toBe(sent);
  });
});

describe('the time in a message', () => {
  it('is Lagos time, labelled as such', async () => {
    const world = await buildBookingWorld();
    await confirmed(world);
    await runOnce({ handlers });

    const wat = new Date(world.startsAt.getTime() + 60 * 60 * 1000);
    const watEnd = new Date(world.endsAt.getTime() + 60 * 60 * 1000);
    const expected = `${wat.toISOString().slice(0, 10)} ${wat.toISOString().slice(11, 16)} to ${watEnd
      .toISOString()
      .slice(11, 16)} WAT`;

    const bodies = sms.send.mock.calls.map(([message]) => String(message.body));
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) {
      expect(body).toContain(expected);
      expect(body).not.toContain('UTC');
    }
  });
});

describe('a one-time code that does not go', () => {
  const PHONE = '08031234999';

  it('says so, instead of answering that a code was sent', async () => {
    sms.send.mockResolvedValue(null);

    await expect(
      startRegistration({ phone: PHONE, fullName: 'Amina Yusuf' }),
    ).rejects.toMatchObject({ code: 'sms_unavailable', status: 503 });

    // The undelivered code is not left outstanding, and the failure is on the record.
    expect(await prisma.otpCode.count({ where: { consumedAt: null } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'auth.otp_delivery_failed' } })).toBe(1);
  });

  it('treats a gateway that did not accept the message as a failure too', async () => {
    sms.send.mockResolvedValue({ provider: 'test', providerMessageId: null, accepted: false });

    await expect(
      startRegistration({ phone: PHONE, fullName: 'Amina Yusuf' }),
    ).rejects.toMatchObject({ code: 'sms_unavailable' });
  });

  it('carries on as before when the gateway takes the message', async () => {
    await expect(
      startRegistration({ phone: PHONE, fullName: 'Amina Yusuf' }),
    ).resolves.toMatchObject({ existing: false });
    expect(await prisma.otpCode.count({ where: { consumedAt: null } })).toBe(1);
  });
});


describe('a serious clinical incident', () => {
  /**
   * A death waited in a queue until somebody happened to open the page. The
   * event was published and nothing listened to it.
   */
  const SUMMARY = 'A patient on the ward collapsed after a missed dose and could not be revived.';

  async function reported(severity: 'MINOR' | 'SEVERE' | 'DEATH') {
    const world = await buildBookingWorld();
    const incident = await reportIncident({
      facilityId: world.facilityId,
      actorId: world.schedulerId,
      occurredAt: new Date(Date.now() - 60 * 60 * 1000),
      severity,
      category: 'CLINICAL_PROCEDURE',
      summary: SUMMARY,
    });
    return { world, incident };
  }

  async function officer(fullName = 'Compliance Officer') {
    const user = await createUser({ fullName });
    await grant({
      userId: user.id,
      roleKey: 'incident_officer_probe',
      permissions: ['incident.manage'],
      scopeType: 'PLATFORM',
    });
    return user;
  }

  it.each(['SEVERE', 'DEATH'] as const)(
    'tells everybody who can act on it, at once, when it is %s',
    async (severity) => {
      const first = await officer('First Officer');
      const second = await officer('Second Officer');
      const { incident } = await reported(severity);

      const pass = await runOnce({ handlers });
      expect(pass.failed).toBe(0);

      const messages = await prisma.notificationMessage.findMany({
        where: { relatedId: incident.id, kind: 'incident.severe' },
      });
      expect(messages.map((m) => m.userId).sort()).toEqual([first.id, second.id].sort());
      // Names a facility and a severity, never what happened or to whom.
      expect(messages[0]!.body).toContain('Owerri General Hospital');
      expect(messages[0]!.body).toContain(severity === 'DEATH' ? 'death' : 'severe');
      expect(messages[0]!.body).not.toContain('collapsed');
    },
  );

  it('does not wake anybody for a minor one', async () => {
    await officer();
    const { incident } = await reported('MINOR');

    await runOnce({ handlers });

    expect(
      await prisma.notificationMessage.count({
        where: { relatedId: incident.id, kind: 'incident.severe' },
      }),
    ).toBe(0);
  });

  it('is not recorded as handled when there is nobody to tell', async () => {
    const { incident } = await reported('DEATH');

    const pass = await runOnce({ handlers });
    expect(pass.failed).toBe(1);

    const event = await prisma.outboxEvent.findFirstOrThrow({
      where: { eventType: EVENTS.ClinicalIncidentReported, aggregateId: incident.id },
    });
    expect(event.status).toBe('FAILED');
    expect(event.lastError).toMatch(/incident\.manage|nobody|no one/i);
  });

  it('tells the officers who were missed on the retry, and nobody twice', async () => {
    const first = await officer('First Officer');
    const second = await officer('Second Officer');
    const secondPhone = (await prisma.user.findUniqueOrThrow({ where: { id: second.id } })).phone;
    const { incident } = await reported('SEVERE');
    sms.send.mockImplementation(async (message: { to: string }) =>
      message.to === secondPhone ? null : ACCEPTED,
    );
    await runOnce({ handlers });

    sms.send.mockResolvedValue(ACCEPTED);
    await makeDue();
    await runOnce({ handlers });

    for (const user of [first, second]) {
      expect(
        await prisma.notificationMessage.count({
          where: { userId: user.id, relatedId: incident.id, sentAt: { not: null } },
        }),
      ).toBe(1);
    }
  });
});
