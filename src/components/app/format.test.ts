import { describe, expect, it } from 'vitest';
import {
  cleanMoneyInput,
  expiryOf,
  formatDate,
  formatNaira,
  groupMoneyInput,
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

describe('formatNaira', () => {
  it('prints whole naira without kobo', () => {
    expect(formatNaira(1_050_000)).toBe('₦10,500');
    expect(formatNaira(0)).toBe('₦0');
    expect(formatNaira(500_000)).toBe('₦5,000');
  });

  it('keeps both digits whenever there are kobo, so a column of amounts still lines up', () => {
    expect(formatNaira(1_050_050)).toBe('₦10,500.50');
    expect(formatNaira(1_999)).toBe('₦19.99');
    expect(formatNaira(7)).toBe('₦0.07');
  });

  it('says there is nothing, not zero, when there is no amount', () => {
    expect(formatNaira(null)).toBe('—');
    expect(formatNaira(undefined)).toBe('—');
  });
});

describe('the amount box', () => {
  it('cleans what was typed to digits and at most two decimals', () => {
    expect(cleanMoneyInput('₦40,000')).toBe('40000');
    expect(cleanMoneyInput('40,000.505')).toBe('40000.50');
    expect(cleanMoneyInput('12.3.4')).toBe('12.34');
    expect(cleanMoneyInput('abc')).toBe('');
    expect(cleanMoneyInput('.5')).toBe('.5');
  });

  it('shows thousands separators when it is not being typed in', () => {
    expect(groupMoneyInput('500000')).toBe('500,000');
    expect(groupMoneyInput('1234567.5')).toBe('1,234,567.5');
    expect(groupMoneyInput('999')).toBe('999');
    expect(groupMoneyInput('')).toBe('');
    expect(groupMoneyInput('.5')).toBe('.5');
  });

  it('reads back, through parseNairaToKobo, to the amount that was typed', () => {
    expect(parseNairaToKobo(cleanMoneyInput('₦ 1,050.50'))).toBe(105_050);
    expect(parseNairaToKobo(groupMoneyInput('500000'))).toBe(50_000_000);
  });
});
