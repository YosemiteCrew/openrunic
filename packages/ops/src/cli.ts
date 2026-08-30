#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  latestBackup,
  readManifest,
  takeBackup,
  verifyBackup,
  type BackupManifest,
} from './commands/backup.js';
import { doctor, ensureEnvFile, type Check } from './commands/setup.js';
import { decideUpgrade, preflight } from './commands/upgrade.js';
import { copyIntoContainer, restoreInto, rowCounts, type PostgresTarget } from './db/postgres.js';
import { parseEnvLines } from './env/secrets.js';
import { isCodeSystemFormat, verifyCodeSystem } from './commands/terminology.js';
import { lintMigrationDirectory } from './migration-lint/lint.js';
import { formatAnnotations, formatHuman } from './migration-lint/report.js';
import { composeStreaming } from './process/compose.js';

/**
 * `openrunic-ops` - the operator's command line.
 *
 * Output is written for someone who runs this twice a year, at the worst
 * possible moment, from a terminal on a machine they do not use daily. So each
 * command says what it is about to do, what it did, and how long it took, and
 * failures name the next action rather than the internal error.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const COMPOSE_FILE = path.join(REPO_ROOT, 'docker-compose.yml');
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'packages/database/prisma/migrations');

function out(line = ''): void {
  process.stdout.write(`${line}\n`);
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Reads .env, falling back to the same defaults docker-compose.yml uses. */
async function loadConfig(): Promise<{
  target: PostgresTarget;
  backupDir: string;
  retainDays: number;
  webPort: string;
  apiPort: string;
}> {
  const contents = await readFile(path.join(REPO_ROOT, '.env'), 'utf8').catch(() => '');
  const values = new Map(
    parseEnvLines(contents)
      .filter((line) => line.key !== null)
      .map((line) => [line.key ?? '', line.value])
  );
  const read = (key: string, fallback: string): string => {
    const value = values.get(key);
    return value === undefined || value === '' ? fallback : value;
  };

  const backupDir = read('OPENRUNIC_BACKUP_DIR', './backups');

  return {
    target: {
      composeFile: COMPOSE_FILE,
      service: 'postgres',
      user: read('POSTGRES_USER', 'openrunic'),
      database: read('POSTGRES_DB', 'openrunic'),
    },
    backupDir: path.resolve(REPO_ROOT, backupDir),
    retainDays: Number.parseInt(read('OPENRUNIC_BACKUP_RETAIN_DAYS', '30'), 10),
    webPort: read('WEB_PORT', '3000'),
    apiPort: read('API_PORT', '4000'),
  };
}

function reportChecks(checks: readonly Check[]): boolean {
  for (const check of checks) {
    out(`  ${check.ok ? 'ok  ' : 'FAIL'}  ${check.name.padEnd(20)} ${check.detail}`);
    if (!check.ok && check.fix !== undefined) out(`        -> ${check.fix}`);
  }
  return checks.every((check) => check.ok);
}

async function commandDoctor(): Promise<number> {
  out('Checking prerequisites');
  out();
  return reportChecks(await doctor(REPO_ROOT)) ? 0 : 1;
}

/**
 * The timed install.
 *
 * The clock starts before the prerequisite checks and stops when the API serves
 * a real appointment out of Postgres, because that - not "the containers
 * started" - is the moment the practice can book someone in.
 */
async function commandSetup(argv: readonly string[]): Promise<number> {
  const startedAt = Date.now();
  const skipBuild = argv.includes('--skip-build');

  out('openrunic self-host install');
  out();

  const checks = await doctor(REPO_ROOT);
  if (!reportChecks(checks)) {
    out();
    out('Fix the failures above and run this again.');
    return 1;
  }

  out();
  const env = await ensureEnvFile(REPO_ROOT);
  out(`  ${env.created ? 'created' : 'found  '}  ${env.path}`);
  if (env.generated.length > 0) {
    // Names only. The values are in the file, mode 0600, and nowhere else.
    out(`  generated secrets for: ${env.generated.join(', ')}`);
  }
  if (env.missing.length > 0) {
    out(`  note: .env is missing keys the template has: ${env.missing.join(', ')}`);
  }

  out();
  out(skipBuild ? 'Starting the stack' : 'Building images and starting the stack');
  out('  (first run compiles the whole workspace; later runs reuse the layers)');
  out();

  const upArgs = ['up', '--detach', '--wait'];
  if (!skipBuild) upArgs.push('--build');

  const up = await composeStreaming(COMPOSE_FILE, upArgs, { inherit: true });
  if (up.code !== 0) {
    out();
    out('The stack did not start. The output above names the failing container.');
    out('`docker compose logs migrate` is usually the informative one.');
    return 1;
  }

  const config = await loadConfig();

  out();
  out('Verifying the install');
  const counts = await rowCounts(config.target);
  const patients = counts.Patient ?? 0;
  const appointments = counts.Appointment ?? 0;
  out(
    `  ok    demo practice        ${String(patients)} patients, ${String(appointments)} appointments`
  );

  const elapsed = Date.now() - startedAt;

  out();
  out('  ------------------------------------------------------------');
  out(`  openrunic is running.        install took ${seconds(elapsed)}`);
  out('  ------------------------------------------------------------');
  out();
  out(`  Web      http://localhost:${config.webPort}`);
  out(`  API      http://localhost:${config.apiPort}`);
  out();
  out('  Demo access tokens (send as: Authorization: Bearer <token>)');
  out('    dev-clinician-a    Dr. Adaeze Okafor, clinician');
  out('    dev-frontdesk-a    Front desk');
  out('    dev-biller-a       Billing');
  out();
  out('  These tokens are published in the source and are not secrets. This');
  out('  deployment has no authentication. Read docs/self-hosting.md before');
  out('  putting anything real into it.');

  return 0;
}

async function commandBackup(): Promise<number> {
  const config = await loadConfig();
  out('Taking a backup');

  const result = await takeBackup({
    target: config.target,
    directory: config.backupDir,
    retainDays: config.retainDays,
  });

  const megabytes = (result.manifest.archiveBytes / 1024 / 1024).toFixed(1);
  out(`  archive   ${result.archivePath} (${megabytes} MB)`);
  out(`  manifest  ${result.manifestPath}`);
  out(
    `  contents  ${String(result.manifest.totalRows)} rows across ${String(Object.keys(result.manifest.rowCounts).length)} tables`
  );
  out(`  took      ${seconds(result.durationMs)}`);
  if (result.pruned.length > 0) {
    out(`  pruned    ${String(result.pruned.length)} file(s) past the retention window`);
  }
  out();
  out('A backup nobody has restored is a hypothesis. Run `pnpm ops:verify-backup`.');
  return 0;
}

/** Resolves a manifest path from an argument, or finds the newest backup. */
async function resolveManifest(
  argument: string | undefined,
  backupDir: string
): Promise<{ manifestPath: string; archivePath: string; manifest: BackupManifest }> {
  const manifestPath =
    argument === undefined ? await latestBackup(backupDir) : path.resolve(argument);

  if (manifestPath === null) {
    throw new Error(`No backup found in ${backupDir}. Run \`pnpm ops:backup\` first.`);
  }

  const manifest = await readManifest(manifestPath);
  return {
    manifestPath,
    archivePath: path.join(path.dirname(manifestPath), manifest.archive),
    manifest,
  };
}

async function commandVerifyBackup(argv: readonly string[]): Promise<number> {
  const config = await loadConfig();
  const { manifestPath, archivePath, manifest } = await resolveManifest(argv[0], config.backupDir);

  out(`Verifying ${manifestPath}`);
  out(`  taken ${manifest.createdAt}`);
  out();
  out('Restoring into a scratch database (the live one is not touched)');

  const scratch = 'openrunic_verify';
  const result = await verifyBackup(
    config.target,
    manifestPath,
    archivePath,
    scratch,
    (archive, into) => restoreInto(config.target, archive, into)
  );

  out();
  for (const check of result.checks) {
    out(`  ${check.ok ? 'ok  ' : 'FAIL'}  ${check.name.padEnd(22)} ${check.detail}`);
  }
  out();
  out(`  verified in ${seconds(result.durationMs)}`);

  if (!result.ok) {
    out();
    out('This backup is NOT restorable. Do not rely on it. Take a new one and');
    out('verify that instead; if it fails too, the problem is the database, not');
    out('the backup.');
    return 1;
  }

  return 0;
}

export interface RestoreArgs {
  /** The manifest the operator named, or undefined to take the newest backup. */
  readonly manifestArgument: string | undefined;
  readonly into: string;
  readonly confirmed: boolean;
}

/**
 * Splits `restore` arguments, keeping a flag's VALUE out of the positionals.
 *
 * Extracted and exported for the test, because the bug it fixes was invisible
 * in review and expensive in the field: the previous filter dropped arguments
 * beginning with `--` and nothing else, so `--into scratch backup.manifest.json`
 * left "scratch" as the first positional and the restore went looking for a
 * manifest by that name. Written the other way round the same command worked,
 * which is the worst way for this to behave - it reproduces only when somebody
 * types the flag first, and the person most likely to do that is thinking about
 * which database they are restoring into, which is to say somebody mid-incident.
 */
export function parseRestoreArgs(argv: readonly string[], defaultDatabase: string): RestoreArgs {
  const intoFlag = argv.indexOf('--into');
  const valueIndex = intoFlag === -1 ? -1 : intoFlag + 1;
  const into = intoFlag === -1 ? defaultDatabase : (argv[valueIndex] ?? '');
  const positional = argv.filter(
    (argument, index) => !argument.startsWith('--') && index !== valueIndex
  );
  return { manifestArgument: positional[0], into, confirmed: argv.includes('--yes') };
}

async function commandRestore(argv: readonly string[]): Promise<number> {
  const config = await loadConfig();
  const { manifestArgument, into, confirmed } = parseRestoreArgs(argv, config.target.database);

  const { archivePath, manifest } = await resolveManifest(manifestArgument, config.backupDir);

  if (into === config.target.database && !confirmed) {
    out('This will DESTROY the current contents of the live database and replace');
    out(`them with the backup taken at ${manifest.createdAt}.`);
    out();
    out('Re-run with --yes when that is what you want, or use --into <database>');
    out('to restore alongside the live one instead.');
    return 1;
  }

  out(`Restoring ${archivePath}`);
  out(`  into database ${into}`);
  const startedAt = Date.now();

  const inContainer = `/tmp/${path.basename(archivePath)}`;
  await copyIntoContainer(config.target, archivePath, inContainer);
  await restoreInto(config.target, inContainer, into);

  const counts = await rowCounts({ ...config.target, database: into });
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);

  out();
  out(`  restored ${String(total)} rows in ${seconds(Date.now() - startedAt)}`);
  out(`  manifest recorded ${String(manifest.totalRows)} rows`);

  if (total !== manifest.totalRows) {
    out();
    out('  WARNING: the row count does not match the manifest.');
    return 1;
  }

  out();
  out('Restart the stack so the API reconnects: `docker compose restart api`.');
  return 0;
}

async function commandUpgrade(argv: readonly string[]): Promise<number> {
  const config = await loadConfig();
  out('Upgrade pre-flight');
  out();

  const { plan, checks } = await preflight(config.target, MIGRATIONS_DIR, config.backupDir);

  for (const check of checks) {
    out(`  ${check.ok ? 'ok  ' : 'WARN'}  ${check.name.padEnd(22)} ${check.detail}`);
  }

  out();
  out(`  path: ${plan.path}`);
  out(`  ${plan.reason}`);

  if (plan.path === 'maintenance-window') {
    out();
    out('  Destructive migrations cannot be applied under live traffic. The');
    out('  procedure is in docs/ops-runbook.md, "When the plan is destructive".');
    out('  In short: take and verify a backup, stop the web and api containers,');
    out('  apply, restart.');
  }

  // The decision is made in `decideUpgrade` rather than here, because the order
  // of these gates is the safety property and it belongs somewhere it can be
  // tested. This function only prints it.
  const decision = decideUpgrade({
    checks,
    apply: argv.includes('--apply'),
    force: argv.includes('--force'),
  });

  // The one that matters is 'data at risk': an upgrade with no backup behind it
  // is a change with no way back, and the moment to find that out is now rather
  // than halfway through a migration. A destructive plan arrives here too, as
  // the 'migration safety' check, which is why it is not gated separately above.
  if (decision.blockers.length > 0) {
    out();
    for (const check of decision.blockers) {
      out(`  ${check.name} did not pass.`);
      if (check.fix !== undefined) out(`    ${check.fix}`);
    }
  }

  if (decision.action === 'dry-run') {
    out();
    out('  Dry run. Nothing has been applied.');
    out(
      decision.blockers.length > 0
        ? '  Clear the failures above, then re-run with --apply.'
        : '  Re-run with --apply to perform the upgrade.'
    );
    return decision.exitCode;
  }

  if (decision.action === 'blocked') {
    out();
    out('  Nothing has been applied. Re-run with --apply --force to override.');
    return decision.exitCode;
  }

  if (decision.overridden) {
    out();
    out('  --force given: continuing anyway.');
  }

  out();
  out('Applying');
  const startedAt = Date.now();

  // Migrations first, containers second. That order is what makes the additive
  // case zero-downtime: the old version keeps serving against a schema that has
  // only gained things it does not look at.
  const migrated = await composeStreaming(
    COMPOSE_FILE,
    ['up', '--build', '--exit-code-from', 'migrate', 'migrate'],
    {
      inherit: true,
    }
  );
  if (migrated.code !== 0) {
    out();
    out('Migrations failed. The previous containers are still running and still');
    out('serving. Nothing has been replaced.');
    return 1;
  }

  const replaced = await composeStreaming(
    COMPOSE_FILE,
    ['up', '--detach', '--build', '--wait', 'api', 'web'],
    {
      inherit: true,
    }
  );
  if (replaced.code !== 0) {
    out();
    out('The new containers did not become healthy. `docker compose logs api`.');
    return 1;
  }

  out();
  out(`Upgrade complete in ${seconds(Date.now() - startedAt)}.`);
  return 0;
}

function commandLintMigrations(argv: readonly string[]): number {
  const dirFlag = argv.indexOf('--dir');
  const directory = dirFlag === -1 ? MIGRATIONS_DIR : path.resolve(argv[dirFlag + 1] ?? '');
  // A path that climbs out of the repository is noise in a report; show the
  // absolute one instead, which at least reads as a location.
  const fromRoot = path.relative(REPO_ROOT, directory);
  const relative = fromRoot === '' || fromRoot.startsWith('..') ? directory : fromRoot;

  const report = lintMigrationDirectory(directory);

  if (argv.includes('--annotate') && report.findings.length > 0) {
    out(formatAnnotations(report, relative));
  }

  out(formatHuman(report, relative));

  // Findings are reported, never blocking. The expand half of an expand/contract
  // pair is a legitimate, necessary change; what must not happen is it shipping
  // without anyone noticing. --strict is for a branch that wants the harder rule.
  return argv.includes('--strict') && report.findings.length > 0 ? 1 : 0;
}

/** `--flag value` out of an argv, so the command reads the same as the usage line. */
function flag(argv: readonly string[], name: string): string | undefined {
  const at = argv.indexOf(`--${name}`);
  if (at === -1) return undefined;
  return argv[at + 1];
}

/**
 * Verifying a code system before it is loaded.
 *
 * The subcommand exists because `terminology` will grow others - listing what a
 * deployment has loaded, superseding a release - and a flat `verify-terminology`
 * would strand them.
 */
async function commandTerminology(argv: readonly string[]): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub !== 'verify') {
    out('openrunic-ops terminology verify --manifest <path> --content <path>');
    out('                                 [--format ndjson|tsv] [--emit <path>]');
    return sub === undefined || sub === '--help' ? 0 : 1;
  }

  const manifestPath = flag(rest, 'manifest');
  const contentPath = flag(rest, 'content');
  if (manifestPath === undefined || contentPath === undefined) {
    out('Both --manifest and --content are required.');
    return 1;
  }

  // Defaulted rather than required: ndjson is the format the loader emits and
  // the one a deployer who has not chosen is best served by.
  const format = flag(rest, 'format') ?? 'ndjson';
  if (!isCodeSystemFormat(format)) {
    out(`Unknown format ${format}. Use ndjson or tsv.`);
    return 1;
  }

  const report = await verifyCodeSystem({
    manifestPath,
    contentPath,
    format,
    emitPath: flag(rest, 'emit'),
    readFile: (source) => readFile(source, 'utf8'),
  });

  for (const line of report.lines) out(line);
  return report.ok ? 0 : 1;
}

const USAGE = `openrunic-ops <command>

  doctor                    check prerequisites
  setup [--skip-build]      first run: env, images, migrations, seed, timing
  backup                    take a verified-shape logical backup
  verify-backup [manifest]  restore the backup into a scratch database and compare
  restore [manifest]        restore a backup  [--into <db>] [--yes]
  upgrade [--apply]         pre-flight; applies only with --apply  [--force]
  lint-migrations           report destructive migration statements  [--annotate] [--strict] [--dir <path>]
  terminology verify        check a code system load before any row is written
                            --manifest <path> --content <path> [--format ndjson|tsv] [--emit <path>]
`;

async function main(): Promise<number> {
  const [command, ...argv] = process.argv.slice(2);

  switch (command) {
    case 'doctor':
      return commandDoctor();
    case 'setup':
      return commandSetup(argv);
    case 'backup':
      return commandBackup();
    case 'verify-backup':
      return commandVerifyBackup(argv);
    case 'restore':
      return commandRestore(argv);
    case 'upgrade':
      return commandUpgrade(argv);
    case 'lint-migrations':
      return commandLintMigrations(argv);
    case 'terminology':
      return commandTerminology(argv);
    default:
      out(USAGE);
      return command === undefined || command === '--help' ? 0 : 1;
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.exitCode = 1;
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  });
