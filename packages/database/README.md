# @openrunic/database

Openrunic's relational source of truth: the Prisma schema and its migrations, the tenant scoping
layer, the UUIDv7 id generator, the audit hash chain, the form-promotion rule, and the Zod write
contract for every aggregate. Postgres via Prisma is authoritative; FHIR serialization happens
elsewhere (`@openrunic/fhir`).

## What is in the schema

47 models and 59 enums covering the ambulatory record end to end: the tenant and its facilities,
users and roles, patients and their coverage, the schedule and its status history, encounters,
notes, problems, medications, allergies, immunizations, observations, orders, specimens, results,
documents, the typed inbox, messaging, the full claim lifecycle through remittance and statement,
the no-code form engine, bring-your-own terminology, consent, and the hash-chained audit log. Read
the comment block at the top of `prisma/schema.prisma` first: it states the conventions the whole
model relies on, including why coded data is stored as strings and why enums are reserved for
genuinely closed value sets.

## Multi-tenancy

Three layers, all of them shipped:

1. **Tenant scoping.** Every model except `Organisation` carries `tenantId`.
   `createTenantClient(client, { tenantId })` returns a Prisma client extension that injects the
   tenant into every filter and stamps it onto every write, so a handler cannot forget it.
2. **Postgres row-level security.** Enforced by migration `20260813120000_row_level_security`. See
   the section below.
3. **Cross-tenant tests.** `src/rls.integration.test.ts` proves the policies against a real
   Postgres, and a suite in `apps/api` asserts every repository path denies a cross-tenant read and
   write.

`createPrismaClient()` returns a root, unscoped client. It exists for migrations, the seed and the
CLI, which legitimately predate any tenant. Request paths must not use it.

## Row-level security

### What is enforced

Every one of the 47 tables has `ENABLE ROW LEVEL SECURITY`, `FORCE ROW LEVEL SECURITY` and a single
permissive `tenant_isolation` policy `FOR ALL` (so SELECT, INSERT, UPDATE and DELETE are all
covered):

```sql
USING      ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
WITH CHECK ("tenantId" = nullif(current_setting('openrunic.tenant_id', true), '')::uuid)
```

`Organisation` keys on `id` instead of `tenantId`, because it is the tenant. `_prisma_migrations` is
the one table with no policy: it is Prisma's own ledger, holds no tenant data, and `migrate deploy`
must be able to write it as the owner. The application role is granted nothing on it at all.

Four properties are worth stating explicitly, because each is a way this can be built and be
worthless:

- **FORCE, not just ENABLE.** Without `FORCE`, the table owner is exempt from its own policies. The
  database would look isolated in `pg_policies` and isolate nothing.
- **Fail closed.** A session that never declared a tenant reads zero rows, never every row.
  `current_setting(..., true)` yields NULL, and `"tenantId" = NULL` is not true. The `nullif` is
  what handles the _reset_ case: a Postgres customized option that was set and then reset reads back
  as the empty string, and `''::uuid` raises rather than filtering.
- **Transaction-scoped.** The setting is written with `set_config(..., is_local => true)`, which
  Postgres discards at COMMIT. A pooled connection cannot carry one request's organisation into the
  next. Nothing in this codebase issues a session-level `SET`, which would have exactly that bug -
  visible only under concurrency, in production.
- **Least privilege.** The application role holds `SELECT, INSERT, UPDATE, DELETE` and nothing else.
  It is not granted `TRUNCATE` (row-level security does not filter it) and holds no `UPDATE` or
  `DELETE` on `AuditEvent`, which is append-only.

### How the setting reaches every query

`withTenantSession(client, { tenantId }, run)` opens a transaction, issues
`set_config('openrunic.tenant_id', $1, true)` as its first statement, and only then calls `run`. In
`apps/api`, `createRlsDbPortFactory` builds the repositories' database port so that _every_ method
goes through it - each individual read as much as `$transaction`. The port exposes no write methods
at all: writes reach Postgres only inside a `$transaction` callback, on the session-bound client
that callback receives, and the port's type omits `create` and `updateMany` so a stray write
outside a session fails to compile rather than at runtime. The repositories never hold a bare
Prisma delegate, so there is no unwrapped path to forget. And if one were ever
introduced, the policies fail closed: the result is an empty result set, not another organisation's
chart.

### Operator steps

Two things are not, and cannot be, done by a migration.

**1. Create the application role.** A login role needs a password, and a password does not belong in
a git-tracked migration. Roles are also cluster-wide while migration history is per-database, and
managed Postgres routinely withholds `CREATEROLE` from the migration user. So run this once per
cluster, as an administrator:

```sql
CREATE ROLE openrunic_app LOGIN PASSWORD :'app_password'
  NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE INHERIT;
```

Then point the application's `DATABASE_URL` at `openrunic_app` and keep `DIRECT_URL` (used by
`migrate deploy`) on the owner. `NOBYPASSRLS` is not optional: a role with `BYPASSRLS` ignores every
policy, and the migration refuses to grant privileges to one that has it.

A different role name is supported without editing anything, by passing it on the migration
connection:

```text
DIRECT_URL="postgresql://owner@host/openrunic?options=-c%20openrunic.app_role%3Dmy_role"
```

**2. Apply the grants to an existing deployment.** The migration's `GRANT` block is conditional on
the role existing, so a database migrated _before_ the role was created gets the policies but no
grants. Prisma does not surface `RAISE WARNING` from `migrate deploy`, so verify rather than assume:

```sql
SELECT count(*) FILTER (WHERE relrowsecurity AND relforcerowsecurity) AS protected,
       count(*)                                                       AS tables
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> '_prisma_migrations';

SELECT has_table_privilege('openrunic_app', '"Patient"', 'SELECT') AS can_read;
```

`protected` must equal `tables` (47), and `can_read` must be true. If it is not, create the role and
replay section 4 of `packages/database/prisma/migrations/20260813120000_row_level_security/migration.sql`
by hand as the owner; it is idempotent.

Order of operations for an existing deployment: create the role, apply the migration, verify with
the queries above, then switch the application's `DATABASE_URL` over. Applying the migration while
the application is still connected as the owner is safe - the owner is subject to the policies and
the application already sets the tenant on every transaction - but it is one fewer thing to reason
about if the role exists first.

### Consequences for future migrations

DDL is unaffected. Data statements are not: the owner is filtered like anybody else, so a backfill
that spans tenants will silently touch zero rows unless it declares one. Two supported ways out,
both inside the migration:

```sql
-- Per tenant, which is the honest option.
SELECT set_config('openrunic.tenant_id', '<organisation id>', true);
UPDATE "Patient" SET ... ;

-- Or, for a genuinely cross-tenant backfill, in the same transaction:
ALTER TABLE "Patient" NO FORCE ROW LEVEL SECURITY;
UPDATE "Patient" SET ... ;
ALTER TABLE "Patient" FORCE ROW LEVEL SECURITY;
```

Never leave `NO FORCE` behind, and never grant `BYPASSRLS` to make a migration easier.

### Running the integration tests

They need a real Postgres and are gated on `DATABASE_URL`, so they skip silently without one. The
role in `DATABASE_URL` must be able to `CREATE DATABASE` and `CREATE ROLE`: the suite builds its own
throwaway database owned by a purpose-made non-superuser role, replays the committed migration SQL
into it, and drops everything afterwards.

```sh
export PGPASSWORD="$(openssl rand -hex 16)"
docker run --rm -d --name openrunic-pg -p 5432:5432 \
  -e POSTGRES_PASSWORD="$PGPASSWORD" postgres:17-alpine

DATABASE_URL="postgresql://postgres:$PGPASSWORD@localhost:5432/postgres" \
  pnpm --filter @openrunic/database test

docker rm -f openrunic-pg
```

In CI they run in the migration stage (`.github/workflows/_migration.yaml`), against the same
`postgres:17-alpine` service that proves the migrations apply, immediately after `migrate deploy`.

## Ids

Primary keys are UUIDv7 values minted by `uuidv7()` in application code, never by the database.
They are time-ordered, so inserts stay at the right edge of the index and `ORDER BY id` approximates
insertion order. `createUuidv7({ now, randomBytes })` builds a generator with injectable time and
randomness, which is how the seed is byte-reproducible.

## Migration workflow

Schema changes go through Prisma Migrate - the migration history in `prisma/migrations/` is the
source of truth for the database's shape:

1. Copy `.env.example` to `.env` and point `DATABASE_URL` / `DIRECT_URL` at a local Postgres.
2. Edit `prisma/schema.prisma`.
3. Create and apply a migration:

   ```sh
   pnpm --filter @openrunic/database exec prisma migrate dev --name <describe-the-change>
   ```

4. Commit the generated migration folder together with the schema change.

Deployed environments apply pending migrations with
`pnpm --filter @openrunic/database exec prisma migrate deploy`. **Never edit a migration that has
been applied anywhere** - write a new migration instead. The generated Prisma client must exist
before type-checking or building dependents; `pnpm --filter @openrunic/database run build` runs
`prisma generate` first, and `db:generate` runs it on its own.

## Seed

`pnpm --filter @openrunic/database run db:seed` writes a synthetic demo practice: one organisation,
two facilities, three practitioners, twenty patients with encounters, problems, medications,
allergies, vitals, orders, results, claims, remittances and statements, plus a verifiable audit
chain. It is deterministic - a fixed clock and a fixed byte source, no faker, no `Math.random` - so
the demo environment, the performance harness and the E2E suite all assert against the same rows.

Everything in it is invented, and it must stay that way: synthetic data only, everywhere, no
exceptions. `buildDemoPractice()` is exported from `@openrunic/database/seed` if you want the rows
without a database.

The seed runs as the owner and is filtered by row-level security like everything else, so it
declares the organisation it is about to create as the first statement of its transaction. That is
the only reason it works at all under `FORCE`, and it is why the seed still takes a root client
rather than a tenant one: it creates the tenant.
