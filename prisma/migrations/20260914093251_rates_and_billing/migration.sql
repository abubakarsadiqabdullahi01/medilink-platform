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
