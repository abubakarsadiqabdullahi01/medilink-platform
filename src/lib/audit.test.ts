import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Tx } from './db';
import { logger } from './logger';
import { recordAudit, redact, scrubText } from './audit';

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

/**
 * M17-07: a mandatory record is never lost silently.
 *
 * Every audit row is written in the transaction of the act it records, so a write that fails
 * takes the act with it; that is what stops a record being lost. What was missing was that
 * it said so: the failure surfaced as whatever the caller's own error handler made of a
 * rolled-back transaction, with nothing to tell an audit failure from any other. And nothing
 * stopped a future call being left un-awaited, which would let the act commit and the row fail
 * after the response had gone.
 */
describe('a write that fails', () => {
  afterEach(() => vi.restoreAllMocks());

  const failing = (error: Error) => ({ auditLog: { create: vi.fn().mockRejectedValue(error) } }) as unknown as Tx;

  it('is not swallowed: the act it belongs to fails with it', async () => {
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    const failure = new Error('connection terminated');

    await expect(
      recordAudit(failing(failure), { action: 'user.suspended', entityType: 'identity.users' }),
    ).rejects.toBe(failure);
  });

  it('is logged as an audit failure, by action and entity, so an alert can key on it', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const failure = Object.assign(new Error('boom'), { name: 'PrismaClientKnownRequestError', code: 'P2028' });

    await expect(
      recordAudit(failing(failure), {
        action: 'timesheet.approved',
        entityType: 'timesheets.timesheets',
        entityId: '5c0ad8a4-1111-4222-8333-444455556666',
        actorId: '9a1c0f10-aaaa-4bbb-8ccc-ddddeeeeffff',
      }),
    ).rejects.toThrow();

    expect(error).toHaveBeenCalledTimes(1);
    const [message, context] = error.mock.calls[0]!;
    expect(message).toMatch(/audit write failed/i);
    expect(context).toMatchObject({
      event: 'audit_write_failed',
      action: 'timesheet.approved',
      entityType: 'timesheets.timesheets',
      entityId: '5c0ad8a4-1111-4222-8333-444455556666',
      errorName: 'PrismaClientKnownRequestError',
      errorCode: 'P2028',
    });
  });

  it('logs nothing of what the row held: a database error can quote the values it was given', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const failure = new Error('Invalid `prisma.auditLog.create()` invocation: reason: "Called 0803 123 4567"');

    await expect(
      recordAudit(failing(failure), {
        action: 'practitioner.sanctioned',
        entityType: 'practitioners.sanctions',
        reason: 'Called 0803 123 4567 about Amina Yusuf',
        before: { fullName: 'Amina Yusuf' },
        after: { contactEmail: 'amina@example.com' },
      }),
    ).rejects.toThrow();

    const logged = JSON.stringify(error.mock.calls[0]);
    expect(logged).not.toMatch(/0803|Amina|amina@|Invalid `prisma|invocation/);
  });
});

describe('every call to recordAudit', () => {
  /** All .ts and .tsx sources under src, tests excluded. */
  function sources(directory: string): string[] {
    return readdirSync(directory).flatMap((entry) => {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) return sources(path);
      return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [path] : [];
    });
  }

  it('is awaited or returned, so a failed write can never come after the act has committed', () => {
    const loose: string[] = [];

    for (const file of sources(join(process.cwd(), 'src'))) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          if (!/\brecordAudit\(/.test(line)) return;
          if (/^\s*(export\s+)?(async\s+)?function\s+recordAudit\b/.test(line)) return;
          if (/^\s*(\/\/|\*)/.test(line)) return;
          if (!/(await|return)\s+recordAudit\(/.test(line)) loose.push(`${file}:${index + 1}: ${line.trim()}`);
        });
    }

    expect(loose).toEqual([]);
  });
});
