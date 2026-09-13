-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "attendance";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "timesheets";

-- CreateEnum
CREATE TYPE "attendance"."AttendanceState" AS ENUM ('NOT_STARTED', 'CHECK_IN_PENDING', 'CHECKED_IN', 'CHECKED_OUT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'DISPUTED', 'MANUALLY_CORRECTED');

-- CreateEnum
CREATE TYPE "attendance"."CheckInEventKind" AS ENUM ('CHECK_IN', 'CHECK_OUT');

-- CreateEnum
CREATE TYPE "attendance"."CheckInMethod" AS ENUM ('SUPERVISOR_CODE', 'QR', 'MANUAL');

-- CreateTable
CREATE TABLE "attendance"."attendance_records" (
    "id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "status" "attendance"."AttendanceState" NOT NULL DEFAULT 'NOT_STARTED',
    "checked_in_at" TIMESTAMP(3),
    "checked_out_at" TIMESTAMP(3),
    "break_minutes" INTEGER NOT NULL DEFAULT 0,
    "submitted_at" TIMESTAMP(3),
    "submitted_by" UUID,
    "reviewed_at" TIMESTAMP(3),
    "reviewed_by" UUID,
    "review_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance"."checkin_events" (
    "id" UUID NOT NULL,
    "attendance_record_id" UUID NOT NULL,
    "kind" "attendance"."CheckInEventKind" NOT NULL,
    "method" "attendance"."CheckInMethod" NOT NULL,
    "actor_id" UUID NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,
    "device_label" TEXT,

    CONSTRAINT "checkin_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance"."checkin_tokens" (
    "id" UUID NOT NULL,
    "attendance_record_id" UUID NOT NULL,
    "purpose" "attendance"."CheckInEventKind" NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumed_at" TIMESTAMP(3),
    "issued_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checkin_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timesheets"."timesheets" (
    "id" UUID NOT NULL,
    "attendance_record_id" UUID NOT NULL,
    "worked_minutes" INTEGER NOT NULL,
    "break_minutes" INTEGER NOT NULL,
    "billable_minutes" INTEGER NOT NULL,
    "night_minutes" INTEGER NOT NULL,
    "overtime_minutes" INTEGER NOT NULL,
    "holiday_minutes" INTEGER NOT NULL,
    "on_call_minutes" INTEGER NOT NULL DEFAULT 0,
    "hourly_rate_kobo" INTEGER NOT NULL,
    "amount_kobo" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "timesheets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timesheets"."timesheet_revisions" (
    "id" UUID NOT NULL,
    "timesheet_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "previous" JSONB NOT NULL,
    "actor_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "timesheet_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_assignment_id_key" ON "attendance"."attendance_records"("assignment_id");

-- CreateIndex
CREATE INDEX "attendance_records_status_idx" ON "attendance"."attendance_records"("status");

-- CreateIndex
CREATE INDEX "checkin_events_attendance_record_id_recorded_at_idx" ON "attendance"."checkin_events"("attendance_record_id", "recorded_at");

-- CreateIndex
CREATE INDEX "checkin_tokens_attendance_record_id_purpose_consumed_at_idx" ON "attendance"."checkin_tokens"("attendance_record_id", "purpose", "consumed_at");

-- CreateIndex
CREATE UNIQUE INDEX "timesheets_attendance_record_id_key" ON "timesheets"."timesheets"("attendance_record_id");

-- CreateIndex
CREATE INDEX "timesheet_revisions_timesheet_id_created_at_idx" ON "timesheets"."timesheet_revisions"("timesheet_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "timesheet_revisions_timesheet_id_revision_key" ON "timesheets"."timesheet_revisions"("timesheet_id", "revision");

-- AddForeignKey
ALTER TABLE "attendance"."attendance_records" ADD CONSTRAINT "attendance_records_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "matching"."assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance"."checkin_events" ADD CONSTRAINT "checkin_events_attendance_record_id_fkey" FOREIGN KEY ("attendance_record_id") REFERENCES "attendance"."attendance_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance"."checkin_events" ADD CONSTRAINT "checkin_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "identity"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance"."checkin_tokens" ADD CONSTRAINT "checkin_tokens_attendance_record_id_fkey" FOREIGN KEY ("attendance_record_id") REFERENCES "attendance"."attendance_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheets"."timesheets" ADD CONSTRAINT "timesheets_attendance_record_id_fkey" FOREIGN KEY ("attendance_record_id") REFERENCES "attendance"."attendance_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheets"."timesheet_revisions" ADD CONSTRAINT "timesheet_revisions_timesheet_id_fkey" FOREIGN KEY ("timesheet_id") REFERENCES "timesheets"."timesheets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
