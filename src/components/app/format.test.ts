import { describe, expect, it } from 'vitest';
import {
  expiryOf,
  formatClock,
  formatDate,
  formatNaira,
  formatNairaTight,
  formatShiftWindow,
  parseNairaToKobo,
  recordLabel,
} from './format';

describe('recordLabel', () => {
  it('turns the tables the audit trail actually writes into nouns', () => {
    // Every entityType `recordAudit` is called with, so a table renamed or a
    // module added shows up here rather than as "Facilitie" on the screen.
    expect(recordLabel('facilities.facilities')).toBe('Facility');
    expect(recordLabel('identity.users')).toBe('User');
    expect(recordLabel('identity.sessions')).toBe('Session');
    expect(recordLabel('practitioners.professional_registrations')).toBe(
      'Professional registration',
    );
    expect(recordLabel('practitioners.identity_verifications')).toBe('Identity verification');
    expect(recordLabel('consent.data_subject_requests')).toBe('Data subject request');
    expect(recordLabel('cancellations_sanctions.unhonoured_assignments')).toBe(
      'Unhonoured assignment',
    );
    expect(recordLabel('clinical.clinical_incidents')).toBe('Clinical incident');
    expect(recordLabel('credentials.credential_submissions')).toBe('Credential submission');
    expect(recordLabel('matching.assignments')).toBe('Assignment');
  });

  it('handles the -es plurals', () => {
    expect(recordLabel('billing.addresses')).toBe('Address');
    expect(recordLabel('config.lgas')).toBe('Lga');
    expect(recordLabel('config.states')).toBe('State');
  });

  // The rule is three lines of English and gets a singular noun that happens
  // to end in "s" wrong — `status` would come back as "Statu". No table in
  // the schema is named that way, and the case above is what keeps it true:
  // it lists every entityType actually written, so a table that would break
  // the rule fails there rather than appearing mangled on the screen.

  it('says something rather than nothing when the row carries no type', () => {
    expect(recordLabel(null)).toBe('Record');
    expect(recordLabel('')).toBe('Record');
  });
});

describe('expiryOf', () => {
  it('shows the date printed on the document, as that date', () => {
    const result = expiryOf({ expiresAt: '2027-03-31T23:00:00.000Z', documentExpiresOn: '2027-03-31' });

    expect(result).toEqual({ date: formatDate('2027-03-31'), fromDocument: true, text: formatDate('2027-03-31') });
    expect(result?.text).toContain('31');
    expect(result?.text).toContain('Mar');
  });

  it('does not let the instant the credential ends push the printed day forward', () => {
    // 23:00 UTC on the 31st is midnight in Lagos: the next day. The printed date is the 31st.
    expect(expiryOf({ expiresAt: '2027-03-31T23:00:00.000Z', documentExpiresOn: '2027-03-31' })?.text).toMatch(/^31 Mar/);
  });

  it('says an estimate is one, when no date was read', () => {
    const result = expiryOf({ expiresAt: '2027-10-14T10:00:00.000Z', documentExpiresOn: null });

    expect(result?.fromDocument).toBe(false);
    expect(result?.text).toMatch(/estimate/i);
  });

  it('has nothing to say for a credential that does not expire', () => {
    expect(expiryOf({ expiresAt: null, documentExpiresOn: null })).toBeNull();
  });
});

describe('parseNairaToKobo', () => {
  it('reads an amount as people write it', () => {
    expect(parseNairaToKobo('40000')).toBe(4_000_000);
    expect(parseNairaToKobo('40,000')).toBe(4_000_000);
    expect(parseNairaToKobo('₦40,000.00')).toBe(4_000_000);
    expect(parseNairaToKobo(' 40 000 ')).toBe(4_000_000);
  });

  it('keeps the kobo exactly, with no floating-point drift', () => {
    expect(parseNairaToKobo('40,000.10')).toBe(4_000_010);
    expect(parseNairaToKobo('0.07')).toBe(7);
    expect(parseNairaToKobo('1.5')).toBe(150);
    expect(parseNairaToKobo('19.99')).toBe(1_999);
  });

  it('refuses what is not an amount, or has money that does not exist', () => {
    for (const bad of ['', 'abc', '-5', '1.234', '1.2.3', '12e3', '₦']) {
      expect(parseNairaToKobo(bad), bad).toBeNull();
    }
  });
});

describe('formatNairaTight', () => {
  it('drops the kobo only when there are none, and never rounds', () => {
    expect(formatNairaTight(4_800_000)).toBe('₦48,000');
    expect(formatNairaTight(4_800_050)).toBe('₦48,000.50');
    expect(formatNairaTight(0)).toBe('₦0');
    expect(formatNairaTight(null)).toBe('—');
    // The exact figure is always recoverable: tight and full agree on the value.
    expect(formatNaira(4_800_050)).toContain('48,000.50');
  });
});

describe('formatShiftWindow', () => {
  it('writes a day shift as one day, in Lagos time', () => {
    // 08:00–20:00 WAT is 07:00–19:00 UTC.
    expect(formatShiftWindow('2026-10-21T07:00:00Z', '2026-10-21T19:00:00Z')).toBe('Wed, 21 Oct · 08:00–20:00');
  });

  it('writes a night shift with both days, so it does not appear to end before it starts', () => {
    // 20:00 WAT Wed to 08:00 WAT Thu.
    expect(formatShiftWindow('2026-10-21T19:00:00Z', '2026-10-22T07:00:00Z')).toBe(
      'Wed, 21 Oct 20:00 – Thu, 22 Oct 08:00',
    );
  });

  it('puts a shift at 00:30 WAT on its own day, not the day before in UTC', () => {
    expect(formatShiftWindow('2026-10-20T23:30:00Z', '2026-10-21T07:30:00Z')).toBe('Wed, 21 Oct · 00:30–08:30');
  });

  it('is a dash for nothing, and the clock is a clock', () => {
    expect(formatShiftWindow(null, null)).toBe('—');
    expect(formatClock('2026-10-21T13:45:00Z')).toBe('14:45');
  });
});
