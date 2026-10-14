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

// Verification providers are forced off, not defaulted off. The container and
// CI both inherit whatever the deployment .env says, and a suite that depends
// on a paid subscription being configured is a suite that breaks the moment
// someone switches one on. TEST_*_VERIFICATION_PROVIDER exists for the tests
// that deliberately exercise the enabled path.
process.env.NIN_VERIFICATION_PROVIDER = process.env.TEST_NIN_VERIFICATION_PROVIDER ?? 'none';
process.env.MDCN_VERIFICATION_PROVIDER = process.env.TEST_MDCN_VERIFICATION_PROVIDER ?? 'none';


// Assigned rather than defaulted: the container and CI both set LOG_LEVEL=info,
// which buries a test failure under the worker's own commentary. TEST_LOG_LEVEL
// turns it back on when a test needs to be watched.
process.env.LOG_LEVEL = process.env.TEST_LOG_LEVEL ?? 'error';

// The billing tests pay practitioners through the stub gateway, which says it moved
// money it did not. The default is `none`, which refuses every payout, so a suite
// that took whatever the environment held passed on a laptop whose .env says
// `console` and failed in CI, which has no .env. Assigned, not defaulted, for the
// same reason as the providers above; the manual-provider cases mock it themselves.
process.env.PAYMENT_PROVIDER = 'console';

// Releasing a payout needs somebody other than the person who prepared it. Most
// of the suite prepares and releases as one person because it is about something
// else, so the control is off for the run; the cases that are about it unset it.
process.env.PAYOUT_SECOND_APPROVER = 'off';

// A payout is sized from what facilities have paid, not what they have been billed
// (BIL-03). Most of the suite approves, invoices and pays out in one breath because
// it is about something else, and does not stop to pay each invoice first, so the
// rule is off for the run; the cases that are about it unset it.
process.env.PAYOUT_REQUIRES_COLLECTION = 'off';

// A payout goes only to a bank account a finance officer has verified, once it has
// been the practitioner's for a day (BIL-06). The same reasoning as the two above:
// most of the suite is about something else and does not give everybody an account,
// so both are off for the run and the cases about them set them.
process.env.PAYOUT_REQUIRES_ACCOUNT = 'off';
process.env.PAYOUT_ACCOUNT_COOLING_HOURS = '0';

// Not the key a local process falls back to, so the suite exercises a key being set.
process.env.PAYOUT_ACCOUNT_KEY = 'test-payout-account-key-at-least-32-characters-long';
