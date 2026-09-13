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
