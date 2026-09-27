'use client';

import { useMemo, useState } from 'react';

import type { Appointment } from '@/lib/api';

import { findOpenSlots } from './schedule';
import type { OpenSlot } from './schedule';
import type { ScheduleProvider } from './ScheduleGrid';
import type { SlotRequestQuestion } from './slot-request';

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

/**
 * The Find available request and its answer. Held by the screen rather than the
 * panel, which unmounts while a new day loads: "tomorrow with Okafor" has to
 * survive the page to the tomorrow it asked for. The answer comes from the same
 * engine and the same rows as the walk-in.
 */
export function useSlotAsk(
  appointments: readonly Appointment[],
  columns: readonly ScheduleProvider[],
  day: string,
  now: Date,
  durationMinutes: number
): [SlotAsk, (ask: SlotAsk) => void, OpenSlot[]] {
  const [ask, setAsk] = useState<SlotAsk>(() => initialAsk(durationMinutes));
  const slots = useMemo(() => {
    const { providerId: asked, notBefore, notAfter, durationMinutes: length } = ask.criteria;
    const ids = columns.flatMap((provider) =>
      !asked || provider.id === asked ? [provider.id] : []
    );
    return findOpenSlots(appointments, ids, day, now, {
      durationMinutes: length,
      notBefore,
      notAfter,
    });
  }, [appointments, ask.criteria, columns, day, now]);
  return [ask, setAsk, slots];
}
