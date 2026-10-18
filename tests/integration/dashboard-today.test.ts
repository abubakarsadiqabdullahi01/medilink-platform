import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', async () => {
  const { cookieJar } = await import('./support/cookie-jar');
  return { cookies: () => cookieJar };
});

import { prisma } from '@/lib/db';
import { lagosDate, startOfLagosDay } from '@/lib/lagos-date';
import { GET as practitionerRoute } from '@/app/api/v1/dashboard/practitioner/route';
import { issueSession } from '@/modules/auth/application/session-service';
import { facilitySummary } from '@/modules/audit-compliance/application/facility-summary';
import { platformSummary } from '@/modules/audit-compliance/application/platform-summary';
import { raiseRequest } from '@/modules/audit-compliance/application/data-subject';
import { clearCookies } from './support/cookie-jar';
import { buildBookingWorld, eligiblePractitioner } from './support/booking-world';
import { createUser, grant } from './support/fixtures';

/**
 * What the dashboards say when somebody asks "what do I do now?".
 *
 * These are additions to the summaries, so what is pinned here is that each number counts what
 * its own page lists (an offer that has lapsed is not waiting; an accepted offer that has already
 * been confirmed is not waiting for confirmation), that "today" is the Lagos day, and — above
 * all — that a section appears only for somebody who holds the permission its page needs. A
 * missing section means "not yours to see"; a zero means "none". They must never look alike.
 */

const FACILITY_PERMISSIONS = new Set([
  'service_request.read',
  'attendance.record',
  'timesheet.approve',
  'invoice.read',
  'role.grant',
]);

const HOUR = 3_600_000;

beforeEach(() => {
  clearCookies();
});

async function shiftToday(
  world: { facilityId: string; categoryId: string; schedulerId: string },
  options: { startsAt: Date; headcount?: number; status?: 'PUBLISHED' | 'FILLED' },
) {
  return prisma.serviceRequest.create({
    data: {
      facilityId: world.facilityId,
      professionalCategoryId: world.categoryId,
      shiftType: 'DAY',
      startsAt: options.startsAt,
      endsAt: new Date(options.startsAt.getTime() + 8 * HOUR),
      headcount: options.headcount ?? 1,
      hourlyRateKobo: 500_000,
      cancellationTerms: 'Either party may cancel up to 24 hours before the shift.',
      status: options.status ?? 'PUBLISHED',
      createdBy: world.schedulerId,
      publishedBy: world.schedulerId,
      publishedAt: new Date(),
    },
  });
}

async function confirmed(
  request: { id: string; facilityId: string; startsAt: Date; endsAt: Date },
  userId: string,
  by: string,
) {
  return prisma.assignment.create({
    data: {
      serviceRequestId: request.id,
      userId,
      facilityId: request.facilityId,
      startsAt: request.startsAt,
      endsAt: request.endsAt,
      status: 'CONFIRMED',
      confirmedBy: by,
    },
  });
}

describe('the facility summary: today and what is open', () => {
  it('counts today in Lagos time, and the places still open on shifts to come', async () => {
    const world = await buildBookingWorld({ headcount: 2 });
    const practitioner = await eligiblePractitioner(world);
    const dayStart = startOfLagosDay(lagosDate(new Date()));

    // Two places, one taken: today's coverage is 1 of 2 and the shift is unfilled.
    const today = await shiftToday(world, {
      startsAt: new Date(dayStart.getTime() + 5 * 60_000),
      headcount: 2,
    });
    await confirmed(today, practitioner.id, world.schedulerId);
    // Yesterday's shift is not today's, whatever it needed.
    await shiftToday(world, { startsAt: new Date(dayStart.getTime() - 20 * HOUR) });
    // A filled shift today still counts toward today's cover: it is what the day needed.
    await shiftToday(world, {
      startsAt: new Date(dayStart.getTime() + 2 * HOUR),
      status: 'FILLED',
    });

    const summary = await facilitySummary(world.facilityId, FACILITY_PERMISSIONS);

    expect(summary.coverage).toMatchObject({
      todayShifts: 2,
      todayNeeded: 3,
      todayFilled: 1,
      todayUnfilledShifts: 2,
    });
    // The booking world's own shift, five days out with both places free, is the one open shift to come.
    expect(summary.coverage?.openShifts).toBe(1);
    expect(summary.coverage?.openNext24h).toBe(0);
    expect(summary.coverage?.nextOpenStartsAt).toBeInstanceOf(Date);
  });

  it('counts an offer as waiting only while it can still be answered, and an acceptance only until it is confirmed', async () => {
    const world = await buildBookingWorld({ headcount: 3 });
    // One after another: each takes the next identity number, and two at once would take the same.
    const waiting = await eligiblePractitioner(world, 'Waiting Person');
    const lapsed = await eligiblePractitioner(world, 'Lapsed Person');
    const accepted = await eligiblePractitioner(world, 'Accepted Person');
    const confirmedAlready = await eligiblePractitioner(world, 'Confirmed Person');
    const invite = (userId: string, status: 'INVITED' | 'ACCEPTED', expiresAt: Date) =>
      prisma.invitation.create({
        data: {
          serviceRequestId: world.requestId,
          userId,
          status,
          expiresAt,
          respondedAt: status === 'ACCEPTED' ? new Date() : null,
          invitedBy: world.schedulerId,
        },
      });
    await invite(waiting.id, 'INVITED', new Date(Date.now() + 6 * HOUR));
    await invite(lapsed.id, 'INVITED', new Date(Date.now() - HOUR));
    await invite(accepted.id, 'ACCEPTED', new Date(Date.now() + 6 * HOUR));
    await invite(confirmedAlready.id, 'ACCEPTED', new Date(Date.now() + 6 * HOUR));
    const request = await prisma.serviceRequest.findUniqueOrThrow({
      where: { id: world.requestId },
    });
    await confirmed(request, confirmedAlready.id, world.schedulerId);

    const summary = await facilitySummary(world.facilityId, FACILITY_PERMISSIONS);

    expect(summary.offers?.awaitingResponse).toBe(1);
    expect(summary.offers?.awaitingConfirmation).toBe(1);
    expect(summary.offers?.oldestAwaitingResponse).toBeInstanceOf(Date);
  });

  it('calls somebody "not arrived" only after the grace period, and not once they have checked in', async () => {
    const world = await buildBookingWorld();
    const late = await eligiblePractitioner(world, 'Late Person');
    const present = await eligiblePractitioner(world, 'Present Person');

    const startedAnHourAgo = await shiftToday(world, { startsAt: new Date(Date.now() - HOUR) });
    const lateRow = await confirmed(startedAnHourAgo, late.id, world.schedulerId);
    const presentSlot = await shiftToday(world, { startsAt: new Date(Date.now() - HOUR) });
    const presentRow = await confirmed(presentSlot, present.id, world.schedulerId);
    await prisma.attendanceRecord.create({
      data: {
        assignmentId: presentRow.id,
        status: 'CHECKED_IN',
        checkedInAt: new Date(Date.now() - 50 * 60_000),
      },
    });
    // Started five minutes ago: inside the grace period, not yet "late".
    const justStarted = await shiftToday(world, { startsAt: new Date(Date.now() - 5 * 60_000) });
    await confirmed(
      justStarted,
      (await eligiblePractitioner(world, 'Just Started')).id,
      world.schedulerId,
    );

    const summary = await facilitySummary(world.facilityId, FACILITY_PERMISSIONS);

    expect(summary.attendance?.notArrived).toBe(1);
    expect(summary.attendance?.notArrivedEarliestStart?.getTime()).toBe(
      startedAnHourAgo.startsAt.getTime(),
    );
    expect(lateRow.status).toBe('CONFIRMED');
  });

  it('says how many people can act for the facility and whether it has only one owner', async () => {
    const world = await buildBookingWorld();
    const administrator = await createUser({ fullName: 'Ward Administrator' });
    await grant({
      userId: administrator.id,
      roleKey: 'facility_administrator',
      permissions: ['service_request.read'],
      scopeType: 'FACILITY',
      scopeId: world.facilityId,
    });
    await prisma.staffInvitation.create({
      data: {
        facilityId: world.facilityId,
        phone: '+2348039990001',
        roleKey: 'facility_administrator',
        invitedBy: administrator.id,
        expiresAt: new Date(Date.now() + 48 * HOUR),
      },
    });
    await prisma.staffInvitation.create({
      data: {
        facilityId: world.facilityId,
        phone: '+2348039990002',
        roleKey: 'facility_administrator',
        invitedBy: administrator.id,
        expiresAt: new Date(Date.now() - 24 * HOUR),
      },
    });

    const summary = await facilitySummary(world.facilityId, FACILITY_PERMISSIONS);

    expect(summary.staff).toMatchObject({ owners: 1, pendingInvitations: 1, lapsedInvitations: 1 });
    expect(summary.staff?.people).toBeGreaterThanOrEqual(2);
  });

  it('leaves a section out for somebody who may not open its page, rather than showing zero', async () => {
    const world = await buildBookingWorld();

    const scheduler = await facilitySummary(world.facilityId, new Set(['service_request.read']));
    expect(scheduler.coverage).toBeDefined();
    expect(scheduler.offers).toBeDefined();
    expect(scheduler.attendance).toBeUndefined();
    expect(scheduler.invoices).toBeUndefined();
    expect(scheduler.staff).toBeUndefined();

    const finance = await facilitySummary(world.facilityId, new Set(['invoice.read']));
    expect(finance.invoices).toEqual({
      outstandingKobo: 0,
      outstandingCount: 0,
      oldestIssuedAt: null,
      paid30dKobo: 0,
    });
    expect(finance.coverage).toBeUndefined();
    expect(finance.offers).toBeUndefined();
  });

  it('counts only issued invoices as outstanding, and the facility’s own', async () => {
    const world = await buildBookingWorld();
    const other = await buildBookingWorld();
    const base = {
      periodStart: new Date(Date.now() - 20 * 24 * HOUR),
      periodEnd: new Date(Date.now() - 10 * 24 * HOUR),
      createdBy: world.schedulerId,
    };
    await prisma.invoice.create({
      data: {
        ...base,
        facilityId: world.facilityId,
        number: `T-${Date.now()}-1`,
        grossKobo: 1_000_000,
        status: 'ISSUED',
        issuedAt: new Date(Date.now() - 5 * 24 * HOUR),
      },
    });
    await prisma.invoice.create({
      data: {
        ...base,
        facilityId: world.facilityId,
        number: `T-${Date.now()}-2`,
        grossKobo: 700_000,
        status: 'DRAFT',
      },
    });
    await prisma.invoice.create({
      data: {
        ...base,
        facilityId: world.facilityId,
        number: `T-${Date.now()}-3`,
        grossKobo: 300_000,
        status: 'PAID',
        issuedAt: new Date(Date.now() - 9 * 24 * HOUR),
        paidAt: new Date(Date.now() - 2 * 24 * HOUR),
      },
    });
    await prisma.invoice.create({
      data: {
        ...base,
        facilityId: other.facilityId,
        number: `T-${Date.now()}-4`,
        grossKobo: 9_000_000,
        status: 'ISSUED',
        issuedAt: new Date(),
      },
    });

    const summary = await facilitySummary(world.facilityId, new Set(['invoice.read']));

    expect(summary.invoices).toMatchObject({
      outstandingKobo: 1_000_000,
      outstandingCount: 1,
      paid30dKobo: 300_000,
    });
  });
});

describe('the platform summary: privacy, health and money', () => {
  it('leaves all three out of a summary for somebody who holds none of their permissions', async () => {
    const summary = await platformSummary(new Set(['credential.review']));
    expect(summary.privacy).toBeUndefined();
    expect(summary.health).toBeUndefined();
    expect(summary.money).toBeUndefined();
  });

  it('counts open data requests against their deadline, and erasures separately', async () => {
    const person = await createUser();
    await raiseRequest({ userId: person.id, kind: 'ACCESS' });
    await raiseRequest({ userId: person.id, kind: 'ERASURE' });
    const late = await raiseRequest({ userId: person.id, kind: 'PORTABILITY' });
    await prisma.dataSubjectRequest.update({
      where: { id: late.id },
      data: { dueBy: new Date(Date.now() - 24 * HOUR) },
    });

    const summary = await platformSummary(new Set(['audit.read']));

    expect(summary.privacy).toMatchObject({ open: 3, overdue: 1, erasures: 1 });
    expect(summary.privacy?.nextDue).toBeInstanceOf(Date);
    // The deadline that matters most is the one already missed.
    expect(summary.privacy!.nextDue!.getTime()).toBeLessThan(Date.now());
    expect(summary.health?.status).toMatch(/ok|degraded/);
    expect(typeof summary.health?.problems).toBe('number');
  });

  it('shows the money acts only to somebody who may perform them', async () => {
    const reader = await platformSummary(new Set(['invoice.read']));
    expect(reader.money?.reconciliation).toEqual({
      lastRunAt: null,
      lastStatus: null,
      lastError: null,
    });
    expect(reader.money?.draftInvoices).toBeUndefined();
    expect(reader.money?.payoutsPrepared).toBeUndefined();

    const finance = await platformSummary(new Set(['invoice.read', 'payout.manage']));
    expect(finance.money?.draftInvoices).toEqual({ count: 0, oldest: null });
    expect(finance.money?.payoutsPrepared).toEqual({ count: 0, oldest: null });
    expect(finance.money?.payoutsReleased).toEqual({ count: 0, oldest: null });
  });

  it('says when the nightly reconciliation last failed, and keeps the message short', async () => {
    await prisma.scheduledJob.upsert({
      where: { key: 'billing.reconciliation_sweep' },
      update: { lastRunAt: new Date(), lastStatus: 'FAILED', lastError: 'x'.repeat(1_000) },
      create: {
        key: 'billing.reconciliation_sweep',
        description: 'Does the money add up',
        intervalSeconds: 86_400,
        lastRunAt: new Date(),
        lastStatus: 'FAILED',
        lastError: 'x'.repeat(1_000),
      },
    });

    const summary = await platformSummary(new Set(['invoice.read']));

    expect(summary.money?.reconciliation.lastStatus).toBe('FAILED');
    expect(summary.money?.reconciliation.lastError).toHaveLength(200);
  });
});

describe('the practitioner overview: what to do now', () => {
  async function practitionerWith(permissions: string[]) {
    const user = await createUser();
    await grant({
      userId: user.id,
      roleKey: 'practitioner',
      permissions: permissions as never,
      scopeType: 'SELF',
      scopeId: user.id,
    });
    await issueSession({ userId: user.id });
    return user;
  }

  async function overview() {
    const response = await practitionerRoute(
      new Request('http://localhost/api/v1/dashboard/practitioner'),
    );
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  it('carries each confirmed shift’s attendance, in one request, so it can say "check in"', async () => {
    const world = await buildBookingWorld();
    const user = await practitionerWith(['service_request.read']);
    const soon = await shiftToday(world, { startsAt: new Date(Date.now() + HOUR) });
    const row = await confirmed(soon, user.id, world.schedulerId);
    await prisma.attendanceRecord.create({
      data: { assignmentId: row.id, status: 'CHECK_IN_PENDING' },
    });

    const result = await overview();

    const assignments = result.body.assignments as {
      id: string;
      attendance: { status: string } | null;
    }[];
    expect(assignments).toHaveLength(1);
    expect(assignments[0]!.attendance?.status).toBe('CHECK_IN_PENDING');
  });

  it('gives a shift with no attendance record a null, not a missing field', async () => {
    const world = await buildBookingWorld();
    const user = await practitionerWith(['service_request.read']);
    const later = await shiftToday(world, { startsAt: new Date(Date.now() + 30 * HOUR) });
    await confirmed(later, user.id, world.schedulerId);

    const assignments = (await overview()).body.assignments as { attendance: unknown }[];

    expect(assignments[0]).toHaveProperty('attendance', null);
  });

  it('adds earnings only for somebody who may read their own, and says zero when there is nothing', async () => {
    await practitionerWith(['availability.read']);
    expect((await overview()).body.earnings).toBeUndefined();

    clearCookies();
    await practitionerWith(['availability.read', 'invoice.read']);
    const earnings = (await overview()).body.earnings as Record<string, unknown>;
    expect(earnings).toMatchObject({ owedKobo: 0, inFlightKobo: 0, paidKobo: 0, lastPaidAt: null });
  });

  it('adds up what is on its way and what has been paid from their own payouts', async () => {
    const user = await practitionerWith(['availability.read', 'invoice.read']);
    const someoneElse = await createUser();
    const payout = (
      practitionerId: string,
      amountKobo: number,
      status: 'PREPARED' | 'RELEASED' | 'SETTLED',
      settledAt?: Date,
    ) =>
      prisma.payout.create({
        data: { practitionerId, amountKobo, status, settledAt: settledAt ?? null },
      });
    await payout(user.id, 100_000, 'PREPARED');
    await payout(user.id, 250_000, 'RELEASED');
    await payout(user.id, 400_000, 'SETTLED', new Date('2026-09-01T10:00:00Z'));
    await payout(user.id, 600_000, 'SETTLED', new Date('2026-10-01T10:00:00Z'));
    await payout(someoneElse.id, 9_999_999, 'SETTLED', new Date());

    const earnings = (await overview()).body.earnings as {
      inFlightKobo: number;
      paidKobo: number;
      lastPaidAt: string;
    };

    expect(earnings.inFlightKobo).toBe(350_000);
    expect(earnings.paidKobo).toBe(1_000_000);
    expect(earnings.lastPaidAt).toBe('2026-10-01T10:00:00.000Z');
  });
});
