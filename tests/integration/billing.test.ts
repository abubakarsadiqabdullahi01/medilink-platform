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
import {
  reviewTimesheet,
  submitTimesheet,
  timesheetsForAssignments,
} from '@/modules/timesheets/application/timesheet';
import { createRateCard } from '@/modules/rates-contracts/application/rate-card';
import { raiseDispute, withdrawDispute } from '@/modules/disputes/application/dispute';
import {
  accountBalance,
  generateInvoice,
  issueInvoice,
  listInvoices,
  recordPayment,
  voidInvoice,
} from '@/modules/billing-settlement/application/invoice';
import {
  amountOwed,
  preparePayout,
  releasePayout,
} from '@/modules/billing-settlement/application/payout';
import { GET as getPayoutsRoute } from '@/app/api/v1/payouts/route';
import { POST as issueInvoiceRoute } from '@/app/api/v1/invoices/[id]/issue/route';
import { POST as voidInvoiceRoute } from '@/app/api/v1/invoices/[id]/void/route';
import { financeSummary } from '@/modules/billing-settlement/application/finance-summary';
import { POST as releasePayoutRoute } from '@/app/api/v1/payouts/[id]/release/route';
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
  /**
   * For a practitioner who works for more than one facility: the same person, on
   * a shift that does not overlap the first.
   */
  again?: { practitionerId: string; shiftOffsetDays: number },
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
    startsAt: new Date(SHIFT_START.getTime() + (again?.shiftOffsetDays ?? 0) * 24 * 60 * 60 * 1000),
    endsAt: new Date(SHIFT_END.getTime() + (again?.shiftOffsetDays ?? 0) * 24 * 60 * 60 * 1000),
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

  const practitioner = again
    ? { id: again.practitionerId }
    : await createUser({ fullName: 'Aisha Bello' });
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

describe('the approval screen states what will be billed', () => {
  /**
   * The facility approved "₦40,000" and was invoiced ₦60,000: the timesheet's
   * own amount is the hours at the base rate, and the premiums the facility's
   * own card adds are applied only when the invoice is raised. What a person is
   * asked to approve has to be what they are then billed.
   */
  const NIGHT = {
    from: new Date('2026-09-09T19:00:00.000Z'),
    to: new Date('2026-09-10T03:00:00.000Z'),
  };

  async function sheetOf(assignmentId: string) {
    const sheets = await timesheetsForAssignments([assignmentId]);
    return sheets.get(assignmentId)!.timesheet;
  }

  it('carries the premium-inclusive figure and says how much of it is premium', async () => {
    const world = await buildWorld(NIGHT, { name: 'At booking', nightMultiplierBp: 15_000 });

    const sheet = await sheetOf(world.assignmentId);
    // The hours at the base rate are still there; they are not what is billed.
    expect(sheet.amountKobo).toBe(4_000_000);
    expect(sheet.premiumKobo).toBe(2_000_000);
    expect(sheet.billedKobo).toBe(6_000_000);
  });

  it('is the figure the invoice then bills', async () => {
    const world = await buildWorld(NIGHT, { name: 'At booking', nightMultiplierBp: 15_000 });

    const sheet = await sheetOf(world.assignmentId);
    const invoice = await generateInvoice(period(world));
    expect(sheet.billedKobo).toBe(invoice.grossKobo);
  });

  it('does not move when the facility changes its card afterwards', async () => {
    const world = await buildWorld(NIGHT, { name: 'At booking', nightMultiplierBp: 15_000 });
    await createRateCard({
      facilityId: world.facilityId,
      actorId: world.reviewerId,
      name: 'Cut after booking',
      nightMultiplierBp: 10_000,
    });

    expect((await sheetOf(world.assignmentId)).billedKobo).toBe(6_000_000);
  });

  it('is the base figure when there are no allowances', async () => {
    const world = await buildWorld(NIGHT);

    const sheet = await sheetOf(world.assignmentId);
    expect(sheet.premiumKobo).toBe(0);
    expect(sheet.billedKobo).toBe(sheet.amountKobo);
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
    expect(await read()).toEqual({ payouts: [], owedKobo: 4_000_000, heldKobo: 0 });

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

describe('money acts need a fresh password', () => {
  /**
   * BIL-12. Issuing a bill and sending a payout are what an open finance
   * session on a stolen laptop is used for. The guard already asked for a fresh
   * password on two permissions; neither was a money act.
   */
  const post = (path: string, id: string, body: object) => ({
    request: new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    params: { params: Promise.resolve({ id }) },
  });

  it('refuses to issue an invoice on an ordinary session, and leaves it a draft', async () => {
    const world = await buildWorld();
    const invoice = await generateInvoice(period(world));
    await issueSession({ userId: world.financeId });

    const call = post(`/api/v1/invoices/${invoice.id}/issue`, invoice.id, { facilityId: world.facilityId });
    const response = await issueInvoiceRoute(call.request, call.params);

    expect(response.status).toBe(401);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('step_up_required');
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe('DRAFT');
  });

  it('issues it once the password has been confirmed', async () => {
    const world = await buildWorld();
    const invoice = await generateInvoice(period(world));
    await issueSession({ userId: world.financeId, stepUp: true });

    const call = post(`/api/v1/invoices/${invoice.id}/issue`, invoice.id, { facilityId: world.facilityId });
    const response = await issueInvoiceRoute(call.request, call.params);

    expect(response.status).toBe(200);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe('ISSUED');
  });

  it('refuses to release a payout on an ordinary session, and sends nothing', async () => {
    const world = await buildWorld();
    await generateInvoice(period(world));
    const payout = await preparePayout({ practitionerId: world.practitionerId, actorId: world.financeId });
    await issueSession({ userId: world.financeId });

    const call = post(`/api/v1/payouts/${payout.id}/release`, payout.id, {});
    const response = await releasePayoutRoute(call.request, call.params);

    expect(response.status).toBe(401);
    expect((await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } })).status).toBe('PREPARED');
  });
});

describe('payouts and disputes', () => {
  /**
   * BIL-10. A payout paid a practitioner everything the ledger said they were
   * owed, including the shift a dispute was open over. A dispute holds what was
   * credited for that shift and nothing else.
   */
  const FOUR_HOURS = {
    from: new Date('2026-09-10T07:00:00.000Z'),
    to: new Date('2026-09-10T11:00:00.000Z'),
  };
  const EIGHT_HOUR_PAY = 4_000_000;
  const FOUR_HOUR_PAY = 2_000_000;

  /** Two shifts for one practitioner at two facilities, each invoiced: ₦40,000 then ₦20,000. */
  async function twoInvoicedShifts() {
    const first = await buildWorld();
    await generateInvoice(period(first));
    const second = await buildWorld(FOUR_HOURS, undefined, {
      practitionerId: first.practitionerId,
      shiftOffsetDays: 2,
    });
    await generateInvoice(period(second));
    return { first, second };
  }

  const dispute = (assignmentId: string, actorId: string) =>
    raiseDispute({
      assignmentId,
      actorId,
      category: 'PAY',
      reason: 'The rate on the timesheet is lower than the one on the offer I accepted.',
    });

  it('pays what is not in dispute and holds the shift that is', async () => {
    const { first, second } = await twoInvoicedShifts();
    await dispute(first.assignmentId, first.practitionerId);

    const payout = await preparePayout({ practitionerId: first.practitionerId, actorId: second.financeId });

    expect(payout.amountKobo).toBe(FOUR_HOUR_PAY);
  });

  it('says what is held, next to what is owed', async () => {
    const { first, second } = await twoInvoicedShifts();
    await dispute(first.assignmentId, first.practitionerId);
    await issueSession({ userId: second.financeId });

    const response = await getPayoutsRoute(
      new Request(
        `http://localhost/api/v1/payouts?scopeType=PLATFORM&scopeId=${first.practitionerId}`,
      ),
    );
    const body = (await response.json()) as { owedKobo: number; heldKobo: number };
    expect(body.owedKobo).toBe(EIGHT_HOUR_PAY + FOUR_HOUR_PAY);
    expect(body.heldKobo).toBe(EIGHT_HOUR_PAY);
  });

  it('refuses to prepare a payout when everything owed is in dispute, and creates nothing', async () => {
    const world = await buildWorld();
    await generateInvoice(period(world));
    await dispute(world.assignmentId, world.practitionerId);

    await expect(
      preparePayout({ practitionerId: world.practitionerId, actorId: world.financeId }),
    ).rejects.toMatchObject({ code: 'payout_held', status: 409 });
    expect(await prisma.payout.count()).toBe(0);
  });

  it('will not release a payout prepared before the dispute was raised', async () => {
    const world = await buildWorld();
    await generateInvoice(period(world));
    const payout = await preparePayout({ practitionerId: world.practitionerId, actorId: world.financeId });

    await dispute(world.assignmentId, world.practitionerId);

    await expect(
      releasePayout({ payoutId: payout.id, actorId: world.financeId }),
    ).rejects.toMatchObject({ code: 'payout_held' });
    expect((await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } })).status).toBe('PREPARED');
  });

  it('releases what is not in dispute even when something else is', async () => {
    const { first, second } = await twoInvoicedShifts();
    await dispute(first.assignmentId, first.practitionerId);
    const payout = await preparePayout({ practitionerId: first.practitionerId, actorId: second.financeId });

    const released = await releasePayout({ payoutId: payout.id, actorId: second.financeId });

    expect(released.amountKobo).toBe(FOUR_HOUR_PAY);
    expect(released.status).toMatch(/RELEASED|SETTLED/);
  });

  it('lets go once the dispute is withdrawn', async () => {
    const world = await buildWorld();
    await generateInvoice(period(world));
    const raised = await dispute(world.assignmentId, world.practitionerId);
    await withdrawDispute({ disputeId: raised.id, actorId: world.practitionerId });

    const payout = await preparePayout({ practitionerId: world.practitionerId, actorId: world.financeId });
    expect(payout.amountKobo).toBe(EIGHT_HOUR_PAY);
  });

  it('does not hold this month\'s earnings for a shift that was paid for last month', async () => {
    // The first shift is paid out in full; it is then disputed. Money already
    // sent cannot be held, and the practitioner's later work is not its hostage.
    const first = await buildWorld();
    await generateInvoice(period(first));
    const paid = await preparePayout({ practitionerId: first.practitionerId, actorId: first.financeId });
    await releasePayout({ payoutId: paid.id, actorId: first.financeId });

    const second = await buildWorld(FOUR_HOURS, undefined, {
      practitionerId: first.practitionerId,
      shiftOffsetDays: 2,
    });
    await generateInvoice(period(second));
    await dispute(first.assignmentId, first.practitionerId);

    const payout = await preparePayout({ practitionerId: first.practitionerId, actorId: second.financeId });
    expect(payout.amountKobo).toBe(FOUR_HOUR_PAY);
  });
});

describe('voiding a draft invoice', () => {
  /**
   * BIL-08. VOID was in the database and nothing set it: a draft raised from the
   * wrong figures could not be cancelled, because its lines pinned the shifts and
   * the ledger had already credited the practitioner. A void reverses the
   * entries rather than deleting them, and frees the shifts to be invoiced again.
   */
  const REASON = 'Raised against the wrong period; the timesheet is being corrected first.';

  it('marks it void, reverses what the ledger credited, and keeps both', async () => {
    const world = await buildWorld();
    const invoice = await generateInvoice(period(world));
    expect(await accountBalance('FACILITY_PAYABLE', world.facilityId)).toBe(4_000_000);

    const voided = await voidInvoice({ invoiceId: invoice.id, actorId: world.financeId, reason: REASON });

    expect(voided.status).toBe('VOID');
    expect(await accountBalance('FACILITY_PAYABLE', world.facilityId)).toBe(0);
    expect(await amountOwed(world.practitionerId)).toBe(0);
    // Reversed, not deleted: the original credit and its reversal are both on the ledger.
    expect(await prisma.ledgerEntry.count({ where: { invoiceId: invoice.id } })).toBe(4);
    const all = await prisma.ledgerEntry.aggregate({ _sum: { amountKobo: true } });
    expect(all._sum.amountKobo).toBe(0);
  });

  it('records who voided it and why', async () => {
    const world = await buildWorld();
    const invoice = await generateInvoice(period(world));

    await voidInvoice({ invoiceId: invoice.id, actorId: world.financeId, reason: REASON });

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'invoice.voided' } });
    expect(audit.actorId).toBe(world.financeId);
    expect(audit.entityId).toBe(invoice.id);
    expect(audit.reason).toBe(REASON);
    expect(audit.before).toMatchObject({ status: 'DRAFT' });
    expect(audit.after).toMatchObject({ status: 'VOID' });
  });

  it('frees the shifts, so they can be invoiced again, once', async () => {
    const world = await buildWorld();
    const first = await generateInvoice(period(world));
    await voidInvoice({ invoiceId: first.id, actorId: world.financeId, reason: REASON });

    const second = await generateInvoice(period(world));

    expect(second.id).not.toBe(first.id);
    expect(second.grossKobo).toBe(4_000_000);
    // Credited once net, however many invoices have carried the shift.
    expect(await amountOwed(world.practitionerId)).toBe(4_000_000);
    await expect(generateInvoice(period(world))).rejects.toThrow(/No approved shifts/);
  });

  it('keeps one live invoice line per shift on the database', async () => {
    const world = await buildWorld();
    const invoice = await generateInvoice(period(world));
    const line = invoice.lines[0]!;

    await expect(
      prisma.invoiceLine.create({
        data: {
          invoiceId: invoice.id,
          assignmentId: line.assignmentId,
          practitionerId: line.practitionerId,
          hourlyRateKobo: line.hourlyRateKobo,
          ordinaryMinutes: 0,
          nightMinutes: 0,
          holidayMinutes: 0,
          overtimeMinutes: 0,
          onCallMinutes: 0,
          baseKobo: 0,
          premiumKobo: 0,
          amountKobo: 0,
        },
      }),
    ).rejects.toThrow();
  });

  it('will not void an invoice that has been issued', async () => {
    const world = await buildWorld();
    const invoice = await generateInvoice(period(world));
    await issueInvoice({ invoiceId: invoice.id, actorId: world.financeId });

    await expect(
      voidInvoice({ invoiceId: invoice.id, actorId: world.financeId, reason: REASON }),
    ).rejects.toMatchObject({ code: 'invoice_wrong_status' });
    expect(await accountBalance('FACILITY_PAYABLE', world.facilityId)).toBe(4_000_000);
  });

  it('will not void it twice', async () => {
    const world = await buildWorld();
    const invoice = await generateInvoice(period(world));
    await voidInvoice({ invoiceId: invoice.id, actorId: world.financeId, reason: REASON });

    await expect(
      voidInvoice({ invoiceId: invoice.id, actorId: world.financeId, reason: REASON }),
    ).rejects.toMatchObject({ code: 'invoice_wrong_status' });
    expect(await prisma.ledgerEntry.count({ where: { invoiceId: invoice.id } })).toBe(4);
  });

  it('will not void money that has been paid out or is on its way', async () => {
    const world = await buildWorld();
    const invoice = await generateInvoice(period(world));
    await preparePayout({ practitionerId: world.practitionerId, actorId: world.financeId });

    await expect(
      voidInvoice({ invoiceId: invoice.id, actorId: world.financeId, reason: REASON }),
    ).rejects.toMatchObject({ code: 'invoice_paid_out', status: 409 });
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe('DRAFT');
    expect(await amountOwed(world.practitionerId)).toBe(4_000_000);
  });

  it('is not lost to a failed payout, which moved nothing', async () => {
    const world = await buildWorld();
    const invoice = await generateInvoice(period(world));
    const payout = await preparePayout({ practitionerId: world.practitionerId, actorId: world.financeId });
    await prisma.payout.update({ where: { id: payout.id }, data: { status: 'FAILED' } });

    const voided = await voidInvoice({ invoiceId: invoice.id, actorId: world.financeId, reason: REASON });
    expect(voided.status).toBe('VOID');
  });

  it('leaves exactly one of a void and an issue standing when both are pressed at once', async () => {
    const world = await buildWorld();
    const invoice = await generateInvoice(period(world));

    const outcomes = await Promise.allSettled([
      voidInvoice({ invoiceId: invoice.id, actorId: world.financeId, reason: REASON }),
      issueInvoice({ invoiceId: invoice.id, actorId: world.financeId }),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const status = (await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status;
    expect(['VOID', 'ISSUED']).toContain(status);
    // The ledger agrees with whichever won.
    expect(await accountBalance('FACILITY_PAYABLE', world.facilityId)).toBe(status === 'VOID' ? 0 : 4_000_000);
  });

  it('is not counted as billed or as a draft once void', async () => {
    const world = await buildWorld();
    const invoice = await generateInvoice(period(world));
    expect((await financeSummary()).totals.draftKobo).toBe(4_000_000);

    await voidInvoice({ invoiceId: invoice.id, actorId: world.financeId, reason: REASON });

    const summary = await financeSummary();
    expect(summary.totals.draftKobo).toBe(0);
    expect(summary.byMonth.reduce((sum, month) => sum + month.invoicedKobo, 0)).toBe(0);
  });

  describe('through the route', () => {
    const call = (invoiceId: string, facilityId: string, body: object) =>
      voidInvoiceRoute(
        new Request(`http://localhost/api/v1/invoices/${invoiceId}/void`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ facilityId, ...body }),
        }),
        { params: Promise.resolve({ id: invoiceId }) },
      );

    it('needs a fresh password', async () => {
      const world = await buildWorld();
      const invoice = await generateInvoice(period(world));
      await issueSession({ userId: world.financeId });

      const response = await call(invoice.id, world.facilityId, { reason: REASON });

      expect(response.status).toBe(401);
      expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe('DRAFT');
    });

    it('needs a reason somebody could read later', async () => {
      const world = await buildWorld();
      const invoice = await generateInvoice(period(world));
      await issueSession({ userId: world.financeId, stepUp: true });

      expect((await call(invoice.id, world.facilityId, { reason: 'oops' })).status).toBe(422);
      expect((await call(invoice.id, world.facilityId, {})).status).toBe(422);
    });

    it('voids it for a finance officer with a fresh session', async () => {
      const world = await buildWorld();
      const invoice = await generateInvoice(period(world));
      await issueSession({ userId: world.financeId, stepUp: true });

      const response = await call(invoice.id, world.facilityId, { reason: REASON });

      expect(response.status).toBe(200);
      expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe('VOID');
    });
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
