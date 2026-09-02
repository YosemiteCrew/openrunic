-- Goals: what the patient and the clinician agreed to aim at.
--
-- Expand-only. One new table and three new enums; nothing existing is touched.
--
-- Row-level security is created here rather than left to the RLS migration, for
-- the same reason as the three before it: that migration has already run
-- everywhere this one will.

CREATE TYPE "GoalLifecycleStatus" AS ENUM (
  'PROPOSED',
  'PLANNED',
  'ACCEPTED',
  'ACTIVE',
  'ON_HOLD',
  'COMPLETED',
  'CANCELLED',
  'ENTERED_IN_ERROR',
  'REJECTED'
);

CREATE TYPE "GoalAchievementStatus" AS ENUM (
  'IN_PROGRESS',
  'IMPROVING',
  'WORSENING',
  'NO_CHANGE',
  'ACHIEVED',
  'SUSTAINING',
  'NOT_ACHIEVED',
  'NO_PROGRESS',
  'NOT_ATTAINABLE'
);

CREATE TYPE "GoalPriority" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

CREATE TABLE "Goal" (
  "id"                  UUID                    NOT NULL,
  "tenantId"            UUID                    NOT NULL,
  "patientId"           UUID                    NOT NULL,
  "carePlanId"          UUID,
  "lifecycleStatus"     "GoalLifecycleStatus"   NOT NULL DEFAULT 'ACTIVE',
  "achievementStatus"   "GoalAchievementStatus",
  "priority"            "GoalPriority",
  "description"         TEXT                    NOT NULL,
  "descriptionCode"     TEXT,
  "descriptionSystem"   TEXT,
  "targetMeasureCode"   TEXT,
  "targetMeasureSystem" TEXT,
  "targetValue"         DECIMAL(18,6),
  "targetLow"           DECIMAL(18,6),
  "targetHigh"          DECIMAL(18,6),
  "targetUnit"          TEXT,
  "startDate"           DATE,
  "dueDate"             DATE,
  "statusReason"        TEXT,
  "expressedByUserId"   UUID,
  "createdAt"           TIMESTAMP(3)            NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3)            NOT NULL,

  CONSTRAINT "Goal_pkey" PRIMARY KEY ("id")
);

-- A goal nobody can read is not a goal. NOT NULL alone is satisfied by a space.
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_description_not_blank"
  CHECK (length(btrim("description")) > 0);

-- `Goal.target.detail[x]` is a choice in FHIR, so a resource carrying both a
-- value and a range is malformed. A row carrying both would serialise into
-- exactly that, and a client reading whichever element it prefers would get a
-- different answer from one reading the other. Neither set is fine: a goal that
-- is not measured against a number is an ordinary goal.
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_target_value_or_range"
  CHECK (
    "targetValue" IS NULL
    OR ("targetLow" IS NULL AND "targetHigh" IS NULL)
  );

-- An inverted range is a typo, and stored it makes every "is the patient inside
-- the target" comparison answer no forever.
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_target_range_ordered"
  CHECK ("targetLow" IS NULL OR "targetHigh" IS NULL OR "targetHigh" >= "targetLow");

-- A number with no unit is not a measurement. "Below 7" is meaningless without
-- knowing 7 of what, and a client comparing it against an observation in
-- different units would silently compare the wrong things.
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_target_needs_unit"
  CHECK (
    ("targetValue" IS NULL AND "targetLow" IS NULL AND "targetHigh" IS NULL)
    OR "targetUnit" IS NOT NULL
  );

CREATE INDEX "Goal_tenantId_patientId_lifecycleStatus_idx"
  ON "Goal" ("tenantId", "patientId", "lifecycleStatus");
CREATE INDEX "Goal_tenantId_carePlanId_idx" ON "Goal" ("tenantId", "carePlanId");
CREATE INDEX "Goal_tenantId_patientId_dueDate_idx" ON "Goal" ("tenantId", "patientId", "dueDate");

ALTER TABLE "Goal" ADD CONSTRAINT "Goal_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- SET NULL, not CASCADE: a goal outlives the plan it was written under, and
-- deleting the plan must not delete what the patient agreed to aim at.
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_carePlanId_fkey"
  FOREIGN KEY ("carePlanId") REFERENCES "CarePlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_expressedByUserId_fkey"
  FOREIGN KEY ("expressedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Goal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Goal" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "Goal"
  FOR ALL
  USING ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);
