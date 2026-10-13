-- BIL-08: a draft invoice raised from the wrong figures can be voided.
--
-- A line used to pin its shift for good through a unique index on
-- assignment_id, so a voided invoice would have left its shifts un-billable
-- for ever. A voided line is kept, for the audit trail, and no longer counts:
-- the one-line-per-shift rule becomes a partial unique index over live lines.
-- Prisma cannot express a partial index, so it lives here, as the one-live-grant
-- index on identity.user_roles does.

ALTER TABLE "billing"."invoice_lines" ADD COLUMN "voided_at" TIMESTAMP(3);

DROP INDEX "billing"."invoice_lines_assignment_id_key";

CREATE UNIQUE INDEX "invoice_lines_one_live_line_per_shift"
  ON "billing"."invoice_lines" ("assignment_id")
  WHERE "voided_at" IS NULL;

-- Looked up by shift (is it already billed?) and no longer by a unique key.
CREATE INDEX "invoice_lines_assignment_id_idx" ON "billing"."invoice_lines" ("assignment_id");
