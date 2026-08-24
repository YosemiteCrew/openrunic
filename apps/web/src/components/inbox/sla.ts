import type { Translator } from '@openrunic/i18n';

import { slaState } from '@/lib/api';
import type { SlaState } from '@/lib/api';
import { formatDateTime, formatElapsed } from '@/lib/format';

/**
 * How long an item has, in words.
 *
 * Two sets of messages, because the phrase is used in two positions: as the
 * badge on its own row, and inside the rail's summary of the queue ("The oldest
 * is overdue by three hours"). The second is a message of its own rather than
 * the first lower-cased at the call site, because casing is a per-language rule
 * code cannot make - German capitalises its nouns wherever they stand, and
 * Turkish has two i rules that turn a correct word into a wrong one.
 */
const HEADING_KEY: Record<SlaState, { labelKey: string }> = {
  OVERDUE: { labelKey: 'inbox.sla.overdue' },
  DUE_SOON: { labelKey: 'inbox.sla.dueSoon' },
  ON_TIME: { labelKey: 'inbox.sla.onTime' },
};

const INLINE_KEY: Record<SlaState, { labelKey: string }> = {
  OVERDUE: { labelKey: 'inbox.sla.inline.overdue' },
  DUE_SOON: { labelKey: 'inbox.sla.inline.dueSoon' },
  ON_TIME: { labelKey: 'inbox.sla.inline.onTime' },
};

/**
 * The SLA sentence, without the badge around it. Screens read it into row
 * labels.
 *
 * The translator is a parameter rather than a hook, because the badge is a
 * component and the rail's summary is not.
 */
export function slaLabel(
  t: Translator,
  dueAt: string,
  now: string,
  form: 'heading' | 'inline' = 'heading'
): string {
  const state = slaState(dueAt, now);
  const key = (form === 'inline' ? INLINE_KEY : HEADING_KEY)[state].labelKey;
  if (state === 'OVERDUE') return t(key, { elapsed: formatElapsed(dueAt, now) });
  if (state === 'DUE_SOON') return t(key, { elapsed: formatElapsed(now, dueAt) });
  return t(key, { when: formatDateTime(dueAt, 'dense') });
}
