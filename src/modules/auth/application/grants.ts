import type { Prisma } from '@prisma/client';
import { prisma, type Tx } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { EVENTS } from '@/lib/events';
import { publishEvent } from '@/lib/outbox';
import { HttpError } from '@/lib/http/errors';
import { PERMISSIONS, ROLE_PERMISSIONS, type Permission } from '@/lib/authz/permissions';

/**
 * Granting somebody a role over a scope.
 *
 * `role.grant` has been in the permission catalogue since Stage 4 and until
 * now nothing implemented it. The consequence was not theoretical: operations
 * could onboard a hospital and then had no way to give anybody access to it,
 * so every scheduler and every ward manager on the platform had to be created
 * by a script with a database connection. Found by walking the product as a
 * user rather than as a test.
 *
 * Granting is deliberately not an ordinary write. It is the act that decides
 * what everybody else may do, so it requires step-up authentication (already
 * in `STEP_UP_PERMISSIONS`), it is audited at the scope it affects, and a
 * revocation keeps the row rather than deleting it.
 */

export const GrantErrors = {
  userNotFound: () => new HttpError('user_not_found', 'That user does not exist.', 404),
  unknownRole: (key: string) =>
    new HttpError('unknown_role', `There is no role called ${key}.`, 422),
  scopeRequired: () =>
    new HttpError(
      'scope_required',
      'Name the facility this role applies to. Only a PLATFORM grant may omit one.',
      422,
    ),
  alreadyGranted: () =>
    new HttpError('already_granted', 'They already hold that role over that scope.', 409),
  grantNotFound: () => new HttpError('grant_not_found', 'That grant does not exist.', 404),
  cannotEscalate: () =>
    new HttpError(
      'cannot_escalate',
      'You cannot grant a permission you do not hold yourself.',
      403,
    ),
  cannotRevokeHigher: (roleKey: string) =>
    new HttpError(
      'cannot_revoke_higher',
      `You cannot revoke ${roleKey} at platform scope — it carries permissions you do not hold yourself.`,
      403,
    ),
  cannotRevokePeer: (roleKey: string) =>
    new HttpError(
      'cannot_revoke_peer',
      `You cannot revoke ${roleKey} at platform scope — they hold exactly what you hold, and removing an equal is not yours to do. Ask a super administrator.`,
      403,
    ),
  lastFacilityOwner: () =>
    new HttpError(
      'last_facility_owner',
      'This is the only person who can add and remove staff here, and nobody else could once they were gone. Appoint another owner first, or ask Medilink to step in.',
      409,
    ),
  sameRole: () => new HttpError('same_role', 'They already hold that role.', 409),
  lastPlatformAdministrator: () =>
    new HttpError(
      'last_platform_administrator',
      'This is the only account left that can appoint another. Revoking it would lock everybody out permanently — appoint a replacement first.',
      409,
    ),
};

export interface GrantView {
  id: string;
  userId: string;
  fullName: string;
  roleKey: string;
  scopeType: string;
  scopeId: string | null;
  grantedAt: Date;
  revokedAt: Date | null;
}

/** The roles somebody can be given, with what each actually allows. */
export function grantableRoles(): { key: string; permissions: Permission[] }[] {
  return Object.entries(ROLE_PERMISSIONS)
    // Never offered in a list: it holds every permission there is, and
    // creating one is a deliberate act with a database connection behind it.
    .filter(([key]) => key !== 'super_administrator')
    .map(([key, permissions]) => ({ key, permissions }));
}

/**
 * Ensures the role row and its permissions exist.
 *
 * A role created without its permissions is a grant that authorises nothing —
 * which looks exactly like a grant that silently failed, and cost a day the
 * first time it happened.
 */
async function ensureRole(tx: Tx, key: string) {
  const permissions = ROLE_PERMISSIONS[key];
  if (!permissions) throw GrantErrors.unknownRole(key);

  const role = await tx.role.upsert({
    where: { key },
    update: {},
    create: { key, name: key },
  });

  for (const permissionKey of permissions) {
    const permission = await tx.permission.upsert({
      where: { key: permissionKey },
      update: {},
      create: { key: permissionKey, description: PERMISSIONS[permissionKey] },
    });
    await tx.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
      update: {},
      create: { roleId: role.id, permissionId: permission.id },
    });
  }

  return role;
}

export interface GrantRoleParams {
  userId: string;
  roleKey: string;
  scopeType: 'PLATFORM' | 'FACILITY_GROUP' | 'FACILITY' | 'BRANCH' | 'DEPARTMENT' | 'SELF';
  scopeId?: string;
  actorId: string;
  /** What the granting actor themselves holds, for the escalation check. */
  actorPermissions: string[];
}

export async function grantRole(input: GrantRoleParams): Promise<GrantView> {
  const user = await prisma.user.findUnique({ where: { id: input.userId } });
  if (!user || user.deletedAt) throw GrantErrors.userNotFound();

  const permissions = ROLE_PERMISSIONS[input.roleKey];
  if (!permissions) throw GrantErrors.unknownRole(input.roleKey);

  // Everything except PLATFORM is a grant *over something*, and a FACILITY
  // grant with no facility would authorise nothing or everything depending on
  // how the guard read it. Neither is acceptable.
  if (input.scopeType !== 'PLATFORM' && !input.scopeId) throw GrantErrors.scopeRequired();

  /**
   * Nobody can grant what they do not hold.
   *
   * Without this, `role.grant` is the only permission anyone needs: a
   * facility administrator could grant themselves `payout.manage` and release
   * money. The check is against the granting actor's own effective
   * permissions, so a PLATFORM holder can still grant anything they have.
   */
  const held = new Set(input.actorPermissions);
  const escalating = permissions.filter((permission) => !held.has(permission));
  if (escalating.length > 0) throw GrantErrors.cannotEscalate();

  const existing = await prisma.userRole.findFirst({
    where: {
      userId: input.userId,
      scopeType: input.scopeType,
      scopeId: input.scopeId ?? null,
      revokedAt: null,
      role: { key: input.roleKey },
    },
  });
  if (existing) throw GrantErrors.alreadyGranted();

  return prisma.$transaction(async (tx: Tx) => {
    const role = await ensureRole(tx, input.roleKey);

    const grant = await tx.userRole.create({
      data: {
        userId: input.userId,
        roleId: role.id,
        scopeType: input.scopeType,
        scopeId: input.scopeId ?? null,
        grantedBy: input.actorId,
      },
    });

    await recordAudit(tx, {
      action: 'role.granted',
      entityType: 'identity.user_roles',
      entityId: grant.id,
      actorId: input.actorId,
      // Audited at the scope it affects, so a facility reading its own trail
      // sees who was given access to it.
      scopeType: input.scopeType === 'SELF' ? 'SELF' : input.scopeType,
      scopeId: input.scopeId ?? input.userId,
      after: { roleKey: input.roleKey, userId: input.userId, permissions },
    });

    return {
      id: grant.id,
      userId: user.id,
      fullName: user.fullName,
      roleKey: input.roleKey,
      scopeType: grant.scopeType,
      scopeId: grant.scopeId,
      grantedAt: grant.createdAt,
      revokedAt: null,
    };
  });
}

/**
 * Revoking keeps the row and stamps it.
 *
 * "They had access in March and it was taken away in June" is a question an
 * audit asks, and a DELETE would leave only the absence.
 */
/**
 * Nobody can revoke platform authority they do not themselves hold.
 *
 * `grantRole` has always refused to hand out a permission the granting actor
 * lacks. Revoking had no such check, which left the mirror image open: an
 * administrator could not *become* a super administrator, but could remove
 * the one supervising them — and an oversight role that the people it
 * oversees can switch off is not oversight.
 *
 * **Why PLATFORM only.** The symmetric rule — "you cannot revoke what you
 * could not grant" — reads well and is wrong here. The practitioner bundle
 * carries `credential.submit`, `availability.write` and `timesheet.submit`,
 * which no administrator holds and none should; under the symmetric rule an
 * administrator could not revoke a practitioner's own role, which is ordinary
 * work. Those permissions are capabilities over one's own record, granted at
 * SELF scope. They are not authority.
 *
 * Authority is what a PLATFORM grant confers, so that is where the rule
 * applies. A facility grant is bounded by its facility and the scope check on
 * the route already confines who may touch it.
 *
 * Stated as a permission comparison rather than as `roleKey ===
 * 'super_administrator'`, so it holds for whatever roles exist later.
 *
 * **Peers cannot remove peers either.** Holding everything the grant confers
 * is not enough when the grant confers everything *you* hold: that is an
 * equal, not a subordinate, and three administrators able to remove one
 * another is a standoff waiting to happen — the first one to click wins, and
 * the audit trail records a coup rather than a decision.
 *
 * The exception is the top of the tree. A super administrator may remove
 * another super administrator, because otherwise the role would be
 * irrevocable: nobody below can touch it and nobody at the same level may
 * either, so somebody who has left the organisation keeps full access
 * forever. Being able to remove an equal is the price of being the last
 * level, and `lastPlatformAdministrator` below stops that becoming a
 * lockout.
 */
function assertMayRevoke(
  roleKey: string,
  scopeType: string,
  actorPermissions: readonly Permission[],
): void {
  if (scopeType !== 'PLATFORM') return;

  const conferred = ROLE_PERMISSIONS[roleKey];
  // A role that no longer exists in code cannot be compared against, and a
  // stale grant is exactly the thing somebody should be able to clear away.
  if (!conferred) return;

  const held = new Set(actorPermissions);
  const beyond = conferred.filter((permission) => !held.has(permission));
  if (beyond.length > 0) throw GrantErrors.cannotRevokeHigher(roleKey);

  // Past that check the grant confers nothing the actor lacks. If the actor
  // also holds nothing the grant lacks, the two sets are equal — an equal.
  const confers = new Set<string>(conferred);
  const isPeer = [...held].every((permission) => confers.has(permission));
  if (!isPeer) return;

  // Unless the actor is at the top, where there is no higher authority to
  // ask and the alternative is an irrevocable role.
  const atTheTop = Object.keys(PERMISSIONS).every((permission) =>
    held.has(permission as Permission),
  );
  if (!atTheTop) throw GrantErrors.cannotRevokePeer(roleKey);
}

/**
 * Refuses the revocation that would leave nobody able to appoint anybody.
 *
 * Created by the rule above rather than guarded against before it: once only
 * a super administrator may remove a super administrator, two of them can
 * remove each other down to zero — and `config.manage` is in the
 * `super_administrator` bundle, so no one left could ever grant it again.
 * The platform would need a database edit to recover.
 *
 * Phrased as "the last holder of `config.manage` at platform scope" rather
 * than "the last super administrator", because that is the property that
 * actually matters: it is the permission that cannot be re-granted once its
 * last holder is gone, and the check keeps working if some other role is
 * given it later.
 */
async function assertNotTheLastWhoCanAppoint(grant: {
  id: string;
  scopeType: string;
  roleKey: string;
}): Promise<void> {
  if (grant.scopeType !== 'PLATFORM') return;
  if (!ROLE_PERMISSIONS[grant.roleKey]?.includes('config.manage')) return;

  const others = await prisma.userRole.count({
    where: {
      scopeType: 'PLATFORM',
      revokedAt: null,
      id: { not: grant.id },
      role: { permissions: { some: { permission: { key: 'config.manage' } } } },
    },
  });

  if (others === 0) throw GrantErrors.lastPlatformAdministrator();
}

/**
 * Whether somebody's authority to manage access is Medilink's, a PLATFORM grant, and not a
 * facility's. Only Medilink may remove a facility's last owner.
 */
export function holdsPlatformAuthority(grants: { permission: string; scopeType: string }[]): boolean {
  return grants.some((grant) => grant.permission === 'role.grant' && grant.scopeType === 'PLATFORM');
}

/** One lock per scope, so two people changing who can appoint at the same facility are taken one at a time. */
async function lockScope(tx: Tx, scope: { type: string; id?: string | null }): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`staff-access:${scope.type}:${scope.id ?? ''}`}, 0))`;
}

/** Accounts that can sign in: an owner who cannot is an owner nobody can ask. */
const CAN_SIGN_IN: Prisma.UserWhereInput = { deletedAt: null, status: { in: ['ACTIVE', 'UNDER_REVIEW'] } };

/**
 * Somebody other than `userId` who holds a permission over the scope and can sign in.
 */
async function othersHolding(
  tx: Tx,
  scope: { type: string; id?: string | null },
  permission: string,
  userId: string,
): Promise<number> {
  return tx.userRole.count({
    where: {
      scopeType: scope.type as GrantScope,
      scopeId: scope.id ?? null,
      revokedAt: null,
      userId: { not: userId },
      user: CAN_SIGN_IN,
      role: { permissions: { some: { permission: { key: permission } } } },
    },
  });
}

/**
 * A facility may not lose the last person who can add and remove its staff.
 *
 * Once nobody there holds `role.grant` the hospital can no longer appoint or remove anybody, and
 * only Medilink can put that right: the platform check above has protected the platform's own
 * last administrator since Stage 4, and the same lockout was open one level down. The one who
 * removes the last owner may be that owner (stepping down) or the other owner at the same moment,
 * which is why this is done under the scope's lock.
 *
 * Medilink is exempt. It is who steps in when the owner is the problem, an account taken over or
 * somebody who has left and kept the keys, and a rule that stopped it removing the last owner
 * would leave the hospital in the hands of the person it is trying to remove.
 */
async function assertScopeKeepsAnAppointer(
  tx: Tx,
  input: {
    scope: { type: string; id?: string | null };
    userId: string;
    /** The roles the person is losing here. */
    losing: string[];
    /** The roles they keep or are given in their place. */
    keeping?: string[];
    actorIsPlatform?: boolean;
  },
): Promise<void> {
  if (input.actorIsPlatform) return;
  if (input.scope.type === 'PLATFORM' || input.scope.type === 'SELF') return;

  const carries = (roleKey: string) => ROLE_PERMISSIONS[roleKey]?.includes('role.grant') ?? false;
  if (!input.losing.some(carries)) return;
  if ((input.keeping ?? []).some(carries)) return;

  if ((await othersHolding(tx, input.scope, 'role.grant', input.userId)) === 0) {
    throw GrantErrors.lastFacilityOwner();
  }
}

export async function revokeGrant(input: {
  grantId: string;
  /**
   * The scope the route's guard approved — the one the caller named, and held
   * `role.grant` over. Required, not optional: the guard proves authority over
   * *that* scope, so unless the grant lies in it the guard proved nothing about
   * this grant. Without the comparison below, the owner of one hospital could
   * name their own and revoke any other hospital's staff by identifier.
   */
  scope: { type: GrantScope; id?: string };
  actorId: string;
  reason: string;
  /** What the revoking actor holds, for the check above. */
  actorPermissions: readonly Permission[];
  /** Whether the actor's authority is Medilink's, which may remove a facility's last owner. */
  actorIsPlatform?: boolean;
}): Promise<GrantView> {
  const existing = await prisma.userRole.findUnique({
    where: { id: input.grantId },
    include: { role: true, user: true },
  });
  if (!existing) throw GrantErrors.grantNotFound();

  // "Not found", not "forbidden": a caller probing identifiers learns nothing
  // about whether a grant exists in somebody else's scope.
  const sameScope =
    existing.scopeType === input.scope.type && (existing.scopeId ?? null) === (input.scope.id ?? null);
  if (!sameScope) throw GrantErrors.grantNotFound();

  assertMayRevoke(existing.role.key, existing.scopeType, input.actorPermissions);
  await assertNotTheLastWhoCanAppoint({
    id: existing.id,
    scopeType: existing.scopeType,
    roleKey: existing.role.key,
  });

  return prisma.$transaction(async (tx: Tx) => {
    await lockScope(tx, input.scope);
    await assertScopeKeepsAnAppointer(tx, {
      scope: input.scope,
      userId: existing.userId,
      losing: [existing.role.key],
      actorIsPlatform: input.actorIsPlatform,
    });

    const revoked = await tx.userRole.update({
      where: { id: input.grantId },
      data: { revokedAt: new Date() },
    });

    await recordAudit(tx, {
      action: 'role.revoked',
      entityType: 'identity.user_roles',
      entityId: revoked.id,
      actorId: input.actorId,
      scopeType: existing.scopeType === 'SELF' ? 'SELF' : existing.scopeType,
      scopeId: existing.scopeId ?? existing.userId,
      reason: input.reason,
      before: { roleKey: existing.role.key, revokedAt: null },
      after: { roleKey: existing.role.key, revokedAt: revoked.revokedAt },
    });

    return {
      id: revoked.id,
      userId: existing.userId,
      fullName: existing.user.fullName,
      roleKey: existing.role.key,
      scopeType: revoked.scopeType,
      scopeId: revoked.scopeId,
      grantedAt: revoked.createdAt,
      revokedAt: revoked.revokedAt,
    };
  });
}

/**
 * Changing somebody's role is one act, not a removal followed by a grant.
 *
 * Done as two calls it leaves a gap, the person with no access at all between them, and two rows
 * in the record that nobody can tell are one decision. Here the old role ends and the new one
 * begins in the same transaction, the record says `role.changed` with both, and every rule that
 * applies to granting and to revoking applies: nobody gives a role they do not hold, nobody
 * changes platform authority they do not hold, and a facility's last owner cannot be made
 * something else.
 */
export async function changeGrantRole(input: {
  grantId: string;
  newRoleKey: string;
  scope: { type: GrantScope; id?: string };
  actorId: string;
  reason: string;
  actorPermissions: readonly Permission[];
  actorIsPlatform?: boolean;
}): Promise<GrantView> {
  const existing = await prisma.userRole.findUnique({
    where: { id: input.grantId },
    include: { role: true, user: true },
  });
  if (!existing || existing.revokedAt) throw GrantErrors.grantNotFound();

  const sameScope =
    existing.scopeType === input.scope.type && (existing.scopeId ?? null) === (input.scope.id ?? null);
  if (!sameScope) throw GrantErrors.grantNotFound();

  const permissions = ROLE_PERMISSIONS[input.newRoleKey];
  if (!permissions) throw GrantErrors.unknownRole(input.newRoleKey);
  if (existing.role.key === input.newRoleKey) throw GrantErrors.sameRole();

  const held = new Set<string>(input.actorPermissions);
  if (permissions.some((permission) => !held.has(permission))) throw GrantErrors.cannotEscalate();
  assertMayRevoke(existing.role.key, existing.scopeType, input.actorPermissions);

  return prisma.$transaction(async (tx: Tx) => {
    await lockScope(tx, input.scope);

    const alreadyHolds = await tx.userRole.findFirst({
      where: {
        userId: existing.userId,
        scopeType: existing.scopeType,
        scopeId: existing.scopeId,
        revokedAt: null,
        role: { key: input.newRoleKey },
      },
    });
    if (alreadyHolds) throw GrantErrors.alreadyGranted();

    await assertScopeKeepsAnAppointer(tx, {
      scope: input.scope,
      userId: existing.userId,
      losing: [existing.role.key],
      keeping: [input.newRoleKey],
      actorIsPlatform: input.actorIsPlatform,
    });
    // Platform authority: the last account that can appoint cannot be made something that cannot.
    if (
      existing.scopeType === 'PLATFORM' &&
      ROLE_PERMISSIONS[existing.role.key]?.includes('config.manage') &&
      !permissions.includes('config.manage') &&
      (await othersHolding(tx, input.scope, 'config.manage', existing.userId)) === 0
    ) {
      throw GrantErrors.lastPlatformAdministrator();
    }

    const now = new Date();
    await tx.userRole.update({ where: { id: existing.id }, data: { revokedAt: now } });
    const role = await ensureRole(tx, input.newRoleKey);
    const created = await tx.userRole.create({
      data: {
        userId: existing.userId,
        roleId: role.id,
        scopeType: existing.scopeType,
        scopeId: existing.scopeId,
        grantedBy: input.actorId,
      },
    });

    await recordAudit(tx, {
      action: 'role.changed',
      entityType: 'identity.user_roles',
      entityId: created.id,
      actorId: input.actorId,
      scopeType: existing.scopeType === 'SELF' ? 'SELF' : existing.scopeType,
      scopeId: existing.scopeId ?? existing.userId,
      reason: input.reason,
      before: { roleKey: existing.role.key, grantId: existing.id },
      after: { roleKey: input.newRoleKey, grantId: created.id, userId: existing.userId, permissions },
    });

    return {
      id: created.id,
      userId: existing.userId,
      fullName: existing.user.fullName,
      roleKey: input.newRoleKey,
      scopeType: created.scopeType,
      scopeId: created.scopeId,
      grantedAt: created.createdAt,
      revokedAt: null,
    };
  });
}

/**
 * Taking all of somebody's access to a facility away at once, for when waiting to do it role by
 * role is the risk: somebody who left and kept the keys, an account that may be in somebody
 * else's hands.
 *
 * Every grant they hold over that scope ends in one transaction, or none does; what they hold
 * elsewhere is not touched, because it is somebody else's to give and take. Access is read from
 * the database on every request, so it is gone on their next one. The record carries each role
 * ending as `role.revoked` and the removal as a whole as `access.emergency_revoked`, and at a
 * facility the person and the facility's other owners are told, so a removal cannot go
 * unnoticed by the people who run the place.
 */
export async function revokeAllAccess(input: {
  userId: string;
  scope: { type: GrantScope; id?: string };
  actorId: string;
  reason: string;
  actorPermissions: readonly Permission[];
  actorIsPlatform?: boolean;
}): Promise<{ revoked: GrantView[] }> {
  return prisma.$transaction(async (tx: Tx) => {
    await lockScope(tx, input.scope);

    const held = await tx.userRole.findMany({
      where: {
        userId: input.userId,
        scopeType: input.scope.type,
        scopeId: input.scope.id ?? null,
        revokedAt: null,
      },
      include: { role: true, user: true },
      orderBy: { createdAt: 'asc' },
    });
    // "Nothing here", not "forbidden": nobody learns who holds access somewhere they may not look.
    if (held.length === 0) throw GrantErrors.grantNotFound();

    for (const grant of held) assertMayRevoke(grant.role.key, grant.scopeType, input.actorPermissions);
    if (
      input.scope.type === 'PLATFORM' &&
      held.some((grant) => ROLE_PERMISSIONS[grant.role.key]?.includes('config.manage')) &&
      (await othersHolding(tx, input.scope, 'config.manage', input.userId)) === 0
    ) {
      throw GrantErrors.lastPlatformAdministrator();
    }
    await assertScopeKeepsAnAppointer(tx, {
      scope: input.scope,
      userId: input.userId,
      losing: held.map((grant) => grant.role.key),
      actorIsPlatform: input.actorIsPlatform,
    });

    const now = new Date();
    const scopeType = input.scope.type === 'SELF' ? 'SELF' : input.scope.type;
    const revoked: GrantView[] = [];
    for (const grant of held) {
      await tx.userRole.update({ where: { id: grant.id }, data: { revokedAt: now } });
      await recordAudit(tx, {
        action: 'role.revoked',
        entityType: 'identity.user_roles',
        entityId: grant.id,
        actorId: input.actorId,
        scopeType,
        scopeId: grant.scopeId ?? grant.userId,
        reason: `Emergency removal of all access: ${input.reason}`,
        before: { roleKey: grant.role.key, revokedAt: null },
        after: { roleKey: grant.role.key, revokedAt: now },
      });
      revoked.push({
        id: grant.id,
        userId: grant.userId,
        fullName: grant.user.fullName,
        roleKey: grant.role.key,
        scopeType: grant.scopeType,
        scopeId: grant.scopeId,
        grantedAt: grant.createdAt,
        revokedAt: now,
      });
    }

    await recordAudit(tx, {
      action: 'access.emergency_revoked',
      entityType: 'identity.users',
      entityId: input.userId,
      actorId: input.actorId,
      scopeType,
      scopeId: input.scope.id ?? input.userId,
      reason: input.reason,
      after: { grantsEnded: held.length, roles: held.map((grant) => grant.role.key) },
    });

    if (input.scope.type === 'FACILITY' && input.scope.id) {
      await publishEvent(tx, {
        eventType: EVENTS.StaffAccessRemoved,
        aggregateType: 'identity.users',
        aggregateId: input.userId,
        payload: {
          userId: input.userId,
          facilityId: input.scope.id,
          byUserId: input.actorId,
          removedAt: now.toISOString(),
        },
      });
    }

    return { revoked };
  });
}

/** Who holds what over one scope — the list a facility administrator works. */
export type GrantScope = GrantRoleParams['scopeType'];

export async function listGrants(input: {
  scopeType: GrantScope;
  scopeId?: string;
}): Promise<GrantView[]> {
  const rows = await prisma.userRole.findMany({
    where: {
      scopeType: input.scopeType,
      ...(input.scopeId ? { scopeId: input.scopeId } : {}),
    },
    include: { role: true, user: true },
    orderBy: { createdAt: 'desc' },
  });

  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    fullName: row.user.fullName,
    roleKey: row.role.key,
    scopeType: row.scopeType,
    scopeId: row.scopeId,
    grantedAt: row.createdAt,
    revokedAt: row.revokedAt,
  }));
}

/** Finding somebody to grant to, by the number they registered with. */
export async function findUserByPhone(phone: string) {
  const user = await prisma.user.findUnique({
    where: { phone },
    select: { id: true, fullName: true, phone: true, status: true },
  });
  if (!user) throw GrantErrors.userNotFound();
  return user;
}

/**
 * Everybody holding a permission at one facility, for alerts that have to reach
 * the people who can act on them there rather than the one person who happened to
 * be named. Accounts that cannot sign in (suspended, deactivated, deleted) are
 * left out: an alert sent to one has been sent to nobody.
 */
export async function usersHoldingFacilityPermission(
  facilityId: string,
  permission: string,
): Promise<{ id: string; fullName: string }[]> {
  return prisma.user.findMany({
    where: {
      deletedAt: null,
      status: { in: ['ACTIVE', 'UNDER_REVIEW'] },
      roles: {
        some: {
          revokedAt: null,
          scopeType: 'FACILITY',
          scopeId: facilityId,
          role: { permissions: { some: { permission: { key: permission } } } },
        },
      },
    },
    select: { id: true, fullName: true },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Who holds a permission across the whole platform, for something that has to
 * reach everybody who can act on it — a severe incident, say — rather than one
 * person who happened to be named.
 *
 * PLATFORM grants only: a facility-scoped holder can act on their own facility
 * and is not who a platform-wide alert is for. Accounts that cannot sign in
 * (suspended, deactivated, deleted) are left out, because an alert that goes to
 * a locked account has been sent to nobody.
 */
export async function usersHoldingPlatformPermission(
  permission: string,
): Promise<{ id: string; fullName: string }[]> {
  return prisma.user.findMany({
    where: {
      deletedAt: null,
      status: { in: ['ACTIVE', 'UNDER_REVIEW'] },
      roles: {
        some: {
          revokedAt: null,
          scopeType: 'PLATFORM',
          role: { permissions: { some: { permission: { key: permission } } } },
        },
      },
    },
    select: { id: true, fullName: true },
    orderBy: { createdAt: 'asc' },
  });
}
