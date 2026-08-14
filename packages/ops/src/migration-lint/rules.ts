/**
 * The destructive-statement rules.
 *
 * openrunic upgrades are expand/contract: a release may only add things a
 * running older version can ignore, and may only take something away one
 * release after the code that used it stopped existing. A migration that
 * expands and contracts in one step cannot be deployed without downtime, and
 * cannot be rolled back at all once it has run.
 *
 * These rules do not block anything. They make the destructive half visible in
 * review, with the statement quoted and the expand/contract alternative spelled
 * out, so the decision to ship it is a decision somebody made rather than one
 * nobody noticed.
 */

import { group } from './match.js';
import { applyStatement, normaliseIdentifier, type SchemaModel } from './schema.js';
import type { SqlStatement } from './sql.js';
import { formatType, isWidening, parseType } from './types.js';

export type RuleId =
  'drop-table' | 'drop-column' | 'not-null-without-default' | 'type-narrowing' | 'rename';

export interface Finding {
  readonly rule: RuleId;
  readonly migration: string;
  readonly line: number;
  readonly statement: string;
  readonly message: string;
  /** The expand/contract route that achieves the same end safely. */
  readonly remedy: string;
}

/** One migration directory's SQL, already read off disk. */
export interface MigrationSource {
  /** Directory name, e.g. `20260813000000_emr_data_model`. */
  readonly name: string;
  readonly sql: string;
}

const IDENTIFIER = '"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*';
const QUALIFIED = `(?:${IDENTIFIER})(?:\\.(?:${IDENTIFIER}))?`;

const DROP_TABLE = new RegExp(`^DROP\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(${QUALIFIED})`, 'i');
const ALTER_TABLE = new RegExp(
  `^ALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?(${QUALIFIED})\\s+(.*)$`,
  'i'
);
const DROP_COLUMN = new RegExp(`^DROP\\s+COLUMN\\s+(?:IF\\s+EXISTS\\s+)?(${IDENTIFIER})`, 'i');
const ADD_COLUMN = new RegExp(
  `^ADD\\s+COLUMN\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(${IDENTIFIER})\\s+(.*)$`,
  'i'
);
const ALTER_COLUMN = new RegExp(`^ALTER\\s+COLUMN\\s+(${IDENTIFIER})\\s+(.*)$`, 'i');
const RENAME = /^RENAME\s+(?:(COLUMN|CONSTRAINT)\s+)?/i;
/**
 * `SET DATA TYPE x` / `TYPE x`, with any `USING` clause removed first.
 *
 * Two greedy passes rather than one pattern: a lazy `(.*?)` beside an optional
 * `(?:\s+USING\b.*)?` lets the engine distribute the same blanks between them
 * and backtrack quadratically (CodeQL js/polynomial-redos).
 */
const USING_CLAUSE = / USING\b.*$/i;
const TYPE_CHANGE = /^(?:SET DATA TYPE|TYPE) (.+)$/i;

/** Truncated so a 4 kB `CREATE TABLE` does not fill the reviewer's terminal. */
function quote(statement: SqlStatement): string {
  const single = statement.text.replace(/\s+/g, ' ').trim();
  return single.length <= 160 ? single : `${single.slice(0, 157)}...`;
}

/**
 * Lints one migration against the schema as the previous migrations left it.
 *
 * `schema` is mutated as statements are applied, so passing the same model
 * through the history in order is what gives later migrations the context to
 * know which tables are new and what a column's type used to be.
 */
export function lintMigration(
  migration: MigrationSource,
  statements: readonly SqlStatement[],
  schema: SchemaModel,
  migrationIndex: number
): Finding[] {
  const findings: Finding[] = [];

  const add = (rule: RuleId, statement: SqlStatement, message: string, remedy: string): void => {
    findings.push({
      rule,
      migration: migration.name,
      line: statement.line,
      statement: quote(statement),
      message,
      remedy,
    });
  };

  for (const statement of statements) {
    const dropTable = DROP_TABLE.exec(statement.text);
    if (dropTable !== null) {
      const table = normaliseIdentifier(group(dropTable, 1));
      const existing = schema.get(table);
      // A table this migration created itself is scaffolding, not data.
      if (existing === undefined || existing.createdInMigration !== migrationIndex) {
        add(
          'drop-table',
          statement,
          `Drops table "${table}", destroying every row in it.`,
          'Ship the release that stops reading this table first. Drop it in a later, separate migration, once no running version references it.'
        );
      }
      applyStatement(schema, statement, migrationIndex);
      continue;
    }

    const alter = ALTER_TABLE.exec(statement.text);
    if (alter === null) {
      applyStatement(schema, statement, migrationIndex);
      continue;
    }

    const table = normaliseIdentifier(group(alter, 1));
    const action = group(alter, 2).trim();
    const model = schema.get(table);
    const tableIsNew = model !== undefined && model.createdInMigration === migrationIndex;

    const dropColumn = DROP_COLUMN.exec(action);
    if (dropColumn !== null && !tableIsNew) {
      const column = normaliseIdentifier(group(dropColumn, 1));
      add(
        'drop-column',
        statement,
        `Drops column "${table}"."${column}", destroying its data.`,
        'Contract step. Ship the release that stops writing this column, let it run, then drop the column in the next release.'
      );
    }

    const addColumn = ADD_COLUMN.exec(action);
    if (addColumn !== null && !tableIsNew) {
      const column = normaliseIdentifier(group(addColumn, 1));
      const rest = group(addColumn, 2);
      const notNull = /\bNOT\s+NULL\b/i.test(rest);
      const hasDefault = /\bDEFAULT\b/i.test(rest) || /\bGENERATED\b/i.test(rest);
      if (notNull && !hasDefault) {
        add(
          'not-null-without-default',
          statement,
          `Adds NOT NULL column "${table}"."${column}" with no default. On a table that already has rows this fails outright, and the deploy stops halfway.`,
          'Add the column nullable, backfill it, and add the NOT NULL constraint in a later release - or give this column a DEFAULT so existing rows have a value.'
        );
      }
    }

    const alterColumn = ALTER_COLUMN.exec(action);
    if (alterColumn !== null) {
      const column = normaliseIdentifier(group(alterColumn, 1));
      const change = group(alterColumn, 2).trim();
      const previous = model?.columns.get(column);

      if (/^SET\s+NOT\s+NULL$/i.test(change) && !tableIsNew) {
        const backfilled = previous?.hasDefault === true;
        if (!backfilled) {
          add(
            'not-null-without-default',
            statement,
            `Makes existing column "${table}"."${column}" NOT NULL, and it has no default. Any row holding NULL fails the constraint and the deploy stops halfway.`,
            'Backfill the column and set a DEFAULT in one release; add NOT NULL in the next, once no row can be NULL.'
          );
        }
      }

      const typeChange = TYPE_CHANGE.exec(change.replace(/\s+/g, ' ').replace(USING_CLAUSE, ''));
      if (typeChange !== null) {
        const target = parseType(group(typeChange, 1));
        const source = previous === undefined ? null : parseType(previous.type);
        // Unknown previous type means the linter cannot prove safety, and
        // "cannot prove safe" is reported rather than assumed.
        if (source === null || !isWidening(source, target)) {
          const from = source === null ? 'its previous type' : formatType(source);
          add(
            'type-narrowing',
            statement,
            `Changes "${table}"."${column}" from ${from} to ${formatType(target)}, which is not a widening. Values that do not fit are lost or abort the migration, and the whole table is rewritten under a lock.`,
            'Add a new column of the new type, backfill it, switch the code over, then drop the old column in a later release.'
          );
        }
      }
    }

    if (RENAME.test(action)) {
      add(
        'rename',
        statement,
        `Renames part of "${table}". The old name disappears the instant this runs, so any version still running breaks immediately.`,
        'Add the new name, write to both, migrate readers, then remove the old one in a later release.'
      );
    }

    applyStatement(schema, statement, migrationIndex);
  }

  return findings;
}
