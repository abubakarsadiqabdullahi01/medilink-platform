import { describe, expect, it } from 'vitest';
import { computeExpiresAt, requiredEvidenceFor } from './submission';

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
