'use client';

import { Button, Card, Tag } from '@openrunic/ui';
import type { ReactElement } from 'react';

import { formatTime } from '@/lib/format';
import { useTranslator } from '@/lib/i18n/messages';

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
}: Readonly<FindAvailablePanelProps>): ReactElement {
  const t = useTranslator();
  const providerName = (id: string): string =>
    providers.find((provider) => provider.id === id)?.name ?? t('schedule.provider.unassigned');

  return (
    <Card
      overline={t('schedule.findAvailable.overline')}
      title={t('schedule.findAvailable.title', { minutes: durationMinutes })}
      footer={
        <Button variant="ghost" iconLeft="x" onClick={onClose}>
          {t('schedule.findAvailable.hide')}
        </Button>
      }
    >
      {slots.length === 0 ? (
        <p className="or-body">{t('schedule.findAvailable.none', { minutes: durationMinutes })}</p>
      ) : (
        <ul className="or-slots">
          {slots.map((slot) => (
            <li key={`${slot.providerId}-${slot.start}`} className="or-slots__item">
              <Button
                variant="secondary"
                iconLeft="calendar-plus"
                onClick={() => onBook(slot)}
                aria-label={t('schedule.findAvailable.book', {
                  time: formatTime(slot.start),
                  provider: providerName(slot.providerId),
                })}
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
