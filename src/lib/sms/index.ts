import { env } from '../env';
import { logger } from '../logger';
import { maskPhone } from '../phone';

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
    return { provider: 'console', providerMessageId: null, accepted: true };
  },
};

export class SmsNotConfiguredError extends Error {
  readonly code = 'sms_not_configured';
  constructor(provider: string) {
    super(`The ${provider} SMS adapter is not implemented yet (Stage 4.7).`);
    this.name = 'SmsNotConfiguredError';
  }
}

function unimplemented(name: string): SmsAdapter {
  return {
    name,
    async send() {
      throw new SmsNotConfiguredError(name);
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
      return unimplemented('termii');
    case 'africastalking':
      return unimplemented('africastalking');
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
