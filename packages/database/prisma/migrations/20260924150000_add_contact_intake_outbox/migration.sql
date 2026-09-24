-- Add ContactIntakeOutbox table for failed contact intake submissions
CREATE TABLE "ContactIntakeOutbox" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "sourceRequestId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "organisationId" TEXT,
    "dsarDetails" JSONB,
    "attachments" JSONB,
    "sourceCreatedAt" TIMESTAMPTZ NOT NULL,
    "lastError" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "receivedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "lastAttemptAt" TIMESTAMPTZ,
    "processedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "ContactIntakeOutbox_pkey" PRIMARY KEY ("id")
);

-- Add foreign key to Organisation
ALTER TABLE "ContactIntakeOutbox" ADD CONSTRAINT "ContactIntakeOutbox_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Unique constraint for idempotency (sourceRequestId per tenant)
CREATE UNIQUE INDEX "ContactIntakeOutbox_tenantId_sourceRequestId_key" ON "ContactIntakeOutbox"("tenantId", "sourceRequestId");

-- Indexes for common queries
CREATE INDEX "ContactIntakeOutbox_tenantId_receivedAt_idx" ON "ContactIntakeOutbox"("tenantId", "receivedAt");
CREATE INDEX "ContactIntakeOutbox_tenantId_processedAt_idx" ON "ContactIntakeOutbox"("tenantId", "processedAt");
CREATE INDEX "ContactIntakeOutbox_tenantId_attempts_idx" ON "ContactIntakeOutbox"("tenantId", "attempts");

-- Enable RLS
ALTER TABLE "ContactIntakeOutbox" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ContactIntakeOutbox" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "ContactIntakeOutbox"
    AS PERMISSIVE FOR ALL TO PUBLIC
    USING ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
    WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);