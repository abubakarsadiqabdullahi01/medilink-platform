import { describe, expect, it, vi } from 'vitest';

// index.ts reads the environment when it is imported; none of these cases touch it.
vi.mock('../env', () => ({ env: { APP_ENV: 'local', SMS_PROVIDER: 'console' } }));

import { attemptWith, type SmsAdapter, type SmsResult } from './index';

const message = { to: '+2348031234567', body: 'A practitioner is confirmed for your shift.' };

const accepting = (name: string): SmsAdapter => ({
  name,
  send: vi.fn(async (): Promise<SmsResult> => ({ provider: name, providerMessageId: `${name}-1`, accepted: true })),
});
const refusing = (name: string): SmsAdapter => ({
  name,
  send: vi.fn(async (): Promise<SmsResult> => ({ provider: name, providerMessageId: null, accepted: false })),
});
const throwing = (name: string, error = 'HTTP 503'): SmsAdapter => ({
  name,
  send: vi.fn(async (): Promise<SmsResult> => {
    throw new Error(error);
  }),
});

describe('sending through a primary gateway and, if there is one, a fallback', () => {
  it('uses only the primary when it takes the message, and does not mention a failover', async () => {
    const primary = accepting('termii');
    const fallback = accepting('africastalking');

    const attempt = await attemptWith([primary, fallback], message);

    expect(attempt.delivered).toBe(true);
    expect(attempt.result?.provider).toBe('termii');
    expect(attempt.failedOverFrom).toBeUndefined();
    expect(fallback.send).not.toHaveBeenCalled();
  });

  it('hands the message to the fallback when the primary throws, and says who failed', async () => {
    const fallback = accepting('africastalking');

    const attempt = await attemptWith([throwing('termii'), fallback], message);

    expect(attempt.delivered).toBe(true);
    expect(attempt.result).toMatchObject({ provider: 'africastalking', providerMessageId: 'africastalking-1' });
    expect(attempt.failedOverFrom).toBe('termii');
    expect(attempt.reason).toBeNull();
    expect(fallback.send).toHaveBeenCalledTimes(1);
  });

  it('treats an answer of "not accepted" as a failure to fail over from, as a thrown error is', async () => {
    const attempt = await attemptWith([refusing('termii'), accepting('africastalking')], message);

    expect(attempt.delivered).toBe(true);
    expect(attempt.failedOverFrom).toBe('termii');
  });

  it('names both gateways, in order, when neither takes it, and reports no result', async () => {
    const attempt = await attemptWith(
      [throwing('termii', 'HTTP 503'), refusing('africastalking')],
      message,
    );

    expect(attempt.delivered).toBe(false);
    expect(attempt.result).toBeNull();
    expect(attempt.failedOverFrom).toBeUndefined();
    expect(attempt.reason).toMatch(/termii.*503.*africastalking.*did not accept/s);
  });

  it('with no fallback, reports exactly what it always did', async () => {
    const thrown = await attemptWith([throwing('termii', 'HTTP 503')], message);
    const refused = await attemptWith([refusing('termii')], message);

    expect(thrown.reason).toBe('Error: HTTP 503');
    expect(refused.reason).toBe('The termii gateway did not accept the message.');
    expect(refused.result).toMatchObject({ accepted: false });
  });

  it('never gives the message body or the number back in a reason', async () => {
    const attempt = await attemptWith([throwing('termii', 'HTTP 503')], message);

    expect(attempt.reason).not.toContain(message.body);
    expect(attempt.reason).not.toContain(message.to);
  });

  it('keeps the reason short enough to store', async () => {
    const attempt = await attemptWith(
      [throwing('termii', 'x'.repeat(2000)), throwing('africastalking', 'y'.repeat(2000))],
      message,
    );

    expect(attempt.reason!.length).toBeLessThanOrEqual(300);
  });

  it('is not tried again by anything but the caller: one attempt per gateway', async () => {
    const primary = throwing('termii');
    const fallback = throwing('africastalking');

    await attemptWith([primary, fallback], message);

    expect(primary.send).toHaveBeenCalledTimes(1);
    expect(fallback.send).toHaveBeenCalledTimes(1);
  });
});
