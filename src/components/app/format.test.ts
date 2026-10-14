import { describe, expect, it } from 'vitest';
import { expiryOf, formatDate, recordLabel } from './format';

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
