import { describe, expect, it } from 'vitest';
import { deploymentProblems, IMPLEMENTED_SMS_PROVIDERS, type DeploymentSettings } from './env-rules';

const staging: DeploymentSettings = {
  NODE_ENV: 'production',
  APP_ENV: 'staging',
  APP_URL: 'https://staging.medilink.ng',
  SESSION_SECRET: 'a-freshly-generated-secret-of-plenty-of-length',
  SMS_PROVIDER: 'termii',
  PAYMENT_PROVIDER: 'none',
};

/** Every provider counted as implemented, so these cases test the other rules. */
const problemsWith = (settings: DeploymentSettings, appEnvWasSet: boolean) =>
  deploymentProblems(settings, appEnvWasSet, ['console', 'termii', 'africastalking']);

describe('deploymentProblems', () => {
  it('passes a properly configured staging deploy', () => {
    expect(problemsWith(staging, true)).toEqual([]);
  });

  it('refuses a production process that never said where it is running', () => {
    const problems = problemsWith({ ...staging, APP_ENV: 'local' }, false);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/APP_ENV is not set/);
  });

  it('allows a local production build that chose local on purpose', () => {
    const local = { ...staging, APP_ENV: 'local' as const, APP_URL: 'http://localhost:3100' };
    expect(problemsWith({ ...local, SMS_PROVIDER: 'console', SMS_CONSOLE_OUTBOX: '.e2e/x' }, true)).toEqual([]);
  });

  it('leaves development alone, where APP_ENV defaulting to local is the point', () => {
    expect(
      problemsWith({ ...staging, NODE_ENV: 'development', APP_ENV: 'local', SMS_PROVIDER: 'console' }, false),
    ).toEqual([]);
  });

  it.each([
    ['the console SMS adapter', { SMS_PROVIDER: 'console' }, /SMS_PROVIDER=console/],
    ['an SMS outbox file', { SMS_CONSOLE_OUTBOX: '.e2e/sms-outbox.jsonl' }, /SMS_CONSOLE_OUTBOX/],
    ['the console payment gateway', { PAYMENT_PROVIDER: 'console' }, /PAYMENT_PROVIDER=console/],
    ['the example session secret', { SESSION_SECRET: 'change-me-32-chars-minimum-value-here' }, /published/],
    ["CI's session secret", { SESSION_SECRET: 'ci-session-secret-value-at-least-32-chars' }, /published/],
    ['a plain-http address', { APP_URL: 'http://staging.medilink.ng' }, /https/],
  ] as const)('refuses %s outside local', (_label, change, message) => {
    for (const appEnv of ['staging', 'production'] as const) {
      const problems = problemsWith({ ...staging, APP_ENV: appEnv, ...change }, true);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatch(message);
    }
  });

  it('lists every problem at once, not one per failed deploy', () => {
    const problems = problemsWith(
      {
        ...staging,
        SMS_PROVIDER: 'console',
        PAYMENT_PROVIDER: 'console',
        APP_URL: 'http://staging.medilink.ng',
      },
      true,
    );
    expect(problems).toHaveLength(3);
  });
});

describe('an SMS provider with no working adapter (NOT-06)', () => {
  it('is the only provider the product can send with today: the console one', () => {
    expect(IMPLEMENTED_SMS_PROVIDERS).toEqual(['console']);
  });

  it.each(['termii', 'africastalking'])('refuses %s, which is accepted by the schema but only throws', (provider) => {
    for (const appEnv of ['staging', 'production'] as const) {
      const problems = deploymentProblems({ ...staging, APP_ENV: appEnv, SMS_PROVIDER: provider }, true);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatch(new RegExp(`SMS_PROVIDER=${provider} has no working adapter`));
    }
  });

  it('refuses it on a laptop too, where the console adapter is the only one that works', () => {
    const local = { ...staging, APP_ENV: 'local' as const, APP_URL: 'http://localhost:3000', SMS_PROVIDER: 'termii' };
    expect(deploymentProblems(local, true)).toHaveLength(1);
  });

  it('accepts a provider once it is named as implemented', () => {
    expect(deploymentProblems(staging, true, ['termii'])).toEqual([]);
  });
});
