import { formatCount, plural } from './format.js';
import type { Interpolations } from './format.js';
import type { Translator } from './negotiate.js';

/**
 * COUNTED MESSAGES, AND THE SEARCH WORDS A COMMAND CARRIES.
 *
 * Two helpers that every screen with a count or a command palette entry needs.
 * They were written twice, once each in the order composer and the results
 * queue, which is how Sonar found them: thirty duplicated lines in a pull
 * request whose whole subject is that a string should be written in one place.
 */

/**
 * A message that has a form per count, as the pair of keys that hold them.
 *
 * Both forms are looked up and `plural` picks between them with the reader's
 * own rules rather than with `count === 1`. The two are the same answer only in
 * languages that happen to work like English: Russian selects `one` for 21,
 * where a test against the number picks the plural.
 *
 * Two forms is a real limit and not a claim to handle every language. CLDR has
 * six categories and this carries `one` and `other`, so a locale that needs
 * `few`, `many`, `zero` or `two` gets `other` for them - which is `plural`'s
 * documented fallback and is a translation gap rather than a crash. Closing it
 * means carrying all six keys here and writing a message for each, which is
 * deliberately a change somebody makes on purpose rather than one this shape
 * pretends it has already made.
 */
export interface CountedMessage {
  readonly oneKey: string;
  readonly otherKey: string;
}

/**
 * The form the reader's language picks for this count.
 *
 * `formatCount` rather than the raw number, because the form and the digits are
 * two separate locale decisions and a message that got the grammar right and
 * the numerals wrong would still be wrong.
 */
export function counted(
  t: Translator,
  message: CountedMessage,
  count: number,
  values: Interpolations = {}
): string {
  const filled = { ...values, count: formatCount(count, t.locale) };
  return plural(
    { one: t(message.oneKey, filled), other: t(message.otherKey, filled) },
    count,
    t.locale
  );
}

/**
 * The synonyms a tired person types instead of the label.
 *
 * One comma-separated message per command, the way the navigation table already
 * carries its own, so a translator replaces the whole set rather than a word of
 * it - and a Spanish speaker looking for the flow board does not type "flow".
 *
 * The lookup stays at the call site rather than moving in here, so the key is a
 * literal `catalogue-drift.test.ts` can find. A key this function received as an
 * argument would be invisible to it.
 */
export function searchWords(words: string): string[] {
  return words
    .split(',')
    .map((word) => word.trim())
    .filter((word) => word !== '');
}
