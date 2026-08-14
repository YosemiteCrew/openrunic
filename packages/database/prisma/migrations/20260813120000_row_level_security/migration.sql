-- Row-level security: layer 2 of the tenant isolation model.
--
-- Layer 1 is `createTenantClient`, which injects `tenantId` into every query
-- the application issues. It runs in the same process as the code it protects,
-- so a bug in the extension, a raw query, or a Prisma operation it does not yet
-- know about would all bypass it. This migration puts the same rule inside
-- Postgres, where application code cannot reach it.
--
-- ---------------------------------------------------------------------------
-- The rule
-- ---------------------------------------------------------------------------
--
-- Every table that carries `tenantId` gets ENABLE ROW LEVEL SECURITY, FORCE ROW
-- LEVEL SECURITY, and one permissive policy `tenant_isolation` FOR ALL:
--
--     USING      ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
--     WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
--
-- USING filters SELECT, UPDATE and DELETE; WITH CHECK filters the rows INSERT
-- and UPDATE are allowed to produce. Together they cover all four verbs, which
-- is why one FOR ALL policy is used rather than four per-command ones.
--
-- `Organisation` is the tenant root and has no `tenantId`; its policy keys on
-- `id` instead. The reasoning for every other table is in section 3.
--
-- ---------------------------------------------------------------------------
-- Three details that decide whether this is real or theatre
-- ---------------------------------------------------------------------------
--
-- 1. FORCE. Without it the table owner - the role that ran this migration, and
--    in most deployments the role the application would otherwise connect as -
--    is exempt from every policy on its own tables. ENABLE alone would produce
--    a database that looks isolated in `pg_policies` and isolates nothing.
--    FORCE is what makes the policy apply to the owner too.
--
--    FORCE does not defeat SUPERUSER or the BYPASSRLS role attribute; nothing
--    can. That is why section 4 refuses to grant to an application role that
--    holds either.
--
-- 2. Fail closed on an unset session. `current_setting(name, true)` returns
--    NULL when the setting was never set in this session, and `"tenantId" =
--    NULL` is NULL, which is not true, so the row is filtered out: no setting
--    means no rows, never all rows.
--
--    The `nullif(..., '')` is not decoration. A Postgres customized option
--    that has been set and then reset - which is exactly what happens when a
--    `SET LOCAL` transaction commits and the connection returns to the pool -
--    reads back as the empty string rather than as NULL. Casting '' to uuid
--    raises `invalid input syntax for type uuid: ""`, so without the guard the
--    first query on a recycled connection would error instead of returning
--    nothing. `nullif` turns it back into NULL, and back onto the fail-closed
--    path.
--
-- 3. Transaction-scoped, never session-scoped. The application sets the tenant
--    with `set_config('openrunic.tenant_id', $1, true)` - the third argument is
--    is_local - as the first statement of the transaction that will carry the
--    query. Postgres discards a local setting at COMMIT or ROLLBACK, so a
--    connection handed back to the pool cannot carry one request's tenant into
--    the next one's. A session-level `SET` would do exactly that, which is why
--    nothing in this codebase issues one. See `withTenantSession` in
--    `packages/database/src/rls.ts`.
--
-- ---------------------------------------------------------------------------
-- Who connects as what
-- ---------------------------------------------------------------------------
--
-- Migrations and the seed run as the OWNER of these tables. The application
-- connects as a separate, non-owner, non-superuser role - `openrunic_app` by
-- default - which holds only the DML privileges granted in section 4 and is
-- subject to every policy created here.
--
-- This migration does NOT create that role, and the omission is deliberate
-- rather than an oversight:
--
--   * A login role needs a password. Committing one to git is committing a
--     credential, and creating a passwordless LOGIN role is worse.
--   * Roles are cluster-wide objects; migration history is per-database. The
--     same migration replayed against a second database in the same cluster
--     would find the role already there.
--   * Managed Postgres offerings routinely withhold CREATEROLE from the
--     migration user, so a CREATE ROLE here would fail on exactly the
--     deployments that matter.
--
-- Creating the role is therefore an operator step, documented in
-- `packages/database/README.md`. Section 4 grants privileges to it if it
-- exists, so a database whose operator created the role first comes out fully
-- configured, and one where it does not exist yet gets the grants the moment
-- the role appears and this GRANT block is replayed by hand.


-- ---------------------------------------------------------------------------
-- 1. Tenant-scoped tables (46): every table carrying `tenantId`.
-- ---------------------------------------------------------------------------

ALTER TABLE "Facility" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Facility" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "Facility"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);

ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "User"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);

ALTER TABLE "UserFacility" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserFacility" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "UserFacility"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);

ALTER TABLE "Role" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Role" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "Role"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);

ALTER TABLE "Permission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Permission" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "Permission"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);

ALTER TABLE "RolePermission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RolePermission" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "RolePermission"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);

ALTER TABLE "RoleAssignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RoleAssignment" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "RoleAssignment"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);

ALTER TABLE "Patient" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Patient" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "Patient"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);

ALTER TABLE "PatientIdentifier" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PatientIdentifier" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "PatientIdentifier"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);

ALTER TABLE "RelatedPerson" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RelatedPerson" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "RelatedPerson"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);

ALTER TABLE "Payer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Payer" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "Payer"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);

ALTER TABLE "Coverage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Coverage" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "Coverage"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);

ALTER TABLE "Document" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Document" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "Document"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);

ALTER TABLE "Appointment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Appointment" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "Appointment"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);

ALTER TABLE "AppointmentStatusHistory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AppointmentStatusHistory" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "AppointmentStatusHistory"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);

ALTER TABLE "Encounter" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Encounter" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "Encounter"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);

ALTER TABLE "ClinicalNote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClinicalNote" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "ClinicalNote"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);

ALTER TABLE "NoteAddendum" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NoteAddendum" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "NoteAddendum"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);

ALTER TABLE "Condition" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Condition" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "Condition"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);

ALTER TABLE "MedicationStatement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MedicationStatement" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "MedicationStatement"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);

ALTER TABLE "MedicationRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MedicationRequest" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "MedicationRequest"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);

ALTER TABLE "AllergyIntolerance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AllergyIntolerance" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "AllergyIntolerance"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);

ALTER TABLE "Immunization" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Immunization" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "Immunization"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);

ALTER TABLE "Observation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Observation" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "Observation"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);

ALTER TABLE "ServiceRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ServiceRequest" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "ServiceRequest"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);

ALTER TABLE "Specimen" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Specimen" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "Specimen"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);

ALTER TABLE "DiagnosticReport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DiagnosticReport" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "DiagnosticReport"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);

ALTER TABLE "ResultObservation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ResultObservation" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "ResultObservation"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);

ALTER TABLE "Task" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Task" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "Task"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);

ALTER TABLE "MessageThread" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MessageThread" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "MessageThread"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);

ALTER TABLE "Message" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Message" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "Message"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);

ALTER TABLE "ChargeItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ChargeItem" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "ChargeItem"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);

ALTER TABLE "Claim" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Claim" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "Claim"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);

ALTER TABLE "ClaimLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClaimLine" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "ClaimLine"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);

ALTER TABLE "ClaimStatusHistory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClaimStatusHistory" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "ClaimStatusHistory"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);

ALTER TABLE "Payment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Payment" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "Payment"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);

ALTER TABLE "PaymentAllocation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentAllocation" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "PaymentAllocation"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);

ALTER TABLE "Remittance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Remittance" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "Remittance"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);

ALTER TABLE "RemittanceLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RemittanceLine" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "RemittanceLine"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);

ALTER TABLE "Statement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Statement" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "Statement"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);

ALTER TABLE "FormDefinition" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FormDefinition" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "FormDefinition"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);

ALTER TABLE "FormSubmission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FormSubmission" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "FormSubmission"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);

ALTER TABLE "FormPromotedValue" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FormPromotedValue" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "FormPromotedValue"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);

ALTER TABLE "TerminologyCode" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TerminologyCode" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "TerminologyCode"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);

ALTER TABLE "ConsentGrant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ConsentGrant" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "ConsentGrant"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);

ALTER TABLE "AuditEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "AuditEvent"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);


-- ---------------------------------------------------------------------------
-- 2. Organisation: the tenant root.
-- ---------------------------------------------------------------------------
--
-- Organisation has no `tenantId` because it *is* the tenant, so the policy
-- keys on its primary key. A session bound to organisation A sees exactly one
-- Organisation row - its own - which is what the settings screens need and all
-- they should ever get.

ALTER TABLE "Organisation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Organisation" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "Organisation"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING ("id" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
  WITH CHECK ("id" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid);


-- ---------------------------------------------------------------------------
-- 3. Tables deliberately left without a policy.
-- ---------------------------------------------------------------------------
--
-- `_prisma_migrations` is Prisma's own bookkeeping: one row per applied
-- migration, holding a name, a checksum and timestamps. It holds no tenant
-- data and no PHI, and it is the one table where FORCE would be actively
-- harmful - `prisma migrate deploy` runs as the owner and must read and write
-- it, so a policy the owner cannot satisfy would make the database
-- unmigratable. It is left unprotected by RLS and instead put out of the
-- application's reach entirely: section 4 revokes every privilege on it from
-- the application role.
--
-- There is no other exception. Every join table in this schema is an explicit
-- model with its own `tenantId` (`UserFacility`, `RolePermission`,
-- `RoleAssignment`, `PaymentAllocation`, `ClaimLine`, `RemittanceLine`,
-- `FormPromotedValue`, `ResultObservation`), so Prisma generates no implicit
-- `_ModelAToModelB` relation tables and there is nothing unpoliced between two
-- policed tables. Terminology is not global either: `TerminologyCode` is
-- bring-your-own per organisation, carries `tenantId`, and is covered in
-- section 1 like any clinical table. `Permission` and `Role` are likewise
-- per-tenant rather than platform-wide.


-- ---------------------------------------------------------------------------
-- 4. Privileges for the application role.
-- ---------------------------------------------------------------------------
--
-- Runs as the owner, so `ALTER DEFAULT PRIVILEGES` below attaches to the role
-- that will create future tables, and every table added by a later migration
-- is reachable by the application without another grant.
--
-- The role name defaults to `openrunic_app` and can be overridden per
-- connection without editing this file:
--
--     DATABASE_URL=".../openrunic?options=-c%20openrunic.app_role%3Dmy_role"
--
-- Prisma does not surface RAISE NOTICE or RAISE WARNING from `migrate deploy`,
-- so treat a silent success as unconfirmed and run the verification query in
-- packages/database/README.md afterwards.

DO $$
DECLARE
  app_role text := coalesce(nullif(current_setting('openrunic.app_role', true), ''), 'openrunic_app');
  role_row pg_roles%ROWTYPE;
BEGIN
  SELECT * INTO role_row FROM pg_roles WHERE rolname = app_role;

  IF NOT FOUND THEN
    RAISE WARNING 'openrunic: role % does not exist, so no privileges were granted. Create it as described in packages/database/README.md and replay this GRANT block.', app_role;
    RETURN;
  END IF;

  -- A superuser or a BYPASSRLS role ignores every policy this migration just
  -- created. Granting it DML would produce a deployment that passes every
  -- structural check and isolates nothing, so refuse instead.
  IF role_row.rolsuper OR role_row.rolbypassrls THEN
    RAISE EXCEPTION 'openrunic: role % is SUPERUSER or holds BYPASSRLS and would bypass every row-level security policy. Recreate it with NOSUPERUSER NOBYPASSRLS.', app_role;
  END IF;

  -- An owner can ALTER TABLE ... NO FORCE ROW LEVEL SECURITY and undo this
  -- migration from inside the application's own connection.
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relowner = role_row.oid
  ) THEN
    RAISE EXCEPTION 'openrunic: role % owns tables in schema public. The application role must not own the tables it reads, or it can disable their policies.', app_role;
  END IF;

  EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', app_role);
  EXECUTE format(
    'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I',
    app_role
  );

  -- AuditEvent is append-only and hash-chained. The application inserts and
  -- reads; it has no legitimate reason to update or delete a past event, and
  -- withholding the privilege makes that structural rather than conventional.
  EXECUTE format('REVOKE UPDATE, DELETE ON TABLE "AuditEvent" FROM %I', app_role);

  -- Prisma's migration ledger. Not RLS-protected (see section 3), so the
  -- application must not be able to reach it at all. Guarded because the
  -- history is also replayed into databases the migrate engine never touched -
  -- the shadow database behind CI's drift check is one - where the ledger does
  -- not exist and an unguarded REVOKE would abort the replay.
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    EXECUTE format('REVOKE ALL ON TABLE "_prisma_migrations" FROM %I', app_role);
  END IF;

  -- TRUNCATE is deliberately never granted: it is not filtered by row-level
  -- security, so a role holding it could empty a table across every tenant.

  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I',
    app_role
  );
END
$$;
