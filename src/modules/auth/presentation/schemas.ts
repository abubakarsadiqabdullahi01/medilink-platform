import { z } from 'zod';
import { isNigerianPhone } from '@/lib/phone';
import { OTP_LENGTH } from '../domain/otp';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@/lib/password-policy';

/**
 * Request validation at the boundary. Every route parses its body through one
 * of these, so a handler never sees an unchecked value.
 */
const phone = z
  .string()
  .min(1, 'Enter your phone number.')
  .refine(isNigerianPhone, 'Enter a Nigerian mobile number, for example 0803 123 4567.');

const code = z
  .string()
  .trim()
  .regex(new RegExp(`^\\d{${OTP_LENGTH}}$`), `Enter the ${OTP_LENGTH}-digit code.`);

const password = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);

export const startRegistrationSchema = z.object({
  phone,
  fullName: z.string().trim().min(2, 'Enter your full name.').max(120),
  email: z.string().trim().toLowerCase().email().max(160).optional(),
});

export const verifyPhoneSchema = z.object({ phone, code });

/**
 * `staff` is an account opened to work for an organisation — a hospital's
 * owner registering it, or a colleague the owner will add. It gets no
 * practitioner role and no screening, because it is not a practitioner. The
 * default stays `practitioner` so every existing caller means what it meant.
 */
export const setPasswordSchema = z.object({
  phone,
  password,
  /** What verifying the phone returned; proves this step follows that one. */
  setupToken: z.string().min(1).max(200),
  accountType: z.enum(['practitioner', 'staff']).default('practitioner'),
  consentToSharing: z.boolean().optional(),
});

export const loginSchema = z.object({ phone, password: z.string().min(1) });

export const resetRequestSchema = z.object({ phone });

export const resetConfirmSchema = z.object({ phone, code, password });

export const resendSchema = z.object({
  phone,
  purpose: z.enum(['PHONE_VERIFICATION', 'PASSWORD_RESET']),
});
