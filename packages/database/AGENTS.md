# packages/database

Prisma 7 and Postgres. The relational source of truth for the whole product.

## Never edit an applied migration

Anything already merged to `dev` or `main` is applied. Prisma checksums migrations, so editing one
does not "fix" it: it turns the next `migrate deploy` into a failure against every database that
already ran the original, including a clinic's.

Add a new migration instead. That is true even for a typo in a comment.

## Row-level security is on, and it fails closed

Every tenant table carries `ENABLE` plus `FORCE ROW LEVEL SECURITY` and one policy comparing
`tenantId` to a session setting. If the setting is absent the comparison is NULL and the query
returns nothing. That is the design: a query that escapes the application's own scoping returns an
empty result rather than another practice's chart.

Two details are load-bearing and easy to undo by tidying:

- The setting is `openrunic.tenant_id`, not `app.tenant_id`. Customized options share one flat
  namespace per session, so a prefix another library might also claim is a prefix something other
  than us can set.
- `nullif(current_setting(...), '')` is required. A customized option that was set and then reset,
  which is exactly what a committed `SET LOCAL` leaves behind, reads back as the empty string, and
  `''::uuid` raises. Without the guard the first query on a recycled connection errors instead of
  returning nothing.

`_prisma_migrations` is the single table with no policy, deliberately: `migrate deploy` runs as the
owner and must write it. The application role is granted nothing on it at all.

The coverage test is phrased as "everything except that one", so a table added by a future migration
without a policy fails the suite rather than passing unnoticed.

## Sessions, not clients

`withTenantSession` issues `set_config(..., is_local => true)` as the first statement of a
transaction. `is_local` means Postgres discards the setting at COMMIT, before the connection returns
to the pool. A session-level `SET` would leak the tenant across pooled requests, and there is a test
that deliberately demonstrates that leak so the distinction stays visible.

## The seed is synthetic and must stay obviously so

`PATIENT_NAMES` in `src/seed/data.ts` is the canonical list: Testina Patientsson, Exampla
Testperson, Placeholder Nullsson. Names that could be mistaken for a real person do not belong in a
seed, a fixture or a test, and CI enforces this with `pnpm run check:phi`. When you need a new
identity, take the next one from that pool rather than inventing something plausible.

## Running the real thing

The RLS integration suite needs a database and skips without `DATABASE_URL`. It creates a throwaway
database owned by a purpose-made `NOSUPERUSER NOBYPASSRLS` role, because superusers bypass RLS
unconditionally: asserting FORCE against a superuser would be a test that can never fail for the
right reason.

```bash
pnpm --filter @openrunic/database test        # skips the integration suite without a database
pnpm --filter @openrunic/database exec prisma validate
pnpm --filter @openrunic/database exec prisma migrate deploy
```
