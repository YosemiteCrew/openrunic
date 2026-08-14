/**
 * How an upgrade has to be performed.
 *
 * Split into its own module because it is the one piece of judgement in the
 * upgrade path and it is pure: it decides, from the migration classifications
 * alone, whether the running version can survive the schema change. Everything
 * around it needs a live database; this needs nothing, so it is unit tested.
 */

export type UpgradePath = 'zero-downtime' | 'maintenance-window';

export interface UpgradePlan {
  readonly path: UpgradePath;
  readonly pending: readonly string[];
  readonly destructive: readonly string[];
  /** Why this path was chosen, in a sentence the operator reads. */
  readonly reason: string;
}

/**
 * Decides how this upgrade has to be performed.
 *
 * Exported and pure so the decision is unit-testable: it is the one piece of
 * judgement in the upgrade, and it must not live inside a shell script that
 * only ever runs on a real cluster.
 */
export function planUpgrade(
  applied: readonly string[],
  known: readonly { name: string; classification: 'expand' | 'contract' }[]
): UpgradePlan {
  const appliedSet = new Set(applied);
  const pending = known.filter((migration) => !appliedSet.has(migration.name));
  const destructive = pending
    .filter((migration) => migration.classification === 'contract')
    .map((migration) => migration.name);

  if (pending.length === 0) {
    return {
      path: 'zero-downtime',
      pending: [],
      destructive: [],
      reason: 'The database schema is already current; only the images change.',
    };
  }

  if (destructive.length === 0) {
    return {
      path: 'zero-downtime',
      pending: pending.map((migration) => migration.name),
      destructive: [],
      reason: `All ${String(pending.length)} pending migration(s) are additive. The running version can serve throughout: migrations apply first, containers are replaced after.`,
    };
  }

  return {
    path: 'maintenance-window',
    pending: pending.map((migration) => migration.name),
    destructive,
    reason: `${String(destructive.length)} pending migration(s) contain destructive statements, so the running version cannot survive them. This upgrade needs a maintenance window and a fresh backup first.`,
  };
}
