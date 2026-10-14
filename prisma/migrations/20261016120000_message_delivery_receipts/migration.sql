-- M16-05: a message records which gateway took it and the id that gateway gave it, whether a
-- second gateway had to take over, and what the gateway reported afterwards. All of it is
-- null for the messages that exist: nothing is claimed about them.
ALTER TABLE "notifications"."messages" ADD COLUMN "provider" TEXT;
ALTER TABLE "notifications"."messages" ADD COLUMN "provider_message_id" TEXT;
ALTER TABLE "notifications"."messages" ADD COLUMN "failed_over_from" TEXT;
ALTER TABLE "notifications"."messages" ADD COLUMN "delivery_status" TEXT;
ALTER TABLE "notifications"."messages" ADD COLUMN "delivery_reported_at" TIMESTAMP(3);
ALTER TABLE "notifications"."messages" ADD COLUMN "delivery_detail" TEXT;

-- A report finds its message by the gateway and the id the gateway gave it.
CREATE INDEX "messages_provider_provider_message_id_idx" ON "notifications"."messages"("provider", "provider_message_id");
