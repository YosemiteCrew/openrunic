import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { SERVED_MODULES } from '../fhir/resources.js';

/**
 * The README's resource table, held to the router that generates it.
 *
 * This test exists because the table had already drifted before anything
 * checked it: two resources had been mounted without being listed, and the
 * count sentence above the table still said seventeen. Nobody had written a
 * wrong fact - each edit was right when it landed, and the next one did not
 * come back to the doc.
 *
 * That is the drift CLAUDE.md calls the worst class of defect here, and asking
 * the next person to remember is what already failed. A table generated from
 * the modules would be another way to close it, but the table is the first
 * thing an integrator reads and hand-written prose in the cells is worth
 * keeping; asserting it is the cheaper half of the same guarantee.
 *
 * It reads the file rather than the CapabilityStatement on purpose:
 * `fhir.conformance.test.ts` already holds the statement to the modules, so
 * going through it would prove the statement twice and the README not at all.
 */

const README = fileURLToPath(new URL('../../README.md', import.meta.url));

interface DocRow {
  readonly type: string;
  readonly params: readonly string[];
}

/** Every `| \`Type\` | \`a\`, \`b\` |` row of the served-resource table. */
function tableRows(markdown: string): readonly DocRow[] {
  const rows: DocRow[] = [];
  for (const line of markdown.split('\n')) {
    const match = /^\| `(?<type>[A-Za-z]+)`\s*\|(?<cell>[^|]*)\|\s*$/u.exec(line);
    if (match?.groups === undefined) continue;
    rows.push({
      type: match.groups['type'] ?? '',
      params: [...(match.groups['cell'] ?? '').matchAll(/`(?<param>[^`]+)`/gu)].map(
        (found) => found.groups?.['param'] ?? ''
      ),
    });
  }
  return rows;
}

describe('the README resource table', () => {
  const rows = tableRows(readFileSync(README, 'utf8'));

  it('lists every mounted resource, in the order they are mounted', () => {
    expect(rows.map((row) => row.type)).toEqual(SERVED_MODULES.map((module) => module.type));
  });

  it('lists exactly the parameters each resource implements', () => {
    expect(rows.map((row) => [row.type, row.params])).toEqual(
      SERVED_MODULES.map((module) => [module.type, [...module.params]])
    );
  });

  it('states the number of served resources correctly', () => {
    const words = [
      'Seventeen',
      'Eighteen',
      'Nineteen',
      'Twenty',
      'Twenty-one',
      'Twenty-two',
      'Twenty-three',
    ];
    const expected = words[SERVED_MODULES.length - 17];
    expect(expected, 'the count sentence needs a word for this many resources').toBeDefined();
    expect(readFileSync(README, 'utf8')).toContain(`${String(expected)} resource types are served`);
  });
});
