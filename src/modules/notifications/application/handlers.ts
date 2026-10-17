import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { watWindow } from '@/lib/wat';
import {
  usersHoldingFacilityPermission,
  usersHoldingPlatformPermission,
} from '@/modules/auth/application/grants';
import { notify, requireDelivered, type NotifyOutcome } from './notify';

/**
 * What a domain event turns into, for the people it concerns.
 *
 * Handlers must be idempotent: the outbox delivers at least once, and a
 * retried delivery must not send a second message. Each checks for a message
 * it has already *delivered* against the same assignment before sending.
 *
 * Handlers must also be honest about failure: if a text did not go they throw,
 * after trying everyone, so the outbox retries the event with backoff and, in
 * the end, parks it as a dead letter an operator can see (NOT-03).
 */

/**
 * Whether this person has already received this message. A row that failed
 * does not count: counting it meant a failed text blocked its own retry, and
 * a manual re-run sent nothing either.
 */
export async function alreadyNotified(
  userId: string,
  kind: string,
  relatedId: string,
  /** Only a message sent since then counts: a reopened offer or a second query is the same row and needs telling again. */
  since?: Date,
): Promise<boolean> {
  const existing = await prisma.notificationMessage.findFirst({
    where: { userId, kind, relatedId, sentAt: { not: null, ...(since ? { gte: since } : {}) } },
    select: { id: true },
  });
  return existing !== null;
}

/** In West Africa Time, the clock on the ward and the one every screen uses. */
export function formatShift(startsAt: Date, endsAt: Date): string {
  return watWindow(startsAt, endsAt);
}

/**
 * "NGN 5,000", not the naira sign: a character outside the basic GSM set makes
 * the whole message a costlier encoding with a shorter limit.
 */
const NAIRA = new Intl.NumberFormat('en-NG', { maximumFractionDigits: 0 });
export const ngn = (kobo: number) => `NGN ${NAIRA.format(Math.round(kobo / 100))}`;

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

  const when = formatShift(assignment.startsAt, assignment.endsAt);
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

  requireDelivered(outcomes);
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

  const when = formatShift(assignment.startsAt, assignment.endsAt);

  requireDelivered([
    await notify({
      userId: practitionerId,
      kind: 'assignment.cancelled',
      body: `Your shift at ${facility.name} on ${when} has been cancelled by the facility. You do not need to attend. Medilink.`,
      relatedType: 'matching.assignments',
      relatedId: assignmentId,
    }),
  ]);
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

  requireDelivered(outcomes);
}

/**
 * What happens to a dispute after it is opened, told to the people in it.
 *
 * Nobody was, at any step. The admin screen said marking a case under review
 * "tells the other side somebody is looking" and that both sides read the
 * outcome. (Opening one is `notifyDisputeOpened` in event-handlers.ts.)
 *
 *   under review  both sides
 *   resolved      both sides, with the outcome and a pointer to the reasons
 *   withdrawn     the other side
 *
 * What was argued is never in a text: not the reason somebody gave, not the
 * officer's notes. The parties read those in the app, signed in.
 */
type DisputeStage = 'dispute.under_review' | 'dispute.resolved' | 'dispute.withdrawn';

export async function notifyDisputeStage(
  kind: DisputeStage,
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

  const shift = `the shift at ${facility.name} on ${formatShift(assignment.startsAt, assignment.endsAt)}`;
  const outcome = String(payload.outcome ?? '').toLowerCase();

  const facilitySide = facility.representativeUserId;
  const otherThanRaiser = raisedBy === 'FACILITY' ? [practitionerId] : [facilitySide];

  const wording: Record<DisputeStage, { to: string[]; body: string }> = {
    'dispute.under_review': {
      to: [practitionerId, facilitySide],
      body: `The dispute over ${shift} is now being reviewed by Medilink. Medilink.`,
    },
    'dispute.resolved': {
      to: [practitionerId, facilitySide],
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

  requireDelivered(outcomes);
}

/**
 * The facility sent the hours back, told to the practitioner so they know to act.
 * (Approval is `notifyTimesheetApproved` in event-handlers.ts.)
 *
 * The reason is not in the text. It is what a person at the facility typed, about the
 * practitioner and often about the ward, and a text sits on a lock screen and in the
 * carrier's records. It is read on the practitioner's sheet in the app, which is where they
 * correct the hours; the text says there is something to read there. The same rule keeps a
 * dispute's reason out of its text.
 */
export async function notifyTimesheetRejected(payload: Record<string, unknown>): Promise<void> {
  const assignmentId = String(payload.assignmentId ?? '');
  const facilityId = String(payload.facilityId ?? '');
  const practitionerId = String(payload.userId ?? '');
  if (!assignmentId || !facilityId || !practitionerId) {
    logger.warn('timesheet.rejected event missing ids; skipping notification');
    return;
  }

  const [facility, assignment, record] = await Promise.all([
    prisma.facility.findUnique({ where: { id: facilityId }, select: { name: true } }),
    prisma.assignment.findUnique({ where: { id: assignmentId }, select: { startsAt: true, endsAt: true } }),
    prisma.attendanceRecord.findUnique({ where: { assignmentId }, select: { reviewedAt: true } }),
  ]);
  if (!facility || !assignment) {
    logger.warn('timesheet.rejected for a record that no longer exists', { assignmentId });
    return;
  }

  // One text per decision: sent back twice is two things to be told about the same shift.
  if (await alreadyNotified(practitionerId, 'timesheet.rejected', assignmentId, record?.reviewedAt ?? undefined)) return;

  const when = formatShift(assignment.startsAt, assignment.endsAt);
  requireDelivered([
    await notify({
      userId: practitionerId,
      kind: 'timesheet.rejected',
      body: `Your hours for the shift at ${facility.name} (${when}) were not approved. Open Medilink to see why, correct them and send them again. Medilink.`,
      relatedType: 'matching.assignments',
      relatedId: assignmentId,
    }),
  ]);
}

/**
 * All of somebody's access to a facility was removed at once: the person is told, and so is
 * everybody else who can add and remove staff there (other than whoever did it), so that a removal
 * cannot go unnoticed by the people who run the place.
 *
 * Neither text says why, or who was removed, or who did it. A text goes to a phone anybody may
 * pick up, and the Staff page, signed in, is where those are read.
 */
export async function notifyStaffAccessRemoved(payload: Record<string, unknown>): Promise<void> {
  const userId = String(payload.userId ?? '');
  const facilityId = String(payload.facilityId ?? '');
  const byUserId = String(payload.byUserId ?? '');
  const removedAt = new Date(String(payload.removedAt ?? ''));
  if (!userId || !facilityId || Number.isNaN(removedAt.getTime())) {
    logger.warn('staff.access_removed event missing what it needs; skipping notification');
    return;
  }

  const facility = await prisma.facility.findUnique({ where: { id: facilityId }, select: { name: true } });
  if (!facility) {
    logger.warn('staff.access_removed for a facility that no longer exists', { facilityId });
    return;
  }

  const outcomes: NotifyOutcome[] = [];

  // Only a message sent since the removal counts, so a person removed a second time is told again.
  if (!(await alreadyNotified(userId, 'staff.access_removed', facilityId, removedAt))) {
    outcomes.push(
      await notify({
        userId,
        kind: 'staff.access_removed',
        body: `Your access to ${facility.name} on Medilink was removed. If you think this is a mistake, speak to the people who run ${facility.name}. Medilink.`,
        relatedType: 'facilities.facilities',
        relatedId: facilityId,
      }),
    );
  }

  const owners = await usersHoldingFacilityPermission(facilityId, 'role.grant');
  for (const owner of owners) {
    if (owner.id === byUserId || owner.id === userId) continue;
    if (await alreadyNotified(owner.id, 'staff.access_removed_owners', facilityId, removedAt)) continue;
    outcomes.push(
      await notify({
        userId: owner.id,
        kind: 'staff.access_removed_owners',
        body: `Somebody's access to ${facility.name} on Medilink was removed just now. Open Medilink and look under Staff to see who. Medilink.`,
        relatedType: 'facilities.facilities',
        relatedId: facilityId,
      }),
    );
  }

  requireDelivered(outcomes);
}

/**
 * An invoice that is ready, told to the people at the facility who can read it.
 * Sent when it is issued, not when the draft is raised: a draft is still being
 * checked and is not yet a bill.
 */
export async function notifyInvoiceIssued(payload: Record<string, unknown>): Promise<void> {
  const invoiceId = String(payload.invoiceId ?? '');
  const facilityId = String(payload.facilityId ?? '');
  const number = String(payload.number ?? '');
  const grossKobo = Number(payload.grossKobo ?? 0);
  if (!invoiceId || !facilityId) {
    logger.warn('invoice.issued event missing ids; skipping notification');
    return;
  }

  const [facility, readers] = await Promise.all([
    prisma.facility.findUnique({ where: { id: facilityId }, select: { name: true } }),
    usersHoldingFacilityPermission(facilityId, 'invoice.read'),
  ]);
  if (!facility) return;

  const outcomes: NotifyOutcome[] = [];
  for (const reader of readers) {
    if (await alreadyNotified(reader.id, 'invoice.issued', invoiceId)) continue;
    outcomes.push(
      await notify({
        userId: reader.id,
        kind: 'invoice.issued',
        body: `Invoice ${number} for ${ngn(grossKobo)} is ready for ${facility.name}. Open Medilink to see the shifts on it. Medilink.`,
        relatedType: 'billing.invoices',
        relatedId: invoiceId,
      }),
    );
  }
  requireDelivered(outcomes);
}

/**
 * A payment to a practitioner, told to them when money has actually gone.
 *
 * Nothing is said for a payout that ran only against the stub gateway: its
 * reference begins `stub-` precisely so that nobody mistakes it for a bank one,
 * and a text saying "you have been paid" about money that did not move is worse
 * than silence.
 */
export async function notifyPayoutSettled(payload: Record<string, unknown>): Promise<void> {
  const payoutId = String(payload.payoutId ?? '');
  const practitionerId = String(payload.userId ?? '');
  const amountKobo = Number(payload.amountKobo ?? 0);
  const reference = String(payload.reference ?? '');
  if (!payoutId || !practitionerId) {
    logger.warn('payout.settled event missing ids; skipping notification');
    return;
  }
  if (reference.startsWith('stub-')) return;
  if (await alreadyNotified(practitionerId, 'payout.settled', payoutId)) return;

  requireDelivered([
      await notify({
        userId: practitionerId,
        kind: 'payout.settled',
        body: `A payment of ${ngn(amountKobo)} has been sent to you${reference ? ` (reference ${reference})` : ''}. Medilink.`,
        relatedType: 'billing.payouts',
        relatedId: payoutId,
      }),
    ]);
}

/**
 * Somebody has added a bank account to be paid into, told to the person it is for.
 *
 * This is the control, not a courtesy: a stranger with a stolen session adding an
 * account is how somebody else's pay is redirected, and the person it is for is the
 * one who can say it was not them. Says which bank and the last four digits and
 * nothing more, and that nothing is paid to it until it has been checked.
 */
export async function notifyPayoutAccountSubmitted(payload: Record<string, unknown>): Promise<void> {
  const accountId = String(payload.accountId ?? '');
  const userId = String(payload.userId ?? '');
  const bankName = String(payload.bankName ?? 'a bank');
  const last4 = String(payload.last4 ?? '');
  const holdHours = Number(payload.holdHours ?? 0);
  if (!accountId || !userId) {
    logger.warn('payout_account.submitted event missing ids; skipping notification');
    return;
  }
  if (await alreadyNotified(userId, 'payout_account.submitted', accountId)) return;

  const wait = holdHours > 0 ? ` and ${holdHours} hours have passed` : '';
  requireDelivered([
      await notify({
        userId,
        kind: 'payout_account.submitted',
        body: `A bank account ending ${last4} at ${bankName} was added for payments to you. If this was not you, contact Medilink straight away. Nothing is paid to it until it has been checked${wait}. Medilink.`,
        relatedType: 'billing.payout_accounts',
        relatedId: accountId,
      }),
    ]);
}

/** An account was verified or refused, told to the person it is for, with the reason if it was refused. */
export async function notifyPayoutAccountReviewed(payload: Record<string, unknown>): Promise<void> {
  const accountId = String(payload.accountId ?? '');
  const userId = String(payload.userId ?? '');
  const last4 = String(payload.last4 ?? '');
  const refused = payload.decision === 'reject';
  const note = String(payload.note ?? '').trim();
  if (!accountId || !userId) {
    logger.warn('payout_account.reviewed event missing ids; skipping notification');
    return;
  }
  if (await alreadyNotified(userId, 'payout_account.reviewed', accountId)) return;

  requireDelivered([
      await notify({
        userId,
        kind: 'payout_account.reviewed',
        body: refused
          ? `The bank account ending ${last4} could not be verified${note ? `: ${note}` : ''}. Please give another account in your earnings page. Medilink.`
          : `The bank account ending ${last4} has been verified. Payments to you will go to it. Medilink.`,
        relatedType: 'billing.payout_accounts',
        relatedId: accountId,
      }),
    ]);
}
