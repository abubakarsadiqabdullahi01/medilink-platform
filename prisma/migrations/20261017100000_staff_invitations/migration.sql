-- M04-06: an invitation to work for a facility, answered by the person invited.
-- Bound to the number the facility typed rather than to an account, because the person may not
-- have registered yet. Accepting creates the grant; this table confers nothing by itself.

-- CreateEnum
CREATE TYPE "identity"."StaffInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'EXPIRED');

-- CreateTable
CREATE TABLE "identity"."staff_invitations" (
    "id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "role_key" TEXT NOT NULL,
    "invited_by" UUID NOT NULL,
    "status" "identity"."StaffInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "responded_at" TIMESTAMP(3),
    "responded_by" UUID,
    "grant_id" UUID,
    "sms_sent_at" TIMESTAMP(3),
    "sms_failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "staff_invitations_facility_id_status_created_at_idx" ON "identity"."staff_invitations"("facility_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "staff_invitations_phone_status_idx" ON "identity"."staff_invitations"("phone", "status");

-- CreateIndex
CREATE INDEX "staff_invitations_phone_created_at_idx" ON "identity"."staff_invitations"("phone", "created_at");

-- CreateIndex
CREATE INDEX "staff_invitations_invited_by_created_at_idx" ON "identity"."staff_invitations"("invited_by", "created_at");

-- AddForeignKey
ALTER TABLE "identity"."staff_invitations" ADD CONSTRAINT "staff_invitations_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "facilities"."facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."staff_invitations" ADD CONSTRAINT "staff_invitations_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "identity"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One invitation still waiting per facility, number and role. The database refuses a second, so two
-- owners inviting the same person at the same moment cannot both send a text. Prisma cannot express
-- a partial index.
CREATE UNIQUE INDEX "staff_invitations_one_pending"
  ON "identity"."staff_invitations" ("facility_id", "phone", "role_key")
  WHERE "status" = 'PENDING';
