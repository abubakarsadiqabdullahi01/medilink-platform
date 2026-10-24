/**
 * Dispute policy: pure, no database.
 *
 * Module 14. A case is opened over a shift that has already been decided, by
 * whichever party disagrees with the outcome. What can be disputed, by whom,
 * and for how long lives here; what it does to the attendance record lives in
 * attendance, because the state machine is attendance's invariant.
 */

export type DisputePartyValue = 'PRACTITIONER' | 'FACILITY';
export type DisputeCategoryValue = 'HOURS' | 'PAY' | 'NON_ATTENDANCE' | 'CONDUCT' | 'OTHER';
export type DisputeStatusValue = 'OPEN' | 'UNDER_REVIEW' | 'RESOLVED' | 'WITHDRAWN';
export type DisputeOutcomeValue = 'UPHELD' | 'DISMISSED';

/** What a decision turned on. Which are open depends on the outcome; see `DECISION_REASONS`. */
export type DecisionReasonValue =
  | 'RECORD_WAS_WRONG'
  | 'AGREEMENT_NOT_KEPT'
  | 'COMPLAINT_NOT_MADE_OUT'
  | 'RECORD_CONFIRMED'
  | 'NOT_ENOUGH_TO_DECIDE'
  | 'NOT_FOR_MEDILINK'
  | 'OTHER';

export const DISPUTE_CATEGORIES: DisputeCategoryValue[] = [
  'HOURS',
  'PAY',
  'NON_ATTENDANCE',
  'CONDUCT',
  'OTHER',
];

export const DISPUTE_REASON_MIN_LENGTH = 20;
export const DISPUTE_REASON_MAX_LENGTH = 2000;

/**
 * How long after a shift is decided a case can still be opened.
 *
 * Fourteen days, and it is a real cut-off rather than a formality: the
 * evidence a dispute turns on is a ward's own record of who was on the floor,
 * and those get thinner every week. A window long enough to notice a wrong
 * payment and short enough that somebody can still check.
 *
 * It runs from the decision, not from the shift. A timesheet approved three
 * weeks late leaves the practitioner the same fortnight as one approved the
 * next morning.
 */
export const DISPUTE_WINDOW_DAYS = 14;

/** The only two states a shift can be disputed from. */
export const DISPUTABLE_STATES = ['APPROVED', 'REJECTED'] as const;
export type DisputableState = (typeof DISPUTABLE_STATES)[number];

export function isDisputable(status: string): status is DisputableState {
  return (DISPUTABLE_STATES as readonly string[]).includes(status);
}

export type OpenBlocker =
  | 'not_yet_decided'
  | 'already_open'
  | 'outside_window'
  | 'reason_missing'
  | 'not_a_party';

export interface OpenCheck {
  attendanceStatus: string;
  /** When the shift was approved or rejected. Null if it never was. */
  decidedAt: Date | null;
  hasOpenDispute: boolean;
  reason: string;
  /** Whether the person raising it is on one side of this shift at all. */
  isParty: boolean;
  now: Date;
}

/**
 * Every reason a case cannot be opened, returned together rather than one at
 * a time — the shape `confirmBlockers` and `closeBlockers` already use.
 */
export function openBlockers(check: OpenCheck): OpenBlocker[] {
  const blockers: OpenBlocker[] = [];

  if (!check.isParty) blockers.push('not_a_party');

  // Nothing to disagree with until somebody has decided. A shift still being
  // worked, or one waiting for approval, has ordinary routes for saying it is
  // wrong: correct it, or reject it.
  if (!isDisputable(check.attendanceStatus)) blockers.push('not_yet_decided');

  // One at a time. Two open cases over one shift is two people adjudicating
  // the same question, and a partial unique index is not expressible in
  // Prisma, so the rule lives here and is enforced in a transaction.
  if (check.hasOpenDispute) blockers.push('already_open');

  if (check.decidedAt === null) {
    if (!blockers.includes('not_yet_decided')) blockers.push('not_yet_decided');
  } else if (!withinWindow(check.decidedAt, check.now)) {
    blockers.push('outside_window');
  }

  if (check.reason.trim().length < DISPUTE_REASON_MIN_LENGTH) blockers.push('reason_missing');

  return blockers;
}

export function withinWindow(decidedAt: Date, now: Date, days = DISPUTE_WINDOW_DAYS): boolean {
  const deadline = decidedAt.getTime() + days * 24 * 60 * 60 * 1000;
  return now.getTime() <= deadline;
}

/** The last moment a case can still be opened over a shift decided then. */
export function disputeDeadline(decidedAt: Date, days = DISPUTE_WINDOW_DAYS): Date {
  return new Date(decidedAt.getTime() + days * 24 * 60 * 60 * 1000);
}

export type ResolveBlocker =
  | 'not_open'
  | 'outcome_missing'
  | 'decision_reason_missing'
  | 'decision_reason_not_for_outcome'
  | 'notes_missing';

export interface ResolveCheck {
  status: DisputeStatusValue;
  outcome: DisputeOutcomeValue | null;
  decisionReason: DecisionReasonValue | null;
  notes: string;
}

/**
 * The reasons a case can be decided on, by outcome.
 *
 * A short list on purpose: the point of a structured reason is that "why do cases get upheld" has
 * an answer that is not a read through free text, and a long list is a free-text box with extra
 * steps. `OTHER` is there under both outcomes and is not a way round the notes, which are required
 * regardless.
 *
 * None of them decides a case because somebody was silent. A missing or late reply is for the
 * officer to weigh alongside the record, and the finding is about the record or the agreement. Like
 * the deadline below this list is an engineering default, not an approved policy: it is a
 * vocabulary the owners may revise.
 */
export const DECISION_REASONS: Record<DisputeOutcomeValue, DecisionReasonValue[]> = {
  UPHELD: ['RECORD_WAS_WRONG', 'AGREEMENT_NOT_KEPT', 'OTHER'],
  DISMISSED: [
    'COMPLAINT_NOT_MADE_OUT',
    'RECORD_CONFIRMED',
    'NOT_ENOUGH_TO_DECIDE',
    'NOT_FOR_MEDILINK',
    'OTHER',
  ],
};

/** What each reason says, in words both sides read. About the record or the agreement, never the people. */
export const DECISION_REASON_WORDS: Record<DecisionReasonValue, string> = {
  RECORD_WAS_WRONG: 'The record of the hours or the pay was wrong.',
  AGREEMENT_NOT_KEPT: 'What was agreed for the shift was not done.',
  COMPLAINT_NOT_MADE_OUT: 'The evidence did not show what was complained of.',
  RECORD_CONFIRMED: 'The record of the shift was checked and is right.',
  NOT_ENOUGH_TO_DECIDE: 'There was not enough evidence from either side to decide.',
  NOT_FOR_MEDILINK: 'This is not something Medilink decides. The notes say where to take it.',
  OTHER: 'Another reason, which the notes explain.',
};

/**
 * A dispute cannot be resolved without an outcome, the reason it turned on, and notes.
 *
 * The same rule as a fault determination's, for the same reason: both parties have to be able to
 * read why they won or lost, and "resolved" on its own tells the loser nothing they can act on.
 * The reason is the short form of that, the one that can be counted; the notes are the long one.
 */
export function resolveBlockers(check: ResolveCheck): ResolveBlocker[] {
  const blockers: ResolveBlocker[] = [];

  // RESOLVED and WITHDRAWN are both finished. Re-adjudicating a closed case
  // is a new case, on new evidence, not an edit of the old one.
  if (check.status !== 'OPEN' && check.status !== 'UNDER_REVIEW') blockers.push('not_open');

  if (check.outcome === null) blockers.push('outcome_missing');

  if (check.decisionReason === null) {
    blockers.push('decision_reason_missing');
  } else if (check.outcome !== null && !DECISION_REASONS[check.outcome].includes(check.decisionReason)) {
    // Not checked while there is no outcome: one missing thing is reported once.
    blockers.push('decision_reason_not_for_outcome');
  }

  if (check.notes.trim().length < DISPUTE_REASON_MIN_LENGTH) blockers.push('notes_missing');

  return blockers;
}

/** Only the party who raised it may withdraw it, and only while it is open. */
export function withdrawBlockers(check: {
  status: DisputeStatusValue;
  raisedBy: string;
  actorId: string;
}): Array<'not_open' | 'not_the_raiser'> {
  const blockers: Array<'not_open' | 'not_the_raiser'> = [];
  if (check.status !== 'OPEN' && check.status !== 'UNDER_REVIEW') blockers.push('not_open');
  if (check.raisedBy !== check.actorId) blockers.push('not_the_raiser');
  return blockers;
}

/**
 * Which side of the shift this person is on.
 *
 * Returns null for somebody who is neither, which `openBlockers` turns into
 * `not_a_party`. An operations officer adjudicates disputes; they do not
 * raise them, because a case nobody involved wanted is not a dispute.
 */
export function partyFor(input: {
  actorId: string;
  practitionerId: string;
  facilityMember: boolean;
}): DisputePartyValue | null {
  if (input.actorId === input.practitionerId) return 'PRACTITIONER';
  if (input.facilityMember) return 'FACILITY';
  return null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long the other side has to reply once a case is opened over a shift of theirs.
 *
 * Seven days, calendar days: long enough to find the ward's record over a weekend, short enough
 * that a case does not wait on somebody who is not going to answer. An engineering default, not an
 * approved policy.
 *
 * It is a marker and not a lock. Nothing happens to a case when the time passes: a reply that comes
 * late is still read, and a reply that never comes does not decide the case against anybody. What
 * the date does is tell the other side by when to answer, and tell an officer which cases are ready
 * to be decided because the other side has had its turn.
 */
export const DISPUTE_RESPONSE_DAYS = 7;

/** The last moment the other side is asked to reply by, for a case opened then. */
export function responseDeadline(openedAt: Date, days = DISPUTE_RESPONSE_DAYS): Date {
  return new Date(openedAt.getTime() + days * DAY_MS);
}

export type RespondBlocker =
  | 'not_open'
  | 'not_the_other_side'
  | 'already_responded'
  | 'response_missing';

export interface RespondCheck {
  status: DisputeStatusValue;
  raisedParty: DisputePartyValue;
  /** Which side the person replying is on; null for an adjudicator or anybody on neither. */
  responderParty: DisputePartyValue | null;
  alreadyResponded: boolean;
  text: string;
}

/**
 * A reply is the other side's, written once, while the case is live.
 *
 * Once, as evidence is append-only: a reply that could be reworded after the officer has read it
 * is not a record of what was said. The side that raised the case has already said its piece, and
 * an adjudicator weighs a case without arguing it.
 */
export function respondBlockers(check: RespondCheck): RespondBlocker[] {
  const blockers: RespondBlocker[] = [];
  if (check.status !== 'OPEN' && check.status !== 'UNDER_REVIEW') blockers.push('not_open');
  if (check.responderParty === null || check.responderParty === check.raisedParty) {
    blockers.push('not_the_other_side');
  }
  if (check.alreadyResponded) blockers.push('already_responded');
  if (check.text.trim().length < DISPUTE_REASON_MIN_LENGTH) blockers.push('response_missing');
  return blockers;
}

/**
 * Where a case stands for whoever is deciding it.
 *
 *   waiting_for_response  the other side has not replied and still has time
 *   ready_to_decide       they have replied, or their time is up: it can be decided fairly now
 *   under_review          an officer has picked it up
 *   closed                resolved or withdrawn
 */
export type DisputeStage = 'waiting_for_response' | 'ready_to_decide' | 'under_review' | 'closed';

export interface StageCheck {
  status: DisputeStatusValue;
  respondBy: Date;
  respondedAt: Date | null;
  now: Date;
}

export function stageOf(check: StageCheck): DisputeStage {
  if (check.status === 'RESOLVED' || check.status === 'WITHDRAWN') return 'closed';
  if (check.status === 'UNDER_REVIEW') return 'under_review';
  // At the very moment the time is up it is still theirs: the same edge `withinWindow` has.
  if (check.respondedAt !== null || check.now.getTime() > check.respondBy.getTime()) return 'ready_to_decide';
  return 'waiting_for_response';
}

/** A live case whose other side has not replied and has run out of time. */
export function responseOverdue(check: StageCheck): boolean {
  const live = check.status === 'OPEN' || check.status === 'UNDER_REVIEW';
  return live && check.respondedAt === null && check.now.getTime() > check.respondBy.getTime();
}

const STAGE_RANK: Record<DisputeStage, number> = {
  ready_to_decide: 0,
  under_review: 1,
  waiting_for_response: 2,
  closed: 3,
};

/**
 * The officers' queue order: what can be decided now first, then what is being worked, then what is
 * waiting on the other side, then what is finished; oldest first within each, and by id so two
 * cases opened in the same instant never swap places between refreshes.
 */
export function compareForQueue(
  a: { stage: DisputeStage; createdAt: Date; id: string },
  b: { stage: DisputeStage; createdAt: Date; id: string },
): number {
  return (
    STAGE_RANK[a.stage] - STAGE_RANK[b.stage] ||
    a.createdAt.getTime() - b.createdAt.getTime() ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/**
 * What each side of a case may see of the evidence on it.
 *
 * A party reads the other side's evidence, because a case argued from evidence one side cannot see
 * is not an argument, but only by side: not the name of whoever attached it, not the id they
 * attached it as, and not where the file is kept (it is opened through an audited link). The
 * adjudicator weighs the evidence and sees who produced it. `bySide` is the reader's own side and
 * means nothing to somebody on neither, so the adjudicator's list does not carry it.
 *
 * Held here so a test fails if a field moves from one list to the other.
 */
export const EVIDENCE_FIELDS = {
  party: ['id', 'note', 'createdAt', 'attachedBySide', 'bySide'],
  adjudicator: ['id', 'disputeId', 'objectKey', 'attachedBy', 'attachedByName', 'note', 'createdAt', 'attachedBySide'],
} as const;

/**
 * Who raised a case, replied to it or decided it, as people. A party is told which side did each
 * (the case says `raisedParty`) and is not sent the person's id; the officer who decided it is
 * not for the parties to find.
 */
export const CASE_FIELDS_HIDDEN_FROM_PARTIES = ['raisedBy', 'resolvedBy', 'respondedBy'] as const;

/** The case as a party reads it: the same, without the identity of the people who acted on it. */
export function partyCaseView<T extends object>(
  view: T,
): Omit<T, (typeof CASE_FIELDS_HIDDEN_FROM_PARTIES)[number]> {
  const copy = { ...view } as Record<string, unknown>;
  for (const field of CASE_FIELDS_HIDDEN_FROM_PARTIES) delete copy[field];
  return copy as Omit<T, (typeof CASE_FIELDS_HIDDEN_FROM_PARTIES)[number]>;
}
