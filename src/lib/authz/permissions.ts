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
  'payout.manage': 'Initiate or release a payout',
  'payout.account.change': 'Change a payout bank account (requires step-up auth)',

  // governance
  'dispute.manage': 'Work a dispute case',
  'sanction.apply': 'Apply or lift a sanction',
  'incident.report': 'Report a clinical incident',
  'incident.manage': 'Manage a clinical incident, including suspension',
  'audit.read': 'Read the audit trail',
  'config.manage': 'Edit controlled vocabularies and rate floors',

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
  // Granting a role is how an attacker with one session gets a durable
  // second one. It is also rare enough that asking for a password again
  // costs an administrator seconds a month.
  'role.grant',
]);

export function requiresStepUp(permission: Permission): boolean {
  return STEP_UP_PERMISSIONS.has(permission);
}

/**
 * Starting bundles. Roles are convenience only — every check in application
 * code names a permission, never a role.
 */
export const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  practitioner: [
    'availability.read', 'availability.write',
    'practitioner.profile.read', 'practitioner.profile.write', 'credential.submit',
    'credential.document.read', 'service_request.read', 'attendance.record',
    'timesheet.submit', 'invoice.read', 'payout.account.change', 'dispute.manage',
    'suggestion.submit',
  ],
  facility_owner: [
    'facility.read', 'facility.write', 'facility.user.manage', 'service_request.read',
    'service_request.publish', 'assignment.confirm', 'assignment.cancel',
    'timesheet.approve', 'invoice.read', 'payout.manage', 'dispute.manage',
    'incident.report', 'suggestion.submit',
  ],
  facility_administrator: [
    'facility.read', 'facility.write', 'facility.user.manage', 'service_request.read',
  ],
  facility_scheduler: [
    'availability.read',
    'facility.read', 'service_request.read', 'service_request.publish',
    'assignment.confirm', 'assignment.cancel', 'attendance.record',
  ],
  facility_finance_officer: ['facility.read', 'timesheet.approve', 'invoice.read', 'payout.manage'],
  operations_officer: [
    // facility.write at PLATFORM is what lets operations onboard a facility.
    // A facility is an organisation rather than a person and is not
    // self-declared, so somebody on this side has to create the record;
    // without this, only super_administrator could, which is not a role
    // anyone should be doing daily onboarding under.
    'availability.read',
    'user.read', 'practitioner.profile.read', 'facility.read', 'facility.write',
    'service_request.read', 'assignment.confirm', 'assignment.cancel', 'dispute.manage',
    'suggestion.submit', 'suggestion.triage',
  ],
  compliance_officer: [
    // facility.read alongside facility.verify: a compliance officer who can
    // approve a facility and cannot list the ones waiting has a queue they
    // cannot open. Found by building the console — the API refused the list
    // while accepting the verify, which no test asked about because no test
    // needed to see a queue before working it.
    'user.read', 'user.suspend', 'practitioner.profile.read', 'credential.review',
    'credential.document.read', 'facility.read', 'facility.verify', 'sanction.apply',
    'incident.manage', 'audit.read',
  ],
  // facility.read is not decoration: billing a facility means knowing which
  // facilities exist, and without it a finance officer cannot open the page
  // that raises their invoices. Found by seeding a real finance officer and
  // watching the console 403.
  finance_officer: ['facility.read', 'invoice.read', 'payout.manage', 'audit.read'],
  super_administrator: Object.keys(PERMISSIONS) as Permission[],
};
