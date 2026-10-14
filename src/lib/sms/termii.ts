import type { SmsAdapter, SmsMessage, SmsResult } from './index';

/**
 * Termii (https://termii.com), a Nigerian gateway, over its documented HTTP API.
 *
 * `POST {base}/api/sms/send` with the key in the JSON body, the number without its
 * `+`, and a sender ID the account has had registered. One-time codes go on the `dnd`
 * channel, which reaches numbers that have opted out of promotional messages, since a
 * code that is filtered is a person who cannot sign in; everything else goes `generic`.
 *
 * **Written to the provider's documentation and not run against the provider**: there
 * is no account here to run it against. What it does with an answer it cannot read is
 * fail, never report success, so a wrong guess shows up as messages that are not
 * accepted rather than as texts that were never sent being counted as sent.
 *
 * Nothing is logged here. The body is a one-time code, and the key is a secret; the
 * error carries the status and nothing else, for `trySendSms` to log with the
 * recipient masked.
 */

export class SmsProviderError extends Error {
  readonly code = 'sms_provider_error';
  constructor(provider: string, detail: string) {
    super(`The ${provider} gateway did not accept the message (${detail}).`);
    this.name = 'SmsProviderError';
  }
}

const TIMEOUT_MS = 10_000;

export interface TermiiConfig {
  apiKey: string;
  /** Registered with Termii for the account; messages from an unregistered one are refused. */
  senderId: string;
  baseUrl?: string;
}

export function termiiAdapter(config: TermiiConfig, fetchImpl: typeof fetch = fetch): SmsAdapter {
  return {
    name: 'termii',
    async send(message: SmsMessage): Promise<SmsResult> {
      const response = await fetchImpl(`${config.baseUrl ?? 'https://api.ng.termii.com'}/api/sms/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          to: message.to.replace(/^\+/, ''),
          from: config.senderId,
          sms: message.body,
          type: 'plain',
          channel: message.transactional ? 'dnd' : 'generic',
          api_key: config.apiKey,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      type Answer = { code?: string; message_id?: string };
      const answer: Answer | null = await (response.json() as Promise<Answer>).catch(() => null);

      if (!response.ok || answer === null) {
        throw new SmsProviderError('termii', `HTTP ${response.status}`);
      }

      return {
        provider: 'termii',
        providerMessageId: answer.message_id ?? null,
        // Termii answers `"code": "ok"` for a message it has taken.
        accepted: answer.code === 'ok',
      };
    },
  };
}
