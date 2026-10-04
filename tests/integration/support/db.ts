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

/**
 * A deadlock here is transient by definition, and this is safe to repeat.
 *
 * Vitest runs these files one at a time but still gives each its own process
 * and its own Prisma pool, and it starts the next one while the last is
 * shutting down. A query still in flight in the outgoing process holds row
 * locks that this `TRUNCATE` needs, and PostgreSQL resolves the cycle by
 * killing one of them — which showed up as twenty to thirty-five failures on
 * one run, a clean sweep on the next, and every failing file passing on its
 * own.
 *
 * Retrying is the correct response rather than a workaround: 40P01 is the one
 * error PostgreSQL documents as "retry the transaction", truncating an
 * already-truncated table is a no-op, and the alternative — one process for
 * the whole suite — runs the container out of memory.
 *
 * Bounded, and it rethrows what it cannot fix. A test database that deadlocks
 * four times running is telling you something a silent loop would hide.
 */
const DEADLOCK = '40P01';
const ATTEMPTS = 4;

export async function resetDatabase(): Promise<void> {
  const list = await mutableTables();
  const statement = `TRUNCATE TABLE ${list.join(', ')} RESTART IDENTITY CASCADE`;

  for (let attempt = 1; ; attempt += 1) {
    try {
      await prisma.$executeRawUnsafe(statement);
      return;
    } catch (error) {
      const code = (error as { meta?: { code?: string } }).meta?.code;
      const deadlocked = code === DEADLOCK || String(error).includes('deadlock detected');

      if (!deadlocked || attempt === ATTEMPTS) throw error;

      // Back off a little so the process we are racing can finish dying.
      await new Promise((resolve) => setTimeout(resolve, attempt * 100));
    }
  }
}
