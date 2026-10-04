import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Integration tests: real PostgreSQL, no jsdom, one file at a time.
 *
 * Serial by design — the cases truncate shared tables and assert on row
 * counts, so running two files at once would make them fail each other. The
 * suite is small and database-bound; the parallelism would buy little.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    setupFiles: ['tests/integration/support/env.ts', 'tests/integration/setup.ts'],
    /**
     * Files run one at a time — but each still gets its own fork, with its own
     * Prisma pool, and vitest tears one down while starting the next. An
     * outgoing process with a query still in flight therefore overlaps the
     * incoming process's `TRUNCATE`, which is where the intermittent
     * `deadlock detected` in this suite came from. `resetDatabase` retries it;
     * see tests/integration/support/db.ts for why that is the right place.
     *
     * `poolOptions.forks.singleFork` would remove the race outright by putting
     * every file in one process. It was tried and the run died with an
     * out-of-memory kill: twenty-six files' worth of modules and Prisma
     * clients in one heap is more than the container has.
     */
    fileParallelism: false,
    // Argon2id is deliberately slow, and these cases hash several passwords.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
});
