import { testDatabaseUrl } from './database-url';

/**
 * Runs before every other setup file, because src/lib/env.ts validates
 * configuration at import time and src/lib/db.ts opens its pool at import
 * time. Anything assigned after those modules load is assigned too late.
 *
 * DATABASE_URL is overwritten rather than defaulted: the container and CI both
 * set it to the development database, and these tests must never touch that.
 */
process.env.DATABASE_URL = testDatabaseUrl();

process.env.APP_ENV ??= 'local';
process.env.APP_URL ??= 'http://localhost:3000';
process.env.SESSION_SECRET ??= 'test-session-secret-value-at-least-32-chars';
process.env.STORAGE_ENDPOINT ??= 'http://localhost:9000';
process.env.STORAGE_BUCKET ??= 'medilink-documents-test';
process.env.STORAGE_ACCESS_KEY_ID ??= 'test';
process.env.STORAGE_SECRET_ACCESS_KEY ??= 'test-secret';
process.env.SMS_PROVIDER ??= 'console';

// Assigned rather than defaulted: the container and CI both set LOG_LEVEL=info,
// which buries a test failure under the worker's own commentary. TEST_LOG_LEVEL
// turns it back on when a test needs to be watched.
process.env.LOG_LEVEL = process.env.TEST_LOG_LEVEL ?? 'error';
