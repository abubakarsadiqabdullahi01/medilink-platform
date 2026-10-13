/**
 * Empties the local database down to one super administrator.
 *
 * For walking the product module by module from nothing: every person,
 * facility, shift, document, notification and ledger row goes, along with
 * the audit trail they left. What stays is what `prisma/seed.ts` loads —
 * roles and permissions, geography, categories and specialties, credential
 * types and requirements, facility types, holidays, rate floors and the
 * scheduled jobs — plus one account that can grant everything else.
 *
 *   docker compose exec web pnpm tsx scripts/reset-to-superadmin.ts
 *
 * Cannot be undone. Take a `pg_dump` first if anything in the database
 * matters. `seed-demo.ts` puts the full demo world back on top of this; it
 * removes this administrator first, because they share a phone and the demo
 * email domain on purpose.
 *
 * Local only, like the other demo scripts.
 */
import { DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { prisma } from '../src/lib/db';
import { env } from '../src/lib/env';
import { s3 } from '../src/lib/storage/tigris';
import { DEMO_PASSWORD, assertLocal, demoPasswordHash, syncRoles } from './support/demo';

const SUPER_ADMIN = {
  fullName: 'Olufemi Adebayo-Cole',
  phone: '+2348031200001',
  email: 'olufemi.adebayo.cole.001@demo.medilink.test',
};

/**
 * Reference data: the controlled vocabularies the seed owns.
 *
 * Every `config` table is one, except the sanctions list. The seed ships that
 * empty — the real entries are compliance's to transcribe — so anything in it
 * was put there by a demo run, and an invented name left behind would go on
 * matching practitioners registered after the reset.
 */
const KEPT = new Set([
  'public._prisma_migrations',
  'identity.permissions',
  'identity.roles',
  'identity.role_permissions',
  'audit.scheduled_jobs',
]);

function isReferenceData(schema: string, table: string): boolean {
  if (KEPT.has(`${schema}.${table}`)) return true;
  return schema === 'config' && table !== 'sanctioned_entries';
}

async function emptyTables(): Promise<string[]> {
  const tables = await prisma.$queryRaw<{ schema: string; name: string }[]>`
    SELECT schemaname AS schema, tablename AS name FROM pg_tables
    WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
    ORDER BY schemaname, tablename`;
  const emptied = tables.filter((table) => !isReferenceData(table.schema, table.name));

  // One statement, and no CASCADE. If a reference table ever gains a foreign
  // key into one of these, Postgres refuses the whole thing rather than
  // quietly emptying the reference table with it.
  const list = emptied.map((table) => `"${table.schema}"."${table.name}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY`);
  return emptied.map((table) => `${table.schema}.${table.name}`);
}

/** The rows describing uploads are gone, so the files they described go too. */
async function emptyBucket(): Promise<number> {
  let deleted = 0;
  let token: string | undefined;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({ Bucket: env.STORAGE_BUCKET, ContinuationToken: token }),
    );
    for (const object of page.Contents ?? []) {
      if (!object.Key) continue;
      await s3.send(new DeleteObjectCommand({ Bucket: env.STORAGE_BUCKET, Key: object.Key }));
      deleted += 1;
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return deleted;
}

/**
 * The first administrator is the one account no grant path can create —
 * granting a PLATFORM role is exactly what a PLATFORM role is for — so it is
 * written directly, as seed-demo does. Everyone after them is granted by
 * them, through the console.
 */
async function createSuperAdmin(): Promise<string> {
  const user = await prisma.user.create({
    data: {
      fullName: SUPER_ADMIN.fullName,
      phone: SUPER_ADMIN.phone,
      email: SUPER_ADMIN.email,
      status: 'ACTIVE',
      passwordHash: await demoPasswordHash(),
      phoneVerifiedAt: new Date(),
    },
  });
  const role = await prisma.role.findUniqueOrThrow({ where: { key: 'super_administrator' } });
  await prisma.userRole.create({
    data: { userId: user.id, roleId: role.id, scopeType: 'PLATFORM', scopeId: null },
  });
  return user.id;
}

async function main() {
  assertLocal('reset-to-superadmin');

  const emptied = await emptyTables();
  const objects = await emptyBucket();
  await syncRoles(prisma);
  await createSuperAdmin();

  console.log(`Emptied ${emptied.length} tables and ${objects} stored files.`);
  console.log('Kept the reference data prisma/seed.ts loads.');
  console.log('');
  console.log('  Sign in at http://localhost:3000/login');
  console.log(`  ${SUPER_ADMIN.phone}  ${SUPER_ADMIN.fullName}  (super administrator)`);
  console.log(`  Password: ${DEMO_PASSWORD}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
