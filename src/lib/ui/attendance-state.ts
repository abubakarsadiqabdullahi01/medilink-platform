import { CHECK_IN_OPENS_BEFORE_MS } from '@/lib/ui/practitioner-today';
import { formatClock } from '@/components/app/format';
import { waitingFor } from '@/components/app/queue-age';

/**
 * Where a confirmed shift stands for the person working it, in words.
 *
 * The platform's own attendance states are nine names a practitioner never uses. What they need
 * to know is one of a handful of things — can I check in yet, am I late, am I on shift, did I
 * check out, have the hours gone — each with the next step. A shift nobody has opened has no
 * attendance record at all, which reads as `NOT_STARTED`.
 */
export type AttendanceTone = 'neutral' | 'info' | 'warning' | 'success';

export type AttendanceKey =
  | 'opens-later'
  | 'check-in-open'
  | 'late'
  | 'unattended'
  | 'checked-in'
  | 'check-out-due'
  | 'checked-out'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'disputed';

export interface AttendanceState {
  key: AttendanceKey;
  /** The state, in a few words. Never colour alone: the tone only decides the mark beside it. */
  label: string;
  /** What to do next, or what is being waited on. */
  detail: string;
  tone: AttendanceTone;
}

export function attendanceState({
  status,
  startsAt,
  endsAt,
  now,
}: {
  status?: string | null;
  startsAt: string;
  endsAt: string;
  now: Date;
}): AttendanceState {
  const state = status ?? 'NOT_STARTED';
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const opensAt = new Date(start.getTime() - CHECK_IN_OPENS_BEFORE_MS);

  switch (state) {
    case 'CHECKED_IN':
      return end.getTime() < now.getTime()
        ? {
            key: 'check-out-due',
            label: 'Still checked in',
            detail: 'The shift has ended. Ask the ward for the check-out code.',
            tone: 'warning',
          }
        : {
            key: 'checked-in',
            label: 'Checked in',
            detail: 'Ask the ward for the check-out code when you leave.',
            tone: 'success',
          };
    case 'CHECKED_OUT':
    case 'MANUALLY_CORRECTED':
      return {
        key: 'checked-out',
        label: 'Checked out',
        detail: 'Send your hours to the facility. Nothing is paid until you do.',
        tone: 'info',
      };
    case 'SUBMITTED':
      return {
        key: 'submitted',
        label: 'Hours sent',
        detail: 'The facility approves them or sends them back.',
        tone: 'neutral',
      };
    case 'APPROVED':
      return {
        key: 'approved',
        label: 'Hours approved',
        detail: 'Paid once the shift is invoiced.',
        tone: 'success',
      };
    case 'REJECTED':
      return {
        key: 'rejected',
        label: 'Hours sent back',
        detail: 'Correct them and send them again.',
        tone: 'warning',
      };
    case 'DISPUTED':
      return {
        key: 'disputed',
        label: 'In dispute',
        detail: 'An officer is deciding. The shift is on hold.',
        tone: 'warning',
      };
    default:
      break;
  }

  // Nothing recorded yet, or a code has been issued and not yet used.
  if (end.getTime() <= now.getTime()) {
    return {
      key: 'unattended',
      label: 'No check-in recorded',
      detail: 'The shift has ended. If something stopped you attending, say so.',
      tone: 'warning',
    };
  }
  if (start.getTime() <= now.getTime()) {
    return {
      key: 'late',
      label: 'Not checked in yet',
      detail: `The shift started ${waitingFor(start, now)} ago. Ask the ward for a code.`,
      tone: 'warning',
    };
  }
  // A code the ward has already issued is honoured whenever it was issued.
  if (state === 'CHECK_IN_PENDING' || opensAt.getTime() <= now.getTime()) {
    return {
      key: 'check-in-open',
      label: 'You can check in now',
      detail: 'Ask the ward for a code when you arrive.',
      tone: 'info',
    };
  }
  return {
    key: 'opens-later',
    label: `You can check in from ${formatClock(opensAt)}`,
    detail: 'Three hours before the shift starts. The ward reads a code out when you arrive.',
    tone: 'neutral',
  };
}
