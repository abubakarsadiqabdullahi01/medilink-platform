import type { AttentionItem } from '@/components/app/dashboard';
import type { FacilitySummary } from '@/modules/audit-compliance/application/facility-summary';
import { lagosDate } from '@/lib/lagos-date';
import { waitingFor } from '@/components/app/queue-age';
import { formatClock, formatDate, formatNairaTight } from '@/components/app/format';
import { daysPhrase } from '@/lib/ui/practitioner-today';
import type { Json } from '@/lib/ui/json';

/**
 * What a ward manager has to deal with, in the order it will hurt if it is not dealt with.
 *
 * The summary says how many; this says which are urgent and what to do. Pure, so each rule is a
 * sentence in a test. A section absent from the summary means the person may not see it, and
 * produces nothing here — never a zero, which would read as "all clear".
 */

export type FacilitySummaryJson = Json<FacilitySummary>;

export interface FacilityStatusView {
  status: string;
  reviewNotes?: string | null;
  licenceExpiresAt?: string | null;
  canPublish?: boolean;
  publishBlockers?: string[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

const plural = (n: number, one: string, many: string = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function facilityAttention({
  summary,
  facility,
  now,
}: {
  summary: FacilitySummaryJson | undefined;
  facility: FacilityStatusView | undefined;
  now: Date;
}): AttentionItem[] {
  const items: AttentionItem[] = [];

  // Whether the facility may publish at all comes before anything it might publish.
  if (facility) {
    if (facility.status === 'PENDING') {
      items.push({
        id: 'verification',
        tone: 'warning',
        title: 'Waiting for verification',
        detail:
          'Medilink checks the registration and licence before this facility can publish shifts. If you have not uploaded the licence, do it on the facility profile.',
        href: '/facility/profile',
        action: 'Open the profile',
      });
    } else if (facility.status === 'REJECTED') {
      items.push({
        id: 'verification',
        tone: 'danger',
        title: 'Medilink could not verify this facility',
        detail: facility.reviewNotes
          ? `What compliance said: ${facility.reviewNotes}`
          : 'The facility profile says what to correct before it is sent back for review.',
        href: '/facility/profile',
        action: 'Correct it',
      });
    } else if (facility.status === 'SUSPENDED') {
      items.push({
        id: 'verification',
        tone: 'danger',
        title: 'This facility is suspended',
        detail: 'It cannot publish shifts. Contact Medilink to find out what is needed to lift it.',
        href: '/contact',
        action: 'Contact Medilink',
      });
    } else if (facility.publishBlockers?.includes('licence_expired')) {
      items.push({
        id: 'licence',
        tone: 'danger',
        title: 'The facility licence has expired, so no shift can be published',
        detail:
          'Record the renewed licence on the facility profile. It goes back to Medilink to be checked.',
        href: '/facility/profile',
        action: 'Update licence',
      });
    } else if (facility.licenceExpiresAt) {
      const days = Math.round(
        (Date.parse(lagosDate(new Date(facility.licenceExpiresAt))) - Date.parse(lagosDate(now))) /
          DAY_MS,
      );
      if (days <= 30) {
        items.push({
          id: 'licence',
          tone: 'warning',
          title: `The facility licence expires ${daysPhrase(days)}`,
          detail: `Valid until ${formatDate(facility.licenceExpiresAt)}. Once it lapses no shift can be published. Record the renewal before then.`,
          href: '/facility/profile',
          action: 'Update licence',
        });
      }
    }
  }

  const attendance = summary?.attendance;
  if (attendance && attendance.notArrived > 0) {
    items.push({
      id: 'not-arrived',
      tone: 'danger',
      title: `${plural(attendance.notArrived, 'practitioner has', 'practitioners have')} not arrived`,
      detail: attendance.notArrivedEarliestStart
        ? `The earliest was due at ${formatClock(attendance.notArrivedEarliestStart)}. Open the roster to reach them or record what happened.`
        : 'Open the roster to reach them or record what happened.',
      href: '/facility/roster',
      action: 'Open the roster',
    });
  }

  const coverage = summary?.coverage;
  if (coverage && coverage.todayUnfilledShifts > 0) {
    const short = coverage.todayNeeded - coverage.todayFilled;
    items.push({
      id: 'today-short',
      tone: 'warning',
      title: `${plural(coverage.todayUnfilledShifts, 'shift')} today ${coverage.todayUnfilledShifts === 1 ? 'is' : 'are'} short of people`,
      detail: `${coverage.todayFilled} of ${coverage.todayNeeded} places filled; ${short} still open.`,
      href: '/facility/shifts',
      action: 'Find staff',
    });
  }
  if (coverage && coverage.openNext24h > 0) {
    items.push({
      id: 'soon-short',
      tone: 'warning',
      title: `${plural(coverage.openNext24h, 'shift')} in the next 24 hours ${coverage.openNext24h === 1 ? 'has' : 'have'} places open`,
      detail: coverage.nextOpenStartsAt
        ? `The first starts ${formatClock(coverage.nextOpenStartsAt)}.`
        : undefined,
      href: '/facility/shifts',
      action: 'Find staff',
    });
  }

  const offers = summary?.offers;
  if (offers && offers.awaitingConfirmation > 0) {
    items.push({
      id: 'confirm',
      tone: 'warning',
      title: `${plural(offers.awaitingConfirmation, 'practitioner has', 'practitioners have')} accepted and ${offers.awaitingConfirmation === 1 ? 'is' : 'are'} waiting for you to confirm`,
      detail: offers.oldestAwaitingConfirmation
        ? `The first answered ${waitingFor(offers.oldestAwaitingConfirmation, now)} ago. Until you confirm, it is not a shift.`
        : 'Until you confirm, it is not a shift.',
      href: '/facility/shifts',
      action: 'Confirm',
    });
  }

  if (summary?.awaitingApproval && summary.awaitingApproval > 0) {
    items.push({
      id: 'timesheets',
      tone: 'warning',
      title: `${plural(summary.awaitingApproval, 'timesheet')} to approve`,
      detail: summary.awaitingOldest
        ? `The oldest was sent in ${waitingFor(summary.awaitingOldest, now)} ago. Nothing is settled until it is decided.`
        : 'Nothing is settled until they are decided.',
      href: '/facility/timesheets',
      action: 'Review',
    });
  }

  if (attendance && attendance.endedUnattended > 0) {
    items.push({
      id: 'unattended',
      tone: 'warning',
      title: `${plural(attendance.endedUnattended, 'shift')} ended with nobody checked in`,
      detail:
        'If they did work, record their attendance by hand; if not, Medilink’s overnight check will flag it.',
      href: '/facility/roster',
      action: 'Open the roster',
    });
  }

  const staff = summary?.staff;
  if (staff && staff.lapsedInvitations > 0) {
    items.push({
      id: 'lapsed-invitations',
      tone: 'warning',
      title: `${plural(staff.lapsedInvitations, 'staff invitation')} ran out unanswered`,
      detail: 'The person has no access. Invite them again if they still need it.',
      href: '/facility/staff',
      action: 'Open staff',
    });
  }

  const invoices = summary?.invoices;
  if (invoices && invoices.outstandingCount > 0) {
    const old = invoices.oldestIssuedAt
      ? now.getTime() - Date.parse(invoices.oldestIssuedAt) > 30 * DAY_MS
      : false;
    items.push({
      id: 'invoices',
      tone: old ? 'warning' : 'info',
      title: `${formatNairaTight(invoices.outstandingKobo)} outstanding on ${plural(invoices.outstandingCount, 'invoice')}`,
      detail: invoices.oldestIssuedAt
        ? `The oldest was issued ${waitingFor(invoices.oldestIssuedAt, now)} ago.`
        : undefined,
      href: '/facility/invoices',
      action: 'View invoices',
    });
  }

  if (offers && offers.awaitingResponse > 0) {
    items.push({
      id: 'offers-out',
      tone: 'info',
      title: `${plural(offers.awaitingResponse, 'offer')} out, waiting for an answer`,
      detail: 'Nothing for you to do until the practitioner answers.',
      href: '/facility/shifts',
      action: 'View shifts',
    });
  }

  if (attendance && attendance.noShows7d > 0) {
    items.push({
      id: 'no-shows',
      tone: 'info',
      title: `${plural(attendance.noShows7d, 'no-show')} in the last 7 days`,
      href: '/facility/roster',
      action: 'View',
    });
  }

  if (staff && staff.owners === 1) {
    items.push({
      id: 'sole-owner',
      tone: 'info',
      title: 'Only one owner can act for this facility',
      detail:
        'If that person is away or loses their phone, nobody else can add or remove staff. Consider a second owner.',
      href: '/facility/staff',
      action: 'Open staff',
    });
  }

  return items;
}
