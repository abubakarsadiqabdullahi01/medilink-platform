import '@testing-library/jest-dom/vitest';

/**
 * Unit-test environment. src/lib/env.ts validates configuration at import
 * time, so any module under test that reads it needs these present. These are
 * throwaway values and must never resemble real credentials.
 */
process.env.APP_ENV ??= 'local';
process.env.APP_URL ??= 'http://localhost:3000';
process.env.DATABASE_URL ??= 'postgresql://medilink:medilink@localhost:5432/medilink_test?schema=public';
process.env.SESSION_SECRET ??= 'test-session-secret-value-at-least-32-chars';
process.env.STORAGE_ENDPOINT ??= 'http://localhost:9000';
process.env.STORAGE_BUCKET ??= 'medilink-documents-test';
process.env.STORAGE_ACCESS_KEY_ID ??= 'test';
process.env.STORAGE_SECRET_ACCESS_KEY ??= 'test-secret';
process.env.LOG_LEVEL ??= 'error';

// Verification providers are forced off, not defaulted off. The container and
// CI both inherit whatever the deployment .env says, and a suite that depends
// on a paid subscription being configured is a suite that breaks the moment
// someone switches one on. TEST_*_VERIFICATION_PROVIDER exists for the tests
// that deliberately exercise the enabled path.
process.env.NIN_VERIFICATION_PROVIDER = process.env.TEST_NIN_VERIFICATION_PROVIDER ?? 'none';
process.env.MDCN_VERIFICATION_PROVIDER = process.env.TEST_MDCN_VERIFICATION_PROVIDER ?? 'none';

