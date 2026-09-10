-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "matching";

-- CreateEnum
CREATE TYPE "matching"."InvitationStatus" AS ENUM ('INVITED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "matching"."AssignmentStatus" AS ENUM ('CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW');

-- CreateTable
CREATE TABLE "matching"."match_runs" (
    "id" UUID NOT NULL,
    "service_request_id" UUID NOT NULL,
    "run_by" UUID,
    "considered_count" INTEGER NOT NULL,
    "ranked_count" INTEGER NOT NULL,
    "weights" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "match_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matching"."match_candidates" (
    "id" UUID NOT NULL,
    "match_run_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "rank" INTEGER,
    "score" DOUBLE PRECISION,
    "factors" JSONB,
    "exclusions" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "match_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matching"."invitations" (
    "id" UUID NOT NULL,
    "service_request_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "match_run_id" UUID,
    "status" "matching"."InvitationStatus" NOT NULL DEFAULT 'INVITED',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "responded_at" TIMESTAMP(3),
    "decline_reason" TEXT,
    "invited_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matching"."assignments" (
    "id" UUID NOT NULL,
    "service_request_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "status" "matching"."AssignmentStatus" NOT NULL DEFAULT 'CONFIRMED',
    "confirmed_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matching"."assignment_status_history" (
    "id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "from_status" "matching"."AssignmentStatus",
    "to_status" "matching"."AssignmentStatus" NOT NULL,
    "actor_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assignment_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "match_runs_service_request_id_created_at_idx" ON "matching"."match_runs"("service_request_id", "created_at");

-- CreateIndex
CREATE INDEX "match_candidates_match_run_id_rank_idx" ON "matching"."match_candidates"("match_run_id", "rank");

-- CreateIndex
CREATE INDEX "invitations_user_id_status_idx" ON "matching"."invitations"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_service_request_id_user_id_key" ON "matching"."invitations"("service_request_id", "user_id");

-- CreateIndex
CREATE INDEX "assignments_user_id_starts_at_ends_at_idx" ON "matching"."assignments"("user_id", "starts_at", "ends_at");

-- CreateIndex
CREATE INDEX "assignments_facility_id_starts_at_idx" ON "matching"."assignments"("facility_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "assignments_service_request_id_user_id_key" ON "matching"."assignments"("service_request_id", "user_id");

-- CreateIndex
CREATE INDEX "assignment_status_history_assignment_id_created_at_idx" ON "matching"."assignment_status_history"("assignment_id", "created_at");

-- AddForeignKey
ALTER TABLE "matching"."match_runs" ADD CONSTRAINT "match_runs_service_request_id_fkey" FOREIGN KEY ("service_request_id") REFERENCES "service_requests"."service_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matching"."match_candidates" ADD CONSTRAINT "match_candidates_match_run_id_fkey" FOREIGN KEY ("match_run_id") REFERENCES "matching"."match_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matching"."assignments" ADD CONSTRAINT "assignments_service_request_id_fkey" FOREIGN KEY ("service_request_id") REFERENCES "service_requests"."service_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matching"."assignments" ADD CONSTRAINT "assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matching"."assignment_status_history" ADD CONSTRAINT "assignment_status_history_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "matching"."assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
