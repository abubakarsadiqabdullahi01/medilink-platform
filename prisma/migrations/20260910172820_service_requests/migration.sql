-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "service_requests";

-- CreateEnum
CREATE TYPE "service_requests"."ShiftType" AS ENUM ('DAY', 'NIGHT');

-- CreateEnum
CREATE TYPE "service_requests"."RequestUrgency" AS ENUM ('ROUTINE', 'URGENT', 'EMERGENCY');

-- CreateEnum
CREATE TYPE "service_requests"."ServiceRequestStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'FILLED', 'CANCELLED', 'EXPIRED');

-- CreateTable
CREATE TABLE "service_requests"."service_requests" (
    "id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "professional_category_id" UUID NOT NULL,
    "specialty_id" UUID,
    "shift_type" "service_requests"."ShiftType" NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "headcount" INTEGER NOT NULL DEFAULT 1,
    "hourly_rate_kobo" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "urgency" "service_requests"."RequestUrgency" NOT NULL DEFAULT 'ROUTINE',
    "cancellation_terms" TEXT NOT NULL,
    "notes" TEXT,
    "status" "service_requests"."ServiceRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "created_by" UUID NOT NULL,
    "published_by" UUID,
    "published_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancellation_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "service_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "service_requests_status_starts_at_idx" ON "service_requests"."service_requests"("status", "starts_at");

-- CreateIndex
CREATE INDEX "service_requests_facility_id_status_idx" ON "service_requests"."service_requests"("facility_id", "status");

-- AddForeignKey
ALTER TABLE "service_requests"."service_requests" ADD CONSTRAINT "service_requests_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "facilities"."facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests"."service_requests" ADD CONSTRAINT "service_requests_professional_category_id_fkey" FOREIGN KEY ("professional_category_id") REFERENCES "config"."professional_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests"."service_requests" ADD CONSTRAINT "service_requests_specialty_id_fkey" FOREIGN KEY ("specialty_id") REFERENCES "config"."specialties"("id") ON DELETE SET NULL ON UPDATE CASCADE;
