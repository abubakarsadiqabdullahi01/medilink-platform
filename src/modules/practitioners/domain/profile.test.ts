import { describe, expect, it } from 'vitest';
import {
  BIO_MAX_LENGTH,
  YEARS_OF_EXPERIENCE_MAX,
  YEARS_OF_EXPERIENCE_MIN,
  isSpecialtyValidForCategory,
} from './profile';

describe('policy constants', () => {
  // Pinned so a silent edit to the policy is caught by review, not discovered
  // in production.
  it('holds the agreed bounds', () => {
    expect(YEARS_OF_EXPERIENCE_MIN).toBe(0);
    expect(YEARS_OF_EXPERIENCE_MAX).toBe(60);
    expect(BIO_MAX_LENGTH).toBe(1000);
  });
});

describe('isSpecialtyValidForCategory', () => {
  const doctor = '11111111-1111-1111-1111-111111111111';
  const nurse = '22222222-2222-2222-2222-222222222222';

  it('accepts no specialty chosen, regardless of category', () => {
    expect(isSpecialtyValidForCategory(null, doctor)).toBe(true);
  });

  it('accepts a specialty whose own category matches', () => {
    expect(isSpecialtyValidForCategory({ categoryId: doctor }, doctor)).toBe(true);
  });

  it('refuses a specialty from a different category', () => {
    expect(isSpecialtyValidForCategory({ categoryId: doctor }, nurse)).toBe(false);
  });
});
