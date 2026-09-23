'use client';

import { formatCount } from '@openrunic/i18n';
import type { Translator } from '@openrunic/i18n';
import { Button, Card, Input, Select, Tag } from '@openrunic/ui';
import { useState } from 'react';
import type { FormEvent, ReactElement } from 'react';

import { Alert } from '@/components/state';
import { CLINIC_TIME_ZONE, formatDate, formatTime } from '@/lib/format';
import { useTranslator } from '@/lib/i18n/messages';

import type { OpenSlot } from './schedule';
import type { ScheduleProvider } from './ScheduleGrid';
import { parseSlotRequest, slotRequestVocabulary } from './slot-request';
import type { SlotRequestQuestion } from './slot-request';

/**
 * Find available, as an answer rather than a search form.
 *
 * One click surfaces the next five real open slots across every provider
 * showing on the day. Each is a button, so booking a follow-up is a tab and an
 * Enter away, which is the fifteen-second path the brief asks for.
 *
 * Above the answer sits the request: a sentence, typed or dictated into the same
 * field, read into the constraint fields beneath it. The fields are what the
 * slots are computed from, and every one of them stays editable, so a word the
 * reader got wrong is corrected where it landed rather than by saying the whole
 * thing again. Nothing here books: a slot is still a button a person presses.
 */

/** What the slots are computed from. Held by the screen, so a day change keeps it. */
export interface SlotCriteria {
  /** Empty for every provider showing on the day. */
  providerId: string;
  /** Minutes past midnight, clinic time. */
  notBefore: number | null;
  notAfter: number | null;
  durationMinutes: number;
}

export interface SlotAsk {
  /** The sentence as it was typed or dictated. */
  text: string;
  criteria: SlotCriteria;
  questions: readonly SlotRequestQuestion[];
  /** The day the sentence named, when it was not the day on screen. */
  day: string | null;
}

export function initialAsk(durationMinutes: number): SlotAsk {
  return {
    text: '',
    criteria: { providerId: '', notBefore: null, notAfter: null, durationMinutes },
    questions: [],
    day: null,
  };
}

export interface FindAvailablePanelProps {
  slots: readonly OpenSlot[];
  providers: readonly ScheduleProvider[];
  ask: SlotAsk;
  onAskChange: (ask: SlotAsk) => void;
  /** The day on screen. */
  day: string;
  /** The clinic's today, which "today" and "tomorrow" are read against. */
  today: string;
  onDayChange: (day: string) => void;
  onBook: (slot: OpenSlot) => void;
  onClose: () => void;
}

/** The lengths offered in the field, plus whatever length was asked for. */
const DURATIONS = [10, 15, 20, 30, 45, 60, 90];

function durationOptions(current: number): number[] {
  return DURATIONS.includes(current)
    ? DURATIONS
    : [...DURATIONS, current].toSorted((a, b) => a - b);
}

function toClock(minutes: number | null): string {
  if (minutes === null) return '';
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function fromClock(value: string): number | null {
  const found = /^(\d{2}):(\d{2})$/.exec(value);
  return found ? Number(found[1]) * 60 + Number(found[2]) : null;
}

/** A clock value as the reader's locale writes it, for the question sentences. */
function spoken(t: Translator, day: string, minutes: number): string {
  return formatTime(t, `${day}T${toClock(minutes)}:00.000Z`);
}

export function FindAvailablePanel({
  slots,
  providers,
  ask,
  onAskChange,
  day,
  today,
  onDayChange,
  onBook,
  onClose,
}: Readonly<FindAvailablePanelProps>): ReactElement {
  const t = useTranslator();
  const [text, setText] = useState(ask.text);
  const { criteria } = ask;
  const providerName = (id: string): string =>
    providers.find((provider) => provider.id === id)?.name ?? t('schedule.provider.unassigned');

  const read = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = parseSlotRequest(text, today, providers, slotRequestVocabulary(t));
    onAskChange({
      text,
      criteria: {
        providerId: parsed.providerId ?? criteria.providerId,
        notBefore: parsed.notBefore === undefined ? criteria.notBefore : parsed.notBefore,
        notAfter: parsed.notAfter === undefined ? criteria.notAfter : parsed.notAfter,
        durationMinutes: parsed.durationMinutes ?? criteria.durationMinutes,
      },
      questions: parsed.questions,
      day: parsed.day !== null && parsed.day !== day ? parsed.day : null,
    });
  };

  /* An edit to a field answers the question asked about that field. */
  const edit = (change: Partial<SlotCriteria>) =>
    onAskChange({
      ...ask,
      criteria: { ...criteria, ...change },
      questions: ask.questions.filter((question) => !(question.field in change)),
    });

  const question = (entry: SlotRequestQuestion): string =>
    entry.kind === 'ambiguous'
      ? t('schedule.findAvailable.ask.providerAmbiguous', {
          names: entry.candidates.map(providerName).join(', '),
        })
      : t('schedule.findAvailable.ask.meridiem', {
          hour: formatCount(entry.hour, t.locale),
          time: spoken(
            t,
            day,
            (entry.field === 'notBefore' ? criteria.notBefore : criteria.notAfter) ?? 0
          ),
        });

  const minutes = formatCount(criteria.durationMinutes, t.locale);
  const zone = t('schedule.findAvailable.clinicTime', { zone: CLINIC_TIME_ZONE });

  return (
    <Card
      overline={t('schedule.findAvailable.overline')}
      title={t('schedule.findAvailable.title', { minutes })}
      footer={
        <Button variant="ghost" iconLeft="x" onClick={onClose}>
          {t('schedule.findAvailable.hide')}
        </Button>
      }
    >
      <div className="or-slot-request">
        <form className="or-slot-request__ask" onSubmit={read}>
          <Input
            label={t('schedule.findAvailable.ask.label')}
            hint={t('schedule.findAvailable.ask.hint')}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <Button type="submit" variant="secondary" iconLeft="text-search">
            {t('schedule.findAvailable.ask.read')}
          </Button>
        </form>

        <div className="or-fd-form-grid">
          <Select
            label={t('schedule.findAvailable.field.provider')}
            value={criteria.providerId}
            onChange={(event) => edit({ providerId: event.target.value })}
            options={[
              { value: '', label: t('schedule.findAvailable.field.anyProvider') },
              ...providers.map((provider) => ({ value: provider.id, label: provider.name })),
            ]}
          />
          <Select
            label={t('schedule.findAvailable.field.duration')}
            value={String(criteria.durationMinutes)}
            onChange={(event) => edit({ durationMinutes: Number(event.target.value) })}
            options={durationOptions(criteria.durationMinutes).map((value) => ({
              value: String(value),
              label: t('schedule.findAvailable.field.minutes', {
                minutes: formatCount(value, t.locale),
              }),
            }))}
          />
          <Input
            type="time"
            label={t('schedule.findAvailable.field.notBefore')}
            hint={zone}
            value={toClock(criteria.notBefore)}
            onChange={(event) => edit({ notBefore: fromClock(event.target.value) })}
          />
          <Input
            type="time"
            label={t('schedule.findAvailable.field.notAfter')}
            hint={zone}
            value={toClock(criteria.notAfter)}
            onChange={(event) => edit({ notAfter: fromClock(event.target.value) })}
          />
        </div>

        {ask.questions.map((entry) => (
          <Alert
            key={entry.field}
            tone="caution"
            title={t('schedule.findAvailable.ask.checkTitle')}
            message={question(entry)}
          />
        ))}

        {ask.day === null || ask.day === day ? (
          <SlotList slots={slots} minutes={minutes} providerName={providerName} onBook={onBook} />
        ) : (
          <div className="or-slot-request__day">
            <p className="or-body">
              {t('schedule.findAvailable.ask.otherDay', {
                asked: formatDate(t, ask.day),
                shown: formatDate(t, day),
              })}
            </p>
            <Button iconLeft="calendar" onClick={() => onDayChange(ask.day!)}>
              {t('schedule.findAvailable.ask.showDay', { date: formatDate(t, ask.day) })}
            </Button>
            <Button variant="ghost" onClick={() => onAskChange({ ...ask, day: null })}>
              {t('schedule.findAvailable.ask.keepDay', { date: formatDate(t, day) })}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

function SlotList({
  slots,
  minutes,
  providerName,
  onBook,
}: Readonly<{
  slots: readonly OpenSlot[];
  minutes: string;
  providerName: (id: string) => string;
  onBook: (slot: OpenSlot) => void;
}>): ReactElement {
  const t = useTranslator();
  if (slots.length === 0) {
    return <p className="or-body">{t('schedule.findAvailable.none', { minutes })}</p>;
  }
  return (
    <ul className="or-slots">
      {slots.map((slot) => (
        <li key={`${slot.providerId}-${slot.start}`} className="or-slots__item">
          <Button
            variant="secondary"
            iconLeft="calendar-plus"
            onClick={() => onBook(slot)}
            aria-label={t('schedule.findAvailable.book', {
              time: formatTime(t, slot.start),
              provider: providerName(slot.providerId),
            })}
          >
            <span className="or-mono">{formatTime(t, slot.start)}</span>
          </Button>
          <Tag>{providerName(slot.providerId)}</Tag>
        </li>
      ))}
    </ul>
  );
}
