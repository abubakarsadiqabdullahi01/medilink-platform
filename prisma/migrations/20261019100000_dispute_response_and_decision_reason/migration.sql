-- M14-03: by when the other side is asked to reply to a dispute, their one written reply, and the
-- reason a decision turned on beside the officer's notes.
--
-- respond_by is a marker for the officers and tells the other side what is expected: nothing
-- happens to a case when it passes. Cases already open get seven days from when they were opened,
-- the default the application uses from now on.

-- CreateEnum
CREATE TYPE "disputes"."DisputeDecisionReason" AS ENUM ('RECORD_WAS_WRONG', 'AGREEMENT_NOT_KEPT', 'COMPLAINT_NOT_MADE_OUT', 'RECORD_CONFIRMED', 'NOT_ENOUGH_TO_DECIDE', 'NOT_FOR_MEDILINK', 'OTHER');

-- AlterTable
ALTER TABLE "disputes"."disputes"
  ADD COLUMN "respond_by" TIMESTAMP(3),
  ADD COLUMN "response_note" TEXT,
  ADD COLUMN "responded_at" TIMESTAMP(3),
  ADD COLUMN "responded_by" UUID,
  ADD COLUMN "decision_reason" "disputes"."DisputeDecisionReason";

-- Cases that exist now were opened before there was a reply to wait for.
UPDATE "disputes"."disputes" SET "respond_by" = "created_at" + INTERVAL '7 days';

ALTER TABLE "disputes"."disputes" ALTER COLUMN "respond_by" SET NOT NULL;
