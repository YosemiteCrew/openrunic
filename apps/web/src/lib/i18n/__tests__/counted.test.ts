import { createTranslator } from '@openrunic/i18n';
import { describe, expect, it } from 'vitest';

import { counted, searchWords } from '../counted';
import type { CountedMessage } from '../counted';

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
   * The reason this is not `count === 1`. Spanish agrees with English about one
   * and about four; it does not agree about zero, and a screen testing for one
   * would say "0 resultado".
   */
  it('asks the locale rather than assuming English grammar', () => {
    const es = translator('es');

    expect(counted(es, MESSAGE, 1)).toBe('1 resultado');
    expect(counted(es, MESSAGE, 0)).toBe('0 resultados');
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
