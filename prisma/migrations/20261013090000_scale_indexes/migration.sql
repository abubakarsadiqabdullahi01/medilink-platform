-- Measured with EXPLAIN ANALYZE on 12,000 assignments, 4,000 shifts and 10,000
-- invoices (scripts/seed-performance.ts). Status-filtered reads of a facility's
-- assignments went from 230 buffers (read the whole facility, discard by status,
-- sort) to 15; invoices by period from 201 to 115; shifts by status from 27 to 21.
--
-- The old (facility_id, starts_at) index on assignments is deliberately kept:
-- the unfiltered roster is the default, and without it that query sorts a
-- facility's entire history instead of stopping at the first page.

-- DropIndex
DROP INDEX "service_requests"."service_requests_facility_id_status_idx";

-- DropIndex
DROP INDEX "billing"."invoices_facility_id_status_idx";

-- CreateIndex
CREATE INDEX "assignments_facility_id_status_starts_at_id_idx" ON "matching"."assignments"("facility_id", "status", "starts_at", "id");

-- CreateIndex
CREATE INDEX "assignments_user_id_status_starts_at_id_idx" ON "matching"."assignments"("user_id", "status", "starts_at", "id");

-- CreateIndex
CREATE INDEX "service_requests_facility_id_status_starts_at_id_idx" ON "service_requests"."service_requests"("facility_id", "status", "starts_at", "id");

-- CreateIndex
CREATE INDEX "invoices_facility_id_period_start_status_idx" ON "billing"."invoices"("facility_id", "period_start", "status");
