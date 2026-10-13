import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', async () => {
  const { cookieJar } = await import('./support/cookie-jar');
  return { cookies: () => cookieJar };
});

import { prisma } from '@/lib/db';
import { ROLE_PERMISSIONS } from '@/lib/authz/permissions';
import {
  addSanctionedEntries,
  listSanctionedEntries,
  removeSanctionedEntry,
} from '@/modules/practitioners/application/sanctions';
import { getScreeningResult } from '@/modules/practitioners/application/screening';
import { createProfile } from '@/modules/practitioners/application/profile';
import { GET as listRoute, POST as addRoute } from '@/app/api/v1/sanctions/route';
import { POST as removeRoute } from '@/app/api/v1/sanctions/[id]/remove/route';
import { issueSession } from '@/modules/auth/application/session-service';
import { clearCookies } from './support/cookie-jar';
import { createProfessionalCategory, createUser, grant } from './support/fixtures';

/**
 * PRA-14. The sanctions and "quack" lists shipped empty and nothing could add to
 * them, so screening reported "clear" for everybody until somebody wrote SQL.
 * The content of the lists is compliance's to supply from the regulator's
 * notices; these are the means to put it in, and what happens when they do.
 */

beforeEach(() => {
  clearCookies();
});

async function officer(roleKey: 'administrator' | 'practitioner' = 'administrator') {
  const user = await createUser({ fullName: 'Compliance Officer' });
  await grant({
    userId: user.id,
    roleKey,
    permissions: ROLE_PERMISSIONS[roleKey] ?? [],
    scopeType: roleKey === 'administrator' ? 'PLATFORM' : 'SELF',
    scopeId: roleKey === 'administrator' ? null : user.id,
  });
  return user;
}

async function practitioner(fullName: string) {
  const user = await createUser({ fullName });
  const category = await createProfessionalCategory();
  await createProfile({ userId: user.id, professionalCategoryId: category.id, yearsOfExperience: 4 });
  return user;
}

const ENTRY = {
  fullName: 'Amina Yusuf',
  sourceList: 'MDCN_QUACK_LIST' as const,
  folioNumber: 'mdcn/12345',
  reason: 'MDCN public notice, March 2026',
  listedAt: '2026-03-01',
};

describe('adding to the list', () => {
  it('stores the entry in the comparable form screening uses, with who owns it', async () => {
    const actor = await officer();
    await addSanctionedEntries({ entries: [ENTRY], actorId: actor.id });

    const row = await prisma.sanctionedEntry.findFirstOrThrow();
    expect(row.normalisedName).toBe('amina yusuf');
    expect(row.folioNumber).toBe('MDCN/12345');
    expect(row.sourceList).toBe('MDCN_QUACK_LIST');
    expect(row.listedAt.toISOString().slice(0, 10)).toBe('2026-03-01');
  });

  it('screens everybody at once, so the list takes effect now and not at the next daily sweep', async () => {
    const actor = await officer();
    const listed = await practitioner('Dr Yusuf Amina');
    const innocent = await practitioner('Chinedu Okafor');

    const outcome = await addSanctionedEntries({ entries: [ENTRY], actorId: actor.id });

    expect((await getScreeningResult(listed.id))?.status).toBe('FLAGGED');
    expect((await getScreeningResult(innocent.id))?.status).toBe('CLEAR');
    expect(outcome.flagged).toBe(1);
  });

  it('adds a whole list in one go, or none of it', async () => {
    const actor = await officer();
    const entries = [
      ENTRY,
      { ...ENTRY, fullName: 'Emeka Obi', folioNumber: 'MDCN/777' },
      { ...ENTRY, fullName: 'Folake Adeyemi', folioNumber: undefined },
    ];
    const outcome = await addSanctionedEntries({ entries, actorId: actor.id });
    expect(outcome.added).toBe(3);
    expect(await prisma.sanctionedEntry.count()).toBe(3);
  });

  it('does not add somebody twice, however the name is written', async () => {
    const actor = await officer();
    await addSanctionedEntries({ entries: [ENTRY], actorId: actor.id });

    const again = await addSanctionedEntries({
      entries: [{ ...ENTRY, fullName: 'YUSUF, Amina (Dr)' }, { ...ENTRY, fullName: 'Emeka Obi', folioNumber: undefined }],
      actorId: actor.id,
    });

    expect(again).toMatchObject({ added: 1, skipped: 1 });
    expect(await prisma.sanctionedEntry.count()).toBe(2);
  });

  it('keeps the same person on two lists, which is two entries', async () => {
    const actor = await officer();
    await addSanctionedEntries({ entries: [ENTRY, { ...ENTRY, sourceList: 'INTERNAL' as const }], actorId: actor.id });
    expect(await prisma.sanctionedEntry.count()).toBe(2);
  });

  it('records one audit row for the change, without the names', async () => {
    const actor = await officer();
    await addSanctionedEntries({ entries: [ENTRY, { ...ENTRY, fullName: 'Emeka Obi', folioNumber: undefined }], actorId: actor.id });

    const audit = await prisma.auditLog.findMany({ where: { action: 'sanction_list.entries_added' } });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actorId).toBe(actor.id);
    expect(audit[0]!.after).toMatchObject({ count: 2, sourceLists: ['MDCN_QUACK_LIST'] });
    const text = JSON.stringify(audit[0]);
    expect(text).not.toContain('Amina');
    expect(text).not.toContain('Emeka');
  });
});

describe('taking an entry off', () => {
  it('removes it, and lifts the flag it raised', async () => {
    const actor = await officer();
    const person = await practitioner('Dr Amina Yusuf');
    await addSanctionedEntries({ entries: [ENTRY], actorId: actor.id });
    expect((await getScreeningResult(person.id))?.status).toBe('FLAGGED');
    const entry = await prisma.sanctionedEntry.findFirstOrThrow();

    await removeSanctionedEntry({
      entryId: entry.id,
      actorId: actor.id,
      reason: 'Listed in error; the regulator withdrew the notice.',
    });

    expect(await prisma.sanctionedEntry.count()).toBe(0);
    expect((await getScreeningResult(person.id))?.status).toBe('CLEAR');
  });

  it('keeps a flag that another entry still justifies', async () => {
    const actor = await officer();
    const person = await practitioner('Dr Amina Yusuf');
    await addSanctionedEntries({ entries: [ENTRY, { ...ENTRY, sourceList: 'INTERNAL' as const }], actorId: actor.id });
    const [first] = await prisma.sanctionedEntry.findMany({ orderBy: { createdAt: 'asc' } });

    await removeSanctionedEntry({ entryId: first!.id, actorId: actor.id, reason: 'Duplicate of the internal entry.' });

    expect((await getScreeningResult(person.id))?.status).toBe('FLAGGED');
  });

  it('records who, why, and what kind of entry, without the name', async () => {
    const actor = await officer();
    await addSanctionedEntries({ entries: [ENTRY], actorId: actor.id });
    const entry = await prisma.sanctionedEntry.findFirstOrThrow();

    await removeSanctionedEntry({ entryId: entry.id, actorId: actor.id, reason: 'Listed in error; withdrawn.' });

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'sanction_list.entry_removed' } });
    expect(audit.actorId).toBe(actor.id);
    expect(audit.reason).toBe('Listed in error; withdrawn.');
    expect(audit.before).toMatchObject({ sourceList: 'MDCN_QUACK_LIST' });
    expect(JSON.stringify(audit)).not.toContain('Amina');
  });

  it('needs a reason', async () => {
    const actor = await officer();
    await addSanctionedEntries({ entries: [ENTRY], actorId: actor.id });
    const entry = await prisma.sanctionedEntry.findFirstOrThrow();

    await expect(removeSanctionedEntry({ entryId: entry.id, actorId: actor.id, reason: '  ' })).rejects.toMatchObject({
      code: 'reason_required',
    });
    expect(await prisma.sanctionedEntry.count()).toBe(1);
  });

  it('says so when the entry is not there', async () => {
    const actor = await officer();
    await expect(
      removeSanctionedEntry({ entryId: '00000000-0000-4000-8000-0000000000bb', actorId: actor.id, reason: 'Gone already.' }),
    ).rejects.toMatchObject({ code: 'sanction_entry_not_found', status: 404 });
  });
});

describe('reading the list', () => {
  it('lists entries newest first, and finds one by name however it is written', async () => {
    const actor = await officer();
    await addSanctionedEntries({
      entries: [ENTRY, { ...ENTRY, fullName: 'Emeka Obi', folioNumber: undefined }],
      actorId: actor.id,
    });

    const all = await listSanctionedEntries({});
    expect(all).toHaveLength(2);
    const found = await listSanctionedEntries({ search: 'yusuf amina' });
    expect(found.map((row) => row.fullName)).toEqual(['Amina Yusuf']);
  });
});

describe('through the routes', () => {
  const post = (body: object) =>
    addRoute(
      new Request('http://localhost/api/v1/sanctions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );

  it('lets compliance add, list and remove', async () => {
    const actor = await officer();
    await issueSession({ userId: actor.id });

    expect((await post({ entries: [ENTRY] })).status).toBe(200);

    const listed = await listRoute(new Request('http://localhost/api/v1/sanctions'));
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as { entries: { id: string }[] };
    expect(body.entries).toHaveLength(1);

    const removed = await removeRoute(
      new Request(`http://localhost/api/v1/sanctions/${body.entries[0]!.id}/remove`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'Listed in error; withdrawn.' }),
      }),
      { params: Promise.resolve({ id: body.entries[0]!.id }) },
    );
    expect(removed.status).toBe(200);
    expect(await prisma.sanctionedEntry.count()).toBe(0);
  });

  it('refuses everybody else', async () => {
    const stranger = await officer('practitioner');
    await issueSession({ userId: stranger.id });

    expect((await post({ entries: [ENTRY] })).status).toBe(403);
    expect((await listRoute(new Request('http://localhost/api/v1/sanctions'))).status).toBe(403);
    expect(await prisma.sanctionedEntry.count()).toBe(0);
  });

  it.each([
    ['no entries', { entries: [] }],
    ['an entry with no name', { entries: [{ ...ENTRY, fullName: ' ' }] }],
    ['a date that is not one', { entries: [{ ...ENTRY, listedAt: '2026-02-30' }] }],
    ['a date in the future', { entries: [{ ...ENTRY, listedAt: '2999-01-01' }] }],
    ['no reason', { entries: [{ ...ENTRY, reason: '' }] }],
    ['a list that does not exist', { entries: [{ ...ENTRY, sourceList: 'MADE_UP' }] }],
    ['more than five hundred at once', { entries: Array.from({ length: 501 }, (_, i) => ({ ...ENTRY, fullName: `Person ${i}` })) }],
  ])('refuses %s', async (_label, payload) => {
    const actor = await officer();
    await issueSession({ userId: actor.id });

    expect((await post(payload)).status).toBe(422);
    expect(await prisma.sanctionedEntry.count()).toBe(0);
  });
});
