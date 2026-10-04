-- An administrator may appoint another administrator.
--
-- `role.grant` was held back when the nine roles became five, on the reading
-- that growing the set of people who can act on the whole platform should be
-- the super administrator's act alone. In practice that makes onboarding a
-- colleague a request to one person, and the ceiling it was protecting is
-- already enforced somewhere better: `grantRole` refuses to hand out any
-- permission the granting actor does not themselves hold.
--
-- So an administrator can now create administrators, facility owners and
-- practitioners — and is still refused `super_administrator`, because that
-- bundle carries `config.manage` and they have not got it. The rule holds for
-- roles nobody has written yet, which a hard-coded list would not.
--
-- `role.grant` is a step-up permission, so appointing somebody costs a
-- password re-entry. See STEP_UP_PERMISSIONS in src/lib/authz/permissions.ts.
--
-- Written as a migration as well as in the seed because role_permissions is
-- reference data: a deployed database runs `migrate deploy`, not `db:seed`,
-- and without this the console would offer a Staff screen the API refused.
INSERT INTO identity.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM identity.roles AS r
CROSS JOIN identity.permissions AS p
WHERE r.key = 'administrator'
  AND p.key = 'role.grant'
ON CONFLICT (role_id, permission_id) DO NOTHING;
