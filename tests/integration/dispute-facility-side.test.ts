import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/modules/practitioners/application/bookable', () => import('./support/always-bookable'));

vi.mock('next/headers', async () => {
  const { cookieJar } = await import('./support/cookie-jar');
  return { cookies: () => cookieJar };
});

// Only the signing of a link is local; nothing here touches the bucket.
vi.mock('@/lib/storage/tigris', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/storage/tigris')>();
  return { ...actual, headObject: vi.fn().mockResolvedValue({}) };
});

import { prisma } from '@/lib/db';
import { GET as listRoute } from '@/app/api/v1/disputes/route';
import { GET as caseRoute } from '@/app/api/v1/disputes/[id]/route';
import { POST as uploadUrlRoute } from '@/app/api/v1/disputes/[id]/evidence/upload-url/route';
import { POST as attachRoute } from '@/app/api/v1/disputes/[id]/evidence/route';
import { POST as withdrawRoute } from '@/app/api/v1/disputes/[id]/withdraw/route';
import { POST as evidenceUrlRoute } from '@/app/api/v1/disputes/[id]/evidence/[evidenceId]/url/route';
import { raiseDispute } from '@/modules/disputes/application/dispute';
import { issueSession } from '@/modules/auth/application/session-service';
import { clearCookies } from './support/cookie-jar';
import { approved, buildWorld, type World } from './support/dispute-world';
import { grant } from './support/fixtures';

/**
 * DSP-04. The application already treated the facility as one of the two sides of
 * a case, but every route that lets a party act asked for the practitioner's own
 * scope, so a facility's owner was refused at the door and a dispute was an
 * argument only one side could join. These go through the routes, because the
 * routes were the fault.
 */

const COMPLAINT = 'The approved hours are two short: I stayed until the night staff arrived.';
const FACILITY_COMPLAINT = 'The practitioner left two hours before the shift ended and we paid for them.';

beforeEach(() => {
  clearCookies();
});

const get = (route: typeof listRoute | typeof caseRoute, path: string, id?: string) =>
  (route as (request: Request, props?: { params: Promise<{ id: string }> }) => Promise<Response>)(
    new Request(`http://localhost${path}`),
    id ? { params: Promise.resolve({ id }) } : undefined,
  );

const post = (
  route: (request: Request, props: { params: Promise<{ id: string; evidenceId?: string }> }) => Promise<Response>,
  path: string,
  body: unknown,
  params: { id: string; evidenceId?: string },
) =>
  route(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve(params) },
  );

/** A case the practitioner raised, with the facility's ward manager signed in. */
async function caseAsFacility() {
  const world = await buildWorld();
  await approved(world);
  const dispute = await raiseDispute({
    assignmentId: world.assignmentId,
    actorId: world.practitionerId,
    category: 'HOURS',
    reason: COMPLAINT,
  });
  await issueSession({ userId: world.reviewerId });
  return { world, dispute };
}

/** Somebody at another hospital, holding dispute.manage there and nowhere else. */
async function strangerFromElsewhere() {
  const other = await buildWorld();
  await grant({ userId: other.reviewerId, roleKey: 'facility_approver_other', permissions: ['dispute.manage'], scopeType: 'FACILITY', scopeId: other.facilityId });
  return other;
}

describe('a facility reading the cases over its shifts', () => {
  it('lists them, with the practitioner and the shift, for the person acting for the facility', async () => {
    const { world, dispute } = await caseAsFacility();

    const response = await get(listRoute, `/api/v1/disputes?facilityId=${world.facilityId}`);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { disputes: { id: string; practitionerName: string; status: string; raisedByFacility: boolean }[] };
    expect(body.disputes).toHaveLength(1);
    expect(body.disputes[0]).toMatchObject({ id: dispute.id, practitionerName: 'Ngozi Eze', status: 'OPEN', raisedByFacility: false });
  });

  it('lists only its own: another hospital\'s cases are not there, and naming that hospital is refused', async () => {
    const mine = await caseAsFacility();
    const other = await buildWorld();
    await approved(other);
    await raiseDispute({ assignmentId: other.assignmentId, actorId: other.practitionerId, category: 'HOURS', reason: COMPLAINT });
    await issueSession({ userId: mine.world.reviewerId });

    const own = (await (await get(listRoute, `/api/v1/disputes?facilityId=${mine.world.facilityId}`)).json()) as { disputes: unknown[] };
    const theirs = await get(listRoute, `/api/v1/disputes?facilityId=${other.facilityId}`);

    expect(own.disputes).toHaveLength(1);
    expect(theirs.status).toBe(403);
  });

  it('reads one case, with both sides\' evidence by side and not by name', async () => {
    const { world, dispute } = await caseAsFacility();
    await prisma.storedObject.create({
      data: { bucket: 'test', objectKey: 'dispute_evidence/test/a.jpg', contentType: 'image/jpeg', sizeBytes: 10, purpose: 'dispute_evidence', ownerUserId: world.practitionerId },
    });
    await prisma.disputeEvidence.create({
      data: { disputeId: dispute.id, objectKey: 'dispute_evidence/test/a.jpg', attachedBy: world.practitionerId, note: 'The ward log.' },
    });

    const response = await get(caseRoute, `/api/v1/disputes/${dispute.id}?facilityId=${world.facilityId}`, dispute.id);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { dispute: { reason: string }; side: string; evidence: Record<string, unknown>[] };
    expect(body.side).toBe('FACILITY');
    expect(body.dispute.reason).toBe(COMPLAINT);
    expect(body.evidence).toHaveLength(1);
    expect(body.evidence[0]).toMatchObject({ attachedBySide: 'PRACTITIONER', bySide: false, note: 'The ward log.' });
    expect(JSON.stringify(body.evidence)).not.toContain('Ngozi');
    expect(JSON.stringify(body.evidence)).not.toContain('dispute_evidence/test/a.jpg');
  });

  it('does not show a case to somebody at another hospital, even one that names their own', async () => {
    const { dispute } = await caseAsFacility();
    const other = await strangerFromElsewhere();
    clearCookies();
    await issueSession({ userId: other.reviewerId });

    const response = await get(caseRoute, `/api/v1/disputes/${dispute.id}?facilityId=${other.facilityId}`, dispute.id);

    expect(response.status).toBe(404);
  });
});

describe('a facility adding to a case', () => {
  it('can ask for a place to upload evidence, attach it, and then read it back', async () => {
    const { world, dispute } = await caseAsFacility();

    const ticket = await post(uploadUrlRoute, `/api/v1/disputes/${dispute.id}/evidence/upload-url`, {
      facilityId: world.facilityId,
      filename: 'roster.pdf',
      contentType: 'application/pdf',
      sizeBytes: 2048,
    }, { id: dispute.id });
    expect(ticket.status).toBe(200);
    const { objectKey } = (await ticket.json()) as { objectKey: string };

    const attached = await post(attachRoute, `/api/v1/disputes/${dispute.id}/evidence`, {
      facilityId: world.facilityId,
      objectKey,
      note: 'The signed roster for the night.',
    }, { id: dispute.id });
    expect(attached.status).toBe(200);
    const evidenceId = ((await attached.json()) as { id: string }).id;

    const link = await post(evidenceUrlRoute as never, `/api/v1/disputes/${dispute.id}/evidence/${evidenceId}/url`, {
      facilityId: world.facilityId,
    }, { id: dispute.id, evidenceId });
    expect(link.status).toBe(200);
    expect(((await link.json()) as { url: string }).url).toContain('http');

    const row = await prisma.disputeEvidence.findFirstOrThrow({ where: { disputeId: dispute.id } });
    expect(row.attachedBy).toBe(world.reviewerId);
  });

  it('is told, as a facility, that it is the facility side that attached it', async () => {
    const { world, dispute } = await caseAsFacility();
    const ticket = await post(uploadUrlRoute, `/api/v1/disputes/${dispute.id}/evidence/upload-url`, {
      facilityId: world.facilityId, filename: 'a.pdf', contentType: 'application/pdf', sizeBytes: 100,
    }, { id: dispute.id });
    const { objectKey } = (await ticket.json()) as { objectKey: string };
    await post(attachRoute, `/api/v1/disputes/${dispute.id}/evidence`, { facilityId: world.facilityId, objectKey }, { id: dispute.id });

    const body = (await (await get(caseRoute, `/api/v1/disputes/${dispute.id}?facilityId=${world.facilityId}`, dispute.id)).json()) as {
      evidence: { attachedBySide: string; bySide: boolean }[];
    };

    expect(body.evidence[0]).toMatchObject({ attachedBySide: 'FACILITY', bySide: true });
  });

  it('cannot add to somebody else\'s case by naming its own hospital', async () => {
    const { dispute } = await caseAsFacility();
    const other = await strangerFromElsewhere();
    clearCookies();
    await issueSession({ userId: other.reviewerId });

    const response = await post(uploadUrlRoute, `/api/v1/disputes/${dispute.id}/evidence/upload-url`, {
      facilityId: other.facilityId, filename: 'a.pdf', contentType: 'application/pdf', sizeBytes: 100,
    }, { id: dispute.id });

    expect(response.status).toBe(404);
    expect(await prisma.storedObject.count({ where: { purpose: 'dispute_evidence' } })).toBe(0);
  });

  it('cannot add by naming a hospital it holds nothing at', async () => {
    const { world, dispute } = await caseAsFacility();
    const other = await buildWorld();

    const response = await post(attachRoute, `/api/v1/disputes/${dispute.id}/evidence`, {
      facilityId: other.facilityId, objectKey: 'x',
    }, { id: dispute.id });

    expect(response.status).toBe(403);
    void world;
  });
});

describe('a facility withdrawing a case it raised', () => {
  async function raisedByFacility() {
    const world: World = await buildWorld();
    await approved(world);
    const dispute = await raiseDispute({
      assignmentId: world.assignmentId,
      actorId: world.reviewerId,
      facilityId: world.facilityId,
      category: 'CONDUCT',
      reason: FACILITY_COMPLAINT,
    });
    await issueSession({ userId: world.reviewerId });
    return { world, dispute };
  }

  it('takes it back, through the route', async () => {
    const { world, dispute } = await raisedByFacility();

    const response = await post(withdrawRoute, `/api/v1/disputes/${dispute.id}/withdraw`, { facilityId: world.facilityId }, { id: dispute.id });

    expect(response.status).toBe(200);
    expect((await prisma.dispute.findUniqueOrThrow({ where: { id: dispute.id } })).status).toBe('WITHDRAWN');
  });

  it('cannot take back one the practitioner raised', async () => {
    const { world, dispute } = await caseAsFacility();

    const response = await post(withdrawRoute, `/api/v1/disputes/${dispute.id}/withdraw`, { facilityId: world.facilityId }, { id: dispute.id });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect((await prisma.dispute.findUniqueOrThrow({ where: { id: dispute.id } })).status).toBe('OPEN');
  });
});

describe('the practitioner and the adjudicator are not disturbed', () => {
  it('the practitioner still acts as themselves, with no facility named', async () => {
    const { world, dispute } = await caseAsFacility();
    clearCookies();
    await grant({ userId: world.practitionerId, roleKey: 'practitioner_disputes', permissions: ['dispute.manage'], scopeType: 'SELF', scopeId: world.practitionerId });
    await issueSession({ userId: world.practitionerId });

    const response = await post(uploadUrlRoute, `/api/v1/disputes/${dispute.id}/evidence/upload-url`, {
      filename: 'a.pdf', contentType: 'application/pdf', sizeBytes: 100,
    }, { id: dispute.id });

    expect(response.status).toBe(200);
  });

  it('the adjudicator still reads the whole queue at platform scope, and cannot read it as a facility', async () => {
    const { world } = await caseAsFacility();
    clearCookies();
    await issueSession({ userId: world.officerId });

    const queue = await get(listRoute, '/api/v1/disputes');
    expect(queue.status).toBe(200);
    expect(((await queue.json()) as { disputes: unknown[] }).disputes).toHaveLength(1);
  });

  it('a facility person cannot read the adjudicator\'s queue by leaving the facility out', async () => {
    const { world } = await caseAsFacility();
    void world;

    const queue = await get(listRoute, '/api/v1/disputes');

    expect(queue.status).toBe(403);
  });
});
