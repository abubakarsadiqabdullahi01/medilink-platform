import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', async () => {
  const { cookieJar } = await import('./support/cookie-jar');
  return { cookies: () => cookieJar };
});

const sms = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('@/lib/sms', async () => (await import('./support/sms-double')).gatewayDouble(sms.send));

import { prisma } from '@/lib/db';
import { ROLE_PERMISSIONS, type Permission } from '@/lib/authz/permissions';
import {
  changeGrantRole,
  grantRole,
  revokeAllAccess,
  revokeGrant,
} from '@/modules/auth/application/grants';
import { createFacility, verifyFacility } from '@/modules/facilities/application/facility';
import { issueSession } from '@/modules/auth/application/session-service';
import { runOnce } from '@/worker/processor';
import { handlers } from '@/worker/handlers';
import { POST as changeRoleRoute } from '@/app/api/v1/grants/[id]/change-role/route';
import { POST as removeAccessRoute } from '@/app/api/v1/grants/remove-access/route';
import { clearCookies } from './support/cookie-jar';
import { createFacilityType, createState, createUser, ensureRole } from './support/fixtures';

/**
 * M04-06: changing who has access to a facility, safely.
 *
 * Granting and revoking existed; what a hospital could not do was change somebody's role without a
 * gap, remove somebody from everything at once, or be stopped from removing its own last owner,
 * after which nobody at the hospital could add or remove anybody again.
 */

const SUPER = ROLE_PERMISSIONS.super_administrator as Permission[];
const OWNER = ROLE_PERMISSIONS.facility_owner as Permission[];
const FACILITY_ADMINISTRATOR = ROLE_PERMISSIONS.facility_administrator as Permission[];

beforeEach(() => {
  clearCookies();
  sms.send.mockReset();
  sms.send.mockResolvedValue({ provider: 'test', providerMessageId: 'm-1', accepted: true });
});

/** A person holding a role at a facility, appointed by somebody with the authority to. */
async function staffAt(facilityId: string, roleKey: string, name = 'Hauwa Abdullahi') {
  const user = await createUser({ fullName: name });
  const grant = await grantRole({
    userId: user.id,
    roleKey,
    scopeType: 'FACILITY',
    scopeId: facilityId,
    actorId: user.id,
    actorPermissions: SUPER,
  });
  return { user, grant };
}

const scopeOf = (facilityId: string) => ({ type: 'FACILITY' as const, id: facilityId });

const active = (userId: string, facilityId: string) =>
  prisma.userRole.findMany({
    where: { userId, scopeType: 'FACILITY', scopeId: facilityId, revokedAt: null },
    include: { role: true },
  });

describe('a facility’s last owner', () => {
  it('cannot be removed by anybody who holds their authority from the facility, themselves included', async () => {
    const facilityId = randomUUID();
    const owner = await staffAt(facilityId, 'facility_owner', 'Ngozi Okonkwo-Bello');

    await expect(
      revokeGrant({
        scope: scopeOf(facilityId),
        grantId: owner.grant.id,
        actorId: owner.user.id,
        reason: 'Stepping down from the hospital.',
        actorPermissions: OWNER,
      }),
    ).rejects.toMatchObject({ code: 'last_facility_owner', status: 409 });

    expect(await active(owner.user.id, facilityId)).toHaveLength(1);
  });

  it('can be removed once there is another owner who can sign in', async () => {
    const facilityId = randomUUID();
    const first = await staffAt(facilityId, 'facility_owner', 'First Owner');
    await staffAt(facilityId, 'facility_owner', 'Second Owner');

    const revoked = await revokeGrant({
      scope: scopeOf(facilityId),
      grantId: first.grant.id,
      actorId: first.user.id,
      reason: 'Handing over to the deputy.',
      actorPermissions: OWNER,
    });

    expect(revoked.revokedAt).not.toBeNull();
  });

  it('is still the last when the only other owner’s account is suspended', async () => {
    const facilityId = randomUUID();
    const first = await staffAt(facilityId, 'facility_owner', 'First Owner');
    const second = await staffAt(facilityId, 'facility_owner', 'Second Owner');
    await prisma.user.update({ where: { id: second.user.id }, data: { status: 'SUSPENDED' } });

    await expect(
      revokeGrant({
        scope: scopeOf(facilityId),
        grantId: first.grant.id,
        actorId: first.user.id,
        reason: 'Handing over to the deputy.',
        actorPermissions: OWNER,
      }),
    ).rejects.toMatchObject({ code: 'last_facility_owner' });
  });

  it('may be removed by Medilink, which can appoint a replacement afterwards', async () => {
    const facilityId = randomUUID();
    const owner = await staffAt(facilityId, 'facility_owner', 'Compromised Owner');
    const operations = await createUser({ fullName: 'Operations Officer' });

    const revoked = await revokeGrant({
      scope: scopeOf(facilityId),
      grantId: owner.grant.id,
      actorId: operations.id,
      reason: 'The account was taken over.',
      actorPermissions: SUPER,
      actorIsPlatform: true,
    });

    expect(revoked.revokedAt).not.toBeNull();
  });

  it('is not what stops an administrator being removed', async () => {
    const facilityId = randomUUID();
    const owner = await staffAt(facilityId, 'facility_owner', 'Only Owner');
    const administrator = await staffAt(facilityId, 'facility_administrator');

    const revoked = await revokeGrant({
      scope: scopeOf(facilityId),
      grantId: administrator.grant.id,
      actorId: owner.user.id,
      reason: 'Left the hospital.',
      actorPermissions: OWNER,
    });

    expect(revoked.revokedAt).not.toBeNull();
  });
});

describe('two owners removing each other at the same moment', () => {
  it('leaves the facility one owner, not none, however many times it is tried', async () => {
    // Warm the pool first: with one connection open the second transaction waits for a new one,
    // and the two only look as though they ran together.
    await Promise.all(Array.from({ length: 6 }, () => prisma.user.count()));

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const facilityId = randomUUID();
      const first = await staffAt(facilityId, 'facility_owner', 'First Owner');
      const second = await staffAt(facilityId, 'facility_owner', 'Second Owner');
      const remove = (actor: typeof first, target: typeof first) =>
        revokeGrant({
          scope: scopeOf(facilityId),
          grantId: target.grant.id,
          actorId: actor.user.id,
          reason: 'Each thinks the other should go.',
          actorPermissions: OWNER,
        });

      const results = await Promise.allSettled([remove(first, second), remove(second, first)]);

      // One goes, and the other is told they are now the last: never both.
      expect(results.filter((result) => result.status === 'fulfilled'), `attempt ${attempt}`).toHaveLength(1);
      const refused = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
      expect(refused.reason).toMatchObject({ code: 'last_facility_owner' });
      const remaining =
        (await active(first.user.id, facilityId)).length + (await active(second.user.id, facilityId)).length;
      expect(remaining, `attempt ${attempt}`).toBe(1);
    }
  });
});

describe('changing somebody’s role', () => {
  it('is one step: the old role ends and the new one begins together, and the record says both', async () => {
    const facilityId = randomUUID();
    const owner = await staffAt(facilityId, 'facility_owner', 'Ngozi Okonkwo-Bello');
    const colleague = await staffAt(facilityId, 'facility_administrator');

    const changed = await changeGrantRole({
      grantId: colleague.grant.id,
      newRoleKey: 'facility_owner',
      scope: scopeOf(facilityId),
      actorId: owner.user.id,
      reason: 'Now deputy to the medical director.',
      actorPermissions: OWNER,
    });

    expect(changed).toMatchObject({ userId: colleague.user.id, roleKey: 'facility_owner', revokedAt: null });
    const now = await active(colleague.user.id, facilityId);
    expect(now.map((row) => row.role.key)).toEqual(['facility_owner']);
    const old = await prisma.userRole.findUniqueOrThrow({ where: { id: colleague.grant.id } });
    expect(old.revokedAt).not.toBeNull();

    const audit = await prisma.auditLog.findMany({ where: { action: 'role.changed' } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: owner.user.id,
      entityId: changed.id,
      scopeType: 'FACILITY',
      scopeId: facilityId,
      reason: 'Now deputy to the medical director.',
      before: { roleKey: 'facility_administrator' },
      after: { roleKey: 'facility_owner' },
    });
  });

  it('refuses a role the person changing it does not hold themselves, and changes nothing', async () => {
    const facilityId = randomUUID();
    const colleague = await staffAt(facilityId, 'facility_administrator');

    await expect(
      changeGrantRole({
        grantId: colleague.grant.id,
        newRoleKey: 'facility_owner',
        scope: scopeOf(facilityId),
        actorId: randomUUID(),
        reason: 'Trying to promote somebody past my own authority.',
        actorPermissions: FACILITY_ADMINISTRATOR,
      }),
    ).rejects.toMatchObject({ code: 'cannot_escalate' });

    expect((await active(colleague.user.id, facilityId)).map((row) => row.role.key)).toEqual([
      'facility_administrator',
    ]);
  });

  it('refuses changing to the role they already hold', async () => {
    const facilityId = randomUUID();
    const colleague = await staffAt(facilityId, 'facility_administrator');

    await expect(
      changeGrantRole({
        grantId: colleague.grant.id,
        newRoleKey: 'facility_administrator',
        scope: scopeOf(facilityId),
        actorId: randomUUID(),
        reason: 'No change at all.',
        actorPermissions: OWNER,
      }),
    ).rejects.toMatchObject({ code: 'same_role', status: 409 });
  });

  it('refuses when they already hold the new role here, and leaves both as they were', async () => {
    const facilityId = randomUUID();
    const colleague = await staffAt(facilityId, 'facility_administrator');
    await grantRole({
      userId: colleague.user.id,
      roleKey: 'facility_owner',
      scopeType: 'FACILITY',
      scopeId: facilityId,
      actorId: colleague.user.id,
      actorPermissions: SUPER,
    });

    await expect(
      changeGrantRole({
        grantId: colleague.grant.id,
        newRoleKey: 'facility_owner',
        scope: scopeOf(facilityId),
        actorId: randomUUID(),
        reason: 'They are an owner already.',
        actorPermissions: OWNER,
      }),
    ).rejects.toMatchObject({ code: 'already_granted' });

    expect(await active(colleague.user.id, facilityId)).toHaveLength(2);
  });

  it('will not take the last owner’s ownership away from them, however it is phrased', async () => {
    const facilityId = randomUUID();
    const owner = await staffAt(facilityId, 'facility_owner', 'Only Owner');

    await expect(
      changeGrantRole({
        grantId: owner.grant.id,
        newRoleKey: 'facility_administrator',
        scope: scopeOf(facilityId),
        actorId: owner.user.id,
        reason: 'Stepping down to an ordinary administrator.',
        actorPermissions: OWNER,
      }),
    ).rejects.toMatchObject({ code: 'last_facility_owner' });

    expect((await active(owner.user.id, facilityId)).map((row) => row.role.key)).toEqual(['facility_owner']);
  });

  it('does not reach a grant at another facility, whatever the caller named', async () => {
    const facilityA = randomUUID();
    const facilityB = randomUUID();
    const theirs = await staffAt(facilityB, 'facility_administrator');

    await expect(
      changeGrantRole({
        grantId: theirs.grant.id,
        newRoleKey: 'facility_owner',
        scope: scopeOf(facilityA),
        actorId: randomUUID(),
        reason: 'Reaching into another hospital.',
        actorPermissions: OWNER,
      }),
    ).rejects.toMatchObject({ code: 'grant_not_found' });

    expect((await active(theirs.user.id, facilityB)).map((row) => row.role.key)).toEqual(['facility_administrator']);
  });
});

describe('removing all of somebody’s access at once', () => {
  it('ends every role they hold at that facility, and leaves what they hold elsewhere alone', async () => {
    const facilityId = randomUUID();
    const elsewhere = randomUUID();
    await staffAt(facilityId, 'facility_owner', 'Owner Who Stays');
    const person = await staffAt(facilityId, 'facility_administrator', 'Person To Remove');
    const second = await grantRole({
      userId: person.user.id,
      roleKey: 'facility_owner',
      scopeType: 'FACILITY',
      scopeId: facilityId,
      actorId: person.user.id,
      actorPermissions: SUPER,
    });
    const other = await grantRole({
      userId: person.user.id,
      roleKey: 'facility_administrator',
      scopeType: 'FACILITY',
      scopeId: elsewhere,
      actorId: person.user.id,
      actorPermissions: SUPER,
    });

    const result = await revokeAllAccess({
      userId: person.user.id,
      scope: scopeOf(facilityId),
      actorId: randomUUID(),
      reason: 'Left without notice and still has the keys.',
      actorPermissions: OWNER,
    });

    expect(result.revoked.map((row) => row.id).sort()).toEqual([person.grant.id, second.id].sort());
    expect(await active(person.user.id, facilityId)).toHaveLength(0);
    // Their access to the other hospital is that hospital's business.
    expect((await active(person.user.id, elsewhere)).map((row) => row.id)).toEqual([other.id]);
  });

  it('is on the record as each role ended and as one emergency removal, with the reason', async () => {
    const facilityId = randomUUID();
    await staffAt(facilityId, 'facility_owner', 'Owner Who Stays');
    const person = await staffAt(facilityId, 'facility_administrator', 'Person To Remove');
    const actor = randomUUID();

    await revokeAllAccess({
      userId: person.user.id,
      scope: scopeOf(facilityId),
      actorId: actor,
      reason: 'Left without notice and still has the keys.',
      actorPermissions: OWNER,
    });

    const ended = await prisma.auditLog.findMany({ where: { action: 'role.revoked', entityId: person.grant.id } });
    expect(ended).toHaveLength(1);
    expect(ended[0]?.reason).toContain('Left without notice');
    const summary = await prisma.auditLog.findMany({ where: { action: 'access.emergency_revoked' } });
    expect(summary).toHaveLength(1);
    expect(summary[0]).toMatchObject({
      actorId: actor,
      entityId: person.user.id,
      scopeType: 'FACILITY',
      scopeId: facilityId,
      after: { grantsEnded: 1 },
    });
  });

  it('finds nothing to remove for somebody who holds no access here', async () => {
    const facilityId = randomUUID();
    const stranger = await createUser({ fullName: 'Holds Nothing Here' });

    await expect(
      revokeAllAccess({
        userId: stranger.id,
        scope: scopeOf(facilityId),
        actorId: randomUUID(),
        reason: 'Making sure.',
        actorPermissions: OWNER,
      }),
    ).rejects.toMatchObject({ code: 'grant_not_found' });
  });

  it('applies the last-owner rule to somebody holding the facility’s authority, and lets Medilink past it', async () => {
    const facilityId = randomUUID();
    const owner = await staffAt(facilityId, 'facility_owner', 'Only Owner');
    const input = {
      userId: owner.user.id,
      scope: scopeOf(facilityId),
      actorId: owner.user.id,
      reason: 'The account may be in somebody else’s hands.',
      actorPermissions: OWNER,
    };

    await expect(revokeAllAccess(input)).rejects.toMatchObject({ code: 'last_facility_owner' });
    expect(await active(owner.user.id, facilityId)).toHaveLength(1);

    const result = await revokeAllAccess({ ...input, actorPermissions: SUPER, actorIsPlatform: true });
    expect(result.revoked).toHaveLength(1);
  });

  it('removes nothing at all when one of the roles may not be removed by this person', async () => {
    const facilityId = randomUUID();
    const person = await staffAt(facilityId, 'facility_administrator');
    const platform = await grantRole({
      userId: person.user.id,
      roleKey: 'administrator',
      scopeType: 'PLATFORM',
      actorId: person.user.id,
      actorPermissions: SUPER,
    });

    // The scope named is the facility, so the platform grant is not in it and is not touched.
    const result = await revokeAllAccess({
      userId: person.user.id,
      scope: scopeOf(facilityId),
      actorId: randomUUID(),
      reason: 'Removing the facility role only.',
      actorPermissions: OWNER,
    });

    expect(result.revoked.map((row) => row.id)).toEqual([person.grant.id]);
    expect((await prisma.userRole.findUniqueOrThrow({ where: { id: platform.id } })).revokedAt).toBeNull();
  });
});

/** A facility that exists, is verified and has a name, so a text can say which. */
async function realFacility(name: string) {
  await ensureRole('facility_owner', OWNER);
  const state = await createState();
  const facilityType = await createFacilityType();
  const representative = await createUser({ fullName: `${name} Representative` });
  const operations = await createUser({ fullName: 'Operations Officer' });
  const officer = await createUser({ fullName: 'Compliance Officer' });
  const facility = await createFacility({
    name,
    facilityTypeId: facilityType.id,
    cacNumber: `RC${800_000 + Math.floor(Math.random() * 99_999)}`,
    stateId: state.id,
    addressLine: '1 Hospital Road',
    contactPhone: '+2348031234567',
    representativeUserId: representative.id,
    actorId: operations.id,
  });
  await verifyFacility({ facilityId: facility.id, verifierId: officer.id, decision: 'approve' });
  // The representative is the facility's first owner; make sure of it without relying on how.
  const holds = await prisma.userRole.count({
    where: { userId: representative.id, scopeType: 'FACILITY', scopeId: facility.id, revokedAt: null },
  });
  if (holds === 0) {
    await grantRole({
      userId: representative.id,
      roleKey: 'facility_owner',
      scopeType: 'FACILITY',
      scopeId: facility.id,
      actorId: representative.id,
      actorPermissions: SUPER,
    });
  }
  return { facilityId: facility.id, representative };
}

const textsTo = (phone: string) =>
  sms.send.mock.calls.map((call) => call[0] as { to: string; body: string }).filter((message) => message.to === phone);

describe('who is told when all of somebody’s access is removed', () => {
  async function removal() {
    const { facilityId, representative } = await realFacility('Owerri General Hospital');
    const second = await staffAt(facilityId, 'facility_owner', 'Second Owner');
    const person = await staffAt(facilityId, 'facility_administrator', 'Person To Remove');
    // Setting the facility up told its representative it was verified; that is not what is counted.
    await runOnce({ handlers });
    sms.send.mockClear();
    await revokeAllAccess({
      userId: person.user.id,
      scope: scopeOf(facilityId),
      actorId: representative.id,
      reason: 'Left without notice and still has the keys.',
      actorPermissions: OWNER,
    });
    await runOnce({ handlers });
    return { facilityId, representative, second, person };
  }

  it('tells the person, without saying why', async () => {
    const { person } = await removal();
    const phone = (await prisma.user.findUniqueOrThrow({ where: { id: person.user.id } })).phone;

    const texts = textsTo(phone);

    expect(texts).toHaveLength(1);
    expect(texts[0]!.body).toContain('Owerri General Hospital');
    expect(texts[0]!.body).toMatch(/removed/i);
    expect(texts[0]!.body).not.toContain('keys');
    expect(texts[0]!.body).not.toContain('Left without notice');
  });

  it('tells the other people who can add and remove staff, and not the one who did it nor the one removed', async () => {
    const { representative, second, person } = await removal();
    const phoneOf = async (id: string) => (await prisma.user.findUniqueOrThrow({ where: { id } })).phone;

    const toSecond = textsTo(await phoneOf(second.user.id));
    expect(toSecond).toHaveLength(1);
    expect(toSecond[0]!.body).toContain('Owerri General Hospital');
    expect(toSecond[0]!.body).not.toContain('Person To Remove');
    expect(textsTo(await phoneOf(representative.id))).toHaveLength(0);
    // The person removed got the other message, not this one.
    expect(textsTo(await phoneOf(person.user.id)).every((message) => message.body !== toSecond[0]!.body)).toBe(true);
  });

  it('sends each text once when the event is delivered again', async () => {
    const { person } = await removal();
    const before = sms.send.mock.calls.length;

    await prisma.outboxEvent.updateMany({
      where: { eventType: 'staff.access_removed' },
      data: { status: 'PENDING', availableAt: new Date(Date.now() - 1000), processedAt: null },
    });
    await runOnce({ handlers });

    expect(sms.send.mock.calls.length).toBe(before);
    const phone = (await prisma.user.findUniqueOrThrow({ where: { id: person.user.id } })).phone;
    expect(textsTo(phone)).toHaveLength(1);
  });

  it('is not sent for taking away one role, which is the ordinary way to remove somebody', async () => {
    const { facilityId, representative } = await realFacility('Owerri General Hospital');
    await staffAt(facilityId, 'facility_owner', 'Second Owner');
    const person = await staffAt(facilityId, 'facility_administrator', 'Person To Remove');
    await runOnce({ handlers });
    sms.send.mockClear();

    await revokeGrant({
      scope: scopeOf(facilityId),
      grantId: person.grant.id,
      actorId: representative.id,
      reason: 'Left the hospital.',
      actorPermissions: OWNER,
    });
    await runOnce({ handlers });

    expect(sms.send).not.toHaveBeenCalled();
  });
});

describe('through the routes', () => {
  async function asOwner(facilityId: string, userId: string) {
    clearCookies();
    await issueSession({ userId, stepUp: true });
    return facilityId;
  }

  it('changes a role for the owner of the facility, who has just re-entered their password', async () => {
    const { facilityId, representative } = await realFacility('Owerri General Hospital');
    const colleague = await staffAt(facilityId, 'facility_administrator');
    await asOwner(facilityId, representative.id);

    const response = await changeRoleRoute(
      new Request(`http://localhost/api/v1/grants/${colleague.grant.id}/change-role`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          scopeType: 'FACILITY',
          scopeId: facilityId,
          roleKey: 'facility_owner',
          reason: 'Now deputy to the medical director.',
        }),
      }),
      { params: Promise.resolve({ id: colleague.grant.id }) },
    );

    expect(response.status).toBe(200);
    expect((await active(colleague.user.id, facilityId)).map((row) => row.role.key)).toEqual(['facility_owner']);
  });

  it('asks for the password first, as every change of who has access does', async () => {
    const { facilityId, representative } = await realFacility('Owerri General Hospital');
    const colleague = await staffAt(facilityId, 'facility_administrator');
    clearCookies();
    await issueSession({ userId: representative.id });

    const response = await changeRoleRoute(
      new Request(`http://localhost/api/v1/grants/${colleague.grant.id}/change-role`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          scopeType: 'FACILITY',
          scopeId: facilityId,
          roleKey: 'facility_owner',
          reason: 'Now deputy to the medical director.',
        }),
      }),
      { params: Promise.resolve({ id: colleague.grant.id }) },
    );

    expect(response.status).toBe(401);
    expect(((await response.json()) as { error?: { code?: string } }).error?.code).toBe('step_up_required');
    expect((await active(colleague.user.id, facilityId)).map((row) => row.role.key)).toEqual(['facility_administrator']);
  });

  it('removes all of somebody’s access for the owner of the facility', async () => {
    const { facilityId, representative } = await realFacility('Owerri General Hospital');
    await staffAt(facilityId, 'facility_owner', 'Second Owner');
    const person = await staffAt(facilityId, 'facility_administrator', 'Person To Remove');
    await asOwner(facilityId, representative.id);

    const response = await removeAccessRoute(
      new Request('http://localhost/api/v1/grants/remove-access', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          userId: person.user.id,
          scopeType: 'FACILITY',
          scopeId: facilityId,
          reason: 'Left without notice and still has the keys.',
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await active(person.user.id, facilityId)).toHaveLength(0);
  });

  it('refuses the owner of one facility removing somebody from another', async () => {
    const mine = await realFacility('Owerri General Hospital');
    const theirs = await realFacility('Enugu Teaching Hospital');
    await staffAt(theirs.facilityId, 'facility_owner', 'Their Second Owner');
    const person = await staffAt(theirs.facilityId, 'facility_administrator', 'Their Administrator');
    await asOwner(mine.facilityId, mine.representative.id);

    const response = await removeAccessRoute(
      new Request('http://localhost/api/v1/grants/remove-access', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          userId: person.user.id,
          scopeType: 'FACILITY',
          scopeId: theirs.facilityId,
          reason: 'Reaching into another hospital.',
        }),
      }),
    );

    expect(response.status).toBe(403);
    expect(await active(person.user.id, theirs.facilityId)).toHaveLength(1);
  });
});
