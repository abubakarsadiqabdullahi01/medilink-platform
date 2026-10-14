import { beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({
  APP_ENV: 'staging' as string,
  SMS_PROVIDER: 'termii' as string,
  SMS_API_KEY: undefined as string | undefined,
  SMS_SENDER_ID: undefined as string | undefined,
  SMS_USERNAME: undefined as string | undefined,
  SMS_CONSOLE_OUTBOX: undefined as string | undefined,
  SMS_FALLBACK_PROVIDER: undefined as string | undefined,
  SMS_FALLBACK_API_KEY: undefined as string | undefined,
  SMS_FALLBACK_SENDER_ID: undefined as string | undefined,
  SMS_FALLBACK_USERNAME: undefined as string | undefined,
}));
vi.mock('../env', () => ({ env }));

import { SmsNotConfiguredError, fallbackAdapter, smsAdapter } from './index';

beforeEach(() => {
  Object.assign(env, {
    APP_ENV: 'staging',
    SMS_PROVIDER: 'termii',
    SMS_API_KEY: undefined,
    SMS_SENDER_ID: undefined,
    SMS_USERNAME: undefined,
    SMS_FALLBACK_PROVIDER: undefined,
    SMS_FALLBACK_API_KEY: undefined,
    SMS_FALLBACK_SENDER_ID: undefined,
    SMS_FALLBACK_USERNAME: undefined,
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

describe('choosing the fallback SMS adapter', () => {
  it('is none unless a fallback provider is named, so failover is off by default', () => {
    expect(fallbackAdapter()).toBeNull();
  });

  it('uses Africa\'s Talking as the fallback when it has its own key and username', () => {
    Object.assign(env, {
      SMS_PROVIDER: 'termii',
      SMS_FALLBACK_PROVIDER: 'africastalking',
      SMS_FALLBACK_API_KEY: 'k2',
      SMS_FALLBACK_USERNAME: 'medilink',
    });

    expect(fallbackAdapter()?.name).toBe('africastalking');
  });

  it('uses Termii as the fallback when it has its own key and sender', () => {
    Object.assign(env, {
      SMS_PROVIDER: 'africastalking',
      SMS_FALLBACK_PROVIDER: 'termii',
      SMS_FALLBACK_API_KEY: 'k2',
      SMS_FALLBACK_SENDER_ID: 'Medilink',
    });

    expect(fallbackAdapter()?.name).toBe('termii');
  });

  it('never borrows the primary\'s credentials: its own key is the only one it uses', async () => {
    Object.assign(env, {
      SMS_PROVIDER: 'africastalking',
      SMS_API_KEY: 'the-primarys-key',
      SMS_USERNAME: 'medilink',
      SMS_SENDER_ID: 'Medilink',
      SMS_FALLBACK_PROVIDER: 'termii',
    });

    await expect(fallbackAdapter()!.send(message)).rejects.toThrow('SMS_FALLBACK_API_KEY');
  });

  it.each([
    ['termii', { SMS_FALLBACK_SENDER_ID: 'Medilink' }, 'SMS_FALLBACK_API_KEY'],
    ['termii', { SMS_FALLBACK_API_KEY: 'k' }, 'SMS_FALLBACK_SENDER_ID'],
    ['africastalking', { SMS_FALLBACK_USERNAME: 'medilink' }, 'SMS_FALLBACK_API_KEY'],
    ['africastalking', { SMS_FALLBACK_API_KEY: 'k' }, 'SMS_FALLBACK_USERNAME'],
  ])('names what is missing, at the first send, for a %s fallback without it', async (provider, config, missing) => {
    Object.assign(env, { SMS_FALLBACK_PROVIDER: provider, ...config });

    const adapter = fallbackAdapter()!;

    await expect(adapter.send(message)).rejects.toBeInstanceOf(SmsNotConfiguredError);
    await expect(adapter.send(message)).rejects.toThrow(missing);
  });
});
