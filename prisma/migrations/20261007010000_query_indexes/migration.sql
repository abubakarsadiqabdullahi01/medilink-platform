-- CreateIndex
CREATE INDEX "audit_log_created_at_id_idx" ON "audit"."audit_log"("created_at", "id");

-- CreateIndex
CREATE INDEX "audit_log_scope_type_scope_id_created_at_id_idx" ON "audit"."audit_log"("scope_type", "scope_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "messages_user_id_kind_related_id_idx" ON "notifications"."messages"("user_id", "kind", "related_id");
