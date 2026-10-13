/**
 * Permissions, not roles (Section 8.8). Authorisation always asks two
 * questions: does this user hold the permission, and does their grant cover
 * the scope of the record being touched? A role alone is never sufficient.
 */
export const PERMISSIONS = {
  // identity
  'user.read': 'View a user account',
  'user.suspend': 'Suspend or reinstate a user account',
  'role.grant': 'Grant or revoke a role within a scope',

  // practitioners and credentials
  'practitioner.profile.read': 'View a practitioner profile',
  'practitioner.profile.write': 'Edit a practitioner profile',
  'credential.submit': 'Submit a credential for review',
  'credential.review': 'Approve or reject a submitted credential',
  'credential.document.read': 'Retrieve a credential document',

  // facilities
  'facility.read': 'View a facility, branch or department',
  'facility.write': 'Create or edit a facility, branch or department',
  'facility.verify': 'Verify a facility licence',
  'facility.user.manage': 'Manage staff accounts within a facility',

  // staffing
  'availability.read': 'View a practitioner availability calendar',
  'availability.write': 'Set your own availability',
  'service_request.read': 'View a service request',
  'service_request.publish': 'Publish a service request',
  'assignment.confirm': 'Confirm a practitioner onto an assignment',
  'assignment.cancel': 'Cancel an assignment',

  // attendance and money
  'attendance.record': 'Record a check-in or check-out',
  'timesheet.submit': 'Submit a timesheet',
  'timesheet.approve': 'Approve a timesheet',
  'invoice.read': 'View an invoice',
  'payout.manage': 'Raise and issue invoices, record payment, prepare and release payouts (requires step-up auth)',
  'payout.account.change': 'Change a payout bank account (requires step-up auth)',

  // governance
  'dispute.manage': 'Work a dispute case',
  'sanction.apply': 'Apply or lift a sanction',
  'incident.report': 'Report a clinical incident',
  'incident.manage': 'Manage a clinical incident, including suspension',
  'audit.read': 'Read the audit trail',
  'config.manage': 'Edit controlled vocabularies and rate floors',
  'system.manage': 'See failures in background work and replay an event that gave up',

  // Module 18, the pilot's suggestion log. These two are the only keys added
  // to Section 8.8's catalogue by this codebase, and the reason is that no
  // existing key fits: submitting a suggestion is something every signed-in
  // user should be able to do, and there is no "any authenticated user"
  // permission by design — the guard requires a permission and a scope for
  // everything. Reusing an unrelated key to avoid the addition would have
  // made the route table lie about what it authorises.
  'suggestion.submit': 'Submit a suggestion or a complaint about the platform',
  'suggestion.triage': 'Triage and respond to the suggestion log',
} as const;

export type Permission = keyof typeof PERMISSIONS;

/**
 * Permissions that need a recently re-authenticated session, not merely a
 * signed-in one. Step 4.8.
 *
 * **Declared against the permission, not the route.** A per-route flag is a
 * thing somebody forgets on the eleventh route; a permission that carries its
 * own requirement is enforced by `handleGuardedRequest` for every route that
 * ever names it, including ones not written yet. `payout.account.change` is
 * here because the catalogue entry above already says so in words — this is
 * the same statement in a form the code can act on.
 *
 * The bar for adding one: an act that moves money to a new destination, or
 * that hands somebody else the ability to. Both are what a stolen laptop with
 * an open session is used for, and neither is undone by noticing quickly.
 */
export const STEP_UP_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>([
  'payout.account.change',
  // The money acts: issuing a bill, recording that it was paid, preparing and
  // releasing a payout. All five routes name this one permission, and all are
  // what an open finance session on a stolen laptop is used for.
  'payout.manage',
  // Granting a role is how an attacker with one session gets a durable
  // second one. It is also rare enough that asking for a password again
  // costs an administrator seconds a month.
  'role.grant',
]);

export function requiresStepUp(permission: Permission): boolean {
  return STEP_UP_PERMISSIONS.has(permission);
}

/**
 * The five roles, and what each one may do.
 *
 * There were nine. Operations, compliance and finance each held an overlapping
 * slice of the platform side, and a facility had an administrator, a scheduler
 * and a finance officer who between them could not complete a single shift
 * without handing it to each other. Every one of those boundaries was a
 * guess about how a Nigerian hospital divides work, made before a hospital
 * had used the product — and the pilot answered it: one person does the lot.
 *
 * So the question each role answers is now "whose job is this?", not "which
 * module is this?":
 *
 *   super_administrator   everything, including who may change the rules
 *   administrator         the platform's day-to-day: onboarding, compliance, money
 *   facility_owner        the MD — their administrator, plus staff and disputes
 *   facility_administrator  one facility's whole operation
 *   practitioner          their own record, their own shifts, their own pay
 *
 * **Roles are still convenience only.** Every check in application code names
 * a permission and a scope; nothing anywhere asks "is this person an
 * administrator?". That is what made collapsing nine roles into five a change
 * to this file and a data migration, rather than a rewrite — and it is why
 * the next reorganisation will be cheap too.
 */

/** Their own record, their own shifts, their own pay. */
const PRACTITIONER: Permission[] = [
  'availability.read', 'availability.write',
  'practitioner.profile.read', 'practitioner.profile.write', 'credential.submit',
  'credential.document.read', 'service_request.read', 'attendance.record',
  'timesheet.submit', 'invoice.read', 'payout.account.change', 'dispute.manage',
  'suggestion.submit',
];

/**
 * One facility's whole operation: the old administrator, scheduler and
 * finance officer in one person.
 *
 * Each of those three was missing something the other two had, and the gaps
 * showed up as a console that 403'd its own sidebar — an accounts officer who
 * could approve a timesheet but not list the roster it came from, a scheduler
 * who could confirm somebody onto a shift but not see the calendar. Merging
 * them does not widen anybody's reach beyond their own facility: the scope on
 * the grant is what confines them, and that has not changed.
 *
 * `incident.report` and `suggestion.submit` are new to this side. Neither of
 * the three old roles carried them, which meant the person actually standing
 * on the ward when something went wrong had to find the owner to report it.
 * That was an oversight in the split, not a rule.
 */
const FACILITY_ADMINISTRATOR: Permission[] = [
  'availability.read',
  'facility.read', 'facility.write', 'facility.user.manage',
  'service_request.read', 'service_request.publish',
  'assignment.confirm', 'assignment.cancel', 'attendance.record',
  'timesheet.approve', 'invoice.read', 'payout.manage',
  'incident.report', 'suggestion.submit',
];

/**
 * The platform's day-to-day: onboarding, compliance and money.
 *
 * The merge of operations_officer, compliance_officer and finance_officer.
 * The three overlapped on two thirds of their keys already — all three needed
 * `facility.read` to see the facilities they were acting on, two needed
 * `audit.read`, two needed `practitioner.profile.read` — and the parts that
 * did not overlap were not a separation of duties so much as three views of
 * the same morning's work.
 *
 * `role.grant` is here so an administrator can appoint another one. The
 * ceiling is enforced by `grantRole` rather than by withholding the key:
 * nobody can grant a permission they do not themselves hold, so an
 * administrator can create administrators and facility owners and is refused
 * `super_administrator` — that bundle contains `config.manage`, which they
 * have not got. A rule that holds for every role, including ones not written
 * yet, beats a list of roles somebody has to remember to update.
 *
 * It is also a step-up permission, so appointing somebody costs a password
 * re-entry. See STEP_UP_PERMISSIONS above for why that bar is set there.
 *
 * What it deliberately does *not* hold is below.
 */
const ADMINISTRATOR: Permission[] = [
  'user.read', 'user.suspend', 'role.grant',
  'practitioner.profile.read',
  'credential.review', 'credential.document.read',
  'facility.read', 'facility.write', 'facility.verify',
  'availability.read',
  'service_request.read', 'assignment.confirm', 'assignment.cancel',
  'invoice.read', 'payout.manage',
  'dispute.manage', 'sanction.apply', 'incident.manage',
  'audit.read', 'system.manage',
  'suggestion.submit', 'suggestion.triage',
];

export const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  practitioner: PRACTITIONER,

  facility_administrator: FACILITY_ADMINISTRATOR,

  /**
   * The MD. Their administrator, plus the two things that are theirs alone.
   *
   * `role.grant` is how a hospital staffs itself, and handing somebody else
   * the keys is an owner's decision rather than an operational one.
   * `dispute.manage` is here for the same reason: a dispute is an argument
   * between the facility and a practitioner about money or conduct, and the
   * person answering for the facility should be the one who answers it.
   */
  facility_owner: [...FACILITY_ADMINISTRATOR, 'role.grant', 'dispute.manage'],

  administrator: ADMINISTRATOR,

  /**
   * Everything — and the two keys that are the difference between running the
   * platform and *being* it.
   *
   * `config.manage` edits the controlled vocabularies and the rate floors: the
   * minimum a nurse may legally be offered for a night shift is a policy
   * decision, not an operational one, and the person clearing today's queue
   * should not be able to move it.
   *
   * `config.manage` is therefore the whole of the difference. An
   * administrator can appoint another administrator, but only a super
   * administrator can appoint a super administrator — not because the key is
   * withheld, but because granting that bundle means granting
   * `config.manage`, and `grantRole` refuses to hand out what the granting
   * actor has not got. The ceiling enforces itself.
   */
  super_administrator: Object.keys(PERMISSIONS) as Permission[],
};

/**
 * The roles that no longer exist, and what each became.
 *
 * Kept in the code rather than only in a migration because a grant can be
 * written by a script, a seed or somebody's half-finished branch, and all of
 * them should land on the same answer. `prisma/seed.ts` reads this to retire
 * the old rows; `scripts/` read it so a demo built last month still signs in.
 */
export const RETIRED_ROLES: Record<string, keyof typeof ROLE_PERMISSIONS> = {
  operations_officer: 'administrator',
  compliance_officer: 'administrator',
  finance_officer: 'administrator',
  facility_scheduler: 'facility_administrator',
  facility_finance_officer: 'facility_administrator',
};

/** Where a role's holder is meant to work, for the console that lists them. */
export const ROLE_LABELS: Record<string, { name: string; description: string }> = {
  practitioner: {
    name: 'Practitioner',
    description: 'Their own profile, availability, shifts, timesheets and pay.',
  },
  facility_administrator: {
    name: 'Facility administrator',
    description: 'Runs one facility: shifts, rosters, attendance, timesheets and invoices.',
  },
  facility_owner: {
    name: 'Facility owner (MD)',
    description: 'Everything an administrator does, plus adding staff and answering disputes.',
  },
  administrator: {
    name: 'Administrator',
    description: 'Onboarding, credential and facility verification, casework and money.',
  },
  super_administrator: {
    name: 'Super administrator',
    description: 'Everything, including the rate floors and who else may administer.',
  },
};
