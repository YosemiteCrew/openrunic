-- Imaging studies: the record that pictures exist, and where to find them.
--
-- openrunic is not a PACS and this table is the boundary that says so. THERE IS
-- NO COLUMN FOR PIXEL DATA and there should never be one. A DICOM study is
-- gigabytes of images with their own storage, their own retention rules and
-- their own viewer. An EMR's job is to know a study happened, tie it to the
-- order that asked for it and the chart it belongs to, and be able to point a
-- viewer at it. Storing the images here would duplicate a system that already
-- exists and do it worse, and it would put a modality's output inside a database
-- sized and backed up for text.
--
-- "accessionNumber" is what makes reconciliation possible. It is the identifier
-- the order, the modality worklist and the PACS all carry, so it is how a study
-- coming back from a scanner finds the order that asked for it. It is nullable
-- because outside studies arrive without one, and those have to be matched by a
-- human; making it NOT NULL would mean inventing one, and an invented accession
-- number attaches a study to the wrong order eventually.
--
-- UNIQUE on ("tenantId", "studyInstanceUid"): the UID identifies one study by
-- the standard, and two rows claiming the same one is a study with two records
-- that can disagree about which order it answers.
--
-- "modalities" is TEXT[] with no default, matching every other array column in
-- this schema. A default the Prisma schema does not declare reads as drift.
--
-- ON DELETE RESTRICT on the order and the report, not SET NULL. A study quietly
-- losing its link to the order that asked for it is how it becomes an orphan
-- nobody can attribute, and the report that cited it would point at nothing.
--
-- Row-level security is applied here rather than left to the RLS migration,
-- because that migration has already run everywhere this one will.

CREATE TYPE "ImagingStudyStatus" AS ENUM ('REGISTERED', 'AVAILABLE', 'ENTERED_IN_ERROR');

CREATE TABLE "ImagingStudy" (
  "id"                 UUID                 NOT NULL,
  "tenantId"           UUID                 NOT NULL,
  "patientId"          UUID                 NOT NULL,
  "encounterId"        UUID,
  "serviceRequestId"   UUID,
  "diagnosticReportId" UUID,
  "studyInstanceUid"   TEXT                 NOT NULL,
  "accessionNumber"    TEXT,
  "modalities"         TEXT[],
  "description"        TEXT,
  "status"             "ImagingStudyStatus" NOT NULL DEFAULT 'AVAILABLE',
  "startedAt"          TIMESTAMP(3)         NOT NULL,
  "numberOfSeries"     INTEGER              NOT NULL DEFAULT 0,
  "numberOfInstances"  INTEGER              NOT NULL DEFAULT 0,
  "retrieveUrl"        TEXT,
  "createdAt"          TIMESTAMP(3)         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3)         NOT NULL,

  CONSTRAINT "ImagingStudy_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ImagingStudy_tenantId_studyInstanceUid_key"
  ON "ImagingStudy" ("tenantId", "studyInstanceUid");
CREATE INDEX "ImagingStudy_tenantId_patientId_startedAt_idx"
  ON "ImagingStudy" ("tenantId", "patientId", "startedAt");
CREATE INDEX "ImagingStudy_tenantId_accessionNumber_idx"
  ON "ImagingStudy" ("tenantId", "accessionNumber");

ALTER TABLE "ImagingStudy" ADD CONSTRAINT "ImagingStudy_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ImagingStudy" ADD CONSTRAINT "ImagingStudy_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ImagingStudy" ADD CONSTRAINT "ImagingStudy_encounterId_fkey"
  FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ImagingStudy" ADD CONSTRAINT "ImagingStudy_serviceRequestId_fkey"
  FOREIGN KEY ("serviceRequestId") REFERENCES "ServiceRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ImagingStudy" ADD CONSTRAINT "ImagingStudy_diagnosticReportId_fkey"
  FOREIGN KEY ("diagnosticReportId") REFERENCES "DiagnosticReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ImagingStudy" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ImagingStudy" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "ImagingStudy"
  FOR ALL
  USING ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);
