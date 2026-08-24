'use client';

import { Icon } from '@openrunic/ui';
import type { ReactElement } from 'react';

import { INBOX_STREAMS } from '@/lib/api';
import type { InboxItem, InboxStream } from '@/lib/api';
import { useTranslator } from '@/lib/i18n/messages';

import { INBOX_STREAM_ICON, INBOX_STREAM_LABEL_KEYS } from './streams';

/**
 * The five typed streams, as filter chips with counts.
 *
 * Typing the inbox is the whole idea: a result, a message, a refill, a cosign
 * and a task are different work with different actions, and one undifferentiated
 * list makes a person triage it twice. The counts come from the loaded rows, so
 * a chip never claims work that is not there.
 *
 * Proposed @openrunic/ui addition: a `SegmentedControl` or `FilterChip`. Tag is
 * metadata rather than a control, and Button in a row of eight reads as eight
 * actions; composed here from tokens instead.
 */

export interface InboxStreamFilterProps {
  items: InboxItem[];
  /** Null means every stream. */
  active: InboxStream | null;
  onChange: (stream: InboxStream | null) => void;
}

export function InboxStreamFilter({
  items,
  active,
  onChange,
}: Readonly<InboxStreamFilterProps>): ReactElement {
  const t = useTranslator();

  return (
    <fieldset className="or-filters" aria-label={t('inbox.filter.label')}>
      <button
        type="button"
        className="or-filter"
        aria-pressed={active === null}
        onClick={() => onChange(null)}
      >
        <Icon name="inbox" size={16} />
        <span>{t('inbox.filter.everything')}</span>
        <span className="or-filter__count">{items.length}</span>
      </button>

      {INBOX_STREAMS.map((stream) => {
        const count = items.filter((item) => item.stream === stream).length;
        return (
          <button
            key={stream}
            type="button"
            className="or-filter"
            aria-pressed={active === stream}
            onClick={() => onChange(stream)}
          >
            <Icon name={INBOX_STREAM_ICON[stream]} size={16} />
            <span>{t(INBOX_STREAM_LABEL_KEYS[stream])}</span>
            <span className="or-filter__count">{count}</span>
          </button>
        );
      })}
    </fieldset>
  );
}
