import { appCatalogue, createTranslator } from '@openrunic/i18n';
import type { Interpolations } from '@openrunic/i18n';
import type { Metadata } from 'next';

import { resolveLocale } from './locale';

/**
 * THE BROWSER TAB, IN THE READER'S LANGUAGE.
 *
 * A route file is a server component and owns its metadata, so it cannot reach
 * `useTranslator`. Every one of them carried an English string instead, which
 * meant a reader who had chosen Spanish got a Spanish schedule in a tab labelled
 * "Schedule". The tab strip is often all a tired person has to tell nine open
 * charts apart, so it is not a decorative surface.
 *
 * ## Why a helper rather than three lines per route
 *
 * There are two dozen of these and they differ only in which key they name. The
 * three lines are the same three lines, and a route that got them subtly wrong
 * would still render: the wrongness shows up as a tab title in the wrong
 * language, which is invisible to whoever wrote it and obvious to whoever reads
 * it. One implementation is the only way that stays true as routes are added.
 *
 * ## Keys are properties, so the drift test can see them
 *
 * `catalogue-drift.test.ts` scans the source for two literal shapes: a direct
 * call on the translator, and a property whose name ends in `Key`. A key handed
 * to this function as a bare string argument matches neither, so it would be
 * invisible to that test and therefore invisible to whoever has to find it when
 * it breaks. Hence `titleKey` and `descriptionKey`, which is the same shape the
 * navigation table and the downtime copy already use, for the same reason.
 *
 * That scan reads comments too, so this paragraph describes the shapes rather
 * than spelling one out. An example here would be read as a key this file asks
 * for, and the test would fail on a message nobody meant to use.
 *
 * ## What this costs
 *
 * `resolveLocale` reads `headers()`, which opts a route into dynamic rendering.
 * Every route in this application already sits behind a root layout that reads
 * it for the same reason, so nothing that was prerendered stops being
 * prerendered.

 * This is a second copy of `apps/web`'s helper, for the reason its provider is:
 * what is duplicated is the three lines that build a translator, and the rule
 * with a security consequence - which language, from an attacker-writable
 * cookie - is shared in `@openrunic/i18n`.
 */
export interface PageCopy {
  readonly titleKey: string;
  /** Omitted where a route has no description. Never an empty string. */
  readonly descriptionKey?: string;
  /**
   * Values for a title that names something, which is only the chart and the
   * visit note: two tabs open on two patients must be impossible to confuse.
   * `format` refuses a value the message does not use, so the key and these are
   * chosen together at the call site or not at all.
   */
  readonly values?: Interpolations;
}

export async function pageMetadata(copy: PageCopy): Promise<Metadata> {
  const t = createTranslator(appCatalogue, await resolveLocale());
  const title = t(copy.titleKey, copy.values);
  // Built conditionally rather than with `description: undefined`, because Next
  // treats a present-but-undefined value as a deliberate override of the value
  // inherited from the root layout, and a route with no description of its own
  // should keep the application's.
  return copy.descriptionKey === undefined
    ? { title }
    : { title, description: t(copy.descriptionKey) };
}
