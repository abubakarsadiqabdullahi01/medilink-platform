import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', async () => {
  const { cookieJar } = await import('./support/cookie-jar');
  return { cookies: () => cookieJar };
});

import { prisma } from '@/lib/db';
import { ROLE_PERMISSIONS } from '@/lib/authz/permissions';
import { POST as registerRoute } from '@/app/api/v1/facilities/register/route';
import { POST as verifyRoute } from '@/app/api/v1/facilities/[id]/verify/route';
import { issueSession } from '@/modules/auth/application/session-service';
import { createFacility, reviewFacility } from '@/modules/facilities/application/facility';
import { clearCookies } from './support/cookie-jar';
import { createFacilityType, createState, createUser, ensureRole, grant } from './support/fixtures';

/**
 * FAC-05, UXF-02, UXO-02.
 *
 * A government hospital or primary health centre has no CAC number, and the form,
 * the API and the column all demanded one: most of the facilities in Gombe could
 * not register truthfully. And "Verify" was a live button whether or not a
 * licence was on file, recording only a free-text note.
 */

beforeEach(() => {
  clearCookies();
});

async function fixture() {
  await ensureRole('facility_owner', ROLE_PERMISSIONS.facility_owner ?? []);
  return { state: await createState(), type: await createFacilityType() };
}

const GOVERNMENT = {
  name: 'Gombe PHC Dukku',
  registrationKind: 'GOVERNMENT' as const,
  cacNumber: 'fmoh/phc/gom/0042',
  addressLine: '2 Dukku Road, Gombe',
  contactPhone: '+2348031234567',
};

async function register(f: Awaited<ReturnType<typeof fixture>>, overrides: Record<string, unknown> = {}) {
  const user = await createUser({ fullName: 'Matron' });
  await issueSession({ userId: user.id });
  const response = await registerRoute(
    new Request('http://localhost/api/v1/facilities/register', {
      method: 'POST',
      body: JSON.stringify({ ...GOVERNMENT, facilityTypeId: f.type.id, stateId: f.state.id, ...overrides }),
    }),
  );
  return { user, status: response.status, body: (await response.json()) as Record<string, any> };
}

describe('registering without a CAC number', () => {
  it('lets a government facility register under its ministry reference', async () => {
    const f = await fixture();

    const result = await register(f);

    expect(result.status).toBe(201);
    const stored = await prisma.facility.findFirstOrThrow({ where: { name: 'Gombe PHC Dukku' } });
    expect(stored.registrationKind).toBe('GOVERNMENT');
    expect(stored.cacNumber).toBe('FMOH/PHC/GOM/0042');
    expect(stored.status).toBe('PENDING');
  });

  it('keeps registering a company by its CAC number, as before', async () => {
    const f = await fixture();

    const result = await register(f, { registrationKind: undefined, cacNumber: 'rc-700501' });

    expect(result.status).toBe(201);
    const stored = await prisma.facility.findFirstOrThrow({ where: { name: 'Gombe PHC Dukku' } });
    expect(stored.registrationKind).toBe('CAC');
    expect(stored.cacNumber).toBe('RC700501');
  });

  it('still insists a CAC number looks like one', async () => {
    const f = await fixture();
    const result = await register(f, { registrationKind: 'CAC', cacNumber: 'not a number!' });
    expect(result.status).toBe(422);
  });

  it('does not accept a reference with nothing in it', async () => {
    const f = await fixture();
    expect((await register(f, { cacNumber: 'ab' })).status).toBe(422);
    expect(await prisma.facility.count()).toBe(0);
  });

  it('refuses the same government reference twice, however it is spaced or cased', async () => {
    const f = await fixture();
    expect((await register(f)).status).toBe(201);

    const second = await register(f, { name: 'Another PHC', cacNumber: ' FMOH/PHC/GOM/0042 ' });

    expect(second.status).toBe(409);
    expect(await prisma.facility.count()).toBe(1);
  });

  it('keeps the registries apart: the same characters under a different kind are a different registration', async () => {
    const f = await fixture();
    expect((await register(f, { registrationKind: 'CAC', cacNumber: 'RC700501' })).status).toBe(201);

    const other = await register(f, { name: 'A Government Facility', registrationKind: 'GOVERNMENT', cacNumber: 'RC700501' });

    expect(other.status).toBe(201);
  });

  it('is stored when operations create it too', async () => {
    const f = await fixture();
    const ops = await createUser({ fullName: 'Operations Officer' });
    const rep = await createUser({ fullName: 'Matron' });

    const facility = await createFacility({
      name: 'Gombe PHC Billiri',
      facilityTypeId: f.type.id,
      registrationKind: 'GOVERNMENT',
      cacNumber: 'state hospitals board / 77',
      stateId: f.state.id,
      addressLine: '3 Billiri Road',
      contactPhone: '+2348031234567',
      representativeUserId: rep.id,
      actorId: ops.id,
    });

    expect(facility.registrationKind).toBe('GOVERNMENT');
    expect(facility.cacNumber).toBe('STATE HOSPITALS BOARD / 77');
  });
});

describe('approving a facility', () => {
  const CHECKS = {
    licenceDocumentSeen: true,
    licenceMatchesFacility: true,
    registrationChecked: true,
    checkedWith: 'Phoned the state ministry records office; reference confirmed.',
  };

  async function pending(options: { document?: boolean; number?: boolean } = {}) {
    const f = await fixture();
    const created = await register(f);
    const facilityId = (created.body as { id: string }).id;
    await prisma.facility.update({
      where: { id: facilityId },
      data: {
        licenceObjectKey: options.document === false ? null : `facility-licence/${facilityId}/licence.pdf`,
        licenceNumber: options.number === false ? null : 'LIC/2026/114',
      },
    });
    const officer = await createUser({ fullName: 'Verifying Officer' });
    return { facilityId, officer };
  }

  it('is refused with nothing on file, and says everything that is missing', async () => {
    const { facilityId, officer } = await pending({ document: false, number: false });

    await expect(
      reviewFacility({ facilityId, verifierId: officer.id, decision: 'approve' }),
    ).rejects.toMatchObject({
      code: 'approval_blocked',
      status: 422,
      message: expect.stringMatching(/licence document.*licence number.*checks/s),
    });
    expect((await prisma.facility.findUniqueOrThrow({ where: { id: facilityId } })).status).toBe('PENDING');
  });

  it('is refused until every check is confirmed', async () => {
    const { facilityId, officer } = await pending();

    await expect(
      reviewFacility({ facilityId, verifierId: officer.id, decision: 'approve', checks: { ...CHECKS, registrationChecked: false } }),
    ).rejects.toMatchObject({ code: 'approval_blocked' });
  });

  it('is refused without saying how the registration was checked', async () => {
    const { facilityId, officer } = await pending();

    await expect(
      reviewFacility({ facilityId, verifierId: officer.id, decision: 'approve', checks: { ...CHECKS, checkedWith: 'fine' } }),
    ).rejects.toMatchObject({ code: 'approval_blocked' });
  });

  it('goes ahead with the evidence on file and the checks made, and keeps what was checked', async () => {
    const { facilityId, officer } = await pending();

    const approved = await reviewFacility({ facilityId, verifierId: officer.id, decision: 'approve', checks: CHECKS });

    expect(approved.status).toBe('VERIFIED');
    const row = await prisma.facility.findUniqueOrThrow({ where: { id: facilityId } });
    expect(row.verificationChecks).toMatchObject({ ...CHECKS });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'facility.verified' } });
    expect(audit.after).toMatchObject({ checks: { registrationChecked: true } });
  });

  it('needs no evidence to refuse, only a reason', async () => {
    const { facilityId, officer } = await pending({ document: false, number: false });

    const rejected = await reviewFacility({
      facilityId,
      verifierId: officer.id,
      decision: 'reject',
      reviewNotes: 'No licence was uploaded; please upload it and resubmit.',
    });

    expect(rejected.status).toBe('REJECTED');
  });

  it('is enforced through the route, which is how an officer does it', async () => {
    const { facilityId } = await pending();
    const officer = await createUser({ fullName: 'Verifying Officer' });
    await grant({ userId: officer.id, roleKey: 'administrator', permissions: ROLE_PERMISSIONS.administrator ?? [], scopeType: 'PLATFORM' });
    await issueSession({ userId: officer.id });
    const call = (body: object) =>
      verifyRoute(
        new Request(`http://localhost/api/v1/facilities/${facilityId}/verify`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ id: facilityId }) },
      );

    const bare = await call({ decision: 'approve' });
    expect(bare.status).toBe(422);
    expect(((await bare.json()) as { error: { code: string } }).error.code).toBe('approval_blocked');

    const checked = await call({ decision: 'approve', checks: CHECKS });
    expect(checked.status).toBe(200);
  });
});
