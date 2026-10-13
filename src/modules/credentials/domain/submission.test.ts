import { describe, expect, it } from 'vitest';
import {
  computeExpiresAt,
  holdsNin,
  isReferenceChecked,
  maskReference,
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
