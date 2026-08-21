/**
 * ELECTRONIC CLINICAL QUALITY MEASURES: WHAT A PRACTICE DID, AND WHAT THIS WILL
 * NOT CLAIM IT DID.
 *
 * A measure divides a population into named groups and reports a rate. The
 * arithmetic is trivial. Everything that makes this hard is about what the
 * groups mean, and about the one failure that matters:
 *
 * ## A patient with no reading is not a patient who passed
 *
 * This is the defect that inflates every quality score that has ever been
 * reported wrongly, and it is easy to write by accident. "Blood pressure under
 * 140/90" implemented as `!(systolic >= 140)` counts a patient with no blood
 * pressure recorded at all as controlled. The number goes up, nothing throws,
 * and the practice believes it is doing better than it is - which is the exact
 * opposite of what a quality measure is for.
 *
 * So numerator criteria here answer three ways, not two: met, not met, or **no
 * data**. No data never counts towards the numerator. It is reported separately
 * so a practice can see how much of its score is unmeasured rather than
 * unachieved, because those call for completely different work.
 *
 * ## The measure logic is public; the code lists are not
 *
 * CMS publishes the specifications. The value sets they reference live in VSAC
 * and need a UMLS licence, and this project does not redistribute licensed
 * terminology (see `packages/terminology`).
 *
 * So a measure declares which value sets it needs, by canonical URL, and the
 * deployment supplies them. A measure whose value sets are not loaded reports
 * that it **cannot be computed**, naming what is missing. It does not report a
 * rate calculated from a partial code list, because a denominator built from
 * half a value set is a smaller, wronger denominator that looks exactly like a
 * real one.
 */

/** A coded fact about a patient, as a measure sees it. */
export interface CodedEvent {
  readonly system: string;
  readonly code: string;
  /** When it was recorded. Measures care about order and about the period. */
  readonly at: Date;
}

/** A numeric observation, such as a blood pressure or a lab result. */
export interface NumericEvent extends CodedEvent {
  readonly value: number;
  readonly unit?: string;
}

/**
 * One patient, projected down to what measures actually read.
 *
 * Deliberately small. A measure that could reach the whole chart would be a
 * measure nobody could review, and this shape is what makes each criterion
 * checkable against the published specification line by line.
 */
export interface MeasureSubject {
  readonly patientId: string;
  readonly birthDate: Date | null;
  /** Null when the patient is alive. Several measures exclude the deceased. */
  readonly deceasedAt: Date | null;
  readonly conditions: readonly CodedEvent[];
  readonly encounters: readonly CodedEvent[];
  readonly observations: readonly NumericEvent[];
  readonly procedures: readonly CodedEvent[];
  readonly immunisations: readonly CodedEvent[];
  readonly medications: readonly CodedEvent[];
}

/** The window a measure is computed over. `end` is exclusive. */
export interface MeasurementPeriod {
  readonly start: Date;
  readonly end: Date;
}

/**
 * Whether a criterion was met, and the third answer that matters.
 *
 * `unknown` is not a failure and not a pass. It says the record does not
 * contain what the measure needs, which is a data-capture problem rather than a
 * care problem, and a practice that cannot tell them apart will work on the
 * wrong one.
 */
export type CriterionResult = 'met' | 'not-met' | 'unknown';

/** Everything a criterion is allowed to look at. */
export interface CriterionContext {
  readonly subject: MeasureSubject;
  readonly period: MeasurementPeriod;
  /** True when the code is in the named value set, per the deployment's terminology. */
  readonly inValueSet: (valueSetUrl: string, event: CodedEvent) => boolean;
}

export interface MeasureDefinition {
  /** CMS identifier, e.g. `CMS165`. */
  readonly id: string;
  readonly title: string;
  /** Specification version this implementation was written against. */
  readonly version: string;
  /**
   * Whether a higher rate is better.
   *
   * Not decoration. Several measures are inverse - a lower rate is better
   * quality - and a dashboard that sorts them all the same way tells a practice
   * its worst measure is its best one.
   */
  readonly higherIsBetter: boolean;
  /** Canonical URLs of every value set this measure reads. */
  readonly valueSets: readonly string[];
  /** Who is in scope at all. */
  readonly initialPopulation: (context: CriterionContext) => CriterionResult;
  /** Who the measure is about, within the initial population. */
  readonly denominator: (context: CriterionContext) => CriterionResult;
  /**
   * Who is removed from the denominator entirely, because the measure does not
   * apply to them. Distinct from an exception below.
   */
  readonly denominatorExclusion?: (context: CriterionContext) => CriterionResult;
  /**
   * Who is removed because a clinician documented a valid reason not to act.
   *
   * Separate from an exclusion because they mean different things and are
   * reported separately: an exclusion is "this measure was never about them",
   * an exception is "it was, and there was a reason".
   */
  readonly denominatorException?: (context: CriterionContext) => CriterionResult;
  /** Who met the quality criterion. */
  readonly numerator: (context: CriterionContext) => CriterionResult;
}
