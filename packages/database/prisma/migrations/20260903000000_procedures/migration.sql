-- Procedures: what was done to a patient, as opposed to ordered or billed.
--
-- This is a table rather than a view over the two that already look like it,
-- because neither answers the question. "ServiceRequest" says what was asked
-- for and may never have happened; a request that was declined, deferred or
-- simply forgotten leaves the same row as one that was carried out. "ChargeItem"
-- says what is being claimed for, and exists only when somebody bills - so a
-- procedure performed and not billed, which is most of what a practice does in
-- a day, would have no record at all. US Core requires Procedure for exactly
-- this reason: a receiving system reconciling a patient's history cannot read
-- intent or billing and call it care.
--
-- "performedEnd" is nullable and that is the whole of how a moment and a span
-- are told apart. FHIR splits them into performedDateTime and performedPeriod;
-- two nullable columns would let a row claim both, and a row claiming both is a
-- procedure that happened at an instant and also lasted an hour. One nullable
-- end column cannot express that.
--
-- "notDoneReason" exists because NOT_DONE is a real clinical statement. A
-- colonoscopy declined by the patient and a colonoscopy nobody has got to yet
-- are different facts, and a schema with no room for the first pushes it into
-- free text or into the absence of a row, which reads as nobody having
-- considered it.
--
-- "codeSystem" defaults to CPT rather than SNOMED CT because that is what a US
-- practice codes procedures in and what the charge beside it will carry.
-- "snomedCode" is the separate column US Core prefers, kept apart rather than
-- overwriting the primary code, so a claim and an exchange can each read the
-- system they need without the other having been discarded.
--
-- ON DELETE RESTRICT on the patient and the encounter, matching Condition. A
-- procedure that quietly lost its chart is an act with no subject, and one that
-- lost its visit is an act with no context; neither should be reachable by
-- deleting the parent.
--
-- Row-level security is applied here rather than left to the RLS migration,
-- because that migration has already run everywhere this one will.

CREATE TYPE "ProcedureStatus" AS ENUM (
  'PREPARATION',
  'IN_PROGRESS',
  'NOT_DONE',
  'ON_HOLD',
  'STOPPED',
  'COMPLETED',
  'ENTERED_IN_ERROR',
  'UNKNOWN'
);

CREATE TABLE "Procedure" (
  "id"             UUID              NOT NULL,
  "tenantId"       UUID              NOT NULL,
  "patientId"      UUID              NOT NULL,
  "encounterId"    UUID,
  "code"           TEXT              NOT NULL,
  "codeSystem"     TEXT              NOT NULL DEFAULT 'http://www.ama-assn.org/go/cpt',
  "display"        TEXT              NOT NULL,
  "snomedCode"     TEXT,
  "status"         "ProcedureStatus" NOT NULL DEFAULT 'COMPLETED',
  "performedStart" TIMESTAMP(3)      NOT NULL,
  "performedEnd"   TIMESTAMP(3),
  "bodySiteCode"   TEXT,
  "outcomeCode"    TEXT,
  "notDoneReason"  TEXT,
  "note"           TEXT,
  "performedById"  UUID,
  "recordedAt"     TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recordedById"   UUID,
  "createdAt"      TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3)      NOT NULL,

  CONSTRAINT "Procedure_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Procedure_tenantId_patientId_performedStart_idx"
  ON "Procedure" ("tenantId", "patientId", "performedStart");
CREATE INDEX "Procedure_tenantId_patientId_status_idx"
  ON "Procedure" ("tenantId", "patientId", "status");
CREATE INDEX "Procedure_tenantId_code_idx"
  ON "Procedure" ("tenantId", "code");

ALTER TABLE "Procedure" ADD CONSTRAINT "Procedure_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Procedure" ADD CONSTRAINT "Procedure_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Procedure" ADD CONSTRAINT "Procedure_encounterId_fkey"
  FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Procedure" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Procedure" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "Procedure"
  FOR ALL
  USING ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);
