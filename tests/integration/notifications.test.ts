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
import { publishEvent } from '@/lib/outbox';
import {
  resupplyCredential,
  reviewCredential,
  submitCredential,
} from '@/modules/credentials/application/submission';
import { runOnce } from '@/worker/processor';
import { handlers } from '@/worker/handlers';
import {
  buildBookingWorld,
  eligiblePractitioner,
  type BookingWorld,
} from './support/booking-world';
import { createCredentialType, createUser, grant } from './support/fixtures';

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
    // The confirmation to each side, and the acceptance the facility is told of.
    expect(sent).toBeGreaterThanOrEqual(2);

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


describe('a dispute, from the point of view of the people in it', () => {
  /**
   * Nobody was told when a case was opened, picked up, decided or withdrawn. The
   * admin screen said marking it under review "tells the other side somebody is
   * looking" and that both sides read the outcome; neither was true.
   */
  async function worldWithAssignment() {
    const world = await buildBookingWorld();
    const { nurse, assignment } = await confirmed(world);
    // The confirmation texts are not what is being looked at.
    await runOnce({ handlers });
    sms.send.mockClear();
    const facility = await prisma.facility.findUniqueOrThrow({ where: { id: world.facilityId } });
    return { world, nurse, assignment, representativeId: facility.representativeUserId };
  }

  async function publish(
    eventType: string,
    ids: { assignmentId: string; userId: string; facilityId: string },
    extra: Record<string, unknown>,
  ) {
    const disputeId = '33333333-3333-3333-3333-333333333333';
    await prisma.$transaction((tx) =>
      publishEvent(tx, {
        eventType,
        aggregateType: 'disputes.disputes',
        aggregateId: disputeId,
        payload: { disputeId, ...ids, ...extra },
      }),
    );
    await runOnce({ handlers });
    return disputeId;
  }

  const messagesFor = (userId: string) =>
    prisma.notificationMessage.findMany({ where: { userId, kind: { startsWith: 'dispute.' } } });

  it('tells the facility when a practitioner opens one, and the practitioner when a facility does', async () => {
    const { world, nurse, assignment, representativeId } = await worldWithAssignment();
    const ids = { assignmentId: assignment.id, userId: nurse.id, facilityId: world.facilityId };

    await publish(EVENTS.DisputeOpened, ids, { raisedParty: 'PRACTITIONER', category: 'HOURS' });
    expect(await messagesFor(representativeId)).toHaveLength(1);
    expect(await messagesFor(nurse.id)).toHaveLength(0);
    // The reason somebody gave for opening it is not in a text message.
    expect((await messagesFor(representativeId))[0]!.body).toContain('Owerri General Hospital');
  });

  it('tells a practitioner when the facility opened it', async () => {
    const { world, nurse, assignment, representativeId } = await worldWithAssignment();
    const ids = { assignmentId: assignment.id, userId: nurse.id, facilityId: world.facilityId };

    await publish(EVENTS.DisputeOpened, ids, { raisedParty: 'FACILITY', category: 'CONDUCT' });
    expect(await messagesFor(nurse.id)).toHaveLength(1);
    expect(await messagesFor(representativeId)).toHaveLength(0);
  });

  it('lets the adjudicators know there is something to pick up', async () => {
    const { world, nurse, assignment } = await worldWithAssignment();
    const adjudicator = await createUser({ fullName: 'Disputes Officer' });
    await grant({
      userId: adjudicator.id,
      roleKey: 'disputes_probe',
      permissions: ['dispute.manage'],
      scopeType: 'PLATFORM',
    });

    await publish(
      EVENTS.DisputeOpened,
      { assignmentId: assignment.id, userId: nurse.id, facilityId: world.facilityId },
      { raisedParty: 'PRACTITIONER', category: 'HOURS' },
    );
    expect(await messagesFor(adjudicator.id)).toHaveLength(1);
  });

  it('tells both sides when it is picked up', async () => {
    const { world, nurse, assignment, representativeId } = await worldWithAssignment();
    await publish(
      EVENTS.DisputeUnderReview,
      { assignmentId: assignment.id, userId: nurse.id, facilityId: world.facilityId },
      { raisedParty: 'PRACTITIONER' },
    );
    expect(await messagesFor(nurse.id)).toHaveLength(1);
    expect(await messagesFor(representativeId)).toHaveLength(1);
  });

  it('tells both sides the outcome, and sends them to the app for the reasons', async () => {
    const { world, nurse, assignment, representativeId } = await worldWithAssignment();
    await publish(
      EVENTS.DisputeResolved,
      { assignmentId: assignment.id, userId: nurse.id, facilityId: world.facilityId },
      { raisedParty: 'PRACTITIONER', outcome: 'UPHELD' },
    );

    for (const id of [nurse.id, representativeId]) {
      const [message] = await messagesFor(id);
      expect(message!.body).toMatch(/upheld/i);
      expect(message!.body).toMatch(/Medilink/);
    }
  });

  it('tells only the other side when it is withdrawn', async () => {
    const { world, nurse, assignment, representativeId } = await worldWithAssignment();
    await publish(
      EVENTS.DisputeWithdrawn,
      { assignmentId: assignment.id, userId: nurse.id, facilityId: world.facilityId },
      { raisedParty: 'PRACTITIONER' },
    );
    expect(await messagesFor(representativeId)).toHaveLength(1);
    expect(await messagesFor(nurse.id)).toHaveLength(0);
  });

  it('is retried for whoever could not be reached, and does not text anyone twice', async () => {
    const { world, nurse, assignment, representativeId } = await worldWithAssignment();
    const rep = await prisma.user.findUniqueOrThrow({ where: { id: representativeId } });
    sms.send.mockImplementation(async (message: { to: string }) =>
      message.to === rep.phone ? null : ACCEPTED,
    );
    await publish(
      EVENTS.DisputeUnderReview,
      { assignmentId: assignment.id, userId: nurse.id, facilityId: world.facilityId },
      { raisedParty: 'PRACTITIONER' },
    );
    sms.send.mockResolvedValue(ACCEPTED);
    await makeDue();
    await runOnce({ handlers });

    for (const id of [nurse.id, representativeId]) {
      expect(
        await prisma.notificationMessage.count({
          where: { userId: id, kind: 'dispute.under_review', sentAt: { not: null } },
        }),
      ).toBe(1);
    }
  });
});


describe('an offer, and the answer to it', () => {
  /**
   * The whole premise is that a nurse is told by SMS and answers in minutes. No
   * message was sent for an offer or for an acceptance: both people had to open
   * the app and look.
   */
  async function offered(world: BookingWorld) {
    const nurse = await eligiblePractitioner(world);
    const [invitation] = await invitePractitioners({
      requestId: world.requestId,
      facilityId: world.facilityId,
      userIds: [nurse.id],
      actorId: world.schedulerId,
    });
    return { nurse, invitation: invitation! };
  }

  const kindsFor = (userId: string, kind: string) =>
    prisma.notificationMessage.findMany({ where: { userId, kind } });

  it('tells the practitioner who and when, in Lagos time, and what it pays', async () => {
    const world = await buildBookingWorld();
    const { nurse } = await offered(world);

    await runOnce({ handlers });

    const [message] = await kindsFor(nurse.id, 'shift.invited');
    expect(message).toBeDefined();
    expect(message!.body).toContain('Owerri General Hospital');
    expect(message!.body).toContain('WAT');
    // 500,000 kobo an hour.
    expect(message!.body).toContain('5,000');
    expect(message!.sentAt).not.toBeNull();
  });

  it('does not text twice when the event is delivered twice', async () => {
    const world = await buildBookingWorld();
    const { nurse } = await offered(world);
    await runOnce({ handlers });
    const before = sms.send.mock.calls.length;

    // At-least-once delivery: the same event again.
    await prisma.outboxEvent.updateMany({
      where: { eventType: EVENTS.ShiftInvited },
      data: { status: 'PENDING', availableAt: new Date(Date.now() - 1000) },
    });
    await runOnce({ handlers });

    expect(sms.send.mock.calls.length).toBe(before);
    expect(await kindsFor(nurse.id, 'shift.invited')).toHaveLength(1);
  });

  it('tells the practitioner again when the same shift is offered to them again', async () => {
    const world = await buildBookingWorld();
    const { nurse, invitation } = await offered(world);
    await runOnce({ handlers });
    // The offer lapses without an answer (a declined one is not offered again:
    // that was the answer).
    await prisma.invitation.update({ where: { id: invitation.id }, data: { status: 'EXPIRED' } });

    // Offered again: the same invitation row is reopened.
    await new Promise((resolve) => setTimeout(resolve, 20));
    await invitePractitioners({
      requestId: world.requestId,
      facilityId: world.facilityId,
      userIds: [nurse.id],
      actorId: world.schedulerId,
    });
    await runOnce({ handlers });

    expect(await kindsFor(nurse.id, 'shift.invited')).toHaveLength(2);
  });

  it('tells the facility somebody accepted, without saying who', async () => {
    const world = await buildBookingWorld();
    const { nurse, invitation } = await offered(world);
    await runOnce({ handlers });
    await respondToInvitation({ invitationId: invitation.id, userId: nurse.id, decision: 'accept' });

    await runOnce({ handlers });

    const facility = await prisma.facility.findUniqueOrThrow({ where: { id: world.facilityId } });
    const [message] = await kindsFor(facility.representativeUserId, 'shift.accepted');
    expect(message).toBeDefined();
    expect(message!.body).toContain('WAT');
    // Until a booking exists the platform shows initials at most, never a name.
    expect(message!.body).not.toContain('Amina');
    expect(await kindsFor(nurse.id, 'shift.accepted')).toHaveLength(0);
  });

  it('is retried for a practitioner who could not be reached', async () => {
    const world = await buildBookingWorld();
    const { nurse } = await offered(world);
    sms.send.mockResolvedValue(null);
    expect((await runOnce({ handlers })).failed).toBeGreaterThanOrEqual(1);

    sms.send.mockResolvedValue(ACCEPTED);
    await makeDue();
    await runOnce({ handlers });

    const rows = await kindsFor(nurse.id, 'shift.invited');
    expect(rows.filter((row) => row.sentAt !== null)).toHaveLength(1);
  });
});


describe('a decision on a credential', () => {
  /**
   * A practitioner found out their licence had been verified, queried or
   * refused only by opening the app. The "verified" event had no handler and
   * the other two decisions published nothing at all, so a mandatory credential
   * queried once could sit unanswered for as long as nobody looked.
   */
  async function submitted() {
    const world = await buildBookingWorld();
    const nurse = await eligiblePractitioner(world);
    const type = await createCredentialType({
      name: 'Practising licence (nursing)',
      verificationMethod: 'mdcn_status_check',
    });
    const submission = await submitCredential({
      userId: nurse.id,
      credentialTypeId: type.id,
      referenceNumber: 'NMCN/12345',
    });
    const officer = await createUser({ fullName: 'Compliance Officer' });
    // The booking world's own texts are not what is being looked at.
    await runOnce({ handlers });
    sms.send.mockClear();
    return { nurse, type, submission, officer };
  }

  const messagesFor = (userId: string) =>
    prisma.notificationMessage.findMany({ where: { userId, kind: { startsWith: 'credential.' } } });

  it.each([
    ['approve', 'credential.verified', /verified/i],
    ['reject', 'credential.rejected', /not (been )?approved|refused|could not/i],
    ['request_info', 'credential.info_requested', /more information|needs more/i],
  ] as const)('tells the practitioner when it is %s', async (decision, kind, wording) => {
    const { nurse, submission, officer } = await submitted();

    await reviewCredential({
      submissionId: submission.id,
      reviewerId: officer.id,
      decision,
      reviewNotes: 'The scan is cut off at the edge; the expiry date cannot be read.',
    });
    await runOnce({ handlers });

    const [message] = await messagesFor(nurse.id);
    expect(message!.kind).toBe(kind);
    expect(message!.body).toContain('Practising licence (nursing)');
    expect(message!.body).toMatch(wording);
    // The reviewer's notes are read in the app, signed in, not in a text.
    expect(message!.body).not.toContain('cut off');
  });

  it('tells them again when the same submission is queried a second time', async () => {
    const { nurse, submission, officer } = await submitted();

    await reviewCredential({ submissionId: submission.id, reviewerId: officer.id, decision: 'request_info', reviewNotes: 'Which register is this on?' });
    await runOnce({ handlers });
    await resupplyCredential({ submissionId: submission.id, userId: nurse.id, referenceNumber: 'NMCN/12345' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await reviewCredential({ submissionId: submission.id, reviewerId: officer.id, decision: 'request_info', reviewNotes: 'The number does not match the scan.' });
    await runOnce({ handlers });

    expect(
      (await messagesFor(nurse.id)).filter((m) => m.kind === 'credential.info_requested' && m.sentAt),
    ).toHaveLength(2);
  });

  it('is retried for a practitioner who could not be reached, and sent once', async () => {
    const { nurse, submission, officer } = await submitted();
    sms.send.mockResolvedValue(null);
    await reviewCredential({ submissionId: submission.id, reviewerId: officer.id, decision: 'approve' });
    expect((await runOnce({ handlers })).failed).toBeGreaterThanOrEqual(1);

    sms.send.mockResolvedValue(ACCEPTED);
    await makeDue();
    await runOnce({ handlers });

    expect((await messagesFor(nurse.id)).filter((m) => m.sentAt !== null)).toHaveLength(1);
  });
});
