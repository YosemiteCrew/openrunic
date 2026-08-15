/**
 * THE LMS METHOD, WHICH IS ALL A GROWTH CHART IS.
 *
 * A growth reference is three numbers per age and sex: L, M and S. `M` is the
 * median, `S` the coefficient of variation, and `L` the Box-Cox power that
 * accounts for the skew - because weight is not normally distributed at any age,
 * and treating it as if it were puts a healthy child at the 2nd percentile.
 *
 * A measurement becomes a z-score:
 *
 *     z = ((value / M)^L - 1) / (L * S)      when L is not 0
 *     z = ln(value / M) / S                  when L is 0
 *
 * and a z-score becomes a percentile through the normal CDF. That is the whole
 * calculation, and it is worth writing out rather than reaching for a library,
 * because the failure mode of getting it subtly wrong is a number that looks
 * entirely plausible on a chart a paediatrician is about to act on.
 *
 * ## Why the z-score is the answer and the percentile is the courtesy
 *
 * Percentiles compress at the extremes: everything below about the 0.1st is
 * "<1st", and two very different children read the same. The z-score does not,
 * which is why the growth literature tracks it and why it is returned alongside
 * - a z of -3.4 and a z of -5.1 are the difference between concerning and
 * critical, and both are the 0th percentile.
 */

/** One row: the index value, then L, M and S. */
export type LmsRow = readonly [index: number, l: number, m: number, s: number];

export interface LmsTable {
  readonly measure: string;
  readonly unit: string;
  /** What the rows are indexed by: age in months, or length in centimetres. */
  readonly index: 'age' | 'length';
  /** Where the numbers came from. Carried so a result can cite it. */
  readonly source: string;
  readonly male: readonly LmsRow[];
  readonly female: readonly LmsRow[];
}

export type Sex = 'male' | 'female';

/** The L, M and S at an index, interpolated between the rows that bracket it. */
export interface Lms {
  readonly l: number;
  readonly m: number;
  readonly s: number;
}

/**
 * Looks up the parameters, interpolating linearly between rows.
 *
 * The tables are at half-month steps for infants and monthly beyond, and a child
 * is measured on the day they are measured. Snapping to the nearest row would
 * move a percentile by more than the measurement error the chart exists to see
 * through, so the parameters are interpolated - which is what the CDC's own
 * documentation instructs.
 *
 * Outside the table's range there is nothing to interpolate between and nothing
 * honest to extrapolate to: a reference says what it observed, and a chart asked
 * about a 21-year-old is a chart being asked the wrong question. It answers
 * undefined rather than the nearest edge.
 */
export function lmsAt(table: LmsTable, sex: Sex, index: number): Lms | undefined {
  const rows = sex === 'male' ? table.male : table.female;
  const first = rows[0];
  const last = rows[rows.length - 1];
  if (first === undefined || last === undefined) return undefined;
  if (index < first[0] || index > last[0]) return undefined;

  for (let position = 0; position < rows.length; position += 1) {
    const row = rows[position];
    if (row === undefined) continue;
    if (row[0] === index) return { l: row[1], m: row[2], s: row[3] };

    const next = rows[position + 1];
    if (next === undefined || row[0] > index || next[0] < index) continue;

    const span = next[0] - row[0];
    const weight = span === 0 ? 0 : (index - row[0]) / span;
    return {
      l: row[1] + (next[1] - row[1]) * weight,
      m: row[2] + (next[2] - row[2]) * weight,
      s: row[3] + (next[3] - row[3]) * weight,
    };
  }

  return undefined;
}

/** The z-score of a measurement against LMS parameters. */
export function zScore(value: number, { l, m, s }: Lms): number {
  if (value <= 0) {
    throw new Error('A measurement must be positive to have a z-score.');
  }
  // L of exactly zero is the lognormal case, and dividing by it is the bug this
  // branch exists to prevent. It occurs in the published tables.
  return l === 0 ? Math.log(value / m) / s : (Math.pow(value / m, l) - 1) / (l * s);
}

/** The measurement at a given z-score: the inverse, for drawing a curve. */
export function valueAtZ(z: number, { l, m, s }: Lms): number {
  return l === 0 ? m * Math.exp(s * z) : m * Math.pow(1 + l * s * z, 1 / l);
}

/**
 * The normal CDF, by Abramowitz and Stegun 7.1.26 on the error function.
 *
 * Accurate to about 1.5e-7, which is four orders of magnitude finer than the
 * tenth of a percentile anybody reads off a chart, and does not need a table.
 */
export function percentileOf(z: number): number {
  return 100 * normalCdf(z);
}

function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const absolute = Math.abs(x);

  const t = 1 / (1 + 0.3275911 * absolute);
  const series =
    t *
    (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));

  return sign * (1 - series * Math.exp(-absolute * absolute));
}
