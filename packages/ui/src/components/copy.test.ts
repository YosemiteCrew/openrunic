import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * A COMPONENT LIBRARY DOES NOT WRITE THE WORDS.
 *
 * This package has no translator and should not grow one. It is a design
 * system: a consumer configures it, and the label on a dismiss button is
 * configuration the same way the message beside it is.
 *
 * Thirteen strings were written into components instead, so a Spanish staff
 * screen announced its primary navigation as "Primary", its menu button as
 * "Menu" and its close control as "Dismiss". Every one is a prop now, with the
 * English it used to hardcode as the default, and `apps/web` passes a catalogue
 * string. This is what stops the fourteenth being written.
 *
 * ## What it looks for, and what it deliberately does not
 *
 * A string literal in an accessible-name attribute: `aria-label`, `alt`,
 * `title`, `placeholder`. That shape is exact, so the scan has no judgement to
 * exercise and no false positives to argue about. `aria-label={closeLabel}` is
 * an expression and passes.
 *
 * It does not try to find English in a JSX text node. A pattern for "a bare
 * word between tags" would match every story fixture and half the class names,
 * and #132 recorded what a loose pattern over source costs. The three text
 * nodes that carried words - `SideNav`'s Menu and Close, `NavBar`'s Get started -
 * are covered by the tests beside them, which render each component with a label
 * of their own and assert it appears.
 */

const COMPONENTS = join(import.meta.dirname);

/**
 * The product's name is not a word.
 *
 * `openrunic` is `openrunic` in every language, the way it is on the README and
 * in the page titles, so the brand marks announce it as a literal. It is spelled
 * in lower case here because it is spelled in lower case everywhere else, which
 * it was not: five of these said "OpenRunic", so a sighted reader saw one
 * spelling and a screen-reader user heard another on the same element.
 *
 * One value, not a growing list. A second entry here would mean this test had
 * stopped being a guard and started being a record of what somebody decided not
 * to fix.
 */
const NOT_A_WORD = new Set(['openrunic']);

/** `aria-label="Dismiss"`. Not `aria-label={closeLabel}`, which is an expression. */
const LITERAL_NAME = /\b(?:aria-label|alt|title|placeholder)="(?<text>[^"]+)"/gu;

function componentSources(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      found.push(...componentSources(path));
      continue;
    }
    if (!/\.tsx$/u.test(entry)) continue;
    if (/\.(?:test|stories)\.tsx$/u.test(entry)) continue;
    found.push(path);
  }
  return found;
}

describe('the components take their words from the consumer', () => {
  it('is reading the components it thinks it is', () => {
    // The guard on the guard. This asserts an absence, which is the case where
    // a scan that found nothing passes while proving nothing.
    expect(componentSources(COMPONENTS).length).toBeGreaterThan(20);
  });

  it('writes no accessible name into a component', () => {
    const written: string[] = [];
    for (const path of componentSources(COMPONENTS)) {
      const text = readFileSync(path, 'utf8');
      for (const match of text.matchAll(LITERAL_NAME)) {
        const name = match.groups?.['text'] ?? '';
        if (NOT_A_WORD.has(name)) continue;
        written.push(`${path.slice(COMPONENTS.length + 1)}: ${match[0]}`);
      }
    }

    expect(written).toStrictEqual([]);
  });
});
