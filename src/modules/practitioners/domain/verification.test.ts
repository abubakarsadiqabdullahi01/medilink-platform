import { describe, expect, it } from 'vitest';
import {
  NinFormatError,
  hashNin,
  isEvidenceStale,
  isRegistrationUsable,
  ninLast4,
  ninMatches,
  normaliseFolioNumber,
  normaliseNin,
} from './verification';

const SECRET = 'test-session-secret-value-at-least-32-chars';
const NIN = '12345678901';
const NOW = new Date('2026-09-10T12:00:00.000Z');

describe('normaliseNin', () => {
  it('accepts eleven digits, however they were typed', () => {
    expect(normaliseNin('12345678901')).toBe(NIN);
    expect(normaliseNin('123 4567 8901')).toBe(NIN);
    expect(normaliseNin('123-4567-8901')).toBe(NIN);
  });

  it.each(['1234567890', '123456789012', '1234567890a', '', '   '])(
    'refuses %o',
    (input) => {
      expect(() => normaliseNin(input)).toThrow(NinFormatError);
    },
  );
});

describe('hashNin', () => {
  it('is stable for the same number and secret', () => {
    expect(hashNin(NIN, SECRET)).toBe(hashNin('123 4567 8901', SECRET));
  });

  it('differs under a different secret', () => {
    // The point of keying it: a leaked table is useless without the server
    // secret, where a bare SHA-256 of eleven digits is not.
    expect(hashNin(NIN, SECRET)).not.toBe(hashNin(NIN, 'a-different-secret-of-adequate-length'));
  });

  it('does not contain the number it hashed', () => {
    expect(hashNin(NIN, SECRET)).not.toContain(NIN);
  });

  it('matches constant-time against its own digest, and not another', () => {
    const stored = hashNin(NIN, SECRET);
    expect(ninMatches('123-4567-8901', stored, SECRET)).toBe(true);
    expect(ninMatches('99999999999', stored, SECRET)).toBe(false);
    expect(ninMatches(NIN, 'short', SECRET)).toBe(false);
  });
});

describe('ninLast4', () => {
  it('is what a reviewer quotes back without holding the number', () => {
    expect(ninLast4(NIN)).toBe('8901');
    expect(ninLast4('123 4567 8901')).toBe('8901');
  });
});

describe('normaliseFolioNumber', () => {
  it('makes inconsistently quoted folios comparable', () => {
    expect(normaliseFolioNumber(' mdcn/r/ 12345 ')).toBe('MDCN/R/12345');
    expect(normaliseFolioNumber('MDCN/R/12345')).toBe('MDCN/R/12345');
  });
});

describe('isEvidenceStale', () => {
  it('treats a missing date as stale', () => {
    // Evidence without a date cannot be judged at all.
    expect(isEvidenceStale(null, 365, NOW)).toBe(true);
    expect(isEvidenceStale(undefined, 365, NOW)).toBe(true);
  });

  it('accepts evidence inside the review period', () => {
    expect(isEvidenceStale(new Date('2026-06-10T12:00:00.000Z'), 365, NOW)).toBe(false);
  });

  it('flags evidence older than the review period', () => {
    expect(isEvidenceStale(new Date('2024-01-01T00:00:00.000Z'), 365, NOW)).toBe(true);
  });

  it('is inclusive at the boundary', () => {
    // Exactly a year old, on a one-year period, has expired — not "about to".
    const exactlyOneYear = new Date('2025-09-10T12:00:00.000Z');
    expect(isEvidenceStale(exactlyOneYear, 365, NOW)).toBe(true);
  });

  it('respects a shorter review period', () => {
    const thirtyOneDaysAgo = new Date('2026-08-10T12:00:00.000Z');
    expect(isEvidenceStale(thirtyOneDaysAgo, 30, NOW)).toBe(true);
    expect(isEvidenceStale(thirtyOneDaysAgo, 90, NOW)).toBe(false);
  });
});

describe('isRegistrationUsable', () => {
  const active = {
    registrationStatus: 'ACTIVE' as const,
    expiresAt: new Date('2027-01-01T00:00:00.000Z'),
    deletedAt: null,
  };

  it('accepts an active registration that has not expired', () => {
    expect(isRegistrationUsable(active, NOW)).toBe(true);
  });

  it('accepts an active registration with no expiry', () => {
    expect(isRegistrationUsable({ ...active, expiresAt: null }, NOW)).toBe(true);
  });

  it.each(['SUSPENDED', 'EXPIRED', 'STRUCK_OFF'] as const)('refuses a %s registration', (status) => {
    expect(isRegistrationUsable({ ...active, registrationStatus: status }, NOW)).toBe(false);
  });

  it('refuses UNKNOWN rather than treating it as good news', () => {
    // The regulator was unreachable or unreadable. Defaulting that to "fine"
    // is precisely the failure verification exists to prevent.
    expect(isRegistrationUsable({ ...active, registrationStatus: 'UNKNOWN' }, NOW)).toBe(false);
  });

  it('refuses an active registration whose licence has lapsed', () => {
    expect(
      isRegistrationUsable({ ...active, expiresAt: new Date('2026-09-09T00:00:00.000Z') }, NOW),
    ).toBe(false);
  });

  it('refuses a missing or deleted registration', () => {
    expect(isRegistrationUsable(null, NOW)).toBe(false);
    expect(isRegistrationUsable({ ...active, deletedAt: new Date() }, NOW)).toBe(false);
  });
});
