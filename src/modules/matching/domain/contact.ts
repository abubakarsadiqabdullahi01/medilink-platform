import type { AssignmentStatusValue } from './assignment';

/**
 * When a facility may see the phone number of somebody it has booked.
 *
 * A booking releases contact details — but around the shift, not for ever. The
 * ward needs the number in the day or two before to coordinate and for the
 * day after to chase a no-show or settle a timesheet question; before that
 * there is nothing to say, and after it there is nothing to settle. A roster
 * that shows every number permanently is a staff directory, and the platform
 * stops being needed the moment the first shift is confirmed.
 *
 * Plain numbers rather than configuration: they will move after Gombe teaches
 * what a ward actually needs, and changing two constants is a one-line diff
 * with a reviewable reason.
 */
export const CONTACT_OPENS_HOURS_BEFORE = 48;
export const CONTACT_CLOSES_HOURS_AFTER = 24;

const HOUR_MS = 60 * 60 * 1000;

export function isContactOpen(input: {
  status: AssignmentStatusValue;
  startsAt: Date;
  endsAt: Date;
  now: Date;
}): boolean {
  // A cancelled booking is no booking: there is nothing to coordinate.
  if (input.status === 'CANCELLED') return false;

  const opens = input.startsAt.getTime() - CONTACT_OPENS_HOURS_BEFORE * HOUR_MS;
  const closes = input.endsAt.getTime() + CONTACT_CLOSES_HOURS_AFTER * HOUR_MS;
  const at = input.now.getTime();
  return at >= opens && at <= closes;
}
