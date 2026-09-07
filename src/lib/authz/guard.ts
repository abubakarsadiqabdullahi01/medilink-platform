import type { Permission } from './permissions';

/**
 * Permission plus scope, evaluated server-side on every access (Section 9.10).
 * A facility administrator holding facility.read for facility A must be
 * refused facility B, and the test suite asserts exactly that on every
 * resource type.
 */
export type ScopeType = 'PLATFORM' | 'FACILITY_GROUP' | 'FACILITY' | 'BRANCH' | 'DEPARTMENT' | 'SELF';

export interface RequestedScope {
  type: Exclude<ScopeType, 'PLATFORM'> | 'PLATFORM';
  id?: string;
  /** Ancestors of the requested record, e.g. the facility a branch belongs to. */
  ancestors?: { type: ScopeType; id: string }[];
}

export interface Grant {
  permission: Permission;
  scopeType: ScopeType;
  scopeId: string | null;
}

type UserRoleGrantRow = {
  scopeType: string;
  scopeId: string | null;
  role: {
    permissions: {
      permission: {
        key: string;
      };
    }[];
  };
};

export class AuthorizationError extends Error {
  readonly status = 403;
  constructor(message = 'Forbidden') {
    super(message);
    this.name = 'AuthorizationError';
  }
}

/** Pure decision function, so it can be unit-tested without a database. */
export function isAuthorized(
  grants: Grant[],
  permission: Permission,
  requested: RequestedScope,
  actingUserId?: string,
): boolean {
  const candidates = grants.filter((grant) => grant.permission === permission);
  if (candidates.length === 0) return false;

  const acceptable = new Set<string>();
  acceptable.add('PLATFORM:*');
  if (requested.id) acceptable.add(`${requested.type}:${requested.id}`);
  for (const ancestor of requested.ancestors ?? []) {
    acceptable.add(`${ancestor.type}:${ancestor.id}`);
  }
  // SELF is intentionally strict: a grant scoped to the acting user reaches
  // that user's own record only, never another practitioner's.
  if (requested.type === 'SELF' && actingUserId && requested.id !== actingUserId) {
    return false;
  }

  return candidates.some((grant) => {
    if (grant.scopeType === 'PLATFORM') return acceptable.has('PLATFORM:*');
    if (!grant.scopeId) return false;
    return acceptable.has(`${grant.scopeType}:${grant.scopeId}`);
  });
}

export async function loadGrants(userId: string): Promise<Grant[]> {
  const { prisma } = await import('../db');
  const rows: UserRoleGrantRow[] = await prisma.userRole.findMany({
    where: { userId, revokedAt: null },
    include: { role: { include: { permissions: { include: { permission: true } } } } },
  });

  return rows.flatMap((row) =>
    row.role.permissions.map((link) => ({
      permission: link.permission.key as Permission,
      scopeType: row.scopeType as ScopeType,
      scopeId: row.scopeId,
    })),
  );
}

/** Throws AuthorizationError; route handlers translate that to a 403. */
export async function requirePermission(
  userId: string,
  permission: Permission,
  requested: RequestedScope,
): Promise<void> {
  const grants = await loadGrants(userId);
  if (!isAuthorized(grants, permission, requested, userId)) {
    throw new AuthorizationError(`Missing ${permission} for ${requested.type}:${requested.id ?? '*'}`);
  }
}
