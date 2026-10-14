-- Sends were limited per phone number only, which is no limit on somebody with a
-- list of numbers. Counting per source and overall needs the address on the row
-- and an index on how recently it was sent.

-- AlterTable
ALTER TABLE "identity"."otp_codes" ADD COLUMN "request_ip" TEXT;

-- CreateIndex
CREATE INDEX "otp_codes_request_ip_created_at_idx" ON "identity"."otp_codes"("request_ip", "created_at");

-- CreateIndex
CREATE INDEX "otp_codes_created_at_idx" ON "identity"."otp_codes"("created_at");
