import { describe, expect, it } from 'vitest';

import { fillGeneratedSecrets } from '../env/secrets.js';
import { parseColumnDefinition } from './schema.js';
import { parseType } from './types.js';

/**
 * Linearity, held as a property rather than a comment.
 *
 * Five patterns in this package spelled `\s+` (or a lazy `.*?`) twice in one
 * expression. Whitespace can be handed to either half, so the engine explores
 * every split before it gives up: quadratic on the length of the run. CodeQL
 * named all five (js/polynomial-redos), and both places these parsers read
 * from - a migration file and a .env - are caller-supplied.
 *
 * A budget rather than a stopwatch: the point is the difference between
 * milliseconds and minutes, so the threshold is loose enough to survive a
 * loaded CI runner and tight enough that a reintroduced backtracker cannot
 * pass. Each of these inputs took a backtracking engine well past a minute.
 */
const BUDGET_MS = 1_000;
const RUN = 50_000;

function elapsed(work: () => void): number {
  const started = performance.now();
  work();
  return performance.now() - started;
}

describe('the parsers stay linear on pathological whitespace', () => {
  it('parses a column definition with a long blank run', () => {
    // Never reaches a constraint keyword, so the old pattern backtracked over
    // every possible split of the run before failing.
    const definition = `"note"${' '.repeat(RUN)}TEXT`;

    expect(elapsed(() => parseColumnDefinition(definition))).toBeLessThan(BUDGET_MS);
  });

  it('parses a column whose constraint sits behind a long blank run', () => {
    const definition = `"note" TEXT${' '.repeat(RUN)}NOT NULL`;

    let parsed: ReturnType<typeof parseColumnDefinition> = null;
    expect(elapsed(() => (parsed = parseColumnDefinition(definition)))).toBeLessThan(BUDGET_MS);
    // Still correct, not merely fast.
    expect(parsed).toMatchObject({ name: 'note', type: 'TEXT', notNull: true });
  });

  it('parses a type with no parentheses after a long blank run', () => {
    // `(.*?)\s*\(` had nothing to anchor on, so a string with no '(' was the
    // worst case rather than the trivial one.
    const raw = `TIMESTAMP${' '.repeat(RUN)}WITH TIME ZONE`;

    expect(elapsed(() => parseType(raw))).toBeLessThan(BUDGET_MS);
    expect(parseType(raw).base).toBe('TIMESTAMPTZ');
  });

  it('fills secrets in a .env line with a long blank run', () => {
    const contents = `A=${' '.repeat(RUN)}`;

    expect(elapsed(() => fillGeneratedSecrets(contents, () => 'x'))).toBeLessThan(BUDGET_MS);
  });

  it('still rewrites only the sentinel, and keeps the shape of the line', () => {
    const result = fillGeneratedSecrets(
      ['POSTGRES_PASSWORD = generate-me', 'KEEP_ME=already-set', 'not a pair'].join('\n'),
      () => 'fresh'
    );

    expect(result.generated).toEqual(['POSTGRES_PASSWORD']);
    // The spaces around '=' are preserved verbatim: an installer that reformats
    // a file it was asked to edit is an installer nobody points at production.
    expect(result.contents).toBe(
      ['POSTGRES_PASSWORD = fresh', 'KEEP_ME=already-set', 'not a pair'].join('\n')
    );
  });
});
