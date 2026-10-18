import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', async () => {
  const { cookieJar } = await import('./support/cookie-jar');
  return { cookies: () => cookieJar };
});

import { prisma } from '@/lib/db';
import { createRateCard, termsOfBooking } from '@/modules/rates-contracts/application/rate-card';
import { describeShiftEstimate } from '@/modules/rates-contracts/application/estimate';
import { priceStoredTimesheet } from '@/modules/rates-contracts/domain/pricing';
import { computeAndSaveTimesheet } from '@/modules/timesheets/application/timesheet';
import { invitePractitioners, listInvitationsFor, respondToInvitation } from '@/modules/matching/application/assignment';
import { issueSession } from '@/modules/auth/application/session-service';
import { GET as estimateRoute } from '@/app/api/v1/service-requests/estimate/route';
import { GET as invitationsRoute } from '@/app/api/v1/invitations/route';
import { clearCookies } from './support/cookie-jar';
import { buildBookingWorld, eligiblePractitioner, type BookingWorld } from './support/booking-world';
import { createUser, grant } from './support/fixtures';

/**
 * M11-04: both sides are told what a shift comes to, in words, before they agree.
 *
 * The practitioner before they accept the offer; the facility before it publishes. Priced on the
 * allowances the facility has in force on the shift's date and the calendar a timesheet reads, by
 * the functions that price a worked shift, and held here to what a shift worked exactly as
 * scheduled is really priced at.
 */

beforeEach(() => {
  clearCookies();
});

const RATE = 500_000; // ₦5,000 an hour.
const HOUR = 3_600_000;
const wat = (date: string, time: string) => new Date(`${date}T${time}:00+01:00`);

describe('what the facility has agreed to pay', () => {
  it('is the hours at the hourly rate for a facility with no allowances', async () => {
    const world = await buildBookingWorld();

    const words = await describeShiftEstimate({
      facilityId: world.facilityId,
      startsAt: wat('2026-10-14', '08:00'),
      endsAt: wat('2026-10-14', '16:00'),
      hourlyRateKobo: RATE,
      audience: 'practitioner',
    });

    expect(words).toMatchObject({ totalKobo: 4_000_000, headline: 'You would be paid about ₦40,000 for this shift' });
    expect(words!.lines).toEqual(['8 hours at ₦5,000 an hour']);
  });

  it('adds the night allowance of the card in force on the shift’s date', async () => {
    const world = await buildBookingWorld();
    await createRateCard({
      facilityId: world.facilityId,
      actorId: world.schedulerId,
      name: 'Night uplift',
      nightMultiplierBp: 15_000,
      effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    });

    const words = await describeShiftEstimate({
      facilityId: world.facilityId,
      startsAt: wat('2026-10-14', '20:00'),
      endsAt: wat('2026-10-15', '06:00'),
      hourlyRateKobo: RATE,
      audience: 'practitioner',
    });

    expect(words!.totalKobo).toBe(7_500_000);
    expect(words!.lines).toEqual(['10 hours at night, between 8 pm and 6 am, at 1.5 times the hourly rate']);
  });

  it('does not apply a card that starts after the shift, nor one it has replaced', async () => {
    const world = await buildBookingWorld();
    await createRateCard({
      facilityId: world.facilityId,
      actorId: world.schedulerId,
      name: 'Old card',
      nightMultiplierBp: 30_000,
      effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    });
    await createRateCard({
      facilityId: world.facilityId,
      actorId: world.schedulerId,
      name: 'Current card',
      nightMultiplierBp: 15_000,
      effectiveFrom: new Date('2026-06-01T00:00:00Z'),
    });
    await createRateCard({
      facilityId: world.facilityId,
      actorId: world.schedulerId,
      name: 'Next year’s card',
      nightMultiplierBp: 50_000,
      effectiveFrom: new Date('2027-01-01T00:00:00Z'),
    });
    const night = { startsAt: wat('2026-10-14', '20:00'), endsAt: wat('2026-10-15', '04:00'), hourlyRateKobo: RATE };

    const inForce = await describeShiftEstimate({ facilityId: world.facilityId, ...night, audience: 'practitioner' });
    const beforeAny = await describeShiftEstimate({
      facilityId: world.facilityId,
      startsAt: wat('2026-03-10', '20:00'),
      endsAt: wat('2026-03-11', '04:00'),
      hourlyRateKobo: RATE,
      audience: 'practitioner',
    });

    // The current card at 1.5 times: 8 hours × ₦5,000 × 1.5.
    expect(inForce!.totalKobo).toBe(6_000_000);
    // In March only the old card applied: 3 times.
    expect(beforeAny!.totalKobo).toBe(12_000_000);
  });

  it('prices a shift on the card in force when it starts, even if a new card begins during it', async () => {
    // A booking copies the card in force at the start of the shift, so a card that begins at
    // midnight, partway through a night shift, does not touch it.
    const world = await buildBookingWorld();
    await createRateCard({
      facilityId: world.facilityId,
      actorId: world.schedulerId,
      name: 'Card in force at the start',
      nightMultiplierBp: 15_000,
      effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    });
    await createRateCard({
      facilityId: world.facilityId,
      actorId: world.schedulerId,
      name: 'Card that begins at midnight',
      nightMultiplierBp: 30_000,
      effectiveFrom: new Date('2026-10-14T23:00:00Z'),
    });

    const words = await describeShiftEstimate({
      facilityId: world.facilityId,
      startsAt: wat('2026-10-14', '20:00'),
      endsAt: wat('2026-10-15', '04:00'),
      hourlyRateKobo: RATE,
      audience: 'practitioner',
    });

    // 8 hours × ₦5,000 × 1.5, not × 3.
    expect(words!.totalKobo).toBe(6_000_000);
  });

  it('adds the holiday allowance on a public holiday from the calendar a timesheet reads', async () => {
    const world = await buildBookingWorld();
    await createRateCard({
      facilityId: world.facilityId,
      actorId: world.schedulerId,
      name: 'Holiday uplift',
      holidayMultiplierBp: 20_000,
      effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    });
    await prisma.publicHoliday.create({
      data: { date: new Date('2026-10-01T00:00:00Z'), name: 'Independence Day', year: 2026, owner: 'test' },
    });

    const holiday = await describeShiftEstimate({
      facilityId: world.facilityId,
      startsAt: wat('2026-10-01', '08:00'),
      endsAt: wat('2026-10-01', '16:00'),
      hourlyRateKobo: RATE,
      audience: 'practitioner',
    });
    const ordinary = await describeShiftEstimate({
      facilityId: world.facilityId,
      startsAt: wat('2026-10-02', '08:00'),
      endsAt: wat('2026-10-02', '16:00'),
      hourlyRateKobo: RATE,
      audience: 'practitioner',
    });

    expect(holiday!.totalKobo).toBe(8_000_000);
    expect(holiday!.lines).toEqual(['8 hours on a public holiday, at 2 times the hourly rate']);
    expect(ordinary!.totalKobo).toBe(4_000_000);
  });

  it('is nothing for a shift that cannot be priced', async () => {
    const world = await buildBookingWorld();
    const base = { facilityId: world.facilityId, hourlyRateKobo: RATE, audience: 'facility' as const };
    expect(await describeShiftEstimate({ ...base, startsAt: wat('2026-10-14', '16:00'), endsAt: wat('2026-10-14', '08:00') })).toBeNull();
    expect(await describeShiftEstimate({ ...base, startsAt: wat('2026-10-14', '08:00'), endsAt: wat('2026-10-15', '09:00') })).toBeNull();
  });
});

describe('what is shown is what a shift worked as scheduled is priced at', () => {
  /** A shift worked exactly as scheduled, through the timesheet the invoice is raised from. */
  async function workedAsScheduled(world: BookingWorld, startsAt: Date, endsAt: Date) {
    const practitioner = await createUser({ fullName: 'Worker' });
    const request = await prisma.serviceRequest.create({
      data: {
        facilityId: world.facilityId,
        professionalCategoryId: world.categoryId,
        shiftType: 'DAY',
        startsAt,
        endsAt,
        headcount: 1,
        hourlyRateKobo: RATE,
        cancellationTerms: 'Either party may cancel up to 24 hours before the shift.',
        status: 'FILLED',
        createdBy: world.schedulerId,
        publishedBy: world.schedulerId,
        publishedAt: new Date(startsAt.getTime() - 7 * 24 * HOUR),
      },
    });
    const assignment = await prisma.assignment.create({
      data: {
        serviceRequestId: request.id,
        userId: practitioner.id,
        facilityId: world.facilityId,
        startsAt,
        endsAt,
        status: 'COMPLETED',
        confirmedBy: world.schedulerId,
      },
    });
    await prisma.attendanceRecord.create({
      data: {
        assignmentId: assignment.id,
        status: 'SUBMITTED',
        checkedInAt: startsAt,
        checkedOutAt: endsAt,
        submittedAt: endsAt,
        submittedBy: practitioner.id,
      },
    });
    const view = await computeAndSaveTimesheet(assignment.id);
    // The stored row, which is what billing prices.
    const sheet = await prisma.timesheet.findUniqueOrThrow({ where: { id: view.id } });
    const terms = await termsOfBooking({ facilityId: world.facilityId, startsAt, rateTerms: null });
    return priceStoredTimesheet(sheet, terms).priced.totalKobo;
  }

  it.each([
    ['a plain weekday day shift', '2026-09-09', '08:00', '2026-09-09', '16:00'],
    ['a night shift across midnight', '2026-09-09', '20:00', '2026-09-10', '06:00'],
    ['a shift that starts in the afternoon and runs into the night', '2026-09-09', '14:00', '2026-09-09', '23:30'],
    ['a shift on a public holiday that runs past midnight', '2026-10-01', '16:00', '2026-10-02', '04:00'],
  ])('for %s', async (_name, startDate, startTime, endDate, endTime) => {
    const world = await buildBookingWorld();
    await createRateCard({
      facilityId: world.facilityId,
      actorId: world.schedulerId,
      name: 'Allowances',
      nightMultiplierBp: 15_000,
      holidayMultiplierBp: 20_000,
      overtimeMultiplierBp: 15_000,
      effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    });
    await prisma.publicHoliday.create({
      data: { date: new Date('2026-10-01T00:00:00Z'), name: 'Independence Day', year: 2026, owner: 'test' },
    });
    const startsAt = wat(startDate!, startTime!);
    const endsAt = wat(endDate!, endTime!);

    const shown = await describeShiftEstimate({
      facilityId: world.facilityId,
      startsAt,
      endsAt,
      hourlyRateKobo: RATE,
      audience: 'practitioner',
    });
    const charged = await workedAsScheduled(world, startsAt, endsAt);

    expect(shown!.totalKobo).toBe(charged);
    expect(charged).toBeGreaterThan(0);
  });
});

describe('the practitioner’s offer', () => {
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

  it('carries what it would pay, in words, while it waits for an answer', async () => {
    const world = await buildBookingWorld();
    const { nurse, invitation } = await offered(world);

    const [row] = await listInvitationsFor(nurse.id);

    expect(row!.id).toBe(invitation.id);
    expect(row!.estimate).toMatchObject({
      totalKobo: 4_000_000,
      headline: 'You would be paid about ₦40,000 for this shift',
    });
    expect(row!.estimate!.lines).toEqual(['8 hours at ₦5,000 an hour']);
    expect(row!.estimate!.notes.join(' ')).toMatch(/unpaid break/);
  });

  it('is priced on the facility’s allowances, so a night offer says what the night is worth', async () => {
    const world = await buildBookingWorld();
    // The world's shift is eight hours starting five days from now; make it a night by card, and
    // find what the shift's own hours come to under it.
    await createRateCard({
      facilityId: world.facilityId,
      actorId: world.schedulerId,
      name: 'Uplift',
      nightMultiplierBp: 15_000,
      holidayMultiplierBp: 20_000,
      effectiveFrom: new Date('2000-01-01T00:00:00Z'),
    });
    const { nurse } = await offered(world);

    const [row] = await listInvitationsFor(nurse.id);
    const expected = await describeShiftEstimate({
      facilityId: world.facilityId,
      startsAt: world.startsAt,
      endsAt: world.endsAt,
      hourlyRateKobo: RATE,
      audience: 'practitioner',
    });

    expect(row!.estimate).toEqual(expected);
  });

  it('is not carried once the offer has been answered', async () => {
    const world = await buildBookingWorld();
    const { nurse, invitation } = await offered(world);

    await respondToInvitation({ invitationId: invitation.id, userId: nurse.id, decision: 'accept' });
    const [row] = await listInvitationsFor(nurse.id);

    expect(row!.status).toBe('ACCEPTED');
    expect(row!.estimate).toBeNull();
  });

  it('reaches the practitioner through the offers route', async () => {
    const world = await buildBookingWorld();
    const { nurse } = await offered(world);
    await grant({
      userId: nurse.id,
      roleKey: 'practitioner_offers_test',
      permissions: ['service_request.read'],
      scopeType: 'SELF',
      scopeId: nurse.id,
    });
    clearCookies();
    await issueSession({ userId: nurse.id });

    const response = await invitationsRoute(new Request('http://localhost/api/v1/invitations'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.invitations[0].estimate.headline).toBe('You would be paid about ₦40,000 for this shift');
  });
});

describe('the facility’s preview', () => {
  async function ownerOf(world: BookingWorld) {
    const owner = await createUser({ fullName: 'Owner' });
    await grant({
      userId: owner.id,
      roleKey: 'facility_publisher_test',
      permissions: ['service_request.publish', 'service_request.read'],
      scopeType: 'FACILITY',
      scopeId: world.facilityId,
    });
    clearCookies();
    await issueSession({ userId: owner.id });
    return owner;
  }

  const url = (facilityId: string, extra: Record<string, string> = {}) => {
    const params = new URLSearchParams({
      facilityId,
      startsAt: wat('2026-10-14', '08:00').toISOString(),
      endsAt: wat('2026-10-14', '16:00').toISOString(),
      hourlyRateKobo: String(RATE),
      headcount: '3',
      ...extra,
    });
    return `http://localhost/api/v1/service-requests/estimate?${params}`;
  };

  it('says what one person and all of them cost, before the shift is published', async () => {
    const world = await buildBookingWorld();
    await ownerOf(world);

    const response = await estimateRoute(new Request(url(world.facilityId)));

    expect(response.status).toBe(200);
    const { estimate } = await response.json();
    expect(estimate.headline).toBe('This shift would cost about ₦40,000 for each person, and about ₦120,000 for 3 people');
    expect(estimate.totalKobo).toBe(12_000_000);
    expect(estimate.notes.join(' ')).toMatch(/invoiced from the approved timesheet/);
  });

  it('answers null, not nought, for times that cannot be priced', async () => {
    const world = await buildBookingWorld();
    await ownerOf(world);

    const response = await estimateRoute(
      new Request(url(world.facilityId, { startsAt: wat('2026-10-14', '16:00').toISOString(), endsAt: wat('2026-10-14', '08:00').toISOString() })),
    );

    expect(response.status).toBe(200);
    expect((await response.json()).estimate).toBeNull();
  });

  it('is refused to somebody who cannot publish for the facility, and to somebody who is not signed in', async () => {
    const world = await buildBookingWorld();
    const other = await buildBookingWorld();
    await ownerOf(other);

    const asOther = await estimateRoute(new Request(url(world.facilityId)));
    expect(asOther.status).toBe(403);

    clearCookies();
    const anonymous = await estimateRoute(new Request(url(world.facilityId)));
    expect(anonymous.status).toBe(401);
  });

  it('is refused to somebody who can read the facility’s shifts but not publish them', async () => {
    const world = await buildBookingWorld();
    const reader = await createUser({ fullName: 'Reader' });
    await grant({
      userId: reader.id,
      roleKey: 'facility_reader_test',
      permissions: ['service_request.read'],
      scopeType: 'FACILITY',
      scopeId: world.facilityId,
    });
    clearCookies();
    await issueSession({ userId: reader.id });

    const response = await estimateRoute(new Request(url(world.facilityId)));

    expect(response.status).toBe(403);
  });

  it('refuses an incomplete request as one to correct', async () => {
    const world = await buildBookingWorld();
    await ownerOf(world);

    const response = await estimateRoute(new Request(url(world.facilityId, { hourlyRateKobo: '0' })));

    expect(response.status).toBe(422);
  });
});
