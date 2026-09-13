-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "disputes";

-- CreateEnum
CREATE TYPE "disputes"."DisputeParty" AS ENUM ('PRACTITIONER', 'FACILITY');

-- CreateEnum
CREATE TYPE "disputes"."DisputeCategory" AS ENUM ('HOURS', 'PAY', 'NON_ATTENDANCE', 'CONDUCT', 'OTHER');

-- CreateEnum
CREATE TYPE "disputes"."DisputeStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "disputes"."DisputeOutcome" AS ENUM ('UPHELD', 'DISMISSED');

-- AlterTable
ALTER TABLE "attendance"."attendance_records" ADD COLUMN     "pre_dispute_status" "attendance"."AttendanceState";

-- CreateTable
CREATE TABLE "disputes"."disputes" (
    "id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "raised_by" UUID NOT NULL,
    "raised_party" "disputes"."DisputeParty" NOT NULL,
    "category" "disputes"."DisputeCategory" NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "disputes"."DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "outcome" "disputes"."DisputeOutcome",
    "resolved_by" UUID,
    "resolved_at" TIMESTAMP(3),
    "resolution_notes" TEXT,
    "withdrawn_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "disputes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disputes"."dispute_evidence" (
    "id" UUID NOT NULL,
    "dispute_id" UUID NOT NULL,
    "object_key" TEXT NOT NULL,
    "attached_by" UUID NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispute_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "disputes_assignment_id_created_at_idx" ON "disputes"."disputes"("assignment_id", "created_at");

-- CreateIndex
CREATE INDEX "disputes_status_created_at_idx" ON "disputes"."disputes"("status", "created_at");

-- CreateIndex
CREATE INDEX "dispute_evidence_dispute_id_created_at_idx" ON "disputes"."dispute_evidence"("dispute_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "dispute_evidence_dispute_id_object_key_key" ON "disputes"."dispute_evidence"("dispute_id", "object_key");

-- AddForeignKey
ALTER TABLE "disputes"."disputes" ADD CONSTRAINT "disputes_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "matching"."assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes"."dispute_evidence" ADD CONSTRAINT "dispute_evidence_dispute_id_fkey" FOREIGN KEY ("dispute_id") REFERENCES "disputes"."disputes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
