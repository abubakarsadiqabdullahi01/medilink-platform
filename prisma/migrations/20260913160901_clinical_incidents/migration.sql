-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "clinical_incidents";

-- CreateEnum
CREATE TYPE "clinical_incidents"."IncidentSeverity" AS ENUM ('NEAR_MISS', 'MINOR', 'MODERATE', 'SEVERE', 'DEATH');

-- CreateEnum
CREATE TYPE "clinical_incidents"."IncidentCategory" AS ENUM ('MEDICATION', 'CLINICAL_PROCEDURE', 'DOCUMENTATION', 'INFECTION_CONTROL', 'EQUIPMENT', 'STAFFING', 'CONDUCT', 'OTHER');

-- CreateEnum
CREATE TYPE "clinical_incidents"."IncidentStatus" AS ENUM ('REPORTED', 'UNDER_REVIEW', 'CLOSED');

-- CreateEnum
CREATE TYPE "clinical_incidents"."IncidentOutcome" AS ENUM ('SYSTEM_ISSUE', 'NO_ACTION', 'ADVICE_GIVEN', 'TRAINING_REQUIRED', 'PRACTITIONER_SUSPENDED', 'REFERRED_TO_REGULATOR');

-- CreateTable
CREATE TABLE "clinical_incidents"."clinical_incidents" (
    "id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "assignment_id" UUID,
    "subject_user_id" UUID,
    "reported_by" UUID NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "reported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "severity" "clinical_incidents"."IncidentSeverity" NOT NULL,
    "category" "clinical_incidents"."IncidentCategory" NOT NULL,
    "summary" TEXT NOT NULL,
    "status" "clinical_incidents"."IncidentStatus" NOT NULL DEFAULT 'REPORTED',
    "outcome" "clinical_incidents"."IncidentOutcome",
    "closed_by" UUID,
    "closed_at" TIMESTAMP(3),
    "closure_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinical_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinical_incidents"."incident_attachments" (
    "id" UUID NOT NULL,
    "incident_id" UUID NOT NULL,
    "object_key" TEXT NOT NULL,
    "attached_by" UUID NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incident_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinical_incidents"."account_suspensions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "suspended_by" UUID NOT NULL,
    "suspended_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "incident_id" UUID,
    "lifted_by" UUID,
    "lifted_at" TIMESTAMP(3),
    "lifted_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_suspensions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "clinical_incidents_facility_id_reported_at_idx" ON "clinical_incidents"."clinical_incidents"("facility_id", "reported_at");

-- CreateIndex
CREATE INDEX "clinical_incidents_subject_user_id_reported_at_idx" ON "clinical_incidents"."clinical_incidents"("subject_user_id", "reported_at");

-- CreateIndex
CREATE INDEX "clinical_incidents_status_severity_idx" ON "clinical_incidents"."clinical_incidents"("status", "severity");

-- CreateIndex
CREATE INDEX "incident_attachments_incident_id_created_at_idx" ON "clinical_incidents"."incident_attachments"("incident_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "incident_attachments_incident_id_object_key_key" ON "clinical_incidents"."incident_attachments"("incident_id", "object_key");

-- CreateIndex
CREATE INDEX "account_suspensions_user_id_suspended_at_idx" ON "clinical_incidents"."account_suspensions"("user_id", "suspended_at");

-- CreateIndex
CREATE INDEX "account_suspensions_lifted_at_idx" ON "clinical_incidents"."account_suspensions"("lifted_at");

-- AddForeignKey
ALTER TABLE "clinical_incidents"."clinical_incidents" ADD CONSTRAINT "clinical_incidents_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "facilities"."facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_incidents"."clinical_incidents" ADD CONSTRAINT "clinical_incidents_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "matching"."assignments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_incidents"."incident_attachments" ADD CONSTRAINT "incident_attachments_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "clinical_incidents"."clinical_incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_incidents"."account_suspensions" ADD CONSTRAINT "account_suspensions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
