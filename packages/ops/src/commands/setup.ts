import { access, chmod, copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { fillGeneratedSecrets, missingKeys } from '../env/secrets.js';
import { resolveCompose } from '../process/compose.js';
import { probe, run } from '../process/run.js';

/**
 * First run.
 *
 * The target this is written against is a clinic's IT person on a stock Linux
 * box with thirty minutes, not a developer. So every step either succeeds or
 * says in one sentence what is wrong and what to type next, and no step asks
 * them to understand the monorepo.
 */

export interface Check {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
  /** What to do about it. Only meaningful when ok is false. */
  readonly fix?: string;
}

function parseVersion(text: string): number[] {
  const match = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(text);
  if (match === null) return [];
  return [match[1], match[2], match[3] ?? '0'].map((part) => Number.parseInt(part ?? '0', 10));
}

function atLeast(found: readonly number[], required: readonly number[]): boolean {
  for (let index = 0; index < required.length; index += 1) {
    const left = found[index] ?? 0;
    const right = required[index] ?? 0;
    if (left > right) return true;
    if (left < right) return false;
  }
  return true;
}

/**
 * Everything that has to be true before an install can succeed.
 *
 * Checked up front and reported together. Discovering the fourth problem after
 * fixing the first three, one five-minute build at a time, is how a
 * thirty-minute install becomes an afternoon.
 */
export async function doctor(repoRoot: string): Promise<Check[]> {
  const checks: Check[] = [];

  const dockerVersion = probe('docker', ['version', '--format', '{{.Server.Version}}'])
    ? run('docker', ['version', '--format', '{{.Server.Version}}']).stdout.trim()
    : '';
  checks.push({
    name: 'Docker Engine',
    ok: dockerVersion !== '' && atLeast(parseVersion(dockerVersion), [24]),
    detail:
      dockerVersion === '' ? 'not running, or the current user cannot reach it' : dockerVersion,
    fix: 'Install Docker Engine 24 or newer and start it. If it is running, add your user to the `docker` group and log in again.',
  });

  try {
    const compose = resolveCompose();
    checks.push({
      name: 'Docker Compose',
      ok: true,
      detail: compose.kind === 'plugin' ? 'docker compose (plugin)' : 'docker-compose (standalone)',
    });
  } catch (error) {
    checks.push({
      name: 'Docker Compose',
      ok: false,
      detail: error instanceof Error ? (error.message.split('\n')[0] ?? 'not found') : 'not found',
      fix: 'Install the Docker Compose plugin: `sudo apt install docker-compose-plugin`.',
    });
  }

  // Disk. Postgres, three images and a backup all land on the same filesystem
  // on a default install, and running out of room mid-restore is the worst
  // possible time to find out.
  const disk = run('df', ['-Pk', repoRoot]);
  const availableKb = Number.parseInt(disk.stdout.split('\n')[1]?.split(/\s+/)[3] ?? '0', 10);
  const availableGb = availableKb / 1024 / 1024;
  checks.push({
    name: 'Free disk space',
    ok: availableGb >= 10,
    detail: `${availableGb.toFixed(1)} GB available`,
    fix: 'Free up space, or move the installation to a larger filesystem. Allow 10 GB for the images and the database, plus room for backups.',
  });

  const compose = path.join(repoRoot, 'docker-compose.yml');
  const hasCompose = await access(compose).then(
    () => true,
    () => false
  );
  checks.push({
    name: 'Compose file',
    ok: hasCompose,
    detail: hasCompose ? compose : 'docker-compose.yml not found',
    fix: 'Run this from the directory the repository was cloned into.',
  });

  return checks;
}

export interface EnsureEnvResult {
  readonly created: boolean;
  /** Names of keys whose secret was generated. Never their values. */
  readonly generated: readonly string[];
  /** Keys the template has that the existing file is missing. */
  readonly missing: readonly string[];
  readonly path: string;
}

/**
 * Creates .env if it is absent, and fills in any generated secrets.
 *
 * Never overwrites an existing value, so running it against a live deployment
 * is safe: it can add a newly required key without rotating a password that
 * the running database is already using.
 */
export async function ensureEnvFile(repoRoot: string): Promise<EnsureEnvResult> {
  const envPath = path.join(repoRoot, '.env');
  const templatePath = path.join(repoRoot, '.env.example');
  const template = await readFile(templatePath, 'utf8');

  const exists = await access(envPath).then(
    () => true,
    () => false
  );

  if (!exists) {
    await copyFile(templatePath, envPath);
  }

  const current = await readFile(envPath, 'utf8');
  const filled = fillGeneratedSecrets(current);

  if (filled.generated.length > 0) {
    await writeFile(envPath, filled.contents, 'utf8');
  }

  // 0600, applied with chmod and applied every run.
  //
  // `writeFile`'s `mode` option only takes effect when the write creates the
  // file, and by this point .env always exists: either copyFile above just made
  // it from the template, or a previous run left one. So the mode that was
  // passed to writeFile here never applied to anything, and the file holding
  // POSTGRES_PASSWORD kept .env.example's permissions - world-readable in a
  // fresh clone. It is not conditional on having generated a secret either,
  // because the file holds the database password whether or not this run
  // filled anything in.
  await chmod(envPath, 0o600);

  return {
    created: !exists,
    generated: filled.generated,
    missing: missingKeys(template, filled.contents),
    path: envPath,
  };
}
