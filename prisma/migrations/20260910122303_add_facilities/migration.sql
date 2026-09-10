-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "facilities";

-- CreateEnum
CREATE TYPE "facilities"."FacilityStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED', 'SUSPENDED');

-- CreateTable
CREATE TABLE "facilities"."facilities" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "facility_type_id" UUID NOT NULL,
    "cac_number" TEXT NOT NULL,
    "state_id" UUID NOT NULL,
    "lga_id" UUID,
    "address_line" TEXT NOT NULL,
    "contact_phone" TEXT NOT NULL,
    "contact_email" TEXT,
    "representative_user_id" UUID NOT NULL,
    "status" "facilities"."FacilityStatus" NOT NULL DEFAULT 'PENDING',
    "licence_number" TEXT,
    "licence_object_key" TEXT,
    "licence_expires_at" TIMESTAMP(3),
    "verified_by" UUID,
    "verified_at" TIMESTAMP(3),
    "review_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "facilities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "facilities_cac_number_key" ON "facilities"."facilities"("cac_number");

-- CreateIndex
CREATE INDEX "facilities_status_idx" ON "facilities"."facilities"("status");

-- CreateIndex
CREATE INDEX "facilities_state_id_status_idx" ON "facilities"."facilities"("state_id", "status");

-- CreateIndex
CREATE INDEX "facilities_representative_user_id_idx" ON "facilities"."facilities"("representative_user_id");

-- AddForeignKey
ALTER TABLE "facilities"."facilities" ADD CONSTRAINT "facilities_facility_type_id_fkey" FOREIGN KEY ("facility_type_id") REFERENCES "config"."facility_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facilities"."facilities" ADD CONSTRAINT "facilities_state_id_fkey" FOREIGN KEY ("state_id") REFERENCES "config"."states"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facilities"."facilities" ADD CONSTRAINT "facilities_lga_id_fkey" FOREIGN KEY ("lga_id") REFERENCES "config"."lgas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facilities"."facilities" ADD CONSTRAINT "facilities_representative_user_id_fkey" FOREIGN KEY ("representative_user_id") REFERENCES "identity"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
