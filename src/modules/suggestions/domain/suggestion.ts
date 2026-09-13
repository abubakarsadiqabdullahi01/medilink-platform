/**
 * Suggestion log policy: pure, no database.
 *
 * Module 18, step 9.5. The pilot exists to find out what the specification
 * got wrong, and that only works if there is somewhere for the finding to go
 * that is not a WhatsApp message to the founder.
 */

export type SuggestionSourceValue = 'USER' | 'DECLINE_REASON';
export type SuggestionStatusValue = 'NEW' | 'TRIAGED' | 'PLANNED' | 'DONE' | 'DECLINED';
export type SuggestionAreaValue =
  | 'ONBOARDING'
  | 'CREDENTIALS'
  | 'MATCHING'
  | 'SCHEDULING'
  | 'ATTENDANCE'
  | 'TIMESHEETS'
  | 'PAYMENTS'
  | 'SUPPORT'
  | 'OTHER';

export const SUGGESTION_AREAS: SuggestionAreaValue[] = [
  'ONBOARDING',
  'CREDENTIALS',
  'MATCHING',
  'SCHEDULING',
  'ATTENDANCE',
  'TIMESHEETS',
  'PAYMENTS',
  'SUPPORT',
  'OTHER',
];

export const SUGGESTION_BODY_MIN_LENGTH = 10;
export const SUGGESTION_BODY_MAX_LENGTH = 2000;
export const SUGGESTION_RESPONSE_MIN_LENGTH = 10;

/** Statuses that mean somebody has finished with it. */
export const CLOSED_STATUSES: SuggestionStatusValue[] = ['DONE', 'DECLINED'];

export function isClosed(status: SuggestionStatusValue): boolean {
  return CLOSED_STATUSES.includes(status);
}

export type TriageBlocker = 'already_closed' | 'response_required' | 'same_status';

export interface TriageCheck {
  status: SuggestionStatusValue;
  next: SuggestionStatusValue;
  response: string;
}

/**
 * `DECLINED` and `DONE` both need a written response; `TRIAGED` and `PLANNED`
 * do not.
 *
 * The asymmetry is the point. Moving something along the queue is
 * housekeeping. Telling somebody their suggestion is finished with — either
 * because it was built or because it will not be — is an answer, and a
 * declined suggestion with no reason is how a pilot teaches people to stop
 * bothering.
 */
export function triageBlockers(check: TriageCheck): TriageBlocker[] {
  const blockers: TriageBlocker[] = [];

  if (isClosed(check.status)) blockers.push('already_closed');
  if (check.status === check.next) blockers.push('same_status');

  if (isClosed(check.next) && check.response.trim().length < SUGGESTION_RESPONSE_MIN_LENGTH) {
    blockers.push('response_required');
  }

  return blockers;
}

export function submitBlockers(input: { body: string }): Array<'body_missing'> {
  // A low bar on purpose. The cost of a thin suggestion is one row; the cost
  // of a form that argues with people is every suggestion they do not file.
  return input.body.trim().length < SUGGESTION_BODY_MIN_LENGTH ? ['body_missing'] : [];
}

/**
 * Where a decline reason lands when it becomes a suggestion.
 *
 * Always `MATCHING`: a practitioner declining an invitation is, by
 * construction, telling you something about what you offered them and how.
 * Guessing at a finer area from free text would be inventing data.
 */
export const DECLINE_REASON_AREA: SuggestionAreaValue = 'MATCHING';
