import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { appCatalogue, createTranslator } from '@openrunic/i18n';
import { describe, expect, it } from 'vitest';

import { counted } from '../counted';

/**
 * A COUNT GETS THE READER'S GRAMMAR AND THE READER'S DIGITS.
 *
 * `plural` and `pluralKey` pick the form the reader's language calls for, and
 * every screen was already using them. The number itself went in raw:
 *
 *     t('billing.claims.selectedCount', { count: selectedCount })
 *
 * which renders in Latin digits with no grouping whatever the locale, so an
 * Arabic reader got the right grammar around the wrong numerals and a German
 * reader got "1,200" where their language writes "1.200". The two are separate
 * locale decisions, as `packages/i18n`'s own `formatCount` says, and a message
 * that gets one right and the other wrong is still wrong.
 *
 * There are two tests here because neither is enough on its own. The first
 * shows the digits actually change; the second stops the twenty-six call sites
 * that were fixed from becoming twenty-seven.
 */

/** Arabic-Indic digits, which is the only cheap way to see a numeral change. */
const ARABIC = createTranslator(appCatalogue, 'ar-EG');
const ENGLISH = createTranslator(appCatalogue, 'en');

describe('the digits in a counted message', () => {
  it('are the reader’s, not the runtime’s default', () => {
    // `ar-EG` has no catalogue here, so the words fall back to English. The
    // numerals do not, which is what makes this an assertion about `formatCount`
    // rather than about a translation.
    const message = {
      oneKey: 'admin.users.accountCount.one',
      otherKey: 'admin.users.accountCount.other',
    };

    expect(counted(ARABIC, message, 24)).toBe('٢٤ accounts');
    expect(counted(ENGLISH, message, 24)).toBe('24 accounts');
    // And in a language that does have a catalogue, both halves are the
    // reader's: the noun from the translation, the digits from the runtime.
    expect(counted(createTranslator(appCatalogue, 'es'), message, 24)).toBe('24 cuentas');
  });
});

/*
 * The source guard.
 *
 * Deliberately narrow, for the reason #132 recorded: a loose pattern over source
 * matches things that are not what it thinks they are. This looks for exactly
 * one shape - a `count` property whose value is a bare identifier or member
 * expression, with no call in it - and nothing cleverer. `count: formatCount(n,
 * locale)` passes because it is a call; `count: rows.length` fails.
 *
 * ## WHAT IT DOES NOT SEE, MEASURED - #285
 *
 * It reported zero while raw counts were live in two files, and there are three
 * separate reasons rather than one bug:
 *
 * 1. The call exemption above is "the value contains a call", and the intent was
 *    "the value calls `formatCount`". `count: lines.filter(...).length` is a
 *    call, so it walked past.
 * 2. Property shorthand has no colon. `{ count }` is invisible to `\bcount:`.
 * 3. The pattern knows one placeholder name. Twenty-six live sites interpolate a
 *    raw number under `minutes`, `version`, `total`, `paid`, `percent`, `ms`,
 *    `days`, `sequence`, `low`, `high` and others, and no widening of a name
 *    this pattern was given can reach a name nobody has invented yet.
 *
 * #285 replaces this half with the type: `Interpolations` narrowed to `string`
 * makes the compiler enumerate the class instead of a regex guessing at it. The
 * behavioural test above is not affected and stays either way. Widening this
 * pattern in the meantime is not worth it - a guard named for the instance
 * rather than for the class covers the instance.
 */
const SOURCE_ROOT = join(import.meta.dirname, '../../..');

/** `count: rows.length`, `count: total`. Not `count: formatCount(...)`, not `count: number`. */
const RAW_COUNT = /\bcount:\s*(?<value>[A-Za-z_$][\w$]*(?:\.[\w$]+)*)\s*[,}]/gu;

/** A type annotation, not a value. */
const TYPES = new Set(['number', 'string', 'boolean']);

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      found.push(...sourceFiles(path));
      continue;
    }
    if (/\.tsx?$/u.test(entry)) found.push(path);
  }
  return found;
}

describe('no screen interpolates a bare number into a count', () => {
  it('finds the sites it is meant to be reading', () => {
    // The guard on the guard. A pattern that matched nothing would make the
    // assertion below pass while proving nothing, and this one is looking for
    // an absence, which is the case where that failure is invisible.
    const anyCount = sourceFiles(SOURCE_ROOT)
      .map((path) => readFileSync(path, 'utf8'))
      .filter((text) => /\bcount:/u.test(text)).length;

    expect(anyCount).toBeGreaterThan(10);
  });

  it('routes every one of them through formatCount', () => {
    const raw: string[] = [];
    for (const path of sourceFiles(SOURCE_ROOT)) {
      const text = readFileSync(path, 'utf8');
      for (const match of text.matchAll(RAW_COUNT)) {
        const value = match.groups?.['value'] ?? '';
        if (TYPES.has(value)) continue;
        raw.push(`${path.slice(SOURCE_ROOT.length + 1)}: count: ${value}`);
      }
    }

    expect(raw).toStrictEqual([]);
  });
});
