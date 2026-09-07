/**
 * No screen renders a user-visible string that never asked the catalogue for it.
 *
 * This exists because catalogue coverage cannot see the failure it is named for.
 * `coverageOf(appCatalogue, 'es')` reported ZERO missing `portal.*` keys while the home
 * screen rendered three English buttons to a Spanish reader (#303): a catalogue is
 * complete when nothing asks it for a key it does not have, and a hardcoded literal
 * never asks. Coverage measures the catalogue; this measures the call sites.
 *
 * ## What it can and cannot see
 *
 * CAN: JSX text - the characters between tags, which are by definition rendered.
 *   <Button>See all appointments</Button>
 *
 * CANNOT, and each is a real way the same defect can arrive:
 *   - a string in an ATTRIBUTE: aria-label="Close", title="Bill", alt="..."
 *   - a string built in JS and interpolated: {isVideo ? 'Join' : 'Go'}
 *   - a string arriving as DATA from the API or a fixture, which is `actionLabel`
 *     and is the open half of #303 rather than an oversight here
 *
 * Named rather than silently absent: a guard whose scope is not written down reads as
 * covering everything, and the next reader is entitled to know which of the three
 * remaining shapes this will not catch.
 *
 * Parsed with the TypeScript parser rather than matched with a regular expression. A
 * `>` ... `<` pattern cannot tell JSX text from a generic or a comparison - the first
 * version of this scan returned ten hits and every one was `useState<T>(null)`.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/** Where the screens live. `__tests__` is excluded: fixtures here are not rendered. */
const SRC = path.resolve(__dirname, '..');

function tsxFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') tsxFiles(full, found);
    } else if (entry.name.endsWith('.tsx')) {
      found.push(full);
    }
  }
  return found;
}

/**
 * HTML entities, removed before the word test. `&middot;` is punctuation a reader never
 * reads as a word, and its NAME is letters - the must-not-fire arm below caught this on
 * the scanner's first run, which is the whole reason that arm exists.
 */
const ENTITY = /&(?:[A-Za-z][A-Za-z0-9]*|#\d+|#[Xx][0-9A-Fa-f]+);/g;

/** Two or more consecutive letters, once entities are gone: prose, never punctuation. */
const CARRIES_WORDS = /[A-Za-z]{2,}/;

function hardcodedJsxText(file: string, source: string): string[] {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      const text = node.text.trim();
      if (CARRIES_WORDS.test(text.replace(ENTITY, ''))) {
        const { line } = parsed.getLineAndCharacterOfPosition(node.getStart(parsed));
        found.push(`${path.relative(SRC, file)}:${line + 1}  ${JSON.stringify(text.slice(0, 60))}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return found;
}

describe('the scanner itself', () => {
  /*
   * The must-fire arm, and it is inside the test rather than beside it. A source scan
   * that silently stops matching returns an empty list, which is the same output as a
   * clean tree - so the arm that proves it can still see has to run every time, not
   * once when it was written. The needle is built here and is not in the scanned tree.
   */
  it('finds a hardcoded string in a component that already holds a translator', () => {
    const planted = [
      'export function Card({ t }: { t: (k: string) => string }) {',
      '  return (',
      '    <div>',
      '      <span>{t("portal.home.title")}</span>',
      '      <button>Send a message</button>',
      '    </div>',
      '  );',
      '}',
    ].join('\n');

    const hits = hardcodedJsxText(path.join(SRC, 'Planted.tsx'), planted);

    expect(hits).toHaveLength(1);
    expect(hits[0]).toContain('Send a message');
  });

  it('does not fire on a translated call, a generic, or punctuation', () => {
    const clean = [
      'export function Card({ t }: { t: (k: string) => string }) {',
      '  const [open, setOpen] = useState<string | null>(null);',
      '  return (',
      '    <div>',
      '      <span>{t("portal.home.title")}</span>',
      '      <span>&middot;</span>',
      '      <span>{open ? 1 : 2}</span>',
      '    </div>',
      '  );',
      '}',
    ].join('\n');

    expect(hardcodedJsxText(path.join(SRC, 'Clean.tsx'), clean)).toEqual([]);
  });
});

describe('every portal screen', () => {
  it('renders no JSX text the catalogue was never asked for', () => {
    const files = tsxFiles(SRC);
    expect(files.length).toBeGreaterThan(10);

    const hits = files.flatMap((file) => hardcodedJsxText(file, readFileSync(file, 'utf8')));

    expect(hits).toEqual([]);
  });
});
