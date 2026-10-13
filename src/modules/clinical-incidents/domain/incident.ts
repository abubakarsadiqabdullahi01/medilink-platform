/**
 * Clinical incident policy: pure, no database.
 *
 * Module 15. The governing principle, and it shapes every rule below: **a
 * report is not an accusation.** A reporting system that punishes reporters
 * stops receiving reports, and a platform that hears nothing about near
 * misses is worth less than one that never asked. So reporting is easy and
 * cannot be undone, and every consequence is a separate, recorded decision.
 */

export type IncidentSeverityValue = 'NEAR_MISS' | 'MINOR' | 'MODERATE' | 'SEVERE' | 'DEATH';
export type IncidentCategoryValue =
  | 'MEDICATION'
  | 'CLINICAL_PROCEDURE'
  | 'DOCUMENTATION'
  | 'INFECTION_CONTROL'
  | 'EQUIPMENT'
  | 'STAFFING'
  | 'CONDUCT'
  | 'OTHER';

export const INCIDENT_CATEGORIES: IncidentCategoryValue[] = [
  'MEDICATION',
  'CLINICAL_PROCEDURE',
  'DOCUMENTATION',
  'INFECTION_CONTROL',
  'EQUIPMENT',
  'STAFFING',
  'CONDUCT',
  'OTHER',
];

export type IncidentStatusValue = 'REPORTED' | 'UNDER_REVIEW' | 'CLOSED';
export type IncidentOutcomeValue =
  | 'SYSTEM_ISSUE'
  | 'NO_ACTION'
  | 'ADVICE_GIVEN'
  | 'TRAINING_REQUIRED'
  | 'PRACTITIONER_SUSPENDED'
  | 'REFERRED_TO_REGULATOR';

export const INCIDENT_SEVERITIES: IncidentSeverityValue[] = [
  'NEAR_MISS',
  'MINOR',
  'MODERATE',
  'SEVERE',
  'DEATH',
];

export const INCIDENT_SUMMARY_MIN_LENGTH = 20;
export const INCIDENT_SUMMARY_MAX_LENGTH = 4000;
export const SUSPENSION_REASON_MIN_LENGTH = 20;

/**
 * Severities that require somebody to look, rather than merely be able to.
 *
 * Everything is reviewable; these are the ones a closure cannot skip past
 * with `NO_ACTION` and nothing else. A death closed as "no action" with a
 * one-line note is the failure mode this exists to make awkward.
 */
export const REVIEW_REQUIRED_SEVERITIES: IncidentSeverityValue[] = ['SEVERE', 'DEATH'];

export function requiresReview(severity: IncidentSeverityValue): boolean {
  return REVIEW_REQUIRED_SEVERITIES.includes(severity);
}

/** Ordering, for triage. Not a score — nothing arithmetic is done with it. */
export function severityRank(severity: IncidentSeverityValue): number {
  return INCIDENT_SEVERITIES.indexOf(severity);
}

export function isAtLeast(
  severity: IncidentSeverityValue,
  floor: IncidentSeverityValue,
): boolean {
  return severityRank(severity) >= severityRank(floor);
}

export type ReportBlocker =
  | 'summary_missing'
  | 'occurred_in_the_future'
  | 'contains_patient_identifier';

/**
 * What in a free-text summary can be recognised as identifying a patient.
 *
 * The specification says a report must not record patient identifiers, and the
 * form is a text box, so something that looks like one will be typed into it.
 * Only what is recognisable *with confidence* is refused — a phone number, an
 * email address, a run of nine or more digits (a NIN, a phone with its spaces
 * stripped), a labelled hospital, folder or record number. Names are not
 * screened: there is no way to tell a patient's from a nurse's, and a screen
 * that guessed would refuse honest reports. Doses, times, dates, bed and ward
 * numbers are left alone, because a report refused for a false alarm is a report
 * lost, and the report is the point.
 */
const IDENTIFIER_PATTERNS: RegExp[] = [
  // An email address.
  /[^\s@]+@[^\s@]+\.[^\s@]{2,}/,
  // A Nigerian mobile or an international number, with the spaces and dashes people type.
  /(?:\+?234|\b0)[\s-]?[789][01]\d[\s-]?\d{3}[\s-]?\d{4}\b/,
  // Nine or more digits in a row, allowing the spaces and dashes inside a long number.
  /\b\d(?:[\s-]?\d){8,}\b/,
  // A labelled record: "hospital number HN/…", "folder no: 99812", "MRN 778…", "patient ID".
  /\b(?:mrn|nin|hospital\s*(?:no|number|id)|folder\s*(?:no|number)|file\s*(?:no|number)|patient\s*(?:no|number|id))\b[\s:#.\-]*[A-Za-z0-9/]{3,}/i,
];

export function containsPatientIdentifier(text: string): boolean {
  return IDENTIFIER_PATTERNS.some((pattern) => pattern.test(text));
}

export function reportBlockers(input: {
  summary: string;
  occurredAt: Date;
  now: Date;
}): ReportBlocker[] {
  const blockers: ReportBlocker[] = [];

  // A minimum length, a time that has happened, and no patient identifiers.
  // Deliberately the only bars: every extra mandatory field is a reason
  // somebody closes the form instead.
  if (input.summary.trim().length < INCIDENT_SUMMARY_MIN_LENGTH) blockers.push('summary_missing');

  if (input.occurredAt.getTime() > input.now.getTime()) blockers.push('occurred_in_the_future');

  if (containsPatientIdentifier(input.summary)) blockers.push('contains_patient_identifier');

  return blockers;
}

export type CloseBlocker =
  | 'already_closed'
  | 'outcome_missing'
  | 'notes_missing'
  | 'not_reviewed';

export interface CloseCheck {
  status: IncidentStatusValue;
  severity: IncidentSeverityValue;
  outcome: IncidentOutcomeValue | null;
  notes: string;
}

export function closeBlockers(check: CloseCheck): CloseBlocker[] {
  const blockers: CloseBlocker[] = [];

  if (check.status === 'CLOSED') blockers.push('already_closed');
  if (check.outcome === null) blockers.push('outcome_missing');
  if (check.notes.trim().length < INCIDENT_SUMMARY_MIN_LENGTH) blockers.push('notes_missing');

  // A severe incident or a death has to have been picked up and looked at
  // before it can be closed. Closing straight from REPORTED means nobody
  // opened it, and the status is the only evidence either way.
  if (requiresReview(check.severity) && check.status === 'REPORTED') {
    blockers.push('not_reviewed');
  }

  return blockers;
}

/**
 * Whether this outcome is one that suspends the practitioner.
 *
 * The outcome and the suspension are recorded separately and must agree: a
 * closure saying `PRACTITIONER_SUSPENDED` with nobody suspended, or a
 * suspension recorded under `NO_ACTION`, are both records that lie.
 */
export function outcomeSuspends(outcome: IncidentOutcomeValue): boolean {
  return outcome === 'PRACTITIONER_SUSPENDED';
}
