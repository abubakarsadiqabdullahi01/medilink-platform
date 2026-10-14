import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { addSlot } from '@/modules/availability/application/availability';
import {
  createServiceRequest,
  publishServiceRequest,
} from '@/modules/service-requests/application/request';
import { runMatch } from '@/modules/matching/application/match';
import {
  confirmAssignment,
  invitePractitioners,
  respondToInvitation,
} from '@/modules/matching/application/assignment';
import { setRateFloor } from '@/modules/rates-contracts/application/rate-floor';
import {
  createCadreLevel,
  createRegistrationCategory,
  setCadreLevelActive,
} from '@/modules/config/hierarchy-config';
import { recordPractitionerStanding } from '@/modules/practitioners/application/verification';
import { buildBookingWorld, eligiblePractitioner, type BookingWorld } from './support/booking-world';
import { createProfessionalCategory, createUser } from './support/fixtures';

/**
 * REQ-01. A request could not say which level it wanted: one hourly rate was the
 * contract for everyone on it, a house officer and a consultant were the same to the
 * matching engine, and the pay floor was one figure per profession. A profession
 * compliance has defined levels for now needs every request to name one, only
 * somebody recorded at that level is offered it, and the floor can differ by level.
 *
 * A profession with no levels defined behaves exactly as it did.
 *
 * Real eligibility and real booking-time checks throughout, as in the booking
 * revalidation suite: a suite that stubs out the question cannot show it is asked.
 */

const LATER = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
const LATER_END = new Date(LATER.getTime() + 8 * 60 * 60 * 1000);

const request = (world: BookingWorld, overrides: Record<string, unknown> = {}) => ({
  facilityId: world.facilityId,
  professionalCategoryId: world.categoryId,
  shiftType: 'DAY' as const,
  startsAt: LATER,
  endsAt: LATER_END,
  headcount: 1,
  hourlyRateKobo: 1_000_000,
  urgency: 'ROUTINE' as const,
  cancellationTerms: 'Either party may cancel up to 24 hours before the shift.',
  actorId: world.schedulerId,
  ...overrides,
});

async function levelled() {
  const world = await buildBookingWorld();
  const owner = await createUser({ fullName: 'Compliance Owner' });
  const houseOfficer = await createCadreLevel({ professionalCategoryId: world.categoryId, name: 'House officer', rank: 10, actorId: owner.id });
  const registrar = await createCadreLevel({ professionalCategoryId: world.categoryId, name: 'Registrar', rank: 30, actorId: owner.id });
  return { world, owner, houseOfficer, registrar };
}

async function published(world: BookingWorld, overrides: Record<string, unknown> = {}) {
  const draft = await createServiceRequest(request(world, overrides));
  return publishServiceRequest({ requestId: draft.id, facilityId: world.facilityId, actorId: world.schedulerId });
}

/** Eligible, recorded at a level, and free for the shift. */
async function atLevel(world: BookingWorld, ownerId: string, levelId: string | null, name = 'Amina Yusuf', categoryId: string | null = null) {
  const person = await eligiblePractitioner(world, name);
  if (levelId !== null || categoryId !== null) {
    await recordPractitionerStanding({ userId: person.id, cadreLevelId: levelId, registrationCategoryId: categoryId, actorId: ownerId });
  }
  await addSlot({
    userId: person.id,
    kind: 'ONE_OFF',
    startsAt: new Date(LATER.getTime() - 60 * 60 * 1000),
    endsAt: new Date(LATER_END.getTime() + 60 * 60 * 1000),
  });
  return person;
}

beforeEach(() => {
  // Every case builds its own world.
});

describe('a profession with no levels defined', () => {
  it('is asked for none, as before', async () => {
    const world = await buildBookingWorld();

    const created = await createServiceRequest(request(world));

    expect(created.cadreLevelId).toBeNull();
    expect(created.supervisionAvailable).toBe(false);
  });

  it('cannot be given one that belongs to another profession', async () => {
    const world = await buildBookingWorld();
    const owner = await createUser({ fullName: 'Compliance Owner' });
    const other = await createProfessionalCategory({ name: 'Pharmacist' });
    const foreign = await createCadreLevel({ professionalCategoryId: other.id, name: 'Superintendent', rank: 40, actorId: owner.id });

    await expect(createServiceRequest(request(world, { cadreLevelId: foreign.id }))).rejects.toMatchObject({
      code: 'invalid_level',
      status: 422,
    });
  });
});

describe('a profession that has levels', () => {
  it('has to name one, and is told which professions and levels there are', async () => {
    const { world } = await levelled();

    await expect(createServiceRequest(request(world))).rejects.toMatchObject({ code: 'level_required', status: 422 });
    expect(await prisma.serviceRequest.count({ where: { cadreLevelId: null, status: 'DRAFT' } })).toBe(0);
  });

  it('keeps the level on the request, and says so in the audit trail', async () => {
    const { world, registrar } = await levelled();

    const created = await createServiceRequest(request(world, { cadreLevelId: registrar.id, supervisionAvailable: true }));

    expect(created).toMatchObject({ cadreLevelId: registrar.id, supervisionAvailable: true });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'service_request.created', entityId: created.id } });
    expect(JSON.stringify(audit.after)).toContain(registrar.id);
  });

  it('refuses a level that has been retired, or that is another profession\'s', async () => {
    const { world, owner, houseOfficer } = await levelled();
    await setCadreLevelActive({ id: houseOfficer.id, active: false, actorId: owner.id });
    const other = await createProfessionalCategory({ name: 'Pharmacist' });
    const foreign = await createCadreLevel({ professionalCategoryId: other.id, name: 'Superintendent', rank: 40, actorId: owner.id });

    await expect(createServiceRequest(request(world, { cadreLevelId: houseOfficer.id }))).rejects.toMatchObject({ code: 'invalid_level' });
    await expect(createServiceRequest(request(world, { cadreLevelId: foreign.id }))).rejects.toMatchObject({ code: 'invalid_level' });
  });

  it('cannot publish a draft written before the levels were defined, until it names one', async () => {
    const world = await buildBookingWorld();
    const draft = await createServiceRequest(request(world));
    const owner = await createUser({ fullName: 'Compliance Owner' });
    const registrar = await createCadreLevel({ professionalCategoryId: world.categoryId, name: 'Registrar', rank: 30, actorId: owner.id });

    await expect(
      publishServiceRequest({ requestId: draft.id, facilityId: world.facilityId, actorId: world.schedulerId }),
    ).rejects.toMatchObject({ code: 'level_required' });
    expect((await prisma.serviceRequest.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe('DRAFT');
    void registrar;
  });
});

describe('the pay floor by level', () => {
  it('holds a request to the floor for its own level, not the profession\'s general one', async () => {
    const { world, owner, registrar } = await levelled();
    const category = await prisma.professionalCategory.findUniqueOrThrow({ where: { id: world.categoryId } });
    const tomorrow = new Date(Date.now() + 86_400_000 + 3_600_000).toISOString().slice(0, 10);
    await setRateFloor({
      categoryKey: category.key,
      cadreLevelKey: registrar.key,
      shiftType: 'day',
      minHourlyKobo: 2_000_000,
      effectiveFrom: tomorrow,
      actorId: owner.id,
    });

    // 1,000,000 clears the profession's general floor and not the registrar's.
    await expect(createServiceRequest(request(world, { cadreLevelId: registrar.id }))).rejects.toMatchObject({
      code: 'below_rate_floor',
    });
    await expect(
      createServiceRequest(request(world, { cadreLevelId: registrar.id, hourlyRateKobo: 2_000_000 })),
    ).resolves.toMatchObject({ cadreLevelId: registrar.id });
  });

  it('leaves another level to the general floor', async () => {
    const { world, owner, registrar, houseOfficer } = await levelled();
    const category = await prisma.professionalCategory.findUniqueOrThrow({ where: { id: world.categoryId } });
    const tomorrow = new Date(Date.now() + 86_400_000 + 3_600_000).toISOString().slice(0, 10);
    await setRateFloor({
      categoryKey: category.key,
      cadreLevelKey: registrar.key,
      shiftType: 'day',
      minHourlyKobo: 2_000_000,
      effectiveFrom: tomorrow,
      actorId: owner.id,
    });

    await expect(
      createServiceRequest(request(world, { cadreLevelId: houseOfficer.id, hourlyRateKobo: 1_000_000 })),
    ).resolves.toMatchObject({ cadreLevelId: houseOfficer.id });
  });

  it('sets a floor only for a level of the profession it is for', async () => {
    const { world, owner } = await levelled();
    const category = await prisma.professionalCategory.findUniqueOrThrow({ where: { id: world.categoryId } });
    const other = await createProfessionalCategory({ name: 'Pharmacist' });
    const foreign = await createCadreLevel({ professionalCategoryId: other.id, name: 'Superintendent', rank: 40, actorId: owner.id });
    const tomorrow = new Date(Date.now() + 86_400_000 + 3_600_000).toISOString().slice(0, 10);

    await expect(
      setRateFloor({ categoryKey: category.key, cadreLevelKey: foreign.key, shiftType: 'day', minHourlyKobo: 1_000_000, effectiveFrom: tomorrow, actorId: owner.id }),
    ).rejects.toMatchObject({ code: 'level_invalid', status: 422 });
    await expect(
      setRateFloor({ categoryKey: category.key, cadreLevelKey: 'doctor.nobody', shiftType: 'day', minHourlyKobo: 1_000_000, effectiveFrom: tomorrow, actorId: owner.id }),
    ).rejects.toMatchObject({ code: 'level_invalid' });
  });
});

describe('matching a level-bound request', () => {
  it('ranks only somebody recorded at that level, and says why the others are out', async () => {
    const { world, owner, houseOfficer, registrar } = await levelled();
    const wanted = await atLevel(world, owner.id, registrar.id, 'Amina Yusuf');
    await atLevel(world, owner.id, houseOfficer.id, 'Chidi Okafor');
    await atLevel(world, owner.id, null, 'Ngozi Eze');
    const shift = await published(world, { cadreLevelId: registrar.id });

    const run = await runMatch({ requestId: shift.id, facilityId: world.facilityId, actorId: world.schedulerId });

    expect(run.ranked.map((row) => row.userId)).toEqual([wanted.id]);
    expect(run.excluded.flatMap((row) => row.reasons)).toEqual(['level_mismatch', 'level_mismatch']);
  });

  it('keeps somebody who needs supervision off a shift that does not offer it, and offers it one that does', async () => {
    const { world, owner, registrar } = await levelled();
    const provisional = await createRegistrationCategory({ name: 'Provisional registration', supervisionRequired: true, actorId: owner.id });
    const supervised = await atLevel(world, owner.id, registrar.id, 'Amina Yusuf', provisional.id);
    const without = await published(world, { cadreLevelId: registrar.id });
    const withCover = await published(world, { cadreLevelId: registrar.id, supervisionAvailable: true });

    const first = await runMatch({ requestId: without.id, facilityId: world.facilityId, actorId: world.schedulerId });
    const second = await runMatch({ requestId: withCover.id, facilityId: world.facilityId, actorId: world.schedulerId });

    expect(first.ranked).toHaveLength(0);
    expect(first.excluded[0]!.reasons).toContain('supervision_required');
    expect(second.ranked.map((row) => row.userId)).toEqual([supervised.id]);
  });

  it('matches by the profession alone when it has no levels, as before', async () => {
    const world = await buildBookingWorld();
    const person = await eligiblePractitioner(world, 'Amina Yusuf');
    await addSlot({
      userId: person.id,
      kind: 'ONE_OFF',
      startsAt: new Date(LATER.getTime() - 3_600_000),
      endsAt: new Date(LATER_END.getTime() + 3_600_000),
    });
    const shift = await published(world);

    const run = await runMatch({ requestId: shift.id, facilityId: world.facilityId, actorId: world.schedulerId });

    expect(run.ranked.map((row) => row.userId)).toEqual([person.id]);
  });
});

describe('booking a level-bound request', () => {
  it('refuses to invite somebody whose recorded level is not the one asked for', async () => {
    const { world, owner, houseOfficer, registrar } = await levelled();
    const person = await atLevel(world, owner.id, houseOfficer.id);
    const shift = await published(world, { cadreLevelId: registrar.id });

    await expect(
      invitePractitioners({ requestId: shift.id, facilityId: world.facilityId, userIds: [person.id], actorId: world.schedulerId }),
    ).rejects.toMatchObject({ code: 'practitioner_not_bookable' });
  });

  it('asks again at acceptance and confirmation, so a level changed since the offer stops the booking', async () => {
    const { world, owner, houseOfficer, registrar } = await levelled();
    const person = await atLevel(world, owner.id, registrar.id);
    const shift = await published(world, { cadreLevelId: registrar.id });
    const [invitation] = await invitePractitioners({ requestId: shift.id, facilityId: world.facilityId, userIds: [person.id], actorId: world.schedulerId });

    // Re-checked against the register: they are a house officer after all.
    await recordPractitionerStanding({ userId: person.id, cadreLevelId: houseOfficer.id, registrationCategoryId: null, actorId: owner.id });

    await expect(
      respondToInvitation({ invitationId: invitation!.id, userId: person.id, decision: 'accept' }),
    ).rejects.toMatchObject({ code: 'cannot_accept' });
    await prisma.invitation.update({ where: { id: invitation!.id }, data: { status: 'ACCEPTED' } });
    await expect(
      confirmAssignment({ requestId: shift.id, facilityId: world.facilityId, userId: person.id, actorId: world.schedulerId }),
    ).rejects.toMatchObject({ code: 'cannot_confirm' });
  });

  it('books somebody at the right level', async () => {
    const { world, owner, registrar } = await levelled();
    const person = await atLevel(world, owner.id, registrar.id);
    const shift = await published(world, { cadreLevelId: registrar.id });
    const [invitation] = await invitePractitioners({ requestId: shift.id, facilityId: world.facilityId, userIds: [person.id], actorId: world.schedulerId });
    await respondToInvitation({ invitationId: invitation!.id, userId: person.id, decision: 'accept' });

    const assignment = await confirmAssignment({ requestId: shift.id, facilityId: world.facilityId, userId: person.id, actorId: world.schedulerId });

    expect(assignment.status).toBe('CONFIRMED');
  });
});
