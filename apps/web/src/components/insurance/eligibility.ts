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
  /** Always rendered. Status is never colour alone. */
  label: string;
  tone: BadgeTone;
  /** What to do next, in one sentence. Empty when there is nothing to do. */
  guidance: string;
  /** True when the failure is a partner outage rather than a coverage problem. */
  degraded: boolean;
}

export function presentEligibility(outcome: EligibilityOutcome | null): EligibilityPresentation {
  switch (outcome) {
    case 'ACTIVE':
      return {
        label: 'Coverage active',
        tone: 'success',
        guidance: '',
        degraded: false,
      };
    case 'INACTIVE':
      return {
        label: 'Coverage terminated',
        tone: 'danger',
        guidance:
          'Ask the patient for a current insurance card, or record this visit as self-pay before check-in.',
        degraded: false,
      };
    case 'NOT_FOUND':
      return {
        label: 'Member not found',
        tone: 'danger',
        guidance:
          'Check the member id and date of birth against the card, correct them here, and verify again.',
        degraded: false,
      };
    case 'UNAVAILABLE':
      return {
        label: 'Payer did not answer',
        tone: 'neutral',
        guidance:
          'The eligibility service is unavailable. The check is queued; check-in can continue and this will answer when the service returns.',
        degraded: true,
      };
    default:
      return {
        label: 'Not verified',
        tone: 'neutral',
        guidance: 'Verify now to get today’s answer before the patient is roomed.',
        degraded: false,
      };
  }
}

/** Coverage slots, in the order claims are billed. */
export const PRIORITY_SEQUENCE: readonly CoveragePriority[] = ['PRIMARY', 'SECONDARY', 'TERTIARY'];

export const PRIORITY_LABEL: Record<CoveragePriority, string> = {
  PRIMARY: 'Primary',
  SECONDARY: 'Secondary',
  TERTIARY: 'Tertiary',
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
