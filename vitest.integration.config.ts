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
    fileParallelism: false,
    // Argon2id is deliberately slow, and these cases hash several passwords.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
});
