-- BIL-06: where a practitioner is paid. A payout had no destination, so finance took
-- account details from wherever they were sent and nothing checked they belonged to
-- the person being paid. A practitioner gives an account, a finance officer verifies
-- it, and a payout is made only to a verified one.

-- CreateEnum
CREATE TYPE "billing"."PayoutAccountStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED', 'REPLACED');

-- CreateTable
CREATE TABLE "billing"."payout_accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "bank_name" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "account_last4" TEXT NOT NULL,
    "account_number_sealed" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "status" "billing"."PayoutAccountStatus" NOT NULL DEFAULT 'PENDING',
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMP(3),
    "review_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payout_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payout_accounts_user_id_status_idx" ON "billing"."payout_accounts"("user_id", "status");

-- CreateIndex
CREATE INDEX "payout_accounts_fingerprint_idx" ON "billing"."payout_accounts"("fingerprint");

-- At most one pending and one verified account per person. Held by the database,
-- not only by the code that is supposed to keep it true: two requests at once must
-- not leave a practitioner with two accounts a payout could go to.
CREATE UNIQUE INDEX "payout_accounts_one_pending" ON "billing"."payout_accounts"("user_id") WHERE "status" = 'PENDING';
CREATE UNIQUE INDEX "payout_accounts_one_verified" ON "billing"."payout_accounts"("user_id") WHERE "status" = 'VERIFIED';

-- AddForeignKey
ALTER TABLE "billing"."payout_accounts" ADD CONSTRAINT "payout_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The account a payout was prepared for. Not a foreign key: erasing a person deletes
-- their accounts, and the payout that went to one is kept.
ALTER TABLE "billing"."payouts" ADD COLUMN "account_id" UUID;
