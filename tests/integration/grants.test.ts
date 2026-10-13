import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { ROLE_PERMISSIONS, type Permission } from '@/lib/authz/permissions';
import { grantRole, revokeGrant } from '@/modules/auth/application/grants';
import { createUser } from './support/fixtures';

/**
 * Who may appoint whom, and who may un-appoint whom.
 *
 * Both halves are one rule applied twice: you cannot hand out authority you
 * do not hold, and you cannot take away platform authority you do not hold.
 * The second half was missing — granting was checked from the start, revoking
 * was not — which meant an administrator could not become a super
 * administrator but could remove the one supervising them.
 */

const ADMIN = ROLE_PERMISSIONS.administrator as Permission[];
const SUPER = ROLE_PERMISSIONS.super_administrator as Permission[];
const OWNER = ROLE_PERMISSIONS.facility_owner as Permission[];

/** The suite truncates roles between cases; grantRole creates them on demand. */
async function roleRow(key: string) {
  return prisma.role.upsert({ where: { key }, update: {}, create: { key, name: key } });
}

async function grantTo(userId: string, roleKey: string, by: Permission[]) {
  return grantRole({
    userId,
    roleKey,
    scopeType: 'PLATFORM',
    actorId: userId,
    actorPermissions: by,
  });
}

describe('appointing', () => {
  let target: Awaited<ReturnType<typeof createUser>>;

  beforeEach(async () => {
    target = await createUser({ fullName: 'Grace Adeyemi' });
  });

  it('lets an administrator appoint another administrator', async () => {
    const grant = await grantTo(target.id, 'administrator', ADMIN);
    expect(grant.roleKey).toBe('administrator');
  });

  it('refuses an administrator appointing a super administrator', async () => {
    // `config.manage` is the one platform permission they do not hold, and it
    // is what keeps the two roles from being the same thing.
    await expect(grantTo(target.id, 'super_administrator', ADMIN)).rejects.toMatchObject({
      code: 'cannot_escalate',
    });
  });

  it('lets a super administrator appoint anybody', async () => {
    const grant = await grantTo(target.id, 'super_administrator', SUPER);
    expect(grant.roleKey).toBe('super_administrator');
  });
});

describe('un-appointing', () => {
  it('refuses an administrator revoking a super administrator', async () => {
    const victim = await createUser({ fullName: 'Olufemi Adebayo-Cole' });
    const grant = await grantTo(victim.id, 'super_administrator', SUPER);

    await expect(
      revokeGrant({
        scope: { type: 'PLATFORM' },
        grantId: grant.id,
        actorId: victim.id,
        reason: 'Trying it on.',
        actorPermissions: ADMIN,
      }),
    ).rejects.toMatchObject({ code: 'cannot_revoke_higher' });

    const still = await prisma.userRole.findUniqueOrThrow({ where: { id: grant.id } });
    expect(still.revokedAt).toBeNull();
  });

  it('lets a super administrator revoke a super administrator', async () => {
    // Two of them, because the last one standing cannot be removed at all —
    // that is the case below.
    const staying = await createUser({ fullName: 'First Super' });
    await grantTo(staying.id, 'super_administrator', SUPER);

    const victim = await createUser({ fullName: 'Second Super' });
    const grant = await grantTo(victim.id, 'super_administrator', SUPER);

    const revoked = await revokeGrant({
      scope: { type: 'PLATFORM' },
      grantId: grant.id,
      actorId: victim.id,
      reason: 'Left the organisation.',
      actorPermissions: SUPER,
    });

    expect(revoked.revokedAt).not.toBeNull();
  });

  it('refuses an administrator revoking another administrator', async () => {
    // An equal, not a subordinate. Three administrators able to remove one
    // another is a standoff where the first to click wins, and the trail
    // records a coup rather than a decision.
    const peer = await createUser({ fullName: 'Adaeze Nwachukwu' });
    const grant = await grantTo(peer.id, 'administrator', ADMIN);

    await expect(
      revokeGrant({
        scope: { type: 'PLATFORM' },
        grantId: grant.id,
        actorId: peer.id,
        reason: 'Disagreed with me.',
        actorPermissions: ADMIN,
      }),
    ).rejects.toMatchObject({ code: 'cannot_revoke_peer' });

    const still = await prisma.userRole.findUniqueOrThrow({ where: { id: grant.id } });
    expect(still.revokedAt).toBeNull();
  });

  it('lets a super administrator revoke an administrator', async () => {
    const admin = await createUser({ fullName: 'Ifeoma Chukwuemeka' });
    const grant = await grantTo(admin.id, 'administrator', ADMIN);

    const revoked = await revokeGrant({
      scope: { type: 'PLATFORM' },
      grantId: grant.id,
      actorId: admin.id,
      reason: 'Moved to another team.',
      actorPermissions: SUPER,
    });

    expect(revoked.revokedAt).not.toBeNull();
  });

  it('refuses revoking the last account that can appoint another', async () => {
    /**
     * The lockout the peer rule would otherwise create.
     *
     * Only a super administrator may remove a super administrator, and
     * `config.manage` lives only in that bundle — so two of them removing
     * each other down to zero would leave a platform nobody could ever
     * appoint into again, short of editing the database.
     */
    const onlySuper = await createUser({ fullName: 'Olufemi Adebayo-Cole' });
    const grant = await grantTo(onlySuper.id, 'super_administrator', SUPER);

    await expect(
      revokeGrant({
        scope: { type: 'PLATFORM' },
        grantId: grant.id,
        actorId: onlySuper.id,
        reason: 'Leaving.',
        actorPermissions: SUPER,
      }),
    ).rejects.toMatchObject({ code: 'last_platform_administrator' });
  });

  it('still lets an administrator revoke a practitioner, despite the bundles', async () => {
    /**
     * The case that decides the shape of the rule.
     *
     * A practitioner holds `credential.submit`, `availability.write` and
     * `timesheet.submit`, and no administrator holds any of them — rightly,
     * since a platform administrator should not be submitting timesheets. A
     * plain "you cannot revoke what you could not grant" would therefore stop
     * an administrator removing a practitioner, which is ordinary work.
     *
     * Those permissions are capabilities over one's own record at SELF scope,
     * not authority, which is why the rule is scoped to PLATFORM grants.
     */
    const practitioner = await createUser({ fullName: 'Chidi Okeke' });
    const role = await roleRow('practitioner');
    const grant = await prisma.userRole.create({
      data: {
        userId: practitioner.id,
        roleId: role.id,
        scopeType: 'SELF',
        scopeId: practitioner.id,
      },
    });

    const revoked = await revokeGrant({
      scope: { type: 'SELF', id: practitioner.id },
      grantId: grant.id,
      actorId: practitioner.id,
      reason: 'Struck off the register.',
      actorPermissions: ADMIN,
    });

    expect(revoked.revokedAt).not.toBeNull();
  });

  it('leaves a facility grant to the facility scope check', async () => {
    // An owner holds everything a facility administrator does, but the point
    // here is that the platform-authority rule does not fire below PLATFORM.
    // What confines who may touch a facility's staff is the scope comparison in
    // revokeGrant itself: the grant must lie in the scope the caller named
    // (see 'un-appointing across tenants' below).
    const staff = await createUser({ fullName: 'Hauwa Abdullahi' });
    const facilityRole = await roleRow('facility_administrator');
    const grant = await prisma.userRole.create({
      data: {
        userId: staff.id,
        roleId: facilityRole.id,
        scopeType: 'FACILITY',
        scopeId: staff.id,
      },
    });

    const revoked = await revokeGrant({
      scope: { type: 'FACILITY', id: staff.id },
      grantId: grant.id,
      actorId: staff.id,
      reason: 'Left the hospital.',
      actorPermissions: OWNER,
    });

    expect(revoked.revokedAt).not.toBeNull();
  });
});

describe('giving access back', () => {
  it('re-grants a facility role that was revoked, and keeps the old grant as history', async () => {
    const facilityId = '00000000-0000-4000-8000-00000000fa01';
    const owner = await createUser({ fullName: 'Ngozi Okonkwo-Bello' });
    const colleague = await createUser({ fullName: 'Hauwa Abdullahi' });
    const appoint = () =>
      grantRole({
        userId: colleague.id,
        roleKey: 'facility_administrator',
        scopeType: 'FACILITY',
        scopeId: facilityId,
        actorId: owner.id,
        actorPermissions: OWNER,
      });

    const first = await appoint();
    await revokeGrant({
      scope: { type: 'FACILITY', id: facilityId },
      grantId: first.id,
      actorId: owner.id,
      reason: 'Moved to the night rota at our other site.',
      actorPermissions: OWNER,
    });

    // Used to be a 500: the table-wide unique counted the revoked row.
    const second = await appoint();
    expect(second.id).not.toBe(first.id);

    const rows = await prisma.userRole.findMany({ where: { userId: colleague.id }, orderBy: { createdAt: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.revokedAt).not.toBeNull();
    expect(rows[1]?.revokedAt).toBeNull();

    // And one live grant is still the limit.
    await expect(appoint()).rejects.toMatchObject({ code: 'already_granted' });
  });
});

describe('un-appointing across tenants', () => {
  /**
   * The guard proves the caller holds `role.grant` over the scope the caller
   * *names*. Nothing used to prove the grant being revoked lies in that scope,
   * so the owner of one hospital could name their own hospital and revoke any
   * other hospital's staff by identifier.
   */
  async function facilityGrant(facilityId: string) {
    const user = await createUser({ fullName: 'Hospital Staff Member' });
    const row = await grantRole({
      userId: user.id,
      roleKey: 'facility_administrator',
      scopeType: 'FACILITY',
      scopeId: facilityId,
      actorId: user.id,
      actorPermissions: SUPER,
    });
    return { user, grant: row };
  }

  it('refuses revoking a grant at another facility, whatever scope the caller named', async () => {
    const facilityA = randomUUID();
    const facilityB = randomUUID();
    const owner = await createUser({ fullName: 'Owner Of Hospital A' });
    const { grant: otherTenantsGrant } = await facilityGrant(facilityB);

    await expect(
      revokeGrant({
        scope: { type: 'FACILITY', id: facilityA },
        grantId: otherTenantsGrant.id,
        actorId: owner.id,
        reason: 'Trying to reach into another hospital.',
        actorPermissions: OWNER,
      }),
    ).rejects.toMatchObject({ code: 'grant_not_found' });

    const still = await prisma.userRole.findUniqueOrThrow({ where: { id: otherTenantsGrant.id } });
    expect(still.revokedAt).toBeNull();
  });

  it('refuses naming the wrong kind of scope for a facility grant', async () => {
    const facilityB = randomUUID();
    const owner = await createUser({ fullName: 'Owner Of Hospital A' });
    const { grant: g } = await facilityGrant(facilityB);

    await expect(
      revokeGrant({
        scope: { type: 'PLATFORM' },
        grantId: g.id,
        actorId: owner.id,
        reason: 'Naming a different scope type.',
        actorPermissions: OWNER,
      }),
    ).rejects.toMatchObject({ code: 'grant_not_found' });
  });

  it('still lets an owner revoke staff at their own facility', async () => {
    const facilityA = randomUUID();
    const owner = await createUser({ fullName: 'Owner Of Hospital A' });
    const { grant: own } = await facilityGrant(facilityA);

    const revoked = await revokeGrant({
      scope: { type: 'FACILITY', id: facilityA },
      grantId: own.id,
      actorId: owner.id,
      reason: 'Left the hospital.',
      actorPermissions: OWNER,
    });

    expect(revoked.revokedAt).not.toBeNull();
  });
});
