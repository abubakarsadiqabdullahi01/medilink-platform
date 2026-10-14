import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', async () => {
  const { cookieJar } = await import('./support/cookie-jar');
  return { cookies: () => cookieJar };
});

import { prisma } from '@/lib/db';
import { ROLE_PERMISSIONS } from '@/lib/authz/permissions';
import {
  addHoliday,
  holidayCoverageNow,
  listHolidays,
  loadStatutoryHolidays,
  removeHoliday,
} from '@/modules/rates-contracts/application/holiday';
import { GET as listRoute, POST as addRoute } from '@/app/api/v1/holidays/route';
import { DELETE as removeRoute } from '@/app/api/v1/holidays/[id]/route';
import { issueSession } from '@/modules/auth/application/session-service';
import { clearCookies } from './support/cookie-jar';
import { createUser, grant } from './support/fixtures';

/**
 * RAT-03: the holiday premium stopped on 27 December 2026.
 *
 * Six fixed dates for 2026 were seeded and nothing after, and no route or
 * screen could write one. A shift on a holiday after that was an ordinary day,
 * and nothing said so.
 */

beforeEach(() => {
  clearCookies();
});

const NOW = new Date('2026-10-13T10:00:00.000Z');

async function superAdmin() {
  const user = await createUser({ fullName: 'Platform Owner' });
  await grant({
    userId: user.id,
    roleKey: 'super_administrator',
    permissions: ROLE_PERMISSIONS.super_administrator ?? [],
    scopeType: 'PLATFORM',
  });
  return user;
}

async function administrator() {
  const user = await createUser({ fullName: 'Operations Administrator' });
  await grant({
    userId: user.id,
    roleKey: 'administrator',
    permissions: ROLE_PERMISSIONS.administrator ?? [],
    scopeType: 'PLATFORM',
  });
  return user;
}

describe('the statutory list', () => {
  it('is loaded for the years ahead, including the ones the seed used to stop short of', async () => {
    await loadStatutoryHolidays(prisma, [2026, 2027, 2028, 2029, 2030]);

    for (const year of [2026, 2027, 2028, 2029, 2030]) {
      expect(await prisma.publicHoliday.count({ where: { year } })).toBe(8);
    }
    const names = (await listHolidays(2027)).map((row) => `${row.date} ${row.name}`);
    expect(names).toContain('2027-03-26 Good Friday');
    expect(names).toContain('2027-03-29 Easter Monday');
    expect(names).toContain('2027-12-25 Christmas Day');
  });

  it('can be loaded again without duplicating anything or touching what a person added', async () => {
    await loadStatutoryHolidays(prisma, [2027]);
    const declared = await addHoliday({
      date: '2027-03-10',
      name: 'Eid al-Fitr',
      actorId: (await superAdmin()).id,
    });

    await loadStatutoryHolidays(prisma, [2027]);

    expect(await prisma.publicHoliday.count({ where: { year: 2027 } })).toBe(9);
    expect(await prisma.publicHoliday.findUnique({ where: { id: declared.id } })).not.toBeNull();
  });
});

describe('keeping the list', () => {
  it('records who added a holiday, and what', async () => {
    const actor = await superAdmin();
    const added = await addHoliday({ date: '2027-03-10', name: ' Eid al-Fitr ', actorId: actor.id });

    expect(added).toMatchObject({ date: '2027-03-10', name: 'Eid al-Fitr', year: 2027 });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'holiday.added' } });
    expect(audit.actorId).toBe(actor.id);
    expect(audit.entityId).toBe(added.id);
    expect(audit.after).toMatchObject({ date: '2027-03-10', name: 'Eid al-Fitr' });
  });

  it('will not add the same holiday twice', async () => {
    const actor = await superAdmin();
    await addHoliday({ date: '2027-03-10', name: 'Eid al-Fitr', actorId: actor.id });

    await expect(
      addHoliday({ date: '2027-03-10', name: 'Eid al-Fitr', actorId: actor.id }),
    ).rejects.toMatchObject({ code: 'holiday_exists', status: 409 });
  });

  it('removes one, and records what was removed', async () => {
    const actor = await superAdmin();
    const added = await addHoliday({ date: '2027-03-10', name: 'Eid al-Fitr', actorId: actor.id });

    await removeHoliday({ id: added.id, actorId: actor.id });

    expect(await prisma.publicHoliday.count()).toBe(0);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'holiday.removed' } });
    expect(audit.actorId).toBe(actor.id);
    expect(audit.before).toMatchObject({ date: '2027-03-10', name: 'Eid al-Fitr' });
  });

  it('says so when the holiday to remove is not there', async () => {
    const actor = await superAdmin();
    await expect(
      removeHoliday({ id: '00000000-0000-4000-8000-000000000000', actorId: actor.id }),
    ).rejects.toMatchObject({ code: 'holiday_not_found', status: 404 });
  });

  it('lists a year in date order', async () => {
    const actor = await superAdmin();
    await addHoliday({ date: '2027-12-25', name: 'Christmas Day', actorId: actor.id });
    await addHoliday({ date: '2027-01-01', name: "New Year's Day", actorId: actor.id });
    await addHoliday({ date: '2028-01-01', name: "New Year's Day", actorId: actor.id });

    expect((await listHolidays(2027)).map((row) => row.date)).toEqual(['2027-01-01', '2027-12-25']);
  });
});

describe('whether the list will last', () => {
  it('flags next year when nothing has been loaded for it', async () => {
    await loadStatutoryHolidays(prisma, [2026]);

    const coverage = await holidayCoverageNow(NOW);
    expect(coverage.statutoryGap).toBe(true);
    expect(coverage.years.find((year) => year.year === 2027)!.missingStatutory).toHaveLength(8);
  });

  it('is satisfied once this year and next are loaded, and still names the declared holidays to enter', async () => {
    await loadStatutoryHolidays(prisma, [2026, 2027]);

    const coverage = await holidayCoverageNow(NOW);
    expect(coverage.statutoryGap).toBe(false);
    expect(coverage.years.find((year) => year.year === 2027)!.missingMoveable).toEqual([
      'Eid al-Fitr',
      'Eid al-Adha',
      "Mawlid (Prophet's birthday)",
    ]);
  });
});

describe('through the routes', () => {
  it('lets whoever holds config.manage add and remove a holiday', async () => {
    const owner = await superAdmin();
    await issueSession({ userId: owner.id });

    const added = await addRoute(
      new Request('http://localhost/api/v1/holidays', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ date: '2027-03-10', name: 'Eid al-Fitr' }),
      }),
    );
    expect(added.status).toBe(200);
    const holiday = (await added.json()) as { id: string; date: string };
    expect(holiday.date).toBe('2027-03-10');

    const listed = await listRoute(new Request('http://localhost/api/v1/holidays?year=2027'));
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as {
      holidays: { id: string }[];
      coverage: { statutoryGap: boolean };
    };
    expect(body.holidays.map((row) => row.id)).toEqual([holiday.id]);
    expect(body.coverage).toHaveProperty('statutoryGap');

    const removed = await removeRoute(
      new Request(`http://localhost/api/v1/holidays/${holiday.id}`, { method: 'DELETE' }),
      { params: Promise.resolve({ id: holiday.id }) },
    );
    expect(removed.status).toBe(200);
    expect(await prisma.publicHoliday.count()).toBe(0);
  });

  it('refuses an administrator who does not hold config.manage', async () => {
    const officer = await administrator();
    await issueSession({ userId: officer.id });

    const response = await addRoute(
      new Request('http://localhost/api/v1/holidays', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ date: '2027-03-10', name: 'Eid al-Fitr' }),
      }),
    );
    expect(response.status).toBe(403);
    expect(await prisma.publicHoliday.count()).toBe(0);
  });

  it.each([
    ['a date that is not on the calendar', { date: '2027-02-30', name: 'Mistyped' }],
    ['a date written the wrong way round', { date: '10/03/2027', name: 'Eid al-Fitr' }],
    ['a year nobody means', { date: '1927-03-10', name: 'Eid al-Fitr' }],
    ['a name with nothing in it', { date: '2027-03-10', name: '  ' }],
  ])('refuses %s', async (_label, payload) => {
    const owner = await superAdmin();
    await issueSession({ userId: owner.id });

    const response = await addRoute(
      new Request('http://localhost/api/v1/holidays', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      }),
    );
    expect(response.status).toBe(422);
    expect(await prisma.publicHoliday.count()).toBe(0);
  });
});
