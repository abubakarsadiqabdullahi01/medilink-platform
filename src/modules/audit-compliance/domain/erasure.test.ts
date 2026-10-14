import { describe, expect, it } from 'vitest';
import {
  ERASED_NAME,
  ERASURE_RETAINED,
  erasedFolio,
  erasedPhone,
  erasureOutcome,
} from './erasure';

const USER = '11111111-2222-4333-8444-555555555555';

describe('what an erased account is left holding', () => {
  it('has a name that names nobody', () => {
    expect(ERASED_NAME).toBe('Erased user');
  });

  it('has a phone value that is unique to it and cannot be dialled or registered', () => {
    expect(erasedPhone(USER)).toBe(`erased-${USER}`);
    expect(erasedPhone(USER)).not.toBe(erasedPhone('00000000-0000-4000-8000-000000000000'));
    expect(erasedPhone(USER)).not.toMatch(/^\+?\d+$/);
  });

  it('has a folio number that frees the real one for the register', () => {
    expect(erasedFolio('registration-row-1')).toBe('erased-registration-row-1');
  });
});

describe('what is kept, and why', () => {
  it('says so for each kind of record, so a person is told before they ask', () => {
    for (const row of ERASURE_RETAINED) {
      expect(row.area.length).toBeGreaterThan(3);
      expect(row.reason.length).toBeGreaterThan(30);
    }
  });

  it('keeps the audit trail and the money, which is what the product has always said', () => {
    const areas = ERASURE_RETAINED.map((row) => row.area);
    expect(areas).toContain('Audit trail');
    expect(areas).toContain('Invoices, ledger entries and payouts');
  });
});

describe('the outcome written on the request', () => {
  const report = {
    replaced: { account: 1, 'practitioner profile': 1 },
    deleted: { sessions: 3, 'notification messages': 12 },
    files: { deleted: 2, pending: 0 },
    retained: ERASURE_RETAINED,
  };

  it('says it was erased, on what date, and what was kept', () => {
    const text = erasureOutcome(report, new Date('2026-10-13T10:00:00Z'));
    expect(text).toContain('Erased on 13 October 2026');
    expect(text).toContain('Audit trail');
    expect(text).toContain('2 files deleted');
  });

  it('says plainly when files are still to be deleted', () => {
    const text = erasureOutcome({ ...report, files: { deleted: 1, pending: 1 } }, new Date('2026-10-13T10:00:00Z'));
    expect(text).toContain('1 file could not be deleted yet');
  });

  it('never names the person', () => {
    expect(erasureOutcome(report, new Date())).not.toMatch(/Quillfeather|\+234/);
  });
});
