-- Nine roles become five.
--
-- Operations, compliance and finance each held an overlapping slice of the
-- platform side; a facility had an administrator, a scheduler and a finance
-- officer who between them could not complete one shift without handing it
-- to each other. See src/lib/authz/permissions.ts for why.
--
-- Nobody loses a permission. The replacement role is a superset of the one it
-- replaces in every case, and src/lib/authz/roles.test.ts asserts that against
-- the pre-merge bundles so this stays true if a bundle is edited later.
--
-- Written as data SQL rather than left to the seed because the seed is not run
-- on a deployed database, and a live grant pointing at a role that no longer
-- exists would sign somebody out of their own console.

-- The role rows themselves are upserted by prisma/seed.ts from
-- ROLE_PERMISSIONS, but a deployed database needs `administrator` to exist
-- before the grants below can point at it.
INSERT INTO identity.roles (id, key, name, created_at)
VALUES (gen_random_uuid(), 'administrator', 'administrator', now())
ON CONFLICT (key) DO NOTHING;

INSERT INTO identity.roles (id, key, name, created_at)
VALUES (gen_random_uuid(), 'facility_administrator', 'facility_administrator', now())
ON CONFLICT (key) DO NOTHING;

-- Repoint every live grant at its replacement.
--
-- `WHERE NOT EXISTS` rather than a bare UPDATE: somebody holding two of the
-- merged roles at the same scope — a compliance officer who also did finance,
-- which was common enough to be the reason for this merge — would otherwise
-- collide on unique(user_id, role_id, scope_type, scope_id). The duplicates
-- are deleted afterwards instead.
WITH mapping(old_key, new_key) AS (
  VALUES
    ('operations_officer',       'administrator'),
    ('compliance_officer',       'administrator'),
    ('finance_officer',          'administrator'),
    ('facility_scheduler',       'facility_administrator'),
    ('facility_finance_officer', 'facility_administrator')
)
UPDATE identity.user_roles AS ur
SET role_id = new_role.id
FROM mapping
JOIN identity.roles AS old_role ON old_role.key = mapping.old_key
JOIN identity.roles AS new_role ON new_role.key = mapping.new_key
WHERE ur.role_id = old_role.id
  AND NOT EXISTS (
    SELECT 1
    FROM identity.user_roles AS existing
    WHERE existing.user_id = ur.user_id
      AND existing.role_id = new_role.id
      AND existing.scope_type = ur.scope_type
      AND existing.scope_id IS NOT DISTINCT FROM ur.scope_id
  );

-- Whatever is left pointing at a retired role is a duplicate of a grant the
-- step above already made, so dropping it takes nothing away from anybody.
DELETE FROM identity.user_roles AS ur
USING identity.roles AS r
WHERE ur.role_id = r.id
  AND r.key IN (
    'operations_officer', 'compliance_officer', 'finance_officer',
    'facility_scheduler', 'facility_finance_officer'
  );

-- The retired roles themselves. role_permissions cascades from the role.
DELETE FROM identity.roles
WHERE key IN (
  'operations_officer', 'compliance_officer', 'finance_officer',
  'facility_scheduler', 'facility_finance_officer'
);
