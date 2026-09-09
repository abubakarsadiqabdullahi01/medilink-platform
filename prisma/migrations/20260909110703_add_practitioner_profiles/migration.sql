-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "practitioners";

-- CreateTable
CREATE TABLE "practitioners"."practitioner_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "professional_category_id" UUID NOT NULL,
    "specialty_id" UUID,
    "years_of_experience" INTEGER NOT NULL,
    "bio" TEXT,
    "photo_object_key" TEXT,
    "home_state_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "practitioner_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "practitioner_profiles_user_id_key" ON "practitioners"."practitioner_profiles"("user_id");

-- AddForeignKey
ALTER TABLE "practitioners"."practitioner_profiles" ADD CONSTRAINT "practitioner_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practitioners"."practitioner_profiles" ADD CONSTRAINT "practitioner_profiles_professional_category_id_fkey" FOREIGN KEY ("professional_category_id") REFERENCES "config"."professional_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practitioners"."practitioner_profiles" ADD CONSTRAINT "practitioner_profiles_specialty_id_fkey" FOREIGN KEY ("specialty_id") REFERENCES "config"."specialties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practitioners"."practitioner_profiles" ADD CONSTRAINT "practitioner_profiles_home_state_id_fkey" FOREIGN KEY ("home_state_id") REFERENCES "config"."states"("id") ON DELETE SET NULL ON UPDATE CASCADE;
