import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Reads a one-time code the way a developer does locally: off the console
 * SMS adapter, which also appends each message to `SMS_CONSOLE_OUTBOX` when
 * that is set (see src/lib/sms/index.ts). The alternative — reaching into
 * otp_codes — is impossible by design: codes are only ever stored hashed.
 */
export const SMS_OUTBOX = join(process.cwd(), '.e2e', 'sms-outbox.jsonl');

interface OutboxLine {
  to: string;
  body: string;
  at: string;
}

function messagesTo(phone: string, since: Date): OutboxLine[] {
  if (!existsSync(SMS_OUTBOX)) return [];
  return readFileSync(SMS_OUTBOX, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as OutboxLine)
    .filter((line) => line.to === phone && new Date(line.at) >= since);
}

/** The code in the latest message to `phone` sent after `since`. */
export async function latestOtp(phone: string, since: Date, timeoutMs = 20_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const latest = messagesTo(phone, since).at(-1);
    const code = latest ? /\b(\d{6})\b/.exec(latest.body)?.[1] : undefined;
    if (code) return code;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `No one-time code reached ${phone} within ${timeoutMs / 1000}s. ` +
      `Is SMS_CONSOLE_OUTBOX set to .e2e/sms-outbox.jsonl for the app (docker-compose.yml sets it)?`,
  );
}
