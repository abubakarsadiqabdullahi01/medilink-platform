import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', async () => {
  const { cookieJar } = await import('./support/cookie-jar');
  return { cookies: () => cookieJar };
});

import { prisma } from '@/lib/db';
import { POST as postStanding } from '@/app/api/v1/practitioners/verification/standing/route';
import { GET as getVerification } from '@/app/api/v1/practitioners/verification/route';
import {
  createCadreLevel,
  createRegistrationCategory,
  setCadreLevelActive,
  setRegistrationCategoryActive,
} from '@/modules/config/hierarchy-config';
import {
  listProfessionalRegistrations,
  recordPractitionerStanding,
  recordProfessionalRegistration,
} from '@/modules/practitioners/application/verification';
import { issueSession } from '@/modules/auth/application/session-service';
import { clearCookies } from './support/cookie-jar';
import { buildBookingWorld, eligiblePractitioner } from './support/booking-world';
import { createProfessionalCategory, createUser, grant } from './support/fixtures';

/**
 * PRA-01 and PRA-02. A house officer and a consultant were the same person to the
 * platform, and the only thing that said how somebody stood on the register was a
 * free-text field nothing read. A compliance officer now records, against the
 * registration they have checked, which level the person holds and in what category,
 * and everything downstream can ask.
 */

beforeEach(() => {
  clearCookies();
});

async function officer() {
  const user = await createUser({ fullName: 'Compliance Officer' });
  await grant({ userId: user.id, roleKey: 'credential_reviewer', permissions: ['credential.review', 'config.manage'], scopeType: 'PLATFORM' });
  return user;
}

async function setup() {
  const world = await buildBookingWorld();
  const person = await eligiblePractitioner(world, 'Amina Yusuf');
  const actor = await officer();
  const registrar = await createCadreLevel({ professionalCategoryId: world.categoryId, name: 'Registrar', rank: 30, actorId: actor.id });
  const consultant = await createCadreLevel({ professionalCategoryId: world.categoryId, name: 'Consultant', rank: 50, actorId: actor.id });
  const full = await createRegistrationCategory({ name: 'Full registration', supervisionRequired: false, actorId: actor.id });
  const provisional = await createRegistrationCategory({ name: 'Provisional registration', supervisionRequired: true, actorId: actor.id });
  return { world, person, actor, registrar, consultant, full, provisional };
}

describe('recording where somebody stands', () => {
  it('puts the level and the category on the registration, and says what they are', async () => {
    const { person, actor, registrar, provisional } = await setup();

    const view = await recordPractitionerStanding({
      userId: person.id,
      cadreLevelId: registrar.id,
      registrationCategoryId: provisional.id,
      actorId: actor.id,
    });

    expect(view.cadreLevel).toMatchObject({ id: registrar.id, name: 'Registrar', rank: 30 });
    expect(view.registrationCategory).toMatchObject({ id: provisional.id, name: 'Provisional registration', supervisionRequired: true });
    const row = await prisma.professionalRegistration.findFirstOrThrow({ where: { userId: person.id } });
    expect(row.cadreLevelId).toBe(registrar.id);
    expect(row.registrationCategoryId).toBe(provisional.id);
  });

  it('writes who did it and what it was before to the audit trail', async () => {
    const { person, actor, registrar, consultant } = await setup();
    await recordPractitionerStanding({ userId: person.id, cadreLevelId: registrar.id, registrationCategoryId: null, actorId: actor.id });

    await recordPractitionerStanding({ userId: person.id, cadreLevelId: consultant.id, registrationCategoryId: null, actorId: actor.id });

    const rows = await prisma.auditLog.findMany({ where: { action: 'practitioner.standing_recorded' }, orderBy: { createdAt: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(rows[1]!.actorId).toBe(actor.id);
    expect(JSON.stringify(rows[1]!.before)).toContain(registrar.id);
    expect(JSON.stringify(rows[1]!.after)).toContain(consultant.id);
  });

  it('is cleared by saying nothing, which is not the same as leaving it alone', async () => {
    const { person, actor, registrar, full } = await setup();
    await recordPractitionerStanding({ userId: person.id, cadreLevelId: registrar.id, registrationCategoryId: full.id, actorId: actor.id });

    const view = await recordPractitionerStanding({ userId: person.id, cadreLevelId: null, registrationCategoryId: null, actorId: actor.id });

    expect(view.cadreLevel).toBeNull();
    expect(view.registrationCategory).toBeNull();
  });

  it('refuses a level that belongs to another profession', async () => {
    const { person, actor } = await setup();
    const other = await createProfessionalCategory({ name: 'Pharmacist' });
    const foreign = await createCadreLevel({ professionalCategoryId: other.id, name: 'Superintendent', rank: 40, actorId: actor.id });

    await expect(
      recordPractitionerStanding({ userId: person.id, cadreLevelId: foreign.id, registrationCategoryId: null, actorId: actor.id }),
    ).rejects.toMatchObject({ code: 'level_wrong_profession', status: 422 });
  });

  it('refuses a level or a category that has been retired, or that does not exist', async () => {
    const { person, actor, registrar, full } = await setup();
    await setCadreLevelActive({ id: registrar.id, active: false, actorId: actor.id });
    await setRegistrationCategoryActive({ id: full.id, active: false, actorId: actor.id });

    await expect(
      recordPractitionerStanding({ userId: person.id, cadreLevelId: registrar.id, registrationCategoryId: null, actorId: actor.id }),
    ).rejects.toMatchObject({ code: 'level_wrong_profession' });
    await expect(
      recordPractitionerStanding({ userId: person.id, cadreLevelId: null, registrationCategoryId: full.id, actorId: actor.id }),
    ).rejects.toMatchObject({ code: 'registration_category_invalid' });
    await expect(
      recordPractitionerStanding({ userId: person.id, cadreLevelId: '00000000-0000-4000-8000-000000000001', registrationCategoryId: null, actorId: actor.id }),
    ).rejects.toMatchObject({ code: 'level_wrong_profession' });
  });

  it('needs the registration to have been recorded first, so there is a licence for it to rest on', async () => {
    const { world, actor, registrar } = await setup();
    const bare = await createUser({ fullName: 'No Registration Yet' });
    const { createProfile } = await import('@/modules/practitioners/application/profile');
    await createProfile({ userId: bare.id, professionalCategoryId: world.categoryId, yearsOfExperience: 2, homeStateId: world.stateId });

    await expect(
      recordPractitionerStanding({ userId: bare.id, cadreLevelId: registrar.id, registrationCategoryId: null, actorId: actor.id }),
    ).rejects.toMatchObject({ code: 'registration_required', status: 409 });
  });

  it('can be recorded in the same act as the registration, and is kept when the registration is checked again', async () => {
    const { world, actor, registrar, consultant } = await setup();
    const fresh = await createUser({ fullName: 'Chidi Okafor' });
    const { createProfile } = await import('@/modules/practitioners/application/profile');
    await createProfile({ userId: fresh.id, professionalCategoryId: world.categoryId, yearsOfExperience: 4, homeStateId: world.stateId });

    const first = await recordProfessionalRegistration({
      userId: fresh.id,
      regulator: 'MDCN',
      folioNumber: 'MDCN/B/777001',
      registrationStatus: 'ACTIVE',
      cadreLevelId: registrar.id,
      actorId: actor.id,
    });
    expect(first.cadreLevel?.id).toBe(registrar.id);

    // Looked at again a year later, nobody saying anything about the level: it stays.
    const again = await recordProfessionalRegistration({
      userId: fresh.id,
      regulator: 'MDCN',
      folioNumber: 'MDCN/B/777001',
      registrationStatus: 'ACTIVE',
      actorId: actor.id,
    });
    expect(again.cadreLevel?.id).toBe(registrar.id);

    const promoted = await recordProfessionalRegistration({
      userId: fresh.id,
      regulator: 'MDCN',
      folioNumber: 'MDCN/B/777001',
      registrationStatus: 'ACTIVE',
      cadreLevelId: consultant.id,
      actorId: actor.id,
    });
    expect(promoted.cadreLevel?.id).toBe(consultant.id);
  });

  it('refuses a level in the same act as the registration when it is the wrong profession, and records nothing', async () => {
    const { world, actor } = await setup();
    const other = await createProfessionalCategory({ name: 'Pharmacist' });
    const foreign = await createCadreLevel({ professionalCategoryId: other.id, name: 'Superintendent', rank: 40, actorId: actor.id });
    const fresh = await createUser({ fullName: 'Chidi Okafor' });
    const { createProfile } = await import('@/modules/practitioners/application/profile');
    await createProfile({ userId: fresh.id, professionalCategoryId: world.categoryId, yearsOfExperience: 4, homeStateId: world.stateId });

    await expect(
      recordProfessionalRegistration({
        userId: fresh.id,
        regulator: 'MDCN',
        folioNumber: 'MDCN/B/777002',
        registrationStatus: 'ACTIVE',
        cadreLevelId: foreign.id,
        actorId: actor.id,
      }),
    ).rejects.toMatchObject({ code: 'level_wrong_profession' });
    expect(await prisma.professionalRegistration.count({ where: { userId: fresh.id } })).toBe(0);
  });

  it('is on the registration the practitioner reads about themselves', async () => {
    const { person, actor, consultant, full } = await setup();
    await recordPractitionerStanding({ userId: person.id, cadreLevelId: consultant.id, registrationCategoryId: full.id, actorId: actor.id });

    const [registration] = await listProfessionalRegistrations(person.id);

    expect(registration!.cadreLevel?.name).toBe('Consultant');
    expect(registration!.registrationCategory?.name).toBe('Full registration');
  });
});

describe('over the API', () => {
  const post = (body: unknown) =>
    postStanding(new Request('http://localhost/api/v1/practitioners/verification/standing', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }));

  it('is for somebody who can review credentials, and not for the practitioner themselves', async () => {
    const { person, registrar } = await setup();
    await grant({
      userId: person.id,
      roleKey: 'practitioner',
      permissions: ['practitioner.profile.read', 'practitioner.profile.write'],
      scopeType: 'SELF',
      scopeId: person.id,
    });
    await issueSession({ userId: person.id });

    const response = await post({ userId: person.id, cadreLevelId: registrar.id, registrationCategoryId: null });

    expect(response.status).toBe(403);
    expect((await prisma.professionalRegistration.findFirstOrThrow({ where: { userId: person.id } })).cadreLevelId).toBeNull();
  });

  it('records it for a compliance officer, and the practitioner then sees it', async () => {
    const { person, actor, registrar, provisional } = await setup();
    await issueSession({ userId: actor.id });

    const response = await post({ userId: person.id, cadreLevelId: registrar.id, registrationCategoryId: provisional.id });

    expect(response.status).toBe(200);
    expect((await prisma.professionalRegistration.findFirstOrThrow({ where: { userId: person.id } })).cadreLevelId).toBe(registrar.id);

    await grant({ userId: person.id, roleKey: 'practitioner_self', permissions: ['practitioner.profile.read'], scopeType: 'SELF', scopeId: person.id });
    await issueSession({ userId: person.id });
    const mine = await getVerification(new Request(`http://localhost/api/v1/practitioners/verification?scopeType=SELF&scopeId=${person.id}`));
    expect(JSON.stringify(await mine.json())).toContain('Registrar');
  });

  it('answers a wrong level with what is wrong', async () => {
    const { person, actor } = await setup();
    await issueSession({ userId: actor.id });

    const response = await post({ userId: person.id, cadreLevelId: '00000000-0000-4000-8000-000000000001', registrationCategoryId: null });

    expect(response.status).toBe(422);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('level_wrong_profession');
  });
});
