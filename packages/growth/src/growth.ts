import { lmsAt, percentileOf, valueAtZ, zScore, type Lms, type LmsTable, type Sex } from './lms.js';
import { REFERENCE_TABLES } from './reference/index.js';

/**
 * GROWTH PERCENTILES.
 *
 * A number on its own says nothing about a child. Ten kilograms is a thriving
 * one-year-old and a four-year-old in trouble, and the only way to tell is
 * against a reference - which is why a paediatric chart without percentiles is a
 * list of measurements nobody can act on.
 *
 * ## Which charts these are, and which they are not
 *
 * These are the CDC 2000 growth charts, embedded from the CDC's own published
 * LMS parameters - see `scripts/fetch-reference.mjs`, which downloads them,
 * recomputes every percentile the CDC publishes beside them, and refuses to
 * write a table that does not reproduce them.
 *
 * The CDC itself recommends the WHO standards below 24 months, because they
 * describe how breastfed children in optimal conditions DO grow rather than how
 * a mixed American sample DID. This package uses the CDC birth-to-36-month
 * charts there instead, and says so on every result, because a percentile whose
 * reference is unstated is one a clinician cannot weigh. Adding the WHO tables
 * is the same shape of work as this file: a second set of LMS parameters and a
 * selection rule.
 *
 * ## The 24-month overlap, and why the measure name settles most of it
 *
 * The infant charts run to 36 months and the child charts start at 24, so there
 * is a year where both exist - and they disagree, by design. The infant charts
 * use recumbent length and the child charts standing height, and a child
 * measures about a centimetre shorter standing up.
 *
 * For four of the six measures the caller has already answered which chart they
 * want by naming what they measured. `length-for-age` is taken lying down and is
 * the infant chart wherever it is asked, up to 36 months. `stature-for-age` is
 * taken standing and is the child chart, from 24. Head circumference is charted
 * to 36 months and not past it; BMI is not used below 24.
 *
 * `weight-for-age` is the one the name does not settle, because a weight is a
 * weight either way. There the rule is the CDC's - infant below 24 months, child
 * from 24 - and the result names the table it used rather than leaving it to be
 * inferred.
 */

export type Measure =
  | 'weight-for-age'
  | 'length-for-age'
  | 'stature-for-age'
  | 'head-circumference-for-age'
  | 'bmi-for-age'
  | 'weight-for-length';

export interface GrowthQuery {
  readonly measure: Measure;
  readonly sex: Sex;
  /** The measurement: kilograms, centimetres, or kg/m² for BMI. */
  readonly value: number;
  /** Required for every measure except weight-for-length. */
  readonly ageMonths?: number;
  /** Required for weight-for-length, which is not a function of age. */
  readonly lengthCm?: number;
}

export interface GrowthResult {
  readonly measure: Measure;
  readonly z: number;
  /** 0-100. Rounded to a tenth, which is finer than anybody reads off a chart. */
  readonly percentile: number;
  /** The reference median at this age or length, for "expected versus actual". */
  readonly median: number;
  readonly unit: string;
  /** The table this came from, named so a result can be argued with. */
  readonly reference: string;
  readonly source: string;
}

/** Why a query could not be answered. Never a silently wrong number. */
export type GrowthRefusal =
  | { readonly reason: 'out-of-range'; readonly detail: string }
  | { readonly reason: 'missing-index'; readonly detail: string }
  | { readonly reason: 'not-measurable'; readonly detail: string };

/** The month from which the child charts describe a measurement. */
export const CHILD_CHART_FROM_MONTHS = 24;

/** The last month the birth-to-36-month charts describe. */
export const INFANT_CHART_TO_MONTHS = 36;

/**
 * The oldest age any of these charts describes, read off the tables rather than
 * written down beside them.
 *
 * The CDC's child charts run to 240.5 months, not 240, because the rows are the
 * midpoints of month-long bins. A constant typed from memory would have been
 * 240 and would have refused the last row of every chart - which is exactly the
 * kind of off-by-a-half that looks like a rounding decision and is a missing
 * eighteen-year-old.
 */
export const OLDEST_MONTHS = Math.max(
  ...Object.values(REFERENCE_TABLES)
    .filter((table) => table.index === 'age')
    .map((table) => table.male[table.male.length - 1]?.[0] ?? 0)
);

interface TableChoice {
  readonly table: LmsTable;
  readonly index: number;
}

/**
 * Picks the table and the value to look it up by.
 *
 * Returns a refusal rather than a fallback for every question the charts cannot
 * answer. A percentile computed off the end of a reference is not a cautious
 * estimate; it is a number with nothing behind it, printed beside numbers that
 * have.
 */
function choose(query: GrowthQuery): TableChoice | GrowthRefusal {
  if (query.measure === 'weight-for-length') {
    if (query.lengthCm === undefined) {
      return {
        reason: 'missing-index',
        detail: 'weight-for-length needs a length in centimetres.',
      };
    }
    return { table: REFERENCE_TABLES.weightForLengthInfant as LmsTable, index: query.lengthCm };
  }

  const age = query.ageMonths;
  if (age === undefined) {
    return { reason: 'missing-index', detail: `${query.measure} needs an age in months.` };
  }
  if (age < 0) {
    return { reason: 'out-of-range', detail: `An age in months cannot be ${String(age)}.` };
  }

  const table = tableFor(query.measure, age);
  if (table === undefined) {
    return { reason: 'not-measurable', detail: whyNotCharted(query.measure, age) };
  }

  return { table, index: age };
}

/** Says which chart the measure belongs to and why this age is not on it. */
function whyNotCharted(measure: Measure, age: number): string {
  if (measure === 'length-for-age') {
    return `Length is measured lying down and is charted to ${String(INFANT_CHART_TO_MONTHS)} months; at ${String(age)} months the standing measurement, stature-for-age, is the one to ask for.`;
  }
  if (measure === 'stature-for-age') {
    return `Stature is measured standing and is charted from ${String(CHILD_CHART_FROM_MONTHS)} months; at ${String(age)} months the recumbent measurement, length-for-age, is the one to ask for.`;
  }
  if (measure === 'head-circumference-for-age') {
    return `Head circumference is charted to ${String(INFANT_CHART_TO_MONTHS)} months and not routinely past it; this query asked about ${String(age)} months.`;
  }
  return `BMI is charted from ${String(CHILD_CHART_FROM_MONTHS)} months; below that, weight-for-length is the measure that answers the same question.`;
}

/**
 * The table for a measure at an age, or undefined when the two do not go
 * together.
 *
 * Three of the six change name across the overlap, and that is not a naming
 * accident: they are different measurements, taken differently. Returning
 * undefined is how they say so, and {@link whyNotCharted} is how the caller
 * finds out which one to ask for instead.
 */
function tableFor(measure: Measure, age: number): LmsTable | undefined {
  const tables = REFERENCE_TABLES as Record<string, LmsTable | undefined>;
  const infantRange = age <= INFANT_CHART_TO_MONTHS;
  const childRange = age >= CHILD_CHART_FROM_MONTHS;

  if (measure === 'weight-for-age') {
    // The only one the name does not settle: a weight is a weight whichever
    // chart it is plotted on, so age decides.
    return age < CHILD_CHART_FROM_MONTHS ? tables.weightForAgeInfant : tables.weightForAge;
  }
  if (measure === 'length-for-age') return infantRange ? tables.lengthForAgeInfant : undefined;
  if (measure === 'stature-for-age') return childRange ? tables.statureForAge : undefined;
  if (measure === 'head-circumference-for-age') {
    return infantRange ? tables.headCircumferenceForAgeInfant : undefined;
  }
  return childRange ? tables.bmiForAge : undefined;
}

/** True for the shape that says why, rather than the shape that says how much. */
export function isRefusal<T extends object>(result: T | GrowthRefusal): result is GrowthRefusal {
  return 'reason' in result;
}

/**
 * The percentile and z-score for one measurement.
 *
 * Both are returned because they are for different jobs. The percentile is what
 * a parent is shown; the z-score is what a clinician tracks, because percentiles
 * compress at the extremes and a child at z -3.4 and one at z -5.1 are both "the
 * 0th percentile" while being in quite different situations.
 */
export function percentileFor(query: GrowthQuery): GrowthResult | GrowthRefusal {
  if (!Number.isFinite(query.value) || query.value <= 0) {
    return { reason: 'not-measurable', detail: 'A measurement must be a positive number.' };
  }

  const choice = choose(query);
  if (isRefusal(choice)) return choice;

  const lms = lmsAt(choice.table, query.sex, choice.index);
  if (lms === undefined) {
    return {
      reason: 'out-of-range',
      detail: `${choice.table.measure} runs from ${String(rangeOf(choice.table, query.sex)[0])} to ${String(rangeOf(choice.table, query.sex)[1])}; this query asked for ${String(choice.index)}.`,
    };
  }

  const z = zScore(query.value, lms);
  return {
    measure: query.measure,
    z: round(z, 4),
    percentile: round(percentileOf(z), 1),
    median: round(lms.m, 4),
    unit: choice.table.unit,
    reference: choice.table.measure,
    source: choice.table.source,
  };
}

/**
 * The curve for a percentile, for drawing a chart.
 *
 * A chart is the point of all this: a single percentile tells a clinician where
 * a child is, and the curve is what shows whether they are following it or
 * crossing it, which is the question that actually matters.
 */
export function curveFor(
  measure: Measure,
  sex: Sex,
  percentile: number,
  options: { readonly infant?: boolean } = {}
): readonly { readonly index: number; readonly value: number }[] {
  const table =
    measure === 'weight-for-length'
      ? (REFERENCE_TABLES.weightForLengthInfant as LmsTable)
      : tableFor(measure, options.infant === true ? 0 : OLDEST_MONTHS);
  if (table === undefined) return [];

  const z = probit(percentile / 100);
  const rows = sex === 'male' ? table.male : table.female;

  return rows.map((row) => ({
    index: row[0],
    value: round(valueAtZ(z, { l: row[1], m: row[2], s: row[3] } satisfies Lms), 4),
  }));
}

function rangeOf(table: LmsTable, sex: Sex): [number, number] {
  const rows = sex === 'male' ? table.male : table.female;
  return [rows[0]?.[0] ?? 0, rows[rows.length - 1]?.[0] ?? 0];
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/**
 * The inverse normal CDF, by bisection on the CDF this package already has.
 *
 * Slower than a rational approximation and exact to the precision asked for,
 * which is the right trade here: it runs once per curve rather than once per
 * point, and it cannot disagree with the forward function the percentiles are
 * computed with - a mismatched pair would draw a 50th-percentile line that a
 * measurement on it did not read as the 50th percentile.
 */
function probit(proportion: number): number {
  if (proportion <= 0 || proportion >= 1) {
    throw new Error('A percentile curve must be strictly between 0 and 100.');
  }

  let low = -6;
  let high = 6;
  for (let step = 0; step < 200; step += 1) {
    const middle = (low + high) / 2;
    if (percentileOf(middle) / 100 < proportion) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}
