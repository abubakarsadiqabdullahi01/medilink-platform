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

interface Credentials {
  prefix: 'SMS' | 'SMS_FALLBACK';
  apiKey?: string;
  senderId?: string;
  username?: string;
}

/**
 * A real gateway's adapter from the credentials it was given, or one that says which
 * setting is missing at the first send. `prefix` is only for that message: the primary
 * gateway's settings are `SMS_*` and the fallback's are `SMS_FALLBACK_*`, and the fallback
 * never reads the primary's, because two gateways that share a key are one gateway.
 */
function gatewayAdapter(provider: 'termii' | 'africastalking', credentials: Credentials): SmsAdapter {
  const setting = (name: string) => `${credentials.prefix}_${name}`;
  switch (provider) {
    case 'termii':
      if (!credentials.apiKey) return missingConfiguration('termii', setting('API_KEY'));
      if (!credentials.senderId) return missingConfiguration('termii', setting('SENDER_ID'));
      return termiiAdapter({ apiKey: credentials.apiKey, senderId: credentials.senderId });
    case 'africastalking':
      if (!credentials.apiKey) return missingConfiguration('africastalking', setting('API_KEY'));
      if (!credentials.username) return missingConfiguration('africastalking', setting('USERNAME'));
      return africasTalkingAdapter({
        apiKey: credentials.apiKey,
        username: credentials.username,
        senderId: credentials.senderId,
      });
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
    case 'africastalking':
      return gatewayAdapter(env.SMS_PROVIDER, {
        prefix: 'SMS',
        apiKey: env.SMS_API_KEY,
        senderId: env.SMS_SENDER_ID,
        username: env.SMS_USERNAME,
      });
  }
}

/**
 * The second gateway, used only when the first fails to take a message. None unless
 * `SMS_FALLBACK_PROVIDER` is set, so a deployment that has not chosen a second provider
 * behaves exactly as before. It carries its own credentials (`SMS_FALLBACK_*`).
 */
export function fallbackAdapter(): SmsAdapter | null {
  if (!env.SMS_FALLBACK_PROVIDER) return null;
  return gatewayAdapter(env.SMS_FALLBACK_PROVIDER, {
    prefix: 'SMS_FALLBACK',
    apiKey: env.SMS_FALLBACK_API_KEY,
    senderId: env.SMS_FALLBACK_SENDER_ID,
    username: env.SMS_FALLBACK_USERNAME,
  });
}

export interface SmsAttempt {
  /** True only when a gateway accepted the message. */
  delivered: boolean;
  result: SmsResult | null;
  /** Why not, in words an operator can read; never the message body. */
  reason: string | null;
  /** Set when the first gateway failed and the fallback took the message: the one that failed. */
  failedOverFrom?: string;
}

const REASON_MAX_LENGTH = 300;

/**
 * Offers a message to each gateway in turn until one takes it, and says what happened.
 * Never throws: a delivery failure must not roll back a committed write. A gateway that
 * answers "not accepted" has failed just as one that throws has — the old shape handed back
 * the result either way and callers treated any result as sent.
 *
 * One attempt per gateway; retrying is the outbox's job (see `notify`). A failover can send
 * a text twice: a gateway that times out may have taken the message after all, and the
 * fallback then sends it again. That is the right side to err on for a one-time code, a
 * missed-shift alert or a severe-incident alert, and the repeat is a duplicate text, not a
 * lost one.
 *
 * With one gateway the reasons are what they have always been. With two, each failure is
 * named, so the reason says which gateway said what.
 */
export async function attemptWith(adapters: SmsAdapter[], message: SmsMessage): Promise<SmsAttempt> {
  const failures: { name: string; reason: string }[] = [];

  for (const adapter of adapters) {
    try {
      const result = await adapter.send(message);
      if (result.accepted) {
        return {
          delivered: true,
          result,
          reason: null,
          ...(failures.length > 0 ? { failedOverFrom: failures[0]!.name } : {}),
        };
      }
      logger.error('sms not accepted', { provider: adapter.name, to: maskPhone(message.to) });
      failures.push({ name: adapter.name, reason: `The ${adapter.name} gateway did not accept the message.` });
      // A refusal is the gateway's answer, so a caller reading `result` sees it (as it did before
      // there was a fallback) when there is nobody else to ask.
      if (adapters.length === 1) return { delivered: false, result, reason: failures[0]!.reason };
    } catch (error) {
      logger.error('sms delivery failed', {
        provider: adapter.name,
        to: maskPhone(message.to),
        error: String(error),
      });
      failures.push({ name: adapter.name, reason: String(error) });
    }
  }

  const reason =
    adapters.length === 1
      ? failures[0]!.reason
      : failures.map((failure) => `${failure.name}: ${failure.reason}`).join('; ');
  return { delivered: false, result: null, reason: reason.slice(0, REASON_MAX_LENGTH) };
}

/**
 * Tries to send, through the primary gateway and then the fallback if there is one, and
 * says what happened. Never throws. A primary that cannot be built at all (the console
 * adapter outside local) is a misconfiguration, not an outage, and is reported as one
 * rather than quietly handed to the fallback.
 */
export async function attemptSms(message: SmsMessage): Promise<SmsAttempt> {
  let adapters: SmsAdapter[];
  try {
    const fallback = fallbackAdapter();
    adapters = fallback ? [smsAdapter(), fallback] : [smsAdapter()];
  } catch (error) {
    logger.error('sms adapter unavailable', { to: maskPhone(message.to), error: String(error) });
    return { delivered: false, result: null, reason: String(error).slice(0, REASON_MAX_LENGTH) };
  }
  return attemptWith(adapters, message);
}

/** Never throws. For callers that only want the result, or nothing. */
export async function trySendSms(message: SmsMessage): Promise<SmsResult | null> {
  const attempt = await attemptSms(message);
  return attempt.delivered ? attempt.result : null;
}
