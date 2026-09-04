import { describe, expect, it } from 'vitest';
import { redact } from './audit';

describe('redact', () => {
  it('removes secret-bearing fields before they reach the audit table', () => {
    const result = redact({
      email: 'nurse@example.com',
      passwordHash: '$argon2id$abc',
      nested: { tokenHash: 'xyz', bank: { accountNumber: '0123456789', bankName: 'GTB' } },
    }) as Record<string, unknown>;

    expect(result.email).toBe('nurse@example.com');
    expect(result.passwordHash).toBe('[redacted]');
    expect((result.nested as Record<string, unknown>).tokenHash).toBe('[redacted]');
    const bank = (result.nested as Record<string, Record<string, unknown>>).bank!;
    expect(bank.accountNumber).toBe('[redacted]');
    expect(bank.bankName).toBe('GTB');
  });
});
