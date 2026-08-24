import { formatCount, plural } from '@openrunic/i18n';
import type { Interpolations, Translator } from '@openrunic/i18n';

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
 * own rules rather than with `count === 1`: English has two forms, and a fork
 * translating into a language with four would otherwise get a sentence that
 * reads as broken only to somebody who speaks it.
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
