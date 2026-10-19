import type { TimelineStep } from '@/components/app/timeline';
import { formatWhen } from '@/components/app/format';

/**
 * A timesheet's life as the practitioner reads it: worked, sent, decided, paid.
 *
 * The badge on a card says where a sheet is; this says how it got there and what is left. Pure,
 * so the story is written once and tested, not rebuilt inside a card.
 *
 * "Paid" is always a step still to come from here: whether it has been paid is the Earnings
 * page's to say, and a sheet that has been approved is not yet money — it becomes money when the
 * shift is invoiced.
 */
export interface SheetFacts {
  status: string;
  checkedOutAt?: string | null;
  submittedAt?: string | null;
  reviewedAt?: string | null;
  rejectionReason?: string | null;
}

const NOT_SENT = new Set(['CHECKED_OUT', 'MANUALLY_CORRECTED']);

export function timesheetSteps(facts: SheetFacts): TimelineStep[] {
  const { status } = facts;
  const notSent = NOT_SENT.has(status);

  const worked: TimelineStep = {
    id: 'worked',
    title: 'Shift worked and checked out',
    state: 'done',
    when: facts.checkedOutAt ? formatWhen(facts.checkedOutAt) : undefined,
  };

  const sent: TimelineStep = notSent
    ? {
        id: 'sent',
        title: 'Send your hours to the facility',
        state: 'current',
        detail: 'Nothing is paid until you do.',
      }
    : {
        id: 'sent',
        title: 'Hours sent to the facility',
        state: 'done',
        when: facts.submittedAt ? formatWhen(facts.submittedAt) : undefined,
      };

  let decision: TimelineStep;
  switch (status) {
    case 'SUBMITTED':
      decision = {
        id: 'decision',
        title: 'The facility decides',
        state: 'current',
        detail: 'They approve the hours or send them back with a reason.',
      };
      break;
    case 'APPROVED':
      decision = {
        id: 'decision',
        title: 'Approved by the facility',
        state: 'done',
        when: facts.reviewedAt ? formatWhen(facts.reviewedAt) : undefined,
      };
      break;
    case 'REJECTED':
      decision = {
        id: 'decision',
        title: 'Sent back by the facility',
        state: 'problem',
        when: facts.reviewedAt ? formatWhen(facts.reviewedAt) : undefined,
        detail: facts.rejectionReason
          ? `They said: ${facts.rejectionReason}`
          : 'They did not say why. Check the hours and send them again.',
      };
      break;
    case 'DISPUTED':
      decision = {
        id: 'decision',
        title: 'Decision disputed',
        state: 'problem',
        detail: 'An officer is deciding. The shift is on hold until they do.',
      };
      break;
    default:
      decision = { id: 'decision', title: 'The facility decides', state: 'upcoming' };
  }

  const paid: TimelineStep = {
    id: 'paid',
    title: 'Paid',
    state: 'upcoming',
    detail: 'Credited when the shift is invoiced. Earnings shows where it has got to.',
  };

  return [worked, sent, decision, paid];
}
