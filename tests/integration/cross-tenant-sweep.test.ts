import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/modules/practitioners/application/bookable', () => import('./support/always-bookable'));

vi.mock('next/headers', async () => {
  const { cookieJar } = await import('./support/cookie-jar');
  return { cookies: () => cookieJar };
});

vi.mock('@/lib/storage/tigris', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/storage/tigris')>();
  return { ...actual, headObject: vi.fn().mockResolvedValue({}) };
});

import { prisma } from '@/lib/db';
import { ROLE_PERMISSIONS } from '@/lib/authz/permissions';
import { raiseDispute } from '@/modules/disputes/application/dispute';
import { addBlock, addSlot } from '@/modules/availability/application/availability';
import { issueSession } from '@/modules/auth/application/session-service';
import { clearCookies } from './support/cookie-jar';
import { approved, buildWorld, type World } from './support/dispute-world';
import { createCredentialType, createUser, grant } from './support/fixtures';

/**
 * AUT-10 / QAL-01. The pattern behind the review's most serious findings was a
 * route that took an id, proved the caller held a permission somewhere, and never
 * asked whether the thing named was in the place they held it. Each of those was
 * fixed with its own test; this is the sweep: every route that takes an id or a
 * facility, called as somebody from another hospital and as another practitioner,
 * with a body that gets past validation, so that what answers is the tenant check
 * and nothing earlier.
 *
 * What a pass means is exact. The answer is 401, 403 or 404, the body carries
 * nothing of the other tenant, and the world is byte for byte what it was before.
 * A 422 is not a pass: validation runs before authorisation, so a malformed probe
 * proves nothing, and the sweep fails on it rather than counting it.
 */

const CANARY = 'CANARY';
const REFUSED = [401, 403, 404];

interface Ctx {
  a: World;
  b: World;
  /** Somebody at hospital B holding every facility permission there, and nothing at A. */
  attackerFacility: string;
  /** Another practitioner, holding the practitioner role over themselves only. */
  attackerPractitioner: string;
  requestId: string;
  matchRunId: string;
  invitationId: string;
  grantId: string;
  slotId: string;
  blockId: string;
  credentialId: string;
  disputeId: string;
  evidenceId: string;
  victimPhone: string;
}

let ctx: Ctx;

async function world(): Promise<Ctx> {
  const a = await buildWorld();
  const b = await buildWorld();

  // Names that cannot be mistaken for anything else, so a leak is a string match.
  await prisma.user.update({ where: { id: a.practitionerId }, data: { fullName: `${CANARY}-Practitioner-Adaku` } });
  await prisma.facility.update({ where: { id: a.facilityId }, data: { name: `${CANARY}-Hospital-A` } });

  await approved(a);
  const dispute = await raiseDispute({
    assignmentId: a.assignmentId,
    actorId: a.practitionerId,
    category: 'HOURS',
    reason: `${CANARY}-complaint about two short hours`,
  });
  await prisma.storedObject.create({
    data: { bucket: 'test', objectKey: 'dispute_evidence/test/canary.jpg', contentType: 'image/jpeg', sizeBytes: 10, purpose: 'dispute_evidence', ownerUserId: a.practitionerId },
  });
  const evidence = await prisma.disputeEvidence.create({
    data: { disputeId: dispute.id, objectKey: 'dispute_evidence/test/canary.jpg', attachedBy: a.practitionerId, note: `${CANARY}-note` },
  });

  const assignment = await prisma.assignment.findUniqueOrThrow({ where: { id: a.assignmentId } });
  const matchRun = await prisma.matchRun.create({
    data: { serviceRequestId: assignment.serviceRequestId, consideredCount: 1, rankedCount: 1, weights: {} },
  });
  const invitation = await prisma.invitation.findFirstOrThrow({ where: { userId: a.practitionerId } });
  const grantRow = await prisma.userRole.findFirstOrThrow({ where: { scopeId: a.facilityId, revokedAt: null } });

  const slot = await addSlot({ userId: a.practitionerId, kind: 'RECURRING_WEEKLY', dayOfWeek: 1, startMinute: 480, endMinute: 960 });
  const block = await addBlock({
    userId: a.practitionerId,
    startsAt: new Date(Date.now() + 10 * 86_400_000),
    endsAt: new Date(Date.now() + 12 * 86_400_000),
    reason: `${CANARY}-leave`,
  });
  const type = await createCredentialType({ verificationMethod: 'document_review' });
  const credential = await prisma.credentialSubmission.create({
    data: { userId: a.practitionerId, credentialTypeId: type.id, status: 'PENDING', referenceNumber: `${CANARY}-REF` },
  });

  const attackerFacility = await createUser({ fullName: 'Attacker At Hospital B' });
  await grant({
    userId: attackerFacility.id,
    roleKey: 'facility_owner_probe',
    permissions: ROLE_PERMISSIONS.facility_owner ?? [],
    scopeType: 'FACILITY',
    scopeId: b.facilityId,
  });
  const attackerPractitioner = await createUser({ fullName: 'Attacker Practitioner' });
  await grant({
    userId: attackerPractitioner.id,
    roleKey: 'practitioner_probe',
    permissions: ROLE_PERMISSIONS.practitioner ?? [],
    scopeType: 'SELF',
    scopeId: attackerPractitioner.id,
  });

  const victim = await prisma.user.findUniqueOrThrow({ where: { id: a.practitionerId } });

  return {
    a,
    b,
    attackerFacility: attackerFacility.id,
    attackerPractitioner: attackerPractitioner.id,
    requestId: assignment.serviceRequestId,
    matchRunId: matchRun.id,
    invitationId: invitation.id,
    grantId: grantRow.id,
    slotId: slot.id,
    blockId: block.id,
    credentialId: credential.id,
    disputeId: dispute.id,
    evidenceId: evidence.id,
    victimPhone: victim.phone,
  };
}

/** Everything the probes could change, as one string. Identical before and after means nothing moved. */
async function fingerprint(): Promise<string> {
  const parts = await Promise.all([
    prisma.serviceRequest.findMany({ orderBy: { id: 'asc' } }),
    prisma.invitation.findMany({ orderBy: { id: 'asc' } }),
    prisma.assignment.findMany({ orderBy: { id: 'asc' } }),
    prisma.assignmentStatusHistory.findMany({ orderBy: { id: 'asc' } }),
    prisma.attendanceRecord.findMany({ orderBy: { id: 'asc' } }),
    prisma.checkInEvent.findMany({ orderBy: { id: 'asc' } }),
    prisma.checkInToken.findMany({ orderBy: { id: 'asc' } }),
    prisma.timesheet.findMany({ orderBy: { id: 'asc' } }),
    prisma.timesheetRevision.findMany({ orderBy: { id: 'asc' } }),
    prisma.dispute.findMany({ orderBy: { id: 'asc' } }),
    prisma.disputeEvidence.findMany({ orderBy: { id: 'asc' } }),
    prisma.userRole.findMany({ orderBy: { id: 'asc' } }),
    prisma.facility.findMany({ orderBy: { id: 'asc' } }),
    prisma.availabilitySlot.findMany({ orderBy: { id: 'asc' } }),
    prisma.blockedPeriod.findMany({ orderBy: { id: 'asc' } }),
    prisma.credentialSubmission.findMany({ orderBy: { id: 'asc' } }),
    prisma.storedObject.findMany({ orderBy: { id: 'asc' } }),
    prisma.excusal.findMany({ orderBy: { id: 'asc' } }),
    prisma.invoice.count(),
  ]);
  return JSON.stringify(parts);
}

// --------------------------------------------------------------------- the calls

// Vite's glob, typed here because the integration config does not pull in its client types.
const modules = (
  import.meta as unknown as { glob: (pattern: string) => Record<string, () => Promise<unknown>> }
).glob('/src/app/api/v1/**/route.ts');

interface Probe {
  /** The route, as its folder reads: `service-requests/[id]/publish`. */
  route: string;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  as: 'facility' | 'practitioner';
  /** The path parameters, from the world. */
  params?: (c: Ctx) => Record<string, string>;
  /** Query string for a GET or DELETE. `facility` is the facility the caller names. */
  query?: (c: Ctx, facility: string) => Record<string, string>;
  body?: (c: Ctx, facility: string) => unknown;
  /**
   * A list of the caller's own, which they may read when they name their own
   * hospital: that answer is 200, and what is checked is that it carries nothing
   * of the other tenant. Naming the other hospital is still refused.
   */
  ownList?: true;
}

const NOW = Date.now();
const HOURS = {
  checkedInAt: new Date(NOW - 20 * 3600_000).toISOString(),
  checkedOutAt: new Date(NOW - 12 * 3600_000).toISOString(),
};

const PROBES: Probe[] = [
  // ------------------------------------------------ a facility, reaching for another's records
  { route: 'service-requests/[id]', method: 'GET', as: 'facility', params: (c) => ({ id: c.requestId }), query: (_c, f) => ({ facilityId: f }) },
  { route: 'service-requests/[id]/publish', method: 'POST', as: 'facility', params: (c) => ({ id: c.requestId }), body: (_c, f) => ({ facilityId: f }) },
  { route: 'service-requests/[id]/cancel', method: 'POST', as: 'facility', params: (c) => ({ id: c.requestId }), body: (_c, f) => ({ facilityId: f, reason: 'Cancelled by mistake' }) },
  { route: 'service-requests/[id]/confirm', method: 'POST', as: 'facility', params: (c) => ({ id: c.requestId }), body: (c, f) => ({ facilityId: f, userId: c.a.practitionerId }) },
  { route: 'service-requests/[id]/invitations', method: 'GET', as: 'facility', params: (c) => ({ id: c.requestId }), query: (_c, f) => ({ facilityId: f }) },
  { route: 'service-requests/[id]/invite', method: 'POST', as: 'facility', params: (c) => ({ id: c.requestId }), body: (c, f) => ({ facilityId: f, userIds: [c.a.practitionerId] }) },
  { route: 'service-requests/[id]/match', method: 'POST', as: 'facility', params: (c) => ({ id: c.requestId }), body: (_c, f) => ({ facilityId: f }) },
  { route: 'match-runs/[id]', method: 'GET', as: 'facility', params: (c) => ({ id: c.matchRunId }), query: (_c, f) => ({ facilityId: f }) },
  { route: 'assignments/[id]/attendance', method: 'GET', as: 'facility', params: (c) => ({ id: c.a.assignmentId }), query: (_c, f) => ({ scopeType: 'FACILITY', scopeId: f }) },
  { route: 'assignments/[id]/attendance/manual', method: 'POST', as: 'facility', params: (c) => ({ id: c.a.assignmentId }), body: (_c, f) => ({ facilityId: f, ...HOURS, breakMinutes: 0, reason: 'Network was down all night.' }) },
  { route: 'assignments/[id]/attendance/token', method: 'POST', as: 'facility', params: (c) => ({ id: c.a.assignmentId }), body: (_c, f) => ({ facilityId: f, purpose: 'CHECK_IN' }) },
  { route: 'assignments/[id]/cancel', method: 'POST', as: 'facility', params: (c) => ({ id: c.a.assignmentId }), body: (_c, f) => ({ facilityId: f, reason: 'We no longer need them' }) },
  { route: 'assignments/[id]/disputes', method: 'POST', as: 'facility', params: (c) => ({ id: c.a.assignmentId }), body: (_c, f) => ({ facilityId: f, category: 'CONDUCT', reason: 'They left the ward without handing over to the incoming doctor.' }) },
  { route: 'assignments/[id]/disputes', method: 'GET', as: 'facility', params: (c) => ({ id: c.a.assignmentId }), query: (_c, f) => ({ scopeType: 'FACILITY', scopeId: f }) },
  { route: 'assignments/[id]/timesheet', method: 'GET', as: 'facility', params: (c) => ({ id: c.a.assignmentId }), query: (_c, f) => ({ scopeType: 'FACILITY', scopeId: f }) },
  { route: 'assignments/[id]/timesheet/correct', method: 'POST', as: 'facility', params: (c) => ({ id: c.a.assignmentId }), body: (_c, f) => ({ facilityId: f, breakMinutes: 45, reason: 'The break was three quarters of an hour.' }) },
  { route: 'assignments/[id]/timesheet/review', method: 'POST', as: 'facility', params: (c) => ({ id: c.a.assignmentId }), body: (_c, f) => ({ facilityId: f, decision: 'approve' }) },
  { route: 'disputes/[id]', method: 'GET', as: 'facility', params: (c) => ({ id: c.disputeId }), query: (_c, f) => ({ facilityId: f }) },
  { route: 'disputes/[id]/withdraw', method: 'POST', as: 'facility', params: (c) => ({ id: c.disputeId }), body: (_c, f) => ({ facilityId: f }) },
  { route: 'disputes/[id]/evidence', method: 'POST', as: 'facility', params: (c) => ({ id: c.disputeId }), body: (_c, f) => ({ facilityId: f, objectKey: 'dispute_evidence/test/canary.jpg' }) },
  { route: 'disputes/[id]/evidence/upload-url', method: 'POST', as: 'facility', params: (c) => ({ id: c.disputeId }), body: (_c, f) => ({ facilityId: f, filename: 'a.pdf', contentType: 'application/pdf', sizeBytes: 100 }) },
  { route: 'disputes/[id]/evidence/[evidenceId]/url', method: 'POST', as: 'facility', params: (c) => ({ id: c.disputeId, evidenceId: c.evidenceId }), body: (_c, f) => ({ facilityId: f }) },
  { route: 'grants/[id]/revoke', method: 'POST', as: 'facility', params: (c) => ({ id: c.grantId }), body: (_c, f) => ({ scopeType: 'FACILITY', scopeId: f, reason: 'No longer works here' }) },
  { route: 'grants', method: 'GET', as: 'facility', query: (_c, f) => ({ scopeType: 'FACILITY', scopeId: f }) },
  { route: 'grants/find', method: 'GET', as: 'facility', query: (c, f) => ({ scopeType: 'FACILITY', scopeId: f, phone: c.victimPhone }) },
  { route: 'grants', method: 'POST', as: 'facility', body: (c, f) => ({ userId: c.attackerFacility, roleKey: 'facility_administrator', scopeType: 'FACILITY', scopeId: f }) },
  { route: 'facilities/[id]', method: 'GET', as: 'facility', params: (c) => ({ id: c.a.facilityId }), query: () => ({}) },
  { route: 'facilities/[id]', method: 'PATCH', as: 'facility', params: (c) => ({ id: c.a.facilityId }), body: () => ({ addressLine: '1 Test Road, Ibadan' }) },
  { route: 'facilities/[id]/licence-url', method: 'POST', as: 'facility', params: (c) => ({ id: c.a.facilityId }), body: () => ({}) },
  { route: 'facilities/[id]/licence-upload-url', method: 'POST', as: 'facility', params: (c) => ({ id: c.a.facilityId }), body: () => ({ filename: 'a.pdf', contentType: 'application/pdf', sizeBytes: 100 }) },
  { route: 'rate-cards', method: 'GET', as: 'facility', query: (_c, f) => ({ facilityId: f }), ownList: true },
  { route: 'incidents', method: 'GET', as: 'facility', query: (_c, f) => ({ facilityId: f }), ownList: true },
  { route: 'invoices', method: 'GET', as: 'facility', query: (_c, f) => ({ facilityId: f }), ownList: true },
  { route: 'agreements/facility', method: 'GET', as: 'facility', query: (_c, f) => ({ facilityId: f }), ownList: true },
  { route: 'dashboard/facility', method: 'GET', as: 'facility', query: (_c, f) => ({ facilityId: f }), ownList: true },
  { route: 'facilities', method: 'GET', as: 'facility', query: (_c, f) => ({ scopeType: 'FACILITY', scopeId: f }), ownList: true },
  { route: 'service-requests', method: 'GET', as: 'facility', query: (_c, f) => ({ scopeType: 'FACILITY', scopeId: f }), ownList: true },

  // ------------------------------------------------ a practitioner, reaching for another's
  { route: 'invitations/[id]/respond', method: 'POST', as: 'practitioner', params: (c) => ({ id: c.invitationId }), body: () => ({ decision: 'decline', reason: 'Not available' }) },
  { route: 'assignments/[id]/attendance/present', method: 'POST', as: 'practitioner', params: (c) => ({ id: c.a.assignmentId }), body: () => ({ purpose: 'CHECK_IN', code: '123456' }) },
  { route: 'assignments/[id]/excusals', method: 'POST', as: 'practitioner', params: (c) => ({ id: c.a.assignmentId }), body: () => ({ reason: 'I was ill on the day and could not reach the ward.' }) },
  { route: 'assignments/[id]/timesheet/submit', method: 'POST', as: 'practitioner', params: (c) => ({ id: c.a.assignmentId }), body: () => ({}) },
  { route: 'assignments/[id]/attendance', method: 'GET', as: 'practitioner', params: (c) => ({ id: c.a.assignmentId }), query: (c) => ({ scopeType: 'SELF', scopeId: c.a.practitionerId }) },
  { route: 'assignments/[id]/timesheet', method: 'GET', as: 'practitioner', params: (c) => ({ id: c.a.assignmentId }), query: (c) => ({ scopeType: 'SELF', scopeId: c.a.practitionerId }) },
  { route: 'assignments/[id]/disputes', method: 'GET', as: 'practitioner', params: (c) => ({ id: c.a.assignmentId }), query: (c) => ({ scopeType: 'SELF', scopeId: c.a.practitionerId }) },
  { route: 'assignments/[id]/disputes', method: 'POST', as: 'practitioner', params: (c) => ({ id: c.a.assignmentId }), body: () => ({ category: 'HOURS', reason: 'The approved hours are two short: I stayed until the night staff arrived.' }) },
  { route: 'availability/slots/[id]', method: 'DELETE', as: 'practitioner', params: (c) => ({ id: c.slotId }), query: () => ({}) },
  { route: 'availability/blocks/[id]', method: 'DELETE', as: 'practitioner', params: (c) => ({ id: c.blockId }), query: () => ({}) },
  { route: 'availability', method: 'GET', as: 'practitioner', query: (c) => ({ scopeType: 'SELF', scopeId: c.a.practitionerId }) },
  { route: 'credentials/[id]', method: 'PATCH', as: 'practitioner', params: (c) => ({ id: c.credentialId }), body: () => ({ referenceNumber: 'NEW-REF-1' }) },
  { route: 'credentials/[id]/document-url', method: 'POST', as: 'practitioner', params: (c) => ({ id: c.credentialId }), body: (c) => ({ scopeType: 'SELF', scopeId: c.a.practitionerId }) },
  { route: 'credentials', method: 'GET', as: 'practitioner', query: (c) => ({ scopeType: 'SELF', scopeId: c.a.practitionerId }) },
  { route: 'payouts', method: 'GET', as: 'practitioner', query: (c) => ({ scopeType: 'SELF', scopeId: c.a.practitionerId }) },
  { route: 'practitioners/eligibility', method: 'GET', as: 'practitioner', query: (c) => ({ scopeType: 'SELF', scopeId: c.a.practitionerId }) },
  { route: 'practitioners/verification', method: 'GET', as: 'practitioner', query: (c) => ({ scopeType: 'SELF', scopeId: c.a.practitionerId }) },
  { route: 'disputes/[id]', method: 'GET', as: 'practitioner', params: (c) => ({ id: c.disputeId }), query: () => ({}) },
  { route: 'disputes/[id]/withdraw', method: 'POST', as: 'practitioner', params: (c) => ({ id: c.disputeId }), body: () => ({}) },
  { route: 'disputes/[id]/evidence', method: 'POST', as: 'practitioner', params: (c) => ({ id: c.disputeId }), body: () => ({ objectKey: 'dispute_evidence/test/canary.jpg' }) },
  { route: 'disputes/[id]/evidence/upload-url', method: 'POST', as: 'practitioner', params: (c) => ({ id: c.disputeId }), body: () => ({ filename: 'a.pdf', contentType: 'application/pdf', sizeBytes: 100 }) },
  { route: 'disputes/[id]/evidence/[evidenceId]/url', method: 'POST', as: 'practitioner', params: (c) => ({ id: c.disputeId, evidenceId: c.evidenceId }), body: () => ({}) },
];

async function invoke(probe: Probe, facility: string): Promise<{ status: number; text: string }> {
  const key = `/src/app/api/v1/${probe.route}/route.ts`;
  const load = modules[key];
  if (!load) throw new Error(`No route at ${key}`);
  const handler = ((await load()) as Record<string, (request: Request, props?: { params: Promise<Record<string, string>> }) => Promise<Response>>)[probe.method];
  if (!handler) throw new Error(`${probe.route} has no ${probe.method}`);

  const params = probe.params?.(ctx) ?? {};
  let path = `/api/v1/${probe.route}`;
  for (const [name, value] of Object.entries(params)) path = path.replace(`[${name}]`, value);
  const query = new URLSearchParams(probe.query?.(ctx, facility) ?? {}).toString();
  const url = `http://localhost${path}${query ? `?${query}` : ''}`;

  const request =
    probe.method === 'GET' || probe.method === 'DELETE'
      ? new Request(url, { method: probe.method })
      : new Request(url, {
          method: probe.method,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(probe.body?.(ctx, facility) ?? {}),
        });

  const response = await handler(request, { params: Promise.resolve(params) });
  return { status: response.status, text: await response.text() };
}

/**
 * Runs the probes as one caller and reports each that was not refused cleanly. The
 * world is built once per test and the probes are read-only questions about it:
 * the suite empties the database before every test, so building it per probe would
 * be a hundred rebuilds for the same answer.
 */
async function sweep(
  userId: string | null,
  probes: Probe[],
  facilities: (probe: Probe) => string[],
): Promise<string[]> {
  const failures: string[] = [];

  for (const probe of probes) {
    for (const facility of facilities(probe)) {
      clearCookies();
      if (userId) await issueSession({ userId });
      const before = await fingerprint();

      const { status, text } = await invoke(probe, facility);

      const label = `${probe.method} ${probe.route} (facility ${facility === ctx.a.facilityId ? 'A' : 'B'})`;
      // Reading its own list is not a breach, so long as it is its own.
      const mayRead = probe.ownList === true && facility === ctx.b.facilityId && userId === ctx.attackerFacility;
      if (mayRead ? status !== 200 : !REFUSED.includes(status)) {
        failures.push(`${label} answered ${status}: ${text.slice(0, 200)}`);
      }
      if (text.includes(CANARY)) failures.push(`${label} leaked the other tenant: ${text.slice(0, 200)}`);
      if (text.includes(ctx.victimPhone)) failures.push(`${label} leaked a phone number`);
      if ((await fingerprint()) !== before) failures.push(`${label} changed the world`);
    }
  }

  return failures;
}

beforeEach(() => {
  clearCookies();
});

describe('every route that takes an id, called by somebody it is not for', () => {
  it('has the other hospital\'s records in the world, so a pass means something', async () => {
    ctx = await world();

    expect(await prisma.serviceRequest.count()).toBeGreaterThanOrEqual(2);
    expect(await prisma.dispute.count()).toBe(1);
    expect(await prisma.availabilitySlot.count()).toBe(1);
    expect(await prisma.credentialSubmission.count()).toBe(1);
    expect(ctx.a.facilityId).not.toBe(ctx.b.facilityId);
    const grants = await prisma.userRole.findMany({ where: { userId: ctx.attackerFacility, revokedAt: null } });
    expect(grants.every((row) => row.scopeId === ctx.b.facilityId)).toBe(true);
  });

  it('refuses a facility reaching for another hospital\'s records, naming either hospital', async () => {
    ctx = await world();

    const failures = await sweep(
      ctx.attackerFacility,
      PROBES.filter((probe) => probe.as === 'facility'),
      () => [ctx.a.facilityId, ctx.b.facilityId],
    );

    expect(failures).toEqual([]);
  });

  it('refuses a practitioner reaching for another practitioner\'s records', async () => {
    ctx = await world();

    const failures = await sweep(
      ctx.attackerPractitioner,
      PROBES.filter((probe) => probe.as === 'practitioner'),
      () => [ctx.a.facilityId],
    );

    expect(failures).toEqual([]);
  });

  it('refuses somebody with no grants at all on every route, never serving and never erroring', async () => {
    ctx = await world();
    const nobody = await createUser({ fullName: 'Nobody At All' });

    const failures = await sweep(nobody.id, PROBES, (probe) =>
      probe.as === 'facility' ? [ctx.a.facilityId, ctx.b.facilityId] : [ctx.a.facilityId],
    );

    expect(failures).toEqual([]);
  });

  it('tells a caller who is not signed in to sign in, on every route in the sweep', async () => {
    ctx = await world();
    clearCookies();
    const answers: string[] = [];

    for (const probe of PROBES) {
      const { status } = await invoke(probe, ctx.a.facilityId);
      if (status !== 401) answers.push(`${probe.method} ${probe.route} -> ${status}`);
    }

    expect(answers).toEqual([]);
  });
});
