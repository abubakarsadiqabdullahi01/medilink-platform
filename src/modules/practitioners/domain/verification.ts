import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Identity and professional-registration policy: pure, no database.
 *
 * The National Identification Number never leaves this file in clear text
 * beyond the caller that supplied it. Everything downstream works with the
 * keyed digest and the last four digits.
 */

export const NIN_LENGTH = 11;

export class NinFormatError extends Error {
  readonly code = 'invalid_nin';
  constructor(message = 'A National Identification Number is 11 digits.') {
    super(message);
    this.name = 'NinFormatError';
  }
}

/** Strips the spaces and dashes people type, then insists on eleven digits. */
export function normaliseNin(input: string): string {
  if (typeof input !== 'string') throw new NinFormatError();
  const digits = input.replace(/[\s-]/g, '');
  if (!new RegExp(`^\\d{${NIN_LENGTH}}$`).test(digits)) throw new NinFormatError();
  return digits;
}

/**
 * A keyed digest, not a bare hash — the same decision, for the same reason,
 * as one-time codes in src/modules/auth/domain/otp.ts. An eleven-digit space
 * is 10^11: an unkeyed SHA-256 of a leaked table is reversible by exhaustive
 * search, and the result would be a list of real people's NINs. The server
 * secret is what makes the stored value useless on its own.
 */
export function hashNin(nin: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(`nin:${normaliseNin(nin)}`)
    .digest('hex');
}

export function ninLast4(nin: string): string {
  return normaliseNin(nin).slice(-4);
}

/** Constant-time, so a comparison cannot be used to probe the digest. */
export function ninMatches(nin: string, storedHash: string, secret: string): boolean {
  const candidate = Buffer.from(hashNin(nin, secret));
  const stored = Buffer.from(storedHash);
  if (candidate.length !== stored.length) return false;
  return timingSafeEqual(candidate, stored);
}

export const FOLIO_NUMBER_MAX_LENGTH = 60;

/** Folio numbers are quoted inconsistently; the stored form is the comparable one. */
export function normaliseFolioNumber(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase();
}

/**
 * Step 5.5: "a unit test flags evidence older than the review period".
 *
 * Evidence without a date cannot be judged, and a licence checked two years
 * ago is not evidence that someone may work a shift tomorrow. Anything at or
 * beyond the review period is stale — inclusive, because a check that is
 * exactly a year old on a one-year period has expired, not just about to.
 */
export function isEvidenceStale(
  evidenceRetrievedAt: Date | null | undefined,
  reviewDays: number,
  now: Date = new Date(),
): boolean {
  if (!evidenceRetrievedAt) return true;
  const ageDays = (now.getTime() - evidenceRetrievedAt.getTime()) / (24 * 60 * 60 * 1000);
  return ageDays >= reviewDays;
}

export type RegistrationStatusValue = 'ACTIVE' | 'SUSPENDED' | 'EXPIRED' | 'STRUCK_OFF' | 'UNKNOWN';

export interface RegistrationSnapshot {
  registrationStatus: RegistrationStatusValue;
  expiresAt: Date | null;
  deletedAt?: Date | null;
}

/**
 * Whether this registration currently permits practice.
 *
 * `UNKNOWN` is not good news: it means the regulator was unreachable or said
 * something we could not read, and defaulting that to "fine" is exactly the
 * failure the verification step exists to prevent.
 */
export function isRegistrationUsable(
  registration: RegistrationSnapshot | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!registration || registration.deletedAt) return false;
  if (registration.registrationStatus !== 'ACTIVE') return false;
  if (registration.expiresAt && registration.expiresAt.getTime() <= now.getTime()) return false;
  return true;
}
