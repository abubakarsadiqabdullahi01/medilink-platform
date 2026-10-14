/**
 * Settings that are fine on a laptop and dangerous anywhere else.
 *
 * Each of these already fails somewhere — the console SMS adapter refuses to
 * send outside local, the console payment gateway refuses to settle — but at
 * the first request that needs it: the first person to sign up in staging
 * finds out, not the person deploying it. env.ts's rule is that bad
 * configuration stops the process at boot, so these are checked there too.
 *
 * Pure, so every rule is unit-tested without a process to boot.
 */
export interface DeploymentSettings {
  NODE_ENV: string;
  APP_ENV: 'local' | 'staging' | 'production';
  APP_URL: string;
  SESSION_SECRET: string;
  SMS_PROVIDER: string;
  SMS_CONSOLE_OUTBOX?: string;
  SMS_API_KEY?: string;
  SMS_SENDER_ID?: string;
  SMS_USERNAME?: string;
  PAYMENT_PROVIDER: string;
  PAYOUT_ACCOUNT_KEY?: string;
}

/**
 * Secrets that are published in this repository: the example file, CI, and
 * the integration suite's default. Long enough to pass the length check, and
 * known to anybody who has read the code.
 */
export const PUBLISHED_SECRETS: ReadonlySet<string> = new Set([
  'change-me-32-chars-minimum-value-here',
  'ci-session-secret-value-at-least-32-chars',
  'test-session-secret-value-at-least-32-chars',
]);

/** The key a local process falls back to, and the one the integration suite sets. Anybody who has read the code has them. */
export const PUBLISHED_ACCOUNT_KEYS: ReadonlySet<string> = new Set([
  'local-development-payout-account-key-not-a-secret',
  'test-payout-account-key-at-least-32-characters-long',
]);

/**
 * What is wrong with running these settings for real, in words a person
 * deploying can act on. Empty when nothing is.
 *
 * `appEnvWasSet` is whether APP_ENV came from the environment at all: it
 * defaults to `local`, and a production process that forgot to set it would
 * otherwise boot as a laptop — one-time codes in the log, session cookies
 * without `Secure`, the scripts that create administrators allowed to run.
 */
export function deploymentProblems(env: DeploymentSettings, appEnvWasSet: boolean): string[] {
  const problems: string[] = [];

  if (env.NODE_ENV === 'production' && !appEnvWasSet) {
    problems.push(
      'APP_ENV is not set. It defaults to "local", which a production process must never be — set it to staging or production (or to local, deliberately, for a local production build).',
    );
  }

  if (env.APP_ENV === 'local') return problems;

  if (env.SMS_PROVIDER === 'console') {
    problems.push(
      `SMS_PROVIDER=console writes every one-time code into the log, and is refused in ${env.APP_ENV}.`,
    );
  }
  // A provider with no credentials used to start fine and then fail every code silently
  // (NOT-06); now it refuses to start, naming what is missing.
  if (env.SMS_PROVIDER === 'termii') {
    for (const [name, value] of [['SMS_API_KEY', env.SMS_API_KEY], ['SMS_SENDER_ID', env.SMS_SENDER_ID]] as const) {
      if (!value) problems.push(`SMS_PROVIDER=termii needs ${name}, and without it no one-time code can be sent in ${env.APP_ENV}.`);
    }
  }
  if (env.SMS_PROVIDER === 'africastalking') {
    for (const [name, value] of [['SMS_API_KEY', env.SMS_API_KEY], ['SMS_USERNAME', env.SMS_USERNAME]] as const) {
      if (!value) problems.push(`SMS_PROVIDER=africastalking needs ${name}, and without it no one-time code can be sent in ${env.APP_ENV}.`);
    }
  }
  if (env.SMS_CONSOLE_OUTBOX) {
    problems.push(
      `SMS_CONSOLE_OUTBOX writes one-time codes to a file for the browser tests, and must be unset in ${env.APP_ENV}.`,
    );
  }
  if (env.PAYMENT_PROVIDER === 'console') {
    problems.push(
      `PAYMENT_PROVIDER=console reports payments that never happened, and is refused in ${env.APP_ENV}.`,
    );
  }
  if (!env.PAYOUT_ACCOUNT_KEY) {
    problems.push(
      `PAYOUT_ACCOUNT_KEY is not set. It seals the bank account numbers practitioners are paid into, and without it nobody can give one in ${env.APP_ENV}.`,
    );
  } else if (PUBLISHED_ACCOUNT_KEYS.has(env.PAYOUT_ACCOUNT_KEY)) {
    problems.push(
      'PAYOUT_ACCOUNT_KEY is a value published in this repository, so anybody who has read the code could open every account number; generate a new one.',
    );
  }
  if (PUBLISHED_SECRETS.has(env.SESSION_SECRET)) {
    problems.push(
      'SESSION_SECRET is a value published in this repository. Anybody who has read the code could forge a session; generate a new one.',
    );
  }
  if (!env.APP_URL.startsWith('https://')) {
    problems.push(
      `APP_URL must be https in ${env.APP_ENV}: session cookies are marked Secure there, and a browser will not send them back over http.`,
    );
  }

  return problems;
}
