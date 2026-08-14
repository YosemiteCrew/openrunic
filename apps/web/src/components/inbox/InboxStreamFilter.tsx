'use client';

import { Icon } from '@openrunic/ui';
import type { ReactElement } from 'react';

import { INBOX_STREAMS } from '@/lib/api';
import type { InboxItem, InboxStream } from '@/lib/api';

import { INBOX_STREAM_ICON, INBOX_STREAM_LABELS } from './streams';

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
  return (
    <fieldset className="or-filters" aria-label="Filter by stream">
      <button
        type="button"
        className="or-filter"
        aria-pressed={active === null}
        onClick={() => onChange(null)}
      >
        <Icon name="inbox" size={16} />
        <span>Everything</span>
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
            <span>{INBOX_STREAM_LABELS[stream]}</span>
            <span className="or-filter__count">{count}</span>
          </button>
        );
      })}
    </fieldset>
  );
}
