-- A practitioner accepted an offer without anything recording what they had been
-- shown. In a dispute about a late cancellation neither side could say what was
-- agreed. This keeps the terms as they stood at the moment of acceptance: the
-- cancellation terms, the notes, the address, the rate and the times.

-- AlterTable
ALTER TABLE "matching"."invitations" ADD COLUMN "terms_accepted" JSONB;
