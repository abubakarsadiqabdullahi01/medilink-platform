-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "credentials";

-- CreateEnum
CREATE TYPE "credentials"."CredentialSubmissionStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateTable
CREATE TABLE "credentials"."credential_submissions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "credential_type_id" UUID NOT NULL,
    "status" "credentials"."CredentialSubmissionStatus" NOT NULL DEFAULT 'PENDING',
    "reference_number" TEXT,
    "document_object_key" TEXT,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMP(3),
    "review_notes" TEXT,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "credential_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "credential_submissions_user_id_credential_type_id_idx" ON "credentials"."credential_submissions"("user_id", "credential_type_id");

-- CreateIndex
CREATE INDEX "credential_submissions_status_idx" ON "credentials"."credential_submissions"("status");

-- AddForeignKey
ALTER TABLE "credentials"."credential_submissions" ADD CONSTRAINT "credential_submissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credentials"."credential_submissions" ADD CONSTRAINT "credential_submissions_credential_type_id_fkey" FOREIGN KEY ("credential_type_id") REFERENCES "config"."credential_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
