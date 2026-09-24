-- Add ContactIntake table for CRM contact submissions from Yosemite Crew
CREATE TABLE "ContactIntake" (
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
    "receivedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "sourceCreatedAt" TIMESTAMPTZ NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "ContactIntake_pkey" PRIMARY KEY ("id")
);

-- Add foreign key to Organisation
ALTER TABLE "ContactIntake" ADD CONSTRAINT "ContactIntake_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Unique constraint for idempotency (sourceRequestId per tenant)
CREATE UNIQUE INDEX "ContactIntake_tenantId_sourceRequestId_key" ON "ContactIntake"("tenantId", "sourceRequestId");

-- Indexes for common queries
CREATE INDEX "ContactIntake_tenantId_receivedAt_idx" ON "ContactIntake"("tenantId", "receivedAt");
CREATE INDEX "ContactIntake_tenantId_sourceCreatedAt_idx" ON "ContactIntake"("tenantId", "sourceCreatedAt");
CREATE INDEX "ContactIntake_tenantId_type_idx" ON "ContactIntake"("tenantId", "type");
CREATE INDEX "ContactIntake_tenantId_source_idx" ON "ContactIntake"("tenantId", "source");

-- Enable RLS
ALTER TABLE "ContactIntake" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ContactIntake" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "ContactIntake"
    AS PERMISSIVE FOR ALL TO PUBLIC
    USING ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
    WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);