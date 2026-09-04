/**
 * Password policy. Deliberately free of any native or server-only dependency
 * so that request validation schemas — which are also reachable from client
 * bundles — can import the limits without dragging in the Argon2 binary.
 */

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * Length and context checks only. No composition rules: forcing a symbol and
 * a digit produces predictable substitutions, whereas a password containing
 * the user's own phone number is the failure that actually gets exploited on
 * a shared ward computer.
 */
export interface PasswordContext {
  phone?: string;
  fullName?: string;
  email?: string | null;
}

const COMMON = new Set([
  'password', 'password1', 'passw0rd', '1234567890', 'qwertyuiop',
  'medilink', 'medilink1', 'letmein123', 'administrator', 'nigeria123',
]);

export function passwordProblems(password: string, context: PasswordContext = {}): string[] {
  const problems: string[] = [];

  if (password.length < PASSWORD_MIN_LENGTH) {
    problems.push(`Use at least ${PASSWORD_MIN_LENGTH} characters.`);
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    problems.push(`Use no more than ${PASSWORD_MAX_LENGTH} characters.`);
  }

  const lower = password.toLowerCase();
  if (COMMON.has(lower)) {
    problems.push('That password is too easy to guess. Choose something else.');
  }

  const digits = password.replace(/\D/g, '');
  const phoneDigits = (context.phone ?? '').replace(/\D/g, '');
  if (phoneDigits.length >= 7 && digits.includes(phoneDigits.slice(-7))) {
    problems.push('Your password must not contain your phone number.');
  }

  for (const part of (context.fullName ?? '').split(/\s+/)) {
    if (part.length >= 4 && lower.includes(part.toLowerCase())) {
      problems.push('Your password must not contain your name.');
      break;
    }
  }

  const localPart = (context.email ?? '').split('@')[0] ?? '';
  if (localPart.length >= 4 && lower.includes(localPart.toLowerCase())) {
    problems.push('Your password must not contain your email address.');
  }

  return [...new Set(problems)];
}
