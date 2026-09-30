import { formatCount } from '@openrunic/i18n';
import type { Translator } from '@openrunic/i18n';

import { pluralKey } from '@/components/admin';

const EVENT_COUNT = {
  oneKey: 'admin.audit.summary.one',
  otherKey: 'admin.audit.summary.other',
};

const EVENT_COUNT_BREAKGLASS = {
  oneKey: 'admin.audit.summaryBreakglass.one',
  otherKey: 'admin.audit.summaryBreakglass.other',
};

/**
 * The line under the filter bar: "42 events, 3 breakglass".
 *
 * Breakglass is only named when there is some, so the ordinary case reads as
 * one plain count rather than a count plus a reassuring zero. Two whole
 * messages rather than one with a clause appended, because the clause is not
 * appendable in every language.
 *
 * Kept out of `AuditScreen.tsx` so that file exports components only.
 */
export function filterSummary(t: Translator, total: number, breakglassCount: number) {
  // The locale comes off the translator rather than beside it. This took both
  // because the local `Translate` type it used to be given had dropped the
  // locale, so the caller passed `t.locale` back in as a second argument.
  if (breakglassCount === 0) {
    return t(pluralKey(EVENT_COUNT, total, t.locale), { count: formatCount(total, t.locale) });
  }
  return t(pluralKey(EVENT_COUNT_BREAKGLASS, total, t.locale), {
    count: formatCount(total, t.locale),
    breakglass: formatCount(breakglassCount, t.locale),
  });
}
