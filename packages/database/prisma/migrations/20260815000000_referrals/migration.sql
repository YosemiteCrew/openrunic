-- Referral management, and the loop a referral has to close.
--
-- The defining failure of referrals is not sending one; it is never finding out
-- what happened. So this table carries four separate timestamps - sent,
-- scheduled, seen, report received - rather than folding them into the status.
-- Each is a distinct fact about the world, and a status alone cannot say which
-- of them is missing: "we sent it" and "they went" are different claims, and the
-- gap between them is where a diagnosis is lost.
--
-- Row-level security is applied here rather than left to the RLS migration,
-- because that migration has already run everywhere this one will. A table
-- created without it would be readable across tenants until somebody noticed,
-- and `rls.integration.test.ts` asserts that no such table exists.

CREATE TYPE "ReferralStatus" AS ENUM (
  'DRAFT', 'SENT', 'ACCEPTED', 'DECLINED', 'SCHEDULED', 'SEEN', 'COMPLETED',
  'CANCELLED', 'ENTERED_IN_ERROR'
);

CREATE TYPE "ReferralPriority" AS ENUM ('ROUTINE', 'URGENT', 'ASAP');

CREATE TABLE "Referral" (
  "id"                  UUID             NOT NULL,
  "tenantId"            UUID             NOT NULL,
  "patientId"           UUID             NOT NULL,
  "encounterId"         UUID,
  "referredById"        UUID             NOT NULL,
  "status"              "ReferralStatus"   NOT NULL DEFAULT 'DRAFT',
  "priority"            "ReferralPriority" NOT NULL DEFAULT 'ROUTINE',
  "specialtyCode"       TEXT             NOT NULL,
  "specialtyDisplay"    TEXT             NOT NULL,
  "receivingPractice"   TEXT             NOT NULL,
  "receivingNpi"        TEXT,
  "receivingPhone"      TEXT,
  "reasonCodes"         TEXT[],
  "reasonText"          TEXT,
  "note"                TEXT,
  "authorisationNumber" TEXT,
  "sentAt"              TIMESTAMP(3),
  "scheduledFor"        TIMESTAMP(3),
  "seenAt"              TIMESTAMP(3),
  "reportReceivedAt"    TIMESTAMP(3),
  "reportDocumentId"    UUID,
  "declinedReason"      TEXT,
  "createdAt"           TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3)     NOT NULL,

  CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- The outstanding-referrals tray, which is the screen this table exists for.
CREATE INDEX "Referral_tenantId_status_sentAt_idx"      ON "Referral" ("tenantId", "status", "sentAt");
CREATE INDEX "Referral_tenantId_patientId_createdAt_idx" ON "Referral" ("tenantId", "patientId", "createdAt");
CREATE INDEX "Referral_tenantId_referredById_status_idx" ON "Referral" ("tenantId", "referredById", "status");
CREATE INDEX "Referral_tenantId_priority_status_idx"     ON "Referral" ("tenantId", "priority", "status");

ALTER TABLE "Referral" ADD CONSTRAINT "Referral_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Organisation" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_encounterId_fkey"
  FOREIGN KEY ("encounterId") REFERENCES "Encounter" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referredById_fkey"
  FOREIGN KEY ("referredById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- SET NULL rather than RESTRICT: a deleted document should not pin the referral
-- that pointed at it, and the referral is still a true record of what happened.
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_reportDocumentId_fkey"
  FOREIGN KEY ("reportDocumentId") REFERENCES "Document" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The same two-line rule every other tenant-scoped table carries. FORCE matters:
-- without it the table owner - the role that runs migrations, and the role the
-- application connects as in a self-hosted deployment - is exempt from its own
-- policy, and the protection is theatre.
ALTER TABLE "Referral" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Referral" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "Referral"
  FOR ALL
  USING ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);
