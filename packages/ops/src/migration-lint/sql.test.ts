import { describe, expect, it } from 'vitest';

import { group } from './match.js';
import { splitStatements } from './sql.js';

describe('splitStatements', () => {
  it('splits on semicolons and records the starting line of each statement', () => {
    const statements = splitStatements(
      ['CREATE TABLE "A" (id TEXT);', '', 'ALTER TABLE "A" ADD COLUMN b TEXT;'].join('\n')
    );

    expect(statements).toHaveLength(2);
    expect(statements[0]?.line).toBe(1);
    expect(statements[1]?.line).toBe(3);
  });

  it('keeps a trailing statement that has no terminating semicolon', () => {
    expect(splitStatements('DROP TABLE "A"')).toHaveLength(1);
  });

  it('drops line comments, so a statement written in prose is not linted', () => {
    const statements = splitStatements('-- DROP TABLE "Patient";\nSELECT 1;');

    expect(statements).toHaveLength(1);
    expect(statements[0]?.upper).toBe('SELECT 1');
  });

  it('drops block comments, including nested ones', () => {
    const statements = splitStatements('/* outer /* inner */ still comment */ SELECT 1;');

    expect(statements).toHaveLength(1);
    expect(statements[0]?.upper).toBe('SELECT 1');
  });

  it('does not split on a semicolon inside a string literal', () => {
    const statements = splitStatements("INSERT INTO t VALUES ('a;b');");

    expect(statements).toHaveLength(1);
    expect(statements[0]?.text).toContain("'a;b'");
  });

  it('handles doubled quotes inside a literal', () => {
    const statements = splitStatements("INSERT INTO t VALUES ('it''s; fine');");

    expect(statements).toHaveLength(1);
  });

  it('does not split inside a quoted identifier', () => {
    const statements = splitStatements('ALTER TABLE "weird;name" ADD COLUMN a TEXT;');

    expect(statements).toHaveLength(1);
  });

  it('preserves dollar-quoted bodies, semicolons and all', () => {
    const statements = splitStatements(
      'CREATE FUNCTION f() RETURNS void AS $body$ BEGIN; END; $body$ LANGUAGE plpgsql;'
    );

    expect(statements).toHaveLength(1);
    expect(statements[0]?.text).toContain('BEGIN; END;');
  });

  it('counts lines through multi-line comments so later positions stay right', () => {
    const statements = splitStatements('/* one\ntwo\nthree */\nDROP TABLE "A";');

    expect(statements[0]?.line).toBe(4);
  });

  it('returns nothing for a file that is only comments and whitespace', () => {
    expect(splitStatements('-- nothing here\n\n/* nor here */\n')).toEqual([]);
  });
});

describe('group', () => {
  it('returns a matched capture group', () => {
    const match = /(a)(b)?/.exec('a');
    expect(match).not.toBeNull();
    if (match === null) return;

    expect(group(match, 1)).toBe('a');
  });

  it('returns an empty string for a group that did not participate', () => {
    // The reason this helper exists: noUncheckedIndexedAccess types every
    // capture as possibly undefined, and an optional group really can be.
    const match = /(a)(b)?/.exec('a');
    expect(match).not.toBeNull();
    if (match === null) return;

    expect(group(match, 2)).toBe('');
    expect(group(match, 9)).toBe('');
  });
});
