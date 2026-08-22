/**
 * PROMOTING INTEROPERABILITY: THE CATEGORY AN EMR ACTUALLY KNOWS ABOUT.
 *
 * Unlike Quality, these measures are about what the software did rather than
 * what the clinician achieved, so an EMR is the only thing that can answer
 * them. Each is a numerator over a denominator of eligible acts.
 *
 * ## An unmet measure is not the same as an unattested one
 *
 * Several PI measures require an attestation that cannot be derived from stored
 * data: whether a practice completed a security risk analysis, whether it
 * checked the prescription drug monitoring programme. The software has no way
 * to know, and inferring "no" from an absent record would report a practice as
 * having failed something nobody asked it.
 *
 * So an attested measure with no attestation is `unattested`, which is distinct
 * from an attestation of `false`. One is a practice that says it did not do the
 * thing; the other is a practice nobody has asked.
 */

/** What a measure is worth, and how it is answered. */
export interface PiMeasure {
  readonly id: string;
  readonly title: string;
  /** Points available, out of the category's 100. */
  readonly points: number;
  /**
   * `rate` measures are computed from stored data. `attestation` measures are
   * a yes or no the practice supplies, because nothing in a chart records them.
   */
  readonly kind: 'rate' | 'attestation';
  /** An attestation measure that is required: answering no scores the whole category zero. */
  readonly required?: true;
}

/**
 * The measures this build knows about.
 *
 * Not the full published set. Each one here is one this EMR can actually answer
 * from what it stores or from an attestation it can record, and a measure it
 * cannot answer is absent rather than present and permanently zero.
 */
export const PI_MEASURES: readonly PiMeasure[] = [
  {
    id: 'PI_EP_1',
    title: 'e-Prescribing',
    points: 10,
    kind: 'rate',
  },
  {
    id: 'PI_HIE_1',
    title: 'Support Electronic Referral Loops by Sending Health Information',
    points: 15,
    kind: 'rate',
  },
  {
    id: 'PI_PEA_1',
    title: 'Provide Patients Electronic Access to Their Health Information',
    points: 25,
    kind: 'rate',
  },
  {
    id: 'PI_PHCDRR_1',
    title: 'Immunisation Registry Reporting',
    points: 25,
    kind: 'rate',
  },
  {
    id: 'PI_SRA_1',
    title: 'Security Risk Analysis',
    points: 0,
    kind: 'attestation',
    // Worth no points and able to zero the category, which is how CMS defines
    // it. A practice that has not done one does not get a smaller score; it
    // gets none.
    required: true,
  },
];

/** How one measure was answered. */
export type PiAnswer =
  | {
      readonly measureId: string;
      readonly kind: 'rate';
      readonly numerator: number;
      readonly denominator: number;
    }
  | { readonly measureId: string; readonly kind: 'attestation'; readonly attested: boolean };

export type PiMeasureScore =
  | { readonly measureId: string; readonly scored: true; readonly points: number }
  | {
      readonly measureId: string;
      readonly scored: false;
      readonly reason: 'unanswered' | 'unattested' | 'no-eligible-acts';
    };

export interface PiCategoryScore {
  readonly measures: readonly PiMeasureScore[];
  /**
   * 0 to 1, or null when the category cannot be scored.
   *
   * Null when a required attestation is missing: not zero, because zero says
   * the practice failed the requirement and missing says nobody asked it.
   */
  readonly achieved: number | null;
  /** True when a required attestation was answered no, which zeroes the category. */
  readonly zeroedByRequirement: boolean;
}

/**
 * Scores the category.
 *
 * A rate measure with no eligible acts is unscored rather than zero. A practice
 * that wrote no prescriptions at all did not fail to send them electronically,
 * and scoring it as though it did would penalise a practice for its case mix.
 */
export function scorePromotingInteroperability(
  answers: readonly PiAnswer[],
  measures: readonly PiMeasure[] = PI_MEASURES
): PiCategoryScore {
  const byId = new Map(answers.map((answer) => [answer.measureId, answer]));
  const scores: PiMeasureScore[] = [];
  let earned = 0;
  let available = 0;
  let zeroedByRequirement = false;
  let missingRequirement = false;

  for (const measure of measures) {
    const answer = byId.get(measure.id);

    if (answer === undefined) {
      if (measure.required === true) missingRequirement = true;
      scores.push({
        measureId: measure.id,
        scored: false,
        reason: measure.kind === 'attestation' ? 'unattested' : 'unanswered',
      });
      continue;
    }

    if (answer.kind === 'attestation') {
      if (measure.required === true && !answer.attested) zeroedByRequirement = true;
      scores.push({ measureId: measure.id, scored: true, points: measure.points });
      available += measure.points;
      earned += answer.attested ? measure.points : 0;
      continue;
    }

    if (answer.denominator <= 0) {
      // A practice that wrote no prescriptions did not fail to send them
      // electronically. Scoring this as zero would penalise a case mix.
      scores.push({ measureId: measure.id, scored: false, reason: 'no-eligible-acts' });
      continue;
    }

    const rate = Math.min(1, answer.numerator / answer.denominator);
    const points = rate * measure.points;
    scores.push({ measureId: measure.id, scored: true, points: Math.round(points * 10) / 10 });
    available += measure.points;
    earned += points;
  }

  if (missingRequirement) {
    return { measures: scores, achieved: null, zeroedByRequirement: false };
  }
  if (zeroedByRequirement) {
    return { measures: scores, achieved: 0, zeroedByRequirement: true };
  }
  return {
    measures: scores,
    achieved: available === 0 ? null : earned / available,
    zeroedByRequirement: false,
  };
}
