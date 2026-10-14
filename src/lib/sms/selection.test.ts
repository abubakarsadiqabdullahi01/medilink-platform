import { beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({
  APP_ENV: 'staging' as string,
  SMS_PROVIDER: 'termii' as string,
  SMS_API_KEY: undefined as string | undefined,
  SMS_SENDER_ID: undefined as string | undefined,
  SMS_USERNAME: undefined as string | undefined,
  SMS_CONSOLE_OUTBOX: undefined as string | undefined,
}));
vi.mock('../env', () => ({ env }));

import { SmsNotConfiguredError, smsAdapter } from './index';

beforeEach(() => {
  Object.assign(env, {
    APP_ENV: 'staging',
    SMS_PROVIDER: 'termii',
    SMS_API_KEY: undefined,
    SMS_SENDER_ID: undefined,
    SMS_USERNAME: undefined,
  });
});

const message = { to: '+2348031234567', body: 'Your code is 123456.' };

describe('choosing the SMS adapter', () => {
  it('uses the Termii gateway when it has a key and a sender', () => {
    Object.assign(env, { SMS_PROVIDER: 'termii', SMS_API_KEY: 'k', SMS_SENDER_ID: 'Medilink' });

    expect(smsAdapter().name).toBe('termii');
  });

  it('uses Africa\'s Talking when it has a key and a username', () => {
    Object.assign(env, { SMS_PROVIDER: 'africastalking', SMS_API_KEY: 'k', SMS_USERNAME: 'medilink' });

    expect(smsAdapter().name).toBe('africastalking');
  });

  it.each([
    ['termii', { SMS_SENDER_ID: 'Medilink' }, 'SMS_API_KEY'],
    ['termii', { SMS_API_KEY: 'k' }, 'SMS_SENDER_ID'],
    ['africastalking', { SMS_USERNAME: 'medilink' }, 'SMS_API_KEY'],
    ['africastalking', { SMS_API_KEY: 'k' }, 'SMS_USERNAME'],
  ])('names what is missing, at the first send, for %s without it', async (provider, config, missing) => {
    Object.assign(env, { SMS_PROVIDER: provider, ...config });

    const adapter = smsAdapter();

    await expect(adapter.send(message)).rejects.toBeInstanceOf(SmsNotConfiguredError);
    await expect(adapter.send(message)).rejects.toThrow(missing);
  });

  it('still refuses the console adapter anywhere but local', () => {
    Object.assign(env, { SMS_PROVIDER: 'console', APP_ENV: 'production' });

    expect(() => smsAdapter()).toThrow(/must not run in production/);
  });
});
