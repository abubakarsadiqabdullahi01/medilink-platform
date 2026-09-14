-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "consent";

-- CreateEnum
CREATE TYPE "consent"."AgreementKind" AS ENUM ('PRACTITIONER_ENGAGEMENT', 'FACILITY_TERMS', 'PRIVACY_NOTICE');

-- CreateEnum
CREATE TYPE "consent"."ConsentPurpose" AS ENUM ('IDENTITY_VERIFICATION', 'CREDENTIAL_SHARING', 'PROFILE_VISIBILITY', 'MARKETING');

-- CreateEnum
CREATE TYPE "consent"."LawfulBasis" AS ENUM ('CONSENT', 'CONTRACT', 'LEGAL_OBLIGATION', 'VITAL_INTERESTS');

-- CreateEnum
CREATE TYPE "consent"."DataSubjectRequestKind" AS ENUM ('ACCESS', 'RECTIFICATION', 'ERASURE', 'PORTABILITY', 'RESTRICTION');

-- CreateEnum
CREATE TYPE "consent"."DataSubjectRequestStatus" AS ENUM ('RECEIVED', 'IN_PROGRESS', 'COMPLETED', 'REFUSED');

-- CreateTable
CREATE TABLE "consent"."agreement_versions" (
    "id" UUID NOT NULL,
    "kind" "consent"."AgreementKind" NOT NULL,
    "identifier" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "retired_at" TIMESTAMP(3),
    "published_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agreement_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent"."agreement_acceptances" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "accepted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_address" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "agreement_acceptances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent"."consent_records" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "purpose" "consent"."ConsentPurpose" NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "lawful_basis" "consent"."LawfulBasis" NOT NULL DEFAULT 'CONSENT',
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawn_at" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent"."data_subject_requests" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "consent"."DataSubjectRequestKind" NOT NULL,
    "status" "consent"."DataSubjectRequestStatus" NOT NULL DEFAULT 'RECEIVED',
    "detail" TEXT,
    "outcome" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_by" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "handled_by" UUID,

    CONSTRAINT "data_subject_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agreement_versions_identifier_key" ON "consent"."agreement_versions"("identifier");

-- CreateIndex
CREATE INDEX "agreement_versions_kind_effective_from_idx" ON "consent"."agreement_versions"("kind", "effective_from");

-- CreateIndex
CREATE INDEX "agreement_acceptances_user_id_accepted_at_idx" ON "consent"."agreement_acceptances"("user_id", "accepted_at");

-- CreateIndex
CREATE UNIQUE INDEX "agreement_acceptances_user_id_version_id_key" ON "consent"."agreement_acceptances"("user_id", "version_id");

-- CreateIndex
CREATE INDEX "consent_records_user_id_purpose_granted_at_idx" ON "consent"."consent_records"("user_id", "purpose", "granted_at");

-- CreateIndex
CREATE INDEX "data_subject_requests_status_due_by_idx" ON "consent"."data_subject_requests"("status", "due_by");

-- AddForeignKey
ALTER TABLE "consent"."agreement_acceptances" ADD CONSTRAINT "agreement_acceptances_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent"."agreement_acceptances" ADD CONSTRAINT "agreement_acceptances_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "consent"."agreement_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent"."consent_records" ADD CONSTRAINT "consent_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent"."data_subject_requests" ADD CONSTRAINT "data_subject_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
