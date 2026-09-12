-- A completed fill is a chart fact as well as a stock movement.
--
-- StockPosting remains the inventory record and stays facility-scoped. The
-- fill row is intentionally not sited: counting fills for one prescription
-- must produce the same answer for every reader authorised to read that chart.

CREATE TABLE "PrescriptionFill" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "prescriptionId" UUID NOT NULL,
    "stockPostingId" UUID NOT NULL,
    "filledOn" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrescriptionFill_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PrescriptionFill_stockPostingId_key" ON "PrescriptionFill"("stockPostingId");
CREATE INDEX "PrescriptionFill_tenantId_prescriptionId_filledOn_idx" ON "PrescriptionFill"("tenantId", "prescriptionId", "filledOn");
CREATE INDEX "PrescriptionFill_tenantId_patientId_filledOn_idx" ON "PrescriptionFill"("tenantId", "patientId", "filledOn");

ALTER TABLE "PrescriptionFill" ADD CONSTRAINT "PrescriptionFill_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PrescriptionFill" ADD CONSTRAINT "PrescriptionFill_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrescriptionFill" ADD CONSTRAINT "PrescriptionFill_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "MedicationRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrescriptionFill" ADD CONSTRAINT "PrescriptionFill_stockPostingId_fkey" FOREIGN KEY ("stockPostingId") REFERENCES "StockPosting"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill only rows whose prescription and chart agree and whose ledger lines
-- prove stock actually moved. An older zero-line posting was never a completed
-- fill, and an inconsistent cross-chart link is not made true by copying it.
INSERT INTO "PrescriptionFill" (
  "id",
  "tenantId",
  "patientId",
  "prescriptionId",
  "stockPostingId",
  "filledOn",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid(),
  posting."tenantId",
  posting."patientId",
  posting."prescriptionId",
  posting."id",
  posting."occurredOn",
  posting."createdAt",
  posting."updatedAt"
FROM "StockPosting" AS posting
JOIN "MedicationRequest" AS prescription
  ON prescription."id" = posting."prescriptionId"
  AND prescription."tenantId" = posting."tenantId"
  AND prescription."patientId" = posting."patientId"
WHERE posting."kind" = 'DISPENSE'
  AND posting."patientId" IS NOT NULL
  AND posting."prescriptionId" IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM "StockMovement" AS movement
    WHERE movement."postingId" = posting."id"
      AND movement."tenantId" = posting."tenantId"
      AND movement."kind" = 'DISPENSE'
      AND movement."quantity" > 0
  );

ALTER TABLE "PrescriptionFill" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PrescriptionFill" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "PrescriptionFill"
  FOR ALL
  USING ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);

-- A completed fill is history. Corrections are additional clinical events,
-- never edits that make the original disappear.
DO $$
DECLARE
  app_role CONSTANT text := 'openrunic_app';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_role) THEN
    RAISE WARNING 'openrunic: role % does not exist, so UPDATE and DELETE were not revoked on "PrescriptionFill". Create it as described in packages/database/README.md and replay this block.', app_role;
    RETURN;
  END IF;

  EXECUTE format('REVOKE UPDATE, DELETE ON TABLE "PrescriptionFill" FROM %I', app_role);
END
$$;
