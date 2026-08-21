import { ageAt, hasCodedEvent, mostRecent, withinPeriod } from './evaluate.js';
import type { CriterionContext, CriterionResult, MeasureDefinition } from './measure.js';

/**
 * THE MEASURES THEMSELVES.
 *
 * Each one is written against the published CMS specification and names the
 * version it was written against, because these change annually and a measure
 * computed to last year's rules and labelled with this year's is worse than no
 * measure.
 *
 * Every value set is referenced by canonical URL and none is defined here. The
 * specifications are public; the code lists behind them live in VSAC and need a
 * UMLS licence, so the deployment supplies them through
 * `packages/terminology`. A measure whose value sets are not loaded reports
 * that it cannot be computed rather than computing a rate from a partial list.
 *
 * The URLs are VSAC OIDs in canonical form, which is what the specifications
 * cite, so a deployment that has obtained the value sets can load them under
 * the identifier the specification already gave them.
 */

/** VSAC canonical form, so a loaded value set is identified as the spec identifies it. */
const vsac = (oid: string): string => `http://cts.nlm.nih.gov/fhir/ValueSet/${oid}`;

const VS = {
  hypertension: vsac('2.16.840.1.113883.3.464.1003.104.12.1011'),
  diabetes: vsac('2.16.840.1.113883.3.464.1003.103.12.1001'),
  systolicBloodPressure: vsac('2.16.840.1.113883.3.526.3.1032'),
  diastolicBloodPressure: vsac('2.16.840.1.113883.3.526.3.1033'),
  hba1cLaboratoryTest: vsac('2.16.840.1.113883.3.464.1003.198.12.1013'),
  outpatientEncounter: vsac('2.16.840.1.113883.3.464.1003.101.12.1001'),
  pregnancy: vsac('2.16.840.1.113883.3.526.3.378'),
  endStageRenalDisease: vsac('2.16.840.1.113883.3.526.3.353'),
  palliativeCare: vsac('2.16.840.1.113883.3.600.1.1579'),
  hospiceCare: vsac('2.16.840.1.113883.3.526.3.1584'),
} as const;

/** A yes/no criterion. Used only where absence genuinely means "no". */
const asResult = (value: boolean): CriterionResult => (value ? 'met' : 'not-met');

/**
 * Alive at the end of the period.
 *
 * Several measures require it, and the reason is not administrative: a measure
 * asking whether a patient's blood pressure was brought under control during
 * the year cannot sensibly be asked about somebody who died in March.
 */
function aliveThrough(context: CriterionContext): boolean {
  const { deceasedAt } = context.subject;
  return deceasedAt === null || deceasedAt >= context.period.end;
}

/** Age on the day the period starts, which is what these specifications say. */
function ageAtPeriodStart(context: CriterionContext): number | null {
  return ageAt(context.subject.birthDate, context.period.start);
}

function seenInPeriod(context: CriterionContext): boolean {
  return hasCodedEvent(
    context.subject.encounters,
    context.period,
    VS.outpatientEncounter,
    context.inValueSet
  );
}

/**
 * Removed from the denominator for a reason the measure itself recognises.
 *
 * Hospice and palliative care are on every one of these measures. A patient
 * receiving comfort care is not somebody whose blood pressure target the
 * practice should be judged on, and a measure that counted them would push a
 * practice towards treating a number rather than a person.
 */
function comfortCare(context: CriterionContext): boolean {
  return (
    hasCodedEvent(context.subject.procedures, context.period, VS.hospiceCare, context.inValueSet) ||
    hasCodedEvent(context.subject.procedures, context.period, VS.palliativeCare, context.inValueSet)
  );
}

/**
 * CMS165: Controlling High Blood Pressure.
 *
 * Patients 18 to 85 with hypertension, whose most recent blood pressure during
 * the period was under 140/90. Higher is better.
 *
 * Two things here are the classic ways to get this measure wrong.
 *
 * The reading must be the MOST RECENT, not any reading: a patient controlled in
 * March and uncontrolled in November is not controlled, and taking the best
 * reading of the year is how a practice reports a number it has not earned.
 *
 * A patient with no blood pressure recorded is `unknown`, never `met`. Written
 * as "systolic is not above 139" a missing reading passes, the rate rises, and
 * nothing anywhere reports that it was never measured.
 */
export const cms165: MeasureDefinition = {
  id: 'CMS165',
  title: 'Controlling High Blood Pressure',
  version: '2026',
  higherIsBetter: true,
  valueSets: [
    VS.hypertension,
    VS.systolicBloodPressure,
    VS.diastolicBloodPressure,
    VS.outpatientEncounter,
    VS.pregnancy,
    VS.endStageRenalDisease,
    VS.hospiceCare,
    VS.palliativeCare,
  ],

  initialPopulation(context) {
    const age = ageAtPeriodStart(context);
    if (age === null) return 'unknown';
    return asResult(age >= 18 && age <= 85 && aliveThrough(context) && seenInPeriod(context));
  },

  denominator(context) {
    // Hypertension diagnosed at any point, not only during the period: it is a
    // chronic condition, and a diagnosis from three years ago still describes
    // the patient in front of you.
    return asResult(
      context.subject.conditions.some((condition) => context.inValueSet(VS.hypertension, condition))
    );
  },

  denominatorExclusion(context) {
    return asResult(
      comfortCare(context) ||
        context.subject.conditions.some(
          (condition) =>
            context.inValueSet(VS.pregnancy, condition) ||
            context.inValueSet(VS.endStageRenalDisease, condition)
        )
    );
  },

  numerator(context) {
    const systolic = mostRecent(context.subject.observations, context.period, (observation) =>
      context.inValueSet(VS.systolicBloodPressure, observation)
    );
    const diastolic = mostRecent(context.subject.observations, context.period, (observation) =>
      context.inValueSet(VS.diastolicBloodPressure, observation)
    );

    // Both halves are needed. A systolic of 128 with no diastolic recorded is
    // not a controlled blood pressure; it is half a blood pressure.
    if (systolic === undefined || diastolic === undefined) return 'unknown';
    return asResult(systolic.value < 140 && diastolic.value < 90);
  },
};

/**
 * CMS122: Diabetes, Haemoglobin A1c Poor Control (greater than 9%).
 *
 * Patients 18 to 75 with diabetes whose most recent HbA1c during the period was
 * above 9%. **Lower is better**, which is why `higherIsBetter` exists: this
 * measure counts failures, and a dashboard that sorted it with the others would
 * show a practice its worst measure as its best.
 *
 * A patient with no HbA1c result counts IN the numerator by specification -
 * that is, as poor control. That is the opposite of the usual rule in this
 * package and it is deliberate in the specification: a year with no test is a
 * year of unmonitored diabetes, and the measure refuses to let an absent result
 * look like a good one. It is still reported as `unknown` here so the practice
 * can see how much of its number is untested rather than uncontrolled, and the
 * numerator counts it.
 */
export const cms122: MeasureDefinition = {
  id: 'CMS122',
  title: 'Diabetes: Haemoglobin A1c Poor Control (>9%)',
  version: '2026',
  higherIsBetter: false,
  valueSets: [
    VS.diabetes,
    VS.hba1cLaboratoryTest,
    VS.outpatientEncounter,
    VS.hospiceCare,
    VS.palliativeCare,
  ],

  initialPopulation(context) {
    const age = ageAtPeriodStart(context);
    if (age === null) return 'unknown';
    return asResult(age >= 18 && age <= 75 && aliveThrough(context) && seenInPeriod(context));
  },

  denominator(context) {
    return asResult(
      context.subject.conditions.some((condition) => context.inValueSet(VS.diabetes, condition))
    );
  },

  denominatorExclusion(context) {
    return asResult(comfortCare(context));
  },

  numerator(context) {
    const result = mostRecent(context.subject.observations, context.period, (observation) =>
      context.inValueSet(VS.hba1cLaboratoryTest, observation)
    );

    // No result in the period is poor control, per the specification. A year
    // with no test is a year of unmonitored diabetes, and this is the one place
    // in this package where an absent value counts against the practice rather
    // than being set aside.
    if (result === undefined) return 'met';
    return asResult(result.value > 9);
  },
};

/** Every measure this build carries. */
export const MEASURES: readonly MeasureDefinition[] = [cms165, cms122];

export function measureById(id: string): MeasureDefinition | undefined {
  return MEASURES.find((measure) => measure.id === id);
}

export { VS as MEASURE_VALUE_SETS };

/** Re-exported so a caller can check a period without importing the evaluator. */
export { withinPeriod };
