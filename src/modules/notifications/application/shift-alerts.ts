import { prisma } from '@/lib/db';
import { initialsOf } from '@/lib/names';
import { notify, requireDelivered, type NotifyOutcome } from './notify';
import { alreadyNotified, formatShift } from './handlers';

/**
 * Two things that used to be noticed only afterwards: that a shift is about to
 * start, and that nobody has turned up for one that has.
 *
 * An absence was found only by the hourly sweep after the shift ended, so an
 * urgent shift could not be saved; and there was no reminder at all. Neither of
 * these decides anything. Whether somebody was absent, and whose fault it was,
 * stays with the people and the sweep that already own that question: this tells
 * the ward and the practitioner while there is still something to do about it.
 *
 * Run by scheduled jobs, so idempotent by construction: a person is never told
 * twice about the same shift, and one who could not be reached is tried again by
 * the next run. The numbers below are starting points to be tuned against real
 * shifts, not measured ones.
 */

/** A reminder goes out this long before the start, to anyone not told more recently than that. */
export const REMINDER_LEAD_HOURS = 3;

/** How long after the start a missing check-in is worth saying something about. */
export const NOT_CHECKED_IN_AFTER_MINUTES = 30;

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/**
 * Tells each practitioner their shift is coming up.
 *
 * Skipped for a booking made within the last hour: they have just been sent a
 * confirmation, and a second text to the same effect is noise. Returns how many
 * people were told. Throws if any text failed, after trying everybody, so the
 * run is recorded as failed and the next one reaches whoever was missed.
 */
export async function sendShiftReminders(now: Date = new Date()): Promise<number> {
  const due = await prisma.assignment.findMany({
    where: {
      status: 'CONFIRMED',
      startsAt: { gt: now, lte: new Date(now.getTime() + REMINDER_LEAD_HOURS * HOUR) },
      createdAt: { lte: new Date(now.getTime() - HOUR) },
    },
    select: {
      id: true,
      userId: true,
      startsAt: true,
      endsAt: true,
      serviceRequest: { select: { facility: { select: { name: true } } } },
    },
  });

  const outcomes: NotifyOutcome[] = [];
  for (const assignment of due) {
    if (await alreadyNotified(assignment.userId, 'shift.reminder', assignment.id)) continue;

    const when = formatShift(assignment.startsAt, assignment.endsAt);
    outcomes.push(
      await notify({
        userId: assignment.userId,
        kind: 'shift.reminder',
        body: `Reminder: your shift at ${assignment.serviceRequest.facility.name} is ${when}. Get the check-in code from your supervisor when you arrive. Medilink.`,
        relatedType: 'matching.assignments',
        relatedId: assignment.id,
      }),
    );
  }

  requireDelivered(outcomes);
  return outcomes.filter((outcome) => outcome.sent).length;
}

/**
 * Tells the practitioner and the facility that nobody has checked in, once the
 * grace period after the start has passed and while the shift is still running.
 *
 * Nothing is marked and nothing is decided. The practitioner may be at the
 * ward with a phone that is off, the code may not have been issued, the
 * network may be down: the point is that a person is asked now rather than
 * after the shift has ended and the chance to cover it has gone. The facility is
 * told with initials only, because a text goes to a phone anybody may pick up
 * and the roster in the app has the name.
 */
export async function alertShiftsNotCheckedIn(now: Date = new Date()): Promise<number> {
  const waiting = await prisma.assignment.findMany({
    where: {
      status: 'CONFIRMED',
      startsAt: { lte: new Date(now.getTime() - NOT_CHECKED_IN_AFTER_MINUTES * MINUTE) },
      endsAt: { gt: now },
      OR: [{ attendance: { is: null } }, { attendance: { is: { checkedInAt: null } } }],
    },
    select: {
      id: true,
      userId: true,
      startsAt: true,
      endsAt: true,
      user: { select: { fullName: true } },
      serviceRequest: { select: { facility: { select: { name: true, representativeUserId: true } } } },
    },
  });

  const outcomes: NotifyOutcome[] = [];
  for (const assignment of waiting) {
    const { facility } = assignment.serviceRequest;
    const when = formatShift(assignment.startsAt, assignment.endsAt);

    if (!(await alreadyNotified(assignment.userId, 'shift.not_checked_in', assignment.id))) {
      outcomes.push(
        await notify({
          userId: assignment.userId,
          kind: 'shift.not_checked_in',
          body: `You have not checked in for your shift at ${facility.name} (${when}). Get the code from your supervisor, or contact the ward. Medilink.`,
          relatedType: 'matching.assignments',
          relatedId: assignment.id,
        }),
      );
    }

    if (!(await alreadyNotified(facility.representativeUserId, 'shift.not_checked_in', assignment.id))) {
      outcomes.push(
        await notify({
          userId: facility.representativeUserId,
          kind: 'shift.not_checked_in',
          body: `${initialsOf(assignment.user.fullName)} has not checked in for the shift at ${facility.name} (${when}). Open Medilink to see the roster. Medilink.`,
          relatedType: 'matching.assignments',
          relatedId: assignment.id,
        }),
      );
    }
  }

  requireDelivered(outcomes);
  return outcomes.filter((outcome) => outcome.sent).length;
}
