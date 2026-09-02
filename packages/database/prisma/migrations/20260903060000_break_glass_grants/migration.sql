-- Break-glass: deliberate access to a chart the reader has no relationship with.
--
-- Expand-only. One new table; nothing existing is touched.
--
-- Row-level security is created here rather than left to the RLS migration, for
-- the same reason as the five before it: that migration has already run
-- everywhere this one will.

CREATE TABLE "BreakGlassGrant" (
  "id"        UUID         NOT NULL,
  "tenantId"  UUID         NOT NULL,
  "userId"    UUID         NOT NULL,
  "patientId" UUID         NOT NULL,
  "reason"    TEXT         NOT NULL,
  "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "BreakGlassGrant_pkey" PRIMARY KEY ("id")
);

-- A reason nobody wrote is not a reason. NOT NULL is satisfied by a space, and
-- the entire control here is that a person stated why and their name is on it.
ALTER TABLE "BreakGlassGrant" ADD CONSTRAINT "BreakGlassGrant_reason_not_blank"
  CHECK (length(btrim("reason")) > 0);

-- A grant that expired before it was granted is either a typo or an attempt to
-- leave no window at all, and the second is worse: the row would look like
-- access was taken when none was.
ALTER TABLE "BreakGlassGrant" ADD CONSTRAINT "BreakGlassGrant_window_ordered"
  CHECK ("expiresAt" > "grantedAt");

-- The authorisation lookup, on the read path: has this reader an unexpired
-- grant on this chart.
CREATE INDEX "BreakGlassGrant_tenantId_userId_patientId_expiresAt_idx"
  ON "BreakGlassGrant" ("tenantId", "userId", "patientId", "expiresAt");
-- The review query: who broke glass on this patient, and when.
CREATE INDEX "BreakGlassGrant_tenantId_patientId_grantedAt_idx"
  ON "BreakGlassGrant" ("tenantId", "patientId", "grantedAt");

ALTER TABLE "BreakGlassGrant" ADD CONSTRAINT "BreakGlassGrant_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- RESTRICT on both. A break-glass record is evidence, and deleting the user or
-- the patient must not be the thing that removes it.
ALTER TABLE "BreakGlassGrant" ADD CONSTRAINT "BreakGlassGrant_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BreakGlassGrant" ADD CONSTRAINT "BreakGlassGrant_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BreakGlassGrant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BreakGlassGrant" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "BreakGlassGrant"
  FOR ALL
  USING ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);
