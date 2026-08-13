'use client';

import { Icon } from '@openrunic/ui';
import type { ReactElement } from 'react';

import { INBOX_STREAMS } from '@/lib/api';
import type { InboxItem, InboxStream } from '@/lib/api';

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

const STREAM_LABEL: Record<InboxStream, string> = {
  RESULTS: 'Results',
  MESSAGES: 'Messages',
  REFILLS: 'Refills',
  COSIGN: 'Cosign',
  TASKS: 'Tasks',
};

export const INBOX_STREAM_ICON: Record<InboxStream, string> = {
  RESULTS: 'flask-conical',
  MESSAGES: 'message-square',
  REFILLS: 'pill',
  COSIGN: 'pen-line',
  TASKS: 'square-check',
};

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
}: InboxStreamFilterProps): ReactElement {
  return (
    <div className="or-filters" role="group" aria-label="Filter by stream">
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
            <span>{STREAM_LABEL[stream]}</span>
            <span className="or-filter__count">{count}</span>
          </button>
        );
      })}
    </div>
  );
}

export { STREAM_LABEL as INBOX_STREAM_LABELS };
