-- Document triage: the workflow behind a scanned or faxed page reaching a chart.
--
-- No new table, and three columns that each close a gap the existing model left
-- open rather than adding a capability on top of it.
--
-- "supersededById" is the one that matters most. DocumentStatus has had a
-- SUPERSEDED value from the start with nothing anywhere saying what did the
-- superseding, so a rescan marked the old page as replaced and left no way to
-- find the replacement. A clinician looking at a superseded result could see
-- that a newer one existed and not which one it was, which is worse than not
-- being told at all.
--
-- "errorReason" is here for the same reason a write-off carries one. The audit
-- trail records who marked a document as entered in error and when; it does not
-- record what they saw, and that is the part somebody asks about later.
--
-- The self-relation is ON DELETE RESTRICT rather than SET NULL. A superseded
-- document silently losing its pointer to the replacement would put it back in
-- the state this migration exists to fix, and quietly.
--
-- The ("tenantId", "sha256") index answers "have these exact bytes arrived
-- before", which is what stops a fax received twice becoming two documents in
-- one chart. It is not unique: the same bytes may legitimately exist again once
-- an earlier copy has been superseded or marked entered in error, and a unique
-- constraint would refuse the re-upload that fixes a mistake.
--
-- Row-level security needs no work: "Document" already carries it, and adding a
-- column to a policied table does not change the policy.

ALTER TABLE "Document" ADD COLUMN "supersededById" UUID;
ALTER TABLE "Document" ADD COLUMN "errorReason" TEXT;

ALTER TABLE "Document" ADD CONSTRAINT "Document_supersededById_fkey"
  FOREIGN KEY ("supersededById") REFERENCES "Document"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Document_tenantId_sha256_idx" ON "Document" ("tenantId", "sha256");
