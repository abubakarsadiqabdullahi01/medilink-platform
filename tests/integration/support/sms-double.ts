import type { SmsAttempt, SmsMessage, SmsResult } from '@/lib/sms';

/**
 * A stand-in for the SMS gateway, shaped as the `@/lib/sms` module.
 *
 * Notifications send through `attemptSms`, which says whether the gateway took
 * the message and why not. A test that only wants to decide what the gateway
 * answers gives this one function: resolve a result to accept the message,
 * resolve `null` or an unaccepted result to have it refused, or reject to have
 * the call fail — the same three things a real gateway can do.
 *
 * Used as
 *
 *     const sms = vi.hoisted(() => ({ send: vi.fn() }));
 *     vi.mock('@/lib/sms', async () => (await import('./support/sms-double')).gatewayDouble(sms.send));
 */
type Send = (message: SmsMessage) => Promise<SmsResult | null> | SmsResult | null;

export async function attemptWith(send: Send, message: SmsMessage): Promise<SmsAttempt> {
  try {
    const result = await send(message);
    if (result?.accepted) return { delivered: true, result, reason: null };
    return { delivered: false, result: result ?? null, reason: 'The gateway did not accept the message.' };
  } catch (error) {
    return { delivered: false, result: null, reason: String(error).slice(0, 300) };
  }
}

export function gatewayDouble(send: Send) {
  return {
    attemptSms: (message: SmsMessage) => attemptWith(send, message),
    trySendSms: async (message: SmsMessage) => {
      const attempt = await attemptWith(send, message);
      return attempt.delivered ? attempt.result : null;
    },
  };
}
