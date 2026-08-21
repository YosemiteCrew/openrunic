-- Value set definitions, so a deployment can tell a quality measure what a code
-- list contains.
--
-- Measures name the value sets they read by canonical URL. This table is where a
-- deployment says what is in one.
--
-- NOTHING SHIPS IN THIS TABLE, and that is the whole reason it exists. The
-- measure specifications are public; the code lists behind them live in VSAC and
-- need a UMLS licence, which this project does not redistribute. A deployment
-- obtains them under whatever licence applies to it and loads them here, exactly
-- as it does code systems. A measure whose value sets are absent reports that it
-- cannot be computed rather than a rate from a partial list.
--
-- Definitions, not expansions. The codes live in "TerminologyCode"; a resolved
-- list stored here would go stale the moment a code system release was loaded,
-- and would give one value set two answers that could disagree.
--
-- "definition" is JSONB rather than a column per rule field. The shape belongs to
-- packages/terminology, and a column layout would have to migrate every time that
-- shape gained a field. It is validated at the write door by the same Zod schema
-- the package already exports, which is where a JSON column has to be validated.
--
-- Unique on ("tenantId", "url"): a canonical URL identifies one set, and two rows
-- claiming the same URL is a value set with two contents and no way to say which
-- one a report used.
--
-- Row-level security is applied here rather than left to the RLS migration,
-- because that migration has already run everywhere this one will.

CREATE TABLE "ValueSet" (
  "id"          UUID         NOT NULL,
  "tenantId"    UUID         NOT NULL,
  "url"         TEXT         NOT NULL,
  "name"        TEXT,
  "description" TEXT,
  "definition"  JSONB        NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ValueSet_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ValueSet_tenantId_url_key" ON "ValueSet" ("tenantId", "url");
CREATE INDEX "ValueSet_tenantId_url_idx" ON "ValueSet" ("tenantId", "url");

ALTER TABLE "ValueSet" ADD CONSTRAINT "ValueSet_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Organisation"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ValueSet" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ValueSet" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "ValueSet"
  FOR ALL
  USING ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);
