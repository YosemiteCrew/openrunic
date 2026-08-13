import { createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';

import { resolveCompose } from '../process/compose.js';
import { redact, type RunResult } from '../process/run.js';

/**
 * Talking to Postgres through the compose stack.
 *
 * Every command runs inside the database container with `compose exec -T`.
 * Nothing here needs the database port published on the host, which is why
 * docker-compose.yml does not publish it: the smallest attack surface for a
 * database holding patient records is one that is not reachable at all.
 *
 * `-T` matters. Without it compose allocates a pseudo-terminal, and a
 * pseudo-terminal mangles a binary pg_dump stream in ways that only show up
 * when someone tries to restore it.
 */

export interface PostgresTarget {
  readonly composeFile: string;
  readonly service: string;
  readonly user: string;
  readonly database: string;
}

/**
 * A Postgres identifier this tool is willing to interpolate into SQL.
 *
 * Database names reach `CREATE DATABASE`, which takes no bind parameters, so
 * the name has to go into the statement text. Restricting it to this shape is
 * what makes that safe. Everything else - ids, values - goes through a bind
 * parameter or `quote_literal`.
 */
const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function assertSafeIdentifier(value: string, what: string): string {
  if (!SAFE_IDENTIFIER.test(value)) {
    throw new Error(
      `${what} must be a plain Postgres identifier (letters, digits and underscore, starting with a letter or underscore). Got: ${value}`
    );
  }
  return value;
}

function execArgs(target: PostgresTarget, command: readonly string[]): string[] {
  return ['-f', target.composeFile, 'exec', '-T', target.service, ...command];
}

function spawnCompose(
  target: PostgresTarget,
  command: readonly string[],
  onStdout: ((chunk: Buffer) => void) | null
): Promise<RunResult> {
  const compose = resolveCompose();
  return new Promise((resolve, reject) => {
    const child = spawn(compose.command, [...compose.baseArgs, ...execArgs(target, command)], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      if (onStdout === null) stdout += chunk.toString('utf8');
      else onStdout(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (error) => {
      reject(new Error(redact(error.message)));
    });
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

/** Runs a command in the database container and returns its output. */
export async function execInDatabase(
  target: PostgresTarget,
  command: readonly string[]
): Promise<RunResult> {
  return spawnCompose(target, command, null);
}

/**
 * Runs a single SQL statement and returns unaligned, tab-separated rows.
 *
 * `-v ON_ERROR_STOP=1` is what makes a failing statement a failing command;
 * without it psql reports the error and exits zero, and a backup verification
 * that cannot fail is not a verification.
 */
export async function query(target: PostgresTarget, sql: string): Promise<string[][]> {
  const result = await execInDatabase(target, [
    'psql',
    '-U',
    target.user,
    '-d',
    target.database,
    '-v',
    'ON_ERROR_STOP=1',
    '--no-align',
    '--tuples-only',
    '--field-separator=\t',
    '-c',
    sql,
  ]);

  if (result.code !== 0) {
    throw new Error(`psql failed: ${redact(result.stderr).trim()}`);
  }

  return result.stdout
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line !== '')
    .map((line) => line.split('\t'));
}

/**
 * Exact row counts for every table in the public schema.
 *
 * `pg_stat_user_tables.n_live_tup` would be one cheap query, but it is a
 * planner estimate that drifts from the truth between analyses. A backup
 * verification compares these numbers to decide whether a restore is complete,
 * so they have to be counts and not guesses. `query_to_xml` runs a real
 * `count(*)` per table inside a single round trip.
 */
export async function rowCounts(target: PostgresTarget): Promise<Record<string, number>> {
  const rows = await query(
    target,
    `SELECT relname,
            (xpath('/row/c/text()', counted))[1]::text::bigint AS n
       FROM (
         SELECT relname,
                query_to_xml(format('SELECT count(*) AS c FROM %I.%I', schemaname, relname),
                             false, true, '') AS counted
           FROM pg_stat_user_tables
          WHERE schemaname = 'public'
       ) t
      ORDER BY relname`
  );

  const counts: Record<string, number> = {};
  for (const [table, count] of rows) {
    if (table === undefined || count === undefined) continue;
    counts[table] = Number.parseInt(count, 10);
  }
  return counts;
}

/** Migration names Prisma has recorded as applied, in order. */
export async function appliedMigrations(target: PostgresTarget): Promise<string[]> {
  try {
    const rows = await query(
      target,
      `SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY finished_at`
    );
    return rows.map((row) => row[0] ?? '').filter((name) => name !== '');
  } catch {
    // No migrations table yet is a legitimate state on a database that has
    // never been deployed to, not an error worth failing a backup over.
    return [];
  }
}

export async function serverVersion(target: PostgresTarget): Promise<string> {
  const rows = await query(target, 'SHOW server_version');
  return rows[0]?.[0] ?? 'unknown';
}

/**
 * A digest of everything stored about one patient.
 *
 * Row counts prove a restore brought back the right NUMBER of rows. They say
 * nothing about whether the contents survived. This walks every table with a
 * `patientId` column and hashes the full text form of each matching row, so a
 * single altered character in a note or a shifted timestamp changes the digest.
 *
 * That is the difference between "the restore ran" and "the chart is the chart".
 */
export async function chartFingerprint(
  target: PostgresTarget,
  patientId: string
): Promise<Record<string, string>> {
  if (!UUID.test(patientId)) {
    throw new Error(`chartFingerprint: patientId must be a UUID. Got: ${patientId}`);
  }

  const rows = await query(
    target,
    `SELECT c.table_name,
            coalesce((xpath('/row/d/text()',
              query_to_xml(
                format('SELECT md5(coalesce(string_agg(t::text, %L ORDER BY t::text), %L)) AS d FROM %I t WHERE t."patientId" = %L',
                       '|', 'empty', c.table_name, '${patientId}'),
                false, true, '')))[1]::text, 'error') AS digest
       FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.column_name = 'patientId'
      ORDER BY c.table_name`
  );

  const digests: Record<string, string> = {};
  for (const [table, digest] of rows) {
    if (table === undefined || digest === undefined) continue;
    digests[table] = digest;
  }
  return digests;
}

/** The patient with the most rows referencing them, for a meaningful sample. */
export async function busiestPatient(target: PostgresTarget): Promise<string | null> {
  const rows = await query(
    target,
    `SELECT e."patientId"::text
       FROM "Encounter" e
      GROUP BY e."patientId"
      ORDER BY count(*) DESC, e."patientId"::text ASC
      LIMIT 1`
  );
  return rows[0]?.[0] ?? null;
}

/**
 * Streams `pg_dump -Fc` straight to a file on the host.
 *
 * Custom format, not plain SQL: it is compressed, and `pg_restore` can read a
 * table list out of it, which is what makes the archive verifiable without
 * restoring it. --no-owner and --no-privileges keep the dump restorable into a
 * database owned by a different role, which is exactly the situation during a
 * disaster recovery on a rebuilt machine.
 */
export async function dumpToFile(target: PostgresTarget, destination: string): Promise<void> {
  const file = createWriteStream(destination);
  const finished = new Promise<void>((resolve, reject) => {
    file.on('error', reject);
    file.on('finish', resolve);
  });

  const result = await spawnCompose(
    target,
    [
      'pg_dump',
      '-U',
      target.user,
      '-d',
      target.database,
      '--format=custom',
      '--compress=9',
      '--no-owner',
      '--no-privileges',
    ],
    (chunk) => file.write(chunk)
  );

  file.end();
  await finished;

  if (result.code !== 0) {
    throw new Error(`pg_dump failed: ${redact(result.stderr).trim()}`);
  }
}

/** Copies a host file into the database container. */
export async function copyIntoContainer(
  target: PostgresTarget,
  source: string,
  destination: string
): Promise<void> {
  const compose = resolveCompose();
  const result = await new Promise<RunResult>((resolve, reject) => {
    const child = spawn(
      compose.command,
      [
        ...compose.baseArgs,
        '-f',
        target.composeFile,
        'cp',
        source,
        `${target.service}:${destination}`,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'], shell: false }
    );
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout: '', stderr });
    });
  });

  if (result.code !== 0) {
    throw new Error(`copying the archive into the container failed: ${redact(result.stderr)}`);
  }
}

/**
 * Drops and recreates a database, then restores an archive into it.
 *
 * The drop is the point. Restoring on top of existing rows produces a database
 * that is neither the backup nor what was there before, and every conflict is
 * reported as a warning that a tired operator at 2am reads as success.
 */
export async function restoreInto(
  target: PostgresTarget,
  archiveInContainer: string,
  intoDatabase: string
): Promise<void> {
  assertSafeIdentifier(intoDatabase, 'database name');

  const admin: PostgresTarget = { ...target, database: 'postgres' };

  // Sessions still attached to the database would block the drop. This is a
  // restore: whatever they are doing is being replaced anyway.
  await query(
    admin,
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = quote_ident('${intoDatabase}')::text AND pid <> pg_backend_pid()`
  );
  await query(admin, `DROP DATABASE IF EXISTS "${intoDatabase}"`);
  await query(admin, `CREATE DATABASE "${intoDatabase}"`);

  const result = await execInDatabase(target, [
    'pg_restore',
    '-U',
    target.user,
    '-d',
    intoDatabase,
    '--no-owner',
    '--no-privileges',
    '--exit-on-error',
    '--single-transaction',
    archiveInContainer,
  ]);

  if (result.code !== 0) {
    throw new Error(`pg_restore failed: ${redact(result.stderr).trim()}`);
  }
}

/**
 * Reads the archive's table of contents.
 *
 * This is the cheap integrity check: a truncated or corrupt custom-format
 * archive fails here, in milliseconds, rather than an hour into a restore
 * during an actual outage.
 */
export async function listArchive(
  target: PostgresTarget,
  archiveInContainer: string
): Promise<string[]> {
  const result = await execInDatabase(target, ['pg_restore', '--list', archiveInContainer]);
  if (result.code !== 0) {
    throw new Error(`the archive is not a readable custom-format dump: ${redact(result.stderr)}`);
  }
  return result.stdout.split('\n').filter((line) => line !== '' && !line.startsWith(';'));
}
