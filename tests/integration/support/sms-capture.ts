import { vi, type MockInstance } from 'vitest';

/**
 * Reads one-time codes the way a developer does locally: off the console
 * adapter's output. The alternative — reaching into otp_codes and reversing
 * the digest — would test the test rather than the delivery path, and would
 * pass even if the code were never sent.
 */
const lines: string[] = [];
let spy: MockInstance | null = null;

const CONSOLE_SMS_PREFIX = '[sms:console]';

export function startSmsCapture(): void {
  lines.length = 0;
  spy ??= vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  });
}

export function stopSmsCapture(): void {
  spy?.mockRestore();
  spy = null;
  lines.length = 0;
}

export function sentMessages(): string[] {
  return lines.filter((line) => line.includes(CONSOLE_SMS_PREFIX));
}

/** The code from the most recent message, which is the one just requested. */
export function lastOtpCode(): string {
  const messages = sentMessages();
  const latest = messages[messages.length - 1];

  if (!latest) {
    throw new Error('No SMS was sent. Expected a one-time code on the console adapter.');
  }

  const match = /\b(\d{6})\b/.exec(latest);
  if (!match?.[1]) {
    throw new Error(`No six-digit code in the message: ${latest}`);
  }

  return match[1];
}
