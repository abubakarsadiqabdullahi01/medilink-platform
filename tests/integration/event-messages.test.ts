import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/sms', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/sms')>();
  return { ...original, attemptSms: vi.fn(original.attemptSms) };
});

import { prisma } from '@/lib/db';
import { attemptSms, type SmsAttempt } from '@/lib/sms';
import { handlers } from '@/worker/handlers';
import { EVENTS } from '@/lib/events';
import { reviewCredential } from '@/modules/credentials/application/submission';
import {
  notifyCredentialExpired,
  notifyCredentialInfoRequested,
  notifyCredentialRejected,
  notifyCredentialVerified,
  notifyDisputeOpened,
  notifyFacilityVerified,
  notifyShiftAccepted,
  notifyShiftInvited,
  notifyTimesheetApproved,
  notifyTimesheetSubmitted,
} from '@/modules/notifications/application/event-handlers';
import { buildBookingWorld, eligiblePractitioner } from './support/booking-world';
import { createCredentialType, createUser, grant } from './support/fixtures';

/**
 * Who is told what, and when (NOT-01).
 *
 * The assertions are about the stored message: who it went to, what it says
 * and, as much, what it leaves out. A text goes to a phone; the screen behind
 * the sign-in is where names, reasons and categories belong.
 */

const accepted: SmsAttempt = {
  delivered: true,
  result: { provider: 'test', providerMessageId: 'm', accepted: true },
  reason: null,
};
const mocked = vi.mocked(attemptSms);

beforeEach(() => {
  mocked.mockReset();
  mocked.mockResolvedValue(accepted);
});

async function bookedShift() {
  const world = await buildBookingWorld();
  const practitioner = await eligiblePractitioner(world, 'Amina Yusuf');
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
  return { world, practitioner, representativeId: facility.representativeUserId, assignment };
}

const messagesAbout = (relatedId: string) =>
  prisma.notificationMessage.findMany({ where: { relatedId }, orderBy: { createdAt: 'asc' } });

describe('an offer', () => {
  it('reaches the practitioner with the hospital, the time in WAT and the rate', async () => {
    const { world, practitioner } = await bookedShift();
    const invitation = await prisma.invitation.create({
      data: {
        serviceRequestId: world.requestId,
        userId: practitioner.id,
        status: 'INVITED',
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    await notifyShiftInvited({
      invitationId: invitation.id,
      userId: practitioner.id,
      serviceRequestId: world.requestId,
    });

    const [message] = await messagesAbout(invitation.id);
    expect(message?.userId).toBe(practitioner.id);
    expect(message?.body).toContain('Owerri General Hospital');
    expect(message?.body).toContain('WAT');
    expect(message?.body).toContain('NGN 5,000 per hour');
    // The naira sign would turn the whole message into a costlier encoding.
    expect(message?.body).not.toContain('₦');
  });

  it('is not announced if it was withdrawn before the message went out', async () => {
    const { world, practitioner } = await bookedShift();
    const invitation = await prisma.invitation.create({
      data: {
        serviceRequestId: world.requestId,
        userId: practitioner.id,
        status: 'WITHDRAWN',
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    await notifyShiftInvited({
      invitationId: invitation.id,
      userId: practitioner.id,
      serviceRequestId: world.requestId,
    });

    expect(await messagesAbout(invitation.id)).toHaveLength(0);
    expect(mocked).not.toHaveBeenCalled();
  });

  it('is told to the facility as an acceptance, without saying who accepted', async () => {
    const { world, practitioner, representativeId } = await bookedShift();
    const invitation = await prisma.invitation.create({
      data: {
        serviceRequestId: world.requestId,
        userId: practitioner.id,
        status: 'ACCEPTED',
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    await notifyShiftAccepted({
      invitationId: invitation.id,
      userId: practitioner.id,
      serviceRequestId: world.requestId,
    });

    const [message] = await messagesAbout(invitation.id);
    expect(message?.userId).toBe(representativeId);
    expect(message?.body).toContain('accepted your shift');
    expect(message?.body).not.toContain('Amina');
    expect(message?.body).not.toContain('Yusuf');
  });

  it('is sent once however many times the event is delivered', async () => {
    const { world, practitioner } = await bookedShift();
    const invitation = await prisma.invitation.create({
      data: {
        serviceRequestId: world.requestId,
        userId: practitioner.id,
        status: 'INVITED',
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    const payload = {
      invitationId: invitation.id,
      userId: practitioner.id,
      serviceRequestId: world.requestId,
    };

    await notifyShiftInvited(payload);
    await notifyShiftInvited(payload);

    expect(await messagesAbout(invitation.id)).toHaveLength(1);
  });
});

describe('a decision on a document', () => {
  async function pendingSubmission() {
    const { world, practitioner } = await bookedShift();
    const type = await createCredentialType({ name: 'Practising Licence' });
    const submission = await prisma.credentialSubmission.create({
      data: {
        userId: practitioner.id,
        credentialTypeId: type.id,
        status: 'PENDING',
        referenceNumber: 'LIC-123',
      },
    });
    const officer = await createUser({ fullName: 'Compliance Officer' });
    return { world, practitioner, submission, officer, type };
  }

  it.each([
    ['approve', 'credential.verified'],
    ['reject', 'credential.rejected'],
    ['request_info', 'credential.info_requested'],
  ] as const)(
    'is published as an event when an officer chooses %s',
    async (decision, eventType) => {
      const { submission, officer } = await pendingSubmission();

      await reviewCredential({
        submissionId: submission.id,
        reviewerId: officer.id,
        decision,
        reviewNotes: 'Name on the scan does not match.',
      });

      const events = await prisma.outboxEvent.findMany({
        where: { eventType, aggregateId: submission.id },
      });
      expect(events).toHaveLength(1);
    },
  );

  it('tells the practitioner which document, and leaves the officer’s reasons for the screen', async () => {
    const { practitioner, submission, type } = await pendingSubmission();
    const payload = {
      submissionId: submission.id,
      userId: practitioner.id,
      credentialTypeId: type.id,
    };

    await notifyCredentialVerified(payload);
    await notifyCredentialRejected(payload);
    await notifyCredentialInfoRequested(payload);
    await notifyCredentialExpired(payload);

    const bodies = (
      await prisma.notificationMessage.findMany({ where: { userId: practitioner.id } })
    ).map((row) => row.body);
    expect(bodies).toHaveLength(4);
    expect(bodies.every((body) => body.includes('Practising Licence'))).toBe(true);
    expect(bodies.some((body) => body.includes('verified'))).toBe(true);
    expect(bodies.some((body) => body.includes('not accepted'))).toBe(true);
    expect(bodies.some((body) => body.includes('more information'))).toBe(true);
    expect(bodies.some((body) => body.includes('expired'))).toBe(true);
  });
});

describe('a facility verified', () => {
  it('tells its representative they can publish shifts', async () => {
    const { world, representativeId } = await bookedShift();

    await notifyFacilityVerified({ facilityId: world.facilityId });

    const [message] = await messagesAbout(world.facilityId);
    expect(message?.userId).toBe(representativeId);
    expect(message?.body).toContain('Owerri General Hospital is verified');
  });
});

describe('a timesheet', () => {
  it('waiting for approval tells the facility; approved tells the practitioner', async () => {
    const { practitioner, representativeId, assignment } = await bookedShift();

    await notifyTimesheetSubmitted({
      assignmentId: assignment.id,
      submissionKey: crypto.randomUUID(),
      userId: practitioner.id,
    });
    await notifyTimesheetApproved({ assignmentId: assignment.id, userId: practitioner.id });

    const sent = await prisma.notificationMessage.findMany({ orderBy: { createdAt: 'asc' } });
    expect(sent.find((row) => row.kind === 'timesheet.submitted')?.userId).toBe(representativeId);
    expect(sent.find((row) => row.kind === 'timesheet.approved')?.userId).toBe(practitioner.id);
  });

  it('sent back and submitted again tells the facility again, but a repeat delivery does not', async () => {
    const { practitioner, assignment } = await bookedShift();
    const first = crypto.randomUUID();
    const second = crypto.randomUUID();

    await notifyTimesheetSubmitted({
      assignmentId: assignment.id,
      submissionKey: first,
      userId: practitioner.id,
    });
    await notifyTimesheetSubmitted({
      assignmentId: assignment.id,
      submissionKey: first,
      userId: practitioner.id,
    });
    expect(await prisma.notificationMessage.count({ where: { kind: 'timesheet.submitted' } })).toBe(
      1,
    );

    await notifyTimesheetSubmitted({
      assignmentId: assignment.id,
      submissionKey: second,
      userId: practitioner.id,
    });
    expect(await prisma.notificationMessage.count({ where: { kind: 'timesheet.submitted' } })).toBe(
      2,
    );
  });
});

describe('a dispute opened', () => {
  it('tells the facility there is a case and says nothing of what it claims', async () => {
    const { practitioner, representativeId, assignment } = await bookedShift();
    const disputeId = crypto.randomUUID();

    await notifyDisputeOpened({
      disputeId,
      assignmentId: assignment.id,
      userId: practitioner.id,
      category: 'PAY',
      raisedParty: 'PRACTITIONER',
    });

    const [message] = await messagesAbout(disputeId);
    expect(message?.userId).toBe(representativeId);
    expect(message?.body).toContain('A dispute was opened');
    expect(message?.body).not.toContain('PAY');
    expect(message?.body).not.toContain('Amina');
  });

  it('tells the other side by when they are asked to reply, in Lagos time, and not the officers', async () => {
    const { practitioner, representativeId, assignment } = await bookedShift();
    const officer = await createUser({ fullName: 'Disputes Officer' });
    await grant({ userId: officer.id, roleKey: 'operations_officer', permissions: ['dispute.manage'], scopeType: 'PLATFORM' });
    const disputeId = crypto.randomUUID();

    await notifyDisputeOpened({
      disputeId,
      assignmentId: assignment.id,
      userId: practitioner.id,
      raisedParty: 'PRACTITIONER',
      // 11:00 UTC on Monday 26 October is 12:00 in Nigeria.
      respondBy: '2026-10-26T11:00:00.000Z',
    });

    const messages = await messagesAbout(disputeId);
    const toThem = messages.find((m) => m.userId === representativeId)!;
    const toOfficer = messages.find((m) => m.userId === officer.id)!;
    expect(toThem.body).toContain('Reply by Mon 26 Oct, 12:00 WAT.');
    // The officers pick a case up; they are not asked to reply to it.
    expect(toOfficer.body).not.toContain('Reply by');
  });

  it('goes without a date for an event written before there was one', async () => {
    const { practitioner, representativeId, assignment } = await bookedShift();
    const disputeId = crypto.randomUUID();

    await notifyDisputeOpened({
      disputeId,
      assignmentId: assignment.id,
      userId: practitioner.id,
      raisedParty: 'PRACTITIONER',
    });

    const [message] = (await messagesAbout(disputeId)).filter((m) => m.userId === representativeId);
    expect(message!.body).not.toContain('Reply by');
    expect(message!.body).toContain('A dispute was opened');
  });

  it('tells the practitioner when the facility opened the case', async () => {
    const { practitioner, representativeId, assignment } = await bookedShift();
    const disputeId = crypto.randomUUID();

    await notifyDisputeOpened({
      disputeId,
      assignmentId: assignment.id,
      userId: practitioner.id,
      raisedParty: 'FACILITY',
    });

    const [message] = await messagesAbout(disputeId);
    expect(message?.userId).toBe(practitioner.id);
    expect(message?.userId).not.toBe(representativeId);
  });
});

describe('the worker', () => {
  it.each([
    EVENTS.ShiftInvited,
    EVENTS.ShiftAccepted,
    EVENTS.AssignmentConfirmed,
    EVENTS.AssignmentCancelled,
    EVENTS.CredentialVerified,
    EVENTS.CredentialRejected,
    EVENTS.CredentialInfoRequested,
    EVENTS.CredentialExpired,
    EVENTS.FacilityVerified,
    EVENTS.TimesheetSubmitted,
    EVENTS.TimesheetApproved,
    EVENTS.DisputeOpened,
    EVENTS.DisputeResponded,
  ])('has a consumer for %s, so the event is not marked processed unread', (eventType) => {
    expect(handlers[eventType]).toBeTypeOf('function');
  });
});
