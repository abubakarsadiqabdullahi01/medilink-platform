import { describe, expect, it } from 'vitest';
import { phoneProblem } from './phone-problem';

describe('phoneProblem', () => {
  it('accepts the forms people actually type', () => {
    expect(phoneProblem('0803 123 4567')).toBeUndefined();
    expect(phoneProblem('+2348031234567')).toBeUndefined();
    expect(phoneProblem('2348031234567')).toBeUndefined();
  });

  it('asks for a number when there is none', () => {
    expect(phoneProblem('')).toBe('Enter their phone number.');
    expect(phoneProblem('   ')).toBe('Enter their phone number.');
  });

  it('gives an example when it is not a Nigerian mobile number', () => {
    expect(phoneProblem('hello')).toContain('0803 123 4567');
    expect(phoneProblem('0803 123')).toContain('0803 123 4567');
  });

  it('says the prefix is the problem when only that is wrong', () => {
    expect(phoneProblem('0600 123 4567')).toContain('prefix');
  });
});
