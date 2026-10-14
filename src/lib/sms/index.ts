import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { env } from '../env';
import { logger } from '../logger';
import { maskPhone } from '../phone';
import { africasTalkingAdapter } from './africastalking';
import { termiiAdapter } from './termii';

/**
 * Outbound SMS. Stage 4.2 needs one-time codes delivered; Stage 4.7 replaces
 * the console adapter with a real gateway behind this same interface, so no
 * caller changes when it does.
 *
 * Message bodies carry no personal data beyond the code itself.
 *
 * Logging: the console adapter deliberately prints the whole message, code
 * included, because local development has no other way to read it. That is
 * safe only because it never runs outside APP_ENV=local — smsAdapter() throws
 * if it is selected anywhere else. Real adapters must log the masked
 * recipient and never the body.
 */
export interface SmsMessage {
  to: string;
  body: string;
  /** Set for one-time codes so a gateway can route them over a faster class. */
  transactional?: boolean;
}

export interface SmsResult {
  provider: string;
  providerMessageId: string | null;
  accepted: boolean;
}

export interface SmsAdapter {
  readonly name: string;
  send(message: SmsMessage): Promise<SmsResult>;
}

/**
 * Local development and tests: prints the message — code and all — and sends
 * nothing. Guarded in smsAdapter() so it cannot be selected off a developer's
 * machine.
 */
export const consoleSmsAdapter: SmsAdapter = {
  name: 'console',
  async send(message) {
    // eslint-disable-next-line no-console
    console.log(`[sms:console] to=${message.to}\n${message.body}`);
    if (env.SMS_CONSOLE_OUTBOX) await appendToOutbox(env.SMS_CONSOLE_OUTBOX, message);
    return { provider: 'console', providerMessageId: null, accepted: true };
  },
};

/**
 * The same message, as a line in a file a test can read.
 *
 * The browser journeys sign up through the real form, so they need the code
 * the form sent — and neither the log of a server they did not start nor the
 * hashed row in otp_codes will give it to them. No more exposed than the
 * console line above, and under the same local-only guard.
 */
async function appendToOutbox(path: string, message: SmsMessage): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(
    path,
    `${JSON.stringify({ to: message.to, body: message.body, at: new Date().toISOString() })}\n`,
  );
}

export class SmsNotConfiguredError extends Error {
  readonly code = 'sms_not_configured';
  constructor(provider: string, missing: string) {
    super(`The ${provider} SMS gateway cannot send: ${missing} is not set.`);
    this.name = 'SmsNotConfiguredError';
  }
}

/**
 * An adapter that says what is missing every time it is used, rather than throwing when
 * it is built: `smsAdapter()` is called on paths that only need to know which provider is
 * configured, and a process that starts and then cannot send is told why at the first send
 * (and, outside local, at boot: see env-rules.ts).
 */
function missingConfiguration(name: string, missing: string): SmsAdapter {
  return {
    name,
    async send() {
      throw new SmsNotConfiguredError(name, missing);
    },
  };
}

export class SmsConsoleAdapterOutsideLocalError extends Error {
  readonly code = 'sms_console_adapter_outside_local';
  constructor(appEnv: string) {
    super(
      `SMS_PROVIDER=console prints one-time codes in cleartext and must not run in ${appEnv}.`,
    );
    this.name = 'SmsConsoleAdapterOutsideLocalError';
  }
}

export function smsAdapter(): SmsAdapter {
  switch (env.SMS_PROVIDER) {
    case 'console':
      // A misconfigured staging or production deploy would otherwise write
      // every signup code to a log aggregator, which is a credential leak.
      if (env.APP_ENV !== 'local') {
        throw new SmsConsoleAdapterOutsideLocalError(env.APP_ENV);
      }
      return consoleSmsAdapter;
    case 'termii':
      if (!env.SMS_API_KEY) return missingConfiguration('termii', 'SMS_API_KEY');
      if (!env.SMS_SENDER_ID) return missingConfiguration('termii', 'SMS_SENDER_ID');
      return termiiAdapter({ apiKey: env.SMS_API_KEY, senderId: env.SMS_SENDER_ID });
    case 'africastalking':
      if (!env.SMS_API_KEY) return missingConfiguration('africastalking', 'SMS_API_KEY');
      if (!env.SMS_USERNAME) return missingConfiguration('africastalking', 'SMS_USERNAME');
      return africasTalkingAdapter({
        apiKey: env.SMS_API_KEY,
        username: env.SMS_USERNAME,
        senderId: env.SMS_SENDER_ID,
      });
  }
}

/** Never throws: a delivery failure must not roll back a committed write. */
export async function trySendSms(message: SmsMessage): Promise<SmsResult | null> {
  const adapter = smsAdapter();
  try {
    return await adapter.send(message);
  } catch (error) {
    logger.error('sms delivery failed', {
      provider: adapter.name,
      to: maskPhone(message.to),
      error: String(error),
    });
    return null;
  }
}
