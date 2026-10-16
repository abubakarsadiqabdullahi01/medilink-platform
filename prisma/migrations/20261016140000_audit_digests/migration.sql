-- AUD-06, the second half: a digest of each finished day of the audit trail, so a change made
-- by somebody who owns the table (who can switch the append-only trigger off) would show.
-- One row per sealed day: how many rows it held, a hash of them, and that hash chained to the
-- day before. Written by the nightly job `audit.digest_sweep`; never changed.
CREATE TABLE "audit"."audit_digests" (
    "day" DATE NOT NULL,
    "row_count" INTEGER NOT NULL,
    "day_hash" TEXT NOT NULL,
    "digest" TEXT NOT NULL,
    "sealed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_digests_pkey" PRIMARY KEY ("day")
);

-- The refusal names the table it was asked about, now that two tables use it.
CREATE OR REPLACE FUNCTION "audit"."refuse_audit_change"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '%.% is append-only: % is not allowed', TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege',
          HINT = 'A row here is written once. Correct the record by writing another row.';
END;
$$;

CREATE TRIGGER "audit_digests_append_only"
  BEFORE UPDATE OR DELETE ON "audit"."audit_digests"
  FOR EACH ROW EXECUTE FUNCTION "audit"."refuse_audit_change"();
