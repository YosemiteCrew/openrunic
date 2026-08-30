import type { ResultFlag } from '@/lib/api';

/**
 * What a flag means, spelled out.
 *
 * The badge shows it and the triage list reads it into row labels, so it is
 * stated once: a result described two ways is a result somebody misreads.
 *
 * Carried as a `labelKey` rather than as the words, because the reader's
 * language is not known at module scope, and because `catalogue-drift.test.ts`
 * reads `somethingKey:` out of the source - so a flag pointing at a key nobody
 * defined fails the build rather than rendering the key beside a critical
 * value.
 *
 * The flag is this application's own triage vocabulary, not a coded value from
 * the laboratory. The panel name, the analyte labels and their codes are, and
 * none of them appear here.
 */
export const RESULT_FLAG_LABELS: Record<ResultFlag, { labelKey: string }> = {
  NORMAL: { labelKey: 'results.flag.normal' },
  ABNORMAL: { labelKey: 'results.flag.abnormal' },
  CRITICAL: { labelKey: 'results.flag.critical' },
};
