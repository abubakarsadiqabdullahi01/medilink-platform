-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "availability";

-- CreateEnum
CREATE TYPE "practitioners"."TravelPreference" AS ENUM ('SAME_LGA', 'SAME_STATE', 'ANYWHERE');

-- CreateEnum
CREATE TYPE "availability"."AvailabilityKind" AS ENUM ('RECURRING_WEEKLY', 'ONE_OFF');

-- AlterTable
ALTER TABLE "practitioners"."practitioner_profiles" ADD COLUMN     "home_lga_id" UUID,
ADD COLUMN     "travel_preference" "practitioners"."TravelPreference" NOT NULL DEFAULT 'SAME_STATE';

-- CreateTable
CREATE TABLE "availability"."availability_slots" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "availability"."AvailabilityKind" NOT NULL,
    "day_of_week" INTEGER,
    "start_minute" INTEGER,
    "end_minute" INTEGER,
    "effective_from" TIMESTAMP(3),
    "effective_until" TIMESTAMP(3),
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "availability_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "availability"."blocked_periods" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "blocked_periods_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "availability_slots_user_id_kind_idx" ON "availability"."availability_slots"("user_id", "kind");

-- CreateIndex
CREATE INDEX "blocked_periods_user_id_starts_at_idx" ON "availability"."blocked_periods"("user_id", "starts_at");

-- AddForeignKey
ALTER TABLE "practitioners"."practitioner_profiles" ADD CONSTRAINT "practitioner_profiles_home_lga_id_fkey" FOREIGN KEY ("home_lga_id") REFERENCES "config"."lgas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability"."availability_slots" ADD CONSTRAINT "availability_slots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability"."blocked_periods" ADD CONSTRAINT "blocked_periods_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
