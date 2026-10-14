import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', async () => {
  const { cookieJar } = await import('./support/cookie-jar');
  return { cookies: () => cookieJar };
});

import { prisma } from '@/lib/db';
import { ROLE_PERMISSIONS } from '@/lib/authz/permissions';
import { POST as registerRoute } from '@/app/api/v1/facilities/register/route';
import { issueSession } from '@/modules/auth/application/session-service';
import { createFacility } from '@/modules/facilities/application/facility';
import { clearCookies } from './support/cookie-jar';
import { createFacilityType, createState, createUser, ensureRole } from './support/fixtures';

/**
 * A hospital signing itself up.
 *
 * The operations route normalised the CAC number and this one did not, so
 * somebody could register another hospital's number in a different spelling,
 * slip past the duplicate check, and be waiting to be verified as a hospital
 * that already existed.
 */

async function world() {
  await ensureRole('facility_owner', ROLE_PERMISSIONS.facility_owner ?? []);
  const state = await createState();
  const type = await createFacilityType();
  const ops = await createUser({ fullName: 'Operations Officer' });
  const owner = await createUser({ fullName: 'Existing Owner' });
  await createFacility({
    name: 'Gombe Specialist Hospital',
    facilityTypeId: type.id,
    cacNumber: 'RC700500',
    stateId: state.id,
    addressLine: '1 Bauchi Road, Gombe',
    contactPhone: '+2348031234567',
    representativeUserId: owner.id,
    actorId: ops.id,
  });
  const newcomer = await createUser({ fullName: 'Somebody Else' });
  await issueSession({ userId: newcomer.id });
  return { state, type };
}

async function register(fixture: { state: { id: string }; type: { id: string } }, cacNumber: string) {
  const response = await registerRoute(
    new Request('http://localhost/api/v1/facilities/register', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Gombe Specialist Hospital (second)',
        facilityTypeId: fixture.type.id,
        cacNumber,
        stateId: fixture.state.id,
        addressLine: '9 Another Road, Gombe',
        contactPhone: '+2348039999999',
      }),
    }),
  );
  return { status: response.status, body: await response.json() };
}

beforeEach(() => {
  clearCookies();
});

describe('registering a number somebody has already registered', () => {
  it.each(['rc700500', 'RC-700500', 'RC/700500', ' R.C. 700 500 '])(
    'is refused however it is spelled: %j',
    async (spelling) => {
      const fixture = await world();

      const result = await register(fixture, spelling);

      expect(result.status).toBe(409);
      expect(result.body).toMatchObject({ error: { code: 'duplicate_cac_number' } });
      expect(await prisma.facility.count()).toBe(1);
    },
  );

  it('still registers a number that is new, stored in one spelling', async () => {
    const fixture = await world();

    const result = await register(fixture, 'rc-700501');

    expect(result.status).toBe(201);
    const stored = await prisma.facility.findFirstOrThrow({ where: { name: { contains: 'second' } } });
    expect(stored.cacNumber).toBe('RC700501');
  });
});
