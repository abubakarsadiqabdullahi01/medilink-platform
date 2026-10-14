-- UXP-01: an in-app inbox. read_at is when the person opened a message; null is
-- unread. What was sent before the inbox existed is stamped as read, so nobody
-- opens it to a count of every text they ever received.
ALTER TABLE "notifications"."messages" ADD COLUMN "read_at" TIMESTAMP(3);
UPDATE "notifications"."messages" SET "read_at" = "created_at" WHERE "read_at" IS NULL;
CREATE INDEX "messages_user_id_read_at_created_at_idx" ON "notifications"."messages"("user_id", "read_at", "created_at");
