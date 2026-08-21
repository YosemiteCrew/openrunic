import type { MeasureReport } from '@openrunic/quality';

/**
 * SCORING A QUALITY MEASURE INTO MIPS POINTS.
 *
 * A measure's performance rate becomes points by where it falls against a
 * benchmark: a table of decile boundaries CMS publishes per measure, per
 * collection type, per year. Rate in, points out.
 *
 * ## Benchmarks are supplied, not shipped
 *
 * They change every year and they are specific to a collection type. A build
 * that carried last year's benchmarks would score this year's care against them
 * and produce a number that looks exactly like a real one. So a benchmark is
 * data the deployment supplies, and a measure with no benchmark scores as
 * unbenchmarked rather than as zero.
 *
 * That distinction is the whole point of this module. Zero points is a practice
 * that performed badly. No benchmark is a practice nobody has scored, and
 * reporting the second as the first is a number somebody would act on.
 */

/**
 * Decile boundaries for one measure, lowest first.
 *
 * Nine numbers describe ten deciles. CMS publishes them as the lower bound of
 * deciles 2 through 10, and that is what this holds.
 */
export interface Benchmark {
  readonly measureId: string;
  /** The performance year these boundaries are for. */
  readonly year: number;
  /**
   * Lower bounds of deciles 2..10, as rates between 0 and 1, ascending.
   *
   * Ascending for a measure where higher is better, and DESCENDING for an
   * inverse one, because CMS publishes them in the direction of improving
   * performance rather than of increasing value. `benchmarkProblems` checks the
   * direction against the measure rather than assuming it.
   */
  readonly deciles: readonly number[];
}

export type QualityScore =
  | {
      readonly measureId: string;
      readonly scored: true;
      /** 3 to 10. The floor is 3 for a measure that was reported at all. */
      readonly points: number;
      /** Which decile the rate fell in, 1 to 10. */
      readonly decile: number;
    }
  | {
      readonly measureId: string;
      readonly scored: false;
      readonly reason: 'no-benchmark' | 'no-rate' | 'below-case-minimum';
    };

/**
 * The smallest denominator CMS will score a measure on.
 *
 * Below it a rate is noise: one patient in a denominator of three moves the
 * number by 33 points. Reported as unscored rather than scored badly.
 */
export const CASE_MINIMUM = 20;

/** The points a reported measure cannot go below, once it is scored at all. */
const FLOOR_POINTS = 3;

/**
 * Checks a benchmark before it is used, and returns what is wrong with it.
 *
 * Returned rather than thrown, so a settings screen can list every problem in
 * one pass. A validator that throws is served as a bare 500, which is the
 * validator failing in the way it exists to prevent.
 */
export function benchmarkProblems(benchmark: Benchmark, higherIsBetter: boolean): string[] {
  const problems: string[] = [];

  if (benchmark.deciles.length !== 9) {
    problems.push('A benchmark needs exactly nine decile boundaries, for deciles 2 through 10.');
  }
  if (benchmark.deciles.some((value) => value < 0 || value > 1)) {
    problems.push('Every decile boundary is a rate between 0 and 1.');
  }

  // Direction is checked rather than assumed. A benchmark loaded in the wrong
  // order scores every practice backwards: the best performers get three points
  // and the worst get ten, and nothing about the output looks wrong.
  const ordered = benchmark.deciles.every((value, index) => {
    // Reading the previous entry and checking for undefined rather than
    // guarding on `index === 0` and defaulting: the default arms were
    // unreachable, and unreachable code that looks like a safety net is worse
    // than none. At index 0 there is no previous, which is the case this
    // returns true for.
    const previous = benchmark.deciles[index - 1];
    if (previous === undefined) return true;
    return higherIsBetter ? value >= previous : value <= previous;
  });
  if (!ordered) {
    problems.push(
      higherIsBetter
        ? 'Decile boundaries must ascend for a measure where a higher rate is better.'
        : 'Decile boundaries must descend for an inverse measure, where a lower rate is better.'
    );
  }

  return problems;
}

/**
 * Which decile a rate falls in, 1 to 10.
 *
 * The boundaries are lower bounds of deciles 2 through 10, so a rate at or
 * above the first boundary is at least decile 2. For an inverse measure the
 * comparison flips, because a lower rate is the better one.
 */
function decileOf(rate: number, benchmark: Benchmark, higherIsBetter: boolean): number {
  let decile = 1;
  for (const boundary of benchmark.deciles) {
    if (higherIsBetter ? rate >= boundary : rate <= boundary) decile += 1;
  }
  return decile;
}

/**
 * Scores one measure report.
 *
 * Every unscored answer names why, because "no points" has three completely
 * different causes and a practice acts on each of them differently: obtain a
 * benchmark, see more patients, or start recording the measure at all.
 */
export function scoreQualityMeasure(
  report: MeasureReport,
  benchmark: Benchmark | undefined
): QualityScore {
  const measureId = report.measureId;

  if (report.performanceRate === null) {
    return { measureId, scored: false, reason: 'no-rate' };
  }

  const eligible = report.denominator - report.denominatorExclusion - report.denominatorException;
  if (eligible < CASE_MINIMUM) {
    return { measureId, scored: false, reason: 'below-case-minimum' };
  }

  if (benchmark === undefined) {
    // Not zero points. Zero is a practice that performed badly; this is a
    // practice nobody has scored, and reporting the second as the first is a
    // number somebody would act on.
    return { measureId, scored: false, reason: 'no-benchmark' };
  }

  const decile = decileOf(report.performanceRate, benchmark, report.higherIsBetter);
  return { measureId, scored: true, decile, points: Math.max(FLOOR_POINTS, decile) };
}
