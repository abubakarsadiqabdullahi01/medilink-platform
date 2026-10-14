import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', async () => {
  const { cookieJar } = await import('./support/cookie-jar');
  return { cookies: () => cookieJar };
});

import { prisma } from '@/lib/db';
import { GET as getLevels, POST as postLevel } from '@/app/api/v1/cadre-levels/route';
import { POST as postLevelActive } from '@/app/api/v1/cadre-levels/[id]/active/route';
import { GET as getCategories, POST as postCategory } from '@/app/api/v1/registration-categories/route';
import { POST as postCategoryActive } from '@/app/api/v1/registration-categories/[id]/active/route';
import {
  createCadreLevel,
  createRegistrationCategory,
  hierarchyOverview,
  setCadreLevelActive,
  setRegistrationCategoryActive,
} from '@/modules/config/hierarchy-config';
import { getReferenceData } from '@/modules/config/reference';
import { issueSession } from '@/modules/auth/application/session-service';
import { clearCookies } from './support/cookie-jar';
import { createProfessionalCategory, createUser, grant } from './support/fixtures';

/**
 * CFG-04, the first half of the level model. There were no level, cadre or
 * registration-category lists anywhere, so a house officer and a consultant were the
 * same person to the platform and a request could not say which it wanted. These are
 * the lists, and the people who own them entering them without SQL. What the levels
 * are for each profession is the regulators' to say; the suite uses invented ones and
 * nothing in the product ships with any.
 */

beforeEach(() => {
  clearCookies();
});

async function officer() {
  const user = await createUser({ fullName: 'Compliance Officer' });
  await grant({ userId: user.id, roleKey: 'config_owner', permissions: ['config.manage'], scopeType: 'PLATFORM' });
  return user;
}

describe('defining a level', () => {
  it('creates it under a profession, ranked, keyed and active, and records who', async () => {
    const category = await createProfessionalCategory({ name: 'Doctor' });
    const actor = await officer();

    const level = await createCadreLevel({ professionalCategoryId: category.id, name: 'Registrar', rank: 30, actorId: actor.id });

    expect(level).toMatchObject({ name: 'Registrar', rank: 30, isActive: true });
    expect(level.key).toBe(`${category.key}.registrar`);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'cadre_level.created' } });
    expect(audit.actorId).toBe(actor.id);
  });

  it('refuses a name that is not one and a rank that is not a position, saying which', async () => {
    const category = await createProfessionalCategory({ name: 'Doctor' });
    const actor = await officer();
    const base = { professionalCategoryId: category.id, name: 'Registrar', rank: 30, actorId: actor.id };

    await expect(createCadreLevel({ ...base, name: ' ' })).rejects.toMatchObject({ code: 'level_invalid', status: 422 });
    await expect(createCadreLevel({ ...base, rank: 0 })).rejects.toMatchObject({ code: 'level_invalid' });
    await expect(createCadreLevel({ ...base, rank: 2.5 })).rejects.toMatchObject({ code: 'level_invalid' });
    expect(await prisma.cadreLevel.count()).toBe(0);
  });

  it('refuses two levels of one profession at one rank, or with one name', async () => {
    const category = await createProfessionalCategory({ name: 'Doctor' });
    const actor = await officer();
    await createCadreLevel({ professionalCategoryId: category.id, name: 'Registrar', rank: 30, actorId: actor.id });

    await expect(
      createCadreLevel({ professionalCategoryId: category.id, name: 'Specialist', rank: 30, actorId: actor.id }),
    ).rejects.toMatchObject({ code: 'level_rank_taken', status: 409 });
    await expect(
      createCadreLevel({ professionalCategoryId: category.id, name: 'registrar', rank: 40, actorId: actor.id }),
    ).rejects.toMatchObject({ code: 'level_name_taken', status: 409 });
    expect(await prisma.cadreLevel.count()).toBe(1);
  });

  it('allows the same rank and name in another profession', async () => {
    const doctor = await createProfessionalCategory({ name: 'Doctor' });
    const nurse = await createProfessionalCategory({ name: 'Nurse' });
    const actor = await officer();
    await createCadreLevel({ professionalCategoryId: doctor.id, name: 'Senior', rank: 30, actorId: actor.id });

    const level = await createCadreLevel({ professionalCategoryId: nurse.id, name: 'Senior', rank: 30, actorId: actor.id });

    expect(level.key).toBe(`${nurse.key}.senior`);
  });

  it('says so when the profession is not one', async () => {
    const actor = await officer();

    await expect(
      createCadreLevel({ professionalCategoryId: '00000000-0000-4000-8000-000000000001', name: 'Registrar', rank: 30, actorId: actor.id }),
    ).rejects.toMatchObject({ code: 'category_not_found', status: 404 });
  });

  it('is retired, not deleted, and can be brought back; each is on the audit trail', async () => {
    const category = await createProfessionalCategory({ name: 'Doctor' });
    const actor = await officer();
    const level = await createCadreLevel({ professionalCategoryId: category.id, name: 'Registrar', rank: 30, actorId: actor.id });

    const retired = await setCadreLevelActive({ id: level.id, active: false, actorId: actor.id });
    expect(retired.isActive).toBe(false);
    expect(await prisma.cadreLevel.count()).toBe(1);

    const back = await setCadreLevelActive({ id: level.id, active: true, actorId: actor.id });
    expect(back.isActive).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: 'cadre_level.retired' } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'cadre_level.restored' } })).toBe(1);
  });

  it('says so when there is no such level', async () => {
    const actor = await officer();

    await expect(
      setCadreLevelActive({ id: '00000000-0000-4000-8000-000000000001', active: false, actorId: actor.id }),
    ).rejects.toMatchObject({ code: 'level_not_found', status: 404 });
  });
});

describe('defining a registration category', () => {
  it('creates it, with whether it needs supervision', async () => {
    const actor = await officer();

    const category = await createRegistrationCategory({ name: 'Provisional registration', supervisionRequired: true, actorId: actor.id });

    expect(category).toMatchObject({ key: 'provisional_registration', name: 'Provisional registration', supervisionRequired: true, isActive: true });
    expect(await prisma.auditLog.count({ where: { action: 'registration_category.created' } })).toBe(1);
  });

  it('refuses a second one by the same name, however it is typed', async () => {
    const actor = await officer();
    await createRegistrationCategory({ name: 'Full registration', supervisionRequired: false, actorId: actor.id });

    await expect(
      createRegistrationCategory({ name: 'full  registration', supervisionRequired: true, actorId: actor.id }),
    ).rejects.toMatchObject({ code: 'category_name_taken', status: 409 });
  });

  it('refuses a name that is not one', async () => {
    const actor = await officer();

    await expect(
      createRegistrationCategory({ name: ' ', supervisionRequired: false, actorId: actor.id }),
    ).rejects.toMatchObject({ code: 'level_invalid' });
  });

  it('is retired and restored', async () => {
    const actor = await officer();
    const category = await createRegistrationCategory({ name: 'Full registration', supervisionRequired: false, actorId: actor.id });

    expect((await setRegistrationCategoryActive({ id: category.id, active: false, actorId: actor.id })).isActive).toBe(false);
    expect((await setRegistrationCategoryActive({ id: category.id, active: true, actorId: actor.id })).isActive).toBe(true);
  });
});

describe('where the lists are read', () => {
  it('gives the overview every level by profession, lowest first, and every category', async () => {
    const doctor = await createProfessionalCategory({ name: 'Doctor' });
    const actor = await officer();
    await createCadreLevel({ professionalCategoryId: doctor.id, name: 'Consultant', rank: 50, actorId: actor.id });
    await createCadreLevel({ professionalCategoryId: doctor.id, name: 'House officer', rank: 10, actorId: actor.id });
    await createRegistrationCategory({ name: 'Full registration', supervisionRequired: false, actorId: actor.id });

    const overview = await hierarchyOverview();

    const row = overview.professions.find((profession) => profession.id === doctor.id)!;
    expect(row.levels.map((level) => level.name)).toEqual(['House officer', 'Consultant']);
    expect(overview.registrationCategories.map((category) => category.name)).toEqual(['Full registration']);
  });

  it('gives forms only what can be chosen: a retired level or category is not offered', async () => {
    const doctor = await createProfessionalCategory({ name: 'Doctor' });
    const actor = await officer();
    const kept = await createCadreLevel({ professionalCategoryId: doctor.id, name: 'Registrar', rank: 30, actorId: actor.id });
    const gone = await createCadreLevel({ professionalCategoryId: doctor.id, name: 'Locum', rank: 20, actorId: actor.id });
    await setCadreLevelActive({ id: gone.id, active: false, actorId: actor.id });
    const category = await createRegistrationCategory({ name: 'Old register', supervisionRequired: false, actorId: actor.id });
    await setRegistrationCategoryActive({ id: category.id, active: false, actorId: actor.id });

    const reference = await getReferenceData();

    expect(reference.cadreLevels.map((level) => level.id)).toEqual([kept.id]);
    expect(reference.cadreLevels[0]).toMatchObject({ categoryId: doctor.id, name: 'Registrar', rank: 30 });
    expect(reference.registrationCategories).toEqual([]);
  });
});

describe('over the API', () => {
  const post = (route: (request: Request) => Promise<Response>, body: unknown) =>
    route(new Request('http://localhost/api/v1/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
  const toggle = (route: (request: Request, props: { params: Promise<{ id: string }> }) => Promise<Response>, id: string, active: boolean) =>
    route(
      new Request(`http://localhost/api/v1/x/${id}/active`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ active }) }),
      { params: Promise.resolve({ id }) },
    );

  it('is for somebody who can manage configuration, and refuses everybody else', async () => {
    const category = await createProfessionalCategory({ name: 'Doctor' });
    const stranger = await createUser({ fullName: 'Nobody Special' });
    await issueSession({ userId: stranger.id });

    expect((await post(postLevel, { professionalCategoryId: category.id, name: 'Registrar', rank: 30 })).status).toBe(403);
    expect((await getLevels(new Request('http://localhost/api/v1/cadre-levels'))).status).toBe(403);
    expect((await post(postCategory, { name: 'Full registration', supervisionRequired: false })).status).toBe(403);
    expect((await getCategories(new Request('http://localhost/api/v1/registration-categories'))).status).toBe(403);
    expect(await prisma.cadreLevel.count()).toBe(0);
  });

  it('is told to sign in without a session', async () => {
    expect((await post(postLevel, {})).status).toBe(401);
    expect((await post(postCategory, {})).status).toBe(401);
  });

  it('creates and retires through the routes for the person who owns the lists', async () => {
    const category = await createProfessionalCategory({ name: 'Doctor' });
    const actor = await officer();
    await issueSession({ userId: actor.id });

    const created = await post(postLevel, { professionalCategoryId: category.id, name: 'Registrar', rank: 30 });
    expect(created.status).toBe(201);
    const level = ((await created.json()) as { id: string }).id;
    expect((await toggle(postLevelActive, level, false)).status).toBe(200);
    expect((await prisma.cadreLevel.findUniqueOrThrow({ where: { id: level } })).isActive).toBe(false);

    const made = await post(postCategory, { name: 'Provisional registration', supervisionRequired: true });
    expect(made.status).toBe(201);
    const id = ((await made.json()) as { id: string }).id;
    expect((await toggle(postCategoryActive, id, false)).status).toBe(200);

    const listed = (await (await getLevels(new Request('http://localhost/api/v1/cadre-levels'))).json()) as { professions: { levels: unknown[] }[]; registrationCategories: unknown[] };
    expect(listed.registrationCategories).toHaveLength(1);
  });

  it('answers a bad rank with what is wrong, not a crash', async () => {
    const category = await createProfessionalCategory({ name: 'Doctor' });
    const actor = await officer();
    await issueSession({ userId: actor.id });

    const response = await post(postLevel, { professionalCategoryId: category.id, name: 'Registrar', rank: 0 });

    expect(response.status).toBe(422);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('level_invalid');
  });
});
