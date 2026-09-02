-- Care plans: the assessment and plan, as the clinician wrote it.
--
-- Expand-only. One new table and two new enums; nothing existing is touched, so
-- a release running the previous code against this schema behaves identically.
--
-- Row-level security is created here rather than left to the RLS migration, for
-- the same reason as the two before it: that migration has already run
-- everywhere this one will, so a table added after it would otherwise be
-- readable across tenants until somebody noticed.

CREATE TYPE "CarePlanStatus" AS ENUM (
  'DRAFT',
  'ACTIVE',
  'ON_HOLD',
  'REVOKED',
  'COMPLETED',
  'ENTERED_IN_ERROR',
  'UNKNOWN'
);

CREATE TYPE "CarePlanIntent" AS ENUM (
  'PROPOSAL',
  'PLAN',
  'ORDER',
  'OPTION'
);

CREATE TABLE "CarePlan" (
  "id"          UUID             NOT NULL,
  "tenantId"    UUID             NOT NULL,
  "patientId"   UUID             NOT NULL,
  "encounterId" UUID,
  "status"      "CarePlanStatus" NOT NULL DEFAULT 'ACTIVE',
  "intent"      "CarePlanIntent" NOT NULL DEFAULT 'PLAN',
  "title"       TEXT,
  "narrative"   TEXT             NOT NULL,
  "periodStart" TIMESTAMP(3),
  "periodEnd"   TIMESTAMP(3),
  "authorId"    UUID,
  "createdAt"   TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3)     NOT NULL,

  CONSTRAINT "CarePlan_pkey" PRIMARY KEY ("id")
);

-- A plan with no narrative is the failure this resource exists to prevent.
-- US Core requires the text, and a row that satisfied NOT NULL with an empty
-- string would serve a CarePlan whose only must-support element says nothing:
-- valid FHIR, structurally complete, and empty where the content belongs.
ALTER TABLE "CarePlan" ADD CONSTRAINT "CarePlan_narrative_not_blank"
  CHECK (length(btrim("narrative")) > 0);

-- A plan that ended before it started is a typo, and stored it becomes a
-- negative duration in every report that measures one.
ALTER TABLE "CarePlan" ADD CONSTRAINT "CarePlan_period_ordered"
  CHECK ("periodEnd" IS NULL OR "periodStart" IS NULL OR "periodEnd" >= "periodStart");

CREATE INDEX "CarePlan_tenantId_patientId_status_idx"
  ON "CarePlan" ("tenantId", "patientId", "status");
CREATE INDEX "CarePlan_tenantId_encounterId_idx"
  ON "CarePlan" ("tenantId", "encounterId");

ALTER TABLE "CarePlan" ADD CONSTRAINT "CarePlan_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CarePlan" ADD CONSTRAINT "CarePlan_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CarePlan" ADD CONSTRAINT "CarePlan_encounterId_fkey"
  FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- RESTRICT, not CASCADE: a clinician leaving the practice must not erase who
-- wrote the plan their patients are still being treated under.
ALTER TABLE "CarePlan" ADD CONSTRAINT "CarePlan_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CarePlan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CarePlan" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "CarePlan"
  FOR ALL
  USING ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);
