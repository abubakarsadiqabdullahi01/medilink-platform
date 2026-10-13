import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', async () => {
  const { cookieJar } = await import('./support/cookie-jar');
  return { cookies: () => cookieJar };
});

import { ROLE_PERMISSIONS } from '@/lib/authz/permissions';
import { GET as findGrantee } from '@/app/api/v1/grants/find/route';
import { issueSession } from '@/modules/auth/application/session-service';
import { createFacility, verifyFacility } from '@/modules/facilities/application/facility';
import { clearCookies } from './support/cookie-jar';
import {
  createFacilityType,
  createState,
  createUser,
  ensureRole,
} from './support/fixtures';

/**
 * Looking somebody up by phone number, to add them as staff.
 *
 * Registering a facility makes its representative the facility's owner at once,
 * while it is still PENDING, and the owner role carries `role.grant`, which
 * opens this lookup of any registered user's name, number and status. Anybody
 * signed in could therefore register a throwaway facility and use it as a
 * directory of the platform's users.
 */

let sequence = 0;

async function facilityOwnedBy(verified: boolean) {
  await ensureRole('facility_owner', ROLE_PERMISSIONS.facility_owner ?? []);
  sequence += 1;
  const owner = await createUser({ fullName: 'Facility Owner' });
  const ops = await createUser({ fullName: 'Operations Officer' });
  const state = await createState();
  const type = await createFacilityType();
  const facility = await createFacility({
    name: 'Gombe Specialist Clinic',
    facilityTypeId: type.id,
    cacNumber: `RC${700_000 + sequence}`,
    stateId: state.id,
    addressLine: '1 Bauchi Road, Gombe',
    contactPhone: '+2348031234567',
    representativeUserId: owner.id,
    actorId: ops.id,
  });
  if (verified) {
    const officer = await createUser({ fullName: 'Verifying Officer' });
    await verifyFacility({ facilityId: facility.id, verifierId: officer.id, decision: 'approve' });
  }
  return { owner, facility };
}

async function lookup(facilityId: string, phone: string) {
  const response = await findGrantee(
    new Request(
      `http://localhost/api/v1/grants/find?scopeType=FACILITY&scopeId=${facilityId}&phone=${encodeURIComponent(phone)}`,
    ),
  );
  return { status: response.status, body: await response.json() };
}

beforeEach(() => {
  clearCookies();
});

describe('a facility that has not been verified', () => {
  it('cannot look people up, though its owner holds the permission', async () => {
    const { owner, facility } = await facilityOwnedBy(false);
    const stranger = await createUser({ fullName: 'Hauwa Abdullahi' });
    await issueSession({ userId: owner.id, stepUp: true });

    const result = await lookup(facility.id, stranger.phone);

    expect(result.status).toBe(403);
    expect(result.body.error.code).toBe('facility_not_verified');
    // And nothing about the person came back.
    expect(JSON.stringify(result.body)).not.toContain('Hauwa');
    expect(JSON.stringify(result.body)).not.toContain(stranger.phone);
  });
});

describe('a verified facility', () => {
  it('can look up a colleague to add as staff', async () => {
    const { owner, facility } = await facilityOwnedBy(true);
    const colleague = await createUser({ fullName: 'Hauwa Abdullahi' });
    await issueSession({ userId: owner.id, stepUp: true });

    const result = await lookup(facility.id, colleague.phone);

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ id: colleague.id, fullName: 'Hauwa Abdullahi' });
  });

  it('is still refused another facility\'s scope', async () => {
    const mine = await facilityOwnedBy(true);
    const theirs = await facilityOwnedBy(true);
    const colleague = await createUser({ fullName: 'Hauwa Abdullahi' });
    await issueSession({ userId: mine.owner.id, stepUp: true });

    expect((await lookup(theirs.facility.id, colleague.phone)).status).toBe(403);
  });
});
