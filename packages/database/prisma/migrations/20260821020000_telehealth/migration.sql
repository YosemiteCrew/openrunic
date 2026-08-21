-- Telehealth: one video room per appointment, and the record that it existed.
--
-- A table of its own rather than columns on "Appointment". Most appointments are
-- in person and would carry six null columns forever, and the vendor's
-- identifiers are not part of the scheduling aggregate: an appointment is a
-- commitment between people, and a room is a thing a vendor made.
--
-- THERE IS NO COLUMN FOR A JOIN TOKEN, and that is the most important line in
-- this file. A token admits its bearer to a consultation. Persisting one would
-- turn every future read of this table, every nightly backup and every support
-- export into a way into a patient's appointment, long after the visit ended.
-- Tokens are issued on demand by the vendor, handed to the caller once, and
-- never written down. A future migration adding such a column is a mistake this
-- comment exists to make somebody argue for out loud.
--
-- "appointmentId" is UNIQUE. Two rooms for one visit is two waiting rooms, and
-- half the participants end up in the one nobody is watching.
--
-- ON DELETE RESTRICT on the appointment, not CASCADE. A visit happened; the
-- record that it happened is not something deleting a calendar entry should be
-- able to remove, and billing reads durationSeconds from here.
--
-- Row-level security is applied here rather than left to the RLS migration,
-- because that migration has already run everywhere this one will. A table
-- created without it would be readable across tenants until somebody noticed,
-- and `rls.integration.test.ts` asserts that no such table exists.

CREATE TYPE "TelehealthVisitStatus" AS ENUM ('OPEN', 'ENDED', 'EXPIRED');

CREATE TABLE "TelehealthVisit" (
  "id"              UUID                    NOT NULL,
  "tenantId"        UUID                    NOT NULL,
  "appointmentId"   UUID                    NOT NULL,
  "vendorId"        TEXT                    NOT NULL,
  "roomRef"         TEXT                    NOT NULL,
  "joinUrl"         TEXT                    NOT NULL,
  "status"          "TelehealthVisitStatus" NOT NULL DEFAULT 'OPEN',
  "scheduledStart"  TIMESTAMP(3)            NOT NULL,
  "expiresAt"       TIMESTAMP(3)            NOT NULL,
  "endedAt"         TIMESTAMP(3),
  "endedReason"     TEXT,
  "durationSeconds" INTEGER,
  "createdAt"       TIMESTAMP(3)            NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3)            NOT NULL,

  CONSTRAINT "TelehealthVisit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TelehealthVisit_appointmentId_key"
  ON "TelehealthVisit" ("appointmentId");

CREATE INDEX "TelehealthVisit_tenantId_status_scheduledStart_idx"
  ON "TelehealthVisit" ("tenantId", "status", "scheduledStart");

ALTER TABLE "TelehealthVisit" ADD CONSTRAINT "TelehealthVisit_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Organisation"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TelehealthVisit" ADD CONSTRAINT "TelehealthVisit_appointmentId_fkey"
  FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TelehealthVisit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TelehealthVisit" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "TelehealthVisit"
  FOR ALL
  USING ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);
