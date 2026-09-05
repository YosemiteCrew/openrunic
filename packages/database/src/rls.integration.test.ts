import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createPrismaClient } from './client.js';
import type { PrismaClient } from './generated/prisma/client.js';
import { TENANT_SETTING, withTenantSession } from './rls.js';
import { TENANT_SCOPED_MODELS, createTenantClient } from './tenant.js';

/**
 * Row-level security, against a real Postgres.
 *
 * This suite exists because the alternative proves nothing. A test that mocks
 * the database cannot tell an enforced policy from one that was written,
 * reviewed, committed and never enabled - and that is precisely how RLS fails:
 * everything looks right and nothing is enforced. So every assertion below runs
 * SQL against a live server, as the roles that will run it in production.
 *
 * The fixture builds its own world rather than borrowing the database it is
 * pointed at:
 *
 *   * A throwaway database owned by a purpose-made NOSUPERUSER, NOBYPASSRLS
 *     role. This is what makes the FORCE assertions mean anything. CI's
 *     Postgres service runs as `postgres`, a superuser, and a superuser
 *     bypasses row-level security unconditionally - so "the owner sees nothing"
 *     asserted against `postgres` would be a test that can never fail for the
 *     right reason and always fails for the wrong one.
 *   * The real migration files, replayed in order, so what is under test is the
 *     SQL that will be applied to production rather than a paraphrase of it.
 *   * A separate application role holding only the privileges the migration
 *     grants it.
 *
 * Everything is dropped afterwards, and every identifier and password is
 * generated per run, so two runs against the same cluster cannot collide.
 *
 * To run it:
 *
 *     docker run --rm -d --name openrunic-pg -p 5432:5432 \
 *       -e POSTGRES_PASSWORD="$PGPASSWORD" postgres:17-alpine
 *     DATABASE_URL="postgresql://postgres:$PGPASSWORD@localhost:5432/postgres" \
 *       pnpm --filter @openrunic/database test
 *
 * `DATABASE_URL` must name a role that can CREATE DATABASE and CREATE ROLE. The
 * suite skips itself entirely when the variable is absent, which is the same
 * gate the migration workflow uses.
 */

const ADMIN_URL = process.env.DATABASE_URL ?? '';

/** Synthetic throughout: invented ids, an invented clinic, an invented patient. */
const TENANT_A = '01924f00-0000-7000-8000-00000000000a';
const TENANT_B = '01924f00-0000-7000-8000-00000000000b';
const PATIENT_A = '01924f00-0000-7000-8000-0000000000a1';
const PATIENT_B = '01924f00-0000-7000-8000-0000000000b1';
const UNKNOWN_TENANT = '01924f00-0000-7000-8000-0000000000ff';
/** A member of staff in tenant A, for the break-glass write door below. */
const READER_A = '01924f00-0000-7000-8000-0000000000c1';
const SECOND_READER_A = '01924f00-0000-7000-8000-0000000000c2';
/** A second chart in tenant A, so "a different chart" is a case that exists. */
const SECOND_PATIENT_A = '01924f00-0000-7000-8000-0000000000a2';

const MIGRATIONS_DIR = fileURLToPath(new URL('../prisma/migrations', import.meta.url));

/**
 * Prisma's migration ledger, created here because the fixture replays the
 * migration SQL directly instead of going through `prisma migrate deploy`,
 * which is what would normally create it. The migration's GRANT block revokes
 * the application's access to it, and that revoke is one of the things under
 * test, so the table has to be present for the test to mean anything.
 */
const PRISMA_LEDGER_DDL = `
  CREATE TABLE "_prisma_migrations" (
    "id" VARCHAR(36) PRIMARY KEY NOT NULL,
    "checksum" VARCHAR(64) NOT NULL,
    "finished_at" TIMESTAMPTZ,
    "migration_name" VARCHAR(255) NOT NULL,
    "logs" TEXT,
    "rolled_back_at" TIMESTAMPTZ,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "applied_steps_count" INTEGER NOT NULL DEFAULT 0
  )`;

/** Hex-only by construction; the guards below are what let these be interpolated. */
function token(): string {
  return randomUUID().replace(/-/gu, '');
}

function ident(name: string): string {
  if (!/^[A-Za-z0-9_]+$/u.test(name)) {
    throw new Error(`Refusing to interpolate an unexpected identifier: ${name}`);
  }
  return `"${name}"`;
}

function literal(value: string): string {
  if (!/^[A-Za-z0-9_]+$/u.test(value)) {
    throw new Error('Refusing to interpolate an unexpected literal');
  }
  return `'${value}'`;
}

function urlFor(role: string, password: string, database: string): string {
  const url = new URL(ADMIN_URL);
  url.username = role;
  url.password = password;
  url.pathname = `/${database}`;
  return url.toString();
}

/** The committed migration history, in the order `migrate deploy` applies it. */
function migrationSql(): string[] {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right))
    .map((name) => readFileSync(join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8'));
}

interface Fixture {
  /** Connected as the non-superuser role that owns every table. */
  owner: Client;
  /** Connected as the role the application uses. */
  app: Client;
  /** Prisma, also as the application role: the real data path. */
  prisma: PrismaClient;
}

describe.skipIf(ADMIN_URL === '')('row-level security, against a real database', () => {
  const suffix = token().slice(0, 12);
  const database = `openrunic_rls_${suffix}`;
  const ownerRole = `openrunic_rls_owner_${suffix}`;
  const appRole = `openrunic_rls_app_${suffix}`;

  let fixture: Fixture | undefined;
  /** The application role's connection string, for a case that needs a second one. */
  let appUrl = '';

  /** Narrows the fixture once, so no assertion in this file needs a `!`. */
  function db(): Fixture {
    if (fixture === undefined) {
      throw new Error('The database fixture failed to build; see the beforeAll failure.');
    }
    return fixture;
  }

  beforeAll(async () => {
    const ownerPassword = token();
    const appPassword = token();

    const admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    try {
      await admin.query(
        `CREATE ROLE ${ident(ownerRole)} LOGIN PASSWORD ${literal(ownerPassword)}
           NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`
      );
      await admin.query(
        `CREATE ROLE ${ident(appRole)} LOGIN PASSWORD ${literal(appPassword)}
           NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`
      );
      await admin.query(`CREATE DATABASE ${ident(database)} OWNER ${ident(ownerRole)}`);
    } finally {
      await admin.end();
    }

    const owner = new Client({ connectionString: urlFor(ownerRole, ownerPassword, database) });
    await owner.connect();

    // The migration's GRANT block reads this to learn which role the
    // application connects as. Operators supply it the same way, through the
    // connection string: `?options=-c%20openrunic.app_role%3D<role>`.
    await owner.query(`SET openrunic.app_role = ${literal(appRole)}`);
    await owner.query(PRISMA_LEDGER_DDL);
    for (const sql of migrationSql()) {
      await owner.query(sql);
    }

    // Two tenants, written by the owner. FORCE means the owner is subject to
    // its own policies, so even seeding has to declare which organisation it is
    // writing - which is itself part of what this suite proves.
    for (const [tenant, patient, mrn] of [
      [TENANT_A, PATIENT_A, 'OR-100482'],
      [TENANT_B, PATIENT_B, 'OR-200001'],
    ] as const) {
      await owner.query('BEGIN');
      await owner.query('SELECT set_config($1, $2, true)', [TENANT_SETTING, tenant]);
      await owner.query(
        `INSERT INTO "Organisation" ("id", "slug", "name", "updatedAt")
           VALUES ($1, $2, $3, now())`,
        [tenant, `testville-${tenant.slice(-1)}`, `Testville Clinic ${tenant.slice(-1)}`]
      );
      await owner.query(
        `INSERT INTO "Patient"
           ("id", "tenantId", "mrn", "givenName", "familyName", "birthDate", "updatedAt")
           VALUES ($1, $2, $3, 'Testina', 'Patientsson', DATE '1994-03-02', now())`,
        [patient, tenant, mrn]
      );
      await owner.query('COMMIT');
    }

    // Two readers in tenant A. `BreakGlassGrant.userId` is a foreign key to
    // `User`, so the write door below has nothing to insert without them.
    await owner.query('BEGIN');
    await owner.query('SELECT set_config($1, $2, true)', [TENANT_SETTING, TENANT_A]);
    for (const [reader, email] of [
      [READER_A, 'reader.one@clinic.invalid'],
      [SECOND_READER_A, 'reader.two@clinic.invalid'],
    ] as const) {
      await owner.query(
        `INSERT INTO "User" ("id", "tenantId", "email", "givenName", "familyName", "updatedAt")
           VALUES ($1, $2, $3, 'Testy', 'Readerson', now())`,
        [reader, TENANT_A, email]
      );
    }
    await owner.query('COMMIT');

    appUrl = urlFor(appRole, appPassword, database);
    const app = new Client({ connectionString: appUrl });
    await app.connect();

    fixture = {
      owner,
      app,
      prisma: createPrismaClient({ datasourceUrl: appUrl }),
    };
  }, 180_000);

  afterAll(async () => {
    if (fixture !== undefined) {
      await fixture.prisma.$disconnect();
      await fixture.app.end();
      await fixture.owner.end();
      fixture = undefined;
    }

    const admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${ident(database)} WITH (FORCE)`);
      await admin.query(`DROP ROLE IF EXISTS ${ident(appRole)}`);
      await admin.query(`DROP ROLE IF EXISTS ${ident(ownerRole)}`);
    } finally {
      await admin.end();
    }
  }, 60_000);

  /** Runs `sql` in a transaction that has declared `tenantId`, or has not. */
  async function asTenant<T extends Record<string, unknown>>(
    client: Client,
    tenantId: string | null,
    sql: string,
    params: unknown[] = []
  ): Promise<{ rows: T[]; rowCount: number }> {
    await client.query('BEGIN');
    try {
      if (tenantId !== null) {
        await client.query('SELECT set_config($1, $2, true)', [TENANT_SETTING, tenantId]);
      }
      const result = await client.query<T>(sql, params);
      await client.query('COMMIT');
      return { rows: result.rows, rowCount: result.rowCount ?? 0 };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }

  /* ---------------------------------------------------------------------- */
  /* The application role: the premise every other assertion rests on.       */
  /* ---------------------------------------------------------------------- */

  describe('the application role', () => {
    it('is neither a superuser nor a BYPASSRLS role', async () => {
      const { rows } = await db().app.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
        'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1',
        [appRole]
      );

      // Either attribute would make every policy in this file decorative, so
      // this is not a nicety: it is the assumption the suite tests under.
      expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    });

    it('owns none of the tables it reads, so it cannot turn FORCE off', async () => {
      const { rows } = await db().app.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public'
            AND c.relkind = 'r'
            AND pg_get_userbyid(c.relowner) = $1`,
        [appRole]
      );

      expect(rows[0]?.count).toBe('0');
    });

    it('holds the four DML privileges on a clinical table and no more', async () => {
      const { rows } = await db().app.query<Record<string, boolean>>(
        `SELECT has_table_privilege($1, '"Patient"', 'SELECT')   AS sel,
                has_table_privilege($1, '"Patient"', 'INSERT')   AS ins,
                has_table_privilege($1, '"Patient"', 'UPDATE')   AS upd,
                has_table_privilege($1, '"Patient"', 'DELETE')   AS del,
                has_table_privilege($1, '"Patient"', 'TRUNCATE') AS trunc`,
        [appRole]
      );

      // TRUNCATE is the one that matters: row-level security does not filter
      // it, so a role holding it could empty a table across every tenant.
      expect(rows[0]).toEqual({ sel: true, ins: true, upd: true, del: true, trunc: false });
    });

    it('can append to the audit log but cannot rewrite it', async () => {
      const { rows } = await db().app.query<Record<string, boolean>>(
        `SELECT has_table_privilege($1, '"AuditEvent"', 'SELECT') AS sel,
                has_table_privilege($1, '"AuditEvent"', 'INSERT') AS ins,
                has_table_privilege($1, '"AuditEvent"', 'UPDATE') AS upd,
                has_table_privilege($1, '"AuditEvent"', 'DELETE') AS del`,
        [appRole]
      );

      expect(rows[0]).toEqual({ sel: true, ins: true, upd: false, del: false });
    });

    it("cannot reach Prisma's migration ledger at all", async () => {
      const { rows } = await db().app.query<{ allowed: boolean }>(
        `SELECT has_table_privilege($1, '"_prisma_migrations"', 'SELECT') AS allowed`,
        [appRole]
      );

      // The one table with no policy, so the only defence is that the
      // application holds no privilege on it.
      expect(rows[0]?.allowed).toBe(false);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Coverage: which tables are protected, and how.                          */
  /* ---------------------------------------------------------------------- */

  describe('policy coverage', () => {
    it('enables AND forces row-level security on every table but the migration ledger', async () => {
      const { rows } = await db().owner.query<{
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }>(
        `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'r'
          ORDER BY c.relname`
      );

      const unprotected = rows
        .filter((row) => !row.relrowsecurity || !row.relforcerowsecurity)
        .map((row) => row.relname);

      // Phrased as "everything except this one" rather than as a list of
      // expected names, so a table added by a future migration without a policy
      // fails here instead of quietly sitting outside the model.
      expect(unprotected).toEqual(['_prisma_migrations']);
      expect(rows).toHaveLength(TENANT_SCOPED_MODELS.length + 2);
    });

    it('gives every protected table one tenant_isolation policy covering all four verbs', async () => {
      const { rows } = await db().owner.query<{
        tablename: string;
        policyname: string;
        cmd: string;
        qual: string | null;
        with_check: string | null;
      }>(`SELECT tablename, policyname, cmd, qual, with_check
            FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename`);

      expect(rows).toHaveLength(TENANT_SCOPED_MODELS.length + 1);
      expect(rows.every((row) => row.policyname === 'tenant_isolation')).toBe(true);
      // FOR ALL is what makes one policy cover SELECT, INSERT, UPDATE and
      // DELETE; a set of per-command policies would leave whichever verb was
      // forgotten wide open.
      expect(rows.every((row) => row.cmd === 'ALL')).toBe(true);
      // Both halves on every table: USING alone would let a write create a row
      // belonging to somebody else.
      expect(rows.every((row) => row.qual !== null && row.with_check !== null)).toBe(true);

      const tables = new Set(rows.map((row) => row.tablename));
      for (const model of TENANT_SCOPED_MODELS) {
        expect(tables.has(model)).toBe(true);
      }
      expect(tables.has('Organisation')).toBe(true);
    });

    it('keys the Organisation policy on its own id, since it carries no tenantId', async () => {
      const { rows } = await db().owner.query<{ qual: string | null }>(
        `SELECT qual FROM pg_policies WHERE schemaname = 'public' AND tablename = 'Organisation'`
      );

      expect(rows[0]?.qual).toContain('id =');
      expect(rows[0]?.qual).toContain(TENANT_SETTING);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* The headline: A cannot reach B.                                         */
  /* ---------------------------------------------------------------------- */

  describe('as the application role, tenant A cannot reach tenant B', () => {
    it('sees only its own patients', async () => {
      const { rows } = await asTenant<{ id: string }>(
        db().app,
        TENANT_A,
        'SELECT "id" FROM "Patient" ORDER BY "id"'
      );

      expect(rows.map((row) => row.id)).toEqual([PATIENT_A]);
    });

    it("cannot read tenant B's patient even knowing the id", async () => {
      const { rows } = await asTenant(
        db().app,
        TENANT_A,
        'SELECT "id" FROM "Patient" WHERE "id" = $1',
        [PATIENT_B]
      );

      expect(rows).toEqual([]);
    });

    it("cannot update tenant B's patient", async () => {
      const { rowCount } = await asTenant(
        db().app,
        TENANT_A,
        `UPDATE "Patient" SET "familyName" = 'Rewritten' WHERE "id" = $1`,
        [PATIENT_B]
      );

      expect(rowCount).toBe(0);

      const after = await asTenant<{ familyName: string }>(
        db().app,
        TENANT_B,
        'SELECT "familyName" FROM "Patient" WHERE "id" = $1',
        [PATIENT_B]
      );
      expect(after.rows[0]?.familyName).toBe('Patientsson');
    });

    it("cannot delete tenant B's patient", async () => {
      const { rowCount } = await asTenant(
        db().app,
        TENANT_A,
        'DELETE FROM "Patient" WHERE "id" = $1',
        [PATIENT_B]
      );

      expect(rowCount).toBe(0);

      const after = await asTenant(
        db().app,
        TENANT_B,
        'SELECT "id" FROM "Patient" WHERE "id" = $1',
        [PATIENT_B]
      );
      expect(after.rows).toHaveLength(1);
    });

    it("refuses an insert that carries tenant B's id", async () => {
      await expect(
        asTenant(
          db().app,
          TENANT_A,
          `INSERT INTO "Patient"
             ("id", "tenantId", "mrn", "givenName", "familyName", "birthDate", "updatedAt")
             VALUES ($1, $2, 'OR-900001', 'Testina', 'Patientsson', DATE '1994-03-02', now())`,
          [randomUUID(), TENANT_B]
        )
        // 42501 is insufficient_privilege: the WITH CHECK clause rejected the
        // row. An error, not a silent no-op, which is the right outcome for a
        // write that was asked to cross the boundary.
      ).rejects.toMatchObject({ code: '42501' });
    });

    it('accepts the same insert when it carries its own tenant id', async () => {
      const id = randomUUID();
      const { rowCount } = await asTenant(
        db().app,
        TENANT_A,
        `INSERT INTO "Patient"
           ("id", "tenantId", "mrn", "givenName", "familyName", "birthDate", "updatedAt")
           VALUES ($1, $2, 'OR-900002', 'Testina', 'Patientsson', DATE '1994-03-02', now())`,
        [id, TENANT_A]
      );

      // The control. Without it, the refusal above could just mean "inserts
      // never work".
      expect(rowCount).toBe(1);

      await asTenant(db().app, TENANT_A, 'DELETE FROM "Patient" WHERE "id" = $1', [id]);
    });

    it('cannot hand one of its own rows to another tenant', async () => {
      await expect(
        asTenant(db().app, TENANT_A, 'UPDATE "Patient" SET "tenantId" = $1 WHERE "id" = $2', [
          TENANT_B,
          PATIENT_A,
        ])
      ).rejects.toMatchObject({ code: '42501' });
    });

    it('sees exactly one organisation: its own', async () => {
      const { rows } = await asTenant<{ id: string }>(
        db().app,
        TENANT_A,
        'SELECT "id" FROM "Organisation"'
      );

      expect(rows.map((row) => row.id)).toEqual([TENANT_A]);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Fail closed.                                                            */
  /* ---------------------------------------------------------------------- */

  describe('a session that never declared a tenant', () => {
    it('reads zero rows rather than every row', async () => {
      const patients = await db().app.query('SELECT "id" FROM "Patient"');
      const organisations = await db().app.query('SELECT "id" FROM "Organisation"');

      // The whole design rests on this: a caller that forgets the setting
      // causes an outage, not a breach.
      expect(patients.rows).toEqual([]);
      expect(organisations.rows).toEqual([]);
    });

    it('writes nothing rather than everything', async () => {
      const update = await db().app.query(`UPDATE "Patient" SET "familyName" = 'Rewritten'`);
      const remove = await db().app.query('DELETE FROM "Patient"');

      expect(update.rowCount).toBe(0);
      expect(remove.rowCount).toBe(0);

      for (const [tenant, patient] of [
        [TENANT_A, PATIENT_A],
        [TENANT_B, PATIENT_B],
      ] as const) {
        const { rows } = await asTenant<{ familyName: string }>(
          db().app,
          tenant,
          'SELECT "familyName" FROM "Patient" WHERE "id" = $1',
          [patient]
        );
        expect(rows[0]?.familyName).toBe('Patientsson');
      }
    });

    it('survives the empty string a reset setting leaves behind', async () => {
      // A customized option that has been set and then reset reads back as ''
      // rather than as NULL, and ''::uuid raises `invalid input syntax`. This
      // is what the `nullif(..., '')` in every policy is for: without it the
      // first query on a recycled connection would fail with a cast error
      // instead of returning nothing.
      await db().app.query('BEGIN');
      await db().app.query('SELECT set_config($1, $2, true)', [TENANT_SETTING, TENANT_A]);
      await db().app.query('COMMIT');

      const reset = await db().app.query<{ value: string | null }>(
        'SELECT current_setting($1, true) AS value',
        [TENANT_SETTING]
      );
      expect(reset.rows[0]?.value).toBe('');

      await expect(db().app.query('SELECT "id" FROM "Patient"')).resolves.toMatchObject({
        rows: [],
      });
    });

    it('reads zero rows for an organisation that does not exist', async () => {
      const { rows } = await asTenant(db().app, UNKNOWN_TENANT, 'SELECT "id" FROM "Patient"');

      expect(rows).toEqual([]);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* FORCE.                                                                  */
  /* ---------------------------------------------------------------------- */

  describe('FORCE ROW LEVEL SECURITY, checked against the table owner', () => {
    it('is being asserted against a role that could otherwise ignore it', async () => {
      const { rows } = await db().owner.query<{
        rolsuper: boolean;
        rolbypassrls: boolean;
        owns: boolean;
      }>(
        `SELECT r.rolsuper,
                r.rolbypassrls,
                (SELECT pg_get_userbyid(c.relowner) = $1
                   FROM pg_class c
                   JOIN pg_namespace n ON n.oid = c.relnamespace
                  WHERE n.nspname = 'public' AND c.relname = 'Patient') AS owns
           FROM pg_roles r WHERE r.rolname = $1`,
        [ownerRole]
      );

      // Without this, the assertions below would also pass on a database where
      // RLS had never been enabled: a superuser sees everything either way.
      expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false, owns: true });
    });

    it('filters the owner exactly like anybody else', async () => {
      const undeclared = await db().owner.query('SELECT "id" FROM "Patient"');
      // ENABLE alone would return both patients here, because the owner is
      // exempt from its own policies until FORCE says otherwise.
      expect(undeclared.rows).toEqual([]);

      const declared = await asTenant<{ id: string }>(
        db().owner,
        TENANT_A,
        'SELECT "id" FROM "Patient" ORDER BY "id"'
      );
      expect(declared.rows.map((row) => row.id)).toEqual([PATIENT_A]);
    });

    it("stops the owner deleting another tenant's row", async () => {
      const { rowCount } = await asTenant(
        db().owner,
        TENANT_A,
        'DELETE FROM "Patient" WHERE "id" = $1',
        [PATIENT_B]
      );

      expect(rowCount).toBe(0);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Connection reuse.                                                       */
  /* ---------------------------------------------------------------------- */

  describe('a reused connection', () => {
    it("does not carry one transaction's tenant into the next statement", async () => {
      const first = await asTenant<{ id: string }>(
        db().app,
        TENANT_A,
        'SELECT "id" FROM "Patient"'
      );
      expect(first.rows.map((row) => row.id)).toEqual([PATIENT_A]);

      // Same physical connection, no BEGIN, no setting: the local value went
      // away at COMMIT. This is what makes a pool safe, and it is why nothing
      // in this codebase issues a session-level SET.
      const after = await db().app.query('SELECT "id" FROM "Patient"');
      expect(after.rows).toEqual([]);
    });

    it('would carry it if the setting were session-scoped, which is why it is not', async () => {
      // Demonstrates the bug being avoided rather than merely asserting its
      // absence: is_local => false is what a plain `SET openrunic.tenant_id`
      // does, and the leak it causes appears only under connection reuse - in
      // production, under load, as one organisation reading another's chart.
      await db().app.query('SELECT set_config($1, $2, false)', [TENANT_SETTING, TENANT_A]);
      const leaked = await db().app.query('SELECT "id" FROM "Patient"');
      expect(leaked.rows).toHaveLength(1);

      await db().app.query('SELECT set_config($1, $2, false)', [TENANT_SETTING, '']);
      expect((await db().app.query('SELECT "id" FROM "Patient"')).rows).toEqual([]);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* The path the application actually takes.                                */
  /* ---------------------------------------------------------------------- */

  describe('withTenantSession, through Prisma, as the application role', () => {
    it('shows each tenant only its own patients', async () => {
      const seenByA = await withTenantSession(db().prisma, { tenantId: TENANT_A }, (tx) =>
        tx.patient.findMany({ select: { id: true } })
      );
      const seenByB = await withTenantSession(db().prisma, { tenantId: TENANT_B }, (tx) =>
        tx.patient.findMany({ select: { id: true } })
      );

      expect(seenByA.map((row) => row.id)).toEqual([PATIENT_A]);
      expect(seenByB.map((row) => row.id)).toEqual([PATIENT_B]);
    });

    it('declares the tenant inside the transaction', async () => {
      const inside = await withTenantSession(
        db().prisma,
        { tenantId: TENANT_A },
        (tx) =>
          tx.$queryRaw<
            { value: string | null }[]
          >`SELECT current_setting(${TENANT_SETTING}, true) AS value`
      );

      expect(inside[0]?.value).toBe(TENANT_A);
    });

    it('reads nothing when the tenant client is used without a session', async () => {
      // The failure mode of the wiring, exercised deliberately: a caller that
      // reaches past `withTenantSession` for `createTenantClient` alone gets an
      // empty result set, never another organisation's chart.
      const unscoped = createTenantClient(db().prisma, { tenantId: TENANT_A });

      await expect(unscoped.patient.findMany({ select: { id: true } })).resolves.toEqual([]);
    });

    it("cannot amend another tenant's row", async () => {
      await expect(
        withTenantSession(db().prisma, { tenantId: TENANT_A }, (tx) =>
          tx.patient.updateMany({ where: { id: PATIENT_B }, data: { familyName: 'Rewritten' } })
        )
      ).resolves.toEqual({ count: 0 });
    });
  });

  /* ---------------------------------------------------------------------- */
  /* How a unique violation reaches the application.                          */
  /* ---------------------------------------------------------------------- */

  /**
   * The premise the API's conflict mapping rests on, asserted where it is true.
   *
   * `apps/api` enforces a spec's natural key by reading inside the create's
   * transaction and then inserting, which under READ COMMITTED is
   * check-then-write: two connections both find no clash, both pass, and the
   * table's unique index decides. The loser's error is what the API has to
   * recognise, and it recognises it by `error.code === 'P2002'` - deliberately
   * duck-typed, because Prisma's error classes are identities in one copy of
   * its runtime and a build resolving two makes `instanceof` answer false for
   * exactly the error being asked about.
   *
   * That leaves one fact no unit test can supply: whether Postgres really
   * raises this for a real unique index and whether Prisma really spells it
   * that way. A fake port asserting `P2002` would be asserting its own fixture.
   * So it is asserted here, through the same client the application uses, and
   * both under contention and without it - a raced duplicate and a sequential
   * one are the same violation, and the mapping would be wrong if only one of
   * them carried the code.
   */
  describe('a unique violation, as the application client reports it', () => {
    /** Seeded by the fixture, so this address is already taken in tenant A. */
    const TAKEN = 'reader.one@clinic.invalid';
    /** Free at the start of every case here, and contested inside one of them. */
    const CONTESTED = 'contested.reader@clinic.invalid';

    function newUser(email: string): Record<string, unknown> {
      return {
        id: randomUUID(),
        tenantId: TENANT_A,
        email,
        givenName: 'Testy',
        familyName: 'Readerson',
      };
    }

    function create(client: PrismaClient, email: string): Promise<unknown> {
      return withTenantSession(client, { tenantId: TENANT_A }, (tx) =>
        tx.user.create({ data: newUser(email) as never })
      );
    }

    /*
     * This block removes the rows it writes rather than leaving them for the
     * fixture teardown. Nothing else here counts users today, and a row seeded
     * for everybody is how an unrelated assertion goes red for a reason that
     * has nothing to do with what it asserts.
     */
    afterEach(async () => {
      await asTenant(db().owner, TENANT_A, 'DELETE FROM "User" WHERE "email" = $1', [CONTESTED]);
    });

    it('is reported as P2002 when the key is already taken', async () => {
      await expect(create(db().prisma, TAKEN)).rejects.toMatchObject({ code: 'P2002' });
    });

    it('is reported as P2002 by the loser of a genuine race, and there is exactly one loser', async () => {
      /*
       * Two clients, so two connections, so a real race rather than two awaits
       * on one. Both transactions insert the same key; the index admits one
       * and refuses the other, and which one is not decided here.
       *
       * The assertion that matters is the shape: one fulfilled, one rejected,
       * and the rejection carrying the code the API keys on. Asserting only
       * that one of them failed would pass just as well if Postgres had
       * reported a deadlock or a serialization failure, which the API does
       * not map and must not.
       */
      const contender = createPrismaClient({ datasourceUrl: appUrl });
      try {
        const results = await Promise.allSettled([
          create(db().prisma, CONTESTED),
          create(contender, CONTESTED),
        ]);

        expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
        const loser = results.find((result) => result.status === 'rejected');
        expect(loser?.reason).toMatchObject({ code: 'P2002' });
      } finally {
        await contender.$disconnect();
      }
    });

    it('leaves exactly one row behind, which is the point of the index', async () => {
      const contender = createPrismaClient({ datasourceUrl: appUrl });
      try {
        await Promise.allSettled([create(db().prisma, CONTESTED), create(contender, CONTESTED)]);

        const { rows } = await asTenant<{ count: string }>(
          db().app,
          TENANT_A,
          'SELECT count(*)::text AS count FROM "User" WHERE "email" = $1',
          [CONTESTED]
        );

        // The half a "one of them failed" assertion cannot see: a race that
        // refused both, or admitted both, would still have produced one
        // rejection somewhere in a longer run.
        expect(rows[0]?.count).toBe('1');
      } finally {
        await contender.$disconnect();
      }
    });
  });

  /* ---------------------------------------------------------------------- */
  /* The break-glass write door.                                             */
  /* ---------------------------------------------------------------------- */

  /**
   * The bounds on emergency access, checked where they are actually enforced.
   *
   * These are not row-level security, and they are here because this fixture is
   * the only place in the repository that replays the committed migration SQL
   * against a real server. `break_glass_ceiling` is plpgsql: it takes an
   * advisory lock and refuses under it, and no unit test with a fake port can
   * say whether the SQL that will be applied to production does either. The
   * assertions that matter most are the concurrent ones, and they need two real
   * connections - which is exactly what a suite built on a live database has
   * and nothing else here does.
   *
   * The API keeps its own copy of these bounds so it can refuse readably, and
   * `apps/api` asserts that copy. This asserts the one that is true.
   */
  describe('the break-glass write door, against a real database', () => {
    /** A fresh connection as the application role, for the concurrent cases. */
    async function secondConnection(): Promise<Client> {
      const client = new Client({ connectionString: appUrl });
      await client.connect();
      return client;
    }

    async function declare(
      client: Client,
      reader: string,
      patient: string,
      minutes = 60
    ): Promise<{ rows: { id: string }[]; rowCount: number }> {
      return asTenant<{ id: string }>(
        client,
        TENANT_A,
        `INSERT INTO "BreakGlassGrant"
           ("id", "tenantId", "userId", "patientId", "reason", "grantedAt", "expiresAt", "updatedAt")
         VALUES (gen_random_uuid(), $1, $2, $3, 'Collapsed in reception.', now(),
                 now() + make_interval(mins => $4::int), now())
         RETURNING "id"`,
        [TENANT_A, reader, patient, minutes]
      );
    }

    /*
     * This block builds and removes its own second chart rather than adding one
     * to the fixture.
     *
     * Five assertions above count the patients in a tenant, and a row seeded
     * once for everybody turned all five red - each of them correct, and each
     * failing for a reason that had nothing to do with what it asserts. A
     * fixture shared by a whole file is not free to grow.
     */
    beforeEach(async () => {
      // Each case starts from an empty table. The bounds count rows, so a case
      // that inherited the previous one's grants would pass or fail for a
      // reason that has nothing to do with what it asserts.
      await asTenant(db().owner, TENANT_A, 'DELETE FROM "BreakGlassGrant"');
      await asTenant(
        db().owner,
        TENANT_A,
        `INSERT INTO "Patient"
           ("id", "tenantId", "mrn", "givenName", "familyName", "birthDate", "updatedAt")
           VALUES ($1, $2, 'OR-100483', 'Testolina', 'Patientsson', DATE '1988-11-19', now())`,
        [SECOND_PATIENT_A, TENANT_A]
      );
    });

    afterEach(async () => {
      await asTenant(db().owner, TENANT_A, 'DELETE FROM "BreakGlassGrant"');
      await asTenant(db().owner, TENANT_A, 'DELETE FROM "Patient" WHERE "id" = $1', [
        SECOND_PATIENT_A,
      ]);
    });

    it('files a first declaration', async () => {
      /* The control. Every refusal below passes for a table nobody can write. */
      const { rowCount } = await declare(db().app, READER_A, PATIENT_A);

      expect(rowCount).toBe(1);
    });

    it('refuses a second unexpired declaration for the same chart', async () => {
      await declare(db().app, READER_A, PATIENT_A);

      await expect(declare(db().app, READER_A, PATIENT_A)).rejects.toMatchObject({
        // `unique_violation`: at most one unexpired grant per reader per chart.
        code: '23505',
      });
    });

    it('files one row, not two, when the same chart is declared on two connections at once', async () => {
      /*
       * The race the handler cannot close on its own, and the reason this
       * refusal is in the trigger rather than only in the application.
       *
       * Both statements are in flight before either commits. Under READ
       * COMMITTED neither transaction can see the other's uncommitted row, so
       * an existence check outside the lock passes in both. The advisory lock
       * the trigger takes on (tenant, user) is what serialises them.
       */
      const other = await secondConnection();
      try {
        const results = await Promise.allSettled([
          declare(db().app, READER_A, PATIENT_A),
          declare(other, READER_A, PATIENT_A),
        ]);

        expect(results.map((result) => result.status).toSorted()).toEqual([
          'fulfilled',
          'rejected',
        ]);
        const { rows } = await asTenant<{ count: string }>(
          db().app,
          TENANT_A,
          'SELECT count(*)::text AS count FROM "BreakGlassGrant"'
        );
        expect(rows[0]?.count).toBe('1');
      } finally {
        await other.end();
      }
    });

    it('lets a second reader declare on the same chart', async () => {
      /*
       * The bound is per reader, not per chart. Two clinicians reaching the
       * same emergency is the situation this route exists for, and a refusal
       * here would be the control failing closed on the case it was built to
       * serve.
       */
      await declare(db().app, READER_A, PATIENT_A);

      await expect(declare(db().app, SECOND_READER_A, PATIENT_A)).resolves.toMatchObject({
        rowCount: 1,
      });
    });

    it('lets the same reader declare on a different chart', async () => {
      /*
       * The other half of "per reader per chart". One clinician walking a bad
       * afternoon is what the ceiling and the rolling bound are for; refusing
       * the second chart here would be this refusal doing their job badly.
       */
      await declare(db().app, READER_A, PATIENT_A);

      await expect(declare(db().app, READER_A, SECOND_PATIENT_A)).resolves.toMatchObject({
        rowCount: 1,
      });
    });

    it('lets a reader re-declare once the first window has closed', async () => {
      /*
       * "Unexpired" has to mean unexpired. A refusal that outlived the window
       * would turn a short grant into a lockout on the one chart a clinician
       * has already been trusted with, and the window is deliberately short.
       */
      await asTenant(
        db().app,
        TENANT_A,
        `INSERT INTO "BreakGlassGrant"
           ("id", "tenantId", "userId", "patientId", "reason", "grantedAt", "expiresAt", "updatedAt")
         VALUES (gen_random_uuid(), $1, $2, $3, 'Earlier today.',
                 now() - interval '2 hours', now() - interval '1 hour', now())`,
        [TENANT_A, READER_A, PATIENT_A]
      );

      await expect(declare(db().app, READER_A, PATIENT_A)).resolves.toMatchObject({ rowCount: 1 });
    });
  });
});
