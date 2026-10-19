import { formatClock, formatMinutes } from '@/components/app/format';

/**
 * What a ward manager needs to know about a confirmed practitioner *right now*, in a sentence:
 * not "NOT_STARTED", but "not checked in, 25 minutes after the start".
 *
 * Worked out in the browser from the times already on the row and the clock — no request. The
 * status badge beside it still says what the record is; this says what that means for the ward.
 * Only the states where something is still to happen have a note: once somebody has left, the
 * badge and the times are the whole story.
 */
export const LATE_AFTER_MINUTES = 15;

/** "25 minutes", "1h 10m": formatMinutes would say "0h 25m", which nobody says aloud. */
function howLong(minutes: number): string {
  return minutes < 60 ? `${minutes} minute${minutes === 1 ? '' : 's'}` : formatMinutes(minutes);
}

export type NoteTone = 'neutral' | 'info' | 'warning';

export interface AttendanceNote {
  kind: 'not-due' | 'due-now' | 'late' | 'missed' | 'on-site' | 'overdue-checkout';
  tone: NoteTone;
  text: string;
}

export function attendanceNote(
  input: {
    status: string;
    startsAt: string;
    endsAt: string;
    checkedInAt: string | null;
  },
  now: Date,
): AttendanceNote | null {
  const starts = new Date(input.startsAt).getTime();
  const ends = new Date(input.endsAt).getTime();
  const at = now.getTime();

  if (input.status === 'CHECKED_IN') {
    if (at >= ends) {
      return {
        kind: 'overdue-checkout',
        tone: 'warning',
        text: `Not checked out — the shift ended at ${formatClock(input.endsAt)}`,
      };
    }
    return {
      kind: 'on-site',
      tone: 'info',
      text: input.checkedInAt ? `On site since ${formatClock(input.checkedInAt)}` : 'On site',
    };
  }

  if (input.status !== 'NOT_STARTED' && input.status !== 'CHECK_IN_PENDING') return null;

  if (at < starts) return { kind: 'not-due', tone: 'neutral', text: 'Not due yet' };
  if (at >= ends) {
    return { kind: 'missed', tone: 'warning', text: 'No check-in was recorded for this shift' };
  }
  const minutesLate = Math.floor((at - starts) / 60_000);
  if (minutesLate < LATE_AFTER_MINUTES) {
    return { kind: 'due-now', tone: 'neutral', text: 'Due now — not checked in yet' };
  }
  return {
    kind: 'late',
    tone: 'warning',
    text: `Not checked in — ${howLong(minutesLate)} after the start`,
  };
}
