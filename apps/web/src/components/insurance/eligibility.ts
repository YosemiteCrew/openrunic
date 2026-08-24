import type { BadgeTone } from '@openrunic/ui';

import type { CoveragePriority, EligibilityOutcome } from '@/lib/api';

/**
 * How an eligibility answer reads on screen.
 *
 * The important line here is the one that separates a payer outage from a real
 * negative answer. "The payer did not respond" and "the payer says this plan
 * ended" look similar in a log and mean completely different things at a front
 * desk: one means try again later and check the patient in, the other means
 * take a new card off the patient standing in front of you.
 */

/**
 * The words are carried as catalogue keys rather than as the words themselves,
 * because this is a pure function that runs before anything has rendered and
 * the reader's language is not known here. `catalogue-drift.test.ts` reads
 * `somethingKey:` out of the source, so an outcome pointing at a key nobody
 * defined fails the build rather than putting the key in a badge beside a
 * coverage.
 *
 * These are labels this codebase wrote for an adapter answer this codebase
 * defines. The payer's own sentence arrives on the result as `detail` and is
 * never given a second name here.
 */
export interface EligibilityPresentation {
  /** Always rendered. Status is never colour alone. */
  labelKey: string;
  tone: BadgeTone;
  /**
   * What to do next, in one sentence. Null when there is nothing to do, which
   * is a different statement from an empty message: a catalogue key must
   * always resolve to words, so "nothing to say" is the absence of a key.
   */
  guidanceKey: string | null;
  /** True when the failure is a partner outage rather than a coverage problem. */
  degraded: boolean;
}

export function presentEligibility(outcome: EligibilityOutcome | null): EligibilityPresentation {
  switch (outcome) {
    case 'ACTIVE':
      return {
        labelKey: 'insurance.eligibility.active.label',
        tone: 'success',
        guidanceKey: null,
        degraded: false,
      };
    case 'INACTIVE':
      return {
        labelKey: 'insurance.eligibility.inactive.label',
        tone: 'danger',
        guidanceKey: 'insurance.eligibility.inactive.guidance',
        degraded: false,
      };
    case 'NOT_FOUND':
      return {
        labelKey: 'insurance.eligibility.notFound.label',
        tone: 'danger',
        guidanceKey: 'insurance.eligibility.notFound.guidance',
        degraded: false,
      };
    case 'UNAVAILABLE':
      return {
        labelKey: 'insurance.eligibility.unavailable.label',
        tone: 'neutral',
        guidanceKey: 'insurance.eligibility.unavailable.guidance',
        degraded: true,
      };
    default:
      return {
        labelKey: 'insurance.eligibility.unverified.label',
        tone: 'neutral',
        guidanceKey: 'insurance.eligibility.unverified.guidance',
        degraded: false,
      };
  }
}

/** Coverage slots, in the order claims are billed. */
export const PRIORITY_SEQUENCE: readonly CoveragePriority[] = ['PRIMARY', 'SECONDARY', 'TERTIARY'];

/** What this application calls its own billing slots, as catalogue keys. */
export const PRIORITY_LABEL: Record<CoveragePriority, { labelKey: string }> = {
  PRIMARY: { labelKey: 'insurance.priority.primary' },
  SECONDARY: { labelKey: 'insurance.priority.secondary' },
  TERTIARY: { labelKey: 'insurance.priority.tertiary' },
};

/**
 * Priority follows position, so reordering the cards is the whole edit. Slots
 * past tertiary keep the last label rather than inventing one.
 */
export function priorityForIndex(index: number): CoveragePriority {
  return PRIORITY_SEQUENCE[Math.min(Math.max(index, 0), PRIORITY_SEQUENCE.length - 1)] ?? 'PRIMARY';
}

/** Moves an item within a list, returning a new list. Out-of-range moves are no-ops. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  if (from < 0 || from >= next.length || to < 0 || to >= next.length) return next;
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}
