import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  appliedMigrations,
  busiestPatient,
  chartFingerprint,
  copyIntoContainer,
  dumpToFile,
  listArchive,
  rowCounts,
  serverVersion,
  type PostgresTarget,
} from '../db/postgres.js';

/**
 * Taking a backup that can be proved rather than hoped for.
 *
 * A dump file on its own answers "did something get written". The manifest
 * beside it answers "is what got written the database that existed", because it
 * carries the row counts, the applied migration list and a per-table digest of
 * one patient's chart, all read from the same database in the same minute. A
 * restore that reproduces those numbers is a restore that worked.
 */

export interface BackupManifest {
  readonly formatVersion: 1;
  readonly createdAt: string;
  readonly archive: string;
  readonly archiveBytes: number;
  readonly archiveSha256: string;
  readonly postgresVersion: string;
  readonly database: string;
  readonly appliedMigrations: readonly string[];
  readonly rowCounts: Readonly<Record<string, number>>;
  readonly totalRows: number;
  /** The patient whose chart the digest below covers, or null on an empty database. */
  readonly samplePatientId: string | null;
  readonly sampleChartDigests: Readonly<Record<string, string>>;
  /**
   * Object storage included in this backup.
   *
   * Empty, and honestly so: this stack has no object store. Documents live in
   * Postgres today. When a blob store is added, its contents must be captured
   * here or a restore will bring back charts whose attachments are gone.
   */
  readonly objectStores: readonly string[];
}

export interface BackupResult {
  readonly archivePath: string;
  readonly manifestPath: string;
  readonly manifest: BackupManifest;
  readonly durationMs: number;
  readonly pruned: readonly string[];
}

async function sha256(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest('hex');
}

/** `openrunic-20260813T121500Z` - sorts chronologically as a plain string. */
export function backupName(now: Date): string {
  return `openrunic-${now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z')}`;
}

export interface BackupOptions {
  readonly target: PostgresTarget;
  readonly directory: string;
  readonly retainDays: number;
  readonly now?: () => Date;
}

export async function takeBackup(options: BackupOptions): Promise<BackupResult> {
  const now = options.now ?? ((): Date => new Date());
  const startedAt = Date.now();
  const stamp = now();

  await mkdir(options.directory, { recursive: true });

  const name = backupName(stamp);
  const archivePath = path.join(options.directory, `${name}.dump`);
  const manifestPath = path.join(options.directory, `${name}.manifest.json`);

  // Read the state BEFORE dumping, so the manifest describes at worst a
  // slightly older database than the archive. The other order can record counts
  // that are higher than what the dump contains and fail its own verification.
  const [version, migrations, counts] = await Promise.all([
    serverVersion(options.target),
    appliedMigrations(options.target),
    rowCounts(options.target),
  ]);

  // No .catch here, deliberately. busiestPatient already returns null when the
  // database has no encounters, so the only thing a catch could swallow is a
  // real failure - and a failure is not an empty database. Swallowing it writes
  // a manifest with no chart fingerprint, and a manifest with no fingerprint
  // verifies vacuously: the sample-chart check is skipped and the backup is
  // reported sound on the strength of evidence that was never collected. The
  // same shape of bug was already fixed once in docker-migrate-helper.mjs.
  const samplePatientId = await busiestPatient(options.target);
  const sampleChartDigests =
    samplePatientId === null ? {} : await chartFingerprint(options.target, samplePatientId);

  await dumpToFile(options.target, archivePath);

  const archiveStat = await stat(archivePath);
  const manifest: BackupManifest = {
    formatVersion: 1,
    createdAt: stamp.toISOString(),
    archive: path.basename(archivePath),
    archiveBytes: archiveStat.size,
    archiveSha256: await sha256(archivePath),
    postgresVersion: version,
    database: options.target.database,
    appliedMigrations: migrations,
    rowCounts: counts,
    totalRows: Object.values(counts).reduce((sum, count) => sum + count, 0),
    samplePatientId,
    sampleChartDigests,
    objectStores: [],
  };

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const pruned = await pruneOldBackups(options.directory, options.retainDays, stamp, name);

  return {
    archivePath,
    manifestPath,
    manifest,
    durationMs: Date.now() - startedAt,
    pruned,
  };
}

/**
 * Deletes backups older than the retention window.
 *
 * Only ever called immediately after a successful new backup, and never on a
 * schedule of its own. A week of failing backup jobs must not be able to age
 * out the last good copy while nobody is looking.
 */
export async function pruneOldBackups(
  directory: string,
  retainDays: number,
  now: Date,
  keepName: string
): Promise<string[]> {
  if (retainDays <= 0) return [];

  const cutoff = now.getTime() - retainDays * 24 * 60 * 60 * 1000;
  const entries = await readdir(directory);
  const removed: string[] = [];

  for (const entry of entries) {
    if (!entry.startsWith('openrunic-')) continue;
    if (entry.startsWith(keepName)) continue;

    const full = path.join(directory, entry);
    const info = await stat(full);
    if (info.mtimeMs >= cutoff) continue;

    await rm(full, { force: true });
    removed.push(entry);
  }

  return removed;
}

/**
 * True for a name that is a file in one directory and nothing else.
 *
 * `path.basename` collapses any traversal to its last segment, so a value that
 * survives this comparison cannot climb, cannot be absolute, and cannot name a
 * directory. Windows separators are checked explicitly because `path.posix` and
 * `path.win32` disagree about what `a\b` means, and a manifest written on one
 * platform is routinely read on the other.
 */
function isPlainFilename(value: string): boolean {
  return (
    value !== '' &&
    !value.includes('\\') &&
    !path.isAbsolute(value) &&
    path.basename(value) === value &&
    value !== '.' &&
    value !== '..'
  );
}

/**
 * Reads a manifest, and treats it as what it is: a file from somewhere else.
 *
 * A manifest is not internal state. Backups are copied to other disks, carried
 * on removable media and restored on machines that never took them, so by the
 * time this reads one it is untrusted input that happens to have been written
 * by us last time. It used to be cast straight to `BackupManifest` after an
 * `object` check, which made every field a lie the type system repeated: a
 * hand-edited `archive` of `../../etc/passwd` became a path the restore
 * followed, and a numeric `archive` became a TypeError several frames away
 * from the file that caused it.
 *
 * `archive` is held to a plain filename beside the manifest. That is the only
 * thing `takeBackup` ever writes, so nothing legitimate is refused, and it
 * removes the question of where a restore can be pointed.
 */
export async function readManifest(manifestPath: string): Promise<BackupManifest> {
  const parsed: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${manifestPath} is not a backup manifest`);
  }

  const candidate = parsed as Partial<BackupManifest>;
  if (candidate.formatVersion !== 1) {
    throw new Error(
      `${manifestPath} declares backup format ${String(candidate.formatVersion)}; this build reads format 1`
    );
  }
  if (typeof candidate.archive !== 'string' || !isPlainFilename(candidate.archive)) {
    throw new Error(
      `${manifestPath} names its archive as ${JSON.stringify(candidate.archive)}. A manifest may only name a file beside itself.`
    );
  }
  if (typeof candidate.archiveSha256 !== 'string' || candidate.archiveSha256 === '') {
    throw new Error(`${manifestPath} has no archive checksum, so its archive cannot be verified`);
  }

  // Everything verification compares against, checked here rather than trusted.
  //
  // The cast this replaces was the dangerous kind: not a crash risk, a silence
  // risk. `verifyBackup` iterates `rowCounts` and `sampleChartDigests` and
  // reports a check as passing when nothing mismatched - so a manifest whose
  // rowCounts was absent, or an empty object, produced zero mismatches and a
  // green "row counts" line. A restore proved sound by comparing nothing
  // against nothing is worse than an unverified one, because someone believes
  // it.
  if (!isCountRecord(candidate.rowCounts)) {
    throw new Error(
      `${manifestPath} has no usable rowCounts, so a restore of it cannot be checked against anything`
    );
  }
  if (!Array.isArray(candidate.appliedMigrations) || !candidate.appliedMigrations.every(isString)) {
    throw new Error(`${manifestPath} has no usable migration history`);
  }
  if (candidate.samplePatientId !== null && typeof candidate.samplePatientId !== 'string') {
    throw new Error(`${manifestPath} has a malformed samplePatientId`);
  }
  // A sample patient without digests is the vacuous case in miniature: the
  // check would run, compare an empty set, and pass.
  if (!isDigestRecord(candidate.sampleChartDigests)) {
    throw new Error(`${manifestPath} has malformed sampleChartDigests`);
  }
  if (
    candidate.samplePatientId !== null &&
    Object.keys(candidate.sampleChartDigests).length === 0
  ) {
    throw new Error(
      `${manifestPath} names a sample patient but carries no chart digests for them, so the sample-chart check would pass without comparing anything`
    );
  }

  return parsed as BackupManifest;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isCountRecord(value: unknown): value is Record<string, number> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.values(value).every((entry) => typeof entry === 'number');
}

function isDigestRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.values(value).every(isString);
}

/** The newest backup in a directory, by manifest timestamp. */
export async function latestBackup(directory: string): Promise<string | null> {
  const entries = await readdir(directory).catch(() => [] as string[]);
  const manifests = entries.filter((entry) => entry.endsWith('.manifest.json')).sort();
  const newest = manifests.at(-1);
  return newest === undefined ? null : path.join(directory, newest);
}

export interface VerifyResult {
  readonly ok: boolean;
  readonly checks: readonly { name: string; ok: boolean; detail: string }[];
  readonly durationMs: number;
}

/**
 * Proves a backup is restorable by restoring it.
 *
 * Into a scratch database, never the live one, and then compared against the
 * manifest table by table. This is the only check that distinguishes a backup
 * from a file: an archive nobody has ever restored is a hypothesis.
 */
export async function verifyBackup(
  target: PostgresTarget,
  manifestPath: string,
  archivePath: string,
  scratchDatabase: string,
  restore: (archiveInContainer: string, into: string) => Promise<void>
): Promise<VerifyResult> {
  const startedAt = Date.now();
  const checks: { name: string; ok: boolean; detail: string }[] = [];
  const manifest = await readManifest(manifestPath);

  const digest = await sha256(archivePath);
  checks.push({
    name: 'archive checksum',
    ok: digest === manifest.archiveSha256,
    detail:
      digest === manifest.archiveSha256
        ? 'matches the manifest'
        : 'DOES NOT match the manifest - the archive has changed since it was written',
  });

  const inContainer = `/tmp/${path.basename(archivePath)}`;
  await copyIntoContainer(target, archivePath, inContainer);

  const toc = await listArchive(target, inContainer);
  checks.push({
    name: 'archive readable',
    ok: toc.length > 0,
    detail: `${String(toc.length)} objects in the table of contents`,
  });

  await restore(inContainer, scratchDatabase);

  const scratch: PostgresTarget = { ...target, database: scratchDatabase };
  const counts = await rowCounts(scratch);

  const mismatches = Object.entries(manifest.rowCounts).filter(
    ([table, expected]) => counts[table] !== expected
  );
  checks.push({
    name: 'row counts',
    ok: mismatches.length === 0,
    detail:
      mismatches.length === 0
        ? `${String(Object.keys(manifest.rowCounts).length)} tables, ${String(manifest.totalRows)} rows, all matching`
        : `mismatched: ${mismatches
            .map(
              ([table, expected]) =>
                `${table} expected ${String(expected)} got ${String(counts[table] ?? 0)}`
            )
            .join('; ')}`,
  });

  const restoredMigrations = await appliedMigrations(scratch);
  checks.push({
    name: 'migration history',
    ok: restoredMigrations.join(',') === manifest.appliedMigrations.join(','),
    detail: `${String(restoredMigrations.length)} applied migration(s)`,
  });

  if (manifest.samplePatientId !== null) {
    const digests = await chartFingerprint(scratch, manifest.samplePatientId);
    const differing = Object.entries(manifest.sampleChartDigests).filter(
      ([table, expected]) => digests[table] !== expected
    );
    checks.push({
      name: 'sample patient chart',
      ok: differing.length === 0,
      detail:
        differing.length === 0
          ? `${String(Object.keys(manifest.sampleChartDigests).length)} tables digest-identical for patient ${manifest.samplePatientId}`
          : `differing tables: ${differing.map(([table]) => table).join(', ')}`,
    });
  }

  return {
    ok: checks.every((check) => check.ok),
    checks,
    durationMs: Date.now() - startedAt,
  };
}
