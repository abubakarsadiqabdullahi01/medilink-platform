import type { PrismaClient } from '@prisma/client';
import { PERMISSIONS, RETIRED_ROLES, ROLE_LABELS, ROLE_PERMISSIONS } from './permissions';

/**
 * Writes the permission catalogue and the role bundles into the database.
 *
 * There were three copies of this: `prisma/seed.ts`, `scripts/seed-demo.ts`
 * and `scripts/bootstrap-demo.ts`. They had drifted into actively undoing
 * each other — the two scripts upserted roles with `name: roleKey`, so
 * running either after the seed reset "Facility owner (MD)" back to
 * `facility_owner`, and neither removed a permission that had left a bundle,
 * so a role kept granting whatever any previous version of the code had
 * given it. Bootstrapping an environment therefore made it quietly more
 * permissive than a freshly seeded one.
 *
 * One copy, imported by all three.
 */
export async function syncRoles(prisma: PrismaClient): Promise<void> {
  for (const [key, description] of Object.entries(PERMISSIONS)) {
    await prisma.permission.upsert({
      where: { key },
      update: { description },
      create: { key, description },
    });
  }

  for (const [roleKey, permissionKeys] of Object.entries(ROLE_PERMISSIONS)) {
    const label = ROLE_LABELS[roleKey];
    const role = await prisma.role.upsert({
      where: { key: roleKey },
      update: { name: label?.name ?? roleKey, description: label?.description },
      create: { key: roleKey, name: label?.name ?? roleKey, description: label?.description },
    });

    const wanted = await prisma.permission.findMany({
      where: { key: { in: permissionKeys } },
      select: { id: true },
    });

    // Authoritative, not additive. A permission taken *out* of a bundle has
    // to actually leave the database, or an environment that has been seeded
    // more than once keeps granting what the code stopped granting.
    await prisma.rolePermission.deleteMany({
      where: { roleId: role.id, permissionId: { notIn: wanted.map((row) => row.id) } },
    });

    for (const permission of wanted) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
    }
  }

  await retireMergedRoles(prisma);
}

/**
 * Moves anybody still holding one of the old nine roles onto its replacement.
 *
 * The same work as migrations/20261004120000_merge_roles, repeated here
 * because the two reach different databases: the migration runs on deployed
 * ones, this runs on a developer's box seeded from a branch written before
 * the merge. Both are idempotent, and after either has run this does nothing.
 */
async function retireMergedRoles(prisma: PrismaClient): Promise<void> {
  for (const [oldKey, newKey] of Object.entries(RETIRED_ROLES)) {
    const old = await prisma.role.findUnique({ where: { key: oldKey } });
    if (!old) continue;

    const replacement = await prisma.role.findUniqueOrThrow({ where: { key: newKey } });
    const grants = await prisma.userRole.findMany({ where: { roleId: old.id } });

    for (const grant of grants) {
      // Somebody holding two of the merged roles at one scope collapses to a
      // single grant; the unique index would refuse the second.
      const already = await prisma.userRole.findFirst({
        where: {
          userId: grant.userId,
          roleId: replacement.id,
          scopeType: grant.scopeType,
          scopeId: grant.scopeId,
        },
      });

      if (already) {
        await prisma.userRole.delete({ where: { id: grant.id } });
      } else {
        await prisma.userRole.update({
          where: { id: grant.id },
          data: { roleId: replacement.id },
        });
      }
    }

    await prisma.role.delete({ where: { id: old.id } });
  }
}
