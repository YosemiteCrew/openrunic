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

Three layers, only one of which is in this package today:

1. **Tenant scoping (here).** Every model except `Organisation` carries `tenantId`.
   `createTenantClient(client, { tenantId })` returns a Prisma client extension that injects the
   tenant into every filter and stamps it onto every write, so a handler cannot forget it.
2. **Postgres row-level security (documented, not yet shipped).** The intended policy is written out
   in `prisma/schema.prisma`. It ships once the API wraps each request in the transaction that runs
   `SET LOCAL app.tenant_id`; enabling it before then would lock the application out of its own
   database.
3. **Cross-tenant tests (in `apps/api`).** A generated suite walks the Prisma DMMF and asserts every
   repository path denies a cross-tenant read and write.

`createPrismaClient()` returns a root, unscoped client. It exists for migrations, the seed and the
CLI, which legitimately predate any tenant. Request paths must not use it.

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
