import { describe, expect, it } from 'vitest';
import { isNigerianPhone, maskPhone, normalizeNigerianPhone, PhoneFormatError } from './phone';

/**
 * The phone number is the primary identifier, so every equivalent spelling of
 * one number must collapse to a single value. A gap here creates duplicate
 * practitioner accounts, which is a verification failure.
 */
describe('normalizeNigerianPhone', () => {
  it('collapses every common spelling of one number', () => {
    const expected = '+2348031234567';
    for (const input of [
      '08031234567',
      '0803 123 4567',
      '0803-123-4567',
      '+2348031234567',
      '+234 803 123 4567',
      '2348031234567',
      '8031234567',
      '(0803) 123.4567',
    ]) {
      expect(normalizeNigerianPhone(input)).toBe(expected);
    }
  });

  it('accepts numbers across the assigned mobile prefixes', () => {
    expect(normalizeNigerianPhone('07011111111')).toBe('+2347011111111');
    expect(normalizeNigerianPhone('09161111111')).toBe('+2349161111111');
    expect(normalizeNigerianPhone('08111111111')).toBe('+2348111111111');
  });

  it('rejects the wrong number of digits', () => {
    expect(() => normalizeNigerianPhone('080312345')).toThrow(PhoneFormatError);
    expect(() => normalizeNigerianPhone('080312345678')).toThrow(PhoneFormatError);
  });

  it('rejects an unassigned mobile prefix', () => {
    expect(() => normalizeNigerianPhone('01012345678')).toThrow(PhoneFormatError);
    expect(() => normalizeNigerianPhone('08501234567')).toThrow(PhoneFormatError);
  });

  it('rejects letters and empty input', () => {
    expect(() => normalizeNigerianPhone('0803123456a')).toThrow(PhoneFormatError);
    expect(() => normalizeNigerianPhone('')).toThrow(PhoneFormatError);
    expect(() => normalizeNigerianPhone('not a number')).toThrow(PhoneFormatError);
  });

  it('reports validity without throwing', () => {
    expect(isNigerianPhone('08031234567')).toBe(true);
    expect(isNigerianPhone('12345')).toBe(false);
  });

  it('masks the middle of a number for display', () => {
    const masked = maskPhone('+2348031234567');
    expect(masked).not.toContain('1234');
    expect(masked.startsWith('+234803')).toBe(true);
    expect(masked.endsWith('567')).toBe(true);
  });
});
