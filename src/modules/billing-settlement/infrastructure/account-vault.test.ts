import { describe, expect, it } from 'vitest';
import { fingerprintAccount, openAccountNumber, sealAccountNumber } from './account-vault';

describe('sealing an account number', () => {
  it('gives it back exactly', () => {
    expect(openAccountNumber(sealAccountNumber('0123456789'))).toBe('0123456789');
  });

  it('does not contain the number, or its last four, in what is stored', () => {
    const sealed = sealAccountNumber('0123456789');

    expect(sealed).not.toContain('0123456789');
    expect(sealed).not.toContain('6789');
  });

  it('seals the same number differently each time, so two equal accounts cannot be spotted in the table', () => {
    expect(sealAccountNumber('0123456789')).not.toBe(sealAccountNumber('0123456789'));
  });

  it('refuses a value that has been altered, rather than returning a wrong number', () => {
    const [version, iv, tag, ciphertext] = sealAccountNumber('0123456789').split('.');
    const flipped = Buffer.from(ciphertext!, 'base64url');
    flipped[0] = flipped[0]! ^ 0xff;

    expect(() => openAccountNumber([version, iv, tag, flipped.toString('base64url')].join('.'))).toThrow();
  });

  it('refuses a value that is not one of ours', () => {
    expect(() => openAccountNumber('0123456789')).toThrow();
    expect(() => openAccountNumber('v2.a.b.c')).toThrow();
  });
});

describe('fingerprinting an account number', () => {
  it('is the same for the same number and different for another', () => {
    expect(fingerprintAccount('0123456789')).toBe(fingerprintAccount('0123456789'));
    expect(fingerprintAccount('0123456789')).not.toBe(fingerprintAccount('0123456780'));
  });

  it('is not the number', () => {
    expect(fingerprintAccount('0123456789')).not.toContain('0123456789');
  });
});
