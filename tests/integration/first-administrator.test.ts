import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', async () => {
  const { cookieJar } = await import('./support/cookie-jar');
  return { cookies: () => cookieJar };
});

import { prisma } from '@/lib/db';
import { verifyPassword } from '@/lib/password';
import { login } from '@/modules/auth/application/login';
import { createFirstAdministrator } from '@/modules/auth/application/first-administrator';
import { clearCookies } from './support/cookie-jar';
import { createUser, grant } from './support/fixtures';

beforeEach(() => {
  clearCookies();
});

/**
 * AUT-08: nobody could be the first administrator of a production system.
 *
 * `super_administrator` is never offered in a grant list, and the scripts that
 * create one refuse to run anywhere but a developer's machine because they set
 * a published password. So the first person to hold the keys had to be put in
 * by hand with SQL, which is not a thing a hospital pilot should depend on.
 *
 * The command under test is the one deliberate way in: it is refused once an
 * administrator exists, it never prints or stores a password in clear, and it
 * leaves a record of having been run.
 */

const PASSWORD = 'correct-horse-battery-staple';

const FIRST = {
  phone: '0803 555 0101',
  fullName: 'Hadiza Lawal',
  email: 'Hadiza.Lawal@example.org',
  password: PASSWORD,
  operator: 'deploy-engineer',
};

describe('creating the first administrator', () => {
  it('makes an active, verified account that holds every permission', async () => {
    const result = await createFirstAdministrator(FIRST);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: result.userId } });
    expect(user.phone).toBe('+2348035550101');
    expect(user.email).toBe('hadiza.lawal@example.org');
    expect(user.status).toBe('ACTIVE');
    expect(user.phoneVerifiedAt).not.toBeNull();

    const grants = await prisma.userRole.findMany({
      where: { userId: user.id, revokedAt: null },
      include: { role: { include: { permissions: { include: { permission: true } } } } },
    });
    expect(grants).toHaveLength(1);
    expect(grants[0]!.role.key).toBe('super_administrator');
    expect(grants[0]!.scopeType).toBe('PLATFORM');
    expect(grants[0]!.scopeId).toBeNull();
    // A role with no permissions looks exactly like a grant that failed.
    expect(grants[0]!.role.permissions.length).toBeGreaterThan(10);
  });

  it('works on an empty database, with no seed run first', async () => {
    expect(await prisma.role.count()).toBe(0);

    await createFirstAdministrator(FIRST);

    expect(await prisma.role.findUnique({ where: { key: 'super_administrator' } })).not.toBeNull();
  });

  it('can sign in with the password it was given, and no other', async () => {
    await createFirstAdministrator(FIRST);

    const session = await login({ phone: FIRST.phone, password: PASSWORD });
    expect(session.token).toBeTruthy();
    await expect(login({ phone: FIRST.phone, password: 'not-the-password' })).rejects.toMatchObject({
      code: 'invalid_credentials',
    });
  });

  it('stores the password only as a hash', async () => {
    const result = await createFirstAdministrator(FIRST);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: result.userId } });
    expect(user.passwordHash).not.toContain(PASSWORD);
    expect(await verifyPassword(user.passwordHash!, PASSWORD)).toBe(true);
    expect(JSON.stringify(result)).not.toContain(PASSWORD);
  });

  it('records that it was run, by whom, without the person\'s details', async () => {
    const result = await createFirstAdministrator(FIRST);

    const rows = await prisma.auditLog.findMany({ where: { action: 'administrator.bootstrapped' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actorType).toBe('system');
    expect(rows[0]!.entityId).toBe(result.userId);
    const written = JSON.stringify(rows[0]);
    expect(written).toContain('deploy-engineer');
    expect(written).toContain('super_administrator');
    for (const personal of ['Hadiza', 'Lawal', '8035550101', 'example.org', PASSWORD]) {
      expect(written).not.toContain(personal);
    }
  });
});

describe('refusing when it should', () => {
  it('will not run again once a super administrator exists', async () => {
    await createFirstAdministrator(FIRST);

    await expect(
      createFirstAdministrator({ ...FIRST, phone: '0803 555 0102', email: 'other@example.org' }),
    ).rejects.toMatchObject({ code: 'administrator_exists' });

    expect(await prisma.user.count()).toBe(1);
  });

  it('can be told it is deliberately adding another, and says so in the record', async () => {
    await createFirstAdministrator(FIRST);

    const second = await createFirstAdministrator({
      ...FIRST,
      phone: '0803 555 0102',
      email: 'other@example.org',
      fullName: 'Chidi Okeke',
      additional: true,
    });

    expect(await prisma.userRole.count({ where: { revokedAt: null } })).toBe(2);
    const row = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'administrator.bootstrapped', entityId: second.userId },
    });
    expect(JSON.stringify(row.after)).toContain('"additional":true');
  });

  it('does not count a revoked super administrator as one that exists', async () => {
    const first = await createFirstAdministrator(FIRST);
    await prisma.userRole.updateMany({ where: { userId: first.userId }, data: { revokedAt: new Date() } });

    const again = await createFirstAdministrator({
      ...FIRST,
      phone: '0803 555 0102',
      email: 'other@example.org',
    });

    expect(again.userId).not.toBe(first.userId);
  });

  it('does not let an ordinary administrator count as the first', async () => {
    const ops = await createUser({ fullName: 'Operations' });
    await grant({ userId: ops.id, roleKey: 'administrator', permissions: ['facility.verify'], scopeType: 'PLATFORM' });

    await expect(createFirstAdministrator(FIRST)).resolves.toMatchObject({ phone: '+2348035550101' });
  });

  it('will not take over a number that already has an account', async () => {
    const existing = await createUser({ fullName: 'Somebody Else' });

    await expect(
      createFirstAdministrator({ ...FIRST, phone: existing.phone }),
    ).rejects.toMatchObject({ code: 'phone_registered' });

    const stillThere = await prisma.user.findUniqueOrThrow({ where: { id: existing.id } });
    expect(stillThere.passwordHash).toBeNull();
    expect(await prisma.userRole.count()).toBe(0);
  });

  it('refuses a weak password, and says why', async () => {
    await expect(createFirstAdministrator({ ...FIRST, password: 'short' })).rejects.toMatchObject({
      code: 'password_rejected',
    });
    await expect(
      createFirstAdministrator({ ...FIRST, password: 'Hadiza-0803-555-0101-ok' }),
    ).rejects.toMatchObject({ code: 'password_rejected' });

    expect(await prisma.user.count()).toBe(0);
  });

  it('refuses a number that is not Nigerian mobile, before writing anything', async () => {
    await expect(createFirstAdministrator({ ...FIRST, phone: '12345' })).rejects.toThrow();

    expect(await prisma.user.count()).toBe(0);
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it('leaves nothing behind when the email is already taken', async () => {
    await createUser({ fullName: 'Taken' }).then((u) =>
      prisma.user.update({ where: { id: u.id }, data: { email: 'hadiza.lawal@example.org' } }),
    );

    await expect(createFirstAdministrator(FIRST)).rejects.toMatchObject({ code: 'email_registered' });

    expect(await prisma.userRole.count()).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'administrator.bootstrapped' } })).toBe(0);
  });
});
