import { lagosDate } from '@/lib/lagos-date';
import { formatDate, formatWhen } from '@/components/app/format';
import type { TimelineStep } from '@/components/app/timeline';
import { daysPhrase } from '@/lib/ui/practitioner-today';

const DAY_MS = 24 * 60 * 60 * 1000;

interface Dated {
  expiresAt?: string | null;
  documentExpiresOn?: string | null;
}

/**
 * Whole Lagos calendar days until a credential lapses; negative once it has.
 *
 * The date printed on the document is a Lagos date and is good through the end of it, so
 * "expires 30 October" is "in 12 days" on the 18th and "today" on the 30th. The platform's own
 * estimate is used only when no date was read from the document. `null` when there is neither.
 */
export function daysUntilExpiry(row: Dated, now: Date = new Date()): number | null {
  const day = row.documentExpiresOn
    ? row.documentExpiresOn.slice(0, 10)
    : row.expiresAt
      ? lagosDate(new Date(row.expiresAt))
      : null;
  if (!day) return null;
  return Math.round((Date.parse(day) - Date.parse(lagosDate(now))) / DAY_MS);
}

/** "expires in 12 days", "expires tomorrow", "expired 9 days ago" — a sentence, not a date to subtract. */
export function expiryPhrase(daysLeft: number): string {
  return daysLeft < 0 ? `expired ${daysPhrase(daysLeft)}` : `expires ${daysPhrase(daysLeft)}`;
}

/** Warning inside a month, danger once lapsed; otherwise nothing worth colouring. */
export function expiryTone(daysLeft: number): 'danger' | 'warning' | undefined {
  if (daysLeft < 0) return 'danger';
  if (daysLeft <= 30) return 'warning';
  return undefined;
}

/**
 * What a credential's status means for the person who submitted it: whether the next move is
 * theirs, and what it is. Said in plain words next to the badge, because a badge alone
 * ("Pending") does not say whether to wait or to act. `says` does not repeat the badge: the card
 * reads "Nothing for you to do. It counts until it expires." or "Your move. This one is closed.…".
 */
export function credentialNextStep(status: string): { says: string; theirMove: boolean } {
  switch (status) {
    case 'PENDING':
      return {
        says: 'A reviewer checks it by hand.',
        theirMove: false,
      };
    case 'MORE_INFO_REQUESTED':
      return { says: 'The reviewer needs more. Send it below.', theirMove: true };
    case 'VERIFIED':
      return { says: 'It counts until it expires.', theirMove: false };
    case 'REJECTED':
      return {
        says: 'This one is closed. Submit a corrected one to be reviewed again.',
        theirMove: true,
      };
    case 'EXPIRED':
      return {
        says: 'It no longer counts. Submit the current one.',
        theirMove: true,
      };
    default:
      return { says: '', theirMove: false };
  }
}

interface History extends Dated {
  status: string;
  createdAt: string;
  reviewedAt?: string | null;
  reviewNotes?: string | null;
}

/**
 * What has happened to a submission, in order, from what the record holds: when it was sent,
 * when a reviewer last answered and what they said. Nothing is invented between — the record
 * keeps the latest review, not every one, so this does not claim a history it does not have.
 */
export function credentialTimeline(
  row: History,
  now: Date = new Date(),
  options: { notes?: boolean } = {},
): TimelineStep[] {
  // A card that already shows the reviewer's note prominently asks for the timeline without it,
  // rather than saying the same words twice a click apart.
  const notes = options.notes ?? true;
  const reviewed = row.reviewedAt ? formatWhen(row.reviewedAt) : undefined;
  const steps: TimelineStep[] = [
    { id: 'submitted', title: 'Submitted', state: 'done', when: formatWhen(row.createdAt) },
  ];

  switch (row.status) {
    case 'PENDING':
      steps.push({
        id: 'review',
        title: 'Waiting for a reviewer',
        state: 'current',
        detail: 'A person checks it by hand. You will see the answer here.',
      });
      break;
    case 'MORE_INFO_REQUESTED':
      steps.push(
        {
          id: 'asked',
          title: 'The reviewer asked for more',
          state: 'done',
          when: reviewed,
          detail: notes ? (row.reviewNotes ?? undefined) : undefined,
        },
        {
          id: 'answer',
          title: 'Your answer',
          state: 'current',
          detail: 'Send what was asked for, using the form on this card.',
        },
      );
      break;
    case 'VERIFIED': {
      steps.push({ id: 'verified', title: 'Verified', state: 'done', when: reviewed });
      const days = daysUntilExpiry(row, now);
      if (days !== null) {
        const day = row.documentExpiresOn ? row.documentExpiresOn : (row.expiresAt ?? '');
        steps.push({
          id: 'expiry',
          title: expiryPhrase(days).replace(/^./, (first) => first.toUpperCase()),
          state: days < 0 ? 'problem' : days <= 30 ? 'current' : 'upcoming',
          when: formatDate(day),
        });
      }
      break;
    }
    case 'REJECTED':
      steps.push(
        {
          id: 'refused',
          title: 'Refused',
          state: 'problem',
          when: reviewed,
          detail: notes ? (row.reviewNotes ?? 'The reviewer gave no note.') : undefined,
        },
        {
          id: 'again',
          title: 'Submit a corrected one',
          state: 'upcoming',
          detail: 'A refused credential is closed; a new submission is reviewed from the start.',
        },
      );
      break;
    case 'EXPIRED':
      steps.push(
        { id: 'verified', title: 'Verified', state: 'done', when: reviewed },
        { id: 'expired', title: 'Expired', state: 'problem' },
        { id: 'again', title: 'Submit the current one', state: 'upcoming' },
      );
      break;
  }

  return steps;
}
