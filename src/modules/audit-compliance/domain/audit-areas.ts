/**
 * Which part of the product an audit row belongs to.
 *
 * Every action is written `<subject>.<verb>` — `facility.verified`,
 * `auth.otp_issued` — and the subject is stable, so the filter groups by
 * subject rather than offering a dropdown of seventy actions. Somebody looking
 * into a shift that went wrong wants the shift's whole story and should not
 * have to guess whether the row they need was written as `assignment.`,
 * `attendance.` or `timesheet.`.
 *
 * Deliberately absent: an area, or any other filter, keyed to a person.
 * Naming who did something is the point of the trail; pivoting the whole trail
 * onto one name is a different tool, and not one this console hands anybody.
 */
export const AUDIT_AREAS = {
  ACCESS: ['auth', 'role', 'user'],
  PRACTITIONERS: ['practitioner', 'credential', 'availability'],
  FACILITIES: ['facility', 'rate_card'],
  SHIFTS: ['service_request', 'matching', 'assignment', 'attendance', 'timesheet', 'excusal'],
  CASEWORK: ['incident', 'dispute', 'suggestion'],
  MONEY: ['invoice', 'payout'],
  COMPLIANCE: ['data_subject', 'agreement'],
} as const satisfies Record<string, readonly string[]>;

export type AuditArea = keyof typeof AUDIT_AREAS;

export const AUDIT_AREA_VALUES = Object.keys(AUDIT_AREAS) as [AuditArea, ...AuditArea[]];

/** What each area is called on screen. */
export const AUDIT_AREA_LABELS: Record<AuditArea, string> = {
  ACCESS: 'Sign-in and access',
  PRACTITIONERS: 'Practitioners',
  FACILITIES: 'Facilities',
  SHIFTS: 'Shifts',
  CASEWORK: 'Casework',
  MONEY: 'Money',
  COMPLIANCE: 'Compliance',
};

/** The subject half of an action: `facility.verified` → `facility`. */
export function actionSubject(action: string): string {
  const dot = action.indexOf('.');
  return dot === -1 ? action : action.slice(0, dot);
}

/**
 * Which area an action falls in, or null when nothing claims it.
 *
 * A new module's actions are unclaimed until somebody adds the subject above,
 * and unclaimed means invisible to every area filter — which is why the test
 * beside this file holds the list of subjects in use and fails when one is
 * missing. A row the filter silently hides is worse than no filter.
 */
export function areaOf(action: string): AuditArea | null {
  const subject = actionSubject(action);
  for (const [area, subjects] of Object.entries(AUDIT_AREAS) as [AuditArea, readonly string[]][]) {
    if (subjects.includes(subject)) return area;
  }
  return null;
}
