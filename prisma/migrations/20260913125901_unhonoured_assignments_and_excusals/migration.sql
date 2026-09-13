-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "cancellations_sanctions";

-- CreateEnum
CREATE TYPE "cancellations_sanctions"."UnhonouredStatus" AS ENUM ('AWAITING_DECISION', 'CLOSED');

-- CreateEnum
CREATE TYPE "cancellations_sanctions"."Fault" AS ENUM ('PRACTITIONER', 'FACILITY', 'NEITHER');

-- CreateEnum
CREATE TYPE "cancellations_sanctions"."ExcusalStatus" AS ENUM ('REQUESTED', 'GRANTED', 'REFUSED');

-- CreateTable
CREATE TABLE "cancellations_sanctions"."unhonoured_assignments" (
    "id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "shift_ended_at" TIMESTAMP(3) NOT NULL,
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "cancellations_sanctions"."UnhonouredStatus" NOT NULL DEFAULT 'AWAITING_DECISION',
    "fault" "cancellations_sanctions"."Fault",
    "decided_by" UUID,
    "decided_at" TIMESTAMP(3),
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "unhonoured_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cancellations_sanctions"."excusals" (
    "id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "requested_by" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "cancellations_sanctions"."ExcusalStatus" NOT NULL DEFAULT 'REQUESTED',
    "decided_by" UUID,
    "decided_at" TIMESTAMP(3),
    "decision_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "excusals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "unhonoured_assignments_assignment_id_key" ON "cancellations_sanctions"."unhonoured_assignments"("assignment_id");

-- CreateIndex
CREATE INDEX "unhonoured_assignments_status_detected_at_idx" ON "cancellations_sanctions"."unhonoured_assignments"("status", "detected_at");

-- CreateIndex
CREATE INDEX "excusals_assignment_id_created_at_idx" ON "cancellations_sanctions"."excusals"("assignment_id", "created_at");

-- CreateIndex
CREATE INDEX "excusals_status_idx" ON "cancellations_sanctions"."excusals"("status");

-- AddForeignKey
ALTER TABLE "cancellations_sanctions"."unhonoured_assignments" ADD CONSTRAINT "unhonoured_assignments_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "matching"."assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cancellations_sanctions"."excusals" ADD CONSTRAINT "excusals_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "matching"."assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
