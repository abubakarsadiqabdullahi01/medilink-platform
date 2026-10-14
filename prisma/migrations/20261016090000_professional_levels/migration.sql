-- CFG-04: the lists the level model is built on. A house officer and a consultant were
-- the same person to the platform, and a request could not say which it wanted. These
-- ship empty: what the levels are is the regulators' to say and compliance's to enter.

-- CreateTable
CREATE TABLE "config"."cadre_levels" (
    "id" UUID NOT NULL,
    "professional_category_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "owner" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cadre_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "config"."registration_categories" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "supervision_required" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "owner" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registration_categories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cadre_levels_key_key" ON "config"."cadre_levels"("key");

-- CreateIndex
CREATE UNIQUE INDEX "cadre_levels_professional_category_id_rank_key" ON "config"."cadre_levels"("professional_category_id", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "registration_categories_key_key" ON "config"."registration_categories"("key");

-- AddForeignKey
ALTER TABLE "config"."cadre_levels" ADD CONSTRAINT "cadre_levels_professional_category_id_fkey" FOREIGN KEY ("professional_category_id") REFERENCES "config"."professional_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
