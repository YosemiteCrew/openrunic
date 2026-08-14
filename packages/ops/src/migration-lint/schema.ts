/**
 * A minimal schema model, replayed from the migration history.
 *
 * The point of this file is to let a rule answer questions that a single
 * statement cannot answer on its own:
 *
 *   * "Is this table new in this migration?" - because NOT NULL on a column of
 *     a table nobody has rows in yet is completely safe, and flagging it would
 *     make the linter noise that reviewers learn to ignore.
 *   * "What type did this column have before?" - because narrowing is a
 *     comparison, and an `ALTER COLUMN ... TYPE` statement only carries the
 *     destination.
 *
 * It models exactly the DDL that Prisma emits and deliberately ignores the
 * rest. An unrecognised statement leaves the model untouched rather than
 * throwing: this is a linter's supporting cast, and it must never be the reason
 * a migration cannot be reviewed.
 */

import { group } from './match.js';
import type { SqlStatement } from './sql.js';

export interface ColumnModel {
  readonly name: string;
  /** Declared type, normalised to upper case with whitespace collapsed. */
  type: string;
  notNull: boolean;
  hasDefault: boolean;
}

export interface TableModel {
  readonly name: string;
  readonly columns: Map<string, ColumnModel>;
  /** Index of the migration that created it, for the "is it new here" test. */
  readonly createdInMigration: number;
}

export type SchemaModel = Map<string, TableModel>;

/** Strips the quoting and schema qualification Prisma writes. */
export function normaliseIdentifier(raw: string): string {
  const last = raw.trim().split('.').at(-1) ?? raw;
  return last.replace(/"/g, '').trim();
}

const IDENTIFIER = '"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*';

/** `CREATE TABLE "X" (...)`, capturing the name and the column list. */
const CREATE_TABLE = new RegExp(
  `^CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?((?:${IDENTIFIER})(?:\\.(?:${IDENTIFIER}))?)\\s*\\(`,
  'i'
);

const ALTER_TABLE = new RegExp(
  `^ALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?((?:${IDENTIFIER})(?:\\.(?:${IDENTIFIER}))?)\\s+(.*)$`,
  'i'
);

const DROP_TABLE = new RegExp(
  `^DROP\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?((?:${IDENTIFIER})(?:\\.(?:${IDENTIFIER}))?)`,
  'i'
);

/**
 * Splits a parenthesised column list on top-level commas.
 *
 * `NUMERIC(10,2)` and `CHECK (a, b)` both contain commas that do not separate
 * columns, so depth tracking is not optional here.
 */
function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of body) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim() !== '') parts.push(current);
  return parts;
}

/** Everything inside the outermost parentheses of a CREATE TABLE. */
function parenBody(text: string): string {
  const open = text.indexOf('(');
  if (open === -1) return '';
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === '(') depth += 1;
    if (text[index] === ')') {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, index);
    }
  }
  return text.slice(open + 1);
}

const TABLE_CONSTRAINT = /^(CONSTRAINT|PRIMARY|UNIQUE|FOREIGN|CHECK|EXCLUDE)\b/i;

/**
 * A type change, with any `USING` clause cut off first.
 *
 * Cutting rather than matching is deliberate. The single-regex spelling paired
 * a lazy `(.*?)` with an optional `(?:\s+USING\b.*)?` tail, and the two
 * overlap: the engine can hand the same run of blanks to either, which is
 * quadratic on a long change (CodeQL js/polynomial-redos). Two greedy passes
 * are linear and read more plainly.
 */
function typeChangeOf(change: string): string | null {
  const collapsed = change.replace(/\s+/g, ' ');
  const withoutUsing = collapsed.replace(/ USING\b.*$/i, '');
  const match = /^(?:SET DATA TYPE|TYPE) (.+)$/i.exec(withoutUsing);
  return match === null ? null : (match[1] ?? '').trim();
}

/** Reads one column definition out of a CREATE TABLE body. */
export function parseColumnDefinition(definition: string): ColumnModel | null {
  // Whitespace is collapsed once, here, and every pattern below then matches a
  // single literal space. Patterns that spell `\s+` more than once let the
  // engine distribute a run of blanks between them and backtrack polynomially
  // (CodeQL js/polynomial-redos); one linear pass removes the ambiguity at the
  // source instead of hardening each pattern separately.
  const trimmed = definition.trim().replace(/\s+/g, ' ');
  if (trimmed === '' || TABLE_CONSTRAINT.test(trimmed)) return null;

  const nameMatch = new RegExp(`^(${IDENTIFIER}) (.*)$`, 'i').exec(trimmed);
  if (nameMatch === null) return null;

  const name = normaliseIdentifier(group(nameMatch, 1));
  const rest = group(nameMatch, 2).trim();

  // The type runs until the first column constraint keyword. Splitting on
  // whitespace would truncate `TIMESTAMP WITH TIME ZONE` and `DOUBLE PRECISION`.
  const constraintStart =
    / (NOT NULL|NULL|DEFAULT|PRIMARY KEY|UNIQUE|REFERENCES|CHECK|GENERATED|COLLATE)\b/i.exec(rest);
  const type = (constraintStart === null ? rest : rest.slice(0, constraintStart.index)).trim();

  return {
    name,
    type: type.replace(/\s+/g, ' ').toUpperCase(),
    notNull: /\bNOT\s+NULL\b/i.test(rest),
    hasDefault: /\bDEFAULT\b/i.test(rest) || /\bGENERATED\b/i.test(rest),
  };
}

/** Applies one statement to the model. Unknown statements are a no-op. */
export function applyStatement(
  schema: SchemaModel,
  statement: SqlStatement,
  migrationIndex: number
): void {
  const create = CREATE_TABLE.exec(statement.text);
  if (create !== null) {
    const name = normaliseIdentifier(group(create, 1));
    const columns = new Map<string, ColumnModel>();
    for (const part of splitTopLevel(parenBody(statement.text))) {
      const column = parseColumnDefinition(part);
      if (column !== null) columns.set(column.name, column);
    }
    schema.set(name, { name, columns, createdInMigration: migrationIndex });
    return;
  }

  const drop = DROP_TABLE.exec(statement.text);
  if (drop !== null) {
    schema.delete(normaliseIdentifier(group(drop, 1)));
    return;
  }

  const alter = ALTER_TABLE.exec(statement.text);
  if (alter === null) return;

  const table = schema.get(normaliseIdentifier(group(alter, 1)));
  if (table === undefined) return;
  const action = group(alter, 2).trim();

  // The alternation in IDENTIFIER must be wrapped before anything is appended
  // to it. Without the inner group, `"x"|ident\s+.*` binds the trailing part to
  // the second alternative only, so a quoted column name captures the name and
  // silently drops its type - and the column never enters the model.
  const addColumn = new RegExp(
    `^ADD\\s+COLUMN\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?((?:${IDENTIFIER})\\s+.*)$`,
    'i'
  ).exec(action);
  if (addColumn !== null) {
    const column = parseColumnDefinition(group(addColumn, 1));
    if (column !== null) table.columns.set(column.name, column);
    return;
  }

  const dropColumn = new RegExp(
    `^DROP\\s+COLUMN\\s+(?:IF\\s+EXISTS\\s+)?(${IDENTIFIER})`,
    'i'
  ).exec(action);
  if (dropColumn !== null) {
    table.columns.delete(normaliseIdentifier(group(dropColumn, 1)));
    return;
  }

  const alterColumn = new RegExp(`^ALTER\\s+COLUMN\\s+(${IDENTIFIER})\\s+(.*)$`, 'i').exec(action);
  if (alterColumn === null) return;

  const columnName = normaliseIdentifier(group(alterColumn, 1));
  const column = table.columns.get(columnName);
  if (column === undefined) return;
  const change = group(alterColumn, 2).trim();

  const typeChange = typeChangeOf(change);
  if (typeChange !== null) {
    column.type = typeChange.toUpperCase();
    return;
  }
  if (/^SET\s+NOT\s+NULL$/i.test(change)) column.notNull = true;
  if (/^DROP\s+NOT\s+NULL$/i.test(change)) column.notNull = false;
  if (/^SET\s+DEFAULT\b/i.test(change)) column.hasDefault = true;
  if (/^DROP\s+DEFAULT$/i.test(change)) column.hasDefault = false;
}
