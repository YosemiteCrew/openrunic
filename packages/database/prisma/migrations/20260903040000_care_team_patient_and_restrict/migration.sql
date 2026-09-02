-- Two corrections to the care-record tables, both found in review.
--
-- Expand-only. One added column, one added unique index, and four foreign keys
-- replaced by stricter versions of themselves. Nothing is dropped that held
-- data, and no statement makes a running older version wrong: the older code
-- neither writes CareTeamParticipant.patientId nor deletes patients.

-- 1. A participant carries its patient, so a patient-scoped token can see it.
--
-- The compartment rule this layer applies is one column equality and it
-- performs no join, so without the column a patient reading their own care team
-- was served the team and none of its members. No error, no empty-result
-- signal: a team that appears to have nobody on it, shown to the one person the
-- portal exists for.
-- Added NOT NULL with a transient default rather than added nullable and then
-- promoted. `ALTER COLUMN ... SET NOT NULL` is the statement that stops a
-- deploy halfway when one row still holds NULL, and it is the one
-- `ops:lint-migrations` refuses; a default that every row immediately overwrites
-- reaches the same end state without that risk, and Postgres adds it without
-- rewriting the table.
--
-- The default is never a value anything reads. `careTeamId` is NOT NULL and
-- carries a foreign key, so the UPDATE below covers every row by construction,
-- and any row it somehow missed has no matching `CareTeam(id, patientId)` and
-- fails the composite key added further down. The migration would abort loudly
-- rather than leave a participant pointing at nobody.
ALTER TABLE "CareTeamParticipant"
  ADD COLUMN "patientId" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000';

UPDATE "CareTeamParticipant" AS p
   SET "patientId" = t."patientId"
  FROM "CareTeam" AS t
 WHERE p."careTeamId" = t."id";

ALTER TABLE "CareTeamParticipant" ALTER COLUMN "patientId" DROP DEFAULT;

-- The target of the composite key below. Not a business key: `id` is already
-- unique, so this adds no collision. Same shape as StockItem's `(tenantId, id)`
-- and for the same reason.
CREATE UNIQUE INDEX "CareTeam_id_patientId_key" ON "CareTeam" ("id", "patientId");

CREATE INDEX "CareTeamParticipant_tenantId_patientId_idx"
  ON "CareTeamParticipant" ("tenantId", "patientId");

-- The denormalised column made unable to drift. A participant whose patient
-- disagrees with its team's has no row to point at, so the mismatch is
-- unrepresentable rather than merely discouraged. Referential integrity is
-- checked below row-level security, so the shape of the key is the only thing
-- that can forbid it.
ALTER TABLE "CareTeamParticipant" DROP CONSTRAINT "CareTeamParticipant_careTeamId_fkey";
ALTER TABLE "CareTeamParticipant" ADD CONSTRAINT "CareTeamParticipant_careTeamId_patientId_fkey"
  FOREIGN KEY ("careTeamId", "patientId") REFERENCES "CareTeam"("id", "patientId")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. Clinical records restrict a patient delete; they do not vanish with it.
--
-- Every other clinical table already does: Condition, Encounter, Procedure,
-- Observation and the rest all RESTRICT. These three were added with CASCADE,
-- which means deleting a patient would silently erase the plans and goals
-- recorded for them rather than refusing, and the refusal is the point. A
-- record of care given is not an attribute of the patient row the way an
-- identifier or a contact is.
ALTER TABLE "CareTeam" DROP CONSTRAINT "CareTeam_patientId_fkey";
ALTER TABLE "CareTeam" ADD CONSTRAINT "CareTeam_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CarePlan" DROP CONSTRAINT "CarePlan_patientId_fkey";
ALTER TABLE "CarePlan" ADD CONSTRAINT "CarePlan_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Goal" DROP CONSTRAINT "Goal_patientId_fkey";
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
