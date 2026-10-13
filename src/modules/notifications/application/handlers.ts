import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { WAT_OFFSET_MINUTES } from '@/modules/availability/domain/availability';
import { usersHoldingPlatformPermission } from '@/modules/auth/application/grants';
import { alreadyNotified, notify, type NotifyOutcome } from './notify';

/**
 * What a domain event turns into, for the people it concerns.
 *
 * Handlers must be idempotent: the outbox delivers at least once, and a
 * retried delivery must not send a second message. Each checks for a message
 * it has already recorded against the same assignment before sending.
 */

/**
 * Lagos time, because that is the time on every other screen and the one the
 * reader is living in. These were printed in UTC, an hour behind, so a nurse
 * told "07:00" arrived to a ward that had expected her at 08:00.
 */
export function formatShift(startsAt: string, endsAt: string): string {
  const shift = (iso: string) => new Date(new Date(iso).getTime() + WAT_OFFSET_MINUTES * 60 * 1000);
  const start = shift(startsAt).toISOString();
  const end = shift(endsAt).toISOString();
  return `${start.slice(0, 10)} ${start.slice(11, 16)} to ${end.slice(11, 16)} WAT`;
}

/**
 * An outbox handler that tried to tell people and could not tell somebody
 * fails, so the event is retried rather than recorded as handled. Everybody
 * who was told is skipped on the retry (see `alreadyNotified`), so this costs
 * nobody a second message.
 */
export function failIfAnyFailed(outcomes: NotifyOutcome[], what: string): void {
  const failed = outcomes.filter((outcome) => outcome === 'failed').length;
  if (failed > 0) throw new Error(`SMS delivery failed for ${failed} recipient(s) of ${what}.`);
}

/**
 * Step 6.5: "both parties notified on confirm". The practitioner and the
 * facility's representative each get a message, and each is recorded.
 */
export async function notifyAssignmentConfirmed(payload: Record<string, unknown>): Promise<void> {
  const assignmentId = String(payload.assignmentId ?? '');
  const practitionerId = String(payload.userId ?? '');
  const facilityId = String(payload.facilityId ?? '');

  if (!assignmentId || !practitionerId || !facilityId) {
    logger.warn('assignment.confirmed event missing ids; skipping notification');
    return;
  }

  const [facility, assignment] = await Promise.all([
    prisma.facility.findUnique({
      where: { id: facilityId },
      select: { name: true, representativeUserId: true },
    }),
    prisma.assignment.findUnique({
      where: { id: assignmentId },
      select: { startsAt: true, endsAt: true },
    }),
  ]);
  if (!facility || !assignment) {
    logger.warn('assignment.confirmed for a record that no longer exists', { assignmentId });
    return;
  }

  const when = formatShift(assignment.startsAt.toISOString(), assignment.endsAt.toISOString());
  const outcomes: NotifyOutcome[] = [];

  if (!(await alreadyNotified(practitionerId, 'assignment.confirmed', assignmentId))) {
    outcomes.push(
      await notify({
        userId: practitionerId,
        kind: 'assignment.confirmed',
        body: `Your shift at ${facility.name} is confirmed: ${when}. Medilink.`,
        relatedType: 'matching.assignments',
        relatedId: assignmentId,
      }),
    );
  }

  // The representative stands for the facility. Once staff management lands,
  // this becomes whoever the facility has asked to be told.
  if (!(await alreadyNotified(facility.representativeUserId, 'assignment.confirmed', assignmentId))) {
    outcomes.push(
      await notify({
        userId: facility.representativeUserId,
        kind: 'assignment.confirmed',
        body: `A practitioner is confirmed for your shift on ${when}. Medilink.`,
        relatedType: 'matching.assignments',
        relatedId: assignmentId,
      }),
    );
  }

  failIfAnyFailed(outcomes, 'the confirmation');
}

/**
 * The practitioner is told when a facility cancels a booking they held, one
 * way or the other: a single release, or the whole shift being cancelled.
 *
 * Only the practitioner — the facility did it, and was told by doing it. The
 * facility's reason stays in the booking's history; it is the facility's own
 * account of its business and the practitioner is told that it happened, not
 * why.
 */
export async function notifyAssignmentCancelled(payload: Record<string, unknown>): Promise<void> {
  const assignmentId = String(payload.assignmentId ?? '');
  const practitionerId = String(payload.userId ?? '');
  const facilityId = String(payload.facilityId ?? '');

  if (!assignmentId || !practitionerId || !facilityId) {
    logger.warn('assignment.cancelled event missing ids; skipping notification');
    return;
  }

  if (await alreadyNotified(practitionerId, 'assignment.cancelled', assignmentId)) return;

  const [facility, assignment] = await Promise.all([
    prisma.facility.findUnique({ where: { id: facilityId }, select: { name: true } }),
    prisma.assignment.findUnique({
      where: { id: assignmentId },
      select: { startsAt: true, endsAt: true },
    }),
  ]);
  if (!facility || !assignment) {
    logger.warn('assignment.cancelled for a record that no longer exists', { assignmentId });
    return;
  }

  const when = formatShift(assignment.startsAt.toISOString(), assignment.endsAt.toISOString());

  failIfAnyFailed(
    [
      await notify({
        userId: practitionerId,
        kind: 'assignment.cancelled',
        body: `Your shift at ${facility.name} on ${when} has been cancelled by the facility. You do not need to attend. Medilink.`,
        relatedType: 'matching.assignments',
        relatedId: assignmentId,
      }),
    ],
    'the cancellation',
  );
}

/**
 * A severe or fatal clinical incident is put in front of the people who can act
 * on it, now. It used to wait in a queue until somebody happened to open the
 * page, and a death is not a thing to find by chance.
 *
 * The message names the facility and the severity and nothing else: no summary,
 * no patient, no practitioner. A text message is not where that belongs.
 *
 * With nobody holding `incident.manage` the alert would go nowhere and look
 * handled, so it fails instead, and the event stays visible as one that did not
 * get through.
 */
const ALERTING_SEVERITIES: Record<string, string> = { SEVERE: 'severe', DEATH: 'death' };

export async function notifyIncidentReported(payload: Record<string, unknown>): Promise<void> {
  const incidentId = String(payload.incidentId ?? '');
  const facilityId = String(payload.facilityId ?? '');
  const severity = ALERTING_SEVERITIES[String(payload.severity ?? '')];

  if (!incidentId || !facilityId) {
    logger.warn('clinical_incident.reported event missing ids; skipping notification');
    return;
  }
  if (!severity) return;

  const [officers, facility] = await Promise.all([
    usersHoldingPlatformPermission('incident.manage'),
    prisma.facility.findUnique({ where: { id: facilityId }, select: { name: true } }),
  ]);
  if (officers.length === 0) {
    throw new Error(
      `A ${severity} incident was reported and no one holds incident.manage to be told.`,
    );
  }

  const where = facility?.name ?? 'a facility';
  const outcomes: NotifyOutcome[] = [];
  for (const officer of officers) {
    if (await alreadyNotified(officer.id, 'incident.severe', incidentId)) continue;
    outcomes.push(
      await notify({
        userId: officer.id,
        kind: 'incident.severe',
        body: `A ${severity} clinical incident has been reported at ${where}. Review it in Medilink now.`,
        relatedType: 'clinical_incidents.clinical_incidents',
        relatedId: incidentId,
      }),
    );
  }

  failIfAnyFailed(outcomes, 'the incident alert');
}

/**
 * What happens to a dispute, told to the people in it.
 *
 * Nobody was, at any step. The admin screen said marking a case under review
 * "tells the other side somebody is looking" and that both sides read the
 * outcome; only DisputeOpened was published, and nothing consumed it.
 *
 *   opened        the other side, and the adjudicators, who have something to pick up
 *   under review  both sides
 *   resolved      both sides, with the outcome and a pointer to the reasons
 *   withdrawn     the other side
 *
 * What was argued is never in a text: not the reason somebody gave, not the
 * officer's notes. The parties read those in the app, signed in.
 */
type DisputeKind = 'dispute.opened' | 'dispute.under_review' | 'dispute.resolved' | 'dispute.withdrawn';

export async function notifyDisputeEvent(
  kind: DisputeKind,
  payload: Record<string, unknown>,
): Promise<void> {
  const disputeId = String(payload.disputeId ?? '');
  const assignmentId = String(payload.assignmentId ?? '');
  const practitionerId = String(payload.userId ?? '');
  const facilityId = String(payload.facilityId ?? '');
  const raisedBy = String(payload.raisedParty ?? '');

  if (!disputeId || !assignmentId || !practitionerId || !facilityId) {
    logger.warn('dispute event missing ids; skipping notification', { kind });
    return;
  }

  const [facility, assignment] = await Promise.all([
    prisma.facility.findUnique({
      where: { id: facilityId },
      select: { name: true, representativeUserId: true },
    }),
    prisma.assignment.findUnique({
      where: { id: assignmentId },
      select: { startsAt: true, endsAt: true },
    }),
  ]);
  if (!facility || !assignment) {
    logger.warn('dispute event for a record that no longer exists', { kind, disputeId });
    return;
  }

  const shift = `the shift at ${facility.name} on ${formatShift(
    assignment.startsAt.toISOString(),
    assignment.endsAt.toISOString(),
  )}`;
  const outcome = String(payload.outcome ?? '').toLowerCase();

  const practitioner = practitionerId;
  const facilitySide = facility.representativeUserId;
  const otherThanRaiser = raisedBy === 'FACILITY' ? [practitioner] : [facilitySide];

  const wording: Record<DisputeKind, { to: string[]; body: string }> = {
    'dispute.opened': {
      to: otherThanRaiser,
      body: `A dispute has been opened over ${shift}. Open Medilink to read it and add what you know. Medilink.`,
    },
    'dispute.under_review': {
      to: [practitioner, facilitySide],
      body: `The dispute over ${shift} is now being reviewed by Medilink. Medilink.`,
    },
    'dispute.resolved': {
      to: [practitioner, facilitySide],
      body: `The dispute over ${shift} has been decided: ${outcome || 'resolved'}. Open Medilink to read the reasons. Medilink.`,
    },
    'dispute.withdrawn': {
      to: otherThanRaiser,
      body: `The dispute over ${shift} has been withdrawn by the other party. Medilink.`,
    },
  };

  const { to, body } = wording[kind];
  const outcomes: NotifyOutcome[] = [];

  for (const userId of new Set(to)) {
    if (await alreadyNotified(userId, kind, disputeId)) continue;
    outcomes.push(
      await notify({
        userId,
        kind,
        body,
        relatedType: 'disputes.disputes',
        relatedId: disputeId,
      }),
    );
  }

  // Somebody has to pick a new case up. Not a failure if nobody holds the
  // permission — the queue is still there — so it is a warning, unlike a death.
  if (kind === 'dispute.opened') {
    const adjudicators = await usersHoldingPlatformPermission('dispute.manage');
    if (adjudicators.length === 0) logger.warn('a dispute was opened and no one holds dispute.manage', { disputeId });
    for (const adjudicator of adjudicators) {
      if (await alreadyNotified(adjudicator.id, kind, disputeId)) continue;
      outcomes.push(
        await notify({
          userId: adjudicator.id,
          kind,
          body: `A dispute has been opened over ${shift} and is waiting for review. Medilink.`,
          relatedType: 'disputes.disputes',
          relatedId: disputeId,
        }),
      );
    }
  }

  failIfAnyFailed(outcomes, `the ${kind.replace('dispute.', '')} notice`);
}

function naira(kobo: number): string {
  return `₦${(kobo / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

/**
 * An offer reaches the practitioner as a text. The whole premise is that a nurse
 * is told and answers in minutes; nothing was sent, so she had to open the app
 * and look.
 *
 * Not sent for an offer that has already closed — withdrawn, answered or lapsed
 * before the worker got to it — because a text about something she can no longer
 * accept is worse than none.
 */
export async function notifyShiftInvited(payload: Record<string, unknown>): Promise<void> {
  const invitationId = String(payload.invitationId ?? '');
  const practitionerId = String(payload.userId ?? '');
  const requestId = String(payload.serviceRequestId ?? '');
  const offeredAt = payload.offeredAt ? new Date(String(payload.offeredAt)) : undefined;

  if (!invitationId || !practitionerId || !requestId) {
    logger.warn('shift.invited event missing ids; skipping notification');
    return;
  }

  const [invitation, request] = await Promise.all([
    prisma.invitation.findUnique({ where: { id: invitationId }, select: { status: true } }),
    prisma.serviceRequest.findUnique({
      where: { id: requestId },
      select: {
        startsAt: true,
        endsAt: true,
        hourlyRateKobo: true,
        status: true,
        facility: { select: { name: true } },
      },
    }),
  ]);
  if (!invitation || !request) {
    logger.warn('shift.invited for a record that no longer exists', { invitationId });
    return;
  }
  if (invitation.status !== 'INVITED' || request.status !== 'PUBLISHED') return;
  if (await alreadyNotified(practitionerId, 'shift.invited', invitationId, offeredAt)) return;

  const when = formatShift(request.startsAt.toISOString(), request.endsAt.toISOString());

  failIfAnyFailed(
    [
      await notify({
        userId: practitionerId,
        kind: 'shift.invited',
        body: `Shift offer at ${request.facility.name}: ${when}, ${naira(request.hourlyRateKobo)} an hour. Open Medilink to accept or decline. Medilink.`,
        relatedType: 'matching.invitations',
        relatedId: invitationId,
      }),
    ],
    'the offer',
  );
}

/**
 * The facility hears that somebody said yes, so it can confirm while the
 * practitioner is still waiting. No name: until there is a booking the platform
 * shows initials at most, and a text goes to a phone anybody may pick up.
 */
export async function notifyShiftAccepted(payload: Record<string, unknown>): Promise<void> {
  const invitationId = String(payload.invitationId ?? '');
  const requestId = String(payload.serviceRequestId ?? '');
  const acceptedAt = payload.acceptedAt ? new Date(String(payload.acceptedAt)) : undefined;

  if (!invitationId || !requestId) {
    logger.warn('shift.accepted event missing ids; skipping notification');
    return;
  }

  const request = await prisma.serviceRequest.findUnique({
    where: { id: requestId },
    select: {
      startsAt: true,
      endsAt: true,
      status: true,
      facility: { select: { representativeUserId: true } },
    },
  });
  if (!request) {
    logger.warn('shift.accepted for a request that no longer exists', { requestId });
    return;
  }

  const representative = request.facility.representativeUserId;
  if (await alreadyNotified(representative, 'shift.accepted', invitationId, acceptedAt)) return;

  const when = formatShift(request.startsAt.toISOString(), request.endsAt.toISOString());
  failIfAnyFailed(
    [
      await notify({
        userId: representative,
        kind: 'shift.accepted',
        body: `A practitioner has accepted your offer for the shift on ${when}. Open Medilink to confirm. Medilink.`,
        relatedType: 'matching.invitations',
        relatedId: invitationId,
      }),
    ],
    'the acceptance',
  );
}

/**
 * A decision on a credential, told to the practitioner it concerns.
 *
 * Nothing was: "verified" had an event and no handler, and refusing or querying
 * a credential published nothing at all, so a mandatory credential queried once
 * could sit unanswered for as long as the practitioner did not open the app.
 *
 * The reviewer's notes are not in the text. They are the practitioner's to read
 * signed in, and a phone is not always the practitioner's own.
 */
type CredentialDecision = 'credential.verified' | 'credential.rejected' | 'credential.info_requested';

export async function notifyCredentialDecision(
  kind: CredentialDecision,
  payload: Record<string, unknown>,
): Promise<void> {
  const submissionId = String(payload.submissionId ?? '');
  const practitionerId = String(payload.userId ?? '');
  const typeId = String(payload.credentialTypeId ?? '');

  if (!submissionId || !practitionerId || !typeId) {
    logger.warn('credential decision event missing ids; skipping notification', { kind });
    return;
  }

  // One text per decision, not per submission: a query, an answer and an
  // approval are three separate things to be told about the same row.
  const decidedAfter = payload.decidedAt ? new Date(String(payload.decidedAt)) : undefined;
  if (await alreadyNotified(practitionerId, kind, submissionId, decidedAfter)) return;

  const type = await prisma.credentialType.findUnique({
    where: { id: typeId },
    select: { name: true },
  });
  const what = type?.name ?? 'credential';

  const wording: Record<CredentialDecision, string> = {
    'credential.verified': `Your ${what} has been verified. Medilink.`,
    'credential.rejected': `Your ${what} could not be approved. Open Medilink to see why and send it again. Medilink.`,
    'credential.info_requested': `Your ${what} needs more information. Open Medilink to see what is wanted. Medilink.`,
  };

  failIfAnyFailed(
    [
      await notify({
        userId: practitionerId,
        kind,
        body: wording[kind],
        relatedType: 'credentials.credential_submissions',
        relatedId: submissionId,
      }),
    ],
    'the credential decision',
  );
}
