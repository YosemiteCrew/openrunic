import type {
  CodedEvent,
  CriterionContext,
  MeasureDefinition,
  MeasurementPeriod,
  MeasureSubject,
} from './measure.js';

/**
 * RUNNING A MEASURE OVER A POPULATION.
 *
 * The arithmetic is a few subtractions. What this file is actually for is
 * making sure the subtractions cannot be done on numbers that do not mean what
 * they appear to mean.
 */

/** Why a measure could not be computed at all. */
export interface MeasureUnavailable {
  readonly measureId: string;
  readonly computable: false;
  /** Value sets the measure reads that this deployment has not loaded. */
  readonly missingValueSets: readonly string[];
}

export interface MeasureReport {
  readonly measureId: string;
  readonly title: string;
  readonly version: string;
  readonly computable: true;
  readonly period: MeasurementPeriod;
  readonly higherIsBetter: boolean;
  readonly initialPopulation: number;
  readonly denominator: number;
  readonly denominatorExclusion: number;
  readonly denominatorException: number;
  readonly numerator: number;
  /**
   * Patients in the denominator whose record does not contain what the
   * numerator needs.
   *
   * Reported because it is the difference between care that did not happen and
   * care that was not written down, and a practice works on those two problems
   * in completely different ways. They are counted against the practice in the
   * rate below, which is correct: an unrecorded result is not a result.
   */
  readonly numeratorUnknown: number;
  /**
   * numerator / (denominator - exclusions - exceptions), or null.
   *
   * Null when nothing remains to divide by, rather than zero. A measure with an
   * empty denominator has no rate; reporting 0% would say the practice failed
   * every patient it had, when it had none.
   */
  readonly performanceRate: number | null;
}

export type MeasureOutcome = MeasureReport | MeasureUnavailable;

/** True when the report is one that can be read as a rate. */
export function isComputable(outcome: MeasureOutcome): outcome is MeasureReport {
  return outcome.computable;
}

export interface EvaluateOptions {
  /** Value set membership, from the deployment's own terminology service. */
  readonly inValueSet: (valueSetUrl: string, event: CodedEvent) => boolean;
  /** Canonical URLs this deployment has actually loaded. */
  readonly loadedValueSets: ReadonlySet<string>;
}

/**
 * Runs one measure over one population.
 *
 * ## Order of the checks, and why it is the order
 *
 * A patient outside the initial population is not looked at again: the later
 * criteria are written assuming the earlier ones held, and running a
 * denominator criterion over somebody the measure was never about produces an
 * answer whose meaning nobody defined.
 *
 * Exclusions are counted before exceptions, and both are subtracted from the
 * denominator rather than from the numerator. Subtracting from the numerator is
 * a real implementation mistake and it moves the rate in the flattering
 * direction, which is how it survives review.
 *
 * ## A patient can be in the numerator only if they are in the denominator
 *
 * Enforced here rather than trusted to each measure. It is the invariant the
 * whole report rests on, and a measure that got it wrong would produce a rate
 * above 100% that a dashboard would render as a very good day.
 */
export function evaluateMeasure(
  measure: MeasureDefinition,
  subjects: readonly MeasureSubject[],
  period: MeasurementPeriod,
  options: EvaluateOptions
): MeasureOutcome {
  const missingValueSets = measure.valueSets.filter((url) => !options.loadedValueSets.has(url));
  if (missingValueSets.length > 0) {
    // Refused rather than computed from a partial code list. A denominator
    // built from half a value set is a smaller, wronger denominator, and it
    // looks exactly like a real one.
    return { measureId: measure.id, computable: false, missingValueSets };
  }

  let initialPopulation = 0;
  let denominator = 0;
  let denominatorExclusion = 0;
  let denominatorException = 0;
  let numerator = 0;
  let numeratorUnknown = 0;

  for (const subject of subjects) {
    const context: CriterionContext = { subject, period, inValueSet: options.inValueSet };

    if (measure.initialPopulation(context) !== 'met') continue;
    initialPopulation += 1;

    if (measure.denominator(context) !== 'met') continue;
    denominator += 1;

    if (measure.denominatorExclusion?.(context) === 'met') {
      denominatorExclusion += 1;
      continue;
    }
    if (measure.denominatorException?.(context) === 'met') {
      denominatorException += 1;
      continue;
    }

    const met = measure.numerator(context);
    if (met === 'met') numerator += 1;
    // `unknown` is counted and NOT added to the numerator. A patient whose
    // record does not say cannot be assumed to have passed.
    if (met === 'unknown') numeratorUnknown += 1;
  }

  const eligible = denominator - denominatorExclusion - denominatorException;

  return {
    measureId: measure.id,
    title: measure.title,
    version: measure.version,
    computable: true,
    period,
    higherIsBetter: measure.higherIsBetter,
    initialPopulation,
    denominator,
    denominatorExclusion,
    denominatorException,
    numerator,
    numeratorUnknown,
    performanceRate: eligible <= 0 ? null : numerator / eligible,
  };
}

/* ------------------------------------------------------------------ helpers */

/** Whole years between two instants, the way an age is spoken. */
export function ageAt(birthDate: Date | null, at: Date): number | null {
  if (birthDate === null) return null;
  let years = at.getUTCFullYear() - birthDate.getUTCFullYear();
  const monthDelta = at.getUTCMonth() - birthDate.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && at.getUTCDate() < birthDate.getUTCDate())) {
    years -= 1;
  }
  return years;
}

/** True when the instant falls inside the period. `end` is exclusive. */
export function withinPeriod(at: Date, period: MeasurementPeriod): boolean {
  return at >= period.start && at < period.end;
}

/**
 * The most recent event in the period, or undefined.
 *
 * Measures say "most recent" far more often than "any", and the difference is
 * the whole point of several of them: a patient whose blood pressure was
 * controlled in March and uncontrolled in November is not controlled.
 */
export function mostRecent<T extends CodedEvent>(
  events: readonly T[],
  period: MeasurementPeriod,
  matches: (event: T) => boolean
): T | undefined {
  let latest: T | undefined;
  for (const event of events) {
    if (!withinPeriod(event.at, period) || !matches(event)) continue;
    if (latest === undefined || event.at > latest.at) latest = event;
  }
  return latest;
}

/** True when any event in the period is in the value set. */
export function hasCodedEvent(
  events: readonly CodedEvent[],
  period: MeasurementPeriod,
  valueSetUrl: string,
  inValueSet: CriterionContext['inValueSet']
): boolean {
  return events.some((event) => withinPeriod(event.at, period) && inValueSet(valueSetUrl, event));
}
