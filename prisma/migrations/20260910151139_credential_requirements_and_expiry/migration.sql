-- AlterEnum
ALTER TYPE "credentials"."CredentialSubmissionStatus" ADD VALUE 'EXPIRED';

-- CreateTable
CREATE TABLE "config"."credential_requirements" (
    "id" UUID NOT NULL,
    "professional_category_id" UUID NOT NULL,
    "credential_type_id" UUID NOT NULL,
    "is_mandatory" BOOLEAN NOT NULL DEFAULT true,
    "owner" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credential_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "credential_requirements_professional_category_id_is_mandato_idx" ON "config"."credential_requirements"("professional_category_id", "is_mandatory");

-- CreateIndex
CREATE UNIQUE INDEX "credential_requirements_professional_category_id_credential_key" ON "config"."credential_requirements"("professional_category_id", "credential_type_id");

-- AddForeignKey
ALTER TABLE "config"."credential_requirements" ADD CONSTRAINT "credential_requirements_professional_category_id_fkey" FOREIGN KEY ("professional_category_id") REFERENCES "config"."professional_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "config"."credential_requirements" ADD CONSTRAINT "credential_requirements_credential_type_id_fkey" FOREIGN KEY ("credential_type_id") REFERENCES "config"."credential_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;
