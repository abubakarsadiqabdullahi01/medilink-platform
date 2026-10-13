import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', async () => {
  const { cookieJar } = await import('./support/cookie-jar');
  return { cookies: () => cookieJar };
});

import { prisma } from '@/lib/db';
import { ROLE_PERMISSIONS } from '@/lib/authz/permissions';
import { GET as findUser } from '@/app/api/v1/grants/find/route';
import { GET as listStaff, POST as addStaff } from '@/app/api/v1/grants/route';
import { createFacility, verifyFacility } from '@/modules/facilities/application/facility';
import { issueSession } from '@/modules/auth/application/session-service';
import { clearCookies } from './support/cookie-jar';
import { createFacilityType, createState, createUser, ensureRole, grant } from './support/fixtures';

/**
 * AUT-07 — who may add staff, and look people up to do so, is a question about
 * the facility as well as the caller.
 *
 * Registering a facility makes the registrant its owner at once, and the owner
 * holds `role.grant`, which includes finding any registered user by the number
 * they signed up with. Until the facility is verified, that owner has proved
 * nothing to anybody: without the gate, registering a hospital was enough to
 * turn the platform's user table into a lookup.
 *
 * These go through the real route handlers and a real session with step-up,
 * because the gate is a route's job — the guard proves permission and scope and
 * never looks at the facility's state.
 */

let sequence = 0;

async function facilityWithOwner() {
  sequence += 1;
  await ensureRole('facility_owner', ROLE_PERMISSIONS.facility_owner ?? []);
  const state = await createState();
  const type = await createFacilityType();
  const owner = await createUser({ fullName: 'Registrant Owner' });
  const operations = await createUser({ fullName: 'Operations' });

  // Exactly what self-registration does: the registrant is made owner while the
  // facility is still PENDING.
  const facility = await createFacility({
    name: `Gate Hospital ${sequence}`,
    facilityTypeId: type.id,
    cacNumber: `RC${910_000 + sequence}`,
    stateId: state.id,
    addressLine: '1 Gate Road',
    contactPhone: '+2348031234567',
    representativeUserId: owner.id,
    actorId: owner.id,
  });
  return { facilityId: facility.id, ownerId: owner.id, operationsId: operations.id };
}

async function signIn(userId: string) {
  clearCookies();
  await issueSession({ userId, stepUp: true });
}

async function find(facilityId: string, phone: string) {
  const query = new URLSearchParams({ scopeType: 'FACILITY', scopeId: facilityId, phone });
  const response = await findUser(new Request(`http://localhost/api/v1/grants/find?${query}`));
  return { status: response.status, body: await response.json() };
}

async function add(facilityId: string, userId: string, roleKey = 'facility_administrator') {
  const response = await addStaff(
    new Request('http://localhost/api/v1/grants', {
      method: 'POST',
      body: JSON.stringify({ userId, roleKey, scopeType: 'FACILITY', scopeId: facilityId }),
    }),
  );
  return { status: response.status, body: await response.json() };
}

async function list(facilityId: string) {
  const query = new URLSearchParams({ scopeType: 'FACILITY', scopeId: facilityId });
  const response = await listStaff(new Request(`http://localhost/api/v1/grants?${query}`));
  return { status: response.status, body: await response.json() };
}

beforeEach(async () => {
  clearCookies();
  await ensureRole('facility_administrator', ROLE_PERMISSIONS.facility_administrator ?? []);
});

describe('a facility that has not been verified', () => {
  it('does not let its owner look anybody up by phone number', async () => {
    const { facilityId, ownerId } = await facilityWithOwner();
    const somebody = await createUser({ fullName: 'A Practitioner Somewhere Else' });
    await signIn(ownerId);

    const result = await find(facilityId, somebody.phone);

    expect(result.status).toBe(403);
    expect(result.body).toMatchObject({ error: { code: 'staff_requires_verified_facility' } });
    // Nothing about the person in the answer: not their name, not their status.
    expect(JSON.stringify(result.body)).not.toContain('Practitioner Somewhere Else');
  });

  it('answers a number that is not registered exactly as one that is', async () => {
    const { facilityId, ownerId } = await facilityWithOwner();
    await signIn(ownerId);

    // If the gate ran after the lookup, "no such user" and "refused" would tell
    // an unverified owner which numbers are on the platform.
    const unregistered = await find(facilityId, '+2348099999999');

    expect(unregistered.status).toBe(403);
    expect(unregistered.body).toMatchObject({
      error: { code: 'staff_requires_verified_facility' },
    });
  });

  it('does not let its owner give anybody access', async () => {
    const { facilityId, ownerId } = await facilityWithOwner();
    const colleague = await createUser();
    await signIn(ownerId);

    const result = await add(facilityId, colleague.id);

    expect(result.status).toBe(403);
    expect(result.body).toMatchObject({ error: { code: 'staff_requires_verified_facility' } });
    expect(await prisma.userRole.count({ where: { userId: colleague.id } })).toBe(0);
  });

  it('still lets its owner see who has access, which is only themselves', async () => {
    const { facilityId, ownerId } = await facilityWithOwner();
    await signIn(ownerId);

    const result = await list(facilityId);

    expect(result.status).toBe(200);
    expect(
      (result.body as { grants: { userId: string }[] }).grants.map((row) => row.userId),
    ).toEqual([ownerId]);
  });

  it.each(['REJECTED', 'SUSPENDED'] as const)('is no better off when it is %s', async (status) => {
    const { facilityId, ownerId } = await facilityWithOwner();
    await prisma.facility.update({ where: { id: facilityId }, data: { status } });
    const colleague = await createUser();
    await signIn(ownerId);

    expect((await find(facilityId, colleague.phone)).status).toBe(403);
    expect((await add(facilityId, colleague.id)).status).toBe(403);
  });
});

describe('a facility that has been verified', () => {
  it('lets its owner look somebody up and give them access', async () => {
    const { facilityId, ownerId, operationsId } = await facilityWithOwner();
    await verifyFacility({ facilityId, verifierId: operationsId, decision: 'approve' });
    const colleague = await createUser({ fullName: 'Ward Manager' });
    await signIn(ownerId);

    const found = await find(facilityId, colleague.phone);
    expect(found.status).toBe(200);
    expect(found.body).toMatchObject({ fullName: 'Ward Manager' });

    const added = await add(facilityId, colleague.id);
    expect(added.status).toBe(200);
    expect(
      await prisma.userRole.count({
        where: {
          userId: colleague.id,
          scopeType: 'FACILITY',
          scopeId: facilityId,
          revokedAt: null,
        },
      }),
    ).toBe(1);
  });

  it('is the same owner, the same session and the same request that was refused before', async () => {
    const { facilityId, ownerId, operationsId } = await facilityWithOwner();
    const colleague = await createUser();
    await signIn(ownerId);

    expect((await add(facilityId, colleague.id)).status).toBe(403);

    // Nothing about the owner changes. The facility does.
    await verifyFacility({ facilityId, verifierId: operationsId, decision: 'approve' });

    expect((await add(facilityId, colleague.id)).status).toBe(200);
  });

  it('is not held up by a licence that has run out, which stops shifts and not staff', async () => {
    const { facilityId, ownerId, operationsId } = await facilityWithOwner();
    await verifyFacility({ facilityId, verifierId: operationsId, decision: 'approve' });
    await prisma.facility.update({
      where: { id: facilityId },
      data: { licenceExpiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    });
    const colleague = await createUser();
    await signIn(ownerId);

    expect((await add(facilityId, colleague.id)).status).toBe(200);
  });
});

describe('somebody who is not the owner', () => {
  it('is refused as before, whatever state the facility is in', async () => {
    const { facilityId, operationsId } = await facilityWithOwner();
    await verifyFacility({ facilityId, verifierId: operationsId, decision: 'approve' });
    const administrator = await createUser();
    await grant({
      userId: administrator.id,
      roleKey: 'facility_administrator',
      permissions: ROLE_PERMISSIONS.facility_administrator ?? [],
      scopeType: 'FACILITY',
      scopeId: facilityId,
    });
    const colleague = await createUser();
    await signIn(administrator.id);

    // The administrator's bundle has no role.grant. The gate is not what stops
    // them, and must not be what tells them so: the permission is checked first.
    const result = await add(facilityId, colleague.id);
    expect(result.status).toBe(403);
    expect(result.body).not.toMatchObject({ error: { code: 'staff_requires_verified_facility' } });
  });

  it('learns nothing about an unverified facility they hold no permission over', async () => {
    const { facilityId } = await facilityWithOwner();
    const stranger = await createUser();
    await signIn(stranger.id);

    const result = await find(facilityId, stranger.phone);

    // The same refusal as for any other facility, verified or not.
    expect(result.status).toBe(403);
    expect(result.body).not.toMatchObject({ error: { code: 'staff_requires_verified_facility' } });
  });
});

describe('platform administrators', () => {
  it('can still add staff to a facility that has not been verified yet', async () => {
    const { facilityId } = await facilityWithOwner();
    const administrator = await createUser();
    await grant({
      userId: administrator.id,
      // Everything, so the escalation ceiling (nobody grants what they do not
      // hold) is not what this test ends up measuring.
      roleKey: 'super_administrator',
      permissions: ROLE_PERMISSIONS.super_administrator ?? [],
      scopeType: 'PLATFORM',
    });
    const colleague = await createUser();
    await signIn(administrator.id);

    // Operations onboarding a hospital by hand is not the self-registration path
    // the gate is about; the platform is who verifies, and is not tied to it.
    expect((await find(facilityId, colleague.phone)).status).toBe(200);
    expect((await add(facilityId, colleague.id)).status).toBe(200);
  });
});
