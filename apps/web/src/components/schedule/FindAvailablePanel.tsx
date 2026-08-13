'use client';

import { Button, Card, Tag } from '@openrunic/ui';
import type { ReactElement } from 'react';

import { formatTime } from '@/lib/format';

import type { OpenSlot } from './schedule';
import type { ScheduleProvider } from './ScheduleGrid';

/**
 * Find available, as an answer rather than a search form.
 *
 * One click surfaces the next five real open slots across every provider
 * showing on the day. Each is a button, so booking a follow-up is a tab and an
 * Enter away, which is the fifteen-second path the brief asks for.
 */

export interface FindAvailablePanelProps {
  slots: readonly OpenSlot[];
  providers: readonly ScheduleProvider[];
  /** Minutes the slots were sized for, so the panel can say what it searched. */
  durationMinutes: number;
  onBook: (slot: OpenSlot) => void;
  onClose: () => void;
}

export function FindAvailablePanel({
  slots,
  providers,
  durationMinutes,
  onBook,
  onClose,
}: FindAvailablePanelProps): ReactElement {
  const providerName = (id: string): string =>
    providers.find((provider) => provider.id === id)?.name ?? 'Unassigned';

  return (
    <Card
      overline="Find available"
      title={`Next open ${durationMinutes}-minute slots`}
      footer={
        <Button variant="ghost" iconLeft="x" onClick={onClose}>
          Hide open slots
        </Button>
      }
    >
      {slots.length === 0 ? (
        <p className="or-body">
          No slot fits {durationMinutes} minutes on this day. Add the patient to the waitlist, or
          look at tomorrow with the day pager.
        </p>
      ) : (
        <ul className="or-slots">
          {slots.map((slot) => (
            <li key={`${slot.providerId}-${slot.start}`} className="or-slots__item">
              <Button
                variant="secondary"
                iconLeft="calendar-plus"
                onClick={() => onBook(slot)}
                aria-label={`Book ${formatTime(slot.start)} with ${providerName(slot.providerId)}`}
              >
                <span className="or-mono">{formatTime(slot.start)}</span>
              </Button>
              <Tag>{providerName(slot.providerId)}</Tag>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
