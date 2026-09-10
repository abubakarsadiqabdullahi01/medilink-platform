import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', async () => {
  const { cookieJar } = await import('./support/cookie-jar');
  return { cookies: () => cookieJar };
});

import { prisma } from '@/lib/db';
import { EVENTS } from '@/lib/events';
import {
  clearScreeningFlag,
  getScreeningResult,
  screenAllPractitioners,
  screenPractitioner,
} from '@/modules/practitioners/application/screening';
import { jobs, JOB_DEFINITIONS } from '@/worker/jobs';
import { runDueJobs } from '@/worker/scheduler';
import { recordProfessionalRegistration } from '@/modules/practitioners/application/verification';
import { createProfile } from '@/modules/practitioners/application/profile';
import {
  createProfessionalCategory,
  createSanctionedEntry,
  createUser,
} from './support/fixtures';
import { clearCookies } from './support/cookie-jar';

/**
 * Step 5.6 — sanctioned and quack-list screening, at registration and on a
 * schedule. Its stated verification: "seed a listed name, run the job, assert
 * the account is flagged and matching blocked".
 *
 * The blocking half is the eligibility rule's, in 5.8; what is asserted here
 * is that the flag is raised, survives, and can be answered.
 */

async function practitionerWithProfile(fullName: string) {
  const user = await createUser({ fullName });
  const category = await createProfessionalCategory();
  await createProfile({
    userId: user.id,
    professionalCategoryId: category.id,
    yearsOfExperience: 5,
  });
  return user;
}

beforeEach(() => {
  clearCookies();
});

describe('screening one practitioner', () => {
  it('clears somebody who is on no list', async () => {
    const user = await createUser({ fullName: 'Chinedu Okafor' });
    await createSanctionedEntry({ fullName: 'Amina Yusuf' });

    const result = await screenPractitioner(user.id);

    expect(result?.status).toBe('CLEAR');
    expect(result?.matchedEntryId).toBeNull();
  });

  it('flags a listed name and records what matched', async () => {
    const user = await createUser({ fullName: 'Dr Amina Yusuf' });
    const entry = await createSanctionedEntry({
      fullName: 'Amina Yusuf',
      reason: 'Struck off, 2025',
    });

    const result = await screenPractitioner(user.id);

    expect(result?.status).toBe('FLAGGED');
    expect(result?.matchedEntryId).toBe(entry.id);
    expect(result?.matchedOn).toBe('name');
  });

  it('flags a listed folio even when the name is different', async () => {
    const user = await createUser({ fullName: 'Someone Entirely Different' });
    const officer = await createUser({ fullName: 'Compliance Officer' });
    await recordProfessionalRegistration({
      userId: user.id,
      regulator: 'MDCN',
      folioNumber: 'MDCN/R/12345',
      registrationStatus: 'ACTIVE',
      actorId: officer.id,
    });
    await createSanctionedEntry({ fullName: 'Amina Yusuf', folioNumber: 'MDCN/R/12345' });

    const result = await screenPractitioner(user.id);

    // Re-registering under a new name is exactly what the folio check is for.
    expect(result?.status).toBe('FLAGGED');
    expect(result?.matchedOn).toBe('folio');
  });

  it('publishes sanction.applied when it flags, and not when it clears', async () => {
    const flagged = await createUser({ fullName: 'Amina Yusuf' });
    const clear = await createUser({ fullName: 'Chinedu Okafor' });
    await createSanctionedEntry({ fullName: 'Amina Yusuf' });

    await screenPractitioner(flagged.id);
    await screenPractitioner(clear.id);

    const events = await prisma.outboxEvent.findMany({
      where: { eventType: EVENTS.SanctionApplied },
    });
    expect(events).toHaveLength(1);
  });

  it('writes an audit row when the result changes, and not when it repeats', async () => {
    const user = await createUser({ fullName: 'Amina Yusuf' });
    await createSanctionedEntry({ fullName: 'Amina Yusuf' });

    await screenPractitioner(user.id);
    await screenPractitioner(user.id);
    await screenPractitioner(user.id);

    // A nightly sweep over every practitioner would otherwise write a row per
    // person per night, and the trail that matters would drown in it.
    const audited = await prisma.auditLog.findMany({
      where: { entityType: 'practitioners.screening_results' },
    });
    expect(audited).toHaveLength(1);
  });
});

describe('the scheduled sweep', () => {
  it('flags a practitioner added to the list after they registered', async () => {
    const user = await practitionerWithProfile('Amina Yusuf');

    await screenPractitioner(user.id);
    expect((await getScreeningResult(user.id))?.status).toBe('CLEAR');

    // Someone struck off in March was not on the list in February. A platform
    // that only ever checked at signup would keep matching them indefinitely.
    await createSanctionedEntry({ fullName: 'Amina Yusuf', reason: 'Struck off after signup' });
    const sweep = await screenAllPractitioners();

    expect(sweep.screened).toBe(1);
    expect(sweep.flagged).toBe(1);
    expect((await getScreeningResult(user.id))?.status).toBe('FLAGGED');
  });

  it('runs through the scheduler as a registered job', async () => {
    const user = await practitionerWithProfile('Amina Yusuf');
    await createSanctionedEntry({ fullName: 'Amina Yusuf' });

    await prisma.scheduledJob.create({
      data: {
        key: 'screening.sweep',
        description: JOB_DEFINITIONS[0]?.description ?? 'sweep',
        intervalSeconds: 86_400,
        nextRunAt: new Date(Date.now() - 1000),
      },
    });

    const pass = await runDueJobs({ handlers: jobs });

    expect(pass).toMatchObject({ claimed: 1, succeeded: 1 });
    expect((await getScreeningResult(user.id))?.status).toBe('FLAGGED');
  });
});

describe('answering a flag', () => {
  it('lets a compliance officer clear a false positive', async () => {
    const user = await createUser({ fullName: 'Amina Yusuf' });
    const officer = await createUser({ fullName: 'Compliance Officer' });
    await createSanctionedEntry({ fullName: 'Amina Yusuf' });
    await screenPractitioner(user.id);

    const cleared = await clearScreeningFlag({
      userId: user.id,
      actorId: officer.id,
      notes: 'Different person: date of birth and folio both differ.',
    });

    expect(cleared.status).toBe('CLEAR');
    expect(cleared.clearedBy).toBe(officer.id);
  });

  it('does not re-flag a cleared near-miss on the next sweep', async () => {
    const user = await practitionerWithProfile('Amina Yusuf');
    const officer = await createUser({ fullName: 'Compliance Officer' });
    await createSanctionedEntry({ fullName: 'Amina Yusuf' });
    await screenPractitioner(user.id);
    await clearScreeningFlag({ userId: user.id, actorId: officer.id, notes: 'Different person.' });

    await screenAllPractitioners();

    // Two people sharing a name would otherwise be re-flagged every night
    // forever, and the officer's answer would mean nothing.
    expect((await getScreeningResult(user.id))?.status).toBe('CLEAR');
  });

  it('flags again when a different entry matches', async () => {
    const user = await practitionerWithProfile('Amina Yusuf');
    const officer = await createUser({ fullName: 'Compliance Officer' });
    await createSanctionedEntry({ fullName: 'Amina Yusuf', sourceList: 'MDCN_QUACK_LIST' });
    await screenPractitioner(user.id);
    await clearScreeningFlag({ userId: user.id, actorId: officer.id, notes: 'Different person.' });

    // The clearance answered one entry, not every future one.
    await prisma.sanctionedEntry.deleteMany({});
    await createSanctionedEntry({ fullName: 'Amina Yusuf', sourceList: 'INTERNAL' });
    await screenAllPractitioners();

    expect((await getScreeningResult(user.id))?.status).toBe('FLAGGED');
  });

  it('refuses to clear a result that is not flagged', async () => {
    const user = await createUser({ fullName: 'Chinedu Okafor' });
    const officer = await createUser({ fullName: 'Compliance Officer' });
    await screenPractitioner(user.id);

    await expect(
      clearScreeningFlag({ userId: user.id, actorId: officer.id, notes: 'Nothing to clear.' }),
    ).rejects.toThrow(/not flagged/);
  });
});
