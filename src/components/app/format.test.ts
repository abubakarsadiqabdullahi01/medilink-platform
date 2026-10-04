import { describe, expect, it } from 'vitest';
import { recordLabel } from './format';

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
