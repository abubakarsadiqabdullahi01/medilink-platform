import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { watWindow } from '@/lib/wat';
import { usersHoldingPlatformPermission } from '@/modules/auth/application/grants';
import { alreadyNotified, ngn } from './handlers';
import { notify, requireDelivered, type NotifyOutcome } from './notify';

/**
 * The messages the Phase 0 list asks for (NOT-01): an offer arriving, an offer
 * accepted, a decision on a document, a licence-type document expiring, a
 * facility verified, a timesheet waiting and approved, a dispute opened.
 * Booking confirmed and cancelled are in handlers.ts.
 *
 * What a text may say is deliberately narrow. It names the facility and the
 * time, never a person the reader has no booking with (a facility is not told
 * who accepted until it confirms them), never an officer's reasons or a
 * dispute's category — those are for the screen behind the sign-in. And it says
 * "NGN", not the naira sign: a character outside the basic GSM set makes the
 * whole message a costlier encoding with a shorter limit.
 *
 * Each handler is safe to run twice (a delivered message is skipped) and throws
 * if one did not go (see notify.ts), so the outbox retries it.
 */

interface Tell {
  userId: string;
  kind: string;
  body: string;
  relatedType: string;
  relatedId: string;
  /**
   * Only a message sent since then counts as already told. An offer that is
   * reopened, or a document queried a second time, is the same row and is a new
   * thing to be told about; a repeat delivery of the same event is not.
   */
  since?: Date;
}

const instant = (value: unknown) => (value ? new Date(String(value)) : undefined);

/** Sends each message not already delivered, tries all of them, then fails the event if any failed. */
async function tellAll(messages: Tell[]): Promise<void> {
  const outcomes: NotifyOutcome[] = [];
  for (const message of messages) {
    if (await alreadyNotified(message.userId, message.kind, message.relatedId, message.since)) continue;
    outcomes.push(await notify(message));
  }
  requireDelivered(outcomes);
}

const text = (value: unknown) => String(value ?? '');

async function shiftFacts(serviceRequestId: string) {
  const request = await prisma.serviceRequest.findUnique({
    where: { id: serviceRequestId },
    select: {
      startsAt: true,
      endsAt: true,
      hourlyRateKobo: true,
      facility: { select: { id: true, name: true, representativeUserId: true } },
    },
  });
  if (!request) return null;
  return {
    when: watWindow(request.startsAt, request.endsAt),
    rate: ngn(request.hourlyRateKobo),
    facility: request.facility,
  };
}

async function credentialTypeName(credentialTypeId: string): Promise<string> {
  const type = await prisma.credentialType.findUnique({
    where: { id: credentialTypeId },
    select: { name: true },
  });
  return type?.name ?? 'document';
}

/** `shift.invited`: the practitioner is offered a shift. */
export async function notifyShiftInvited(payload: Record<string, unknown>): Promise<void> {
  const invitationId = text(payload.invitationId);
  const serviceRequestId = text(payload.serviceRequestId);
  const userId = text(payload.userId);
  if (!invitationId || !serviceRequestId || !userId) {
    logger.warn('shift.invited event missing ids; skipping notification');
    return;
  }

  // An offer withdrawn, answered or expired before this ran is not worth a
  // text: a retry minutes later must not announce something already gone.
  const invitation = await prisma.invitation.findUnique({
    where: { id: invitationId },
    select: { status: true },
  });
  if (!invitation || invitation.status !== 'INVITED') return;

  const facts = await shiftFacts(serviceRequestId);
  if (!facts) return;

  await tellAll([
    {
      userId,
      kind: 'shift.invited',
      body: `New shift offer from ${facts.facility.name}: ${facts.when}, ${facts.rate} per hour. Open Medilink to accept or decline.`,
      relatedType: 'matching.invitations',
      relatedId: invitationId,
      since: instant(payload.offeredAt),
    },
  ]);
}

/** `shift.accepted`: the facility learns somebody said yes, and that it is theirs to confirm. */
export async function notifyShiftAccepted(payload: Record<string, unknown>): Promise<void> {
  const invitationId = text(payload.invitationId);
  const serviceRequestId = text(payload.serviceRequestId);
  if (!invitationId || !serviceRequestId) {
    logger.warn('shift.accepted event missing ids; skipping notification');
    return;
  }

  const facts = await shiftFacts(serviceRequestId);
  if (!facts) return;

  await tellAll([
    {
      userId: facts.facility.representativeUserId,
      kind: 'shift.accepted',
      body: `A practitioner has accepted your shift on ${facts.when}. Open Medilink to confirm them.`,
      relatedType: 'matching.invitations',
      relatedId: invitationId,
      since: instant(payload.acceptedAt),
    },
  ]);
}

/** `credential.verified`, `.rejected`, `.info_requested`: what an officer decided about a document. */
function credentialDecision(kind: string, line: (type: string) => string) {
  return async (payload: Record<string, unknown>): Promise<void> => {
    const submissionId = text(payload.submissionId);
    const userId = text(payload.userId);
    const credentialTypeId = text(payload.credentialTypeId);
    if (!submissionId || !userId || !credentialTypeId) {
      logger.warn(`${kind} event missing ids; skipping notification`);
      return;
    }
    const type = await credentialTypeName(credentialTypeId);
    await tellAll([
      {
        userId,
        kind,
        body: line(type),
        relatedType: 'credentials.credential_submissions',
        relatedId: submissionId,
        since: instant(payload.decidedAt),
      },
    ]);
  };
}

export const notifyCredentialVerified = credentialDecision(
  'credential.verified',
  (type) => `Your ${type} has been verified. Medilink.`,
);

export const notifyCredentialRejected = credentialDecision(
  'credential.rejected',
  (type) => `Your ${type} was not accepted. Open Medilink to see why and send it again.`,
);

export const notifyCredentialInfoRequested = credentialDecision(
  'credential.info_requested',
  (type) => `We need more information about your ${type}. Open Medilink to reply.`,
);

/** `credential.expired`: the document has lapsed and offers will stop until it is renewed. */
export const notifyCredentialExpired = credentialDecision(
  'credential.expired',
  (type) => `Your ${type} has expired. Upload a renewed copy in Medilink to keep receiving shift offers.`,
);

/** `facility.verified`: the hospital can now publish shifts. */
export async function notifyFacilityVerified(payload: Record<string, unknown>): Promise<void> {
  const facilityId = text(payload.facilityId);
  if (!facilityId) {
    logger.warn('facility.verified event missing id; skipping notification');
    return;
  }
  const facility = await prisma.facility.findUnique({
    where: { id: facilityId },
    select: { name: true, representativeUserId: true },
  });
  if (!facility) return;

  await tellAll([
    {
      userId: facility.representativeUserId,
      kind: 'facility.verified',
      body: `${facility.name} is verified on Medilink. You can now publish shifts.`,
      relatedType: 'facilities.facilities',
      relatedId: facilityId,
    },
  ]);
}

async function assignmentFacts(assignmentId: string) {
  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    select: { startsAt: true, endsAt: true, facilityId: true },
  });
  if (!assignment) return null;
  // An assignment carries its facility's id and no relation: the two modules
  // do not reach into each other's tables through the ORM.
  const facility = await prisma.facility.findUnique({
    where: { id: assignment.facilityId },
    select: { name: true, representativeUserId: true },
  });
  if (!facility) return null;
  return { when: watWindow(assignment.startsAt, assignment.endsAt), facility };
}

/** `timesheet.submitted`: a sheet is waiting for the facility, whose approval releases the pay. */
export async function notifyTimesheetSubmitted(payload: Record<string, unknown>): Promise<void> {
  const assignmentId = text(payload.assignmentId);
  const key = text(payload.submissionKey) || text(payload.timesheetId);
  if (!assignmentId || !key) {
    logger.warn('timesheet.submitted event missing ids; skipping notification');
    return;
  }
  const facts = await assignmentFacts(assignmentId);
  if (!facts) return;

  await tellAll([
    {
      userId: facts.facility.representativeUserId,
      kind: 'timesheet.submitted',
      body: `A timesheet for the shift on ${facts.when} is waiting for your approval in Medilink.`,
      relatedType: 'timesheets.timesheets',
      relatedId: key,
    },
  ]);
}

/** `timesheet.approved`: the practitioner is told their hours were accepted. */
export async function notifyTimesheetApproved(payload: Record<string, unknown>): Promise<void> {
  const assignmentId = text(payload.assignmentId);
  const userId = text(payload.userId);
  if (!assignmentId || !userId) {
    logger.warn('timesheet.approved event missing ids; skipping notification');
    return;
  }
  const facts = await assignmentFacts(assignmentId);
  if (!facts) return;

  await tellAll([
    {
      userId,
      kind: 'timesheet.approved',
      body: `${facts.facility.name} approved your hours for ${facts.when}. Medilink.`,
      relatedType: 'matching.assignments',
      relatedId: assignmentId,
    },
  ]);
}

/**
 * `dispute.opened`: the other side is told there is a case, and the people who
 * adjudicate are told there is one to pick up. Nothing about its category or what
 * was claimed: that is for the screen, behind the sign-in.
 *
 * The other side is the facility's representative when a practitioner raised it,
 * and the practitioner when the facility did (DSP-04).
 */
export async function notifyDisputeOpened(payload: Record<string, unknown>): Promise<void> {
  const disputeId = text(payload.disputeId);
  const assignmentId = text(payload.assignmentId);
  if (!disputeId || !assignmentId) {
    logger.warn('dispute.opened event missing ids; skipping notification');
    return;
  }
  const facts = await assignmentFacts(assignmentId);
  if (!facts) return;

  const practitionerId = text(payload.userId);
  const otherSide =
    text(payload.raisedParty) === 'FACILITY' && practitionerId
      ? practitionerId
      : facts.facility.representativeUserId;

  const messages: Tell[] = [
    {
      userId: otherSide,
      kind: 'dispute.opened',
      body: `A dispute was opened about the shift on ${facts.when}. Open Medilink to see it.`,
      relatedType: 'disputes.disputes',
      relatedId: disputeId,
    },
  ];

  // Somebody has to pick a new case up. Not a failure if nobody holds the
  // permission — the queue is still there — so it is a warning, unlike a death.
  const adjudicators = await usersHoldingPlatformPermission('dispute.manage');
  if (adjudicators.length === 0) logger.warn('a dispute was opened and no one holds dispute.manage', { disputeId });
  for (const adjudicator of adjudicators) {
    if (adjudicator.id === otherSide) continue;
    messages.push({
      userId: adjudicator.id,
      kind: 'dispute.opened',
      body: `A dispute was opened about the shift on ${facts.when} and is waiting for review in Medilink.`,
      relatedType: 'disputes.disputes',
      relatedId: disputeId,
    });
  }

  await tellAll(messages);
}
