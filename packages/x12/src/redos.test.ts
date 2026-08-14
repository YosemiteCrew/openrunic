import { describe, expect, it } from 'vitest';

import { DEFAULT_DELIMITERS } from './delimiters.js';
import { readSegments } from './segments.js';

/**
 * Linearity, held as a property.
 *
 * The segment trim used to end with `/[\r\n]+$/`: anchored at the end but not
 * the start, so the engine retried the run from every position and cost grew
 * with the square of the segment length. CodeQL named it, and the input is a
 * payer's interchange file rather than anything this project controls.
 *
 * The threshold is loose enough to survive a loaded CI runner and tight enough
 * that a reintroduced backtracker cannot pass: the old expression took minutes
 * on the input below.
 */
const BUDGET_MS = 1_000;
const RUN = 100_000;

// The canonical set, not a hand-rolled literal: the interchange defaults are
// already exported, and a partial copy of them here would type-check only by
// accident of what readSegments happens to read.
const DELIMITERS = DEFAULT_DELIMITERS;

function elapsed(work: () => void): number {
  const started = performance.now();
  work();
  return performance.now() - started;
}

describe('segment reading stays linear on padded input', () => {
  it('handles a segment with a long trailing newline run', () => {
    const raw = `NM1*IL*1*PATIENTSSON*TESTINA${'\n'.repeat(RUN)}~`;

    expect(elapsed(() => readSegments(raw, DELIMITERS))).toBeLessThan(BUDGET_MS);
  });

  it('handles a long leading indent', () => {
    const raw = `${' '.repeat(RUN)}NM1*IL*1*PATIENTSSON*TESTINA~`;

    let segments: readonly { tag: string }[] = [];
    expect(elapsed(() => (segments = readSegments(raw, DELIMITERS)))).toBeLessThan(BUDGET_MS);
    // Still correct, not merely fast.
    expect(segments[0]?.tag).toBe('NM1');
  });

  it('handles a run that never terminates the segment', () => {
    // No trailing separator at all, so the trim runs to the end of the string.
    const raw = `NM1*IL${'\r\n'.repeat(RUN)}`;

    expect(elapsed(() => readSegments(raw, DELIMITERS))).toBeLessThan(BUDGET_MS);
  });

  it('keeps a trailing space, which is data in a fixed-width ISA', () => {
    // The trailing set is \r and \n only, deliberately. ISA elements are
    // space-padded to a fixed width and that padding carries meaning.
    const segments = readSegments('ISA*00*          *00*          ~', DELIMITERS);

    expect(segments[0]?.elements[1]).toBe('          ');
  });
});
