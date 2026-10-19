import type { TimelineStep } from '@/components/app/timeline';
import { formatWhen } from '@/components/app/format';

/**
 * Where one shift stands, and what the scheduler does next.
 *
 * The shift's page used to be a stack of cards — confirmed, offered, candidates, ready to
 * confirm — each correct and none of them saying which one to look at. The scheduler's question
 * is always "what do I do about this shift now?", and the answer is one of five sentences. This
 * works it out from what the page already has (the shift, its offers, who is confirmed) and asks
 * nothing new of the server. Pure, so each sentence is a test.
 */

export interface ShiftFacts {
  status: string;
  headcount: number;
  startsAt: string;
}

export interface OfferFacts {
  userId: string;
  status: string;
  expiresAt: string;
}

export type NextStepKind = 'find' | 'wait' | 'confirm' | 'done' | 'closed' | 'started';

export interface NextStep {
  kind: NextStepKind;
  text: string;
}

const plural = (n: number, one: string, many: string = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Practitioners who said yes and are not yet booked. An accepted offer stays "accepted" after the
 * booking is made, so somebody already confirmed must not be offered a Confirm button again.
 */
export function readyToConfirm(offers: OfferFacts[], confirmedUserIds: Set<string>): OfferFacts[] {
  return offers.filter(
    (offer) => offer.status === 'ACCEPTED' && !confirmedUserIds.has(offer.userId),
  );
}

/** Offers still open at `now`: sent, unanswered, and not yet past their time. */
export function waitingOffers(offers: OfferFacts[], now: Date): OfferFacts[] {
  return offers.filter(
    (offer) => offer.status === 'INVITED' && new Date(offer.expiresAt).getTime() > now.getTime(),
  );
}

export function shiftNextStep({
  shift,
  confirmed,
  offers,
  confirmedUserIds,
  now,
}: {
  shift: ShiftFacts;
  confirmed: number;
  offers: OfferFacts[];
  confirmedUserIds: Set<string>;
  now: Date;
}): NextStep {
  switch (shift.status) {
    case 'CANCELLED':
      return { kind: 'closed', text: 'This shift was cancelled. Nothing more can be done on it.' };
    case 'EXPIRED':
      return {
        kind: 'closed',
        text: 'This shift expired before every place was filled. Publish another if you still need cover.',
      };
    case 'DRAFT':
      return {
        kind: 'closed',
        text: 'This shift is a draft and has not been published. Publish it from the Shifts list before it can be offered to anybody.',
      };
    case 'FILLED':
      return {
        kind: 'done',
        text: `Every place is filled: ${confirmed} of ${shift.headcount} confirmed.`,
      };
    default:
      break;
  }

  if (new Date(shift.startsAt).getTime() <= now.getTime()) {
    return {
      kind: 'started',
      text: 'This shift has already started, so it can no longer be offered. Anybody already confirmed stays booked.',
    };
  }

  const ready = readyToConfirm(offers, confirmedUserIds);
  if (ready.length > 0) {
    return {
      kind: 'confirm',
      text: `${plural(ready.length, 'practitioner has', 'practitioners have')} accepted. Confirm ${
        ready.length === 1 ? 'them' : 'who you want'
      } to book the shift: an acceptance alone does not.`,
    };
  }

  const waiting = waitingOffers(offers, now);
  if (waiting.length > 0) {
    const earliest = waiting
      .map((offer) => new Date(offer.expiresAt).getTime())
      .reduce((a, b) => Math.min(a, b));
    return {
      kind: 'wait',
      text: `Waiting for ${plural(waiting.length, 'answer')}. ${
        waiting.length === 1 ? 'The offer lapses' : 'The first offer lapses'
      } ${formatWhen(new Date(earliest))}, Lagos time.`,
    };
  }

  if (offers.length > 0) {
    return {
      kind: 'find',
      text: 'Nobody has an offer open and nobody is waiting to be confirmed. Find more candidates to offer it to.',
    };
  }

  return {
    kind: 'find',
    text: 'Nobody has been offered this shift yet. Find candidates to see who is eligible.',
  };
}

/**
 * The shift's journey: published, offered, accepted, confirmed, filled. The first step that has
 * not happened is the current one, so the list always says where the scheduler is.
 */
export function shiftProgress({
  shift,
  confirmed,
  offers,
  confirmedUserIds,
}: {
  shift: ShiftFacts;
  confirmed: number;
  offers: OfferFacts[];
  confirmedUserIds: Set<string>;
}): TimelineStep[] {
  if (shift.status !== 'PUBLISHED' && shift.status !== 'FILLED') return [];

  const accepted = offers.filter((offer) => offer.status === 'ACCEPTED').length;
  const filled = shift.status === 'FILLED' || confirmed >= shift.headcount;
  const waiting = readyToConfirm(offers, confirmedUserIds).length;

  const steps: { id: string; title: string; done: boolean; detail?: string }[] = [
    { id: 'published', title: 'Published', done: true },
    {
      id: 'offered',
      title: 'Offered to practitioners',
      done: offers.length > 0,
      detail: offers.length > 0 ? `${plural(offers.length, 'offer')} sent` : undefined,
    },
    {
      id: 'accepted',
      title: 'Accepted by somebody',
      done: accepted > 0 || confirmed > 0,
      detail: accepted > 0 ? `${accepted} accepted` : undefined,
    },
    {
      id: 'confirmed',
      title: `Confirmed: ${confirmed} of ${shift.headcount}`,
      done: filled,
      detail: waiting > 0 ? `${plural(waiting, 'acceptance')} waiting for you` : undefined,
    },
    { id: 'filled', title: 'Every place filled', done: filled },
  ];

  const firstOpen = steps.findIndex((step) => !step.done);
  return steps.map((step, index) => ({
    id: step.id,
    title: step.title,
    detail: step.detail,
    state: step.done ? 'done' : index === firstOpen ? 'current' : 'upcoming',
  }));
}
