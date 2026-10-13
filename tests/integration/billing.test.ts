import { Prisma } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  createServiceRequest,
  publishServiceRequest,
} from '@/modules/service-requests/application/request';
import {
  confirmAssignment,
  invitePractitioners,
  respondToInvitation,
} from '@/modules/matching/application/assignment';
import { recordManualAttendance } from '@/modules/attendance/application/attendance';
import { reviewTimesheet, submitTimesheet } from '@/modules/timesheets/application/timesheet';
import { createRateCard } from '@/modules/rates-contracts/application/rate-card';
import {
  accountBalance,
  generateInvoice,
  issueInvoice,
  listInvoices,
  recordPayment,
} from '@/modules/billing-settlement/application/invoice';
import {
  amountOwed,
  preparePayout,
  releasePayout,
} from '@/modules/billing-settlement/application/payout';
import { GET as getPayoutsRoute } from '@/app/api/v1/payouts/route';
import { issueSession } from '@/modules/auth/application/session-service';
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
 * Modules 11 and 12 against a real database.
 *
 * What the pure tests cannot cover: that an approved shift becomes an invoice
 * line at the facility's own rates, that the ledger balances after every
 * step, and that nothing can be billed or paid twice.
 */

const HOURLY_RATE_KOBO = 500_000;

/** A fixed past Wednesday, 08:00–16:00 WAT: all ordinary, no night, no holiday. */
const WORKED_FROM = new Date('2026-09-09T07:00:00.000Z');
const WORKED_TO = new Date('2026-09-09T15:00:00.000Z');

/**
 * The shift as scheduled is in the future, because publishing refuses one
 * that has already started. The hours *recorded* against it are in the past,
 * which is the ordinary shape of a manual attendance record.
 */
const SHIFT_START = new Date(Date.now() + 2 * 60 * 60 * 1000);
const SHIFT_END = new Date(SHIFT_START.getTime() + 8 * 60 * 60 * 1000);

/** Wide enough to contain the scheduled shift wherever "now" falls. */
const PERIOD_START = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
const PERIOD_END = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

let sequence = 0;

interface World {
  facilityId: string;
  schedulerId: string;
  reviewerId: string;
  financeId: string;
  practitionerId: string;
  assignmentId: string;
}

/** A shift worked and approved — the state billing starts from. */
async function buildWorld(
  worked: { from: Date; to: Date } = { from: WORKED_FROM, to: WORKED_TO },
  /**
   * The facility's allowances *when the shift is booked*. Premiums are fixed at
   * booking, so a card has to exist before the booking to apply to it.
   */
  card?: { name?: string; nightMultiplierBp?: number; holidayMultiplierBp?: number },
): Promise<World> {
  await ensureRole('facility_owner', ROLE_PERMISSIONS.facility_owner ?? []);

  const state = await createState();
  const facilityType = await createFacilityType();
  const representative = await createUser({ fullName: 'Facility Representative' });
  const ops = await createUser({ fullName: 'Operations Officer' });
  const verifier = await createUser({ fullName: 'Verifying Officer' });

  sequence += 1;
  const facility = await createFacility({
    name: 'Kano Teaching Hospital',
    facilityTypeId: facilityType.id,
    cacNumber: `RC${900_000 + sequence}`,
    stateId: state.id,
    addressLine: '5 Zaria Road, Kano',
    contactPhone: '+2348031234567',
    representativeUserId: representative.id,
    actorId: ops.id,
  });
  await verifyFacility({ facilityId: facility.id, verifierId: verifier.id, decision: 'approve' });

  const category = await createProfessionalCategory();
  const scheduler = await createUser({ fullName: 'Facility Scheduler' });
  await grant({
    userId: scheduler.id,
    roleKey: 'facility_scheduler',
    permissions: ['service_request.publish', 'assignment.confirm', 'attendance.record'],
    scopeType: 'FACILITY',
    scopeId: facility.id,
  });

  const reviewer = await createUser({ fullName: 'Ward Manager' });
  await grant({
    userId: reviewer.id,
    roleKey: 'facility_approver',
    permissions: ['timesheet.approve', 'service_request.read', 'facility.write'],
    scopeType: 'FACILITY',
    scopeId: facility.id,
  });

  const finance = await createUser({ fullName: 'Finance Officer' });
  await grant({
    userId: finance.id,
    roleKey: 'finance_officer',
    permissions: ['payout.manage', 'invoice.read'],
    scopeType: 'PLATFORM',
  });

  if (card) {
    await createRateCard({
      facilityId: facility.id,
      actorId: reviewer.id,
      name: card.name ?? 'Allowances at booking',
      nightMultiplierBp: card.nightMultiplierBp,
      holidayMultiplierBp: card.holidayMultiplierBp,
    });
  }

  const request = await createServiceRequest({
    facilityId: facility.id,
    professionalCategoryId: category.id,
    shiftType: 'DAY',
    startsAt: SHIFT_START,
    endsAt: SHIFT_END,
    headcount: 1,
    hourlyRateKobo: HOURLY_RATE_KOBO,
    urgency: 'ROUTINE',
    cancellationTerms: 'Either party may cancel up to 24 hours before the shift.',
    actorId: scheduler.id,
  });
  await publishServiceRequest({
    requestId: request.id,
    facilityId: facility.id,
    actorId: scheduler.id,
  });

  const practitioner = await createUser({ fullName: 'Aisha Bello' });
  const [invitation] = await invitePractitioners({
    requestId: request.id,
    facilityId: facility.id,
    userIds: [practitioner.id],
    actorId: scheduler.id,
  });
  await respondToInvitation({
    invitationId: invitation!.id,
    userId: practitioner.id,
    decision: 'accept',
  });
  const assignment = await confirmAssignment({
    requestId: request.id,
    facilityId: facility.id,
    userId: practitioner.id,
    actorId: scheduler.id,
  });

  await recordManualAttendance({
    assignmentId: assignment.id,
    actorId: scheduler.id,
    checkedInAt: worked.from,
    checkedOutAt: worked.to,
    breakMinutes: 0,
    reason: 'Ward network was down for the whole shift; taken from the paper log.',
  });
  await submitTimesheet({ assignmentId: assignment.id, userId: practitioner.id });
  await reviewTimesheet({
    assignmentId: assignment.id,
    facilityId: facility.id,
    actorId: reviewer.id,
    decision: 'approve',
  });

  return {
    facilityId: facility.id,
    schedulerId: scheduler.id,
    reviewerId: reviewer.id,
    financeId: finance.id,
    practitionerId: practitioner.id,
    assignmentId: assignment.id,
  };
}

const period = (world: World) => ({
  facilityId: world.facilityId,
  periodStart: PERIOD_START,
  periodEnd: PERIOD_END,
  actorId: world.financeId,
});

beforeEach(() => {
  clearCookies();
});

describe('a night that runs into a holiday', () => {
  /**
   * The timesheet records night and holiday minutes that overlap, because a
   * reader wants to see both. Billing needs buckets that do not, and used to
   * rebuild them by subtracting one overlapping figure from another — which
   * is only right when the holiday and the night happen to nest one way round.
   */
  // Reference data survives the reset between tests, so what a test adds has
  // to be taken away again or the next one is billed against its holidays.
  afterEach(async () => {
    await prisma.publicHoliday.deleteMany({ where: { owner: 'test' } });
  });

  async function billedWith(worked: { from: Date; to: Date }, holidays: string[]) {
    for (const date of holidays) {
      await prisma.publicHoliday.create({
        data: { date: new Date(`${date}T00:00:00.000Z`), name: `Holiday ${date}`, year: 2026, owner: 'test' },
      });
    }
    const world = await buildWorld(worked);
    const invoice = await generateInvoice(period(world));
    const line = invoice.lines[0]!;
    return { line, total: line.ordinaryMinutes + line.nightMinutes + line.holidayMinutes };
  }

  it('loses no minutes when the holiday starts part-way through the night', async () => {
    // 18:00 WAT Thursday to 02:00 Friday; Friday is the holiday.
    //   18:00-20:00 ordinary (120), 20:00-00:00 night (240), 00:00-02:00 holiday (120).
    const { line, total } = await billedWith(
      { from: new Date('2026-09-10T17:00:00.000Z'), to: new Date('2026-09-11T01:00:00.000Z') },
      ['2026-09-11'],
    );
    expect(line).toMatchObject({ ordinaryMinutes: 120, nightMinutes: 240, holidayMinutes: 120 });
    expect(total).toBe(480);
  });

  it('loses no minutes when the holiday is the evening and the night runs past it', async () => {
    // Same shift, Thursday the holiday: 18:00-00:00 holiday (360), 00:00-02:00 night (120).
    const { line, total } = await billedWith(
      { from: new Date('2026-09-10T17:00:00.000Z'), to: new Date('2026-09-11T01:00:00.000Z') },
      ['2026-09-10'],
    );
    expect(line).toMatchObject({ ordinaryMinutes: 0, nightMinutes: 120, holidayMinutes: 360 });
    expect(total).toBe(480);
  });

  it('bills the whole of a night that is wholly inside the holiday as holiday', async () => {
    // 22:00 Thursday to 04:00 Friday, both days holidays: six hours, all holiday.
    const { line, total } = await billedWith(
      { from: new Date('2026-09-10T21:00:00.000Z'), to: new Date('2026-09-11T03:00:00.000Z') },
      ['2026-09-10', '2026-09-11'],
    );
    expect(line).toMatchObject({ ordinaryMinutes: 0, nightMinutes: 0, holidayMinutes: 360 });
    expect(total).toBe(360);
  });
});

describe('invoicing approved work', () => {
  it('bills eight hours at the agreed rate when no rate card is set', async () => {
    const world = await buildWorld();
    const invoice = await generateInvoice(period(world));

    // No card means par on every band: exactly what the timesheet said.
    expect(invoice.lines).toHaveLength(1);
    expect(invoice.grossKobo).toBe(4_000_000);
    expect(invoice.lines[0]!.baseKobo).toBe(4_000_000);
    expect(invoice.lines[0]!.premiumKobo).toBe(0);
    expect(invoice.status).toBe('DRAFT');
  });

  it('takes no platform fee while step 3.1 is unsettled', async () => {
    const world = await buildWorld();
    const invoice = await generateInvoice(period(world));

    expect(invoice.platformFeeKobo).toBe(0);
    const platform = await accountBalance('PLATFORM_REVENUE');
    expect(platform).toBe(0);
  });

  it('refuses to bill the same shift twice', async () => {
    const world = await buildWorld();
    await generateInvoice(period(world));

    // Nothing left to bill, rather than a second invoice for the same work.
    await expect(generateInvoice(period(world))).rejects.toThrow(/No approved shifts/);
  });

  it('will not bill a shift that has not been approved', async () => {
    const world = await buildWorld();
    await prisma.attendanceRecord.update({
      where: { assignmentId: world.assignmentId },
      data: { status: 'SUBMITTED' },
    });

    await expect(generateInvoice(period(world))).rejects.toThrow(/No approved shifts/);
  });

  it('publishes InvoiceCreated and writes an audit row', async () => {
    const world = await buildWorld();
    const invoice = await generateInvoice(period(world));

    const event = await prisma.outboxEvent.findFirst({
      where: { eventType: EVENTS.InvoiceCreated, aggregateId: invoice.id },
    });
    expect(event).not.toBeNull();

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'invoice.created', entityId: invoice.id },
    });
    expect(audit?.actorId).toBe(world.financeId);
  });

  it("names the practitioner on each line, reading the list back", async () => {
    const world = await buildWorld();
    await generateInvoice(period(world));

    const [invoice] = (await listInvoices(world.facilityId)).invoices;
    expect(invoice!.lines[0]).toMatchObject({
      practitionerId: world.practitionerId,
      practitionerName: 'Aisha Bello',
    });
  });
});

describe('a rate card changes the figures', () => {
  it('pays a night premium on night minutes', async () => {
    // 20:00–04:00 WAT: entirely inside the night window, worked and recorded
    // as a real shift rather than by editing the timesheet's figures after the
    // fact — the bands are computed once, at the timesheet, and billing reads
    // them back.
    const world = await buildWorld(
      {
        from: new Date('2026-09-09T19:00:00.000Z'),
        to: new Date('2026-09-10T03:00:00.000Z'),
      },
      { name: 'Night premium', nightMultiplierBp: 15_000 },
    );

    const invoice = await generateInvoice(period(world));
    // Eight night hours at 1.5x ₦5,000.
    expect(invoice.grossKobo).toBe(6_000_000);
    expect(invoice.lines[0]!.premiumKobo).toBe(2_000_000);
  });

  it('leaves the figures alone at par', async () => {
    const world = await buildWorld(undefined, { name: 'No allowances' });

    const invoice = await generateInvoice(period(world));
    expect(invoice.grossKobo).toBe(4_000_000);
    expect(invoice.lines[0]!.premiumKobo).toBe(0);
  });

  it('supersedes the previous card rather than deleting it', async () => {
    const world = await buildWorld();
    const first = await createRateCard({
      facilityId: world.facilityId,
      actorId: world.reviewerId,
      name: 'First',
      nightMultiplierBp: 12_000,
    });
    await createRateCard({
      facilityId: world.facilityId,
      actorId: world.reviewerId,
      name: 'Second',
      nightMultiplierBp: 15_000,
    });

    // An invoice raised last month must stay readable against the card that
    // priced it, so the old one is kept with its dates.
    const old = await prisma.rateCard.findUniqueOrThrow({ where: { id: first.id } });
    expect(old.status).toBe('SUPERSEDED');
    expect(old.effectiveUntil).not.toBeNull();

    const active = await prisma.rateCard.findMany({
      where: { facilityId: world.facilityId, status: 'ACTIVE' },
    });
    expect(active).toHaveLength(1);
    expect(active[0]!.name).toBe('Second');
  });

  it('refuses a multiplier below par', async () => {
    const world = await buildWorld();
    await expect(
      createRateCard({
        facilityId: world.facilityId,
        actorId: world.reviewerId,
        name: 'A rate cut in disguise',
        nightMultiplierBp: 9_000,
      }),
    ).rejects.toThrow(/below_par/);
  });
});

describe('premiums are fixed when the shift is booked', () => {
  /**
   * One card, chosen when the invoice was raised, priced every shift on it. A
   * facility could book a night shift under a 1.5x card and supersede it with a
   * 1.0x one before the invoice, and the practitioner would be paid the lower
   * figure for work they had agreed at the higher.
   */
  const NIGHT = {
    from: new Date('2026-09-09T19:00:00.000Z'),
    to: new Date('2026-09-10T03:00:00.000Z'),
  };

  it('is priced on the card that applied when it was booked, not the one that applies when it is invoiced', async () => {
    const world = await buildWorld(NIGHT, { name: 'At booking', nightMultiplierBp: 15_000 });

    // The facility replaces its card afterwards, down to par.
    await createRateCard({
      facilityId: world.facilityId,
      actorId: world.reviewerId,
      name: 'Cut after booking',
      nightMultiplierBp: 10_000,
    });

    const invoice = await generateInvoice(period(world));
    // Eight night hours at 1.5x ₦5,000, as agreed.
    expect(invoice.grossKobo).toBe(6_000_000);
    expect(invoice.lines[0]!.premiumKobo).toBe(2_000_000);
  });

  it('is not raised by a card created after it was booked either', async () => {
    const world = await buildWorld(NIGHT, { name: 'At booking', nightMultiplierBp: 10_000 });

    await createRateCard({
      facilityId: world.facilityId,
      actorId: world.reviewerId,
      name: 'Raised after booking',
      nightMultiplierBp: 20_000,
    });

    const invoice = await generateInvoice(period(world));
    expect(invoice.grossKobo).toBe(4_000_000);
    expect(invoice.lines[0]!.premiumKobo).toBe(0);
  });

  it('keeps the terms on the booking, with the card they came from', async () => {
    const world = await buildWorld(NIGHT, { name: 'At booking', nightMultiplierBp: 15_000 });

    const row = await prisma.assignment.findUniqueOrThrow({ where: { id: world.assignmentId } });
    expect(row.rateTerms).toMatchObject({
      nightMultiplierBp: 15_000,
      holidayMultiplierBp: 10_000,
    });
    const card = await prisma.rateCard.findFirstOrThrow({ where: { facilityId: world.facilityId } });
    expect(row.rateTerms).toHaveProperty('rateCardId', card.id);
  });

  it('is at par when there was no card at booking, and a later card does not change that', async () => {
    const world = await buildWorld(NIGHT);
    await createRateCard({
      facilityId: world.facilityId,
      actorId: world.reviewerId,
      name: 'Created afterwards',
      nightMultiplierBp: 15_000,
    });

    const invoice = await generateInvoice(period(world));
    expect(invoice.grossKobo).toBe(4_000_000);
    const row = await prisma.assignment.findUniqueOrThrow({ where: { id: world.assignmentId } });
    expect(row.rateTerms).toMatchObject({ rateCardId: null, nightMultiplierBp: 10_000 });
  });

  it('uses the card whose dates cover the shift, for a booking made before any terms were kept', async () => {
    // A booking from before this change has no terms on it. It is priced by the
    // card in force on the shift's date - not whichever is active today.
    const world = await buildWorld(NIGHT);
    await prisma.assignment.update({ where: { id: world.assignmentId }, data: { rateTerms: Prisma.DbNull } });
    const shift = await prisma.assignment.findUniqueOrThrow({ where: { id: world.assignmentId } });

    const before = new Date(shift.startsAt.getTime() - 30 * 24 * 60 * 60 * 1000);
    await prisma.rateCard.create({
      data: {
        facilityId: world.facilityId,
        name: 'In force on the day',
        nightMultiplierBp: 15_000,
        status: 'SUPERSEDED',
        effectiveFrom: before,
        effectiveUntil: new Date(shift.startsAt.getTime() + 24 * 60 * 60 * 1000),
        createdBy: world.reviewerId,
      },
    });
    await prisma.rateCard.create({
      data: {
        facilityId: world.facilityId,
        name: 'Only from next month',
        nightMultiplierBp: 30_000,
        status: 'ACTIVE',
        effectiveFrom: new Date(shift.startsAt.getTime() + 30 * 24 * 60 * 60 * 1000),
        createdBy: world.reviewerId,
      },
    });

    const invoice = await generateInvoice(period(world));
    expect(invoice.grossKobo).toBe(6_000_000);
  });
});

describe('the ledger', () => {
  it('balances to zero after every step of the cycle', async () => {
    const world = await buildWorld();
    const invoice = await generateInvoice(period(world));

    // Work approved: the facility owes, the practitioner is owed.
    expect(await accountBalance('FACILITY_PAYABLE', world.facilityId)).toBe(4_000_000);
    expect(await amountOwed(world.practitionerId)).toBe(4_000_000);

    await issueInvoice({ invoiceId: invoice.id, actorId: world.financeId });
    await recordPayment({ invoiceId: invoice.id, actorId: world.financeId });

    expect(await accountBalance('FACILITY_PAYABLE', world.facilityId)).toBe(0);
    expect(await accountBalance('CASH')).toBe(4_000_000);

    const payout = await preparePayout({
      practitionerId: world.practitionerId,
      actorId: world.financeId,
    });
    await releasePayout({ payoutId: payout.id, actorId: world.financeId });

    // Everything settled: nothing left anywhere.
    expect(await amountOwed(world.practitionerId)).toBe(0);
    expect(await accountBalance('CASH')).toBe(0);

    const all = await prisma.ledgerEntry.aggregate({ _sum: { amountKobo: true } });
    expect(all._sum.amountKobo).toBe(0);
  });

  it('sums every transaction to zero', async () => {
    const world = await buildWorld();
    const invoice = await generateInvoice(period(world));
    await issueInvoice({ invoiceId: invoice.id, actorId: world.financeId });
    await recordPayment({ invoiceId: invoice.id, actorId: world.financeId });

    const rows = await prisma.ledgerEntry.groupBy({
      by: ['transactionId'],
      _sum: { amountKobo: true },
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row._sum.amountKobo, row.transactionId).toBe(0);
    }
  });
});

describe('paying a practitioner', () => {
  it('settles through the stub and clears what was owed', async () => {
    const world = await buildWorld();
    const invoice = await generateInvoice(period(world));
    await issueInvoice({ invoiceId: invoice.id, actorId: world.financeId });
    await recordPayment({ invoiceId: invoice.id, actorId: world.financeId });

    const prepared = await preparePayout({
      practitionerId: world.practitionerId,
      actorId: world.financeId,
    });
    expect(prepared.status).toBe('PREPARED');
    expect(prepared.amountKobo).toBe(4_000_000);

    const released = await releasePayout({ payoutId: prepared.id, actorId: world.financeId });
    expect(released.status).toBe('SETTLED');
    // The stub says so in the reference, so nobody mistakes it for a bank one.
    expect(released.providerReference).toMatch(/^stub-/);

    const event = await prisma.outboxEvent.findFirst({
      where: { eventType: EVENTS.PayoutSettled, aggregateId: prepared.id },
    });
    expect(event).not.toBeNull();
  });

  it('will not prepare a second payout for money already in flight', async () => {
    const world = await buildWorld();
    await generateInvoice(period(world));

    await preparePayout({ practitionerId: world.practitionerId, actorId: world.financeId });
    await expect(
      preparePayout({ practitionerId: world.practitionerId, actorId: world.financeId }),
    ).rejects.toThrow(/not owed anything/);
  });

  it('prepares one payout, not two, when the button is pressed twice at once', async () => {
    // Each press used to read the same balance and the same empty in-flight
    // total, and both created a payout of the full amount.
    const world = await buildWorld();
    await generateInvoice(period(world));

    const press = () =>
      preparePayout({ practitionerId: world.practitionerId, actorId: world.financeId });
    const results = await Promise.allSettled([press(), press(), press()]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    for (const result of results) {
      if (result.status === 'rejected') expect(result.reason).toMatchObject({ code: 'nothing_owed' });
    }
    const payouts = await prisma.payout.findMany({ where: { practitionerId: world.practitionerId } });
    expect(payouts).toHaveLength(1);
    expect(payouts[0]!.amountKobo).toBe(4_000_000);
  });

  it('will not release more than the practitioner is owed by the time it is released', async () => {
    const world = await buildWorld();
    await generateInvoice(period(world));
    const payout = await preparePayout({
      practitionerId: world.practitionerId,
      actorId: world.financeId,
    });

    // The balance falls between preparing and releasing: money goes out some
    // other way (here, a second payout settling first).
    const transactionId = '00000000-0000-0000-0000-00000000b04a';
    await prisma.ledgerEntry.createMany({
      data: [
        { transactionId, account: 'PRACTITIONER_EARNINGS', amountKobo: 1_000_000, subjectId: world.practitionerId, memo: 'test: paid some other way' },
        { transactionId, account: 'CASH', amountKobo: -1_000_000, memo: 'test: paid some other way' },
      ],
    });

    await expect(
      releasePayout({ payoutId: payout.id, actorId: world.financeId }),
    ).rejects.toMatchObject({ code: 'payout_exceeds_balance' });
    expect((await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } })).status).toBe(
      'PREPARED',
    );
  });

  it('will not pay somebody who is owed nothing', async () => {
    const world = await buildWorld();
    await expect(
      preparePayout({ practitionerId: world.practitionerId, actorId: world.financeId }),
    ).rejects.toThrow(/not owed anything/);
  });

  it('will not release the same payout twice', async () => {
    const world = await buildWorld();
    await generateInvoice(period(world));
    const payout = await preparePayout({
      practitionerId: world.practitionerId,
      actorId: world.financeId,
    });
    await releasePayout({ payoutId: payout.id, actorId: world.financeId });

    await expect(
      releasePayout({ payoutId: payout.id, actorId: world.financeId }),
    ).rejects.toThrow(/cannot become RELEASED/);
  });

  it("reads through the route at PLATFORM scope — an officer reading someone else's is not a SELF read", async () => {
    const world = await buildWorld();
    await generateInvoice(period(world));
    await preparePayout({ practitionerId: world.practitionerId, actorId: world.financeId });
    await issueSession({ userId: world.financeId });

    const platform = await getPayoutsRoute(
      new Request(
        `http://localhost/api/v1/payouts?scopeType=PLATFORM&scopeId=${world.practitionerId}`,
      ),
    );
    expect(platform.status).toBe(200);
    const body = (await platform.json()) as { payouts: { practitionerId: string }[] };
    expect(body.payouts).toHaveLength(1);
    expect(body.payouts[0]?.practitionerId).toBe(world.practitionerId);

    // SELF means "the caller's own" — an officer holding only a PLATFORM
    // grant has no SELF-scoped standing over somebody else's id, whatever
    // permission they hold. This is the exact shape the console got wrong
    // before it was fixed to ask for PLATFORM.
    const self = await getPayoutsRoute(
      new Request(`http://localhost/api/v1/payouts?scopeType=SELF&scopeId=${world.practitionerId}`),
    );
    expect(self.status).toBe(403);
  });

  it('tells a practitioner what they are owed as well as what has been paid', async () => {
    const world = await buildWorld();
    await grant({
      userId: world.practitionerId,
      roleKey: 'practitioner',
      permissions: ['invoice.read'],
      scopeType: 'SELF',
      scopeId: world.practitionerId,
    });
    await generateInvoice(period(world));
    await issueSession({ userId: world.practitionerId });

    const read = async () => {
      const response = await getPayoutsRoute(
        new Request('http://localhost/api/v1/payouts?scopeType=SELF'),
      );
      expect(response.status).toBe(200);
      return (await response.json()) as { payouts: unknown[]; owedKobo: number };
    };

    // Credited when the work was invoiced, and nothing paid out yet.
    expect(await read()).toEqual({ payouts: [], owedKobo: 4_000_000 });

    const payout = await preparePayout({
      practitionerId: world.practitionerId,
      actorId: world.financeId,
    });
    await releasePayout({ payoutId: payout.id, actorId: world.financeId });

    const after = await read();
    expect(after.payouts).toHaveLength(1);
    expect(after.owedKobo).toBe(await amountOwed(world.practitionerId));
  });
});

describe('invoice status', () => {
  it('will not pay a draft that was never issued', async () => {
    const world = await buildWorld();
    const invoice = await generateInvoice(period(world));

    await expect(
      recordPayment({ invoiceId: invoice.id, actorId: world.financeId }),
    ).rejects.toThrow(/cannot become PAID/);
  });

  it('will not issue the same invoice twice', async () => {
    const world = await buildWorld();
    const invoice = await generateInvoice(period(world));
    await issueInvoice({ invoiceId: invoice.id, actorId: world.financeId });

    await expect(
      issueInvoice({ invoiceId: invoice.id, actorId: world.financeId }),
    ).rejects.toThrow(/cannot become ISSUED/);
  });
});
