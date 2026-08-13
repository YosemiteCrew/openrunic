'use client';

import { Badge } from '@openrunic/ui';
import type { BadgeTone } from '@openrunic/ui';
import type { ReactElement } from 'react';

import { slaState } from '@/lib/api';
import type { SlaState } from '@/lib/api';
import { formatDateTime, formatElapsed } from '@/lib/format';

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

export function slaLabel(dueAt: string, now: string): string {
  const state = slaState(dueAt, now);
  if (state === 'OVERDUE') return `Overdue by ${formatElapsed(dueAt, now)}`;
  if (state === 'DUE_SOON') return `Due in ${formatElapsed(now, dueAt)}`;
  return `Due ${formatDateTime(dueAt, 'dense')}`;
}

export function SlaBadge({ dueAt, now }: SlaBadgeProps): ReactElement {
  const state = slaState(dueAt, now);
  return (
    <Badge tone={TONE[state]} icon={ICON[state]}>
      {slaLabel(dueAt, now)}
    </Badge>
  );
}
