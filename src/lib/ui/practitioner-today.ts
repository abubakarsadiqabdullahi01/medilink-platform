import { endOfLagosDay, lagosDate } from '@/lib/lagos-date';

/**
 * What a practitioner has to do *now*, worked out from the shifts, offers and credentials the
 * overview already holds. Pure, so the rules are written down once and tested, and so the page
 * that draws them has nothing to decide.
 *
 * The attendance states are the platform's own (attendance.ts): a shift that nobody has opened
 * has no record at all, which reads as `NOT_STARTED`.
 */

export interface TodayAttendance {
  status: string;
  checkedInAt?: string | null;
  checkedOutAt?: string | null;
}

export interface TodayAssignment {
  id: string;
  status: string;
  startsAt: string;
  endsAt: string;
  facilityName: string;
  shiftType: string;
  hourlyRateKobo: number;
  attendance?: TodayAttendance | null;
}

export interface TodayInvitation {
  id: string;
  status: string;
  expiresAt: string;
  startsAt: string;
  endsAt: string;
  facilityName: string;
  professionalCategoryId: string;
  hourlyRateKobo: number;
  urgency: string;
  levelName: string | null;
}

export interface TodayCredential {
  id: string;
  credentialTypeId: string;
  status: string;
  expiresAt?: string | null;
  documentExpiresOn?: string | null;
}

/** The ward reads the check-in code out at the desk, so the box opens three hours before the shift. */
export const CHECK_IN_OPENS_BEFORE_MS = 3 * 60 * 60 * 1000;

const NOT_OPENED = new Set(['NOT_STARTED', 'CHECK_IN_PENDING']);
const READY = new Set(['CHECKED_OUT', 'MANUALLY_CORRECTED']);

const statusOf = (row: TodayAssignment) => row.attendance?.status ?? 'NOT_STARTED';
const startOf = (row: TodayAssignment) => new Date(row.startsAt).getTime();
const endOf = (row: TodayAssignment) => new Date(row.endsAt).getTime();

export interface ShiftsToday {
  /** On shift now: started, not ended, or checked in and not yet out. */
  inProgress: TodayAssignment[];
  /** Within three hours of starting, or started, with nobody checked in. */
  checkInDue: TodayAssignment[];
  /** Still to start, earliest first. Includes ones whose check-in is due. */
  upcoming: TodayAssignment[];
  /** Worked, not yet sent to the facility. Nothing is paid until it is. */
  readyToSubmit: TodayAssignment[];
  /** The facility asked for a correction. */
  needsCorrection: TodayAssignment[];
  /** Sent, and the facility has not decided. */
  withFacility: TodayAssignment[];
  /** Ended and nobody was ever checked in: the person may want to say why. */
  endedUnattended: TodayAssignment[];
  /** The one to show as "next": what is on now, else the earliest still to come. */
  next: TodayAssignment | null;
}

export function deriveShifts(assignments: TodayAssignment[], now: Date = new Date()): ShiftsToday {
  const t = now.getTime();
  const confirmed = assignments.filter((row) => row.status === 'CONFIRMED');

  const inProgress = confirmed.filter((row) => {
    const status = statusOf(row);
    return (
      status === 'CHECKED_IN' || (startOf(row) <= t && endOf(row) > t && NOT_OPENED.has(status))
    );
  });
  const checkInDue = confirmed.filter(
    (row) =>
      NOT_OPENED.has(statusOf(row)) &&
      endOf(row) > t &&
      startOf(row) - CHECK_IN_OPENS_BEFORE_MS <= t,
  );
  const upcoming = confirmed
    .filter((row) => startOf(row) > t)
    .sort((a, b) => startOf(a) - startOf(b));

  const byEnd = (a: TodayAssignment, b: TodayAssignment) => endOf(b) - endOf(a);
  const readyToSubmit = confirmed.filter((row) => READY.has(statusOf(row))).sort(byEnd);
  const needsCorrection = confirmed.filter((row) => statusOf(row) === 'REJECTED').sort(byEnd);
  const withFacility = confirmed.filter((row) => statusOf(row) === 'SUBMITTED').sort(byEnd);
  const endedUnattended = confirmed
    .filter((row) => endOf(row) <= t && NOT_OPENED.has(statusOf(row)))
    .sort(byEnd);

  const next = [...inProgress].sort((a, b) => startOf(a) - startOf(b))[0] ?? upcoming[0] ?? null;

  return {
    inProgress,
    checkInDue,
    upcoming,
    readyToSubmit,
    needsCorrection,
    withFacility,
    endedUnattended,
    next,
  };
}

/** Offers that can still be answered, the soonest to lapse first. A lapsed offer is not waiting. */
export function openOffers(
  invitations: TodayInvitation[],
  now: Date = new Date(),
): TodayInvitation[] {
  return invitations
    .filter((row) => row.status === 'INVITED' && new Date(row.expiresAt).getTime() > now.getTime())
    .sort((a, b) => new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime());
}

export interface ExpiringCredential {
  id: string;
  credentialTypeId: string;
  expired: boolean;
  /** Whole days from now; negative once it has lapsed. */
  daysLeft: number;
  at: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Credentials that have lapsed or will within `withinDays`.
 *
 * The date printed on the document is the one that counts when it was read off it; the platform's
 * own estimate is used only when it was not. A credential whose type has a newer verified
 * submission is not expiring: the old row is history.
 */
export function expiringCredentials(
  credentials: TodayCredential[],
  now: Date = new Date(),
  withinDays = 30,
): ExpiringCredential[] {
  const currentTypes = new Set(
    credentials
      .filter((row) => row.status === 'VERIFIED')
      .filter((row) => {
        const expiry = expiryOf(row);
        return !expiry || expiry.at.getTime() > now.getTime();
      })
      .map((row) => row.credentialTypeId),
  );

  const today = Date.parse(lagosDate(now));
  const out: ExpiringCredential[] = [];
  for (const row of credentials) {
    if (row.status !== 'VERIFIED' && row.status !== 'EXPIRED') continue;
    const expiry = expiryOf(row);
    if (!expiry) continue;
    const expired = expiry.at.getTime() <= now.getTime();
    // A lapsed row whose type has since been replaced is history, not a to-do.
    if (expired && currentTypes.has(row.credentialTypeId)) continue;
    // Calendar days in Lagos, so "expires 30 October" is "in 12 days" on the 18th and "today" on the 30th.
    const daysLeft = Math.round((Date.parse(expiry.day) - today) / DAY_MS);
    if (!expired && daysLeft > withinDays) continue;
    out.push({
      id: row.id,
      credentialTypeId: row.credentialTypeId,
      expired,
      daysLeft,
      at: expiry.at,
    });
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** The last instant a credential is good for, and the Lagos calendar day that falls on. */
function expiryOf(row: TodayCredential): { at: Date; day: string } | null {
  // The document's own date is a Lagos date, valid through the end of that day.
  if (row.documentExpiresOn) {
    const day = row.documentExpiresOn.slice(0, 10);
    return { at: endOfLagosDay(day), day };
  }
  if (row.expiresAt) {
    const at = new Date(row.expiresAt);
    return { at, day: lagosDate(at) };
  }
  return null;
}

/** "today", "tomorrow", "in 12 days", "yesterday", "9 days ago": a sentence, not a date to subtract. */
export function daysPhrase(daysLeft: number): string {
  if (daysLeft === 0) return 'today';
  if (daysLeft === 1) return 'tomorrow';
  if (daysLeft === -1) return 'yesterday';
  return daysLeft > 0 ? `in ${daysLeft} days` : `${-daysLeft} days ago`;
}
