-- CreateEnum
CREATE TYPE "audit"."ScheduledJobStatus" AS ENUM ('SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "audit"."scheduled_jobs" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "interval_seconds" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "next_run_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_run_at" TIMESTAMP(3),
    "last_status" "audit"."ScheduledJobStatus",
    "last_error" TEXT,
    "last_duration_ms" INTEGER,
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "run_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "scheduled_jobs_key_key" ON "audit"."scheduled_jobs"("key");

-- CreateIndex
CREATE INDEX "scheduled_jobs_enabled_next_run_at_idx" ON "audit"."scheduled_jobs"("enabled", "next_run_at");
