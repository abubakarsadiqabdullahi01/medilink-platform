import { describe, expect, it } from 'vitest';
import { isAuthorized, type Grant } from './guard';

/**
 * Stage 4.3 and 4.4 in test form: holding the role is not enough, and a grant
 * in one facility must not reach another.
 */
const facilityA = '11111111-1111-1111-1111-111111111111';
const facilityB = '22222222-2222-2222-2222-222222222222';
const branchA1 = '33333333-3333-3333-3333-333333333333';

describe('isAuthorized', () => {
  it('refuses a user with no matching permission', () => {
    const grants: Grant[] = [{ permission: 'facility.read', scopeType: 'FACILITY', scopeId: facilityA }];
    expect(isAuthorized(grants, 'facility.write', { type: 'FACILITY', id: facilityA })).toBe(false);
  });

  it('allows the permission within its own scope', () => {
    const grants: Grant[] = [{ permission: 'facility.read', scopeType: 'FACILITY', scopeId: facilityA }];
    expect(isAuthorized(grants, 'facility.read', { type: 'FACILITY', id: facilityA })).toBe(true);
  });

  it('refuses the same permission in another facility', () => {
    const grants: Grant[] = [{ permission: 'facility.read', scopeType: 'FACILITY', scopeId: facilityA }];
    expect(isAuthorized(grants, 'facility.read', { type: 'FACILITY', id: facilityB })).toBe(false);
  });

  it('lets a facility-scoped grant reach a branch of that facility', () => {
    const grants: Grant[] = [{ permission: 'facility.read', scopeType: 'FACILITY', scopeId: facilityA }];
    const requested = {
      type: 'BRANCH' as const,
      id: branchA1,
      ancestors: [{ type: 'FACILITY' as const, id: facilityA }],
    };
    expect(isAuthorized(grants, 'facility.read', requested)).toBe(true);
  });

  it('does not let a branch-scoped grant reach the whole facility', () => {
    const grants: Grant[] = [{ permission: 'facility.read', scopeType: 'BRANCH', scopeId: branchA1 }];
    expect(isAuthorized(grants, 'facility.read', { type: 'FACILITY', id: facilityA })).toBe(false);
  });

  it('honours a platform-wide grant', () => {
    const grants: Grant[] = [{ permission: 'audit.read', scopeType: 'PLATFORM', scopeId: null }];
    expect(isAuthorized(grants, 'audit.read', { type: 'FACILITY', id: facilityB })).toBe(true);
  });

  it('scopes SELF to the acting user only', () => {
    const me = '44444444-4444-4444-4444-444444444444';
    const someoneElse = '55555555-5555-5555-5555-555555555555';
    const grants: Grant[] = [{ permission: 'practitioner.profile.write', scopeType: 'SELF', scopeId: me }];
    expect(isAuthorized(grants, 'practitioner.profile.write', { type: 'SELF', id: me }, me)).toBe(true);
    expect(
      isAuthorized(grants, 'practitioner.profile.write', { type: 'SELF', id: someoneElse }, me),
    ).toBe(false);
  });
});
