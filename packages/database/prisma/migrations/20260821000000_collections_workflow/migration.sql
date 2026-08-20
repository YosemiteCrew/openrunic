-- Collections and dunning: the persistence behind `@openrunic/collections`.
--
-- No new table. A patient balance already has a home in "Statement", and a
-- separate collections case pointing back at it would give the same debt two
-- rows that can disagree about how much is owed and how often it has been
-- chased. What was missing was not a place to put the workflow, it was the
-- handful of facts the workflow turns on.
--
-- "dunningCycle" already existed and nothing ever wrote it, so every row in
-- every deployment says 1. Read literally that claims one notice has been sent,
-- including for a statement still in DRAFT that has never been near a patient.
-- The default becomes 0 and the backfill below corrects the rows that were
-- never sent. Rows that were sent keep 1, which is true of them: SENT is the
-- first notice.
--
-- WRITTEN_OFF is added rather than reusing VOID. VOID means the statement
-- should not have been sent; WRITTEN_OFF means the debt was real and the
-- practice stopped pursuing it. A practice that cannot tell those apart cannot
-- report its bad debt, and cannot tell a billing problem from a collection one.
--
-- No CHECK constraint on "dunningCycle" and no trigger enforcing the notice
-- interval. Both would be unverifiable here, and both belong at the write door
-- where the policy that decides them lives: `@openrunic/collections` owns when
-- a notice is due, and a constraint restating half of that rule would be a
-- second, competing answer.
--
-- Row-level security needs no work: "Statement" already carries it, and adding
-- a column to a policied table does not change the policy.

ALTER TYPE "StatementStatus" ADD VALUE IF NOT EXISTS 'WRITTEN_OFF';

ALTER TABLE "Statement" ADD COLUMN "lastNoticeAt" TIMESTAMP(3);
ALTER TABLE "Statement" ADD COLUMN "holdUntil" TIMESTAMP(3);
ALTER TABLE "Statement" ADD COLUMN "holdReason" TEXT;
ALTER TABLE "Statement" ADD COLUMN "closedReason" TEXT;

ALTER TABLE "Statement" ALTER COLUMN "dunningCycle" SET DEFAULT 0;

-- A statement that never left the building has had no notice. One that was sent
-- has had exactly one, which is what the column already says.
UPDATE "Statement" SET "dunningCycle" = 0 WHERE "status" IN ('DRAFT', 'GENERATED');

-- Backfills the notice date for statements already sent, so the interval has
-- something to measure from. Without this every previously sent statement looks
-- to the policy like one whose last notice date is unknown, and the first run
-- of a dunning job would bill all of them again at once.
UPDATE "Statement" SET "lastNoticeAt" = "deliveredAt"
WHERE "deliveredAt" IS NOT NULL AND "lastNoticeAt" IS NULL;

-- The worklist reads by status and by when the last notice went out. The
-- existing ("tenantId", "status", "generatedAt") index answers neither, because
-- generatedAt is when the statement was produced rather than when it was last
-- chased.
CREATE INDEX "Statement_tenantId_status_lastNoticeAt_idx"
  ON "Statement" ("tenantId", "status", "lastNoticeAt");
