import { prisma } from '@/lib/db';
import { PERMISSIONS, type Permission } from '@/lib/authz/permissions';
import type { ScopeType } from '@/lib/authz/guard';
import { normaliseFolio, normaliseName } from '@/modules/practitioners/domain/screening';

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
  const role = await ensureRole(input.roleKey, input.permissions);

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
 * Ensures a role exists, carrying the permissions given, without granting it
 * to anyone — for tests that exercise something else's role-granting logic
 * (an event handler, or createFacility) rather than setting up a session's
 * own grants directly.
 *
 * The permissions are not optional in spirit: the seed builds every role from
 * ROLE_PERMISSIONS, so a role created here without them is a role that exists
 * and authorises nothing, and whatever granted it appears to have silently
 * failed.
 */
export async function ensureRole(key: string, permissions: Permission[] = []) {
  const role = await prisma.role.upsert({
    where: { key },
    update: {},
    create: { key, name: key },
  });

  for (const permissionKey of permissions) {
    const permission = await prisma.permission.upsert({
      where: { key: permissionKey },
      update: {},
      create: { key: permissionKey, description: PERMISSIONS[permissionKey] },
    });

    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
      update: {},
      create: { roleId: role.id, permissionId: permission.id },
    });
  }

  return role;
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

export async function createFacilityType(input: { key?: string; name?: string; regulator?: string } = {}) {
  sequence += 1;
  const key = input.key ?? `test_facility_type_${sequence}`;
  const data = {
    name: input.name ?? `Test Facility Type ${sequence}`,
    regulator: input.regulator ?? 'TEST',
    owner: 'test-fixture',
  };
  return prisma.facilityType.upsert({ where: { key }, update: data, create: { key, ...data } });
}

/**
 * An LGA belongs to a state, and facility creation refuses a pairing that
 * does not match, so the two are created together by default.
 */
export async function createLga(stateId: string, input: { name?: string } = {}) {
  sequence += 1;
  const name = input.name ?? `Test LGA ${sequence}`;
  return prisma.lga.upsert({
    where: { stateId_name: { stateId, name } },
    update: { stateId, name },
    create: { stateId, name },
  });
}

/**
 * An entry on a sanctioned or quack list. `normalisedName` is computed with
 * the same function the screening path uses, because a fixture that
 * normalises differently would test nothing.
 */
export async function createSanctionedEntry(input: {
  fullName: string;
  folioNumber?: string;
  sourceList?: 'MDCN_QUACK_LIST' | 'MDCN_SANCTIONS' | 'INTERNAL';
  reason?: string;
}) {
  return prisma.sanctionedEntry.create({
    data: {
      sourceList: input.sourceList ?? 'MDCN_QUACK_LIST',
      fullName: input.fullName,
      normalisedName: normaliseName(input.fullName),
      folioNumber: normaliseFolio(input.folioNumber),
      reason: input.reason ?? 'Test entry',
      listedAt: new Date('2026-01-01T00:00:00.000Z'),
      owner: 'test-fixture',
    },
  });
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
