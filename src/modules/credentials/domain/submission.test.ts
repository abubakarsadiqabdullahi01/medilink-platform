import { describe, expect, it } from 'vitest';
import {
  computeExpiresAt,
  expiryFor,
  holdsNin,
  isReferenceChecked,
  maskReference,
  printedExpiryProblem,
  requiredEvidenceFor,
} from './submission';

describe('requiredEvidenceFor', () => {
  it('requires a reference number for methods with an external verification API', () => {
    expect(requiredEvidenceFor('nimc_verification')).toBe('reference_number');
    expect(requiredEvidenceFor('mdcn_status_check')).toBe('reference_number');
  });

  it('requires a document for manual review', () => {
    expect(requiredEvidenceFor('document_review')).toBe('document');
  });

  it('defaults an unrecognised method to document — a human can always read one', () => {
    expect(requiredEvidenceFor('some_future_method')).toBe('document');
  });
});

describe('computeExpiresAt', () => {
  const from = new Date('2026-01-01T00:00:00.000Z');

  it('returns null when the credential type never expires', () => {
    expect(computeExpiresAt({ expires: false, reviewDays: 365 }, from)).toBeNull();
  });

  it('adds reviewDays to the given date when it does expire', () => {
    expect(computeExpiresAt({ expires: true, reviewDays: 365 }, from)).toEqual(
      new Date('2027-01-01T00:00:00.000Z'),
    );
    expect(computeExpiresAt({ expires: true, reviewDays: 3650 }, from)).toEqual(
      new Date('2035-12-30T00:00:00.000Z'),
    );
  });
});

describe('isReferenceChecked / holdsNin', () => {
  it('knows which credentials are checked against a record by number', () => {
    expect(isReferenceChecked('nimc_verification')).toBe(true);
    expect(isReferenceChecked('mdcn_status_check')).toBe(true);
    expect(isReferenceChecked('document_review')).toBe(false);
  });

  it('treats only a NIN as sensitive: a licence number is public on the register', () => {
    expect(holdsNin('nimc_verification')).toBe(true);
    expect(holdsNin('mdcn_status_check')).toBe(false);
    expect(holdsNin('document_review')).toBe(false);
  });
});

describe('maskReference', () => {
  it('keeps the last four digits and hides the rest', () => {
    expect(maskReference('99000000022')).toBe('*******0022');
  });

  it('is stable on something already masked, so masking twice changes nothing', () => {
    expect(maskReference('*******0022')).toBe('*******0022');
  });

  it('never grows or shrinks what it is given', () => {
    expect(maskReference('12345678901')).toHaveLength(11);
    expect(maskReference('123')).toBe('123');
  });
});

/**
 * CRE-04: a credential's expiry was the review date plus the type's review days,
 * so a practitioner was shown a date that appears nowhere on their document.
 * The date printed on it is the one that governs.
 */
describe('printed expiry', () => {
  const now = new Date('2026-10-14T10:00:00.000Z');
  const annual = { expires: true, reviewDays: 365 };
  const lifelong = { expires: false, reviewDays: 0 };

  describe('what the expiry becomes', () => {
    it('is the end of the printed day in Lagos, because a licence is valid through the date on it', () => {
      const result = expiryFor(annual, now, '2027-03-31');

      expect(result.documentExpiresOn).toBe('2027-03-31');
      // 00:00 on 1 April in Lagos is 23:00 UTC on 31 March.
      expect(result.expiresAt?.toISOString()).toBe('2027-03-31T23:00:00.000Z');
    });

    it('is not shortened by the type\'s review days when the document says later', () => {
      const result = expiryFor(annual, now, '2030-01-01');

      expect(result.expiresAt!.getTime()).toBeGreaterThan(computeExpiresAt(annual, now)!.getTime());
    });

    it('falls back to the review interval when no date was read, and says it did not come from the document', () => {
      const result = expiryFor(annual, now, undefined);

      expect(result.documentExpiresOn).toBeNull();
      expect(result.expiresAt).toEqual(computeExpiresAt(annual, now));
    });

    it('is nothing for a credential that never expires', () => {
      expect(expiryFor(lifelong, now, undefined)).toEqual({ expiresAt: null, documentExpiresOn: null });
    });
  });

  describe('what is refused', () => {
    it('accepts a date that is today in Lagos: valid through today', () => {
      expect(printedExpiryProblem(annual, '2026-10-14', now)).toBeNull();
    });

    it('refuses a date that has passed: an expired document is not one to verify', () => {
      expect(printedExpiryProblem(annual, '2026-10-13', now)).toBe('past');
    });

    it('counts today by Lagos, not UTC, either side of midnight', () => {
      // 00:30 in Lagos on the 15th is 23:30 UTC on the 14th.
      const justAfterMidnight = new Date('2026-10-14T23:30:00.000Z');

      expect(printedExpiryProblem(annual, '2026-10-14', justAfterMidnight)).toBe('past');
      expect(printedExpiryProblem(annual, '2026-10-15', justAfterMidnight)).toBeNull();
    });

    it('refuses a date so far ahead that it is nearly always a typo', () => {
      expect(printedExpiryProblem(annual, '2062-03-31', now)).toBe('too_far');
      expect(printedExpiryProblem(annual, '2036-03-31', now)).toBeNull();
    });

    it('refuses a date for a credential that does not expire', () => {
      expect(printedExpiryProblem(lifelong, '2027-03-31', now)).toBe('not_applicable');
    });

    it('refuses something that is not a real date', () => {
      for (const bad of ['31/03/2027', '2027-13-01', '2027-02-30', 'next year', '']) {
        expect(printedExpiryProblem(annual, bad, now), bad).toBe('format');
      }
    });

    it('has no complaint when no date was given', () => {
      expect(printedExpiryProblem(annual, undefined, now)).toBeNull();
      expect(printedExpiryProblem(lifelong, undefined, now)).toBeNull();
    });
  });
});
