/**
 * Consent and data-subject rights. Pure, no database.
 *
 * Module 17's other two thirds. The audit trail says what the platform did;
 * this says what it was permitted to do, and what it owes the person whose
 * data it holds.
 *
 * Written against the Nigeria Data Protection Act 2023. Where the Act leaves
 * a choice, the choice is stated here rather than left implicit in whichever
 * function happens to make it.
 */

export type ConsentPurposeValue =
  | 'IDENTITY_VERIFICATION'
  | 'CREDENTIAL_SHARING'
  | 'PROFILE_VISIBILITY'
  | 'MARKETING';

export type LawfulBasisValue =
  | 'CONSENT'
  | 'CONTRACT'
  | 'LEGAL_OBLIGATION'
  | 'VITAL_INTERESTS';

export type RequestKind =
  | 'ACCESS'
  | 'RECTIFICATION'
  | 'ERASURE'
  | 'PORTABILITY'
  | 'RESTRICTION';

export type RequestStatusValue = 'RECEIVED' | 'IN_PROGRESS' | 'COMPLETED' | 'REFUSED';

/**
 * The lawful basis each purpose actually rests on.
 *
 * This is the table that makes withdrawal answerable. Asking somebody to
 * "consent" to something the platform will do anyway — checking a practising
 * licence, because a regulator requires it — is not consent, it is a consent
 * form, and the Act treats the two very differently. Only the purposes whose
 * basis is `CONSENT` can be withdrawn, and the rest say why not.
 */
export const BASIS_FOR_PURPOSE: Record<ConsentPurposeValue, LawfulBasisValue> = {
  // Verifying who somebody is before they treat patients is not optional.
  IDENTITY_VERIFICATION: 'LEGAL_OBLIGATION',
  // Showing a credential to a facility *is* optional: they can decline and
  // simply not be offered that shift.
  CREDENTIAL_SHARING: 'CONSENT',
  PROFILE_VISIBILITY: 'CONSENT',
  MARKETING: 'CONSENT',
};

export function isWithdrawable(purpose: ConsentPurposeValue): boolean {
  return BASIS_FOR_PURPOSE[purpose] === 'CONSENT';
}

/**
 * Consent the platform asks for at registration.
 *
 * Marketing is deliberately absent: a consent that is collected by default is
 * not freely given, and the Act says so. It is offered separately, later, or
 * not at all.
 */
export const CONSENT_AT_REGISTRATION: ConsentPurposeValue[] = [
  'CREDENTIAL_SHARING',
  'PROFILE_VISIBILITY',
];

/** The Act expects a response within one month of receipt. */
export const RESPONSE_WINDOW_DAYS = 30;

export function dueDateFor(receivedAt: Date, days = RESPONSE_WINDOW_DAYS): Date {
  return new Date(receivedAt.getTime() + days * 24 * 60 * 60 * 1000);
}

export function isOverdue(request: { dueBy: Date; status: RequestStatusValue }, now = new Date()) {
  if (request.status === 'COMPLETED' || request.status === 'REFUSED') return false;
  return request.dueBy.getTime() < now.getTime();
}

/**
 * What erasure can and cannot reach.
 *
 * **An audit row and a ledger entry survive erasure**, and this is the
 * decision rather than an oversight. Both exist under a legal obligation that
 * outlives consent: the audit trail is how a clinical or financial decision
 * is answered for years later, and a ledger that could be partially erased
 * would no longer balance — a practitioner erasing themselves would leave
 * money unaccounted for on the other side of every entry.
 *
 * So erasure is satisfied by **pseudonymisation**: the identifying columns are
 * replaced, and the rows that must persist persist without naming anybody.
 * The subject is told this, because an erasure request answered with silent
 * partial compliance is worse than one refused with a reason.
 */
export const ERASURE_EXEMPT_REASON =
  'Audit records and financial ledger entries are retained under a legal obligation and cannot be deleted. Identifying details are replaced instead, so the records remain answerable without naming you.';

export type ErasureBlocker = 'open_assignment' | 'unpaid_balance' | 'open_dispute';

export interface ErasureCheck {
  confirmedAssignments: number;
  owedKobo: number;
  openDisputes: number;
}

/**
 * Reasons an erasure cannot be actioned yet.
 *
 * Not a refusal — a deferral. Somebody owed money who erases themselves
 * cannot be paid, and a shift still on a ward's roster cannot quietly lose
 * the person due to work it. Each is a thing to settle first, and the subject
 * is told which.
 */
export function erasureBlockers(check: ErasureCheck): ErasureBlocker[] {
  const blockers: ErasureBlocker[] = [];
  if (check.confirmedAssignments > 0) blockers.push('open_assignment');
  if (check.owedKobo > 0) blockers.push('unpaid_balance');
  if (check.openDisputes > 0) blockers.push('open_dispute');
  return blockers;
}

/** The words a subject sees for each blocker, rather than the enum. */
export const BLOCKER_EXPLANATIONS: Record<ErasureBlocker, string> = {
  open_assignment:
    'You are confirmed on a shift that has not yet finished. It has to be worked or cancelled first.',
  unpaid_balance:
    'You are owed money that has not been paid. Erasing the record now would leave nobody to pay.',
  open_dispute: 'A dispute involving you is still open and needs both sides on the record.',
};
