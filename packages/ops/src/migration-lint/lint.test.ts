import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { lintMigrationDirectory, lintMigrations } from './lint.js';
import { formatAnnotations, formatHuman } from './report.js';
import type { MigrationSource, RuleId } from './rules.js';

/**
 * The linter proved in both directions.
 *
 * Every rule gets a migration that must be flagged and a neighbouring migration
 * that must not be. A linter only tested on the bad case is indistinguishable
 * from one that flags everything, and that one gets switched off inside a
 * month.
 */

/** A first migration that creates the tables the later cases then modify. */
const BASELINE: MigrationSource = {
  name: '20260101000000_baseline',
  sql: `
    CREATE TABLE "Patient" (
      "id" TEXT NOT NULL,
      "mrn" VARCHAR(64) NOT NULL,
      "note" TEXT,
      "visits" INTEGER NOT NULL DEFAULT 0,
      CONSTRAINT "Patient_pkey" PRIMARY KEY ("id")
    );
    CREATE TABLE "Legacy" ("id" TEXT NOT NULL);
  `,
};

function lintAfterBaseline(sql: string): ReturnType<typeof lintMigrations> {
  return lintMigrations([BASELINE, { name: '20260202000000_change', sql }]);
}

function rulesFound(sql: string): RuleId[] {
  return lintAfterBaseline(sql).findings.map((finding) => finding.rule);
}

describe('the baseline migration itself', () => {
  it('is expand-only: creating tables destroys nothing', () => {
    const report = lintMigrations([BASELINE]);

    expect(report.findings).toEqual([]);
    expect(report.migrations[0]?.classification).toBe('expand');
  });

  it('does not flag NOT NULL on a table created in the same migration', () => {
    // "mrn" is NOT NULL with no default, which would be a finding on an
    // existing table and is completely safe on a brand new one.
    expect(lintMigrations([BASELINE]).findings).toEqual([]);
  });
});

describe('additive changes pass', () => {
  it('accepts a new nullable column', () => {
    expect(rulesFound('ALTER TABLE "Patient" ADD COLUMN "email" TEXT;')).toEqual([]);
  });

  it('accepts a NOT NULL column that carries a default', () => {
    expect(
      rulesFound('ALTER TABLE "Patient" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;')
    ).toEqual([]);
  });

  it('accepts a new table and its indexes', () => {
    expect(
      rulesFound(
        'CREATE TABLE "Note" ("id" TEXT NOT NULL, "body" TEXT NOT NULL);\nCREATE INDEX "Note_id_idx" ON "Note"("id");'
      )
    ).toEqual([]);
  });

  it('accepts dropping NOT NULL, which only ever admits more values', () => {
    expect(rulesFound('ALTER TABLE "Patient" ALTER COLUMN "mrn" DROP NOT NULL;')).toEqual([]);
  });

  it('accepts a widening type change', () => {
    expect(rulesFound('ALTER TABLE "Patient" ALTER COLUMN "mrn" SET DATA TYPE TEXT;')).toEqual([]);
    expect(rulesFound('ALTER TABLE "Patient" ALTER COLUMN "visits" SET DATA TYPE BIGINT;')).toEqual(
      []
    );
  });

  it('accepts dropping a table this same migration created', () => {
    expect(rulesFound('CREATE TABLE "Scratch" ("id" TEXT);\nDROP TABLE "Scratch";')).toEqual([]);
  });

  it('does not read a destructive statement written inside a comment', () => {
    expect(
      rulesFound(
        '-- ALTER TABLE "Patient" DROP COLUMN "mrn";\nALTER TABLE "Patient" ADD COLUMN "x" TEXT;'
      )
    ).toEqual([]);
  });
});

describe('destructive changes are caught', () => {
  it('flags DROP COLUMN', () => {
    expect(rulesFound('ALTER TABLE "Patient" DROP COLUMN "note";')).toEqual(['drop-column']);
  });

  it('flags DROP TABLE of a table that already existed', () => {
    expect(rulesFound('DROP TABLE "Legacy";')).toEqual(['drop-table']);
  });

  it('flags a NOT NULL column added to an existing table with no default', () => {
    expect(rulesFound('ALTER TABLE "Patient" ADD COLUMN "ssn" TEXT NOT NULL;')).toEqual([
      'not-null-without-default',
    ]);
  });

  it('flags SET NOT NULL on an existing nullable column with no default', () => {
    expect(rulesFound('ALTER TABLE "Patient" ALTER COLUMN "note" SET NOT NULL;')).toEqual([
      'not-null-without-default',
    ]);
  });

  it('accepts SET NOT NULL once the column has a default to backfill from', () => {
    expect(
      rulesFound(
        'ALTER TABLE "Patient" ALTER COLUMN "note" SET DEFAULT \'\';\nALTER TABLE "Patient" ALTER COLUMN "note" SET NOT NULL;'
      )
    ).toEqual([]);
  });

  it('flags a narrowing type change', () => {
    expect(
      rulesFound('ALTER TABLE "Patient" ALTER COLUMN "mrn" SET DATA TYPE VARCHAR(8);')
    ).toEqual(['type-narrowing']);
  });

  it('flags a type change between unrelated families', () => {
    expect(
      rulesFound(
        'ALTER TABLE "Patient" ALTER COLUMN "note" SET DATA TYPE INTEGER USING note::integer;'
      )
    ).toEqual(['type-narrowing']);
  });

  it('flags a rename, which breaks a running older version instantly', () => {
    expect(rulesFound('ALTER TABLE "Patient" RENAME COLUMN "note" TO "comment";')).toEqual([
      'rename',
    ]);
    expect(rulesFound('ALTER TABLE "Patient" RENAME TO "Person";')).toEqual(['rename']);
  });

  it('classifies the migration as contract and names it in the report', () => {
    const report = lintAfterBaseline('ALTER TABLE "Patient" DROP COLUMN "note";');

    expect(report.contractMigrations).toEqual(['20260202000000_change']);
    expect(report.migrations[1]?.classification).toBe('contract');
    expect(report.migrations[0]?.classification).toBe('expand');
  });

  it('reports the line the statement is on, not the line of the file', () => {
    const report = lintAfterBaseline('\n\n\nALTER TABLE "Patient" DROP COLUMN "note";');

    expect(report.findings[0]?.line).toBe(4);
  });

  it('collects several findings from one migration', () => {
    expect(
      rulesFound(
        [
          'ALTER TABLE "Patient" DROP COLUMN "note";',
          'DROP TABLE "Legacy";',
          'ALTER TABLE "Patient" ADD COLUMN "ssn" TEXT NOT NULL;',
        ].join('\n')
      ).sort()
    ).toEqual(['drop-column', 'drop-table', 'not-null-without-default']);
  });
});

describe('reporting', () => {
  it('tells a reviewer what the statement does and what to do instead', () => {
    const report = lintAfterBaseline('ALTER TABLE "Patient" DROP COLUMN "note";');
    const text = formatHuman(report, 'packages/database/prisma/migrations');

    expect(text).toContain('20260202000000_change');
    expect(text).toContain('migration.sql:1');
    expect(text).toContain('DROP COLUMN');
    expect(text).toContain('Instead:');
  });

  it('says so plainly when the history is clean', () => {
    expect(formatHuman(lintMigrations([BASELINE]), 'x')).toContain('all expand-only');
  });

  it('emits one GitHub annotation per finding, on the right file and line', () => {
    const report = lintAfterBaseline('ALTER TABLE "Patient" DROP COLUMN "note";');
    const annotations = formatAnnotations(report, 'packages/database/prisma/migrations');

    expect(annotations).toContain(
      'file=packages/database/prisma/migrations/20260202000000_change/migration.sql,line=1'
    );
    expect(annotations.split('\n')).toHaveLength(1);
  });
});

describe('the repository history', () => {
  it('is expand-only, so the linter passes on what actually ships', () => {
    const migrations = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../database/prisma/migrations'
    );

    const report = lintMigrationDirectory(migrations);

    expect(report.migrations.length).toBeGreaterThan(0);
    expect(report.findings).toEqual([]);
  });
});
