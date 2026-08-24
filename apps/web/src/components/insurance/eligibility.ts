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

export interface EligibilityPresentation {
  /** Catalogue key for the word. Always rendered: status is never colour alone. */
  labelKey: string;
  tone: BadgeTone;
  /**
   * Catalogue key for what to do next, in one sentence, or null when there is
   * nothing to do.
   *
   * `null` rather than an empty string. An empty message renders as a blank
   * paragraph and looks like a sentence that failed to load, which is the same
   * failure the catalogue itself is written to avoid.
   */
  guidanceKey: string | null;
  /** True when the failure is a partner outage rather than a coverage problem. */
  degraded: boolean;
}

export function presentEligibility(outcome: EligibilityOutcome | null): EligibilityPresentation {
  switch (outcome) {
    case 'ACTIVE':
      return {
        labelKey: 'insurance.eligibility.active',
        tone: 'success',
        guidanceKey: null,
        degraded: false,
      };
    case 'INACTIVE':
      return {
        labelKey: 'insurance.eligibility.terminated',
        tone: 'danger',
        guidanceKey: 'insurance.eligibility.terminatedGuidance',
        degraded: false,
      };
    case 'NOT_FOUND':
      return {
        labelKey: 'insurance.eligibility.notFound',
        tone: 'danger',
        guidanceKey: 'insurance.eligibility.notFoundGuidance',
        degraded: false,
      };
    case 'UNAVAILABLE':
      return {
        labelKey: 'insurance.eligibility.unavailable',
        tone: 'neutral',
        guidanceKey: 'insurance.eligibility.unavailableGuidance',
        degraded: true,
      };
    default:
      return {
        labelKey: 'insurance.eligibility.notVerified',
        tone: 'neutral',
        guidanceKey: 'insurance.eligibility.notVerifiedGuidance',
        degraded: false,
      };
  }
}

/** Coverage slots, in the order claims are billed. */
export const PRIORITY_SEQUENCE: readonly CoveragePriority[] = ['PRIMARY', 'SECONDARY', 'TERTIARY'];

/** What a slot is called on screen, and what it says when a card moves into it. */
export interface PriorityCopy {
  /** Catalogue key for the card's overline: "Primary coverage". */
  readonly overlineKey: string;
  /** Catalogue key for the toast a reorder raises, taking the payer's name. */
  readonly movedKey: string;
}

/**
 * Both messages are whole phrases per slot rather than an ordinal dropped into
 * a frame. "Primary" is an adjective that agrees with its noun in most of the
 * languages this will be translated into, and a frame cannot know that.
 */
export const PRIORITY_COPY: Readonly<Record<CoveragePriority, PriorityCopy>> = {
  PRIMARY: {
    overlineKey: 'insurance.coverage.overlinePrimary',
    movedKey: 'insurance.priority.movedPrimary',
  },
  SECONDARY: {
    overlineKey: 'insurance.coverage.overlineSecondary',
    movedKey: 'insurance.priority.movedSecondary',
  },
  TERTIARY: {
    overlineKey: 'insurance.coverage.overlineTertiary',
    movedKey: 'insurance.priority.movedTertiary',
  },
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
