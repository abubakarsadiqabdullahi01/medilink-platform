import { describe, expect, it } from 'vitest';
import {
  PERMISSIONS,
  RETIRED_ROLES,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  type Permission,
} from './permissions';

/**
 * The five roles, asserted as a shape rather than as a list of keys.
 *
 * These cases are about the relationships between the roles — who is a
 * superset of whom, what only the super administrator holds — because those
 * are the statements the docblocks make in prose and the ones a later edit
 * can silently break. A test that only repeated the arrays would pass any
 * edit that was internally consistent and wrong.
 */

const ALL = Object.keys(PERMISSIONS) as Permission[];

function holds(role: string): Set<Permission> {
  return new Set(ROLE_PERMISSIONS[role]);
}

describe('the role set', () => {
  it('is the five the product talks about, and no more', () => {
    expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual([
      'administrator',
      'facility_administrator',
      'facility_owner',
      'practitioner',
      'super_administrator',
    ]);
  });

  it('gives every role a name and a description for the console', () => {
    for (const role of Object.keys(ROLE_PERMISSIONS)) {
      expect(ROLE_LABELS[role]?.name, role).toBeTruthy();
      expect(ROLE_LABELS[role]?.description, role).toBeTruthy();
    }
  });

  it('grants nothing that is not in the catalogue', () => {
    // A typo in a bundle would otherwise be a permission nobody holds and no
    // route names — invisible until somebody is refused a screen they own.
    for (const [role, permissions] of Object.entries(ROLE_PERMISSIONS)) {
      for (const permission of permissions) {
        expect(ALL, `${role} → ${permission}`).toContain(permission);
      }
    }
  });

  it('repeats no permission within a bundle', () => {
    for (const [role, permissions] of Object.entries(ROLE_PERMISSIONS)) {
      expect(new Set(permissions).size, role).toBe(permissions.length);
    }
  });
});

describe('who is a superset of whom', () => {
  it('gives the super administrator every permission there is', () => {
    expect(holds('super_administrator').size).toBe(ALL.length);
  });

  it('makes the facility owner their administrator plus staff and disputes', () => {
    const owner = holds('facility_owner');
    const administrator = holds('facility_administrator');

    for (const permission of administrator) {
      expect(owner, permission).toContain(permission);
    }

    const extra = [...owner].filter((permission) => !administrator.has(permission)).sort();
    expect(extra).toEqual(['dispute.manage', 'role.grant']);
  });
});

describe('what the platform administrator is deliberately not given', () => {
  const administrator = holds('administrator');

  it('cannot change the rules', () => {
    // `config.manage` carries the rate floors — the minimum a nurse may
    // legally be offered for a night shift. That is a policy decision, not an
    // operational one, and it is the whole of what separates running the
    // platform from being it. If a later edit hands it over it should be a
    // decision somebody took on purpose, which is what failing here forces.
    expect(administrator.has('config.manage')).toBe(false);
  });

  it('can appoint another administrator, but cannot reach past itself', () => {
    // Appointing is allowed. The ceiling is not this key — it is `grantRole`
    // refusing to hand out a permission the granting actor does not hold, so
    // granting `super_administrator` fails on `config.manage` above.
    expect(administrator.has('role.grant')).toBe(true);

    const superAdmin = holds('super_administrator');
    const outOfReach = [...superAdmin].filter((permission) => !administrator.has(permission));

    // If this ever empties, an administrator could grant super_administrator
    // and the two roles would be the same thing wearing different names.
    expect(outOfReach.length).toBeGreaterThan(0);
    expect(outOfReach).toContain('config.manage');
  });

  it('cannot act as a practitioner or as a facility', () => {
    // A platform administrator submitting their own timesheet, setting their
    // own availability or publishing a shift would be acting on one side of a
    // transaction they adjudicate.
    for (const permission of [
      'availability.write',
      'credential.submit',
      'timesheet.submit',
      'timesheet.approve',
      'attendance.record',
      'service_request.publish',
      'payout.account.change',
      'practitioner.profile.write',
      'facility.user.manage',
    ] as Permission[]) {
      expect(administrator.has(permission), permission).toBe(false);
    }
  });

  it('can still do the whole of its own job', () => {
    // The merge exists to stop a console 403ing its own sidebar, so the
    // things each of the three old roles was for all have to survive it.
    for (const permission of [
      'facility.verify', // was compliance
      'credential.review', // was compliance
      'audit.read', // was compliance and finance
      'payout.manage', // was finance
      'invoice.read', // was finance
      'suggestion.triage', // was operations
      'assignment.confirm', // was operations
      'user.suspend', // was compliance
    ] as Permission[]) {
      expect(administrator.has(permission), permission).toBe(true);
    }
  });
});

describe('the retired roles', () => {
  it('each name a role that still exists', () => {
    for (const [retired, replacement] of Object.entries(RETIRED_ROLES)) {
      expect(ROLE_PERMISSIONS[replacement], `${retired} → ${replacement}`).toBeDefined();
    }
  });

  it('are not also live roles', () => {
    for (const retired of Object.keys(RETIRED_ROLES)) {
      expect(ROLE_PERMISSIONS[retired], retired).toBeUndefined();
    }
  });

  it('lose nobody a permission they held before the merge', () => {
    // The whole promise of the migration: somebody who was a compliance
    // officer on Friday can do everything on Monday that they could then.
    const before: Record<string, Permission[]> = {
      operations_officer: [
        'availability.read', 'user.read', 'practitioner.profile.read', 'facility.read',
        'facility.write', 'service_request.read', 'assignment.confirm', 'assignment.cancel',
        'dispute.manage', 'suggestion.submit', 'suggestion.triage',
      ],
      compliance_officer: [
        'user.read', 'user.suspend', 'practitioner.profile.read', 'credential.review',
        'credential.document.read', 'facility.read', 'facility.verify', 'sanction.apply',
        'incident.manage', 'audit.read',
      ],
      finance_officer: [
        'facility.read', 'invoice.read', 'payout.manage', 'audit.read',
        'practitioner.profile.read',
      ],
      facility_scheduler: [
        'availability.read', 'facility.read', 'service_request.read',
        'service_request.publish', 'assignment.confirm', 'assignment.cancel',
        'attendance.record',
      ],
      facility_finance_officer: [
        'facility.read', 'service_request.read', 'timesheet.approve', 'invoice.read',
        'payout.manage',
      ],
    };

    for (const [retired, had] of Object.entries(before)) {
      const replacement = RETIRED_ROLES[retired];
      expect(replacement, retired).toBeDefined();
      const now = holds(replacement as string);
      for (const permission of had) {
        expect(now, `${retired} held ${permission}`).toContain(permission);
      }
    }
  });
});
