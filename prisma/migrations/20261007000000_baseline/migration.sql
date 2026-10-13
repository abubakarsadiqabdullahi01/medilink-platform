-- Preserved migration: 20260904120000_init
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



-- Preserved migration: 20260909110703_add_practitioner_profiles
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "practitioners";

-- CreateTable
CREATE TABLE "practitioners"."practitioner_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "professional_category_id" UUID NOT NULL,
    "specialty_id" UUID,
    "years_of_experience" INTEGER NOT NULL,
    "bio" TEXT,
    "photo_object_key" TEXT,
    "home_state_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "practitioner_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "practitioner_profiles_user_id_key" ON "practitioners"."practitioner_profiles"("user_id");

-- AddForeignKey
ALTER TABLE "practitioners"."practitioner_profiles" ADD CONSTRAINT "practitioner_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practitioners"."practitioner_profiles" ADD CONSTRAINT "practitioner_profiles_professional_category_id_fkey" FOREIGN KEY ("professional_category_id") REFERENCES "config"."professional_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practitioners"."practitioner_profiles" ADD CONSTRAINT "practitioner_profiles_specialty_id_fkey" FOREIGN KEY ("specialty_id") REFERENCES "config"."specialties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practitioners"."practitioner_profiles" ADD CONSTRAINT "practitioner_profiles_home_state_id_fkey" FOREIGN KEY ("home_state_id") REFERENCES "config"."states"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Preserved migration: 20260909153004_add_credential_submissions
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "credentials";

-- CreateEnum
CREATE TYPE "credentials"."CredentialSubmissionStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateTable
CREATE TABLE "credentials"."credential_submissions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "credential_type_id" UUID NOT NULL,
    "status" "credentials"."CredentialSubmissionStatus" NOT NULL DEFAULT 'PENDING',
    "reference_number" TEXT,
    "document_object_key" TEXT,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMP(3),
    "review_notes" TEXT,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "credential_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "credential_submissions_user_id_credential_type_id_idx" ON "credentials"."credential_submissions"("user_id", "credential_type_id");

-- CreateIndex
CREATE INDEX "credential_submissions_status_idx" ON "credentials"."credential_submissions"("status");

-- AddForeignKey
ALTER TABLE "credentials"."credential_submissions" ADD CONSTRAINT "credential_submissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credentials"."credential_submissions" ADD CONSTRAINT "credential_submissions_credential_type_id_fkey" FOREIGN KEY ("credential_type_id") REFERENCES "config"."credential_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Preserved migration: 20260910122303_add_facilities
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "facilities";

-- CreateEnum
CREATE TYPE "facilities"."FacilityStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED', 'SUSPENDED');

-- CreateTable
CREATE TABLE "facilities"."facilities" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "facility_type_id" UUID NOT NULL,
    "cac_number" TEXT NOT NULL,
    "state_id" UUID NOT NULL,
    "lga_id" UUID,
    "address_line" TEXT NOT NULL,
    "contact_phone" TEXT NOT NULL,
    "contact_email" TEXT,
    "representative_user_id" UUID NOT NULL,
    "status" "facilities"."FacilityStatus" NOT NULL DEFAULT 'PENDING',
    "licence_number" TEXT,
    "licence_object_key" TEXT,
    "licence_expires_at" TIMESTAMP(3),
    "verified_by" UUID,
    "verified_at" TIMESTAMP(3),
    "review_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "facilities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "facilities_cac_number_key" ON "facilities"."facilities"("cac_number");

-- CreateIndex
CREATE INDEX "facilities_status_idx" ON "facilities"."facilities"("status");

-- CreateIndex
CREATE INDEX "facilities_state_id_status_idx" ON "facilities"."facilities"("state_id", "status");

-- CreateIndex
CREATE INDEX "facilities_representative_user_id_idx" ON "facilities"."facilities"("representative_user_id");

-- AddForeignKey
ALTER TABLE "facilities"."facilities" ADD CONSTRAINT "facilities_facility_type_id_fkey" FOREIGN KEY ("facility_type_id") REFERENCES "config"."facility_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facilities"."facilities" ADD CONSTRAINT "facilities_state_id_fkey" FOREIGN KEY ("state_id") REFERENCES "config"."states"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facilities"."facilities" ADD CONSTRAINT "facilities_lga_id_fkey" FOREIGN KEY ("lga_id") REFERENCES "config"."lgas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facilities"."facilities" ADD CONSTRAINT "facilities_representative_user_id_fkey" FOREIGN KEY ("representative_user_id") REFERENCES "identity"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Preserved migration: 20260910132355_add_scheduled_jobs
-- CreateEnum
CREATE TYPE "audit"."ScheduledJobStatus" AS ENUM ('SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "audit"."scheduled_jobs" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "interval_seconds" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "next_run_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_run_at" TIMESTAMP(3),
    "last_status" "audit"."ScheduledJobStatus",
    "last_error" TEXT,
    "last_duration_ms" INTEGER,
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "run_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "scheduled_jobs_key_key" ON "audit"."scheduled_jobs"("key");

-- CreateIndex
CREATE INDEX "scheduled_jobs_enabled_next_run_at_idx" ON "audit"."scheduled_jobs"("enabled", "next_run_at");


-- Preserved migration: 20260910133516_credential_more_info_requested
-- AlterEnum
ALTER TYPE "credentials"."CredentialSubmissionStatus" ADD VALUE 'MORE_INFO_REQUESTED';


-- Preserved migration: 20260910134748_identity_and_professional_registration
-- CreateEnum
CREATE TYPE "practitioners"."IdentityVerificationMethod" AS ENUM ('MANUAL', 'NIMC');

-- CreateEnum
CREATE TYPE "practitioners"."RegistrationStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'EXPIRED', 'STRUCK_OFF', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "practitioners"."VerificationSource" AS ENUM ('MANUAL', 'REGULATOR_API');

-- CreateTable
CREATE TABLE "practitioners"."identity_verifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "nin_hash" TEXT NOT NULL,
    "nin_last4" TEXT NOT NULL,
    "name_match" BOOLEAN NOT NULL,
    "method" "practitioners"."IdentityVerificationMethod" NOT NULL,
    "verified_by" UUID,
    "verified_at" TIMESTAMP(3) NOT NULL,
    "evidence_retrieved_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "identity_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practitioners"."professional_registrations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "regulator" TEXT NOT NULL,
    "folio_number" TEXT NOT NULL,
    "practice_type" TEXT,
    "registration_status" "practitioners"."RegistrationStatus" NOT NULL,
    "location" TEXT,
    "evidence_retrieved_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3),
    "source" "practitioners"."VerificationSource" NOT NULL,
    "recorded_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "professional_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "identity_verifications_user_id_key" ON "practitioners"."identity_verifications"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "identity_verifications_nin_hash_key" ON "practitioners"."identity_verifications"("nin_hash");

-- CreateIndex
CREATE UNIQUE INDEX "professional_registrations_folio_number_key" ON "practitioners"."professional_registrations"("folio_number");

-- CreateIndex
CREATE INDEX "professional_registrations_registration_status_idx" ON "practitioners"."professional_registrations"("registration_status");

-- CreateIndex
CREATE INDEX "professional_registrations_expires_at_idx" ON "practitioners"."professional_registrations"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "professional_registrations_user_id_regulator_key" ON "practitioners"."professional_registrations"("user_id", "regulator");

-- AddForeignKey
ALTER TABLE "practitioners"."identity_verifications" ADD CONSTRAINT "identity_verifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practitioners"."professional_registrations" ADD CONSTRAINT "professional_registrations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Preserved migration: 20260910140909_sanctions_screening
-- CreateEnum
CREATE TYPE "config"."SanctionSourceList" AS ENUM ('MDCN_QUACK_LIST', 'MDCN_SANCTIONS', 'INTERNAL');

-- CreateEnum
CREATE TYPE "practitioners"."ScreeningStatus" AS ENUM ('PENDING', 'CLEAR', 'FLAGGED');

-- CreateTable
CREATE TABLE "config"."sanctioned_entries" (
    "id" UUID NOT NULL,
    "source_list" "config"."SanctionSourceList" NOT NULL,
    "full_name" TEXT NOT NULL,
    "normalised_name" TEXT NOT NULL,
    "folio_number" TEXT,
    "reason" TEXT,
    "listed_at" TIMESTAMP(3) NOT NULL,
    "owner" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sanctioned_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practitioners"."screening_results" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "practitioners"."ScreeningStatus" NOT NULL,
    "matched_entry_id" UUID,
    "matched_on" TEXT,
    "screened_at" TIMESTAMP(3) NOT NULL,
    "cleared_by" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "screening_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sanctioned_entries_normalised_name_idx" ON "config"."sanctioned_entries"("normalised_name");

-- CreateIndex
CREATE INDEX "sanctioned_entries_folio_number_idx" ON "config"."sanctioned_entries"("folio_number");

-- CreateIndex
CREATE UNIQUE INDEX "screening_results_user_id_key" ON "practitioners"."screening_results"("user_id");

-- CreateIndex
CREATE INDEX "screening_results_status_idx" ON "practitioners"."screening_results"("status");

-- AddForeignKey
ALTER TABLE "practitioners"."screening_results" ADD CONSTRAINT "screening_results_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practitioners"."screening_results" ADD CONSTRAINT "screening_results_matched_entry_id_fkey" FOREIGN KEY ("matched_entry_id") REFERENCES "config"."sanctioned_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Preserved migration: 20260910151139_credential_requirements_and_expiry
-- AlterEnum
ALTER TYPE "credentials"."CredentialSubmissionStatus" ADD VALUE 'EXPIRED';

-- CreateTable
CREATE TABLE "config"."credential_requirements" (
    "id" UUID NOT NULL,
    "professional_category_id" UUID NOT NULL,
    "credential_type_id" UUID NOT NULL,
    "is_mandatory" BOOLEAN NOT NULL DEFAULT true,
    "owner" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credential_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "credential_requirements_professional_category_id_is_mandato_idx" ON "config"."credential_requirements"("professional_category_id", "is_mandatory");

-- CreateIndex
CREATE UNIQUE INDEX "credential_requirements_professional_category_id_credential_key" ON "config"."credential_requirements"("professional_category_id", "credential_type_id");

-- AddForeignKey
ALTER TABLE "config"."credential_requirements" ADD CONSTRAINT "credential_requirements_professional_category_id_fkey" FOREIGN KEY ("professional_category_id") REFERENCES "config"."professional_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "config"."credential_requirements" ADD CONSTRAINT "credential_requirements_credential_type_id_fkey" FOREIGN KEY ("credential_type_id") REFERENCES "config"."credential_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Preserved migration: 20260910171214_availability
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "availability";

-- CreateEnum
CREATE TYPE "practitioners"."TravelPreference" AS ENUM ('SAME_LGA', 'SAME_STATE', 'ANYWHERE');

-- CreateEnum
CREATE TYPE "availability"."AvailabilityKind" AS ENUM ('RECURRING_WEEKLY', 'ONE_OFF');

-- AlterTable
ALTER TABLE "practitioners"."practitioner_profiles" ADD COLUMN     "home_lga_id" UUID,
ADD COLUMN     "travel_preference" "practitioners"."TravelPreference" NOT NULL DEFAULT 'SAME_STATE';

-- CreateTable
CREATE TABLE "availability"."availability_slots" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "availability"."AvailabilityKind" NOT NULL,
    "day_of_week" INTEGER,
    "start_minute" INTEGER,
    "end_minute" INTEGER,
    "effective_from" TIMESTAMP(3),
    "effective_until" TIMESTAMP(3),
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "availability_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "availability"."blocked_periods" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "blocked_periods_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "availability_slots_user_id_kind_idx" ON "availability"."availability_slots"("user_id", "kind");

-- CreateIndex
CREATE INDEX "blocked_periods_user_id_starts_at_idx" ON "availability"."blocked_periods"("user_id", "starts_at");

-- AddForeignKey
ALTER TABLE "practitioners"."practitioner_profiles" ADD CONSTRAINT "practitioner_profiles_home_lga_id_fkey" FOREIGN KEY ("home_lga_id") REFERENCES "config"."lgas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability"."availability_slots" ADD CONSTRAINT "availability_slots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability"."blocked_periods" ADD CONSTRAINT "blocked_periods_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Preserved migration: 20260910172820_service_requests
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "service_requests";

-- CreateEnum
CREATE TYPE "service_requests"."ShiftType" AS ENUM ('DAY', 'NIGHT');

-- CreateEnum
CREATE TYPE "service_requests"."RequestUrgency" AS ENUM ('ROUTINE', 'URGENT', 'EMERGENCY');

-- CreateEnum
CREATE TYPE "service_requests"."ServiceRequestStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'FILLED', 'CANCELLED', 'EXPIRED');

-- CreateTable
CREATE TABLE "service_requests"."service_requests" (
    "id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "professional_category_id" UUID NOT NULL,
    "specialty_id" UUID,
    "shift_type" "service_requests"."ShiftType" NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "headcount" INTEGER NOT NULL DEFAULT 1,
    "hourly_rate_kobo" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "urgency" "service_requests"."RequestUrgency" NOT NULL DEFAULT 'ROUTINE',
    "cancellation_terms" TEXT NOT NULL,
    "notes" TEXT,
    "status" "service_requests"."ServiceRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "created_by" UUID NOT NULL,
    "published_by" UUID,
    "published_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancellation_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "service_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "service_requests_status_starts_at_idx" ON "service_requests"."service_requests"("status", "starts_at");

-- CreateIndex
CREATE INDEX "service_requests_facility_id_status_idx" ON "service_requests"."service_requests"("facility_id", "status");

-- AddForeignKey
ALTER TABLE "service_requests"."service_requests" ADD CONSTRAINT "service_requests_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "facilities"."facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests"."service_requests" ADD CONSTRAINT "service_requests_professional_category_id_fkey" FOREIGN KEY ("professional_category_id") REFERENCES "config"."professional_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests"."service_requests" ADD CONSTRAINT "service_requests_specialty_id_fkey" FOREIGN KEY ("specialty_id") REFERENCES "config"."specialties"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Preserved migration: 20260910174836_matching_and_assignments
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "matching";

-- CreateEnum
CREATE TYPE "matching"."InvitationStatus" AS ENUM ('INVITED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "matching"."AssignmentStatus" AS ENUM ('CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW');

-- CreateTable
CREATE TABLE "matching"."match_runs" (
    "id" UUID NOT NULL,
    "service_request_id" UUID NOT NULL,
    "run_by" UUID,
    "considered_count" INTEGER NOT NULL,
    "ranked_count" INTEGER NOT NULL,
    "weights" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "match_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matching"."match_candidates" (
    "id" UUID NOT NULL,
    "match_run_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "rank" INTEGER,
    "score" DOUBLE PRECISION,
    "factors" JSONB,
    "exclusions" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "match_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matching"."invitations" (
    "id" UUID NOT NULL,
    "service_request_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "match_run_id" UUID,
    "status" "matching"."InvitationStatus" NOT NULL DEFAULT 'INVITED',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "responded_at" TIMESTAMP(3),
    "decline_reason" TEXT,
    "invited_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matching"."assignments" (
    "id" UUID NOT NULL,
    "service_request_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "status" "matching"."AssignmentStatus" NOT NULL DEFAULT 'CONFIRMED',
    "confirmed_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matching"."assignment_status_history" (
    "id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "from_status" "matching"."AssignmentStatus",
    "to_status" "matching"."AssignmentStatus" NOT NULL,
    "actor_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assignment_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "match_runs_service_request_id_created_at_idx" ON "matching"."match_runs"("service_request_id", "created_at");

-- CreateIndex
CREATE INDEX "match_candidates_match_run_id_rank_idx" ON "matching"."match_candidates"("match_run_id", "rank");

-- CreateIndex
CREATE INDEX "invitations_user_id_status_idx" ON "matching"."invitations"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_service_request_id_user_id_key" ON "matching"."invitations"("service_request_id", "user_id");

-- CreateIndex
CREATE INDEX "assignments_user_id_starts_at_ends_at_idx" ON "matching"."assignments"("user_id", "starts_at", "ends_at");

-- CreateIndex
CREATE INDEX "assignments_facility_id_starts_at_idx" ON "matching"."assignments"("facility_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "assignments_service_request_id_user_id_key" ON "matching"."assignments"("service_request_id", "user_id");

-- CreateIndex
CREATE INDEX "assignment_status_history_assignment_id_created_at_idx" ON "matching"."assignment_status_history"("assignment_id", "created_at");

-- AddForeignKey
ALTER TABLE "matching"."match_runs" ADD CONSTRAINT "match_runs_service_request_id_fkey" FOREIGN KEY ("service_request_id") REFERENCES "service_requests"."service_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matching"."match_candidates" ADD CONSTRAINT "match_candidates_match_run_id_fkey" FOREIGN KEY ("match_run_id") REFERENCES "matching"."match_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matching"."assignments" ADD CONSTRAINT "assignments_service_request_id_fkey" FOREIGN KEY ("service_request_id") REFERENCES "service_requests"."service_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matching"."assignments" ADD CONSTRAINT "assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matching"."assignment_status_history" ADD CONSTRAINT "assignment_status_history_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "matching"."assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Preserved migration: 20260910182004_notifications
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "notifications";

-- CreateTable
CREATE TABLE "notifications"."messages" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "related_type" TEXT,
    "related_id" UUID,
    "sent_at" TIMESTAMP(3),
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "messages_user_id_created_at_idx" ON "notifications"."messages"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "messages_related_type_related_id_idx" ON "notifications"."messages"("related_type", "related_id");


-- Preserved migration: 20260913110757_attendance_and_timesheets
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "attendance";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "timesheets";

-- CreateEnum
CREATE TYPE "attendance"."AttendanceState" AS ENUM ('NOT_STARTED', 'CHECK_IN_PENDING', 'CHECKED_IN', 'CHECKED_OUT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'DISPUTED', 'MANUALLY_CORRECTED');

-- CreateEnum
CREATE TYPE "attendance"."CheckInEventKind" AS ENUM ('CHECK_IN', 'CHECK_OUT');

-- CreateEnum
CREATE TYPE "attendance"."CheckInMethod" AS ENUM ('SUPERVISOR_CODE', 'QR', 'MANUAL');

-- CreateTable
CREATE TABLE "attendance"."attendance_records" (
    "id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "status" "attendance"."AttendanceState" NOT NULL DEFAULT 'NOT_STARTED',
    "checked_in_at" TIMESTAMP(3),
    "checked_out_at" TIMESTAMP(3),
    "break_minutes" INTEGER NOT NULL DEFAULT 0,
    "submitted_at" TIMESTAMP(3),
    "submitted_by" UUID,
    "reviewed_at" TIMESTAMP(3),
    "reviewed_by" UUID,
    "review_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance"."checkin_events" (
    "id" UUID NOT NULL,
    "attendance_record_id" UUID NOT NULL,
    "kind" "attendance"."CheckInEventKind" NOT NULL,
    "method" "attendance"."CheckInMethod" NOT NULL,
    "actor_id" UUID NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,
    "device_label" TEXT,

    CONSTRAINT "checkin_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance"."checkin_tokens" (
    "id" UUID NOT NULL,
    "attendance_record_id" UUID NOT NULL,
    "purpose" "attendance"."CheckInEventKind" NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumed_at" TIMESTAMP(3),
    "issued_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checkin_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timesheets"."timesheets" (
    "id" UUID NOT NULL,
    "attendance_record_id" UUID NOT NULL,
    "worked_minutes" INTEGER NOT NULL,
    "break_minutes" INTEGER NOT NULL,
    "billable_minutes" INTEGER NOT NULL,
    "night_minutes" INTEGER NOT NULL,
    "overtime_minutes" INTEGER NOT NULL,
    "holiday_minutes" INTEGER NOT NULL,
    "on_call_minutes" INTEGER NOT NULL DEFAULT 0,
    "hourly_rate_kobo" INTEGER NOT NULL,
    "amount_kobo" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "timesheets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timesheets"."timesheet_revisions" (
    "id" UUID NOT NULL,
    "timesheet_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "previous" JSONB NOT NULL,
    "actor_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "timesheet_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_assignment_id_key" ON "attendance"."attendance_records"("assignment_id");

-- CreateIndex
CREATE INDEX "attendance_records_status_idx" ON "attendance"."attendance_records"("status");

-- CreateIndex
CREATE INDEX "checkin_events_attendance_record_id_recorded_at_idx" ON "attendance"."checkin_events"("attendance_record_id", "recorded_at");

-- CreateIndex
CREATE INDEX "checkin_tokens_attendance_record_id_purpose_consumed_at_idx" ON "attendance"."checkin_tokens"("attendance_record_id", "purpose", "consumed_at");

-- CreateIndex
CREATE UNIQUE INDEX "timesheets_attendance_record_id_key" ON "timesheets"."timesheets"("attendance_record_id");

-- CreateIndex
CREATE INDEX "timesheet_revisions_timesheet_id_created_at_idx" ON "timesheets"."timesheet_revisions"("timesheet_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "timesheet_revisions_timesheet_id_revision_key" ON "timesheets"."timesheet_revisions"("timesheet_id", "revision");

-- AddForeignKey
ALTER TABLE "attendance"."attendance_records" ADD CONSTRAINT "attendance_records_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "matching"."assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance"."checkin_events" ADD CONSTRAINT "checkin_events_attendance_record_id_fkey" FOREIGN KEY ("attendance_record_id") REFERENCES "attendance"."attendance_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance"."checkin_events" ADD CONSTRAINT "checkin_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "identity"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance"."checkin_tokens" ADD CONSTRAINT "checkin_tokens_attendance_record_id_fkey" FOREIGN KEY ("attendance_record_id") REFERENCES "attendance"."attendance_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheets"."timesheets" ADD CONSTRAINT "timesheets_attendance_record_id_fkey" FOREIGN KEY ("attendance_record_id") REFERENCES "attendance"."attendance_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheets"."timesheet_revisions" ADD CONSTRAINT "timesheet_revisions_timesheet_id_fkey" FOREIGN KEY ("timesheet_id") REFERENCES "timesheets"."timesheets"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Preserved migration: 20260913125901_unhonoured_assignments_and_excusals
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "cancellations_sanctions";

-- CreateEnum
CREATE TYPE "cancellations_sanctions"."UnhonouredStatus" AS ENUM ('AWAITING_DECISION', 'CLOSED');

-- CreateEnum
CREATE TYPE "cancellations_sanctions"."Fault" AS ENUM ('PRACTITIONER', 'FACILITY', 'NEITHER');

-- CreateEnum
CREATE TYPE "cancellations_sanctions"."ExcusalStatus" AS ENUM ('REQUESTED', 'GRANTED', 'REFUSED');

-- CreateTable
CREATE TABLE "cancellations_sanctions"."unhonoured_assignments" (
    "id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "shift_ended_at" TIMESTAMP(3) NOT NULL,
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "cancellations_sanctions"."UnhonouredStatus" NOT NULL DEFAULT 'AWAITING_DECISION',
    "fault" "cancellations_sanctions"."Fault",
    "decided_by" UUID,
    "decided_at" TIMESTAMP(3),
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "unhonoured_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cancellations_sanctions"."excusals" (
    "id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "requested_by" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "cancellations_sanctions"."ExcusalStatus" NOT NULL DEFAULT 'REQUESTED',
    "decided_by" UUID,
    "decided_at" TIMESTAMP(3),
    "decision_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "excusals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "unhonoured_assignments_assignment_id_key" ON "cancellations_sanctions"."unhonoured_assignments"("assignment_id");

-- CreateIndex
CREATE INDEX "unhonoured_assignments_status_detected_at_idx" ON "cancellations_sanctions"."unhonoured_assignments"("status", "detected_at");

-- CreateIndex
CREATE INDEX "excusals_assignment_id_created_at_idx" ON "cancellations_sanctions"."excusals"("assignment_id", "created_at");

-- CreateIndex
CREATE INDEX "excusals_status_idx" ON "cancellations_sanctions"."excusals"("status");

-- AddForeignKey
ALTER TABLE "cancellations_sanctions"."unhonoured_assignments" ADD CONSTRAINT "unhonoured_assignments_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "matching"."assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cancellations_sanctions"."excusals" ADD CONSTRAINT "excusals_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "matching"."assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Preserved migration: 20260913133803_disputes
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "disputes";

-- CreateEnum
CREATE TYPE "disputes"."DisputeParty" AS ENUM ('PRACTITIONER', 'FACILITY');

-- CreateEnum
CREATE TYPE "disputes"."DisputeCategory" AS ENUM ('HOURS', 'PAY', 'NON_ATTENDANCE', 'CONDUCT', 'OTHER');

-- CreateEnum
CREATE TYPE "disputes"."DisputeStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "disputes"."DisputeOutcome" AS ENUM ('UPHELD', 'DISMISSED');

-- AlterTable
ALTER TABLE "attendance"."attendance_records" ADD COLUMN     "pre_dispute_status" "attendance"."AttendanceState";

-- CreateTable
CREATE TABLE "disputes"."disputes" (
    "id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "raised_by" UUID NOT NULL,
    "raised_party" "disputes"."DisputeParty" NOT NULL,
    "category" "disputes"."DisputeCategory" NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "disputes"."DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "outcome" "disputes"."DisputeOutcome",
    "resolved_by" UUID,
    "resolved_at" TIMESTAMP(3),
    "resolution_notes" TEXT,
    "withdrawn_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "disputes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disputes"."dispute_evidence" (
    "id" UUID NOT NULL,
    "dispute_id" UUID NOT NULL,
    "object_key" TEXT NOT NULL,
    "attached_by" UUID NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispute_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "disputes_assignment_id_created_at_idx" ON "disputes"."disputes"("assignment_id", "created_at");

-- CreateIndex
CREATE INDEX "disputes_status_created_at_idx" ON "disputes"."disputes"("status", "created_at");

-- CreateIndex
CREATE INDEX "dispute_evidence_dispute_id_created_at_idx" ON "disputes"."dispute_evidence"("dispute_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "dispute_evidence_dispute_id_object_key_key" ON "disputes"."dispute_evidence"("dispute_id", "object_key");

-- AddForeignKey
ALTER TABLE "disputes"."disputes" ADD CONSTRAINT "disputes_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "matching"."assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes"."dispute_evidence" ADD CONSTRAINT "dispute_evidence_dispute_id_fkey" FOREIGN KEY ("dispute_id") REFERENCES "disputes"."disputes"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Preserved migration: 20260913160901_clinical_incidents
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "clinical_incidents";

-- CreateEnum
CREATE TYPE "clinical_incidents"."IncidentSeverity" AS ENUM ('NEAR_MISS', 'MINOR', 'MODERATE', 'SEVERE', 'DEATH');

-- CreateEnum
CREATE TYPE "clinical_incidents"."IncidentCategory" AS ENUM ('MEDICATION', 'CLINICAL_PROCEDURE', 'DOCUMENTATION', 'INFECTION_CONTROL', 'EQUIPMENT', 'STAFFING', 'CONDUCT', 'OTHER');

-- CreateEnum
CREATE TYPE "clinical_incidents"."IncidentStatus" AS ENUM ('REPORTED', 'UNDER_REVIEW', 'CLOSED');

-- CreateEnum
CREATE TYPE "clinical_incidents"."IncidentOutcome" AS ENUM ('SYSTEM_ISSUE', 'NO_ACTION', 'ADVICE_GIVEN', 'TRAINING_REQUIRED', 'PRACTITIONER_SUSPENDED', 'REFERRED_TO_REGULATOR');

-- CreateTable
CREATE TABLE "clinical_incidents"."clinical_incidents" (
    "id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "assignment_id" UUID,
    "subject_user_id" UUID,
    "reported_by" UUID NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "reported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "severity" "clinical_incidents"."IncidentSeverity" NOT NULL,
    "category" "clinical_incidents"."IncidentCategory" NOT NULL,
    "summary" TEXT NOT NULL,
    "status" "clinical_incidents"."IncidentStatus" NOT NULL DEFAULT 'REPORTED',
    "outcome" "clinical_incidents"."IncidentOutcome",
    "closed_by" UUID,
    "closed_at" TIMESTAMP(3),
    "closure_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinical_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinical_incidents"."incident_attachments" (
    "id" UUID NOT NULL,
    "incident_id" UUID NOT NULL,
    "object_key" TEXT NOT NULL,
    "attached_by" UUID NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incident_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinical_incidents"."account_suspensions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "suspended_by" UUID NOT NULL,
    "suspended_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "incident_id" UUID,
    "lifted_by" UUID,
    "lifted_at" TIMESTAMP(3),
    "lifted_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_suspensions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "clinical_incidents_facility_id_reported_at_idx" ON "clinical_incidents"."clinical_incidents"("facility_id", "reported_at");

-- CreateIndex
CREATE INDEX "clinical_incidents_subject_user_id_reported_at_idx" ON "clinical_incidents"."clinical_incidents"("subject_user_id", "reported_at");

-- CreateIndex
CREATE INDEX "clinical_incidents_status_severity_idx" ON "clinical_incidents"."clinical_incidents"("status", "severity");

-- CreateIndex
CREATE INDEX "incident_attachments_incident_id_created_at_idx" ON "clinical_incidents"."incident_attachments"("incident_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "incident_attachments_incident_id_object_key_key" ON "clinical_incidents"."incident_attachments"("incident_id", "object_key");

-- CreateIndex
CREATE INDEX "account_suspensions_user_id_suspended_at_idx" ON "clinical_incidents"."account_suspensions"("user_id", "suspended_at");

-- CreateIndex
CREATE INDEX "account_suspensions_lifted_at_idx" ON "clinical_incidents"."account_suspensions"("lifted_at");

-- AddForeignKey
ALTER TABLE "clinical_incidents"."clinical_incidents" ADD CONSTRAINT "clinical_incidents_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "facilities"."facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_incidents"."clinical_incidents" ADD CONSTRAINT "clinical_incidents_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "matching"."assignments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_incidents"."incident_attachments" ADD CONSTRAINT "incident_attachments_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "clinical_incidents"."clinical_incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_incidents"."account_suspensions" ADD CONSTRAINT "account_suspensions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Preserved migration: 20260913171100_suggestions
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "suggestions";

-- CreateEnum
CREATE TYPE "suggestions"."SuggestionSource" AS ENUM ('USER', 'DECLINE_REASON');

-- CreateEnum
CREATE TYPE "suggestions"."SuggestionArea" AS ENUM ('ONBOARDING', 'CREDENTIALS', 'MATCHING', 'SCHEDULING', 'ATTENDANCE', 'TIMESHEETS', 'PAYMENTS', 'SUPPORT', 'OTHER');

-- CreateEnum
CREATE TYPE "suggestions"."SuggestionStatus" AS ENUM ('NEW', 'TRIAGED', 'PLANNED', 'DONE', 'DECLINED');

-- CreateTable
CREATE TABLE "suggestions"."suggestions" (
    "id" UUID NOT NULL,
    "source" "suggestions"."SuggestionSource" NOT NULL DEFAULT 'USER',
    "raised_by" UUID,
    "area" "suggestions"."SuggestionArea" NOT NULL,
    "body" TEXT NOT NULL,
    "source_ref" TEXT,
    "status" "suggestions"."SuggestionStatus" NOT NULL DEFAULT 'NEW',
    "triaged_by" UUID,
    "triaged_at" TIMESTAMP(3),
    "response" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "suggestions_status_created_at_idx" ON "suggestions"."suggestions"("status", "created_at");

-- CreateIndex
CREATE INDEX "suggestions_area_created_at_idx" ON "suggestions"."suggestions"("area", "created_at");


-- Preserved migration: 20260914093251_rates_and_billing
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "billing";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "rates";

-- CreateEnum
CREATE TYPE "rates"."RateCardStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "billing"."InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "billing"."PayoutStatus" AS ENUM ('PREPARED', 'RELEASED', 'SETTLED', 'FAILED');

-- CreateTable
CREATE TABLE "rates"."rate_cards" (
    "id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "night_multiplier_bp" INTEGER NOT NULL DEFAULT 10000,
    "holiday_multiplier_bp" INTEGER NOT NULL DEFAULT 10000,
    "overtime_multiplier_bp" INTEGER NOT NULL DEFAULT 10000,
    "on_call_multiplier_bp" INTEGER NOT NULL DEFAULT 10000,
    "status" "rates"."RateCardStatus" NOT NULL DEFAULT 'DRAFT',
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_until" TIMESTAMP(3),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."invoices" (
    "id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "gross_kobo" INTEGER NOT NULL,
    "platform_fee_kobo" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "status" "billing"."InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "issued_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."invoice_lines" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "rate_card_id" UUID,
    "practitioner_id" UUID NOT NULL,
    "hourly_rate_kobo" INTEGER NOT NULL,
    "ordinary_minutes" INTEGER NOT NULL,
    "night_minutes" INTEGER NOT NULL,
    "holiday_minutes" INTEGER NOT NULL,
    "overtime_minutes" INTEGER NOT NULL,
    "on_call_minutes" INTEGER NOT NULL,
    "base_kobo" INTEGER NOT NULL,
    "premium_kobo" INTEGER NOT NULL,
    "amount_kobo" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."ledger_entries" (
    "id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "account" TEXT NOT NULL,
    "amount_kobo" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "subject_id" UUID,
    "memo" TEXT NOT NULL,
    "invoice_id" UUID,
    "payout_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."payouts" (
    "id" UUID NOT NULL,
    "practitioner_id" UUID NOT NULL,
    "amount_kobo" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "status" "billing"."PayoutStatus" NOT NULL DEFAULT 'PREPARED',
    "provider_reference" TEXT,
    "failure_reason" TEXT,
    "released_by" UUID,
    "released_at" TIMESTAMP(3),
    "settled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rate_cards_facility_id_status_effective_from_idx" ON "rates"."rate_cards"("facility_id", "status", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_number_key" ON "billing"."invoices"("number");

-- CreateIndex
CREATE INDEX "invoices_facility_id_status_idx" ON "billing"."invoices"("facility_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_lines_assignment_id_key" ON "billing"."invoice_lines"("assignment_id");

-- CreateIndex
CREATE INDEX "invoice_lines_invoice_id_idx" ON "billing"."invoice_lines"("invoice_id");

-- CreateIndex
CREATE INDEX "ledger_entries_transaction_id_idx" ON "billing"."ledger_entries"("transaction_id");

-- CreateIndex
CREATE INDEX "ledger_entries_account_subject_id_idx" ON "billing"."ledger_entries"("account", "subject_id");

-- CreateIndex
CREATE INDEX "payouts_practitioner_id_status_idx" ON "billing"."payouts"("practitioner_id", "status");

-- AddForeignKey
ALTER TABLE "rates"."rate_cards" ADD CONSTRAINT "rate_cards_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "facilities"."facilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."invoices" ADD CONSTRAINT "invoices_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "facilities"."facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "billing"."invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."payouts" ADD CONSTRAINT "payouts_practitioner_id_fkey" FOREIGN KEY ("practitioner_id") REFERENCES "identity"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Preserved migration: 20260914141002_consent_and_compliance
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "consent";

-- CreateEnum
CREATE TYPE "consent"."AgreementKind" AS ENUM ('PRACTITIONER_ENGAGEMENT', 'FACILITY_TERMS', 'PRIVACY_NOTICE');

-- CreateEnum
CREATE TYPE "consent"."ConsentPurpose" AS ENUM ('IDENTITY_VERIFICATION', 'CREDENTIAL_SHARING', 'PROFILE_VISIBILITY', 'MARKETING');

-- CreateEnum
CREATE TYPE "consent"."LawfulBasis" AS ENUM ('CONSENT', 'CONTRACT', 'LEGAL_OBLIGATION', 'VITAL_INTERESTS');

-- CreateEnum
CREATE TYPE "consent"."DataSubjectRequestKind" AS ENUM ('ACCESS', 'RECTIFICATION', 'ERASURE', 'PORTABILITY', 'RESTRICTION');

-- CreateEnum
CREATE TYPE "consent"."DataSubjectRequestStatus" AS ENUM ('RECEIVED', 'IN_PROGRESS', 'COMPLETED', 'REFUSED');

-- CreateTable
CREATE TABLE "consent"."agreement_versions" (
    "id" UUID NOT NULL,
    "kind" "consent"."AgreementKind" NOT NULL,
    "identifier" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "retired_at" TIMESTAMP(3),
    "published_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agreement_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent"."agreement_acceptances" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "accepted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_address" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "agreement_acceptances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent"."consent_records" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "purpose" "consent"."ConsentPurpose" NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "lawful_basis" "consent"."LawfulBasis" NOT NULL DEFAULT 'CONSENT',
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawn_at" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent"."data_subject_requests" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "consent"."DataSubjectRequestKind" NOT NULL,
    "status" "consent"."DataSubjectRequestStatus" NOT NULL DEFAULT 'RECEIVED',
    "detail" TEXT,
    "outcome" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_by" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "handled_by" UUID,

    CONSTRAINT "data_subject_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agreement_versions_identifier_key" ON "consent"."agreement_versions"("identifier");

-- CreateIndex
CREATE INDEX "agreement_versions_kind_effective_from_idx" ON "consent"."agreement_versions"("kind", "effective_from");

-- CreateIndex
CREATE INDEX "agreement_acceptances_user_id_accepted_at_idx" ON "consent"."agreement_acceptances"("user_id", "accepted_at");

-- CreateIndex
CREATE UNIQUE INDEX "agreement_acceptances_user_id_version_id_key" ON "consent"."agreement_acceptances"("user_id", "version_id");

-- CreateIndex
CREATE INDEX "consent_records_user_id_purpose_granted_at_idx" ON "consent"."consent_records"("user_id", "purpose", "granted_at");

-- CreateIndex
CREATE INDEX "data_subject_requests_status_due_by_idx" ON "consent"."data_subject_requests"("status", "due_by");

-- AddForeignKey
ALTER TABLE "consent"."agreement_acceptances" ADD CONSTRAINT "agreement_acceptances_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent"."agreement_acceptances" ADD CONSTRAINT "agreement_acceptances_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "consent"."agreement_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent"."consent_records" ADD CONSTRAINT "consent_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent"."data_subject_requests" ADD CONSTRAINT "data_subject_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Preserved migration: 20261004120000_merge_roles
-- Nine roles become five.
--
-- Operations, compliance and finance each held an overlapping slice of the
-- platform side; a facility had an administrator, a scheduler and a finance
-- officer who between them could not complete one shift without handing it
-- to each other. See src/lib/authz/permissions.ts for why.
--
-- Nobody loses a permission. The replacement role is a superset of the one it
-- replaces in every case, and src/lib/authz/roles.test.ts asserts that against
-- the pre-merge bundles so this stays true if a bundle is edited later.
--
-- Written as data SQL rather than left to the seed because the seed is not run
-- on a deployed database, and a live grant pointing at a role that no longer
-- exists would sign somebody out of their own console.

-- The role rows themselves are upserted by prisma/seed.ts from
-- ROLE_PERMISSIONS, but a deployed database needs `administrator` to exist
-- before the grants below can point at it.
INSERT INTO identity.roles (id, key, name, created_at)
VALUES (gen_random_uuid(), 'administrator', 'administrator', now())
ON CONFLICT (key) DO NOTHING;

INSERT INTO identity.roles (id, key, name, created_at)
VALUES (gen_random_uuid(), 'facility_administrator', 'facility_administrator', now())
ON CONFLICT (key) DO NOTHING;

-- Repoint every live grant at its replacement.
--
-- `WHERE NOT EXISTS` rather than a bare UPDATE: somebody holding two of the
-- merged roles at the same scope — a compliance officer who also did finance,
-- which was common enough to be the reason for this merge — would otherwise
-- collide on unique(user_id, role_id, scope_type, scope_id). The duplicates
-- are deleted afterwards instead.
WITH mapping(old_key, new_key) AS (
  VALUES
    ('operations_officer',       'administrator'),
    ('compliance_officer',       'administrator'),
    ('finance_officer',          'administrator'),
    ('facility_scheduler',       'facility_administrator'),
    ('facility_finance_officer', 'facility_administrator')
)
UPDATE identity.user_roles AS ur
SET role_id = new_role.id
FROM mapping
JOIN identity.roles AS old_role ON old_role.key = mapping.old_key
JOIN identity.roles AS new_role ON new_role.key = mapping.new_key
WHERE ur.role_id = old_role.id
  AND NOT EXISTS (
    SELECT 1
    FROM identity.user_roles AS existing
    WHERE existing.user_id = ur.user_id
      AND existing.role_id = new_role.id
      AND existing.scope_type = ur.scope_type
      AND existing.scope_id IS NOT DISTINCT FROM ur.scope_id
  );

-- Whatever is left pointing at a retired role is a duplicate of a grant the
-- step above already made, so dropping it takes nothing away from anybody.
DELETE FROM identity.user_roles AS ur
USING identity.roles AS r
WHERE ur.role_id = r.id
  AND r.key IN (
    'operations_officer', 'compliance_officer', 'finance_officer',
    'facility_scheduler', 'facility_finance_officer'
  );

-- The retired roles themselves. role_permissions cascades from the role.
DELETE FROM identity.roles
WHERE key IN (
  'operations_officer', 'compliance_officer', 'finance_officer',
  'facility_scheduler', 'facility_finance_officer'
);


-- Preserved migration: 20261004150000_administrator_may_appoint
-- An administrator may appoint another administrator.
--
-- `role.grant` was held back when the nine roles became five, on the reading
-- that growing the set of people who can act on the whole platform should be
-- the super administrator's act alone. In practice that makes onboarding a
-- colleague a request to one person, and the ceiling it was protecting is
-- already enforced somewhere better: `grantRole` refuses to hand out any
-- permission the granting actor does not themselves hold.
--
-- So an administrator can now create administrators, facility owners and
-- practitioners — and is still refused `super_administrator`, because that
-- bundle carries `config.manage` and they have not got it. The rule holds for
-- roles nobody has written yet, which a hard-coded list would not.
--
-- `role.grant` is a step-up permission, so appointing somebody costs a
-- password re-entry. See STEP_UP_PERMISSIONS in src/lib/authz/permissions.ts.
--
-- Written as a migration as well as in the seed because role_permissions is
-- reference data: a deployed database runs `migrate deploy`, not `db:seed`,
-- and without this the console would offer a Staff screen the API refused.
INSERT INTO identity.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM identity.roles AS r
CROSS JOIN identity.permissions AS p
WHERE r.key = 'administrator'
  AND p.key = 'role.grant'
ON CONFLICT (role_id, permission_id) DO NOTHING;


-- Preserved migration: 20261004170000_one_live_grant
-- One live grant per person, role and scope.
--
-- `@@unique([userId, roleId, scopeType, scopeId])` has been on the model
-- since Stage 4 and does not do what it looks like it does: PostgreSQL treats
-- NULLs as distinct in a unique index, and a PLATFORM grant's scope_id is
-- NULL by definition. So the one scope where duplicates matter most — the
-- whole platform — was the one scope with no protection at all.
--
-- Found when a super administrator ended up with two live grants after a
-- revoke, a re-grant through the API, and then a bootstrap script run that
-- un-revoked the original. Harmless on its own; not harmless next to
-- `assertNotTheLastWhoCanAppoint`, which counts grants to decide whether
-- another account could still appoint a replacement. A duplicate inflates
-- that count, and the guard would then allow the revocation it exists to
-- refuse.
--
-- Revoked rows are deliberately left alone. The trail has to be able to say
-- that somebody held a role, lost it, and was given it back.

-- Collapse any existing duplicates onto the oldest live row, so the index
-- below can be created. Keeping the oldest preserves the real "granted at".
DELETE FROM identity.user_roles AS duplicate
USING identity.user_roles AS keeper
WHERE duplicate.revoked_at IS NULL
  AND keeper.revoked_at IS NULL
  AND duplicate.user_id = keeper.user_id
  AND duplicate.role_id = keeper.role_id
  AND duplicate.scope_type = keeper.scope_type
  AND duplicate.scope_id IS NOT DISTINCT FROM keeper.scope_id
  AND (duplicate.created_at, duplicate.id) > (keeper.created_at, keeper.id);

-- COALESCE to a sentinel so NULL participates, and partial so the constraint
-- binds only live grants.
CREATE UNIQUE INDEX IF NOT EXISTS user_roles_one_live_grant
  ON identity.user_roles (
    user_id,
    role_id,
    scope_type,
    COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE revoked_at IS NULL;
