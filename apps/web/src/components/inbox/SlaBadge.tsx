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
 * An inbox item without an SLA is an item nobody owns, so every row carries
 * one. Overdue is danger red and says by how much; the calm states say when it
 * is due. Nothing blinks and nothing counts seconds.
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
  /** ISO instant. */
  dueAt: string;
  /** ISO instant treated as now. */
  now: string;
}

export function SlaBadge({ dueAt, now }: Readonly<SlaBadgeProps>): ReactElement {
  const t = useTranslator();
  const state = slaState(dueAt, now);
  return (
    <Badge tone={TONE[state]} icon={ICON[state]}>
      {slaLabel(t, dueAt, now)}
    </Badge>
  );
}
