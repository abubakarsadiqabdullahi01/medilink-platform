-- A prepared payout can be withdrawn before anybody releases it (BIL-05). Until
-- now the only ways out of PREPARED were RELEASED and a failed send, so a payout
-- prepared for the wrong month stayed in flight and kept its amount out of reach.
ALTER TYPE "billing"."PayoutStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

-- The date a transfer made by hand left the bank, which is what the practitioner
-- checks their statement against. settled_at is when it was recorded.
ALTER TABLE "billing"."payouts" ADD COLUMN "paid_on" DATE;
