import type { QualityScore } from './quality-score.js';

/**
 * THE FINAL SCORE, AND THE PART OF IT THIS SOFTWARE CANNOT KNOW.
 *
 * MIPS has four categories. An EMR can compute three of them and cannot compute
 * the fourth, and that is not a limitation to work around: **Cost is calculated
 * by CMS from submitted claims across every setting a patient was seen in**,
 * including hospitals and specialists this practice has no record of. No EMR has
 * the data. One that produced a Cost score would be inventing it.
 *
 * So a composite from this module reports the weight it covered and the weight
 * it did not, and it never renormalises the three categories to 100. A number
 * presented as a final score that silently omits thirty per cent of the weight
 * is the kind of wrong that gets acted on, because it looks exactly like the
 * real thing and it is the number a practice plans around.
 */

/** The four categories, and what each is worth. */
export type CategoryId =
  'quality' | 'promoting-interoperability' | 'improvement-activities' | 'cost';

/**
 * Statutory weights, as percentages of the final score.
 *
 * These are set by CMS and move between performance years, so they are supplied
 * rather than fixed here for the same reason benchmarks are. The default below
 * is named with the year it describes.
 */
export interface CategoryWeights {
  readonly year: number;
  readonly weights: Readonly<Record<CategoryId, number>>;
}

/** One category this software computed. */
export interface CategoryResult {
  readonly category: Exclude<CategoryId, 'cost'>;
  /** 0 to 1, the proportion of the category's available points earned. */
  readonly achieved: number;
}

export interface CompositeScore {
  readonly year: number;
  /**
   * Points out of 100, counting ONLY the categories this software computed.
   *
   * Deliberately not renormalised. See `coveredWeight`.
   */
  readonly points: number;
  /** The share of the statutory weight the score above is drawn from. */
  readonly coveredWeight: number;
  /**
   * The categories that were not computed, and why.
   *
   * Always contains Cost. It is here rather than absent because a caller
   * rendering this must be able to say so, and an empty list would let a screen
   * present `points` as a final score.
   */
  readonly notComputed: readonly { readonly category: CategoryId; readonly reason: string }[];
}

const COST_REASON =
  'CMS calculates Cost from claims across every setting the patient was seen in, including care this practice has no record of. No EMR holds that data.';

/**
 * Combines the categories this software computed.
 *
 * A category that was computed but earned nothing still counts towards
 * `coveredWeight`: a practice that scored zero on Promoting Interoperability
 * has been measured on it, and leaving it out would raise the apparent
 * completeness of a worse score.
 */
export function compositeScore(
  results: readonly CategoryResult[],
  weights: CategoryWeights
): CompositeScore {
  let points = 0;
  let coveredWeight = 0;
  const computed = new Set(results.map((result) => result.category));

  for (const result of results) {
    const weight = weights.weights[result.category];
    points += result.achieved * weight;
    coveredWeight += weight;
  }

  const notComputed: { category: CategoryId; reason: string }[] = [
    { category: 'cost', reason: COST_REASON },
  ];
  for (const category of [
    'quality',
    'promoting-interoperability',
    'improvement-activities',
  ] as const) {
    if (!computed.has(category)) {
      notComputed.push({
        category,
        reason: 'Not reported for this performance year.',
      });
    }
  }

  return {
    year: weights.year,
    points: Math.round(points * 10) / 10,
    coveredWeight,
    notComputed,
  };
}

/**
 * The quality category's contribution, from the measures that could be scored.
 *
 * Unscored measures are excluded from the denominator rather than counted as
 * zero, for the reason in `quality-score.ts`: a measure with no benchmark is
 * one nobody has scored, and treating it as a failure would report a practice
 * as performing badly at something it was never measured on.
 *
 * Returns null when nothing could be scored, rather than zero. Zero says the
 * practice scored nothing; null says there is nothing to say.
 */
export function qualityCategory(scores: readonly QualityScore[]): CategoryResult | null {
  const scored = scores.filter(
    (score): score is Extract<QualityScore, { scored: true }> => score.scored
  );
  if (scored.length === 0) return null;

  const earned = scored.reduce((total, score) => total + score.points, 0);
  return { category: 'quality', achieved: earned / (scored.length * 10) };
}
