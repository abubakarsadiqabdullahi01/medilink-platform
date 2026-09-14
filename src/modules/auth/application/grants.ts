import { prisma, type Tx } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
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
export async function revokeGrant(input: {
  grantId: string;
  actorId: string;
  reason: string;
}): Promise<GrantView> {
  const existing = await prisma.userRole.findUnique({
    where: { id: input.grantId },
    include: { role: true, user: true },
  });
  if (!existing) throw GrantErrors.grantNotFound();

  return prisma.$transaction(async (tx: Tx) => {
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
