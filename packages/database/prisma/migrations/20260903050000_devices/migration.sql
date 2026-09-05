-- Implanted devices, and the identifier a recall arrives by.
--
-- Expand-only. One new table and one new enum; nothing existing is touched.
--
-- Row-level security is created here rather than left to the RLS migration, for
-- the same reason as the four before it: that migration has already run
-- everywhere this one will.

CREATE TYPE "DeviceStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ENTERED_IN_ERROR', 'UNKNOWN');

CREATE TABLE "Device" (
  "id"                 UUID           NOT NULL,
  "tenantId"           UUID           NOT NULL,
  "patientId"          UUID           NOT NULL,
  "status"             "DeviceStatus" NOT NULL DEFAULT 'ACTIVE',
  "typeCode"           TEXT,
  "typeSystem"         TEXT,
  "typeText"           TEXT           NOT NULL,
  "deviceIdentifier"   TEXT,
  "udiCarrierHrf"      TEXT,
  "distinctIdentifier" TEXT,
  "lotNumber"          TEXT,
  "serialNumber"       TEXT,
  "manufacturer"       TEXT,
  "modelNumber"        TEXT,
  "manufactureDate"    DATE,
  "expirationDate"     DATE,
  "createdAt"          TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3)   NOT NULL,

  CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- A device nobody can name is not a record of anything. `typeText` being NOT
-- NULL is satisfied by a space, and a Device whose only human-readable field is
-- blank tells a clinician reading the chart that the patient has an implant of
-- some kind, which is worse than saying nothing.
ALTER TABLE "Device" ADD CONSTRAINT "Device_type_text_not_blank"
  CHECK (length(btrim("typeText")) > 0);

-- A code with no system is a string nobody can look up, and a system with no
-- code names a vocabulary and no term in it. Either alone is a coding that
-- cannot be resolved to a display anywhere.
ALTER TABLE "Device" ADD CONSTRAINT "Device_type_code_with_system"
  CHECK (("typeCode" IS NULL) = ("typeSystem" IS NULL));

-- Expiry cannot precede manufacture. Stored, it makes every "is this device
-- past its date" comparison answer yes forever, including for devices that are
-- fine.
ALTER TABLE "Device" ADD CONSTRAINT "Device_dates_ordered"
  CHECK (
    "expirationDate" IS NULL
    OR "manufactureDate" IS NULL
    OR "expirationDate" >= "manufactureDate"
  );

CREATE INDEX "Device_tenantId_patientId_status_idx"
  ON "Device" ("tenantId", "patientId", "status");
-- The recall query: which of this practice's patients has one of these.
CREATE INDEX "Device_tenantId_deviceIdentifier_idx"
  ON "Device" ("tenantId", "deviceIdentifier");

ALTER TABLE "Device" ADD CONSTRAINT "Device_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- RESTRICT, like every other clinical record. A device is still inside somebody
-- long after any inventory record of it, and deleting the patient row must not
-- be the thing that erases the only note of it.
ALTER TABLE "Device" ADD CONSTRAINT "Device_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Device" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Device" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "Device"
  FOR ALL
  USING ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);
