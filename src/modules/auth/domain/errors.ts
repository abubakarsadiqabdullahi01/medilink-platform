/**
 * Auth failures carry a stable code and an HTTP status. Messages are written
 * for the person reading them on a phone in a ward corridor, and are
 * deliberately vague about whether an account exists.
 */
export class AuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number = 400,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export const AuthErrors = {
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
