import { createTranslator } from './negotiate.js';
import { describe, expect, it } from 'vitest';

import { counted, searchWords } from './counted.js';
import type { CountedMessage } from './counted.js';

/**
 * The two helpers every screen with a count or a palette command reaches for.
 *
 * They were written three times before they were written once - the order
 * composer, the billing screens and the admin screens each grew their own - so
 * they are tested here, where they now live, rather than three times in three
 * places that could each be right about something different.
 */

const MESSAGE: CountedMessage = {
  oneKey: 'test.count.one',
  otherKey: 'test.count.other',
};

/** A translator over a catalogue written for this file, so no screen's copy decides. */
function translator(locale: string) {
  return createTranslator(
    {
      sourceLocale: 'en',
      messages: {
        en: { 'test.count.one': '{count} result', 'test.count.other': '{count} results' },
        es: { 'test.count.one': '{count} resultado', 'test.count.other': '{count} resultados' },
        /* Russian, because it is the one that discriminates. See below. */
        ru: { 'test.count.one': '{count} результат', 'test.count.other': '{count} результатов' },
      },
    },
    locale
  );
}

describe('a counted message', () => {
  it('picks the form the count calls for', () => {
    const t = translator('en');

    expect(counted(t, MESSAGE, 1)).toBe('1 result');
    expect(counted(t, MESSAGE, 4)).toBe('4 results');
  });

  /**
   * The reason this is not `count === 1`, and the count is 21 for a reason.
   *
   * The first version of this test used Spanish and zero, and proved nothing:
   * English and Spanish both select `other` for zero, so a hard-coded
   * `count === 1 ? one : other` passes it identically. Its comment claimed such
   * an implementation would render the singular, which was simply false.
   *
   * Russian is the one that discriminates. `Intl.PluralRules('ru').select(21)`
   * is `one` where English is `other`, so an implementation that tested the
   * number against 1 would pick the plural form here and this fails.
   */
  it('asks the locale rather than assuming English grammar', () => {
    expect(new Intl.PluralRules('ru').select(21)).toBe('one');
    expect(new Intl.PluralRules('en').select(21)).toBe('other');

    expect(counted(translator('ru'), MESSAGE, 21)).toBe('21 результат');
    expect(counted(translator('en'), MESSAGE, 21)).toBe('21 results');
  });

  /** Spanish still gets its own words, which is the ordinary case. */
  it('renders each locale in its own words', () => {
    expect(counted(translator('es'), MESSAGE, 1)).toBe('1 resultado');
    expect(counted(translator('es'), MESSAGE, 4)).toBe('4 resultados');
  });

  /**
   * The digits are a second locale decision, separate from the grammar. A
   * message that got the form right and the numerals wrong would still be
   * wrong to the person reading it.
   */
  it('formats the number for the reader as well as the word', () => {
    expect(counted(translator('en'), MESSAGE, 12_000)).toBe('12,000 results');
  });

  it("carries the caller's other values through", () => {
    const t = createTranslator(
      {
        sourceLocale: 'en',
        messages: {
          en: { 'test.of.one': '{count} of {total}', 'test.of.other': '{count} of {total}' },
        },
      },
      'en'
    );

    expect(
      counted(t, { oneKey: 'test.of.one', otherKey: 'test.of.other' }, 3, { total: '9' })
    ).toBe('3 of 9');
  });
});

describe("a command's search words", () => {
  it('splits the message and drops the empty ones', () => {
    expect(searchWords('filter, active users, ,')).toStrictEqual(['filter', 'active users']);
  });

  /**
   * A stray comma is not hypothetical: the list is hand-written per language,
   * and an empty word would register a command that matches every search.
   */
  it('never yields an empty word', () => {
    expect(searchWords(' , , ')).toStrictEqual([]);
    expect(searchWords('')).toStrictEqual([]);
  });

  it('keeps a multi-word phrase together', () => {
    expect(searchWords('card on file, text to pay')).toStrictEqual(['card on file', 'text to pay']);
  });
});
