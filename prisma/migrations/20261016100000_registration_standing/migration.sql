-- PRA-01, PRA-02: where a practitioner stands, recorded against the registration the
-- officer checked. Null until somebody records it.
ALTER TABLE "practitioners"."professional_registrations" ADD COLUMN "cadre_level_id" UUID;
ALTER TABLE "practitioners"."professional_registrations" ADD COLUMN "registration_category_id" UUID;

ALTER TABLE "practitioners"."professional_registrations" ADD CONSTRAINT "professional_registrations_cadre_level_id_fkey" FOREIGN KEY ("cadre_level_id") REFERENCES "config"."cadre_levels"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "practitioners"."professional_registrations" ADD CONSTRAINT "professional_registrations_registration_category_id_fkey" FOREIGN KEY ("registration_category_id") REFERENCES "config"."registration_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
