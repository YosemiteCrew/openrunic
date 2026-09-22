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
 * EXEMPT, on the element rather than on the string: `<kbd>` renders a key cap, and a key
 * cap is the same in every language. Keyed on the construct rather than on the prose
 * because an exemption that names a string is an unchecked claim about that string,
 * while one that names an element is a fact about what the element is for. It excuses
 * exactly one site in the tree today - `apps/web` `TopBar.tsx:95`, "Cmd K".
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

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * EVERY Next app, discovered from a property of the thing being guarded.
 *
 * The first version of this resolved its root from `__dirname`, so it swept
 * `apps/portal` and nothing else - and `apps/web` has 144 more component files. That is
 * the third guard written today to take the location of its own file as its blast
 * radius, and the author cannot see it, because the guard is green exactly where they
 * are standing. A Next app is a directory with a `next.config.*`; that is the property,
 * and a fourth app is swept the day it appears rather than the day somebody remembers.
 */
function repoRoot(): string {
  let dir = __dirname;
  for (let up = 0; up < 8; up += 1) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('hardcoded-jsx guard: no pnpm-workspace.yaml above this file');
}

const APPS = path.join(repoRoot(), 'apps');

const nextApps = readdirSync(APPS, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((app) => readdirSync(path.join(APPS, app)).some((f) => f.startsWith('next.config.')));

/** `__tests__` is excluded from each: fixtures there are not rendered to anybody. */
const roots = nextApps.map((app) => [app, path.join(APPS, app, 'src')] as const);

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

/** Elements whose text is not prose in any language. */
const NOT_PROSE = new Set(['kbd']);

function enclosingTag(node: ts.JsxText): string | undefined {
  const parent = node.parent;
  return ts.isJsxElement(parent) ? parent.openingElement.tagName.getText() : undefined;
}

function hardcodedJsxText(file: string, source: string): string[] {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      const text = node.text.trim();
      const tag = enclosingTag(node);
      if (CARRIES_WORDS.test(text.replace(ENTITY, '')) && !(tag && NOT_PROSE.has(tag))) {
        const { line } = parsed.getLineAndCharacterOfPosition(node.getStart(parsed));
        found.push(
          `${path.relative(APPS, file)}:${line + 1}  ${JSON.stringify(text.slice(0, 60))}`
        );
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

    const hits = hardcodedJsxText(path.join(APPS, 'Planted.tsx'), planted);

    expect(hits).toHaveLength(1);
    expect(hits[0]).toContain('Send a message');
  });

  it('does not fire on a key cap, which is the same in every language', () => {
    const keycap = [
      'export function Bar() {',
      '  return (',
      '    <span>',
      '      <kbd>Cmd K</kbd>',
      '      <b>Search everything</b>',
      '    </span>',
      '  );',
      '}',
    ].join('\n');

    const hits = hardcodedJsxText(path.join(APPS, 'Bar.tsx'), keycap);

    /* Both arms in one fixture: the exemption must excuse the key cap AND not the
       sentence beside it, or it is an exemption on the file rather than the element. */
    expect(hits).toHaveLength(1);
    expect(hits[0]).toContain('Search everything');
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

    expect(hardcodedJsxText(path.join(APPS, 'Clean.tsx'), clean)).toEqual([]);
  });
});

describe('every Next app', () => {
  /*
   * The canary, counted against `next.config.*` rather than against the same walk. A
   * discovery that stopped matching would sweep nothing and report no drift, which is
   * byte-identical to a clean tree - so the count that proves the sweep found the apps
   * has to come from somewhere the sweep does not derive.
   */
  it('finds a src directory for every Next app', () => {
    /*
     * This threshold is the entire difference between a red run and a green one that
     * checked nothing. Driven: break discovery AND delete this line and the suite
     * reports `1 passed`, rc=0 - `it.each` over an empty array does not fail its cases,
     * it stops generating them, and a shrunken suite is what a healthy small one looks
     * like. It is inert in every other state, which is exactly why a tidy-up deletes it
     * while looking straight at it. Do not.
     */
    expect(nextApps.length).toBeGreaterThan(1);
    expect(roots.filter(([, src]) => !existsSync(src)).map(([app]) => app)).toEqual([]);
  });

  it.each(roots)('%s renders no JSX text the catalogue was never asked for', (_app, src) => {
    const files = tsxFiles(src);
    expect(files.length).toBeGreaterThan(10);

    expect(files.flatMap((file) => hardcodedJsxText(file, readFileSync(file, 'utf8')))).toEqual([]);
  });
});
