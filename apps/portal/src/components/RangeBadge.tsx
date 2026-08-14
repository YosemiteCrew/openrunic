'use client';

/**
 * The range verdict on a measured value, as a labelled badge.
 *
 * Olive for in range, red for out of range, hazelnut when no range was recorded - and the
 * words always alongside, because the colour is never the signal on its own.
 */

import { Badge } from '@openrunic/ui';
import type { BadgeTone } from '@openrunic/ui';
import type { RangeState } from '@/lib/api/types';

const TONE: Record<RangeState, BadgeTone> = {
  'in-range': 'success',
  'out-of-range': 'danger',
  unknown: 'neutral',
};

export interface RangeBadgeProps {
  range: RangeState;
  /** The verdict in words, e.g. 'Above the usual range'. */
  label: string;
}

export function RangeBadge({ range, label }: Readonly<RangeBadgeProps>) {
  return <Badge tone={TONE[range]}>{label}</Badge>;
}
