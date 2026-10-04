-- One live grant per person, role and scope.
--
-- `@@unique([userId, roleId, scopeType, scopeId])` has been on the model
-- since Stage 4 and does not do what it looks like it does: PostgreSQL treats
-- NULLs as distinct in a unique index, and a PLATFORM grant's scope_id is
-- NULL by definition. So the one scope where duplicates matter most — the
-- whole platform — was the one scope with no protection at all.
--
-- Found when a super administrator ended up with two live grants after a
-- revoke, a re-grant through the API, and then a bootstrap script run that
-- un-revoked the original. Harmless on its own; not harmless next to
-- `assertNotTheLastWhoCanAppoint`, which counts grants to decide whether
-- another account could still appoint a replacement. A duplicate inflates
-- that count, and the guard would then allow the revocation it exists to
-- refuse.
--
-- Revoked rows are deliberately left alone. The trail has to be able to say
-- that somebody held a role, lost it, and was given it back.

-- Collapse any existing duplicates onto the oldest live row, so the index
-- below can be created. Keeping the oldest preserves the real "granted at".
DELETE FROM identity.user_roles AS duplicate
USING identity.user_roles AS keeper
WHERE duplicate.revoked_at IS NULL
  AND keeper.revoked_at IS NULL
  AND duplicate.user_id = keeper.user_id
  AND duplicate.role_id = keeper.role_id
  AND duplicate.scope_type = keeper.scope_type
  AND duplicate.scope_id IS NOT DISTINCT FROM keeper.scope_id
  AND (duplicate.created_at, duplicate.id) > (keeper.created_at, keeper.id);

-- COALESCE to a sentinel so NULL participates, and partial so the constraint
-- binds only live grants.
CREATE UNIQUE INDEX IF NOT EXISTS user_roles_one_live_grant
  ON identity.user_roles (
    user_id,
    role_id,
    scope_type,
    COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE revoked_at IS NULL;
