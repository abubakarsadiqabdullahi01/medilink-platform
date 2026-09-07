import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import {
  adminDatabaseUrl,
  testDatabaseName,
  testDatabaseUrl,
} from '../tests/integration/support/database-url';

/**
 * Creates the integration-test database if it is absent, then migrates it.
 *
 * Separate from the development database because the suite truncates between
 * cases; see tests/integration/support/database-url.ts for the naming rule
 * that enforces the separation.
 */
async function main(): Promise<void> {
  const name = testDatabaseName();
  const url = testDatabaseUrl();

  const admin = new PrismaClient({ datasourceUrl: adminDatabaseUrl() });

  try {
    const existing = await admin.$queryRaw<{ datname: string }[]>`
      SELECT datname FROM pg_database WHERE datname = ${name}
    `;

    if (existing.length === 0) {
      // CREATE DATABASE takes no bind parameters; testDatabaseName() has
      // already restricted the value to letters, digits and underscore.
      await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
      console.log(`Created database ${name}.`);
    }
  } finally {
    await admin.$disconnect();
  }

  execSync('pnpm prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url },
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
