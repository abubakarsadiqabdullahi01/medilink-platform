import { describe, expect, it } from 'vitest';
import { canPublish, normaliseCacNumber, publishBlockers } from './facility';

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

  it('leaves an already-normal number alone', () => {
    expect(normaliseCacNumber('BN0099887')).toBe('BN0099887');
  });
});
