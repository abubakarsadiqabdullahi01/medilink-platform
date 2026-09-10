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
} as const;

export type Permission = keyof typeof PERMISSIONS;

/**
 * Starting bundles. Roles are convenience only — every check in application
 * code names a permission, never a role.
 */
export const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  practitioner: [
    'practitioner.profile.read', 'practitioner.profile.write', 'credential.submit',
    'credential.document.read', 'service_request.read', 'attendance.record',
    'timesheet.submit', 'invoice.read', 'payout.account.change', 'dispute.manage',
  ],
  facility_owner: [
    'facility.read', 'facility.write', 'facility.user.manage', 'service_request.read',
    'service_request.publish', 'assignment.confirm', 'assignment.cancel',
    'timesheet.approve', 'invoice.read', 'payout.manage', 'dispute.manage',
    'incident.report',
  ],
  facility_administrator: [
    'facility.read', 'facility.write', 'facility.user.manage', 'service_request.read',
  ],
  facility_scheduler: [
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
    'user.read', 'practitioner.profile.read', 'facility.read', 'facility.write',
    'service_request.read', 'assignment.confirm', 'assignment.cancel', 'dispute.manage',
  ],
  compliance_officer: [
    'user.read', 'user.suspend', 'practitioner.profile.read', 'credential.review',
    'credential.document.read', 'facility.verify', 'sanction.apply', 'incident.manage',
    'audit.read',
  ],
  finance_officer: ['invoice.read', 'payout.manage', 'audit.read'],
  super_administrator: Object.keys(PERMISSIONS) as Permission[],
};
