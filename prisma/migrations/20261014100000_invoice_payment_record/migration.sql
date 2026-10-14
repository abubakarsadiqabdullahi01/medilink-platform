-- BIL-07: marking an invoice paid recorded nothing about the payment. These keep
-- the bank's reference, the amount, the date the money arrived and who paid, so a
-- payment can be checked against a statement. Null on an invoice paid before
-- they were captured.
ALTER TABLE "billing"."invoices"
  ADD COLUMN "payment_reference" TEXT,
  ADD COLUMN "payment_amount_kobo" INTEGER,
  ADD COLUMN "paid_on" DATE,
  ADD COLUMN "payer_name" TEXT;
