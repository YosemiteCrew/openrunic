/**
 * `@openrunic/ops` - the machinery that keeps a self-hosted install alive.
 *
 * What this package owns: the first-run installer, backup and restore, the
 * upgrade runner, and the migration-safety linter. The CLI in `cli.ts` is the
 * operator-facing surface; everything here is the library underneath it, split
 * out so the parts that encode judgement - what counts as a destructive
 * migration, what a widening type change is - are unit tested rather than
 * buried in a shell script.
 */

export { lintMigrationDirectory, lintMigrations, readMigrations } from './migration-lint/lint.js';
export type { LintReport, MigrationClass, MigrationReport } from './migration-lint/lint.js';
export { formatAnnotations, formatHuman } from './migration-lint/report.js';
export { lintMigration } from './migration-lint/rules.js';
export type { Finding, MigrationSource, RuleId } from './migration-lint/rules.js';
export {
  applyStatement,
  normaliseIdentifier,
  parseColumnDefinition,
} from './migration-lint/schema.js';
export type { ColumnModel, SchemaModel, TableModel } from './migration-lint/schema.js';
export { splitStatements } from './migration-lint/sql.js';
export type { SqlStatement } from './migration-lint/sql.js';
export { formatType, isWidening, parseType } from './migration-lint/types.js';
export type { ParsedType } from './migration-lint/types.js';

export {
  GENERATE_SENTINEL,
  fillGeneratedSecrets,
  generateSecret,
  missingKeys,
  parseEnvLines,
} from './env/secrets.js';
export type { EnvLine, FillResult } from './env/secrets.js';

export { compose, composeStreaming, resolveCompose } from './process/compose.js';
export type { ComposeCommand } from './process/compose.js';
export { probe, redact, run, runOrThrow, runStreaming } from './process/run.js';
export type { RunOptions, RunResult } from './process/run.js';
