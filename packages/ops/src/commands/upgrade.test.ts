import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PostgresTarget } from '../db/postgres.js';

import { decideUpgrade, preflight, type PreflightCheck } from './upgrade.js';

/**
 * The upgrade safety gate.
 *
 * Two things are tested here, and they fail differently.
 *
 * `decideUpgrade` is the ordering: which of --apply and --force is allowed to
 * change what a run does. Getting that wrong does not throw, does not fail a
 * type check and does not show up in a drill against a healthy stack - it turns
 * the safe command into one that does something else, quietly, and the operator
 * finds out at the worst moment. So it is asserted flag by flag.
 *
 * `preflight` is the checks themselves. Every `ok` it reports has to be
 * computed from the database and the migrations rather than hardcoded, because
 * a check that cannot fail still reads as reassurance while providing none.
 */

const target: PostgresTarget = {
  composeFile: '/repo/docker-compose.yml',
  service: 'postgres',
  user: 'openrunic',
  database: 'openrunic',
};

const check = (name: string, ok: boolean): PreflightCheck => ({ name, ok, detail: 'detail' });

describe('decideUpgrade', () => {
  const passing = [check('database reachable', true), check('data at risk', true)];
  const failing = [check('database reachable', true), check('data at risk', false)];

  it('applies nothing without --apply, even when every check passed', () => {
    const decision = decideUpgrade({ checks: passing, apply: false, force: false });

    expect(decision.action).toBe('dry-run');
    expect(decision.exitCode).toBe(0);
  });

  // The regression this file exists for. A gate placed ahead of the dry-run
  // rule made `pnpm ops:upgrade` exit 1 and advertise --force, so the command
  // documented as "says what would happen, changes nothing" answered a careful
  // operator by pointing at the override.
  it('stays a dry run when checks failed, rather than becoming a refusal', () => {
    const decision = decideUpgrade({ checks: failing, apply: false, force: false });

    expect(decision.action).toBe('dry-run');
    expect(decision.exitCode).toBe(0);
    // Still reported. A dry run that hid the failures would be worse than one
    // that exits non-zero.
    expect(decision.blockers.map((blocker) => blocker.name)).toEqual(['data at risk']);
  });

  it('stays a dry run when --force is given without --apply', () => {
    const decision = decideUpgrade({ checks: failing, apply: false, force: true });

    expect(decision.action).toBe('dry-run');
    expect(decision.exitCode).toBe(0);
    // --force overrode nothing here, because nothing was going to happen.
    // Reporting it as an override would misdescribe the run.
    expect(decision.overridden).toBe(false);
  });

  it('refuses a real upgrade while a check is unmet', () => {
    const decision = decideUpgrade({ checks: failing, apply: true, force: false });

    expect(decision.action).toBe('blocked');
    expect(decision.exitCode).toBe(1);
    expect(decision.overridden).toBe(false);
  });

  it('lets --apply --force through, and records that it was an override', () => {
    const decision = decideUpgrade({ checks: failing, apply: true, force: true });

    expect(decision.action).toBe('apply');
    expect(decision.exitCode).toBe(0);
    expect(decision.overridden).toBe(true);
  });

  it('does not call a clean --apply --force an override', () => {
    // Nothing was overridden, so the "--force given: continuing anyway" line
    // must not print. It would claim a risk was accepted that never existed.
    const decision = decideUpgrade({ checks: passing, apply: true, force: true });

    expect(decision.action).toBe('apply');
    expect(decision.overridden).toBe(false);
  });

  it('applies when every check passed', () => {
    const decision = decideUpgrade({ checks: passing, apply: true, force: false });

    expect(decision.action).toBe('apply');
    expect(decision.exitCode).toBe(0);
  });

  it('reports a destructive plan once, as the check that failed', () => {
    // A destructive plan is not a gate of its own: 'migration safety' fails for
    // exactly the plans planUpgrade sends to a maintenance window. Two gates
    // reporting one condition is how the same override line printed twice.
    const decision = decideUpgrade({
      checks: [check('migration safety', false), check('data at risk', true)],
      apply: true,
      force: true,
    });

    expect(decision.blockers).toHaveLength(1);
    expect(decision.blockers[0]?.name).toBe('migration safety');
  });

  it('lists every unmet check, in pre-flight order', () => {
    const decision = decideUpgrade({
      checks: [
        check('migration safety', false),
        check('pending migrations', true),
        check('data at risk', false),
      ],
      apply: true,
      force: false,
    });

    expect(decision.blockers.map((blocker) => blocker.name)).toEqual([
      'migration safety',
      'data at risk',
    ]);
  });
});

/**
 * `preflight` reads the live database through `db/postgres.js`. Those two reads
 * are the only thing between this test and a real Docker stack, so they are the
 * only thing replaced: the migrations are real files on disk, the linter that
 * classifies them is the real one, and the backup lookup reads a real directory.
 */
const appliedMigrations = vi.hoisted(() => vi.fn<() => Promise<string[]>>());
const rowCounts = vi.hoisted(() => vi.fn<() => Promise<Record<string, number>>>());

vi.mock('../db/postgres.js', () => ({
  appliedMigrations: (): Promise<string[]> => appliedMigrations(),
  rowCounts: (): Promise<Record<string, number>> => rowCounts(),
}));

const RUNBOOK = fileURLToPath(new URL('../../../../docs/ops-runbook.md', import.meta.url));

describe('preflight', () => {
  let root: string;
  let migrations: string;
  let backups: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'openrunic-preflight-'));
    migrations = path.join(root, 'migrations');
    backups = path.join(root, 'backups');
    await mkdir(migrations, { recursive: true });
    appliedMigrations.mockResolvedValue([]);
    rowCounts.mockResolvedValue({});
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  /** Writes one migration directory, the way Prisma lays them out. */
  const write = async (name: string, sql: string): Promise<void> => {
    await mkdir(path.join(migrations, name), { recursive: true });
    await writeFile(path.join(migrations, name, 'migration.sql'), sql, 'utf8');
  };

  const named = (checks: readonly PreflightCheck[], name: string): PreflightCheck => {
    const found = checks.find((candidate) => candidate.name === name);
    if (found === undefined) throw new Error(`preflight did not report a '${name}' check`);
    return found;
  };

  it('passes migration safety when every pending migration is additive', async () => {
    await write('20260101000000_init', 'CREATE TABLE "Patient" ("id" TEXT NOT NULL);');
    await write('20260102000000_add', 'ALTER TABLE "Patient" ADD COLUMN "nickname" TEXT;');

    const { plan, checks } = await preflight(target, migrations, backups);

    expect(plan.path).toBe('zero-downtime');
    expect(named(checks, 'migration safety').ok).toBe(true);
  });

  it('fails migration safety on a pending destructive migration, and names it', async () => {
    await write('20260101000000_init', 'CREATE TABLE "Patient" ("id" TEXT NOT NULL);');
    await write('20260102000000_drop', 'ALTER TABLE "Patient" DROP COLUMN "id";');

    const { plan, checks } = await preflight(target, migrations, backups);

    expect(plan.path).toBe('maintenance-window');
    const safety = named(checks, 'migration safety');
    expect(safety.ok).toBe(false);
    expect(safety.detail).toContain('20260102000000_drop');
  });

  it('points its fix at a section the runbook actually has', async () => {
    await write('20260101000000_init', 'CREATE TABLE "Patient" ("id" TEXT NOT NULL);');

    const { checks } = await preflight(target, migrations, backups);
    const runbook = await readFile(RUNBOOK, 'utf8');

    // An operator reads this line at the moment their upgrade stopped. Sending
    // them to a heading the file does not have is worse than sending them
    // nowhere, so the heading is asserted rather than assumed.
    expect(runbook).toContain('### When the plan is destructive');
    expect(named(checks, 'migration safety').fix).toContain('When the plan is destructive');
  });

  it('does not count a destructive migration that has already been applied', async () => {
    await write('20260101000000_init', 'CREATE TABLE "Patient" ("id" TEXT NOT NULL);');
    await write('20260102000000_drop', 'ALTER TABLE "Patient" DROP COLUMN "id";');
    appliedMigrations.mockResolvedValue(['20260101000000_init', '20260102000000_drop']);

    const { plan, checks } = await preflight(target, migrations, backups);

    expect(plan.path).toBe('zero-downtime');
    expect(named(checks, 'migration safety').ok).toBe(true);
    expect(named(checks, 'pending migrations').detail).toBe('none');
  });

  it('fails data at risk when the database holds rows and no backup exists', async () => {
    await write('20260101000000_init', 'CREATE TABLE "Patient" ("id" TEXT NOT NULL);');
    rowCounts.mockResolvedValue({ Patient: 20, Appointment: 21 });

    const { checks } = await preflight(target, migrations, backups);

    const risk = named(checks, 'data at risk');
    expect(risk.ok).toBe(false);
    expect(risk.detail).toContain('41 rows');
    expect(risk.detail).toContain(`no backup in ${backups}`);
    expect(risk.fix).toContain('pnpm ops:backup');
  });

  it('passes data at risk once a backup is on disk, and names the newest', async () => {
    await write('20260101000000_init', 'CREATE TABLE "Patient" ("id" TEXT NOT NULL);');
    rowCounts.mockResolvedValue({ Patient: 20 });
    await mkdir(backups, { recursive: true });
    await writeFile(path.join(backups, 'openrunic-20260101T000000Z.manifest.json'), '{}', 'utf8');
    await writeFile(path.join(backups, 'openrunic-20260202T000000Z.manifest.json'), '{}', 'utf8');

    const { checks } = await preflight(target, migrations, backups);

    const risk = named(checks, 'data at risk');
    expect(risk.ok).toBe(true);
    expect(risk.detail).toContain('openrunic-20260202T000000Z.manifest.json');
  });

  it('exempts an empty database, so a fresh install is not taught the gate is ceremony', async () => {
    await write('20260101000000_init', 'CREATE TABLE "Patient" ("id" TEXT NOT NULL);');
    rowCounts.mockResolvedValue({ Patient: 0 });

    const { checks } = await preflight(target, migrations, backups);

    expect(named(checks, 'data at risk').ok).toBe(true);
  });

  it('reports the database as reachable only after it has answered', async () => {
    await write('20260101000000_init', 'CREATE TABLE "Patient" ("id" TEXT NOT NULL);');
    appliedMigrations.mockResolvedValue(['20260101000000_init']);

    const { checks } = await preflight(target, migrations, backups);

    // True by construction: appliedMigrations throws when the database does not
    // answer, so the line reporting this is only reached on a live one.
    expect(named(checks, 'database reachable').detail).toBe('1 migration(s) already applied');
  });

  it('propagates a database that did not answer, instead of reporting it reachable', async () => {
    await write('20260101000000_init', 'CREATE TABLE "Patient" ("id" TEXT NOT NULL);');
    appliedMigrations.mockRejectedValue(new Error('psql failed: connection refused'));

    await expect(preflight(target, migrations, backups)).rejects.toThrow(/connection refused/);
  });

  it('lists the pending migrations by name', async () => {
    await write('20260101000000_init', 'CREATE TABLE "Patient" ("id" TEXT NOT NULL);');
    await write('20260102000000_add', 'ALTER TABLE "Patient" ADD COLUMN "nickname" TEXT;');
    appliedMigrations.mockResolvedValue(['20260101000000_init']);

    const { checks } = await preflight(target, migrations, backups);

    expect(named(checks, 'pending migrations').detail).toBe('1: 20260102000000_add');
  });
});
