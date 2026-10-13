-- A timesheet records night minutes and holiday minutes that overlap, because a
-- reader wants to see both. Pricing needs buckets that do not, and the exact
-- split was computed at timesheet time and then thrown away: billing rebuilt it
-- by subtracting one overlapping figure from the other, which loses minutes
-- whenever a night and a holiday overlap other than by one containing the other.
--
-- This keeps the one figure that cannot be recovered afterwards: night minutes
-- that are not also holiday minutes. Holiday takes precedence over night, so
-- the holiday bucket is the existing holiday_minutes, and ordinary is whatever
-- is left of the billable minutes.

-- AlterTable
ALTER TABLE "timesheets"."timesheets" ADD COLUMN "night_only_minutes" INTEGER NOT NULL DEFAULT 0;

-- Rows that already exist were priced as night minus holiday minutes and are
-- backfilled to the same figure, so nothing already invoiced changes; the exact
-- value is written the next time a timesheet is worked out.
UPDATE "timesheets"."timesheets"
SET "night_only_minutes" = GREATEST("night_minutes" - "holiday_minutes", 0);
