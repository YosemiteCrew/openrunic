-- Every status a lot has held, and the day each took effect.
--
-- `StockLot.status` is one mutable value, so before this table every as-of
-- question was answered with today's answer: a lot retired on the 10th dropped
-- out of a query about the 1st, and a reconciliation of the 1st then came up
-- short against a shelf that had been correct.

CREATE TABLE "StockLotStatusChange" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "lotId" UUID NOT NULL,
    "status" "StockLotStatus" NOT NULL,
    "effectiveOn" DATE NOT NULL,
    "lotSeq" INTEGER NOT NULL,
    "reason" TEXT,
    "actorId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockLotStatusChange_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StockLotStatusChange_tenantId_lotId_effectiveOn_idx" ON "StockLotStatusChange"("tenantId", "lotId", "effectiveOn");

CREATE UNIQUE INDEX "StockLotStatusChange_tenantId_lotId_lotSeq_key" ON "StockLotStatusChange"("tenantId", "lotId", "lotSeq");

ALTER TABLE "StockLotStatusChange" ADD CONSTRAINT "StockLotStatusChange_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StockLotStatusChange" ADD CONSTRAINT "StockLotStatusChange_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "StockLot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every lot that already exists gets its opening row.
--
-- Without this, a lot written before this table reads as having no history at
-- all, and `statusAt` falls back to the current column - which is the behaviour
-- this table exists to replace. One row per lot, carrying the status it holds
-- now, effective from the day it was received.
--
-- That is a claim the record can support and no more. It says the lot has been
-- in its current state since it arrived, which is true of every lot that has
-- never changed - the overwhelming majority - and is the most conservative
-- reading available for the rest: a lot quarantined last week is recorded as
-- having been quarantined all along, so a back-dated query errs towards
-- refusing stock rather than towards releasing it. Erring the other way is what
-- puts a recalled dose in front of a patient.
--
-- `actorId` is left null on purpose. These transitions predate the table and
-- nobody can be named for them; a placeholder would be a fact the record never
-- stated.
INSERT INTO "StockLotStatusChange" ("id", "tenantId", "lotId", "status", "effectiveOn", "lotSeq", "reason", "actorId", "createdAt", "updatedAt")
SELECT
  gen_random_uuid(),
  "tenantId",
  "id",
  "status",
  "receivedOn",
  1,
  'Backfilled when the status history table was added; the transitions before it were not recorded.',
  NULL,
  now(),
  now()
FROM "StockLot";

ALTER TABLE "StockLotStatusChange" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StockLotStatusChange" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "StockLotStatusChange"
  FOR ALL
  USING ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);

-- The history is append-only, and this is what makes that structural rather
-- than conventional. A status change that could be edited afterwards is a
-- current value with extra steps, not a history, and the whole point of the
-- table is that a back-dated report can be reproduced.
--
-- Guarded exactly as the ledger's REVOKE is, and for the same reason: the
-- history is replayed into databases where the application role does not exist
-- - the shadow database behind CI's drift check is one - and an unguarded
-- REVOKE would abort the replay.
--
-- Note what this does and does not bind. It binds the application role, which
-- is the only role the running system connects as. It does not bind the table
-- owner, so an operator with owner credentials can still rewrite a row; that is
-- a deployment property, documented in packages/database/README.md.
DO $$
DECLARE
  app_role CONSTANT text := 'openrunic_app';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_role) THEN
    RAISE WARNING 'openrunic: role % does not exist, so UPDATE and DELETE were not revoked on "StockLotStatusChange". Create it as described in packages/database/README.md and replay this block.', app_role;
    RETURN;
  END IF;

  EXECUTE format('REVOKE UPDATE, DELETE ON TABLE "StockLotStatusChange" FROM %I', app_role);
END
$$;
