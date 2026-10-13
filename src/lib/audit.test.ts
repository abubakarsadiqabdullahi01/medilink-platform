import { describe, expect, it } from 'vitest';
import { redact, scrubText } from './audit';

describe('redact', () => {
  it('removes secret-bearing fields before they reach the audit table', () => {
    const result = redact({
      passwordHash: '$argon2id$abc',
      nested: { tokenHash: 'xyz', bank: { accountNumber: '0123456789', bankName: 'GTB' } },
    }) as Record<string, unknown>;

    expect(result.passwordHash).toBe('[redacted]');
    expect((result.nested as Record<string, unknown>).tokenHash).toBe('[redacted]');
    const bank = (result.nested as Record<string, Record<string, unknown>>).bank!;
    expect(bank.accountNumber).toBe('[redacted]');
    expect(bank.bankName).toBe('GTB');
  });

  /**
   * AUD-02. An audit row is kept for good, so whatever personal data it holds
   * outlives the person's right to have it erased. A name or an email in one is
   * a record erasure cannot reach.
   */
  describe('personal data', () => {
    it.each(['fullName', 'email', 'contactEmail', 'contactPhone', 'dateOfBirth', 'addressLine'])(
      'does not keep %s',
      (key) => {
        const result = redact({ [key]: 'a value that identifies somebody' }) as Record<string, unknown>;
        expect(result[key]).toBe('[redacted]');
      },
    );

    it('does not keep them nested, or in lists', () => {
      const result = redact({
        before: { contactEmail: 'ops@hospital.example' },
        people: [{ fullName: 'Amina Yusuf' }],
      }) as { before: Record<string, unknown>; people: Record<string, unknown>[] };

      expect(result.before.contactEmail).toBe('[redacted]');
      expect(result.people[0]!.fullName).toBe('[redacted]');
    });

    it('leaves what is not personal alone', () => {
      expect(redact({ name: 'Kano Teaching Hospital', status: 'VERIFIED', amountKobo: 4_000_000 })).toEqual({
        name: 'Kano Teaching Hospital',
        status: 'VERIFIED',
        amountKobo: 4_000_000,
      });
    });

    it('finds an email address wherever it was put, whatever the key is called', () => {
      const result = redact({ note: 'Send it to amina.yusuf@example.org please' }) as Record<string, unknown>;
      expect(result.note).toBe('Send it to [email] please');
    });

    it.each([
      ['+2348031234567', '[phone]'],
      ['08031234567', '[phone]'],
      ['0803 123 4567', '[phone]'],
      ['+234 803 123 4567', '[phone]'],
      ['+234-803-123-4567', '[phone]'],
    ])('finds a phone number written as %s', (written, replaced) => {
      expect(scrubText(`Call ${written} after nine`)).toBe(`Call ${replaced} after nine`);
    });

    it('leaves a masked number as it is, since that is what call sites are asked to write', () => {
      expect(scrubText('+234803***4567')).toBe('+234803***4567');
    });

    it('leaves figures that only look like a number', () => {
      expect(scrubText('Amount 4000000 kobo, 08:00 to 16:00, invoice INV-2026-ABC123')).toBe(
        'Amount 4000000 kobo, 08:00 to 16:00, invoice INV-2026-ABC123',
      );
      expect(scrubText('2026-09-09T07:00:00.000Z')).toBe('2026-09-09T07:00:00.000Z');
    });

    it('passes through values that are not text', () => {
      expect(redact({ n: 3, flag: true, nothing: null })).toEqual({ n: 3, flag: true, nothing: null });
    });
  });
});
