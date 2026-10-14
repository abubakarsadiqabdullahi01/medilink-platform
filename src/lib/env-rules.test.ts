import { describe, expect, it } from 'vitest';
import { deploymentProblems, type DeploymentSettings } from './env-rules';

const staging: DeploymentSettings = {
  NODE_ENV: 'production',
  APP_ENV: 'staging',
  APP_URL: 'https://staging.medilink.ng',
  SESSION_SECRET: 'a-freshly-generated-secret-of-plenty-of-length',
  SMS_PROVIDER: 'termii',
  PAYMENT_PROVIDER: 'none',
  PAYOUT_ACCOUNT_KEY: 'a-freshly-generated-account-key-of-plenty-of-length',
};

describe('deploymentProblems', () => {
  it('passes a properly configured staging deploy', () => {
    expect(deploymentProblems(staging, true)).toEqual([]);
  });

  it('allows paying by hand in staging and production: it claims nothing it has not been told', () => {
    // The console gateway reports money as moved that did not; the manual one moves
    // nothing and waits for a person to say which transfer they made (BIL-05).
    for (const appEnv of ['staging', 'production'] as const) {
      expect(deploymentProblems({ ...staging, APP_ENV: appEnv, PAYMENT_PROVIDER: 'manual' }, true)).toEqual([]);
    }
  });

  it('refuses a production process that never said where it is running', () => {
    const problems = deploymentProblems({ ...staging, APP_ENV: 'local' }, false);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/APP_ENV is not set/);
  });

  it('allows a local production build that chose local on purpose', () => {
    const local = { ...staging, APP_ENV: 'local' as const, APP_URL: 'http://localhost:3100' };
    expect(deploymentProblems({ ...local, SMS_PROVIDER: 'console', SMS_CONSOLE_OUTBOX: '.e2e/x' }, true)).toEqual([]);
  });

  it('leaves development alone, where APP_ENV defaulting to local is the point', () => {
    expect(
      deploymentProblems({ ...staging, NODE_ENV: 'development', APP_ENV: 'local', SMS_PROVIDER: 'console' }, false),
    ).toEqual([]);
  });

  it.each([
    ['the console SMS adapter', { SMS_PROVIDER: 'console' }, /SMS_PROVIDER=console/],
    ['an SMS outbox file', { SMS_CONSOLE_OUTBOX: '.e2e/sms-outbox.jsonl' }, /SMS_CONSOLE_OUTBOX/],
    ['the console payment gateway', { PAYMENT_PROVIDER: 'console' }, /PAYMENT_PROVIDER=console/],
    ['the example session secret', { SESSION_SECRET: 'change-me-32-chars-minimum-value-here' }, /published/],
    ["CI's session secret", { SESSION_SECRET: 'ci-session-secret-value-at-least-32-chars' }, /published/],
    ['a plain-http address', { APP_URL: 'http://staging.medilink.ng' }, /https/],
    ['no key for bank account numbers', { PAYOUT_ACCOUNT_KEY: undefined }, /PAYOUT_ACCOUNT_KEY is not set/],
    [
      'the account key the local process falls back to',
      { PAYOUT_ACCOUNT_KEY: 'local-development-payout-account-key-not-a-secret' },
      /PAYOUT_ACCOUNT_KEY is a value published/,
    ],
    [
      "the integration suite's account key",
      { PAYOUT_ACCOUNT_KEY: 'test-payout-account-key-at-least-32-characters-long' },
      /PAYOUT_ACCOUNT_KEY is a value published/,
    ],
  ] as const)('refuses %s outside local', (_label, change, message) => {
    for (const appEnv of ['staging', 'production'] as const) {
      const problems = deploymentProblems({ ...staging, APP_ENV: appEnv, ...change }, true);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatch(message);
    }
  });

  it('lists every problem at once, not one per failed deploy', () => {
    const problems = deploymentProblems(
      {
        ...staging,
        SMS_PROVIDER: 'console',
        PAYMENT_PROVIDER: 'console',
        APP_URL: 'http://staging.medilink.ng',
        PAYOUT_ACCOUNT_KEY: undefined,
      },
      true,
    );
    expect(problems).toHaveLength(4);
  });
});
