import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { lintMigration, type Finding, type MigrationSource } from './rules.js';
import type { SchemaModel } from './schema.js';
import { splitStatements } from './sql.js';

/**
 * Runs the destructive-statement rules over a migration history.
 *
 * The history is replayed in order into one schema model, which is what lets a
 * rule know that a column being altered in migration 7 was created as TEXT in
 * migration 3. Linting a single migration in isolation cannot answer that, and
 * a linter that cannot answer it either misses narrowing or invents it.
 */

/** How a migration is classified for the expand/contract rule. */
export type MigrationClass = 'expand' | 'contract';

export interface MigrationReport {
  readonly name: string;
  readonly classification: MigrationClass;
  readonly findings: readonly Finding[];
}

export interface LintReport {
  readonly migrations: readonly MigrationReport[];
  readonly findings: readonly Finding[];
  /** Every migration that carries at least one destructive statement. */
  readonly contractMigrations: readonly string[];
}

/**
 * Reads `<dir>/<migration>/migration.sql` for every migration directory.
 *
 * Sorted by directory name, which is Prisma's timestamp prefix, so the replay
 * order here is the order `migrate deploy` will apply them in.
 */
export function readMigrations(directory: string): MigrationSource[] {
  const entries = readdirSync(directory)
    .filter((entry) => {
      const full = path.join(directory, entry);
      return statSync(full).isDirectory();
    })
    .sort((a, b) => a.localeCompare(b));

  const sources: MigrationSource[] = [];
  for (const name of entries) {
    const file = path.join(directory, name, 'migration.sql');
    try {
      sources.push({ name, sql: readFileSync(file, 'utf8') });
    } catch {
      // A directory with no migration.sql is not a migration. Prisma never
      // creates one, but a stray folder must not stop the lint.
      continue;
    }
  }
  return sources;
}

export function lintMigrations(sources: readonly MigrationSource[]): LintReport {
  const schema: SchemaModel = new Map();
  const migrations: MigrationReport[] = [];
  const all: Finding[] = [];

  sources.forEach((source, index) => {
    const statements = splitStatements(source.sql);
    const findings = lintMigration(source, statements, schema, index);
    all.push(...findings);
    migrations.push({
      name: source.name,
      classification: findings.length === 0 ? 'expand' : 'contract',
      findings,
    });
  });

  return {
    migrations,
    findings: all,
    contractMigrations: migrations
      .filter((migration) => migration.classification === 'contract')
      .map((migration) => migration.name),
  };
}

/** Convenience wrapper for the common case: lint a migrations directory. */
export function lintMigrationDirectory(directory: string): LintReport {
  return lintMigrations(readMigrations(directory));
}
