import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';
import { env } from '@/lib/env';

/**
 * Sealing the account numbers practitioners are paid into (BIL-06).
 *
 * A bank account number is financial data about a person, and the database is
 * backed up, copied and read by more people than should ever read one of these. It
 * is sealed with AES-256-GCM under a key of its own (`PAYOUT_ACCOUNT_KEY`) that is
 * not in the database or the backups of it. A number is opened only to show finance
 * where to transfer, and every time that happens is audited.
 *
 * Two keys are derived from the one setting, one to seal and one to fingerprint, so
 * the key that protects the number is never used for anything else.
 */

export class AccountVaultUnavailable extends Error {
  constructor() {
    super('PAYOUT_ACCOUNT_KEY is not set, so bank account numbers cannot be stored or read here.');
    this.name = 'AccountVaultUnavailable';
  }
}

/**
 * What a local process uses when nothing is set, so a laptop works with no
 * configuration. It is in the repository and protects nothing: the deployment rules
 * refuse it, and refuse an unset key, anywhere that is not local.
 */
const LOCAL_KEY = 'local-development-payout-account-key-not-a-secret';

function rootKey(): string {
  if (env.PAYOUT_ACCOUNT_KEY) return env.PAYOUT_ACCOUNT_KEY;
  if (env.APP_ENV === 'local') return LOCAL_KEY;
  throw new AccountVaultUnavailable();
}

function derive(purpose: 'seal' | 'fingerprint'): Buffer {
  return Buffer.from(hkdfSync('sha256', rootKey(), 'medilink.payout-accounts', purpose, 32));
}

/** `v1.<iv>.<tag>.<ciphertext>`, each base64url. The version is there for the day the scheme changes. */
export function sealAccountNumber(accountNumber: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', derive('seal'), iv);
  const ciphertext = Buffer.concat([cipher.update(accountNumber, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

/** Throws if the value was not sealed with this key or has been altered: GCM authenticates what it opens. */
export function openAccountNumber(sealed: string): string {
  const [version, iv, tag, ciphertext] = sealed.split('.');
  if (version !== 'v1' || !iv || !tag || !ciphertext) throw new Error('Unrecognised sealed account number.');

  const decipher = createDecipheriv('aes-256-gcm', derive('seal'), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

/**
 * A keyed hash of the number, so the same account given by two people is found
 * without opening either. Of the number alone and not the bank's name: the same ten
 * digits under two spellings of a bank is what this is meant to catch, and the
 * occasional real coincidence between two banks is something a person can override.
 */
export function fingerprintAccount(accountNumber: string): string {
  return createHmac('sha256', derive('fingerprint')).update(accountNumber).digest('hex');
}
