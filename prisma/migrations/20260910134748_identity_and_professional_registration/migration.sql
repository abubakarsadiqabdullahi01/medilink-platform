-- CreateEnum
CREATE TYPE "practitioners"."IdentityVerificationMethod" AS ENUM ('MANUAL', 'NIMC');

-- CreateEnum
CREATE TYPE "practitioners"."RegistrationStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'EXPIRED', 'STRUCK_OFF', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "practitioners"."VerificationSource" AS ENUM ('MANUAL', 'REGULATOR_API');

-- CreateTable
CREATE TABLE "practitioners"."identity_verifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "nin_hash" TEXT NOT NULL,
    "nin_last4" TEXT NOT NULL,
    "name_match" BOOLEAN NOT NULL,
    "method" "practitioners"."IdentityVerificationMethod" NOT NULL,
    "verified_by" UUID,
    "verified_at" TIMESTAMP(3) NOT NULL,
    "evidence_retrieved_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "identity_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practitioners"."professional_registrations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "regulator" TEXT NOT NULL,
    "folio_number" TEXT NOT NULL,
    "practice_type" TEXT,
    "registration_status" "practitioners"."RegistrationStatus" NOT NULL,
    "location" TEXT,
    "evidence_retrieved_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3),
    "source" "practitioners"."VerificationSource" NOT NULL,
    "recorded_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "professional_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "identity_verifications_user_id_key" ON "practitioners"."identity_verifications"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "identity_verifications_nin_hash_key" ON "practitioners"."identity_verifications"("nin_hash");

-- CreateIndex
CREATE UNIQUE INDEX "professional_registrations_folio_number_key" ON "practitioners"."professional_registrations"("folio_number");

-- CreateIndex
CREATE INDEX "professional_registrations_registration_status_idx" ON "practitioners"."professional_registrations"("registration_status");

-- CreateIndex
CREATE INDEX "professional_registrations_expires_at_idx" ON "practitioners"."professional_registrations"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "professional_registrations_user_id_regulator_key" ON "practitioners"."professional_registrations"("user_id", "regulator");

-- AddForeignKey
ALTER TABLE "practitioners"."identity_verifications" ADD CONSTRAINT "identity_verifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practitioners"."professional_registrations" ADD CONSTRAINT "professional_registrations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
