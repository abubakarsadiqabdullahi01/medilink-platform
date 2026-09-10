import { prisma } from '@/lib/db';
import { PERMISSIONS, type Permission } from '@/lib/authz/permissions';
import type { ScopeType } from '@/lib/authz/guard';

/**
 * Users and grants for authorisation tests. The seed's roles are not reused:
 * these cases need a role that holds one permission and not another, which is
 * precisely the combination a sensible seed would never contain.
 */
let sequence = 0;

export async function createUser(
  input: { fullName?: string; status?: 'ACTIVE' | 'UNDER_REVIEW' | 'SUSPENDED' } = {},
) {
  sequence += 1;
  return prisma.user.create({
    data: {
      phone: `+2348030${String(sequence).padStart(6, '0')}`,
      fullName: input.fullName ?? `Test User ${sequence}`,
      status: input.status ?? 'ACTIVE',
      phoneVerifiedAt: new Date(),
    },
  });
}

/**
 * Grants a bundle of permissions to a user within one scope. Roles are
 * created on demand, because a role is only a convenience bundle — the check
 * in application code always names a permission.
 */
export async function grant(input: {
  userId: string;
  roleKey: string;
  permissions: Permission[];
  scopeType: ScopeType;
  scopeId?: string | null;
  revoked?: boolean;
}) {
  const role = await prisma.role.upsert({
    where: { key: input.roleKey },
    update: {},
    create: { key: input.roleKey, name: input.roleKey },
  });

  for (const key of input.permissions) {
    const permission = await prisma.permission.upsert({
      where: { key },
      update: {},
      create: { key, description: PERMISSIONS[key] },
    });

    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
      update: {},
      create: { roleId: role.id, permissionId: permission.id },
    });
  }

  return prisma.userRole.create({
    data: {
      userId: input.userId,
      roleId: role.id,
      scopeType: input.scopeType,
      scopeId: input.scopeId ?? null,
      revokedAt: input.revoked ? new Date() : null,
    },
  });
}

/**
 * Ensures a role row exists without granting it to anyone — for tests that
 * exercise something else's role-granting logic (e.g. an event handler)
 * rather than setting up a session's own grants directly.
 */
export async function ensureRole(key: string) {
  return prisma.role.upsert({
    where: { key },
    update: {},
    create: { key, name: key },
  });
}

/**
 * Config-schema rows for practitioner-profile tests. `config` is not
 * truncated between cases and `test:integration` never runs the seed, so
 * these are created on demand, upserted by a fixed test key like `grant()`
 * upserts its roles.
 *
 * `update` mirrors `create` field-for-field (never `{}`): each test file's
 * `sequence` counter starts at 1 independently, and since `config` rows
 * persist across files within a run, two files can both land on
 * `test_credential_type_1` — an `update: {}` would then silently keep
 * whichever file ran first's field values instead of the second caller's,
 * which is exactly the kind of cross-file collision that bit
 * `createCredentialType` before this was fixed.
 */
export async function createProfessionalCategory(
  input: { key?: string; name?: string; regulator?: string } = {},
) {
  sequence += 1;
  const key = input.key ?? `test_category_${sequence}`;
  const data = {
    name: input.name ?? `Test Category ${sequence}`,
    regulator: input.regulator ?? 'TEST',
    owner: 'test-fixture',
  };
  return prisma.professionalCategory.upsert({ where: { key }, update: data, create: { key, ...data } });
}

export async function createSpecialty(
  categoryId: string,
  input: { key?: string; name?: string } = {},
) {
  sequence += 1;
  const key = input.key ?? `test_specialty_${sequence}`;
  const data = {
    name: input.name ?? `Test Specialty ${sequence}`,
    categoryId,
    owner: 'test-fixture',
  };
  return prisma.specialty.upsert({ where: { key }, update: data, create: { key, ...data } });
}

export async function createState(input: { code?: string; name?: string; zone?: string } = {}) {
  sequence += 1;
  const code = input.code ?? `T${sequence}`;
  const data = {
    name: input.name ?? `Test State ${sequence}`,
    zone: input.zone ?? 'Test Zone',
    owner: 'test-fixture',
  };
  return prisma.state.upsert({ where: { code }, update: data, create: { code, ...data } });
}

export async function createCredentialType(
  input: {
    key?: string;
    name?: string;
    issuer?: string;
    isMandatory?: boolean;
    expires?: boolean;
    reviewDays?: number;
    verificationMethod?: string;
  } = {},
) {
  sequence += 1;
  const key = input.key ?? `test_credential_type_${sequence}`;
  const data = {
    name: input.name ?? `Test Credential Type ${sequence}`,
    issuer: input.issuer ?? 'Test Issuer',
    isMandatory: input.isMandatory ?? false,
    expires: input.expires ?? true,
    reviewDays: input.reviewDays ?? 365,
    verificationMethod: input.verificationMethod ?? 'document_review',
    owner: 'test-fixture',
  };
  return prisma.credentialType.upsert({ where: { key }, update: data, create: { key, ...data } });
}

/** An audit row tagged with a scope, so scope filtering has something to filter. */
export async function seedAuditRow(input: {
  action: string;
  entityType?: string;
  actorId?: string;
  scopeType?: ScopeType;
  scopeId?: string | null;
}) {
  return prisma.auditLog.create({
    data: {
      action: input.action,
      entityType: input.entityType ?? 'identity.users',
      actorId: input.actorId,
      scopeType: input.scopeType,
      scopeId: input.scopeId ?? null,
    },
  });
}
