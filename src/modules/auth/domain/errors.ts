import { HttpError } from '@/lib/http/errors';

/**
 * Auth failures carry a stable code and an HTTP status. Messages are written
 * for the person reading them on a phone in a ward corridor, and are
 * deliberately vague about whether an account exists.
 */
export class AuthError extends HttpError {
  constructor(
    code: string,
    message: string,
    status: number = 400,
    readonly retryAfterSeconds?: number,
  ) {
    super(code, message, status);
    this.name = 'AuthError';
  }
}

export const AuthErrors = {
  termsNotAccepted: () =>
    new AuthError(
      'terms_not_accepted',
      'Please read and accept the privacy notice to create an account.',
      422,
    ),

  invalidCredentials: () =>
    new AuthError('invalid_credentials', 'That phone number or password is not correct.', 401),

  accountLocked: (retryAfterSeconds: number) =>
    new AuthError(
      'account_locked',
      'Too many attempts. Try again shortly or reset your password.',
      429,
      retryAfterSeconds,
    ),

  otpThrottled: (retryAfterSeconds: number) =>
    new AuthError('otp_throttled', 'Wait a moment before requesting another code.', 429, retryAfterSeconds),

  setupTokenInvalid: () =>
    new AuthError(
      'setup_token_invalid',
      'Your verification has expired or does not match. Verify your phone again to continue.',
      403,
    ),

  smsUnavailable: () =>
    new AuthError(
      'sms_unavailable',
      'We could not send the code to your phone just now. Try again in a minute.',
      503,
    ),

  otpInvalid: () => new AuthError('otp_invalid', 'That code is not correct.', 400),

  otpExpired: () => new AuthError('otp_expired', 'That code has expired. Request a new one.', 400),

  otpExhausted: () =>
    new AuthError('otp_exhausted', 'Too many incorrect codes. Request a new one.', 429),

  phoneNotVerified: () =>
    new AuthError('phone_not_verified', 'Verify your phone number to continue.', 409),

  passwordAlreadySet: () =>
    new AuthError('password_already_set', 'This account already has a password. Sign in instead.', 409),

  passwordRejected: (problems: string[]) =>
    new AuthError('password_rejected', problems.join(' '), 422),

  accountNotUsable: () =>
    new AuthError('account_not_usable', 'This account cannot sign in. Contact support.', 403),

  notAuthenticated: () => new AuthError('not_authenticated', 'Sign in to continue.', 401),
} as const;
