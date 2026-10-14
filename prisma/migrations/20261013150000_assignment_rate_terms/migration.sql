-- Premiums were priced from whichever rate card was active when the invoice was
-- raised, so a facility could book a night shift under one card, replace it with
-- a cheaper one, and have the practitioner paid the lower figure for work agreed
-- at the higher. The terms are copied onto the booking when it is made.
--
-- Null on bookings made before this change; invoicing prices those from the card
-- in force on the shift's date, which is what the card's own dates meant.

-- AlterTable
ALTER TABLE "matching"."assignments" ADD COLUMN "rate_terms" JSONB;
