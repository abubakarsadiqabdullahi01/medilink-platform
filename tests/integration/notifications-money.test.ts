import { beforeEach, describe, expect, it, vi } from 'vitest';

const sms = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('@/lib/sms', async () => (await import('./support/sms-double')).gatewayDouble(sms.send));

import { prisma } from '@/lib/db';
import { smsEncoding } from '@/lib/sms-text';
import { EVENTS } from '@/lib/events';
import { publishEvent } from '@/lib/outbox';
import {
  confirmAssignment,
  invitePractitioners,
  respondToInvitation,
} from '@/modules/matching/application/assignment';
import { recordManualAttendance } from '@/modules/attendance/application/attendance';
import { reviewTimesheet, submitTimesheet } from '@/modules/timesheets/application/timesheet';
import { generateInvoice, issueInvoice } from '@/modules/billing-settlement/application/invoice';
import { preparePayout, releasePayout } from '@/modules/billing-settlement/application/payout';
import { runOnce } from '@/worker/processor';
import { handlers } from '@/worker/handlers';
import { jobs } from '@/worker/jobs';
import { buildBookingWorld, eligiblePractitioner, type BookingWorld } from './support/booking-world';
import { createUser } from './support/fixtures';

/**
 * NOT-01, UXF-05, CRE-08 and TIM-01: the texts that were still missing.
 *
 * A facility was not told when hours were waiting for it, a practitioner not when
 * they were approved or why they were not, a facility not when an invoice was
 * ready, a practitioner not when they were paid, and nobody was warned a licence
 * was about to expire or reminded that a timesheet had been sitting unapproved.
 */

const ACCEPTED = { provider: 'test', providerMessageId: 'm-1', accepted: true };

beforeEach(() => {
  sms.send.mockReset();
  sms.send.mockResolvedValue(ACCEPTED);
});

const WORKED = {
  from: new Date('2026-09-09T07:00:00.000Z'),
  to: new Date('2026-09-09T15:00:00.000Z'),
};

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
  return { nurse, assignment };
}

async function worked(world: BookingWorld) {
  const { nurse, assignment } = await booked(world);
  await recordManualAttendance({
    assignmentId: assignment.id,
    actorId: world.schedulerId,
    checkedInAt: WORKED.from,
    checkedOutAt: WORKED.to,
    breakMinutes: 0,
    reason: 'Ward network was down for the whole shift; taken from the paper log.',
  });
  return { nurse, assignment };
}

async function facilityPeople(world: BookingWorld) {
  const facility = await prisma.facility.findUniqueOrThrow({ where: { id: world.facilityId } });
  const owner = await prisma.user.findUniqueOrThrow({ where: { id: facility.representativeUserId } });
  return { facility, owner };
}

async function deliver() {
  // Everything due, and what a retry would have been waiting for.
  await prisma.outboxEvent.updateMany({
    where: { status: 'FAILED' },
    data: { availableAt: new Date(Date.now() - 1000) },
  });
  return runOnce({ handlers });
}

const sentTo = (phone: string) =>
  sms.send.mock.calls.map((call) => call[0] as { to: string; body: string }).filter((m) => m.to === phone);

describe('hours waiting for the facility', () => {
  it('tells the facility, and does not name the practitioner', async () => {
    const world = await buildBookingWorld();
    const { owner } = await facilityPeople(world);
    const { assignment, nurse } = await worked(world);
    await deliver();
    sms.send.mockClear();

    await submitTimesheet({ assignmentId: assignment.id, userId: nurse.id });
    await deliver();

    const body = sentTo(owner.phone)[0]!.body;
    expect(body).toContain('waiting for your approval');
    expect(body).not.toContain('Amina');
  });

  it('does not tell people at another facility', async () => {
    const world = await buildBookingWorld();
    const other = await buildBookingWorld();
    const { owner: otherOwner } = await facilityPeople(other);
    const { assignment, nurse } = await worked(world);
    await deliver();
    sms.send.mockClear();

    await submitTimesheet({ assignmentId: assignment.id, userId: nurse.id });
    await deliver();

    expect(sentTo(otherOwner.phone)).toHaveLength(0);
  });

  it('is sent once when the event is delivered twice, and retried for somebody who could not be reached', async () => {
    const world = await buildBookingWorld();
    const { owner } = await facilityPeople(world);
    const { assignment, nurse } = await worked(world);
    await deliver();
    sms.send.mockClear();
    sms.send.mockResolvedValueOnce({ provider: 'test', accepted: false });

    await submitTimesheet({ assignmentId: assignment.id, userId: nurse.id });
    await deliver();
    expect(await prisma.outboxEvent.count({ where: { eventType: EVENTS.TimesheetSubmitted, status: 'FAILED' } })).toBe(1);

    await deliver();
    await deliver();
    const delivered = (await prisma.notificationMessage.findMany({
      where: { userId: owner.id, kind: 'timesheet.submitted', sentAt: { not: null } },
    })).length;
    expect(delivered).toBe(1);
  });
});

describe('a decision on hours', () => {
  async function submitted() {
    const world = await buildBookingWorld();
    const { assignment, nurse } = await worked(world);
    await submitTimesheet({ assignmentId: assignment.id, userId: nurse.id });
    await deliver();
    sms.send.mockClear();
    return { world, assignment, nurse };
  }

  it('tells the practitioner their hours were approved', async () => {
    const { world, assignment, nurse } = await submitted();
    const phone = (await prisma.user.findUniqueOrThrow({ where: { id: nurse.id } })).phone;

    await reviewTimesheet({ assignmentId: assignment.id, facilityId: world.facilityId, actorId: world.schedulerId, decision: 'approve' });
    await deliver();

    expect(sentTo(phone).map((m) => m.body).join(' ')).toMatch(/approved/i);
  });

  it('tells the practitioner their hours were not approved and sends them to the app for why', async () => {
    const { world, assignment, nurse } = await submitted();
    const phone = (await prisma.user.findUniqueOrThrow({ where: { id: nurse.id } })).phone;

    await reviewTimesheet({
      assignmentId: assignment.id,
      facilityId: world.facilityId,
      actorId: world.schedulerId,
      decision: 'reject',
      reviewNotes: 'The break was not taken off; please correct it and resubmit.',
    });
    await deliver();

    const body = sentTo(phone).map((m) => m.body).join(' ');
    expect(body).toMatch(/not approved/i);
    expect(body).toMatch(/open medilink/i);
    // What the facility typed is free text from a person at another organisation, about a
    // person, and a text is read on a lock screen and kept by the carrier. It stays in the app.
    expect(body).not.toContain('The break was not taken off');
    expect(body).not.toContain('resubmit');
  });

  it('is the same text however long the reason, so a long note cannot become more messages', async () => {
    const { world, assignment, nurse } = await submitted();
    const phone = (await prisma.user.findUniqueOrThrow({ where: { id: nurse.id } })).phone;
    // The world's shift runs eight hours from the moment the test starts, so after four in the
    // afternoon in Lagos it crosses midnight and the text names a second date: thirteen more
    // characters. A window inside one day makes the count the same at any hour the suite is run.
    await prisma.assignment.update({
      where: { id: assignment.id },
      data: { startsAt: new Date('2026-10-21T07:00:00.000Z'), endsAt: new Date('2026-10-21T15:00:00.000Z') },
    });

    await reviewTimesheet({
      assignmentId: assignment.id,
      facilityId: world.facilityId,
      actorId: world.schedulerId,
      decision: 'reject',
      reviewNotes: 'x'.repeat(900),
    });
    await deliver();

    const body = sentTo(phone)[0]!.body;
    expect(body).not.toMatch(/x{5}/);
    expect(smsEncoding(body)).toMatchObject({ encoding: 'GSM-7' });
    expect(smsEncoding(body).segments).toBeLessThanOrEqual(2);
  });

  it('stays within three segments with a long hospital name', async () => {
    const { world, assignment, nurse } = await submitted();
    await prisma.facility.update({
      where: { id: world.facilityId },
      data: { name: 'The Federal Medical Centre and Teaching Hospital of the Niger Delta Region, Specialist Annex Block' },
    });
    const phone = (await prisma.user.findUniqueOrThrow({ where: { id: nurse.id } })).phone;

    await reviewTimesheet({
      assignmentId: assignment.id,
      facilityId: world.facilityId,
      actorId: world.schedulerId,
      decision: 'reject',
      reviewNotes: 'The break was not taken off. '.repeat(30),
    });
    await deliver();

    expect(smsEncoding(sentTo(phone)[0]!.body).segments).toBeLessThanOrEqual(3);
  });
});

describe('an invoice that is ready', () => {
  it('tells the facility, once, with the number and the amount', async () => {
    const world = await buildBookingWorld();
    const { owner } = await facilityPeople(world);
    const { assignment, nurse } = await worked(world);
    await submitTimesheet({ assignmentId: assignment.id, userId: nurse.id });
    await reviewTimesheet({ assignmentId: assignment.id, facilityId: world.facilityId, actorId: world.schedulerId, decision: 'approve' });
    const finance = await createUser({ fullName: 'Finance Officer' });
    const invoice = await generateInvoice({
      facilityId: world.facilityId,
      periodStart: new Date(Date.now() - 30 * 86_400_000),
      periodEnd: new Date(Date.now() + 30 * 86_400_000),
      actorId: finance.id,
    });
    await deliver();
    sms.send.mockClear();

    // A draft is not a bill: nothing is said until it is issued.
    expect(sentTo(owner.phone)).toHaveLength(0);
    await issueInvoice({ invoiceId: invoice.id, actorId: finance.id });
    await deliver();
    await deliver();

    const messages = sentTo(owner.phone);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.body).toContain(invoice.number);
    expect(messages[0]!.body).toContain('40,000');
  });
});

describe('a payment to a practitioner', () => {
  it('is told to them when money has actually gone, with the amount', async () => {
    const world = await buildBookingWorld();
    const { nurse } = await booked(world);
    const phone = (await prisma.user.findUniqueOrThrow({ where: { id: nurse.id } })).phone;
    await deliver();
    sms.send.mockClear();

    await publishEvent(prisma, {
      eventType: EVENTS.PayoutSettled,
      aggregateType: 'billing.payouts',
      aggregateId: '00000000-0000-4000-8000-0000000000e1',
      payload: { payoutId: '00000000-0000-4000-8000-0000000000e1', userId: nurse.id, amountKobo: 4_000_000, reference: 'GTB-77-1234' },
    });
    await deliver();

    expect(sentTo(phone)[0]!.body).toContain('40,000');
  });

  it('says nothing for a payout that only ran against the stub, because no money moved', async () => {
    const world = await buildBookingWorld();
    const { nurse } = await booked(world);
    const phone = (await prisma.user.findUniqueOrThrow({ where: { id: nurse.id } })).phone;
    await deliver();
    sms.send.mockClear();

    await publishEvent(prisma, {
      eventType: EVENTS.PayoutSettled,
      aggregateType: 'billing.payouts',
      aggregateId: '00000000-0000-4000-8000-0000000000e2',
      payload: { payoutId: '00000000-0000-4000-8000-0000000000e2', userId: nurse.id, amountKobo: 4_000_000, reference: 'stub-1234' },
    });
    await deliver();

    expect(sentTo(phone)).toHaveLength(0);
  });

  it('carries the reference on the event the real payout publishes', async () => {
    const world = await buildBookingWorld();
    const { assignment, nurse } = await worked(world);
    await submitTimesheet({ assignmentId: assignment.id, userId: nurse.id });
    await reviewTimesheet({ assignmentId: assignment.id, facilityId: world.facilityId, actorId: world.schedulerId, decision: 'approve' });
    const finance = await createUser({ fullName: 'Finance Officer' });
    await generateInvoice({ facilityId: world.facilityId, periodStart: new Date(Date.now() - 30 * 86_400_000), periodEnd: new Date(Date.now() + 30 * 86_400_000), actorId: finance.id });
    const payout = await preparePayout({ practitionerId: nurse.id, actorId: finance.id });

    await releasePayout({ payoutId: payout.id, actorId: finance.id });

    const event = await prisma.outboxEvent.findFirstOrThrow({ where: { eventType: EVENTS.PayoutSettled } });
    expect((event.payload as { reference?: string }).reference).toMatch(/^stub-/);
  });
});

describe('a licence that is about to expire', () => {
  const inDays = (days: number) => new Date(Date.now() + days * 86_400_000);

  async function nurseWithCredentialExpiringIn(days: number) {
    const world = await buildBookingWorld();
    const nurse = await eligiblePractitioner(world, 'Amina Yusuf');
    await prisma.credentialSubmission.updateMany({ where: { userId: nurse.id }, data: { expiresAt: inDays(days) } });
    const phone = (await prisma.user.findUniqueOrThrow({ where: { id: nurse.id } })).phone;
    return { world, nurse, phone };
  }

  it('warns a month ahead, naming the credential and the date', async () => {
    const { phone } = await nurseWithCredentialExpiringIn(25);

    await jobs['credential.expiry_warning_sweep']!();

    const body = sentTo(phone)[0]!.body;
    expect(body).toMatch(/expires on/);
    expect(body).toMatch(/Test Credential Type/);
  });

  it('warns again in the last week, and only once at each stage', async () => {
    const { nurse, phone } = await nurseWithCredentialExpiringIn(25);
    await jobs['credential.expiry_warning_sweep']!();
    await jobs['credential.expiry_warning_sweep']!();
    expect(sentTo(phone)).toHaveLength(1);

    await prisma.credentialSubmission.updateMany({ where: { userId: nurse.id }, data: { expiresAt: inDays(5) } });
    await jobs['credential.expiry_warning_sweep']!();
    await jobs['credential.expiry_warning_sweep']!();

    expect(sentTo(phone)).toHaveLength(2);
    expect(sentTo(phone)[1]!.body).toMatch(/5 days|in 5|within a week/);
  });

  it('says nothing about a credential that is months from expiring', async () => {
    const { phone } = await nurseWithCredentialExpiringIn(120);
    await jobs['credential.expiry_warning_sweep']!();
    expect(sentTo(phone)).toHaveLength(0);
  });

  it('says nothing about one that has already expired, which the expiry sweep deals with', async () => {
    const { phone } = await nurseWithCredentialExpiringIn(-3);
    await jobs['credential.expiry_warning_sweep']!();
    expect(sentTo(phone)).toHaveLength(0);
  });

  it('says nothing once it has been renewed', async () => {
    const { nurse, phone, world } = await nurseWithCredentialExpiringIn(25);
    await prisma.credentialSubmission.create({
      data: { userId: nurse.id, credentialTypeId: world.credentialTypeId, status: 'VERIFIED', expiresAt: inDays(365) },
    });

    await jobs['credential.expiry_warning_sweep']!();

    expect(sentTo(phone)).toHaveLength(0);
  });

  it('is not recorded as done for somebody who could not be reached, and reaches them next time', async () => {
    const { phone } = await nurseWithCredentialExpiringIn(25);
    sms.send.mockResolvedValue({ provider: 'test', accepted: false });

    await expect(jobs['credential.expiry_warning_sweep']!()).rejects.toThrow(/not delivered/i);

    sms.send.mockResolvedValue(ACCEPTED);
    sms.send.mockClear();
    await jobs['credential.expiry_warning_sweep']!();
    expect(sentTo(phone)).toHaveLength(1);
  });
});

describe('hours that nobody has approved', () => {
  const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000);

  async function waitingFor(hours: number) {
    const world = await buildBookingWorld();
    const { owner } = await facilityPeople(world);
    const { assignment, nurse } = await worked(world);
    await submitTimesheet({ assignmentId: assignment.id, userId: nurse.id });
    await deliver();
    await prisma.attendanceRecord.update({ where: { assignmentId: assignment.id }, data: { submittedAt: hoursAgo(hours) } });
    sms.send.mockClear();
    const nursePhone = (await prisma.user.findUniqueOrThrow({ where: { id: nurse.id } })).phone;
    return { world, assignment, nurse, owner, nursePhone };
  }

  it('reminds the facility after a day, once', async () => {
    const { owner } = await waitingFor(30);

    await jobs['timesheet.approval_reminder_sweep']!();
    await jobs['timesheet.approval_reminder_sweep']!();

    expect(sentTo(owner.phone)).toHaveLength(1);
    expect(sentTo(owner.phone)[0]!.body).toMatch(/waiting/);
  });

  it('says nothing to the facility on the first day', async () => {
    const { owner, nursePhone } = await waitingFor(10);

    await jobs['timesheet.approval_reminder_sweep']!();

    expect(sentTo(owner.phone)).toHaveLength(0);
    expect(sentTo(nursePhone)).toHaveLength(0);
  });

  it('reminds the facility again at three days, and tells the practitioner they are being chased', async () => {
    const { owner, nursePhone } = await waitingFor(80);

    await jobs['timesheet.approval_reminder_sweep']!();
    await jobs['timesheet.approval_reminder_sweep']!();

    expect(sentTo(owner.phone)).toHaveLength(1);
    expect(sentTo(nursePhone)).toHaveLength(1);
    expect(sentTo(nursePhone)[0]!.body).toMatch(/reminded/i);
  });

  it('stops once the hours have been decided', async () => {
    const { world, assignment, owner } = await waitingFor(30);
    await reviewTimesheet({ assignmentId: assignment.id, facilityId: world.facilityId, actorId: world.schedulerId, decision: 'approve' });

    await jobs['timesheet.approval_reminder_sweep']!();

    expect(sentTo(owner.phone)).toHaveLength(0);
  });

  it('is not recorded as done for somebody who could not be reached, and reaches them next time', async () => {
    const { owner } = await waitingFor(30);
    sms.send.mockResolvedValue({ provider: 'test', accepted: false });

    await expect(jobs['timesheet.approval_reminder_sweep']!()).rejects.toThrow(/not delivered/i);

    sms.send.mockResolvedValue(ACCEPTED);
    sms.send.mockClear();
    await jobs['timesheet.approval_reminder_sweep']!();
    expect(sentTo(owner.phone)).toHaveLength(1);
  });
});

