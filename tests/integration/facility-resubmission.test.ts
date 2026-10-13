import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', async () => {
  const { cookieJar } = await import('./support/cookie-jar');
  return { cookies: () => cookieJar };
});

import { prisma } from '@/lib/db';
import { ROLE_PERMISSIONS } from '@/lib/authz/permissions';
import { PATCH as patchFacilityRoute } from '@/app/api/v1/facilities/[id]/route';
import { issueSession } from '@/modules/auth/application/session-service';
import {
  createFacility,
  updateFacility,
  verifyFacility,
} from '@/modules/facilities/application/facility';
import { clearCookies } from './support/cookie-jar';
import { createFacilityType, createState, createUser, ensureRole } from './support/fixtures';

/**
 * A facility that has been refused.
 *
 * Verification needed a PENDING facility, the CAC number could not be edited,
 * and registering again hit the unique CAC rule: a rejected facility was stuck,
 * while the dashboard told its owner to "reply with the corrected documents"
 * and gave no way to.
 */

let sequence = 0;

async function rejectedFacility(reviewNotes = 'The CAC number does not match the name.') {
  await ensureRole('facility_owner', ROLE_PERMISSIONS.facility_owner ?? []);
  sequence += 1;
  const owner = await createUser({ fullName: 'Facility Owner' });
  const ops = await createUser({ fullName: 'Operations Officer' });
  const officer = await createUser({ fullName: 'Verifying Officer' });
  const state = await createState();
  const type = await createFacilityType();
  const facility = await createFacility({
    name: 'Gombe Specialist Clinic',
    facilityTypeId: type.id,
    cacNumber: `RC${710_000 + sequence}`,
    stateId: state.id,
    addressLine: '1 Bauchi Road, Gombe',
    contactPhone: '+2348031234567',
    representativeUserId: owner.id,
    actorId: ops.id,
  });
  await verifyFacility({ facilityId: facility.id, verifierId: officer.id, decision: 'reject', reviewNotes });
  return { owner, officer, facility, state, type };
}

const stored = (id: string) => prisma.facility.findUniqueOrThrow({ where: { id } });

beforeEach(() => {
  clearCookies();
});

describe('resubmitting a rejected facility', () => {
  it('goes back to PENDING once something has been corrected, and the old reason is cleared', async () => {
    const { owner, facility } = await rejectedFacility();

    const updated = await updateFacility({
      facilityId: facility.id,
      actorId: owner.id,
      addressLine: '2 Corrected Road, Gombe',
      resubmit: true,
    });

    expect(updated.status).toBe('PENDING');
    const row = await stored(facility.id);
    expect(row).toMatchObject({ status: 'PENDING', verifiedBy: null, verifiedAt: null, reviewNotes: null });
    expect(row.addressLine).toBe('2 Corrected Road, Gombe');
  });

  it('can correct the CAC number, which is stored in one spelling', async () => {
    const { owner, facility } = await rejectedFacility();

    await updateFacility({
      facilityId: facility.id,
      actorId: owner.id,
      cacNumber: 'rc-720001',
      resubmit: true,
    });

    expect((await stored(facility.id)).cacNumber).toBe('RC720001');
  });

  it('cannot take another facility\'s number', async () => {
    const mine = await rejectedFacility();
    const theirs = await rejectedFacility();
    const theirNumber = (await stored(theirs.facility.id)).cacNumber;

    await expect(
      updateFacility({
        facilityId: mine.facility.id,
        actorId: mine.owner.id,
        cacNumber: theirNumber.toLowerCase(),
        resubmit: true,
      }),
    ).rejects.toMatchObject({ code: 'duplicate_cac_number' });
    expect((await stored(mine.facility.id)).status).toBe('REJECTED');
  });

  it('refuses to resubmit with nothing changed, because it would only be refused again', async () => {
    const { owner, facility } = await rejectedFacility();

    await expect(
      updateFacility({ facilityId: facility.id, actorId: owner.id, resubmit: true }),
    ).rejects.toMatchObject({ code: 'nothing_changed', status: 409 });

    // Saying the same thing again is not a correction either.
    const same = await stored(facility.id);
    await expect(
      updateFacility({
        facilityId: facility.id,
        actorId: owner.id,
        addressLine: same.addressLine,
        resubmit: true,
      }),
    ).rejects.toMatchObject({ code: 'nothing_changed' });
    expect((await stored(facility.id)).status).toBe('REJECTED');
  });

  it('is only for a facility that was rejected', async () => {
    const { owner, officer, facility } = await rejectedFacility();
    await updateFacility({ facilityId: facility.id, actorId: owner.id, addressLine: '2 New Road, Gombe', resubmit: true });

    // Now PENDING: nothing to resubmit.
    await expect(
      updateFacility({ facilityId: facility.id, actorId: owner.id, addressLine: '3 Again Road, Gombe', resubmit: true }),
    ).rejects.toMatchObject({ code: 'not_rejected', status: 409 });

    // And once verified, the registration number is not something to edit.
    await verifyFacility({ facilityId: facility.id, verifierId: officer.id, decision: 'approve' });
    await expect(
      updateFacility({ facilityId: facility.id, actorId: owner.id, cacNumber: 'RC999999' }),
    ).rejects.toMatchObject({ code: 'cac_locked', status: 409 });
  });

  it('puts it back in front of compliance, who can decide again', async () => {
    const { owner, officer, facility } = await rejectedFacility();
    await updateFacility({ facilityId: facility.id, actorId: owner.id, cacNumber: 'RC730001', resubmit: true });

    await verifyFacility({ facilityId: facility.id, verifierId: officer.id, decision: 'approve' });

    expect((await stored(facility.id)).status).toBe('VERIFIED');
  });

  it('keeps what compliance said, and what was changed, on the audit trail', async () => {
    const { owner, facility } = await rejectedFacility('The CAC number does not match the name.');
    await updateFacility({ facilityId: facility.id, actorId: owner.id, cacNumber: 'RC740001', resubmit: true });

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'facility.resubmitted', entityId: facility.id },
    });
    expect(audit.actorId).toBe(owner.id);
    expect(JSON.stringify(audit.before)).toContain('does not match the name');
    expect(JSON.stringify(audit.after)).toContain('RC740001');
  });

  it('is reachable by the facility\'s own owner over the route, and nobody else\'s', async () => {
    const mine = await rejectedFacility();
    const theirs = await rejectedFacility();
    const patch = (facilityId: string) =>
      patchFacilityRoute(
        new Request(`http://localhost/api/v1/facilities/${facilityId}`, {
          method: 'PATCH',
          body: JSON.stringify({ addressLine: '5 Route Road, Gombe', resubmit: true }),
        }),
        { params: Promise.resolve({ id: facilityId }) },
      );

    await issueSession({ userId: theirs.owner.id });
    expect((await patch(mine.facility.id)).status).toBe(403);
    expect((await stored(mine.facility.id)).status).toBe('REJECTED');

    await issueSession({ userId: mine.owner.id });
    const own = await patch(mine.facility.id);
    expect(own.status).toBe(200);
    expect((await own.json()).status).toBe('PENDING');
  });
});
