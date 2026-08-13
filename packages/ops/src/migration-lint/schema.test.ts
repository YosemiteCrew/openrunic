import { describe, expect, it } from 'vitest';

import {
  applyStatement,
  normaliseIdentifier,
  parseColumnDefinition,
  type SchemaModel,
} from './schema.js';
import { splitStatements } from './sql.js';

function replay(sql: string, migrationIndex = 0): SchemaModel {
  const schema: SchemaModel = new Map();
  for (const statement of splitStatements(sql)) {
    applyStatement(schema, statement, migrationIndex);
  }
  return schema;
}

describe('normaliseIdentifier', () => {
  it('strips quoting and schema qualification', () => {
    expect(normaliseIdentifier('"Patient"')).toBe('Patient');
    expect(normaliseIdentifier('public."Patient"')).toBe('Patient');
    expect(normaliseIdentifier('  patient  ')).toBe('patient');
  });
});

describe('parseColumnDefinition', () => {
  it('reads name, type, nullability and default', () => {
    expect(parseColumnDefinition('"name" VARCHAR(20) NOT NULL DEFAULT \'x\'')).toEqual({
      name: 'name',
      type: 'VARCHAR(20)',
      notNull: true,
      hasDefault: true,
    });
  });

  it('keeps multi-word types whole', () => {
    expect(parseColumnDefinition('"at" TIMESTAMP WITH TIME ZONE NOT NULL')?.type).toBe(
      'TIMESTAMP WITH TIME ZONE'
    );
    expect(parseColumnDefinition('"n" DOUBLE PRECISION')?.type).toBe('DOUBLE PRECISION');
  });

  it('ignores table-level constraints', () => {
    expect(parseColumnDefinition('PRIMARY KEY ("id")')).toBeNull();
    expect(
      parseColumnDefinition('CONSTRAINT "fk" FOREIGN KEY ("a") REFERENCES "B"("id")')
    ).toBeNull();
    expect(parseColumnDefinition('   ')).toBeNull();
  });
});

describe('applyStatement', () => {
  it('models CREATE TABLE, splitting on top-level commas only', () => {
    const schema = replay(
      'CREATE TABLE "Charge" ("id" TEXT NOT NULL, "amount" NUMERIC(10,2) NOT NULL, PRIMARY KEY ("id"));'
    );

    const table = schema.get('Charge');
    expect([...(table?.columns.keys() ?? [])]).toEqual(['id', 'amount']);
    expect(table?.columns.get('amount')?.type).toBe('NUMERIC(10,2)');
  });

  it('records which migration created a table', () => {
    const schema: SchemaModel = new Map();
    for (const statement of splitStatements('CREATE TABLE "A" ("id" TEXT);')) {
      applyStatement(schema, statement, 4);
    }
    expect(schema.get('A')?.createdInMigration).toBe(4);
  });

  it('tracks columns added, dropped and retyped across statements', () => {
    const schema = replay(
      [
        'CREATE TABLE "A" ("id" TEXT NOT NULL, "note" VARCHAR(50));',
        'ALTER TABLE "A" ADD COLUMN "extra" INTEGER;',
        'ALTER TABLE "A" DROP COLUMN "note";',
        'ALTER TABLE "A" ALTER COLUMN "extra" SET DATA TYPE BIGINT;',
      ].join('\n')
    );

    const table = schema.get('A');
    expect(table?.columns.has('note')).toBe(false);
    expect(table?.columns.get('extra')?.type).toBe('BIGINT');
  });

  it('tracks nullability and default changes', () => {
    const schema = replay(
      [
        'CREATE TABLE "A" ("id" TEXT, "b" TEXT);',
        'ALTER TABLE "A" ALTER COLUMN "b" SET DEFAULT \'x\';',
        'ALTER TABLE "A" ALTER COLUMN "b" SET NOT NULL;',
      ].join('\n')
    );

    expect(schema.get('A')?.columns.get('b')).toMatchObject({ notNull: true, hasDefault: true });
  });

  it('drops a table from the model', () => {
    expect(replay('CREATE TABLE "A" ("id" TEXT);\nDROP TABLE "A";').has('A')).toBe(false);
  });

  it('ignores statements it does not model rather than throwing', () => {
    expect(() =>
      replay('CREATE INDEX "i" ON "A"("id");\nCREATE TYPE "E" AS ENUM (\'a\');\nSELECT 1;')
    ).not.toThrow();
  });

  it('ignores an ALTER against a table it has never seen', () => {
    expect(replay('ALTER TABLE "Ghost" DROP COLUMN "x";').size).toBe(0);
  });
});
