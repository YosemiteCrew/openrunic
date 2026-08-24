import type { Translator } from '@openrunic/i18n';
import type { TableColumn } from '@openrunic/ui';

/**
 * The two things every admin screen needs in order to render words it does not
 * own: a table header built from a catalogue key, and a plural form chosen by
 * the reader's language.
 *
 * The palette's search words are NOT here. They were, taking the translator and
 * the key and doing the lookup inside - which reads well and hides the key from
 * `catalogue-drift.test.ts`, whose scanner looks for `t('key')` and
 * `somethingKey: 'key'` and nothing else. A key it cannot see is a key whose
 * typo renders as itself in a search box and fails no test. They go through
 * `searchWords` from `lib/i18n/counted.ts` instead, with the lookup at the call
 * site where the scanner can read it.
 *
 * Both exist because the alternative is per-screen. Six screens each writing
 * their own three-line column mapper is six places for the shape to drift, and
 * six screens each writing `count === 1` is English grammar hard-coded into a
 * product that ships Spanish.
 */

/** What a translator does, narrowed to what this file needs. */
/**
 * A table column as an admin screen declares it: everything `TableColumn` has,
 * except that the header is a catalogue key rather than the words.
 *
 * `headerKey` rather than `header` on purpose. The columns are module-scope
 * constants - they are the same on every render and have no business being
 * rebuilt by one - so the words cannot be in them, and a key carried as data is
 * a name ending in Key is the shape the catalogue drift test can see. The
 * example is deliberately not written out here: that scanner reads comments
 * too, and a sample key in one would be a key nothing defines.
 */
export type AdminColumn = Omit<TableColumn, 'header'> & { readonly headerKey: string };

/** The columns as the table wants them, in the reader's language. */
export function translateColumns(
  translate: Translator,
  columns: readonly AdminColumn[]
): TableColumn[] {
  return columns.map(({ headerKey, ...rest }) => ({ ...rest, header: translate(headerKey) }));
}

/**
 * The catalogue keys for one counted noun.
 *
 * Two forms, because the two languages this build carries have two. A locale
 * with more - Polish has four, Arabic six - needs its categories added here and
 * a message written for each of them, which is deliberately a change that
 * cannot be made halfway: `pluralKey` would otherwise pick `other` and produce
 * a sentence that reads as broken only to somebody who speaks the language.
 */
export interface PluralKeys {
  readonly oneKey: string;
  readonly otherKey: string;
}

/**
 * The key whose message agrees with this count, in this locale.
 *
 * `Intl.PluralRules` rather than `count === 1`, because the two are the same
 * answer only in the languages that happen to work like English. Spanish agrees
 * with English here; the reason to ask properly is the third language, which
 * arrives without anybody revisiting this call site.
 */
export function pluralKey(keys: PluralKeys, count: number, locale: string): string {
  return new Intl.PluralRules(locale).select(count) === 'one' ? keys.oneKey : keys.otherKey;
}
