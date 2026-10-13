import { describe, expect, it } from 'vitest';
import {
  REGISTRATION_KINDS,
  approvalBlockers,
  canPublish,
  normaliseCacNumber,
  normaliseRegistrationReference,
  publishBlockers,
  registrationReferenceProblem,
} from './facility';

const base = {
  status: 'VERIFIED' as const,
  deletedAt: null,
  licenceExpiresAt: null,
};

const NOW = new Date('2026-09-10T12:00:00.000Z');

describe('publishBlockers', () => {
  it('lets a verified facility with no licence expiry publish', () => {
    expect(publishBlockers(base, NOW)).toEqual([]);
    expect(canPublish(base, NOW)).toBe(true);
  });

  it.each(['PENDING', 'REJECTED'] as const)('blocks a %s facility as unverified', (status) => {
    expect(publishBlockers({ ...base, status }, NOW)).toEqual(['not_verified']);
  });

  it('reports a suspended facility as suspended, not as unverified', () => {
    // It was verified once. Calling it unverified would misdescribe why it
    // stopped, and would send an administrator to the wrong remedy.
    expect(publishBlockers({ ...base, status: 'SUSPENDED' }, NOW)).toEqual(['suspended']);
  });

  it('blocks a soft-deleted facility', () => {
    const blockers = publishBlockers({ ...base, deletedAt: new Date('2026-01-01') }, NOW);
    expect(blockers).toContain('deleted');
    expect(canPublish({ ...base, deletedAt: new Date('2026-01-01') }, NOW)).toBe(false);
  });

  it('blocks a verified facility whose licence has lapsed', () => {
    const lapsed = { ...base, licenceExpiresAt: new Date('2026-09-09T12:00:00.000Z') };
    expect(publishBlockers(lapsed, NOW)).toEqual(['licence_expired']);
    expect(canPublish(lapsed, NOW)).toBe(false);
  });

  it('treats expiry as inclusive: the instant it expires, it is expired', () => {
    expect(publishBlockers({ ...base, licenceExpiresAt: NOW }, NOW)).toEqual(['licence_expired']);
  });

  it('allows a licence expiring in the future', () => {
    const future = { ...base, licenceExpiresAt: new Date('2027-01-01T00:00:00.000Z') };
    expect(canPublish(future, NOW)).toBe(true);
  });

  it('reports every reason at once, not just the first', () => {
    const doomed = {
      status: 'PENDING' as const,
      deletedAt: new Date('2026-01-01'),
      licenceExpiresAt: new Date('2026-01-01'),
    };
    // An administrator fixing one problem should not have to resubmit to
    // discover the next one.
    expect(publishBlockers(doomed, NOW)).toEqual(['deleted', 'not_verified', 'licence_expired']);
  });
});

describe('normaliseCacNumber', () => {
  it('uppercases and strips whitespace so the unique constraint means what it says', () => {
    expect(normaliseCacNumber(' rc 123456 ')).toBe('RC123456');
    expect(normaliseCacNumber('RC123456')).toBe('RC123456');
  });

  it('treats the punctuation people type inside a number as nothing', () => {
    // Somebody squatting another hospital's registration only has to spell it differently.
    for (const variant of ['RC-123456', 'rc/123456', 'R.C. 123456', 'RC 123 456']) {
      expect(normaliseCacNumber(variant)).toBe('RC123456');
    }
  });

  it('leaves an already-normal number alone', () => {
    expect(normaliseCacNumber('BN0099887')).toBe('BN0099887');
  });
});

describe('registration references (FAC-05, UXF-02)', () => {
  // Government hospitals and primary health centres, most of the facilities in
  // Gombe, have no CAC number and could not register truthfully.

  it('knows the three kinds of registration', () => {
    expect(REGISTRATION_KINDS).toEqual(['CAC', 'GOVERNMENT', 'OTHER']);
  });

  it('normalises a CAC number exactly as before', () => {
    expect(normaliseRegistrationReference('CAC', ' rc-123 456 ')).toBe('RC123456');
  });

  it('keeps the punctuation in a government reference, which is part of what it says', () => {
    expect(normaliseRegistrationReference('GOVERNMENT', '  fmoh/phc/gom/0042 ')).toBe('FMOH/PHC/GOM/0042');
  });

  it('collapses the spaces in a reference that is not a CAC number', () => {
    expect(normaliseRegistrationReference('OTHER', 'Mission   Board  2021 / 114')).toBe('MISSION BOARD 2021 / 114');
  });

  it('holds a CAC number to the shape of one', () => {
    expect(registrationReferenceProblem('CAC', 'RC123456')).toBeNull();
    // Slashes are stripped when a CAC number is normalised, so a value that still has them is not one.
    expect(registrationReferenceProblem('CAC', 'FMOH/PHC/0042')).not.toBeNull();
    expect(registrationReferenceProblem('CAC', 'NOT A CAC NUMBER!')).not.toBeNull();
  });

  it('asks only that another kind of reference is there and long enough to mean something', () => {
    expect(registrationReferenceProblem('GOVERNMENT', 'FMOH/PHC/GOM/0042')).toBeNull();
    expect(registrationReferenceProblem('GOVERNMENT', 'AB')).not.toBeNull();
    expect(registrationReferenceProblem('OTHER', 'x'.repeat(100))).not.toBeNull();
  });
});

describe('what has to be on file before a facility is approved (UXO-02)', () => {
  const onFile = { licenceObjectKey: 'facility-licence/f1/licence.pdf', licenceNumber: 'LIC/2026/114' };
  const allChecked = {
    licenceDocumentSeen: true,
    licenceMatchesFacility: true,
    registrationChecked: true,
    checkedWith: 'Phoned the state ministry; reference confirmed by the records office.',
  };

  it('is clear with the evidence on file and every check made', () => {
    expect(approvalBlockers(onFile, allChecked)).toEqual([]);
  });

  it('names every missing thing at once, not the first', () => {
    expect(approvalBlockers({ licenceObjectKey: null, licenceNumber: null }, undefined)).toEqual([
      'no_licence_document',
      'no_licence_number',
      'checks_incomplete',
    ]);
  });

  it.each(['licenceDocumentSeen', 'licenceMatchesFacility', 'registrationChecked'] as const)(
    'will not approve unless %s is confirmed',
    (check) => {
      expect(approvalBlockers(onFile, { ...allChecked, [check]: false })).toEqual(['checks_incomplete']);
    },
  );

  it('wants to know how the registration was checked, in words', () => {
    expect(approvalBlockers(onFile, { ...allChecked, checkedWith: '  ' })).toEqual(['checked_with_missing']);
    expect(approvalBlockers(onFile, { ...allChecked, checkedWith: 'ok' })).toEqual(['checked_with_missing']);
  });
});
