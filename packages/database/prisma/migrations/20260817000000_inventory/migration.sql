-- Stock, lots and dispensing: the persistence behind `@openrunic/inventory`.
--
-- Four tables, and the shape of them is an argument rather than a convenience.
--
-- There is no on-hand column anywhere. A stored quantity can be set, and once it
-- can be set it will be, by a well-meant repair of a number that looked wrong -
-- leaving no trace of what was wrong or who decided it. For a controlled
-- substance that repair is exactly what an audit exists to detect. On-hand is
-- summed from "StockMovement" every time it is asked for.
--
-- "StockMovement" is append-only. The DO block at the end revokes UPDATE and
-- DELETE from the application role, exactly as the row-level-security migration
-- already does for "AuditEvent" - and it has to be explicit, because that
-- migration's ALTER DEFAULT PRIVILEGES grants all four verbs on every table
-- created afterwards, including this one.
--
-- Six indexes on a write-heavy table is more than this schema usually carries,
-- and it is affordable precisely because the table is append-only: index
-- maintenance is insert-only, with no update churn and no bloat.
--
-- "StockPosting" is a composite aggregate for the same reason a claim is one. A
-- dispense of thirty tablets drawn from two lots is two ledger lines and one
-- act, and two lines written by two requests are a half-recorded dispense nobody
-- can tell from a whole one. On an append-only table a half-recorded act cannot
-- be repaired, only apologised for.
--
-- Row-level security is applied here rather than left to the RLS migration,
-- because that migration has already run everywhere this one will. A table
-- created without it would be readable across tenants until somebody noticed,
-- and `rls.integration.test.ts` asserts that no such table exists.

CREATE TYPE "StockMovementKind" AS ENUM (
  'RECEIPT', 'RETURN', 'TRANSFER_IN', 'COUNT_SURPLUS', 'DISPENSE', 'ADMINISTER',
  'WASTE', 'TRANSFER_OUT', 'COUNT_SHORTFALL'
);

CREATE TYPE "StockLotStatus" AS ENUM ('AVAILABLE', 'QUARANTINED', 'RECALLED', 'RETIRED');

CREATE TYPE "StockPostingKind" AS ENUM (
  'OPENING', 'RECEIPT', 'DISPENSE', 'ADMINISTRATION', 'WASTAGE', 'COUNT',
  'CORRECTION', 'SUPPLIER_RETURN', 'PATIENT_RETURN'
);

CREATE TABLE "StockItem" (
  "id"                 UUID           NOT NULL,
  "tenantId"           UUID           NOT NULL,
  "sku"                TEXT           NOT NULL,
  "name"               TEXT           NOT NULL,
  "unit"               TEXT           NOT NULL,
  "rxnormCode"         TEXT,
  "ndcCode"            TEXT,
  "cvxCode"            TEXT,
  "packSize"           DECIMAL(18,6),
  "reorderLevel"       DECIMAL(18,6),
  "controlled"         BOOLEAN        NOT NULL DEFAULT false,
  "controlledSchedule" TEXT,
  "active"             BOOLEAN        NOT NULL DEFAULT true,
  "createdAt"          TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3)   NOT NULL,

  CONSTRAINT "StockItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StockLot" (
  "id"            UUID             NOT NULL,
  "tenantId"      UUID             NOT NULL,
  "itemId"        UUID             NOT NULL,
  "facilityId"    UUID             NOT NULL,
  "lotNumber"     TEXT             NOT NULL,
  "status"        "StockLotStatus" NOT NULL DEFAULT 'AVAILABLE',
  "expiresOn"     DATE,
  "openedOn"      DATE,
  "beyondUseDays" INTEGER,
  "manufacturer"  TEXT,
  "ndcCode"       TEXT,
  "receivedOn"    DATE             NOT NULL,
  "createdAt"     TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3)     NOT NULL,

  CONSTRAINT "StockLot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StockPosting" (
  "id"             UUID               NOT NULL,
  "tenantId"       UUID               NOT NULL,
  "kind"           "StockPostingKind" NOT NULL,
  "facilityId"     UUID               NOT NULL,
  "patientId"      UUID,
  "encounterId"    UUID,
  "prescriptionId" UUID,
  "immunizationId" UUID,
  "occurredOn"     DATE               NOT NULL,
  "postedById"     UUID               NOT NULL,
  "witnessedById"  UUID,
  "reference"      TEXT,
  "note"           TEXT,
  "createdAt"      TIMESTAMP(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3)       NOT NULL,

  CONSTRAINT "StockPosting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StockMovement" (
  "id"                 UUID                NOT NULL,
  "tenantId"           UUID                NOT NULL,
  "postingId"          UUID                NOT NULL,
  "lotId"              UUID                NOT NULL,
  "itemId"             UUID                NOT NULL,
  "facilityId"         UUID                NOT NULL,
  "kind"               "StockMovementKind" NOT NULL,
  "quantity"           DECIMAL(18,6)       NOT NULL,
  "occurredOn"         DATE                NOT NULL,
  "actorId"            UUID                NOT NULL,
  "reason"             TEXT,
  "correctsMovementId" UUID,
  "lotSeq"             INTEGER             NOT NULL,
  "createdAt"          TIMESTAMP(3)        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3)        NOT NULL,

  CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StockItem_tenantId_sku_key" ON "StockItem"("tenantId", "sku");
-- Not a business key - "id" alone is already unique, so this adds no collision.
-- It is the target of "StockLot"'s tenant-carrying foreign key: referential
-- integrity checks run as the table owner and are filtered by no policy, so the
-- shape of the key is the only thing that can forbid a lot in one organisation
-- pointing at another's item.
CREATE UNIQUE INDEX "StockItem_tenantId_id_key" ON "StockItem"("tenantId", "id");
CREATE INDEX "StockItem_tenantId_active_name_idx" ON "StockItem"("tenantId", "active", "name");
CREATE INDEX "StockItem_tenantId_ndcCode_idx" ON "StockItem"("tenantId", "ndcCode");

CREATE UNIQUE INDEX "StockLot_tenantId_itemId_facilityId_lotNumber_key"
  ON "StockLot"("tenantId", "itemId", "facilityId", "lotNumber");
CREATE UNIQUE INDEX "StockLot_tenantId_id_itemId_facilityId_key"
  ON "StockLot"("tenantId", "id", "itemId", "facilityId");
CREATE INDEX "StockLot_tenantId_itemId_facilityId_receivedOn_idx"
  ON "StockLot"("tenantId", "itemId", "facilityId", "receivedOn");
CREATE INDEX "StockLot_tenantId_facilityId_expiresOn_idx"
  ON "StockLot"("tenantId", "facilityId", "expiresOn");
CREATE INDEX "StockLot_tenantId_lotNumber_idx" ON "StockLot"("tenantId", "lotNumber");

CREATE INDEX "StockPosting_tenantId_facilityId_occurredOn_idx"
  ON "StockPosting"("tenantId", "facilityId", "occurredOn");
CREATE INDEX "StockPosting_tenantId_patientId_occurredOn_idx"
  ON "StockPosting"("tenantId", "patientId", "occurredOn");
CREATE INDEX "StockPosting_tenantId_kind_occurredOn_idx"
  ON "StockPosting"("tenantId", "kind", "occurredOn");

-- The concurrency guard, and the ledger's order. Also makes the ledger provably
-- gapless per lot, so "did we read every movement from inception" is answerable
-- as max("lotSeq") = count(*).
CREATE UNIQUE INDEX "StockMovement_tenantId_lotId_lotSeq_key"
  ON "StockMovement"("tenantId", "lotId", "lotSeq");
-- A movement is corrected at most once. Postgres treats NULLs as distinct in a
-- unique index, so this needs no partial index and binds only corrections.
CREATE UNIQUE INDEX "StockMovement_tenantId_correctsMovementId_key"
  ON "StockMovement"("tenantId", "correctsMovementId");
CREATE INDEX "StockMovement_tenantId_itemId_facilityId_occurredOn_idx"
  ON "StockMovement"("tenantId", "itemId", "facilityId", "occurredOn");
CREATE INDEX "StockMovement_tenantId_postingId_idx" ON "StockMovement"("tenantId", "postingId");
CREATE INDEX "StockMovement_tenantId_kind_occurredOn_idx"
  ON "StockMovement"("tenantId", "kind", "occurredOn");
CREATE INDEX "StockMovement_tenantId_createdAt_idx" ON "StockMovement"("tenantId", "createdAt");
CREATE INDEX "StockMovement_tenantId_actorId_createdAt_idx"
  ON "StockMovement"("tenantId", "actorId", "createdAt");

ALTER TABLE "StockItem" ADD CONSTRAINT "StockItem_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Organisation" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Organisation" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_tenantId_itemId_fkey"
  FOREIGN KEY ("tenantId", "itemId") REFERENCES "StockItem" ("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_facilityId_fkey"
  FOREIGN KEY ("facilityId") REFERENCES "Facility" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StockPosting" ADD CONSTRAINT "StockPosting_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Organisation" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockPosting" ADD CONSTRAINT "StockPosting_facilityId_fkey"
  FOREIGN KEY ("facilityId") REFERENCES "Facility" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockPosting" ADD CONSTRAINT "StockPosting_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockPosting" ADD CONSTRAINT "StockPosting_encounterId_fkey"
  FOREIGN KEY ("encounterId") REFERENCES "Encounter" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Organisation" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_postingId_fkey"
  FOREIGN KEY ("postingId") REFERENCES "StockPosting" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Four columns, and every one is load-bearing. "tenantId" because referential
-- integrity checks run as the table owner and no policy filters them, so without
-- it a movement in one organisation could reference another's lot. "itemId" and
-- "facilityId" because the package cross-checks neither and their disagreement
-- is silent - a movement filed under the wrong item vanishes from a balance, and
-- allocation then reports a shortfall against a full shelf. NO ACTION on update
-- because a cascading update runs with the owner's privileges and would rewrite
-- ledger rows straight past the revoked UPDATE below.
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_tenantId_lotId_itemId_facilityId_fkey"
  FOREIGN KEY ("tenantId", "lotId", "itemId", "facilityId")
  REFERENCES "StockLot" ("tenantId", "id", "itemId", "facilityId") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_correctsMovementId_fkey"
  FOREIGN KEY ("correctsMovementId") REFERENCES "StockMovement" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The same two-line rule every other tenant-scoped table carries. FORCE matters:
-- without it the table owner - the role that runs migrations, and the role the
-- application connects as in a self-hosted deployment - is exempt from its own
-- policy, and the protection is theatre.
--
-- Note that referential-integrity checks are NOT filtered by any of these
-- policies; they run as the table owner. That is why the foreign keys above
-- carry "tenantId" in the key itself rather than relying on the policy.
ALTER TABLE "StockItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StockItem" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "StockItem"
  FOR ALL
  USING ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);

ALTER TABLE "StockLot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StockLot" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "StockLot"
  FOR ALL
  USING ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);

ALTER TABLE "StockPosting" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StockPosting" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "StockPosting"
  FOR ALL
  USING ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);

ALTER TABLE "StockMovement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StockMovement" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "StockMovement"
  FOR ALL
  USING ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);

-- The ledger is append-only, and this is what makes that structural rather than
-- conventional. It has to be stated explicitly: the row-level-security
-- migration's ALTER DEFAULT PRIVILEGES grants SELECT, INSERT, UPDATE and DELETE
-- on every table created after it, so "StockMovement" arrives with all four.
--
-- Guarded exactly as that migration's GRANT block is, and for the same reason:
-- the history is replayed into databases where the application role does not
-- exist - the shadow database behind CI's drift check is one - and an unguarded
-- REVOKE would abort the replay.
--
-- Note what this does and does not bind. It binds the application role, which is
-- the only role the running system connects as. It does not bind the table
-- owner, so an operator with owner credentials can still rewrite a line; that is
-- a deployment property, documented in packages/database/README.md, not
-- something this migration can fix.
DO $$
DECLARE
  app_role CONSTANT text := 'openrunic_app';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_role) THEN
    RAISE WARNING 'openrunic: role % does not exist, so UPDATE and DELETE were not revoked on "StockMovement". Create it as described in packages/database/README.md and replay this block.', app_role;
    RETURN;
  END IF;

  EXECUTE format('REVOKE UPDATE, DELETE ON TABLE "StockMovement" FROM %I', app_role);
END
$$;
