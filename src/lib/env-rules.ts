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
  PAYMENT_PROVIDER: string;
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
