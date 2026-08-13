import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { lintMigrationDirectory, readMigrations } from './lint.js';
import { lintMigrations } from './lint.js';
import type { MigrationSource } from './rules.js';
import { applyStatement, type SchemaModel } from './schema.js';
import { splitStatements } from './sql.js';
import { isWidening, parseType } from './types.js';

/**
 * The awkward inputs.
 *
 * A migration linter runs unattended on every pull request, so the thing that
 * matters most about it is that it never becomes the reason a migration cannot
 * be reviewed. These are the cases where it would be tempting to throw.
 */

const temporaries: string[] = [];

function scratchDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'openrunic-lint-'));
  temporaries.push(directory);
  return directory;
}

afterEach(() => {
  while (temporaries.length > 0) {
    const directory = temporaries.pop();
    if (directory !== undefined) rmSync(directory, { recursive: true, force: true });
  }
});

describe('reading a migrations directory', () => {
  it('reads migrations in the order Prisma will apply them', () => {
    const root = scratchDirectory();
    for (const name of ['20260301000000_c', '20260101000000_a', '20260201000000_b']) {
      mkdirSync(path.join(root, name));
      writeFileSync(path.join(root, name, 'migration.sql'), 'SELECT 1;');
    }

    expect(readMigrations(root).map((migration) => migration.name)).toEqual([
      '20260101000000_a',
      '20260201000000_b',
      '20260301000000_c',
    ]);
  });

  it('skips a directory with no migration.sql instead of failing the lint', () => {
    const root = scratchDirectory();
    mkdirSync(path.join(root, 'stray'));
    mkdirSync(path.join(root, '20260101000000_real'));
    writeFileSync(path.join(root, '20260101000000_real', 'migration.sql'), 'SELECT 1;');

    expect(readMigrations(root).map((migration) => migration.name)).toEqual([
      '20260101000000_real',
    ]);
  });

  it('ignores loose files such as migration_lock.toml', () => {
    const root = scratchDirectory();
    writeFileSync(path.join(root, 'migration_lock.toml'), 'provider = "postgresql"');

    expect(lintMigrationDirectory(root).migrations).toEqual([]);
  });
});

describe('SQL that could crash a lexer', () => {
  it('does not treat a positional parameter as a dollar quote', () => {
    expect(splitStatements('SELECT * FROM t WHERE id = $1;')).toHaveLength(1);
  });

  it('survives an unterminated string rather than looping forever', () => {
    expect(() => splitStatements("INSERT INTO t VALUES ('unterminated")).not.toThrow();
  });

  it('survives an unterminated dollar quote', () => {
    expect(() => splitStatements('CREATE FUNCTION f() AS $body$ begin')).not.toThrow();
  });

  it('survives an unterminated block comment', () => {
    expect(splitStatements('/* never closed\nDROP TABLE "A";')).toEqual([]);
  });

  it('handles an empty file', () => {
    expect(splitStatements('')).toEqual([]);
  });
});

describe('schema modelling of malformed DDL', () => {
  it('does not throw on a CREATE TABLE with no closing parenthesis', () => {
    const schema: SchemaModel = new Map();
    expect(() => {
      for (const statement of splitStatements('CREATE TABLE "A" ("id" TEXT')) {
        applyStatement(schema, statement, 0);
      }
    }).not.toThrow();
  });

  it('ignores an ALTER COLUMN naming a column it has never seen', () => {
    const schema: SchemaModel = new Map();
    for (const statement of splitStatements(
      'CREATE TABLE "A" ("id" TEXT);\nALTER TABLE "A" ALTER COLUMN "ghost" SET NOT NULL;'
    )) {
      applyStatement(schema, statement, 0);
    }
    expect(schema.get('A')?.columns.has('ghost')).toBe(false);
  });

  it('records a column added with a quoted name and keeps its type', () => {
    const schema: SchemaModel = new Map();
    for (const statement of splitStatements(
      'CREATE TABLE "A" ("id" TEXT);\nALTER TABLE "A" ADD COLUMN "when" TIMESTAMP WITH TIME ZONE;'
    )) {
      applyStatement(schema, statement, 0);
    }
    expect(schema.get('A')?.columns.get('when')?.type).toBe('TIMESTAMP WITH TIME ZONE');
  });

  it('drops a default when the migration drops it', () => {
    const schema: SchemaModel = new Map();
    for (const statement of splitStatements(
      'CREATE TABLE "A" ("b" TEXT DEFAULT \'x\');\nALTER TABLE "A" ALTER COLUMN "b" DROP DEFAULT;'
    )) {
      applyStatement(schema, statement, 0);
    }
    expect(schema.get('A')?.columns.get('b')?.hasDefault).toBe(false);
  });
});

describe('type comparison edge cases', () => {
  it('treats identical array types as unchanged and a changed element as unsafe', () => {
    expect(isWidening(parseType('TEXT[]'), parseType('TEXT[]'))).toBe(true);
    expect(isWidening(parseType('TEXT[]'), parseType('INTEGER[]'))).toBe(false);
  });

  it('accepts an unbounded CHAR becoming VARCHAR', () => {
    expect(isWidening(parseType('CHAR'), parseType('VARCHAR'))).toBe(true);
    expect(isWidening(parseType('CHAR(10)'), parseType('TEXT'))).toBe(true);
  });

  it('rejects adding a bound where there was none', () => {
    expect(isWidening(parseType('NUMERIC'), parseType('NUMERIC(10,2)'))).toBe(false);
  });

  it('parses a type with no parameters and stray whitespace', () => {
    expect(parseType('   text   ')).toEqual({ base: 'TEXT', params: [] });
  });
});

describe('linting against an unknown prior schema', () => {
  it('reports a type change on a table the history never created', () => {
    // The linter cannot prove a change is safe when it never saw the column, so
    // it reports rather than assumes. Silence here would be the dangerous
    // answer.
    const source: MigrationSource = {
      name: '20260101000000_only',
      sql: 'ALTER TABLE "Unknown" ALTER COLUMN "x" SET DATA TYPE VARCHAR(4);',
    };

    const findings = lintMigrations([source]).findings;

    expect(findings.map((finding) => finding.rule)).toEqual(['type-narrowing']);
    expect(findings[0]?.message).toContain('its previous type');
  });

  it('reports DROP TABLE for a table created by an earlier migration', () => {
    const report = lintMigrations([
      { name: '1_a', sql: 'CREATE TABLE "A" ("id" TEXT);' },
      { name: '2_b', sql: 'DROP TABLE "A";' },
    ]);

    expect(report.findings.map((finding) => finding.rule)).toEqual(['drop-table']);
  });

  it('flags a type change whose prior type the model does hold', () => {
    const report = lintMigrations([
      { name: '1_a', sql: 'CREATE TABLE "A" ("x" TEXT);' },
      { name: '2_b', sql: 'ALTER TABLE "A" ALTER COLUMN "x" SET DATA TYPE VARCHAR(4);' },
    ]);

    expect(report.findings[0]?.rule).toBe('type-narrowing');
    expect(report.findings[0]?.message).toContain('TEXT');
  });

  it('truncates a very long statement so the report stays readable', () => {
    const columns = Array.from({ length: 60 }, (_, index) => `"c${String(index)}" TEXT`).join(', ');
    const report = lintMigrations([
      { name: '1_a', sql: `CREATE TABLE "A" (${columns});` },
      { name: '2_b', sql: `ALTER TABLE "A" RENAME TO "B";` },
    ]);

    expect(report.findings[0]?.statement.length).toBeLessThanOrEqual(160);
  });
});
