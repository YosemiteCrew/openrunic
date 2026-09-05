import { appCatalogue, createTranslator, format, formatCount, verbatim } from '@openrunic/i18n';
import type { Interpolations } from '@openrunic/i18n';
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
 * There are two halves here because neither is enough on its own. The first
 * shows the digits actually change. The second is the type that stops the class
 * coming back at all, and the note above it records what the source scan it
 * replaced could not see.
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
 * WHAT REPLACED THE SOURCE GUARD, AND WHY IT IS NOT A REGEX ANY MORE.
 *
 * There used to be a scan of `apps/web/src` for `count:` followed by a bare
 * identifier. It was green while thirty raw interpolations were live, for three
 * separate reasons rather than one bug:
 *
 * 1. Its call exemption was "the value contains a call" and the intent was "the
 *    value calls `formatCount`". `count: lines.filter(...).length` walked past.
 * 2. Property shorthand has no colon, so `{ count }` was invisible to it.
 * 3. It knew one placeholder name. Twenty-six live sites carried a raw number
 *    under `minutes`, `version`, `total`, `paid`, `percent`, `ms`, `days`,
 *    `sequence`, `low` and `high`.
 *
 * A guard named for the instance covers the instance. `Interpolations` is now
 * `Readonly<Record<string, string>>`, so the compiler enumerates the whole
 * class in one pass and there is no name for it to have been named after. #285.
 *
 * What remains here is the assertion that the type is still the type. It is the
 * one thing tsc cannot tell you on its own: widening it back is legal
 * TypeScript, every call site keeps compiling, and nothing anywhere else goes
 * red.
 */
describe('the type of an interpolation', () => {
  it('rejects a raw number, which is what stops the class coming back', () => {
    // `@ts-expect-error` inverts on its own. Widen `Interpolations` back to
    // `string | number` and these stop being errors, the directives become
    // unused, and `pnpm --filter web run type-check` fails with TS2578 - red on
    // the gate rather than green in a suite that only makes legal calls.
    const values: Interpolations = {
      // @ts-expect-error a count belongs in formatCount, not in the message
      count: 24,
      // @ts-expect-error an identifier belongs in verbatim, not in the message
      version: 3,
    };

    // Not dead weight: it also pins that the runtime still refuses what the
    // type refuses, for the JavaScript caller the type cannot reach.
    expect(() => format('{count} of {version}', values, 'k')).toThrow(/not a string/u);
  });

  it('accepts what the two helpers return', () => {
    const values: Interpolations = {
      count: formatCount(24, 'en'),
      version: verbatim(3),
    };

    expect(format('{count} of {version}', values, 'k')).toBe('24 of 3');
  });
});
