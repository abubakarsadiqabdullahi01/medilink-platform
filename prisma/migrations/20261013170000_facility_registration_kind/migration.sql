-- FAC-05, UXF-02, UXO-02.
--
-- A facility was registered by its CAC number alone, and government hospitals and
-- primary health centres have none. The same column now holds whatever the
-- facility is registered under, with the kind beside it, and two registries'
-- numbers do not collide. And what an officer checked before approving a facility
-- is kept on the facility.

CREATE TYPE "facilities"."RegistrationKind" AS ENUM ('CAC', 'GOVERNMENT', 'OTHER');

ALTER TABLE "facilities"."facilities"
  ADD COLUMN "registration_kind" "facilities"."RegistrationKind" NOT NULL DEFAULT 'CAC',
  ADD COLUMN "verification_checks" JSONB;

DROP INDEX "facilities"."facilities_cac_number_key";

CREATE UNIQUE INDEX "facilities_registration_kind_cac_number_key"
  ON "facilities"."facilities" ("registration_kind", "cac_number");
