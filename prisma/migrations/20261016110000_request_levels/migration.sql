-- REQ-01: a request names the level it is for, and says whether anybody is there to
-- supervise; the pay floor can differ by level. All of it is nothing until compliance
-- defines levels for a profession: a request for one that has none behaves as before.
ALTER TABLE "service_requests"."service_requests" ADD COLUMN "cadre_level_id" UUID;
ALTER TABLE "service_requests"."service_requests" ADD COLUMN "supervision_available" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "service_requests"."service_requests" ADD CONSTRAINT "service_requests_cadre_level_id_fkey" FOREIGN KEY ("cadre_level_id") REFERENCES "config"."cadre_levels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A floor for one level of a profession. `*` is every level, which is what every floor
-- set before this means.
ALTER TABLE "config"."rate_floors" ADD COLUMN "cadre_level_key" TEXT NOT NULL DEFAULT '*';
DROP INDEX "config"."rate_floors_category_key_specialty_key_shift_type_effective_key";
CREATE UNIQUE INDEX "rate_floors_category_key_specialty_key_cadre_level_key_shif_key" ON "config"."rate_floors"("category_key", "specialty_key", "cadre_level_key", "shift_type", "effective_from");
