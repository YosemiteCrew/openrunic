import { lintMigrationDirectory } from '../migration-lint/lint.js';
import { appliedMigrations, rowCounts, type PostgresTarget } from '../db/postgres.js';

import { latestBackup } from './backup.js';
import { planUpgrade, type UpgradePlan } from './upgrade-plan.js';

/**
 * The upgrade runner.
 *
 * openrunic upgrades are expand/contract, and the whole point of that
 * discipline is that the additive case needs no downtime at all: the new schema
 * is one the running old version can ignore, so migrations apply while it is
 * still serving, and the containers are replaced afterwards.
 *
 * This runner enforces the distinction rather than trusting it. It lints the
 * pending migrations first, and refuses to take the zero-downtime path when any
 * of them is destructive - because for those, "zero downtime" is not a
 * property the operator can choose, it is a claim the SQL contradicts.
 */

export interface PreflightCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
  /** What the operator does about it. Present only on checks that can fail. */
  readonly fix?: string;
}

export interface PreflightResult {
  readonly plan: UpgradePlan;
  readonly checks: readonly PreflightCheck[];
}

/**
 * Everything checked before a single migration is applied.
 *
 * The order is deliberate: work out what the migrations do before touching
 * them, and refuse to start rather than stop halfway. A migration run that
 * aborts in the middle leaves a schema that matches neither release.
 *
 * Every `ok` here is computed. A check that is hardcoded true is not a check -
 * it is a line of output that looks like one, which is worse than no check at
 * all, because it is read as reassurance.
 */
export async function preflight(
  target: PostgresTarget,
  migrationsDirectory: string,
  backupDirectory: string
): Promise<PreflightResult> {
  const checks: PreflightCheck[] = [];

  const lint = lintMigrationDirectory(migrationsDirectory);
  const applied = await appliedMigrations(target);
  const plan = planUpgrade(applied, lint.migrations);

  // True by construction rather than by assertion: appliedMigrations threw if
  // the database did not answer, so reaching this line is the proof.
  checks.push({
    name: 'database reachable',
    ok: true,
    detail: `${String(applied.length)} migration(s) already applied`,
  });

  // Informational. Having pending migrations is the reason to run an upgrade,
  // not a condition that can fail it.
  checks.push({
    name: 'pending migrations',
    ok: true,
    detail:
      plan.pending.length === 0
        ? 'none'
        : `${String(plan.pending.length)}: ${plan.pending.join(', ')}`,
  });

  checks.push({
    name: 'migration safety',
    ok: plan.destructive.length === 0,
    detail:
      plan.destructive.length === 0
        ? 'every pending migration is additive'
        : `destructive: ${plan.destructive.join(', ')}`,
    fix: 'Follow "Upgrades with a destructive migration" in docs/ops-runbook.md.',
  });

  // An upgrade that cannot be undone must not begin without something to go
  // back to. This does not take the backup - it refuses to proceed until the
  // operator has - because a backup taken by the thing that is about to break
  // the database is a backup nobody has verified.
  //
  // An empty database is exempt. There is nothing to go back to, and making a
  // fresh install take a backup of nothing before its first upgrade teaches
  // operators that this gate is ceremony.
  const counts = await rowCounts(target);
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const backup = await latestBackup(backupDirectory);
  checks.push({
    name: 'data at risk',
    ok: total === 0 || backup !== null,
    detail:
      `${String(total)} rows across ${String(Object.keys(counts).length)} tables; ` +
      (backup === null ? `no backup in ${backupDirectory}` : `newest backup ${backup}`),
    fix: 'Run `pnpm ops:backup`, then `pnpm ops:verify-backup`. A backup nobody has restored is a hypothesis.',
  });

  return { plan, checks };
}
