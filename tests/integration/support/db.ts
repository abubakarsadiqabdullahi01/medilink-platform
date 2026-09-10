import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { MUTABLE_CONFIG_TABLES, MUTABLE_SCHEMAS } from './schemas';

/**
 * Truncates the mutable schemas between cases. `config` is left alone: it
 * holds the controlled vocabularies loaded by the seed, which are reference
 * data rather than test state.
 */
let tables: string[] | null = null;

async function mutableTables(): Promise<string[]> {
  if (tables) return tables;

  const rows = await prisma.$queryRaw<{ qualified: string }[]>`
    SELECT format('%I.%I', schemaname, tablename) AS qualified
      FROM pg_tables
     WHERE schemaname IN (${Prisma.join(MUTABLE_SCHEMAS)})
  `;

  if (rows.length === 0) {
    throw new Error(
      'The test database has no tables. Run `pnpm test:integration` (which migrates it first) rather than vitest directly.',
    );
  }

  tables = [...rows.map((row) => row.qualified), ...MUTABLE_CONFIG_TABLES];
  return tables;
}

export async function resetDatabase(): Promise<void> {
  const list = await mutableTables();
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list.join(', ')} RESTART IDENTITY CASCADE`);
}
