/**
 * Where a practitioner's application stands: pure, no database.
 *
 * "Application" is the word for the stretch between registering and being
 * offered work. Three things are the practitioner's to do — say who they are,
 * say when they can work, supply the documents their profession requires —
 * and then a fourth thing is nobody's but an officer's: checking all of it.
 * Until the practitioner says they are done there is nothing for the officer
 * to check, so "done" is an explicit act rather than something inferred from
 * the last field being filled in.
 *
 * None of this decides who can be matched. That remains eligibility
 * (./eligibility.ts), which only an officer's verification can satisfy;
 * submitting is how somebody gets into the officer's queue, not a way past it.
 */

export type ApplicationGap = 'details' | 'availability' | 'documents';

/** Human wording for each gap, in the order a practitioner meets them. */
export const GAP_LABELS: Record<ApplicationGap, string> = {
  details: 'your details',
  availability: 'when you can work',
  documents: 'your documents',
};

export interface ApplicationFacts {
  hasProfile: boolean;
  hasAvailability: boolean;
  /** Credential types the practitioner's profession requires. */
  mandatoryCredentialTypeIds: string[];
  /**
   * Types they hold a live submission for — waiting, queried or verified. A
   * credential still waiting on review counts: submitting is about having
   * supplied the document, and deciding whether it is good is the officer's job.
   */
  suppliedCredentialTypeIds: string[];
}

/** What is still the practitioner's to do. Empty means they may submit. */
export function applicationGaps(facts: ApplicationFacts): ApplicationGap[] {
  const gaps: ApplicationGap[] = [];
  if (!facts.hasProfile) gaps.push('details');
  if (!facts.hasAvailability) gaps.push('availability');

  const supplied = new Set(facts.suppliedCredentialTypeIds);
  if (facts.mandatoryCredentialTypeIds.some((id) => !supplied.has(id))) gaps.push('documents');

  return gaps;
}

export type ApplicationState =
  /** Something of theirs is still missing. */
  | 'DRAFT'
  /** All of theirs is done and they have not yet said so. */
  | 'READY'
  /** Submitted; an officer has it. */
  | 'WAITING'
  /** An officer has verified everything and they can be matched. */
  | 'APPROVED';

export function applicationState(input: {
  gaps: ApplicationGap[];
  submittedForReviewAt: Date | null;
  eligible: boolean;
}): ApplicationState {
  // Somebody who can already be matched is approved, whether or not they ever
  // pressed the button — accounts that predate it must not be asked to.
  if (input.eligible) return 'APPROVED';
  if (input.submittedForReviewAt) return 'WAITING';
  return input.gaps.length === 0 ? 'READY' : 'DRAFT';
}

/** "your details and your documents" — for the message that refuses an early submission. */
export function describeGaps(gaps: ApplicationGap[]): string {
  const labels = gaps.map((gap) => GAP_LABELS[gap]);
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}
