-- Care teams: who is looking after a patient, and in what capacity.
--
-- Expand-only. Two new tables, two new enums, nothing existing is touched, so a
-- release running the previous code against this schema behaves identically.
--
-- Row-level security is created here rather than left to the RLS migration,
-- matching 20260821040000_imaging_studies and 20260903000000_procedures: that
-- migration has already run everywhere this one will, so a table added after it
-- would otherwise be readable across tenants until somebody noticed.

CREATE TYPE "CareTeamStatus" AS ENUM (
  'PROPOSED',
  'ACTIVE',
  'SUSPENDED',
  'INACTIVE',
  'ENTERED_IN_ERROR'
);

-- Three, not four. FHIR also allows an Organization member, but this deployment
-- has one Organisation row and it is the practice itself, so a member pointing
-- at it would say nothing.
CREATE TYPE "CareTeamMemberType" AS ENUM (
  'USER',
  'RELATED_PERSON',
  'PATIENT'
);

CREATE TABLE "CareTeam" (
  "id"          UUID             NOT NULL,
  "tenantId"    UUID             NOT NULL,
  "patientId"   UUID             NOT NULL,
  "status"      "CareTeamStatus" NOT NULL DEFAULT 'ACTIVE',
  "name"        TEXT,
  "periodStart" TIMESTAMP(3),
  "periodEnd"   TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3)     NOT NULL,

  CONSTRAINT "CareTeam_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CareTeamParticipant" (
  "id"                    UUID                 NOT NULL,
  "tenantId"              UUID                 NOT NULL,
  "careTeamId"            UUID                 NOT NULL,
  "memberType"            "CareTeamMemberType" NOT NULL,
  "memberUserId"          UUID,
  "memberRelatedPersonId" UUID,
  "roleCode"              TEXT                 NOT NULL,
  "roleSystem"            TEXT                 NOT NULL,
  "roleText"              TEXT,
  "periodStart"           TIMESTAMP(3),
  "periodEnd"             TIMESTAMP(3),
  "createdAt"             TIMESTAMP(3)         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3)         NOT NULL,

  CONSTRAINT "CareTeamParticipant_pkey" PRIMARY KEY ("id")
);

-- The discriminator and the columns have to agree, and Prisma cannot say so.
--
-- Without this a row can claim `USER` and carry a related-person id, or claim
-- both, and the projection would emit a member reference at the wrong resource
-- type: a `Practitioner/{id}` that resolves to nothing, or a caregiver served as
-- a clinician. Either is a team member a client believes in and cannot reach.
-- Enforced in the database because the API is not the only writer: a migration,
-- an import, or a support fix goes straight to the table.
ALTER TABLE "CareTeamParticipant" ADD CONSTRAINT "CareTeamParticipant_member_matches_type"
  CHECK (
    CASE "memberType"
      WHEN 'USER'
        THEN "memberUserId" IS NOT NULL AND "memberRelatedPersonId" IS NULL
      WHEN 'RELATED_PERSON'
        THEN "memberRelatedPersonId" IS NOT NULL AND "memberUserId" IS NULL
      -- PATIENT carries neither: the team already names its subject, and a
      -- second id could only agree with it or be wrong.
      ELSE "memberUserId" IS NULL AND "memberRelatedPersonId" IS NULL
    END
  );

CREATE INDEX "CareTeam_tenantId_patientId_status_idx"
  ON "CareTeam" ("tenantId", "patientId", "status");
CREATE INDEX "CareTeamParticipant_tenantId_careTeamId_idx"
  ON "CareTeamParticipant" ("tenantId", "careTeamId");
CREATE INDEX "CareTeamParticipant_tenantId_memberUserId_idx"
  ON "CareTeamParticipant" ("tenantId", "memberUserId");

ALTER TABLE "CareTeam" ADD CONSTRAINT "CareTeam_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CareTeam" ADD CONSTRAINT "CareTeam_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CareTeamParticipant" ADD CONSTRAINT "CareTeamParticipant_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CareTeamParticipant" ADD CONSTRAINT "CareTeamParticipant_careTeamId_fkey"
  FOREIGN KEY ("careTeamId") REFERENCES "CareTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- RESTRICT, not CASCADE: removing a clinician from the practice must not
-- silently rewrite who was on a patient's team while they were there.
ALTER TABLE "CareTeamParticipant" ADD CONSTRAINT "CareTeamParticipant_memberUserId_fkey"
  FOREIGN KEY ("memberUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CareTeamParticipant" ADD CONSTRAINT "CareTeamParticipant_memberRelatedPersonId_fkey"
  FOREIGN KEY ("memberRelatedPersonId") REFERENCES "RelatedPerson"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CareTeam" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CareTeam" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "CareTeam"
  FOR ALL
  USING ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);

ALTER TABLE "CareTeamParticipant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CareTeamParticipant" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "CareTeamParticipant"
  FOR ALL
  USING ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);
