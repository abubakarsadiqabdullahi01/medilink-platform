-- AUD-06: the audit table is append-only because the database refuses to change it, not because
-- no code happens to. A row trigger, so it holds for every client: the application, a script, a
-- console session, a later migration that forgets what the table is for.
--
-- Deliberately not covered: TRUNCATE (the test suite and the local reset script empty the
-- table that way, and a statement trigger would have to be told when that is allowed), and a
-- role that owns the table, which can drop this trigger. See tests/integration/audit-append-only.test.ts.
CREATE OR REPLACE FUNCTION "audit"."refuse_audit_change"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit.audit_log is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'insufficient_privilege',
          HINT = 'An audit row is written once. Correct the record by writing another row.';
END;
$$;

CREATE TRIGGER "audit_log_append_only"
  BEFORE UPDATE OR DELETE ON "audit"."audit_log"
  FOR EACH ROW EXECUTE FUNCTION "audit"."refuse_audit_change"();
