-- CreateEnum
CREATE TYPE "config"."SanctionSourceList" AS ENUM ('MDCN_QUACK_LIST', 'MDCN_SANCTIONS', 'INTERNAL');

-- CreateEnum
CREATE TYPE "practitioners"."ScreeningStatus" AS ENUM ('PENDING', 'CLEAR', 'FLAGGED');

-- CreateTable
CREATE TABLE "config"."sanctioned_entries" (
    "id" UUID NOT NULL,
    "source_list" "config"."SanctionSourceList" NOT NULL,
    "full_name" TEXT NOT NULL,
    "normalised_name" TEXT NOT NULL,
    "folio_number" TEXT,
    "reason" TEXT,
    "listed_at" TIMESTAMP(3) NOT NULL,
    "owner" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sanctioned_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practitioners"."screening_results" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "practitioners"."ScreeningStatus" NOT NULL,
    "matched_entry_id" UUID,
    "matched_on" TEXT,
    "screened_at" TIMESTAMP(3) NOT NULL,
    "cleared_by" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "screening_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sanctioned_entries_normalised_name_idx" ON "config"."sanctioned_entries"("normalised_name");

-- CreateIndex
CREATE INDEX "sanctioned_entries_folio_number_idx" ON "config"."sanctioned_entries"("folio_number");

-- CreateIndex
CREATE UNIQUE INDEX "screening_results_user_id_key" ON "practitioners"."screening_results"("user_id");

-- CreateIndex
CREATE INDEX "screening_results_status_idx" ON "practitioners"."screening_results"("status");

-- AddForeignKey
ALTER TABLE "practitioners"."screening_results" ADD CONSTRAINT "screening_results_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practitioners"."screening_results" ADD CONSTRAINT "screening_results_matched_entry_id_fkey" FOREIGN KEY ("matched_entry_id") REFERENCES "config"."sanctioned_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
