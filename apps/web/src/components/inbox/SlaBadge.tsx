'use client';

import { Badge } from '@openrunic/ui';
import type { BadgeTone } from '@openrunic/ui';
import type { ReactElement } from 'react';

import { slaState } from '@/lib/api';
import type { SlaState } from '@/lib/api';
import { useTranslator } from '@/lib/i18n/messages';

import { slaLabel } from './sla';

/**
 * How long this item has, in words.
 *
 * Overdue is danger red and says by how much; the calm states say when it is
 * due. Nothing blinks and nothing counts seconds.
 *
 * A row with no due date renders no badge. The fixtures give every item one,
 * and this used to say that every row therefore carries a chip - but `dueAt` is
 * nullable on a task, and a green "on time" over a promise nobody made is the
 * one reading worse than an absent chip.
 */

const TONE: Record<SlaState, BadgeTone> = {
  ON_TIME: 'success',
  DUE_SOON: 'neutral',
  OVERDUE: 'danger',
};

const ICON: Record<SlaState, string> = {
  ON_TIME: 'clock',
  DUE_SOON: 'clock-alert',
  OVERDUE: 'triangle-alert',
};

export interface SlaBadgeProps {
  /** ISO instant, or null where nothing was promised. */
  dueAt: string | null;
  /** ISO instant treated as now. */
  now: string;
}

export function SlaBadge({ dueAt, now }: Readonly<SlaBadgeProps>): ReactElement | null {
  const t = useTranslator();
  if (dueAt === null) return null;
  const state = slaState(dueAt, now);
  return (
    <Badge tone={TONE[state]} icon={ICON[state]}>
      {slaLabel(t, dueAt, now)}
    </Badge>
  );
}
