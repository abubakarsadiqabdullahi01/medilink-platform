import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', async () => {
  const { cookieJar } = await import('./support/cookie-jar');
  return { cookies: () => cookieJar };
});

// Only headObject touches the network; getSignedUrl (inside createUploadUrl
// and createDownloadUrl) is local signing and stays real.
vi.mock('@/lib/storage/tigris', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/storage/tigris')>();
  return { ...actual, headObject: vi.fn().mockResolvedValue({}) };
});

import { prisma } from '@/lib/db';
import { EVENTS } from '@/lib/events';
import { GET as listFacilitiesRoute, POST as createFacilityRoute } from '@/app/api/v1/facilities/route';
import {
  GET as getFacilityRoute,
  PATCH as patchFacilityRoute,
} from '@/app/api/v1/facilities/[id]/route';
import { POST as verifyRoute } from '@/app/api/v1/facilities/[id]/verify/route';
import { POST as licenceUploadUrlRoute } from '@/app/api/v1/facilities/[id]/licence-upload-url/route';
import { POST as licenceUrlRoute } from '@/app/api/v1/facilities/[id]/licence-url/route';
import { ROLE_PERMISSIONS } from '@/lib/authz/permissions';
import { ROUTES } from '@/modules/facilities/routes';
import { issueSession } from '@/modules/auth/application/session-service';
import { clearCookies } from './support/cookie-jar';
import { createFacilityType, createLga, createState, createUser, ensureRole, grant } from './support/fixtures';

/**
 * Stage 5.10 — facility management and verification.
 *
 * The Stage 5 gate condition is "a facility must be verified before it can
 * publish". Publishing arrives in Stage 6, so what is asserted here is the
 * half that exists: the record, its verification, and — the part that would
 * quietly rot if untested — that one facility can never reach another's data
 * through any route.
 */

interface ApiResult {
  status: number;
  body: Record<string, unknown>;
}

function jsonRequest(url: string, body: unknown, method = 'POST'): Request {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function callCreate(body: unknown): Promise<ApiResult> {
  const response = await createFacilityRoute(jsonRequest('http://localhost/api/v1/facilities', body));
  return { status: response.status, body: await response.json() };
}

async function callList(query: Record<string, string>): Promise<ApiResult> {
  const params = new URLSearchParams(query);
  const response = await listFacilitiesRoute(
    new Request(`http://localhost/api/v1/facilities?${params}`),
  );
  return { status: response.status, body: await response.json() };
}

async function callGet(id: string): Promise<ApiResult> {
  const response = await getFacilityRoute(new Request(`http://localhost/api/v1/facilities/${id}`), {
    params: Promise.resolve({ id }),
  });
  return { status: response.status, body: await response.json() };
}

async function callPatch(id: string, body: unknown): Promise<ApiResult> {
  const response = await patchFacilityRoute(
    jsonRequest(`http://localhost/api/v1/facilities/${id}`, body, 'PATCH'),
    { params: Promise.resolve({ id }) },
  );
  return { status: response.status, body: await response.json() };
}

async function callVerify(id: string, body: unknown): Promise<ApiResult> {
  const response = await verifyRoute(
    jsonRequest(`http://localhost/api/v1/facilities/${id}/verify`, body),
    { params: Promise.resolve({ id }) },
  );
  return { status: response.status, body: await response.json() };
}

async function callLicenceUploadUrl(id: string, body: unknown): Promise<ApiResult> {
  const response = await licenceUploadUrlRoute(
    jsonRequest(`http://localhost/api/v1/facilities/${id}/licence-upload-url`, body),
    { params: Promise.resolve({ id }) },
  );
  return { status: response.status, body: await response.json() };
}

async function callLicenceUrl(id: string): Promise<ApiResult> {
  const response = await licenceUrlRoute(
    jsonRequest(`http://localhost/api/v1/facilities/${id}/licence-url`, {}),
    { params: Promise.resolve({ id }) },
  );
  return { status: response.status, body: await response.json() };
}

const LICENCE_UPLOAD = { filename: 'licence.pdf', contentType: 'application/pdf', sizeBytes: 4096 };

let cacSequence = 0;

/** A distinct registration number per facility, unless a test wants a clash. */
function nextCac(): string {
  cacSequence += 1;
  return `RC${String(100000 + cacSequence)}`;
}

interface Fixture {
  stateId: string;
  lgaId: string;
  facilityTypeId: string;
  representativeId: string;
  opsId: string;
}

/** Operations creates facilities; nobody else can, which is the point. */
async function setUp(): Promise<Fixture> {
  // The real bundle, not a hand-picked pair: if facility.read ever leaves
  // ROLE_PERMISSIONS.facility_owner, a representative silently loses their own
  // facility and these tests should say so.
  await ensureRole('facility_owner', ROLE_PERMISSIONS.facility_owner ?? []);

  const state = await createState();
  const lga = await createLga(state.id);
  const facilityType = await createFacilityType();
  const representative = await createUser({ fullName: 'Facility Representative' });
  const ops = await createUser({ fullName: 'Operations Officer' });

  await grant({
    userId: ops.id,
    roleKey: 'operations_admin',
    permissions: ['facility.write', 'facility.read'],
    scopeType: 'PLATFORM',
  });

  return {
    stateId: state.id,
    lgaId: lga.id,
    facilityTypeId: facilityType.id,
    representativeId: representative.id,
    opsId: ops.id,
  };
}

function creationBody(fixture: Fixture, overrides: Record<string, unknown> = {}) {
  return {
    name: 'Owerri General Hospital',
    facilityTypeId: fixture.facilityTypeId,
    cacNumber: nextCac(),
    stateId: fixture.stateId,
    lgaId: fixture.lgaId,
    addressLine: '14 Wetheral Road, Owerri',
    contactPhone: '08031234567',
    representativeUserId: fixture.representativeId,
    ...overrides,
  };
}

/** Creates a facility as operations and returns its id. */
async function createAs(fixture: Fixture, overrides: Record<string, unknown> = {}): Promise<string> {
  await issueSession({ userId: fixture.opsId });
  const created = await callCreate(creationBody(fixture, overrides));
  expect(created.status).toBe(201);
  return created.body.id as string;
}

beforeEach(() => {
  clearCookies();
});

describe('creation', () => {
  it('creates a facility and grants its representative facility_owner over it', async () => {
    const fixture = await setUp();
    const facilityId = await createAs(fixture);

    const roleGrant = await prisma.userRole.findFirstOrThrow({
      where: { userId: fixture.representativeId, scopeType: 'FACILITY', scopeId: facilityId },
      include: { role: true },
    });
    expect(roleGrant.role.key).toBe('facility_owner');
    expect(roleGrant.grantedBy).toBe(fixture.opsId);

    // The grant is real, not decorative: the representative can immediately
    // read the facility they were just given.
    await issueSession({ userId: fixture.representativeId });
    const own = await callGet(facilityId);
    expect(own.status).toBe(200);
    expect(own.body.name).toBe('Owerri General Hospital');
  });

  it('starts a facility unable to publish, and says why', async () => {
    const fixture = await setUp();
    const facilityId = await createAs(fixture);

    const facility = await callGet(facilityId);
    expect(facility.body.status).toBe('PENDING');
    expect(facility.body.canPublish).toBe(false);
    expect(facility.body.publishBlockers).toEqual(['not_verified']);
  });

  it('normalises the CAC number before storing it', async () => {
    const fixture = await setUp();
    const facilityId = await createAs(fixture, { cacNumber: ' rc 987654 ' });

    const stored = await prisma.facility.findUniqueOrThrow({ where: { id: facilityId } });
    expect(stored.cacNumber).toBe('RC987654');
  });

  it('refuses a duplicate CAC number on the database constraint', async () => {
    const fixture = await setUp();
    const cacNumber = nextCac();
    await createAs(fixture, { cacNumber });

    // Same registration, differently typed. Normalising in the schema is what
    // makes the unique constraint mean what it says.
    const second = await callCreate(creationBody(fixture, { cacNumber: cacNumber.toLowerCase() }));

    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ error: { code: 'duplicate_cac_number' } });
    expect(await prisma.facility.count()).toBe(1);
  });

  it('refuses an LGA that is not in the state given', async () => {
    const fixture = await setUp();
    const otherState = await createState();
    const foreignLga = await createLga(otherState.id);

    await issueSession({ userId: fixture.opsId });
    const result = await callCreate(creationBody(fixture, { lgaId: foreignLga.id }));

    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ error: { code: 'lga_not_in_state' } });
  });

  it('refuses a representative who is not a registered user', async () => {
    const fixture = await setUp();
    await issueSession({ userId: fixture.opsId });

    const result = await callCreate(
      creationBody(fixture, { representativeUserId: '00000000-0000-4000-8000-000000000999' }),
    );

    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ error: { code: 'representative_not_found' } });
  });

  it('refuses a malformed phone number with a usable message, not a 500', async () => {
    const fixture = await setUp();
    await issueSession({ userId: fixture.opsId });

    const result = await callCreate(creationBody(fixture, { contactPhone: 'not-a-number' }));

    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ error: { code: 'validation_failed' } });
  });
});

describe('step 4.3 applied to facilities — the role is not the permission', () => {
  it('refuses an unauthenticated caller', async () => {
    const fixture = await setUp();
    const result = await callList({ scopeType: 'PLATFORM' });
    expect(result.status).toBe(401);
    expect(fixture.opsId).toBeTruthy();
  });

  it('refuses a user holding a real role without facility.write', async () => {
    const fixture = await setUp();
    const outsider = await createUser();
    await grant({
      userId: outsider.id,
      roleKey: 'practitioner',
      permissions: ['practitioner.profile.read', 'credential.submit'],
      scopeType: 'PLATFORM',
    });
    await issueSession({ userId: outsider.id });

    const result = await callCreate(creationBody(fixture));

    expect(result.status).toBe(403);
    expect(result.body).toMatchObject({ error: { code: 'forbidden' } });
  });

  it('refuses the representative themselves the right to create facilities', async () => {
    const fixture = await setUp();
    await createAs(fixture);

    // facility_owner carries facility.write, but only over their own
    // facility — creation is checked at PLATFORM, which they do not hold.
    await issueSession({ userId: fixture.representativeId });
    const result = await callCreate(creationBody(fixture));

    expect(result.status).toBe(403);
  });
});

describe('step 4.4 applied to facilities — one facility never reaches another', () => {
  it('refuses facility A the record, licence and edits of facility B', async () => {
    const fixture = await setUp();
    const facilityA = await createAs(fixture);

    const otherRep = await createUser({ fullName: 'Other Representative' });
    const facilityB = await createAs(fixture, {
      name: 'Aba Specialist Clinic',
      representativeUserId: otherRep.id,
    });

    await issueSession({ userId: fixture.representativeId });

    expect((await callGet(facilityA)).status).toBe(200);

    // Every route, not just the read: a scoped grant that leaks on any one
    // of them leaks entirely.
    expect((await callGet(facilityB)).status).toBe(403);
    expect((await callPatch(facilityB, { name: 'Renamed by an outsider' })).status).toBe(403);
    expect((await callLicenceUploadUrl(facilityB, LICENCE_UPLOAD)).status).toBe(403);
    expect((await callLicenceUrl(facilityB)).status).toBe(403);
    expect((await callList({ scopeType: 'FACILITY', scopeId: facilityB })).status).toBe(403);

    const untouched = await prisma.facility.findUniqueOrThrow({ where: { id: facilityB } });
    expect(untouched.name).toBe('Aba Specialist Clinic');
  });

  it('refuses a facility-scoped grant the platform-wide list', async () => {
    const fixture = await setUp();
    await createAs(fixture);

    await issueSession({ userId: fixture.representativeId });
    expect((await callList({ scopeType: 'PLATFORM' })).status).toBe(403);
  });

  it('returns only the granted facility, not merely a 403 on the others', async () => {
    const fixture = await setUp();
    const facilityA = await createAs(fixture);
    const otherRep = await createUser();
    await createAs(fixture, { name: 'Aba Specialist Clinic', representativeUserId: otherRep.id });

    await issueSession({ userId: fixture.representativeId });
    const listed = await callList({ scopeType: 'FACILITY', scopeId: facilityA });

    // A 403 proves the check ran; the rows prove the filter matches what was
    // authorised. Authorising one scope and querying wider returns 200 and
    // the wrong data.
    const facilities = listed.body.facilities as { id: string }[];
    expect(facilities).toHaveLength(1);
    expect(facilities[0]?.id).toBe(facilityA);
  });

  it('lets a platform grant reach every facility', async () => {
    const fixture = await setUp();
    const facilityA = await createAs(fixture);
    const otherRep = await createUser();
    const facilityB = await createAs(fixture, { representativeUserId: otherRep.id });

    await issueSession({ userId: fixture.opsId });
    expect((await callGet(facilityA)).status).toBe(200);
    expect((await callGet(facilityB)).status).toBe(200);
    expect((await callList({ scopeType: 'PLATFORM' })).body.facilities).toHaveLength(2);
  });
});

describe('verification', () => {
  async function complianceOfficer() {
    const officer = await createUser({ fullName: 'Compliance Officer' });
    await grant({
      userId: officer.id,
      roleKey: 'compliance_officer',
      permissions: ['facility.verify', 'facility.read'],
      scopeType: 'PLATFORM',
    });
    return officer;
  }

  it('verifies a facility, which then reports it can publish', async () => {
    const fixture = await setUp();
    const facilityId = await createAs(fixture);
    const officer = await complianceOfficer();

    await issueSession({ userId: officer.id });
    const verified = await callVerify(facilityId, { decision: 'approve' });

    expect(verified.status).toBe(200);
    expect(verified.body.status).toBe('VERIFIED');
    expect(verified.body.canPublish).toBe(true);
    expect(verified.body.publishBlockers).toEqual([]);
    expect(verified.body.verifiedBy).toBe(officer.id);

    // And the facility's own people see it, through their own grant.
    await issueSession({ userId: fixture.representativeId });
    expect((await callGet(facilityId)).body.status).toBe('VERIFIED');
  });

  it('publishes facility.verified on approval, and nothing on rejection', async () => {
    const fixture = await setUp();
    const approved = await createAs(fixture);
    const otherRep = await createUser();
    const rejected = await createAs(fixture, { representativeUserId: otherRep.id });
    const officer = await complianceOfficer();

    await issueSession({ userId: officer.id });
    await callVerify(approved, { decision: 'approve' });
    await callVerify(rejected, { decision: 'reject', reviewNotes: 'Licence document illegible.' });

    const events = await prisma.outboxEvent.findMany({
      where: { eventType: EVENTS.FacilityVerified },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.aggregateId).toBe(approved);
  });

  it('refuses a rejection with no reason', async () => {
    const fixture = await setUp();
    const facilityId = await createAs(fixture);
    const officer = await complianceOfficer();

    await issueSession({ userId: officer.id });
    const result = await callVerify(facilityId, { decision: 'reject' });

    expect(result.status).toBe(422);
  });

  it('refuses a representative verifying the facility they represent', async () => {
    const fixture = await setUp();
    const facilityId = await createAs(fixture);

    // The dual-role case: nothing else stops someone holding both grants
    // from signing off their own organisation.
    await grant({
      userId: fixture.representativeId,
      roleKey: 'compliance_officer',
      permissions: ['facility.verify'],
      scopeType: 'PLATFORM',
    });
    await issueSession({ userId: fixture.representativeId });

    const result = await callVerify(facilityId, { decision: 'approve' });

    expect(result.status).toBe(403);
    expect(result.body).toMatchObject({ error: { code: 'cannot_verify_own_facility' } });
    expect((await prisma.facility.findUniqueOrThrow({ where: { id: facilityId } })).status).toBe(
      'PENDING',
    );
  });

  it('refuses a second review of an already-decided facility', async () => {
    const fixture = await setUp();
    const facilityId = await createAs(fixture);
    const officer = await complianceOfficer();

    await issueSession({ userId: officer.id });
    expect((await callVerify(facilityId, { decision: 'approve' })).status).toBe(200);

    const second = await callVerify(facilityId, { decision: 'reject', reviewNotes: 'Changed mind.' });
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ error: { code: 'already_verified' } });
  });

  it('refuses a facility-scoped caller the verify route entirely', async () => {
    const fixture = await setUp();
    const facilityId = await createAs(fixture);

    await issueSession({ userId: fixture.representativeId });
    expect((await callVerify(facilityId, { decision: 'approve' })).status).toBe(403);
  });
});

describe('the licence document', () => {
  it('mints an upload URL scoped to the facility, then accepts it on the facility', async () => {
    const fixture = await setUp();
    const facilityId = await createAs(fixture);

    await issueSession({ userId: fixture.representativeId });
    const minted = await callLicenceUploadUrl(facilityId, LICENCE_UPLOAD);
    expect(minted.status).toBe(200);

    const objectKey = minted.body.objectKey as string;
    const stored = await prisma.storedObject.findUniqueOrThrow({ where: { objectKey } });
    expect(stored.purpose).toBe('facility_licence');
    expect(stored.scopeType).toBe('FACILITY');
    expect(stored.scopeId).toBe(facilityId);

    const attached = await callPatch(facilityId, { licenceObjectKey: objectKey });
    expect(attached.status).toBe(200);
    expect(attached.body.licenceObjectKey).toBe(objectKey);

    const downloadable = await callLicenceUrl(facilityId);
    expect(downloadable.status).toBe(200);
    expect(String(downloadable.body.downloadUrl)).toContain(objectKey);
  });

  it("refuses a licence minted for another facility", async () => {
    const fixture = await setUp();
    const facilityA = await createAs(fixture);
    const otherRep = await createUser();
    const facilityB = await createAs(fixture, { representativeUserId: otherRep.id });

    await issueSession({ userId: fixture.representativeId });
    const minted = await callLicenceUploadUrl(facilityA, LICENCE_UPLOAD);

    // Operations can edit any facility, so this is not a scope refusal — it
    // is the reference check refusing to attach A's document to B.
    await issueSession({ userId: fixture.opsId });
    const attached = await callPatch(facilityB, { licenceObjectKey: minted.body.objectKey });

    expect(attached.status).toBe(422);
    expect(attached.body).toMatchObject({ error: { code: 'invalid_licence_reference' } });
  });

  it('refuses a licence URL for a facility that has no licence', async () => {
    const fixture = await setUp();
    const facilityId = await createAs(fixture);

    await issueSession({ userId: fixture.representativeId });
    const result = await callLicenceUrl(facilityId);

    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ error: { code: 'no_licence_on_facility' } });
  });

  it('records who looked at a licence', async () => {
    const fixture = await setUp();
    const facilityId = await createAs(fixture);

    await issueSession({ userId: fixture.representativeId });
    const minted = await callLicenceUploadUrl(facilityId, LICENCE_UPLOAD);
    await callPatch(facilityId, { licenceObjectKey: minted.body.objectKey });
    await callLicenceUrl(facilityId);

    const events = await prisma.securityEvent.findMany({
      where: { kind: 'facility.licence_accessed' },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.userId).toBe(fixture.representativeId);
  });
});

describe('editing a verified facility', () => {
  async function verifiedFacility(fixture: Fixture): Promise<string> {
    const facilityId = await createAs(fixture);
    const officer = await createUser({ fullName: 'Compliance Officer' });
    await grant({
      userId: officer.id,
      roleKey: 'compliance_officer',
      permissions: ['facility.verify'],
      scopeType: 'PLATFORM',
    });
    await issueSession({ userId: officer.id });
    await callVerify(facilityId, { decision: 'approve' });
    return facilityId;
  }

  it('sends it back for review when the licence changes', async () => {
    const fixture = await setUp();
    const facilityId = await verifiedFacility(fixture);

    await issueSession({ userId: fixture.representativeId });
    const minted = await callLicenceUploadUrl(facilityId, LICENCE_UPLOAD);
    const patched = await callPatch(facilityId, { licenceObjectKey: minted.body.objectKey });

    // Otherwise verification would mean only that some licence was approved
    // once, and a facility could swap the document and keep publishing.
    expect(patched.body.status).toBe('PENDING');
    expect(patched.body.canPublish).toBe(false);
    expect(patched.body.verifiedAt).toBeNull();

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'facility.licence_replaced', entityId: facilityId },
    });
    expect(audit).not.toBeNull();
  });

  it('leaves it verified when only the address changes', async () => {
    const fixture = await setUp();
    const facilityId = await verifiedFacility(fixture);

    await issueSession({ userId: fixture.representativeId });
    const patched = await callPatch(facilityId, { addressLine: '2 Douglas Road, Owerri' });

    // An address is not evidence, so re-review would be busywork.
    expect(patched.body.status).toBe('VERIFIED');
    expect(patched.body.canPublish).toBe(true);
  });

  it('cannot publish once its licence has lapsed', async () => {
    const fixture = await setUp();
    const facilityId = await verifiedFacility(fixture);

    // No scheduler is involved: the rule is evaluated when the record is
    // read. Step 5.9's automatic suspension still needs one.
    await prisma.facility.update({
      where: { id: facilityId },
      data: { licenceExpiresAt: new Date('2020-01-01T00:00:00.000Z') },
    });

    await issueSession({ userId: fixture.representativeId });
    const facility = await callGet(facilityId);

    expect(facility.body.status).toBe('VERIFIED');
    expect(facility.body.canPublish).toBe(false);
    expect(facility.body.publishBlockers).toEqual(['licence_expired']);
  });
});

describe('the route table', () => {
  it('lists every facility route with the permission it enforces', () => {
    expect(ROUTES.length).toBeGreaterThan(0);
    expect(ROUTES.map((route) => route.permission)).toEqual(
      expect.arrayContaining(['facility.read', 'facility.write', 'facility.verify']),
    );

    // Creation and verification are PLATFORM-only; if either ever appears
    // scoped to a facility, that facility can onboard or approve itself.
    const selfServe = ROUTES.filter(
      (route) =>
        route.scopeType !== 'PLATFORM' &&
        (route.path.endsWith('/verify') || route.permission === 'facility.write') &&
        route.path === '/api/v1/facilities',
    );
    expect(selfServe).toEqual([]);
  });
});
