# @openrunic/database

Openrunic's relational source of truth: the Prisma schema, its migrations, a lazy
`createPrismaClient()` factory (nothing connects at import time), and Zod input schemas for writes
— starting with `auditEventInput`, because audit logging is a day-one EMR requirement. Postgres via
Prisma is authoritative; FHIR serialization happens elsewhere (`@openrunic/fhir`).

## Migration workflow

Schema changes go through Prisma Migrate — the migration history in `prisma/migrations/` is the
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
been applied anywhere** — write a new migration instead. The generated Prisma client must exist
before type-checking or building dependents; `pnpm --filter @openrunic/database run build` runs
`prisma generate` first, and `db:generate` runs it on its own.
