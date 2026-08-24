'use client';

import { Badge } from '@openrunic/ui';
import type { BadgeTone } from '@openrunic/ui';
import type { ReactElement } from 'react';

import type { ResultFlag } from '@/lib/api';
import { useTranslator } from '@/lib/i18n/messages';

import { RESULT_FLAG_LABELS } from './flag-labels';

/**
 * The triage flag, as a labelled chip.
 *
 * Olive is in range, danger red is out of range, and the word carries the
 * meaning on its own: a colourblind clinician reads this queue perfectly. The
 * two danger-tinted flags differ by word and icon, never by shade.
 */

const FLAG_TONE: Record<ResultFlag, BadgeTone> = {
  NORMAL: 'success',
  ABNORMAL: 'danger',
  CRITICAL: 'danger',
};

const FLAG_ICON: Record<ResultFlag, string> = {
  NORMAL: 'check',
  ABNORMAL: 'triangle-alert',
  CRITICAL: 'octagon-alert',
};

export interface ResultFlagBadgeProps {
  flag: ResultFlag;
}

export function ResultFlagBadge({ flag }: Readonly<ResultFlagBadgeProps>): ReactElement {
  const t = useTranslator();
  return (
    <Badge tone={FLAG_TONE[flag]} icon={FLAG_ICON[flag]}>
      {t(RESULT_FLAG_LABELS[flag].labelKey)}
    </Badge>
  );
}
