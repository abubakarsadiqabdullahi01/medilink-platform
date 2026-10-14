-- UXO-03: who prepared a payout, so releasing it can refuse the same person.
-- Null on a payout prepared before this was recorded; nothing holds one of those
-- back, because there is nobody to compare with.
ALTER TABLE "billing"."payouts" ADD COLUMN "prepared_by" UUID;
