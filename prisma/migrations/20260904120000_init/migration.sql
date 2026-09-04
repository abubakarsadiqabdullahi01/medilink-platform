-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "audit";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "config";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "identity";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "storage";

-- CreateEnum
CREATE TYPE "identity"."UserStatus" AS ENUM ('PENDING_VERIFICATION', 'UNDER_REVIEW', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "identity"."ScopeType" AS ENUM ('PLATFORM', 'FACILITY_GROUP', 'FACILITY', 'BRANCH', 'DEPARTMENT', 'SELF');

-- CreateEnum
CREATE TYPE "identity"."OtpPurpose" AS ENUM ('PHONE_VERIFICATION', 'EMAIL_VERIFICATION', 'LOGIN', 'PASSWORD_RESET', 'STEP_UP');

-- CreateEnum
CREATE TYPE "audit"."OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED', 'DEAD_LETTER');

-- CreateTable
CREATE TABLE "identity"."users" (
    "id" UUID NOT NULL,
    "email" TEXT,
    "phone" TEXT NOT NULL,
    "password_hash" TEXT,
    "full_name" TEXT NOT NULL,
    "status" "identity"."UserStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "email_verified_at" TIMESTAMP(3),
    "phone_verified_at" TIMESTAMP(3),
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."roles" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."permissions" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "identity"."user_roles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "scope_type" "identity"."ScopeType" NOT NULL,
    "scope_id" UUID,
    "granted_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "step_up_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."devices" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "label" TEXT,
    "platform" TEXT,
    "push_token" TEXT,
    "last_seen_at" TIMESTAMP(3),
    "trusted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."otp_codes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "purpose" "identity"."OtpPurpose" NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."login_attempts" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "identifier" TEXT NOT NULL,
    "succeeded" BOOLEAN NOT NULL,
    "ip_address" TEXT,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit"."audit_log" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "actor_type" TEXT NOT NULL DEFAULT 'user',
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "scope_type" TEXT,
    "scope_id" UUID,
    "reason" TEXT,
    "before" JSONB,
    "after" JSONB,
    "correlation_id" TEXT,
    "request_id" TEXT,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit"."outbox_events" (
    "id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "correlation_id" TEXT,
    "idempotency_key" TEXT,
    "status" "audit"."OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit"."security_events" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "kind" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "detail" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "config"."professional_categories" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "regulator" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "owner" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "professional_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "config"."specialties" (
    "id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "owner" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "specialties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "config"."credential_types" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "is_mandatory" BOOLEAN NOT NULL DEFAULT false,
    "expires" BOOLEAN NOT NULL DEFAULT true,
    "review_days" INTEGER NOT NULL DEFAULT 365,
    "verification_method" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credential_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "config"."states" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "zone" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "config"."lgas" (
    "id" UUID NOT NULL,
    "state_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lgas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "config"."facility_types" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "regulator" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "facility_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "config"."public_holidays" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "owner" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "public_holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "config"."rate_floors" (
    "id" UUID NOT NULL,
    "category_key" TEXT NOT NULL,
    "specialty_key" TEXT NOT NULL DEFAULT '*',
    "shift_type" TEXT NOT NULL,
    "min_hourly_kobo" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "effective_from" TIMESTAMP(3) NOT NULL,
    "owner" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rate_floors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storage"."stored_objects" (
    "id" UUID NOT NULL,
    "bucket" TEXT NOT NULL,
    "object_key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "checksum_sha256" TEXT,
    "purpose" TEXT NOT NULL,
    "owner_user_id" UUID,
    "scope_type" TEXT,
    "scope_id" UUID,
    "uploaded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "stored_objects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "identity"."users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "identity"."users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "roles_key_key" ON "identity"."roles"("key");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "identity"."permissions"("key");

-- CreateIndex
CREATE INDEX "user_roles_user_id_revoked_at_idx" ON "identity"."user_roles"("user_id", "revoked_at");

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_user_id_role_id_scope_type_scope_id_key" ON "identity"."user_roles"("user_id", "role_id", "scope_type", "scope_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "identity"."sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_expires_at_idx" ON "identity"."sessions"("user_id", "expires_at");

-- CreateIndex
CREATE INDEX "otp_codes_user_id_purpose_consumed_at_idx" ON "identity"."otp_codes"("user_id", "purpose", "consumed_at");

-- CreateIndex
CREATE INDEX "login_attempts_identifier_created_at_idx" ON "identity"."login_attempts"("identifier", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_entity_type_entity_id_idx" ON "audit"."audit_log"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_log_actor_id_created_at_idx" ON "audit"."audit_log"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_correlation_id_idx" ON "audit"."audit_log"("correlation_id");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_events_idempotency_key_key" ON "audit"."outbox_events"("idempotency_key");

-- CreateIndex
CREATE INDEX "outbox_events_status_available_at_idx" ON "audit"."outbox_events"("status", "available_at");

-- CreateIndex
CREATE INDEX "security_events_kind_created_at_idx" ON "audit"."security_events"("kind", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "professional_categories_key_key" ON "config"."professional_categories"("key");

-- CreateIndex
CREATE UNIQUE INDEX "specialties_key_key" ON "config"."specialties"("key");

-- CreateIndex
CREATE UNIQUE INDEX "credential_types_key_key" ON "config"."credential_types"("key");

-- CreateIndex
CREATE UNIQUE INDEX "states_code_key" ON "config"."states"("code");

-- CreateIndex
CREATE UNIQUE INDEX "lgas_state_id_name_key" ON "config"."lgas"("state_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "facility_types_key_key" ON "config"."facility_types"("key");

-- CreateIndex
CREATE UNIQUE INDEX "public_holidays_date_name_key" ON "config"."public_holidays"("date", "name");

-- CreateIndex
CREATE UNIQUE INDEX "rate_floors_category_key_specialty_key_shift_type_effective_key" ON "config"."rate_floors"("category_key", "specialty_key", "shift_type", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "stored_objects_object_key_key" ON "storage"."stored_objects"("object_key");

-- CreateIndex
CREATE INDEX "stored_objects_owner_user_id_purpose_idx" ON "storage"."stored_objects"("owner_user_id", "purpose");

-- AddForeignKey
ALTER TABLE "identity"."role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "identity"."roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "identity"."permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "identity"."roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."devices" ADD CONSTRAINT "devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."otp_codes" ADD CONSTRAINT "otp_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."login_attempts" ADD CONSTRAINT "login_attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "config"."specialties" ADD CONSTRAINT "specialties_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "config"."professional_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "config"."lgas" ADD CONSTRAINT "lgas_state_id_fkey" FOREIGN KEY ("state_id") REFERENCES "config"."states"("id") ON DELETE CASCADE ON UPDATE CASCADE;

