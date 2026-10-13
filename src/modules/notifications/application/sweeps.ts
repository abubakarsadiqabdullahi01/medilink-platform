import { prisma } from '@/lib/db';
import { usersHoldingFacilityPermission } from '@/modules/auth/application/grants';
import { alreadyNotified, notify, type NotifyOutcome } from './notify';
import { failIfAnyFailed, formatShift } from './handlers';

/**
 * Two things nobody was told about until it was too late: a licence about to
 * expire, and hours waiting for approval.
 *
 * Run by scheduled jobs, so idempotent by construction: a person is told once at
 * each stage, and one who could not be reached is tried again by the next run
 * because only a message that went counts.
 *
 * The stages are starting points to be tuned against how people behave, not
 * measurements.
 */

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

/** A licence is warned about this long before it expires, and again in the last week. */
export const EXPIRY_WARNING_DAYS = [30, 7] as const;

/** Hours waiting before the facility is reminded, and before the practitioner is told it is being chased. */
export const APPROVAL_REMINDER_HOURS = [24, 72] as const;

const lagosDate = (date: Date) => new Date(date.getTime() + 60 * 60 * 1000).toISOString().slice(0, 10);

/**
 * Warns practitioners whose verified credential expires within a month, and
 * again within a week.
 *
 * Not for one already renewed (another verified submission of the same type that
 * runs later), not for one that has already lapsed (the expiry sweep owns that),
 * and only one message per stage however many times the job runs.
 */
export async function warnExpiringCredentials(now: Date = new Date()): Promise<number> {
  const horizon = new Date(now.getTime() + EXPIRY_WARNING_DAYS[0] * DAY);
  const expiring = await prisma.credentialSubmission.findMany({
    where: { status: 'VERIFIED', deletedAt: null, expiresAt: { gt: now, lte: horizon } },
    select: {
      id: true,
      userId: true,
      credentialTypeId: true,
      expiresAt: true,
      credentialType: { select: { name: true } },
    },
  });

  const outcomes: NotifyOutcome[] = [];
  for (const credential of expiring) {
    const expiresAt = credential.expiresAt!;
    const daysLeft = Math.ceil((expiresAt.getTime() - now.getTime()) / DAY);
    const kind = daysLeft <= EXPIRY_WARNING_DAYS[1] ? 'credential.expiry_warning_7' : 'credential.expiry_warning_30';

    if (await alreadyNotified(credential.userId, kind, credential.id)) continue;

    const renewed = await prisma.credentialSubmission.count({
      where: {
        userId: credential.userId,
        credentialTypeId: credential.credentialTypeId,
        status: 'VERIFIED',
        deletedAt: null,
        id: { not: credential.id },
        expiresAt: { gt: expiresAt },
      },
    });
    if (renewed > 0) continue;

    outcomes.push(
      await notify({
        userId: credential.userId,
        kind,
        body: `Your ${credential.credentialType.name} expires on ${lagosDate(expiresAt)} (in ${daysLeft} day${daysLeft === 1 ? '' : 's'}). Renew it in Medilink so you can keep being offered shifts. Medilink.`,
        relatedType: 'credentials.credential_submissions',
        relatedId: credential.id,
      }),
    );
  }

  failIfAnyFailed(outcomes, 'the expiry warnings');
  return outcomes.filter((outcome) => outcome === 'sent').length;
}

/**
 * Reminds the facility about hours that have waited a day, and again at three
 * days, and at three days tells the practitioner they are being chased.
 *
 * It decides nothing. Whether hours should be approved, corrected or refused is
 * the facility's, and a deadline after which they are approved for it is a
 * commercial decision this does not make (TIM-01). What it does is stop pay
 * waiting on somebody who has simply not noticed.
 */
export async function remindUnapprovedTimesheets(now: Date = new Date()): Promise<number> {
  const waiting = await prisma.attendanceRecord.findMany({
    where: {
      status: 'SUBMITTED',
      submittedAt: { lte: new Date(now.getTime() - APPROVAL_REMINDER_HOURS[0] * HOUR) },
    },
    select: {
      assignmentId: true,
      submittedAt: true,
      assignment: {
        select: {
          userId: true,
          facilityId: true,
          startsAt: true,
          endsAt: true,
          serviceRequest: { select: { facility: { select: { name: true } } } },
        },
      },
    },
  });

  const outcomes: NotifyOutcome[] = [];
  for (const record of waiting) {
    const { assignment } = record;
    const hoursWaiting = (now.getTime() - record.submittedAt!.getTime()) / HOUR;
    const stage = hoursWaiting >= APPROVAL_REMINDER_HOURS[1] ? '72h' : '24h';
    const kind = `timesheet.reminder_${stage}`;
    const days = Math.floor(hoursWaiting / 24);
    const facilityName = assignment.serviceRequest.facility.name;
    const when = formatShift(assignment.startsAt.toISOString(), assignment.endsAt.toISOString());

    for (const approver of await usersHoldingFacilityPermission(assignment.facilityId, 'timesheet.approve')) {
      if (await alreadyNotified(approver.id, kind, record.assignmentId)) continue;
      outcomes.push(
        await notify({
          userId: approver.id,
          kind,
          body: `Hours for the shift at ${facilityName} (${when}) have been waiting ${days} day${days === 1 ? '' : 's'} for approval. Approve or correct them in Medilink so the practitioner can be paid. Medilink.`,
          relatedType: 'matching.assignments',
          relatedId: record.assignmentId,
        }),
      );
    }

    if (stage === '72h' && !(await alreadyNotified(assignment.userId, 'timesheet.waiting', record.assignmentId))) {
      outcomes.push(
        await notify({
          userId: assignment.userId,
          kind: 'timesheet.waiting',
          body: `Your hours for the shift at ${facilityName} (${when}) have been waiting ${days} days for approval. We have reminded them. Medilink.`,
          relatedType: 'matching.assignments',
          relatedId: record.assignmentId,
        }),
      );
    }
  }

  failIfAnyFailed(outcomes, 'the approval reminders');
  return outcomes.filter((outcome) => outcome === 'sent').length;
}
