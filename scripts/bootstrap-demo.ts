/**
 * Creates the actors an end-to-end run needs and cannot create for itself.
 *
 * The seed loads controlled vocabularies and no people, which is correct: a
 * production database should not ship with accounts. But a practitioner can
 * register through the API and a compliance officer cannot — nothing grants a
 * PLATFORM role, because granting one is exactly what a PLATFORM role is for.
 * Somebody has to be the first administrator, and in a pilot that is a person
 * running a script like this one against the real database.
 *
 * Local only. It refuses to run anywhere else, because a script that creates
 * administrators with a known password has no business near production.
 *
 *   docker compose exec web pnpm tsx scripts/bootstrap-demo.ts
 */
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/lib/password';
import { ROLE_PERMISSIONS, type Permission } from '../src/lib/authz/permissions';

const prisma = new PrismaClient();

/** Every demo account shares it. This is not a secret and is not meant to be. */
export const DEMO_PASSWORD = 'Medilink-demo-2026';

const APP_ENV = process.env.APP_ENV ?? 'local';

interface ActorSpec {
  key: string;
  fullName: string;
  phone: string;
  role: keyof typeof ROLE_PERMISSIONS;
  scopeType: 'PLATFORM' | 'SELF';
}

/**
 * Phones are fixed rather than random so a second run is idempotent and the
 * e2e script can hard-code them. +23480311000xx is a reserved-looking block
 * that no real Nigerian number occupies.
 */
const ACTORS: ActorSpec[] = [
  {
    key: 'operations',
    fullName: 'Demo Operations Officer',
    phone: '+2348031100001',
    role: 'operations_officer',
    scopeType: 'PLATFORM',
  },
  {
    key: 'compliance',
    fullName: 'Demo Compliance Officer',
    phone: '+2348031100002',
    role: 'compliance_officer',
    scopeType: 'PLATFORM',
  },
  {
    key: 'superadmin',
    fullName: 'Demo Super Administrator',
    phone: '+2348031100003',
    role: 'super_administrator',
    scopeType: 'PLATFORM',
  },
];

async function ensureRole(key: string, permissions: Permission[]) {
  const role = await prisma.role.upsert({
    where: { key },
    update: { name: key },
    create: { key, name: key },
  });

  for (const permission of permissions) {
    const perm = await prisma.permission.upsert({
      where: { key: permission },
      update: {},
      create: { key: permission, description: permission },
    });
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
      update: {},
      create: { roleId: role.id, permissionId: perm.id },
    });
  }

  return role;
}

async function ensureActor(spec: ActorSpec) {
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  const user = await prisma.user.upsert({
    where: { phone: spec.phone },
    update: { fullName: spec.fullName, status: 'ACTIVE', passwordHash },
    create: {
      phone: spec.phone,
      fullName: spec.fullName,
      status: 'ACTIVE',
      phoneVerifiedAt: new Date(),
      passwordHash,
    },
  });

  const role = await ensureRole(spec.role, ROLE_PERMISSIONS[spec.role] ?? []);

  const scopeId = spec.scopeType === 'SELF' ? user.id : null;

  // findFirst then create, rather than upsert: Prisma will not accept a null
  // inside a compound unique's `where`, and a PLATFORM grant's scopeId is
  // null by definition — the scope is "everywhere".
  const existing = await prisma.userRole.findFirst({
    where: { userId: user.id, roleId: role.id, scopeType: spec.scopeType, scopeId },
  });

  if (existing) {
    await prisma.userRole.update({ where: { id: existing.id }, data: { revokedAt: null } });
  } else {
    await prisma.userRole.create({
      data: { userId: user.id, roleId: role.id, scopeType: spec.scopeType, scopeId },
    });
  }

  return { key: spec.key, id: user.id, phone: spec.phone, role: spec.role };
}

async function main() {
  if (APP_ENV !== 'local') {
    throw new Error(
      `Refusing to run with APP_ENV=${APP_ENV}. This creates administrators with a known password.`,
    );
  }

  const actors = [];
  for (const spec of ACTORS) {
    actors.push(await ensureActor(spec));
  }

  // The reference data the journey needs. Already seeded in a normal local
  // stack; asserted here so a failure says which list is empty rather than
  // surfacing as a confusing 422 six steps later.
  const [categories, states, facilityTypes] = await Promise.all([
    prisma.professionalCategory.count(),
    prisma.state.count(),
    prisma.facilityType.count(),
  ]);
  if (categories === 0 || states === 0 || facilityTypes === 0) {
    throw new Error('Reference data is missing. Run: docker compose exec web pnpm db:seed');
  }

  const category = await prisma.professionalCategory.findFirstOrThrow();
  const state = await prisma.state.findFirstOrThrow();
  const facilityType = await prisma.facilityType.findFirstOrThrow();

  console.log(
    JSON.stringify(
      {
        password: DEMO_PASSWORD,
        actors,
        reference: {
          professionalCategoryId: category.id,
          professionalCategoryName: category.name,
          stateId: state.id,
          facilityTypeId: facilityType.id,
        },
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(String(error));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
