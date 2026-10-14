-- CRE-04: the date printed on the document, as the reviewer read it, kept
-- apart from expires_at (the instant the credential stops counting). Null on a
-- row whose expiry was worked out from the type's review days instead, which is
-- every row verified before this and any later one where no date was read.
ALTER TABLE "credentials"."credential_submissions" ADD COLUMN "document_expires_on" DATE;
