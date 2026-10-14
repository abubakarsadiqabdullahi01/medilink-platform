import { SmsProviderError } from './termii';
import type { SmsAdapter, SmsMessage, SmsResult } from './index';

/**
 * Africa's Talking (https://africastalking.com), over its documented HTTP API.
 *
 * `POST {base}/version1/messaging`, form-encoded, with the key in the `apiKey` header
 * and the account's username in the body; the number keeps its `+`. The answer lists a
 * status per recipient, and a message counts as accepted only for the codes the provider
 * documents as taken (100 processed, 101 sent, 102 queued). The sandbox is a different
 * host with the username `sandbox`.
 *
 * Written to the provider's documentation and not run against it, for the reason set out
 * in `termii.ts`: an answer that cannot be read is a failure, never a success. Nothing is
 * logged here, and no error carries the body or the key.
 */

const TIMEOUT_MS = 10_000;
const TAKEN = new Set([100, 101, 102]);

export interface AfricasTalkingConfig {
  apiKey: string;
  username: string;
  /** A sender ID registered for the account; left out, the provider's shared one is used. */
  senderId?: string;
  baseUrl?: string;
}

export function africasTalkingAdapter(
  config: AfricasTalkingConfig,
  fetchImpl: typeof fetch = fetch,
): SmsAdapter {
  const base =
    config.baseUrl ??
    (config.username === 'sandbox'
      ? 'https://api.sandbox.africastalking.com'
      : 'https://api.africastalking.com');

  return {
    name: 'africastalking',
    async send(message: SmsMessage): Promise<SmsResult> {
      const form = new URLSearchParams({
        username: config.username,
        to: message.to,
        message: message.body,
      });
      if (config.senderId) form.set('from', config.senderId);

      const response = await fetchImpl(`${base}/version1/messaging`, {
        method: 'POST',
        headers: {
          apiKey: config.apiKey,
          accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      type Answer = { SMSMessageData?: { Recipients?: { statusCode?: number; messageId?: string }[] } };
      const answer: Answer | null = await (response.json() as Promise<Answer>).catch(() => null);

      if (!response.ok || answer === null) {
        throw new SmsProviderError('africastalking', `HTTP ${response.status}`);
      }

      const recipient = answer.SMSMessageData?.Recipients?.[0];
      return {
        provider: 'africastalking',
        providerMessageId: recipient?.messageId ?? null,
        accepted: recipient?.statusCode !== undefined && TAKEN.has(recipient.statusCode),
      };
    },
  };
}
