import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', async () => {
  const { cookieJar } = await import('./support/cookie-jar');
  return { cookies: () => cookieJar };
});

import { prisma } from '@/lib/db';
import { POST as matchRoute } from '@/app/api/v1/service-requests/[id]/match/route';
import { GET as matchRunRoute } from '@/app/api/v1/match-runs/[id]/route';
import { ROLE_PERMISSIONS } from '@/lib/authz/permissions';
import { issueSession } from '@/modules/auth/application/session-service';
import { createFacility, verifyFacility } from '@/modules/facilities/application/facility';
import { createServiceRequest } from '@/modules/service-requests/application/request';
import { createProfile } from '@/modules/practitioners/application/profile';
import { addBlock, addSlot } from '@/modules/availability/application/availability';
import {
  recordIdentityVerification,
  recordProfessionalRegistration,
} from '@/modules/practitioners/application/verification';
import { screenPractitioner } from '@/modules/practitioners/application/screening';
import { clearCookies } from './support/cookie-jar';
import {
  createCredentialType,
  createFacilityType,
  createLga,
  createProfessionalCategory,
  createSpecialty,
  createState,
  createUser,
  ensureRole,
  grant,
} from './support/fixtures';

/**
 * Steps 6.3 and 6.4 — matching, and cold start.
 *
 * The engine's own behaviour is unit-tested; what is asserted here is that
 * the pieces are wired to it — real eligibility, real availability, real
 * proximity — and that a run survives to be explained afterwards.
 */

interface ApiResult {
  status: number;
  body: Record<string, unknown>;
}

const SHIFT_START = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
const SHIFT_END = new Date(SHIFT_START.getTime() + 8 * 60 * 60 * 1000);

let sequence = 0;

async function callMatch(requestId: string, facilityId: string): Promise<ApiResult> {
  const response = await matchRoute(
    new Request(`http://localhost/api/v1/service-requests/${requestId}/match`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ facilityId }),
    }),
    { params: { id: requestId } },
  );
  return { status: response.status, body: await response.json() };
}

async function callReadRun(runId: string, facilityId: string): Promise<ApiResult> {
  const response = await matchRunRoute(
    new Request(`http://localhost/api/v1/match-runs/${runId}?facilityId=${facilityId}`),
    { params: { id: runId } },
  );
  return { status: response.status, body: await response.json() };
}

interface World {
  facilityId: string;
  facilityLgaId: string;
  facilityStateId: string;
  categoryId: string;
  specialtyId: string;
  requestId: string;
  schedulerId: string;
  credentialTypeId: string;
}

async function buildWorld(options: { specialtyRequired?: boolean } = {}): Promise<World> {
  await ensureRole('facility_owner', ROLE_PERMISSIONS.facility_owner ?? []);

  const state = await createState();
  const lga = await createLga(state.id);
  const facilityType = await createFacilityType();
  const representative = await createUser({ fullName: 'Facility Representative' });
  const ops = await createUser({ fullName: 'Operations Officer' });
  const officer = await createUser({ fullName: 'Compliance Officer' });

  sequence += 1;
  const facility = await createFacility({
    name: 'Owerri General Hospital',
    facilityTypeId: facilityType.id,
    cacNumber: `RC${700_000 + sequence}`,
    stateId: state.id,
    lgaId: lga.id,
    addressLine: '14 Wetheral Road, Owerri',
    contactPhone: '+2348031234567',
    representativeUserId: representative.id,
    actorId: ops.id,
  });
  await verifyFacility({ facilityId: facility.id, verifierId: officer.id, decision: 'approve' });

  // The regulator must match the one the practitioner is registered under:
  // eligibility looks up the registration by the category's own regulator.
  const category = await createProfessionalCategory({ regulator: 'MDCN' });
  const specialty = await createSpecialty(category.id);

  // One mandatory credential for the whole category, created once. Adding a
  // requirement per practitioner would make each of them ineligible for the
  // others' credentials, which is a fixture bug that looks like a rule.
  const credentialType = await createCredentialType({ verificationMethod: 'nimc_verification' });
  await prisma.credentialRequirement.create({
    data: {
      professionalCategoryId: category.id,
      credentialTypeId: credentialType.id,
      isMandatory: true,
      owner: 'test-fixture',
    },
  });

  const scheduler = await createUser({ fullName: 'Facility Scheduler' });
  await grant({
    userId: scheduler.id,
    roleKey: 'facility_scheduler',
    permissions: ['service_request.read', 'service_request.publish', 'assignment.confirm'],
    scopeType: 'FACILITY',
    scopeId: facility.id,
  });
  await issueSession({ userId: scheduler.id });

  const request = await createServiceRequest({
    facilityId: facility.id,
    professionalCategoryId: category.id,
    specialtyId: options.specialtyRequired ? specialty.id : undefined,
    shiftType: 'DAY',
    startsAt: SHIFT_START,
    endsAt: SHIFT_END,
    headcount: 1,
    hourlyRateKobo: 500_000,
    urgency: 'ROUTINE',
    cancellationTerms: 'Either party may cancel up to 24 hours before the shift.',
    actorId: scheduler.id,
  });

  return {
    facilityId: facility.id,
    facilityLgaId: lga.id,
    facilityStateId: state.id,
    categoryId: category.id,
    specialtyId: specialty.id,
    requestId: request.id,
    schedulerId: scheduler.id,
    credentialTypeId: credentialType.id,
  };
}

/**
 * A practitioner who clears every hard filter: eligible, available for the
 * shift, and willing to travel.
 */
async function eligiblePractitioner(
  world: World,
  overrides: {
    fullName?: string;
    yearsOfExperience?: number;
    homeStateId?: string | null;
    homeLgaId?: string | null;
    specialtyId?: string;
    available?: boolean;
    travelPreference?: 'SAME_LGA' | 'SAME_STATE' | 'ANYWHERE';
  } = {},
) {
  const user = await createUser({ fullName: overrides.fullName ?? `Practitioner ${sequence}` });
  const officer = await createUser({ fullName: 'Compliance Officer' });

  await createProfile({
    userId: user.id,
    professionalCategoryId: world.categoryId,
    specialtyId: overrides.specialtyId,
    yearsOfExperience: overrides.yearsOfExperience ?? 5,
    homeStateId: overrides.homeStateId === undefined ? world.facilityStateId : (overrides.homeStateId ?? undefined),
    homeLgaId: overrides.homeLgaId === undefined ? world.facilityLgaId : (overrides.homeLgaId ?? undefined),
    travelPreference: overrides.travelPreference,
  });

  sequence += 1;
  await recordIdentityVerification({
    userId: user.id,
    nin: String(10_000_000_000 + sequence),
    nameMatch: true,
    actorId: officer.id,
  });
  await recordProfessionalRegistration({
    userId: user.id,
    regulator: 'MDCN',
    folioNumber: `MDCN/R/${100_000 + sequence}`,
    registrationStatus: 'ACTIVE',
    actorId: officer.id,
  });
  await screenPractitioner(user.id);

  // The category's one mandatory credential, verified — so eligibility turns
  // on the things this file is actually about.
  await prisma.credentialSubmission.create({
    data: {
      userId: user.id,
      credentialTypeId: world.credentialTypeId,
      status: 'VERIFIED',
      referenceNumber: 'A123456789',
    },
  });

  if (overrides.available !== false) {
    await addSlot({
      userId: user.id,
      kind: 'ONE_OFF',
      startsAt: new Date(SHIFT_START.getTime() - 60 * 60 * 1000),
      endsAt: new Date(SHIFT_END.getTime() + 60 * 60 * 1000),
    });
  }

  return user;
}

function ranked(body: Record<string, unknown>) {
  return body.ranked as { userId: string; rank: number; score: number; factors: unknown[] }[];
}

function excluded(body: Record<string, unknown>) {
  return body.excluded as { userId: string; reasons: string[] }[];
}

beforeEach(() => {
  clearCookies();
});

describe('running a match', () => {
  it('ranks an eligible, available practitioner and explains the score', async () => {
    const world = await buildWorld();
    const practitioner = await eligiblePractitioner(world);
    await issueSession({ userId: world.schedulerId });

    const result = await callMatch(world.requestId, world.facilityId);

    expect(result.status).toBe(201);
    expect(ranked(result.body)).toHaveLength(1);
    expect(ranked(result.body)[0]?.userId).toBe(practitioner.id);
    // Every factor, its weight and what it contributed.
    expect(ranked(result.body)[0]?.factors).toHaveLength(4);
  });

  it('excludes an ineligible practitioner, naming the Stage 5 rule', async () => {
    const world = await buildWorld();
    const user = await createUser({ fullName: 'Unverified Practitioner' });
    await createProfile({
      userId: user.id,
      professionalCategoryId: world.categoryId,
      yearsOfExperience: 5,
    });
    await issueSession({ userId: world.schedulerId });

    const result = await callMatch(world.requestId, world.facilityId);

    // Rule 5 of the README, reached through the eligibility invariant.
    expect(ranked(result.body)).toHaveLength(0);
    expect(excluded(result.body)[0]).toMatchObject({
      userId: user.id,
      reasons: expect.arrayContaining(['not_eligible']),
    });
  });

  it('excludes a practitioner whose availability is blocked', async () => {
    const world = await buildWorld();
    const practitioner = await eligiblePractitioner(world);
    await addBlock({
      userId: practitioner.id,
      startsAt: new Date(SHIFT_START.getTime() + 60 * 60 * 1000),
      endsAt: new Date(SHIFT_START.getTime() + 2 * 60 * 60 * 1000),
      reason: 'Hospital training day',
    });
    await issueSession({ userId: world.schedulerId });

    const result = await callMatch(world.requestId, world.facilityId);

    // Step 6.2's stated verification, through the matcher itself.
    expect(ranked(result.body)).toHaveLength(0);
    expect(excluded(result.body)[0]?.reasons).toContain('blocked');
  });

  it('excludes a practitioner who has offered no availability at all', async () => {
    const world = await buildWorld();
    await eligiblePractitioner(world, { available: false });
    await issueSession({ userId: world.schedulerId });

    const result = await callMatch(world.requestId, world.facilityId);
    expect(excluded(result.body)[0]?.reasons).toContain('unavailable');
  });

  it('excludes a practitioner without the requested specialty', async () => {
    const world = await buildWorld({ specialtyRequired: true });
    await eligiblePractitioner(world);
    await issueSession({ userId: world.schedulerId });

    const result = await callMatch(world.requestId, world.facilityId);

    expect(ranked(result.body)).toHaveLength(0);
    expect(excluded(result.body)[0]?.reasons).toContain('specialty_mismatch');
  });

  it('ranks the nearer practitioner above the further one', async () => {
    const world = await buildWorld();
    const otherState = await createState();
    const near = await eligiblePractitioner(world, { fullName: 'Near Practitioner' });
    const far = await eligiblePractitioner(world, {
      fullName: 'Far Practitioner',
      homeStateId: otherState.id,
      homeLgaId: null,
      // Otherwise the default SAME_STATE preference excludes them outright,
      // and this test would be measuring the wrong thing.
      travelPreference: 'ANYWHERE',
    });
    await issueSession({ userId: world.schedulerId });

    const result = await callMatch(world.requestId, world.facilityId);
    const order = ranked(result.body).map((entry) => entry.userId);

    expect(order[0]).toBe(near.id);
    expect(order[1]).toBe(far.id);
  });

  it('is reproducible: two runs of the same world give the same ranking', async () => {
    const world = await buildWorld();
    await eligiblePractitioner(world, { fullName: 'One', yearsOfExperience: 3 });
    await eligiblePractitioner(world, { fullName: 'Two', yearsOfExperience: 8 });
    await issueSession({ userId: world.schedulerId });

    const first = await callMatch(world.requestId, world.facilityId);
    const second = await callMatch(world.requestId, world.facilityId);

    expect(ranked(first.body)).toHaveLength(2);
    // 6.3's "the same inputs give the same ranking", through the whole stack
    // rather than only through the pure engine.
    expect(ranked(second.body).map((entry) => [entry.userId, entry.rank, entry.score])).toEqual(
      ranked(first.body).map((entry) => [entry.userId, entry.rank, entry.score]),
    );
  });
});

describe('step 6.4 — cold start', () => {
  it('matches a practitioner with no history at all', async () => {
    const world = await buildWorld();
    const newcomer = await eligiblePractitioner(world);
    await issueSession({ userId: world.schedulerId });

    const result = await callMatch(world.requestId, world.facilityId);

    // Nothing completes an assignment until Stage 7, so today every
    // practitioner is in cold start — which makes this the case that matters.
    expect(ranked(result.body)[0]?.userId).toBe(newcomer.id);

    const reliability = (
      ranked(result.body)[0]?.factors as { factor: string; detail: string }[]
    ).find((entry) => entry.factor === 'reliability');
    expect(reliability?.detail).toContain('neutral');
  });

  it('gives two newcomers identical reliability, so it cannot decide between them', async () => {
    const world = await buildWorld();
    await eligiblePractitioner(world, { fullName: 'First Newcomer' });
    await eligiblePractitioner(world, { fullName: 'Second Newcomer' });
    await issueSession({ userId: world.schedulerId });

    const result = await callMatch(world.requestId, world.facilityId);
    const scores = (
      ranked(result.body).map((entry) => entry.factors) as { factor: string; points: number }[][]
    ).map((factors) => factors.find((entry) => entry.factor === 'reliability')?.points);

    expect(scores[0]).toBe(scores[1]);
  });
});

describe('explaining a run afterwards', () => {
  it('stores every candidate, ranked and excluded, with the weights in force', async () => {
    const world = await buildWorld();
    const good = await eligiblePractitioner(world);
    const bad = await createUser({ fullName: 'Ineligible Practitioner' });
    await createProfile({
      userId: bad.id,
      professionalCategoryId: world.categoryId,
      yearsOfExperience: 1,
    });
    await issueSession({ userId: world.schedulerId });

    const run = await callMatch(world.requestId, world.facilityId);
    const stored = await callReadRun(run.body.id as string, world.facilityId);

    expect(stored.status).toBe(200);
    // Step 6.3's gate evidence: every factor and its contribution, kept.
    const candidates = stored.body.candidates as {
      userId: string;
      rank: number | null;
      factors: unknown;
      exclusions: string[];
    }[];
    expect(candidates).toHaveLength(2);

    const rankedRow = candidates.find((row) => row.userId === good.id);
    expect(rankedRow?.rank).toBe(1);
    expect(rankedRow?.factors).not.toBeNull();

    const excludedRow = candidates.find((row) => row.userId === bad.id);
    expect(excludedRow?.rank).toBeNull();
    expect(excludedRow?.exclusions).toContain('not_eligible');

    // Without the weights, an old ranking cannot be read back once they
    // change, and "why did they rank there" becomes unanswerable.
    expect(stored.body.weights).toMatchObject({ proximity: expect.any(Number) });
  });

  it("refuses another facility's run as absent", async () => {
    const first = await buildWorld();
    await eligiblePractitioner(first);
    await issueSession({ userId: first.schedulerId });
    const run = await callMatch(first.requestId, first.facilityId);

    const second = await buildWorld();
    await issueSession({ userId: second.schedulerId });
    const stolen = await callReadRun(run.body.id as string, second.facilityId);

    expect(stolen.status).toBe(404);
  });
});

describe('authorisation', () => {
  it('refuses a caller who may read requests but not confirm', async () => {
    const world = await buildWorld();
    const reader = await createUser();
    await grant({
      userId: reader.id,
      roleKey: 'facility_administrator',
      permissions: ['service_request.read'],
      scopeType: 'FACILITY',
      scopeId: world.facilityId,
    });
    await issueSession({ userId: reader.id });

    // Running a match puts names in front of a facility, which is closer to
    // confirming somebody than to reading a request.
    expect((await callMatch(world.requestId, world.facilityId)).status).toBe(403);
  });

  it('refuses a scheduler at another facility', async () => {
    const first = await buildWorld();
    const second = await buildWorld();

    // buildWorld left the second facility's scheduler logged in.
    expect((await callMatch(first.requestId, first.facilityId)).status).toBe(403);
    expect((await callMatch(second.requestId, second.facilityId)).status).toBe(201);
  });
});
