import type { ResultFlag } from '@/lib/api';

/**
 * What a flag means, spelled out.
 *
 * The badge shows it and the triage list reads it into row labels, so it is
 * stated once: a result described two ways is a result somebody misreads.
 */
export const RESULT_FLAG_LABELS: Record<ResultFlag, string> = {
  NORMAL: 'In range',
  ABNORMAL: 'Above or below range',
  CRITICAL: 'Critical value',
};
