import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/modules/practitioners/application/bookable', () => import('./support/always-bookable'));

vi.mock('next/headers', async () => {
  const { cookieJar } = await import('./support/cookie-jar');
  return { cookies: () => cookieJar };
});

import { prisma } from '@/lib/db';
import { EVENTS } from '@/lib/events';
import { GET as listRoute } from '@/app/api/v1/disputes/route';
import { GET as mineRoute } from '@/app/api/v1/disputes/mine/route';
import { GET as caseRoute } from '@/app/api/v1/disputes/[id]/route';
import { POST as respondRoute } from '@/app/api/v1/disputes/[id]/respond/route';
import { POST as resolveRoute } from '@/app/api/v1/disputes/[id]/resolve/route';
import {
  beginReview,
  listDisputes,
  raiseDispute,
  respondToDispute,
  resolveDispute,
  withdrawDispute,
} from '@/modules/disputes/application/dispute';
import {
  CASE_FIELDS_HIDDEN_FROM_PARTIES,
  DECISION_REASONS,
  DISPUTE_RESPONSE_DAYS,
  EVIDENCE_FIELDS,
} from '@/modules/disputes/domain/dispute';
import { issueSession } from '@/modules/auth/application/session-service';
import { clearCookies } from './support/cookie-jar';
import { approved, buildWorld, type World } from './support/dispute-world';
import { grant } from './support/fixtures';

/**
 * M14-03. The other side of a case is asked to reply by a date, and replies once, in words. The
 * officers' queue puts what can be decided now first. A decision carries the reason it turned on
 * beside the notes. And what each side may see of the case and its evidence is written down and
 * held here.
 *
 * Nothing happens to a case when the date passes: a late reply is still read, and a missing one
 * decides nothing against anybody.
 */

const COMPLAINT = 'The approved hours are two short: I stayed until the night staff arrived.';
const FACILITY_COMPLAINT = 'The practitioner left two hours before the shift ended and we paid for them.';
const REPLY = 'The ward diary shows the practitioner signed out when the shift ended, not later.';
const NOTES = 'The ward log shows the practitioner stayed until the night staff arrived.';
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  clearCookies();
});

const as = async (userId: string) => {
  clearCookies();
  await issueSession({ userId });
};

type Routed = (request: Request, props: { params: Promise<{ id: string }> }) => Promise<Response>;

const post = (route: Routed, id: string, body: unknown) =>
  route(
    new Request(`http://localhost/api/v1/disputes/${id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );

const getCase = (id: string, query = '') =>
  (caseRoute as Routed)(new Request(`http://localhost/api/v1/disputes/${id}${query}`), {
    params: Promise.resolve({ id }),
  });

async function practitionerCanAct(world: World) {
  await grant({
    userId: world.practitionerId,
    roleKey: 'practitioner_disputes',
    permissions: ['dispute.manage'],
    scopeType: 'SELF',
    scopeId: world.practitionerId,
  });
}

/** A case the practitioner raised, over a shift the facility approved. */
async function raisedByPractitioner() {
  const world = await buildWorld();
  await approved(world);
  const dispute = await raiseDispute({
    assignmentId: world.assignmentId,
    actorId: world.practitionerId,
    category: 'HOURS',
    reason: COMPLAINT,
  });
  return { world, dispute };
}

/** A case the facility raised, over a shift it approved and now disputes. */
async function raisedByFacility() {
  const world = await buildWorld();
  await approved(world);
  const dispute = await raiseDispute({
    assignmentId: world.assignmentId,
    actorId: world.reviewerId,
    facilityId: world.facilityId,
    category: 'CONDUCT',
    reason: FACILITY_COMPLAINT,
  });
  return { world, dispute };
}

const rowOf = (id: string) => prisma.dispute.findUniqueOrThrow({ where: { id } });

describe('opening a case', () => {
  it('says by when the other side is asked to reply, a week from opening, and that nobody has yet', async () => {
    const { dispute } = await raisedByPractitioner();

    const row = await rowOf(dispute.id);

    expect(DISPUTE_RESPONSE_DAYS).toBe(7);
    expect(row.respondBy.getTime() - row.createdAt.getTime()).toBe(DISPUTE_RESPONSE_DAYS * DAY);
    expect(row).toMatchObject({ responseNote: null, respondedAt: null, respondedBy: null, decisionReason: null });
    expect(dispute.respondBy.toISOString()).toBe(row.respondBy.toISOString());
  });

  it('carries that date in the event that tells the other side, so the text they are sent can say it', async () => {
    const { dispute } = await raisedByPractitioner();

    const event = await prisma.outboxEvent.findFirstOrThrow({
      where: { aggregateId: dispute.id, eventType: EVENTS.DisputeOpened },
    });

    expect(new Date((event.payload as { respondBy: string }).respondBy).toISOString()).toBe(
      dispute.respondBy.toISOString(),
    );
  });
});

describe('the other side replying', () => {
  it('lets the facility answer a case the practitioner raised, through the route, and records who and when', async () => {
    const { world, dispute } = await raisedByPractitioner();
    await as(world.reviewerId);

    const response = await post(respondRoute, dispute.id, { facilityId: world.facilityId, response: REPLY });

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ responseNote: REPLY });
    expect(body.respondedAt).toBeTruthy();
    // A party is told which side did what, not which person.
    for (const hidden of CASE_FIELDS_HIDDEN_FROM_PARTIES) expect(body).not.toHaveProperty(hidden);

    const row = await rowOf(dispute.id);
    expect(row).toMatchObject({ responseNote: REPLY, respondedBy: world.reviewerId });
    expect(row.respondedAt).not.toBeNull();
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'dispute.responded', entityId: dispute.id } });
    expect(audit.actorId).toBe(world.reviewerId);
  });

  it('lets the practitioner answer a case the facility raised, as themselves', async () => {
    const { world, dispute } = await raisedByFacility();
    await practitionerCanAct(world);
    await as(world.practitionerId);

    const response = await post(respondRoute, dispute.id, { response: REPLY });

    expect(response.status).toBe(200);
    expect(await rowOf(dispute.id)).toMatchObject({ responseNote: REPLY, respondedBy: world.practitionerId });
  });

  it('does not let the side that raised a case answer it, nor an officer, who weighs a case and does not argue it', async () => {
    const { world, dispute } = await raisedByPractitioner();
    await practitionerCanAct(world);
    await as(world.practitionerId);

    const own = await post(respondRoute, dispute.id, { response: REPLY });
    expect(own.status).toBe(409);
    expect(((await own.json()) as { error: { code: string } }).error.code).toBe('dispute_cannot_respond');

    await expect(
      respondToDispute({ disputeId: dispute.id, actorId: world.officerId, text: REPLY }),
    ).rejects.toMatchObject({ code: 'dispute_cannot_respond' });
    expect((await rowOf(dispute.id)).responseNote).toBeNull();
  });

  it('is not open to somebody at another hospital, whichever hospital they name', async () => {
    const { world, dispute } = await raisedByPractitioner();
    const other = await buildWorld();
    await grant({
      userId: other.reviewerId,
      roleKey: 'facility_approver_other',
      permissions: ['dispute.manage'],
      scopeType: 'FACILITY',
      scopeId: other.facilityId,
    });
    await as(other.reviewerId);

    const namingTheirOwn = await post(respondRoute, dispute.id, { facilityId: other.facilityId, response: REPLY });
    const namingTheCases = await post(respondRoute, dispute.id, { facilityId: world.facilityId, response: REPLY });

    expect(namingTheirOwn.status).toBe(404);
    expect(namingTheCases.status).toBe(403);
    expect((await rowOf(dispute.id)).responseNote).toBeNull();
  });

  it('is written once: a second reply is refused and the first stays as it was', async () => {
    const { world, dispute } = await raisedByPractitioner();
    await respondToDispute({ disputeId: dispute.id, actorId: world.reviewerId, text: REPLY });
    await as(world.reviewerId);

    const again = await post(respondRoute, dispute.id, {
      facilityId: world.facilityId,
      response: 'On reflection the practitioner left early and we want that said instead.',
    });

    expect(again.status).toBe(409);
    expect((await rowOf(dispute.id)).responseNote).toBe(REPLY);
  });

  it('is one winner when two replies arrive together, and the loser is told it was already answered', async () => {
    for (let round = 0; round < 6; round += 1) {
      const { world, dispute } = await raisedByPractitioner();

      const results = await Promise.allSettled([
        respondToDispute({ disputeId: dispute.id, actorId: world.reviewerId, text: `${REPLY} (first)` }),
        respondToDispute({ disputeId: dispute.id, actorId: world.reviewerId, text: `${REPLY} (second)` }),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled'), `round ${round}`).toHaveLength(1);
      const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(lost.reason).toMatchObject({ code: 'dispute_cannot_respond' });
      const row = await rowOf(dispute.id);
      expect([`${REPLY} (first)`, `${REPLY} (second)`]).toContain(row.responseNote);
    }
  });

  it('is refused on a case that has finished', async () => {
    const { world, dispute } = await raisedByPractitioner();
    await withdrawDispute({ disputeId: dispute.id, actorId: world.practitionerId });

    await expect(
      respondToDispute({ disputeId: dispute.id, actorId: world.reviewerId, text: REPLY }),
    ).rejects.toMatchObject({ code: 'dispute_cannot_respond' });
  });

  it('needs words: the route refuses a one-liner as a request to correct, the rule refuses it too', async () => {
    const { world, dispute } = await raisedByPractitioner();
    await as(world.reviewerId);

    const route = await post(respondRoute, dispute.id, { facilityId: world.facilityId, response: 'No.' });
    expect(route.status).toBe(422);

    await expect(
      respondToDispute({ disputeId: dispute.id, actorId: world.reviewerId, text: 'No.' }),
    ).rejects.toMatchObject({ code: 'dispute_cannot_respond' });
  });

  it('is still read when it is late: the date marks the case, it does not close the door', async () => {
    const { world, dispute } = await raisedByPractitioner();
    await prisma.dispute.update({ where: { id: dispute.id }, data: { respondBy: new Date(Date.now() - DAY) } });

    await respondToDispute({ disputeId: dispute.id, actorId: world.reviewerId, text: REPLY });

    const row = await rowOf(dispute.id);
    expect(row.responseNote).toBe(REPLY);
    expect(row.respondedAt!.getTime()).toBeGreaterThan(row.respondBy.getTime());
  });

  it('tells the one who raised it that there is a reply, without what it says', async () => {
    const { world, dispute } = await raisedByPractitioner();

    await respondToDispute({ disputeId: dispute.id, actorId: world.reviewerId, text: REPLY });

    const event = await prisma.outboxEvent.findFirstOrThrow({
      where: { aggregateId: dispute.id, eventType: EVENTS.DisputeResponded },
    });
    expect(event.payload).toMatchObject({
      disputeId: dispute.id,
      assignmentId: world.assignmentId,
      userId: world.practitionerId,
      facilityId: world.facilityId,
      raisedParty: 'PRACTITIONER',
    });
    expect(JSON.stringify(event.payload)).not.toContain('signed out');
  });
});

describe('a decision and the reason it turned on', () => {
  async function underReview() {
    const made = await raisedByPractitioner();
    await beginReview({ disputeId: made.dispute.id, actorId: made.world.officerId });
    return made;
  }

  it('needs a reason, and one that belongs to the outcome', async () => {
    const { world, dispute } = await underReview();
    const resolve = (outcome: 'UPHELD' | 'DISMISSED', decisionReason: string | null) =>
      resolveDispute({ disputeId: dispute.id, actorId: world.officerId, outcome, decisionReason, notes: NOTES } as never);

    await expect(resolve('UPHELD', null)).rejects.toMatchObject({ code: 'dispute_cannot_resolve' });
    await expect(resolve('UPHELD', 'COMPLAINT_NOT_MADE_OUT')).rejects.toMatchObject({
      message: expect.stringContaining('decision_reason_not_for_outcome'),
    });
    await expect(resolve('DISMISSED', 'RECORD_WAS_WRONG')).rejects.toMatchObject({
      message: expect.stringContaining('decision_reason_not_for_outcome'),
    });
    expect((await rowOf(dispute.id)).status).toBe('UNDER_REVIEW');
  });

  it('is refused by the route as a request to correct when the reason is missing or unknown', async () => {
    const { world, dispute } = await underReview();
    await as(world.officerId);

    const missing = await post(resolveRoute, dispute.id, { outcome: 'UPHELD', notes: NOTES });
    const unknown = await post(resolveRoute, dispute.id, { outcome: 'UPHELD', decisionReason: 'BECAUSE', notes: NOTES });

    expect(missing.status).toBe(422);
    expect(unknown.status).toBe(422);
  });

  it('is kept with the case, in the trail, and read by both sides beside the notes', async () => {
    const { world, dispute } = await underReview();
    await as(world.officerId);

    const decided = await post(resolveRoute, dispute.id, {
      outcome: 'UPHELD',
      decisionReason: 'RECORD_WAS_WRONG',
      notes: NOTES,
    });
    expect(decided.status).toBe(200);

    expect(await rowOf(dispute.id)).toMatchObject({ outcome: 'UPHELD', decisionReason: 'RECORD_WAS_WRONG', resolutionNotes: NOTES });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'dispute.upheld', entityId: dispute.id } });
    expect(JSON.stringify(audit.after)).toContain('RECORD_WAS_WRONG');

    await as(world.reviewerId);
    const seen = (await (await getCase(dispute.id, `?facilityId=${world.facilityId}`)).json()) as {
      dispute: Record<string, unknown>;
    };
    expect(seen.dispute).toMatchObject({ outcome: 'UPHELD', decisionReason: 'RECORD_WAS_WRONG', resolutionNotes: NOTES });
  });

  it('is open to every reason the list offers, under the outcome it is listed for', async () => {
    for (const outcome of ['UPHELD', 'DISMISSED'] as const) {
      for (const decisionReason of DECISION_REASONS[outcome]) {
        const { world, dispute } = await raisedByPractitioner();
        const done = await resolveDispute({
          disputeId: dispute.id,
          actorId: world.officerId,
          outcome,
          decisionReason,
          notes: NOTES,
        });
        expect(done, `${outcome}/${decisionReason}`).toMatchObject({ outcome, decisionReason });
      }
    }
  });

  it('puts the reason in the event no more than the outcome: nothing the officer wrote leaves the app', async () => {
    const { world, dispute } = await underReview();

    await resolveDispute({
      disputeId: dispute.id,
      actorId: world.officerId,
      outcome: 'DISMISSED',
      decisionReason: 'RECORD_CONFIRMED',
      notes: NOTES,
    });

    const event = await prisma.outboxEvent.findFirstOrThrow({
      where: { aggregateId: dispute.id, eventType: EVENTS.DisputeResolved },
    });
    expect(event.payload).toMatchObject({ outcome: 'DISMISSED' });
    expect(JSON.stringify(event.payload)).not.toContain('night staff');
  });
});

describe('what each side of a case sees', () => {
  async function withEvidenceOnBothSides() {
    const made = await raisedByPractitioner();
    const { world, dispute } = made;
    for (const [key, by, note] of [
      ['dispute_evidence/m14/practitioner.jpg', world.practitionerId, 'The ward log.'],
      ['dispute_evidence/m14/facility.pdf', world.reviewerId, 'The signed roster.'],
    ] as const) {
      await prisma.storedObject.create({
        data: { bucket: 'test', objectKey: key, contentType: 'image/jpeg', sizeBytes: 10, purpose: 'dispute_evidence', ownerUserId: by },
      });
      await prisma.disputeEvidence.create({ data: { disputeId: dispute.id, objectKey: key, attachedBy: by, note } });
    }
    await respondToDispute({ disputeId: dispute.id, actorId: world.reviewerId, text: REPLY });
    return made;
  }

  it('shows a party the whole case, the reply and both sides’ evidence, without the identity of anybody who acted', async () => {
    const { world, dispute } = await withEvidenceOnBothSides();
    await as(world.reviewerId);

    const body = (await (await getCase(dispute.id, `?facilityId=${world.facilityId}`)).json()) as {
      dispute: Record<string, unknown>;
      side: string;
      evidence: Record<string, unknown>[];
    };

    expect(body.side).toBe('FACILITY');
    expect(body.dispute).toMatchObject({ raisedParty: 'PRACTITIONER', responseNote: REPLY, reason: COMPLAINT });
    for (const hidden of CASE_FIELDS_HIDDEN_FROM_PARTIES) expect(body.dispute).not.toHaveProperty(hidden);
    expect(body.evidence).toHaveLength(2);
    for (const item of body.evidence) expect(Object.keys(item).sort()).toEqual([...EVIDENCE_FIELDS.party].sort());
  });

  it('shows the adjudicator the same case with the people and the files, and who attached what', async () => {
    const { world, dispute } = await withEvidenceOnBothSides();
    await as(world.officerId);

    const body = (await (await getCase(dispute.id)).json()) as {
      dispute: Record<string, unknown>;
      evidence: Record<string, unknown>[];
    };

    expect(body.dispute).toMatchObject({ raisedBy: world.practitionerId, responseNote: REPLY });
    expect(body.dispute).toHaveProperty('respondedBy', world.reviewerId);
    expect(body.evidence).toHaveLength(2);
    for (const item of body.evidence) expect(Object.keys(item).sort()).toEqual([...EVIDENCE_FIELDS.adjudicator].sort());
  });

  it('lets a practitioner read their own case as themselves, and nobody else’s', async () => {
    const { world, dispute } = await withEvidenceOnBothSides();
    await practitionerCanAct(world);
    await as(world.practitionerId);

    const own = await getCase(dispute.id, '?as=self');
    expect(own.status).toBe(200);
    const body = (await own.json()) as { dispute: Record<string, unknown>; side: string; evidence: unknown[] };
    expect(body.side).toBe('PRACTITIONER');
    expect(body.dispute).toMatchObject({ responseNote: REPLY });
    for (const hidden of CASE_FIELDS_HIDDEN_FROM_PARTIES) expect(body.dispute).not.toHaveProperty(hidden);
    expect(body.evidence).toHaveLength(2);

    const other = await buildWorld();
    await practitionerCanAct(other);
    await as(other.practitionerId);
    expect((await getCase(dispute.id, '?as=self')).status).toBe(404);
  });

  it('does not give a practitioner the adjudicator’s door by leaving the facility out', async () => {
    const { world, dispute } = await withEvidenceOnBothSides();
    await practitionerCanAct(world);
    await as(world.practitionerId);

    expect((await getCase(dispute.id)).status).toBe(403);
  });
});

describe('the officers’ queue', () => {
  /** A case in one of the four places it can be, opened `days` ago. */
  async function caseThat(stage: 'ready_overdue' | 'ready_replied' | 'waiting' | 'reviewing' | 'resolved', days: number) {
    const { world, dispute } = await raisedByPractitioner();
    const openedAt = new Date(Date.now() - days * DAY);
    await prisma.dispute.update({
      where: { id: dispute.id },
      data: {
        createdAt: openedAt,
        respondBy: stage === 'ready_overdue' ? new Date(Date.now() - DAY) : new Date(Date.now() + 2 * DAY),
      },
    });
    if (stage === 'ready_replied') await respondToDispute({ disputeId: dispute.id, actorId: world.reviewerId, text: REPLY });
    if (stage === 'reviewing') await beginReview({ disputeId: dispute.id, actorId: world.officerId });
    if (stage === 'resolved') {
      await resolveDispute({
        disputeId: dispute.id,
        actorId: world.officerId,
        outcome: 'DISMISSED',
        decisionReason: 'RECORD_CONFIRMED',
        notes: NOTES,
      });
    }
    return dispute.id;
  }

  async function queueOf() {
    const overdue = await caseThat('ready_overdue', 5);
    const replied = await caseThat('ready_replied', 3);
    const waiting = await caseThat('waiting', 6);
    const reviewing = await caseThat('reviewing', 4);
    const resolved = await caseThat('resolved', 8);
    return { overdue, replied, waiting, reviewing, resolved };
  }

  it('puts what can be decided now first, then what is being worked, then what is waiting, oldest first within each', async () => {
    const ids = await queueOf();

    const page = await listDisputes();

    expect(page.disputes.map((row) => row.id)).toEqual([ids.overdue, ids.replied, ids.reviewing, ids.waiting]);
    expect(page.disputes.map((row) => row.stage)).toEqual([
      'ready_to_decide',
      'ready_to_decide',
      'under_review',
      'waiting_for_response',
    ]);
  });

  it('says which are overdue for a reply and which have one', async () => {
    const ids = await queueOf();

    const byId = new Map((await listDisputes()).disputes.map((row) => [row.id, row]));

    expect(byId.get(ids.overdue)).toMatchObject({ responseOverdue: true, respondedAt: null });
    expect(byId.get(ids.replied)).toMatchObject({ responseOverdue: false });
    expect(byId.get(ids.replied)!.respondedAt).not.toBeNull();
    expect(byId.get(ids.waiting)).toMatchObject({ responseOverdue: false, respondedAt: null });
    expect(byId.get(ids.waiting)!.respondBy.getTime()).toBeGreaterThan(Date.now());
  });

  it('can be narrowed to one stage, and a closed case is found by its status as before', async () => {
    const ids = await queueOf();

    expect((await listDisputes({ stage: 'ready_to_decide' })).disputes.map((row) => row.id)).toEqual([ids.overdue, ids.replied]);
    expect((await listDisputes({ stage: 'waiting_for_response' })).disputes.map((row) => row.id)).toEqual([ids.waiting]);
    const closed = await listDisputes({ status: 'RESOLVED' });
    expect(closed.disputes.map((row) => row.id)).toEqual([ids.resolved]);
    expect(closed.disputes[0]).toMatchObject({ stage: 'closed', decisionReason: 'RECORD_CONFIRMED' });
  });

  it('pages through in that order without repeating or skipping a case', async () => {
    const ids = await queueOf();

    const first = await listDisputes({ limit: 2 });
    const second = await listDisputes({ limit: 2, cursor: first.nextCursor! });

    expect(first.disputes.map((row) => row.id)).toEqual([ids.overdue, ids.replied]);
    expect(second.disputes.map((row) => row.id)).toEqual([ids.reviewing, ids.waiting]);
    expect(second.nextCursor).toBeNull();
  });

  it('ends the paging, and does not start again from the top, when the case it stopped at was decided in the meantime', async () => {
    const ids = await queueOf();
    const first = await listDisputes({ limit: 2 });
    expect(first.nextCursor).toBe(ids.replied);

    // The officer decides the case the next page was to follow, between the two page loads.
    await resolveDispute({
      disputeId: ids.replied,
      actorId: (await buildWorld()).officerId,
      outcome: 'DISMISSED',
      decisionReason: 'RECORD_CONFIRMED',
      notes: NOTES,
    });
    const second = await listDisputes({ limit: 2, cursor: first.nextCursor! });

    // Repeating the first page would show cases already seen and read as an endless queue.
    expect(second.disputes).toEqual([]);
    expect(second.nextCursor).toBeNull();
  });

  it('is reached through the route with the stage, for the adjudicator only', async () => {
    const ids = await queueOf();
    const anyWorld = await buildWorld();
    await as(anyWorld.officerId);

    const response = await (listRoute as (request: Request) => Promise<Response>)(
      new Request('http://localhost/api/v1/disputes?stage=waiting_for_response'),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { disputes: { id: string; stage: string }[] };
    expect(body.disputes.map((row) => row.id)).toEqual([ids.waiting]);

    const refused = await (listRoute as (request: Request) => Promise<Response>)(
      new Request('http://localhost/api/v1/disputes?stage=not_a_stage'),
    );
    expect(refused.status).toBe(422);
  });
});

describe('a practitioner’s own cases', () => {
  it('lists the ones they raised and the ones raised over their shifts, with what is expected of them', async () => {
    const mine = await raisedByPractitioner();
    const againstMe = await raisedByFacility();
    await practitionerCanAct(mine.world);
    await as(mine.world.practitionerId);

    const response = await (mineRoute as (request: Request) => Promise<Response>)(
      new Request('http://localhost/api/v1/disputes/mine'),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { disputes: Record<string, unknown>[] };
    // Only the ones over this practitioner's own shifts: the second world's is somebody else's.
    expect(body.disputes.map((row) => row.id)).toEqual([mine.dispute.id]);
    expect(body.disputes[0]).toMatchObject({ raisedByYou: true, youMustReply: false });
    for (const hidden of CASE_FIELDS_HIDDEN_FROM_PARTIES) expect(body.disputes[0]).not.toHaveProperty(hidden);
    void againstMe;
  });

  it('says a case raised against them is waiting for their reply until they give one', async () => {
    const { world, dispute } = await raisedByFacility();
    await practitionerCanAct(world);
    await as(world.practitionerId);
    const mineNow = async () =>
      ((await (await (mineRoute as (request: Request) => Promise<Response>)(new Request('http://localhost/api/v1/disputes/mine'))).json()) as {
        disputes: Record<string, unknown>[];
      }).disputes[0]!;

    expect(await mineNow()).toMatchObject({ id: dispute.id, raisedByYou: false, youMustReply: true });

    await respondToDispute({ disputeId: dispute.id, actorId: world.practitionerId, text: REPLY });

    expect(await mineNow()).toMatchObject({ youMustReply: false, responseNote: REPLY });
  });

  it('is refused to somebody without dispute.manage at their own scope', async () => {
    const { world } = await raisedByPractitioner();
    await as(world.practitionerId);

    const response = await (mineRoute as (request: Request) => Promise<Response>)(
      new Request('http://localhost/api/v1/disputes/mine'),
    );

    expect(response.status).toBe(403);
  });
});
