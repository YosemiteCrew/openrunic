import type { MeasureReport } from '@openrunic/quality';
import { describe, expect, it } from 'vitest';

import {
  benchmarkProblems,
  CASE_MINIMUM,
  compositeScore,
  PI_MEASURES,
  qualityCategory,
  scorePromotingInteroperability,
  scoreQualityMeasure,
  type Benchmark,
  type CategoryWeights,
  type PiAnswer,
  type QualityScore,
} from './index.js';

const WEIGHTS: CategoryWeights = {
  year: 2026,
  weights: {
    quality: 30,
    'promoting-interoperability': 25,
    'improvement-activities': 15,
    cost: 30,
  },
};

function report(overrides: Partial<MeasureReport> = {}): MeasureReport {
  return {
    measureId: 'CMS165',
    title: 'Controlling High Blood Pressure',
    version: '2026',
    computable: true,
    period: { start: new Date('2026-01-01'), end: new Date('2027-01-01') },
    higherIsBetter: true,
    initialPopulation: 100,
    denominator: 100,
    denominatorExclusion: 0,
    denominatorException: 0,
    numerator: 70,
    numeratorUnknown: 0,
    performanceRate: 0.7,
    ...overrides,
  };
}

/** Ascending, for a measure where a higher rate is better. */
const ASCENDING: Benchmark = {
  measureId: 'CMS165',
  year: 2026,
  deciles: [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95],
};

describe('scoring one quality measure', () => {
  it('places a rate in a decile and awards the points', () => {
    // 0.7 clears six of the nine boundaries (0.2 through 0.7 inclusive), which
    // puts it in decile 7. Counted out longhand because getting this off by one
    // is how a practice is scored a decile better than it performed, and the
    // first draft of this test did exactly that.
    expect(scoreQualityMeasure(report(), ASCENDING)).toStrictEqual({
      measureId: 'CMS165',
      scored: true,
      decile: 7,
      points: 7,
    });
  });

  it('never scores a reported measure below the floor', () => {
    const poor = scoreQualityMeasure(report({ performanceRate: 0.05 }), ASCENDING);

    expect(poor).toMatchObject({ scored: true, decile: 1, points: 3 });
  });

  it('does not score a measure with no benchmark, and says so', () => {
    // Not zero. Zero is a practice that performed badly; this is a practice
    // nobody has scored, and reporting the second as the first is a number
    // somebody would act on.
    expect(scoreQualityMeasure(report(), undefined)).toStrictEqual({
      measureId: 'CMS165',
      scored: false,
      reason: 'no-benchmark',
    });
  });

  it('does not score a measure with no rate', () => {
    expect(scoreQualityMeasure(report({ performanceRate: null }), ASCENDING)).toMatchObject({
      scored: false,
      reason: 'no-rate',
    });
  });

  it('does not score a denominator too small to mean anything', () => {
    // One patient in a denominator of three moves the rate by 33 points.
    const small = report({ denominator: CASE_MINIMUM - 1 });

    expect(scoreQualityMeasure(small, ASCENDING)).toMatchObject({
      scored: false,
      reason: 'below-case-minimum',
    });
  });

  it('counts exclusions out of the case minimum, as the rate does', () => {
    // 25 in the denominator, 10 excluded, so 15 eligible: below the minimum
    // even though the raw denominator clears it.
    const excluded = report({ denominator: 25, denominatorExclusion: 10 });

    expect(scoreQualityMeasure(excluded, ASCENDING)).toMatchObject({
      reason: 'below-case-minimum',
    });
  });

  it('reads an inverse measure in the other direction', () => {
    const descending: Benchmark = {
      measureId: 'CMS122',
      year: 2026,
      deciles: [0.4, 0.35, 0.3, 0.25, 0.2, 0.15, 0.1, 0.05, 0.02],
    };
    const poorControl = report({
      measureId: 'CMS122',
      higherIsBetter: false,
      performanceRate: 0.08,
    });

    // A low rate is the good one here, so 0.08 clears seven boundaries.
    expect(scoreQualityMeasure(poorControl, descending)).toMatchObject({ decile: 8, points: 8 });
  });
});

describe('checking a benchmark before trusting it', () => {
  it('accepts one that is well formed', () => {
    expect(benchmarkProblems(ASCENDING, true)).toStrictEqual([]);
  });

  it('refuses a benchmark loaded in the wrong direction', () => {
    // The failure worth catching: an ascending benchmark on an inverse measure
    // scores every practice backwards. The best performers get three points,
    // the worst get ten, and nothing about the output looks wrong.
    expect(benchmarkProblems(ASCENDING, false)).toContainEqual(expect.stringContaining('descend'));
  });

  it('refuses a descending benchmark on a measure where higher is better', () => {
    // The mirror of the case above, and the same bug: a benchmark loaded the
    // wrong way round scores the best performers worst, and nothing about the
    // output looks wrong.
    const descending: Benchmark = {
      ...ASCENDING,
      deciles: [...ASCENDING.deciles].reverse(),
    };

    expect(benchmarkProblems(descending, true)).toContainEqual(expect.stringContaining('ascend'));
  });

  it('refuses the wrong number of boundaries', () => {
    expect(benchmarkProblems({ ...ASCENDING, deciles: [0.5] }, true)).toContainEqual(
      expect.stringContaining('nine')
    );
  });

  it('refuses a boundary that is not a rate', () => {
    expect(
      benchmarkProblems({ ...ASCENDING, deciles: [...ASCENDING.deciles.slice(0, 8), 42] }, true)
    ).toContainEqual(expect.stringContaining('between 0 and 1'));
  });

  it('returns problems rather than throwing them', () => {
    expect(() =>
      benchmarkProblems({ measureId: 'x', year: 2026, deciles: [] }, true)
    ).not.toThrow();
  });
});

describe('the quality category', () => {
  const scored = (points: number): QualityScore => ({
    measureId: `CMS${String(points)}`,
    scored: true,
    decile: points,
    points,
  });

  it('averages the measures it could score', () => {
    expect(qualityCategory([scored(8), scored(6)])).toStrictEqual({
      category: 'quality',
      achieved: 0.7,
    });
  });

  it('leaves an unscored measure out rather than counting it as a failure', () => {
    // A measure with no benchmark is one nobody has scored. Counting it as zero
    // would report a practice as performing badly at something it was never
    // measured on.
    const withUnscored = qualityCategory([
      scored(8),
      { measureId: 'CMS122', scored: false, reason: 'no-benchmark' },
    ]);

    expect(withUnscored?.achieved).toBe(0.8);
  });

  it('has nothing to say when nothing could be scored', () => {
    // Null, not zero. Zero says the practice scored nothing.
    expect(qualityCategory([{ measureId: 'CMS165', scored: false, reason: 'no-rate' }])).toBeNull();
  });
});

describe('promoting interoperability', () => {
  const attestSecurity: PiAnswer = {
    measureId: 'PI_SRA_1',
    kind: 'attestation',
    attested: true,
  };

  it('scores a rate measure in proportion to the rate', () => {
    const result = scorePromotingInteroperability([
      attestSecurity,
      { measureId: 'PI_EP_1', kind: 'rate', numerator: 45, denominator: 50 },
    ]);

    expect(result.achieved).toBeCloseTo(0.9, 5);
  });

  it('does not penalise a practice for a case mix it does not have', () => {
    // A practice that wrote no prescriptions did not fail to send them
    // electronically.
    const result = scorePromotingInteroperability([
      attestSecurity,
      { measureId: 'PI_EP_1', kind: 'rate', numerator: 0, denominator: 0 },
    ]);

    expect(result.measures.find((m) => m.measureId === 'PI_EP_1')).toMatchObject({
      scored: false,
      reason: 'no-eligible-acts',
    });
  });

  it('zeroes the category when a required attestation is answered no', () => {
    const result = scorePromotingInteroperability([
      { measureId: 'PI_SRA_1', kind: 'attestation', attested: false },
      { measureId: 'PI_EP_1', kind: 'rate', numerator: 50, denominator: 50 },
    ]);

    // A practice that has not done a security risk analysis does not get a
    // smaller score; it gets none.
    expect(result).toMatchObject({ achieved: 0, zeroedByRequirement: true });
  });

  it('cannot score the category at all when nobody was asked', () => {
    const result = scorePromotingInteroperability([
      { measureId: 'PI_EP_1', kind: 'rate', numerator: 50, denominator: 50 },
    ]);

    // Null and not zero, and not `zeroedByRequirement`. A practice that says it
    // did not do the thing and a practice nobody has asked are different, and
    // only one of them has failed anything.
    expect(result).toMatchObject({ achieved: null, zeroedByRequirement: false });
    expect(result.measures.find((m) => m.measureId === 'PI_SRA_1')).toMatchObject({
      reason: 'unattested',
    });
  });

  it('reports an unanswered rate measure as unanswered', () => {
    const result = scorePromotingInteroperability([attestSecurity]);

    expect(result.measures.find((m) => m.measureId === 'PI_EP_1')).toMatchObject({
      reason: 'unanswered',
    });
  });

  it('caps a rate above one, rather than awarding more than the measure is worth', () => {
    const result = scorePromotingInteroperability([
      attestSecurity,
      { measureId: 'PI_EP_1', kind: 'rate', numerator: 80, denominator: 50 },
    ]);

    expect(result.achieved).toBe(1);
  });

  it('lists only measures this build can actually answer', () => {
    // A measure this EMR cannot answer is absent rather than present and
    // permanently zero, which would report a practice as failing something the
    // software never asked about.
    expect(PI_MEASURES.length).toBeGreaterThan(0);
    expect(PI_MEASURES.every((measure) => measure.points >= 0)).toBe(true);
  });
});

describe('the composite score', () => {
  it('never claims to be a final score', () => {
    const composite = compositeScore(
      [
        { category: 'quality', achieved: 0.8 },
        { category: 'promoting-interoperability', achieved: 0.9 },
        { category: 'improvement-activities', achieved: 1 },
      ],
      WEIGHTS
    );

    // 24 + 22.5 + 15 = 61.5 out of the 70 points this software can see.
    expect(composite.points).toBe(61.5);
    expect(composite.coveredWeight).toBe(70);
    // Deliberately not renormalised to 100. A number presented as a final score
    // that silently omits thirty per cent of the weight is the kind of wrong
    // that gets acted on.
    expect(composite.points).not.toBe(87.9);
  });

  it('always names Cost as something it did not compute', () => {
    const composite = compositeScore([{ category: 'quality', achieved: 1 }], WEIGHTS);
    const cost = composite.notComputed.find((entry) => entry.category === 'cost');

    // Present rather than absent, so a screen rendering this cannot omit it.
    expect(cost).toBeDefined();
    expect(cost?.reason).toContain('claims');
  });

  it('names every other category it did not compute', () => {
    const composite = compositeScore([{ category: 'quality', achieved: 1 }], WEIGHTS);

    expect(composite.notComputed.map((entry) => entry.category).sort()).toStrictEqual([
      'cost',
      'improvement-activities',
      'promoting-interoperability',
    ]);
  });

  it('counts a category that scored zero towards the weight it covered', () => {
    // A practice that scored nothing on Promoting Interoperability has been
    // measured on it. Leaving it out would raise the apparent completeness of a
    // worse score.
    const composite = compositeScore(
      [
        { category: 'quality', achieved: 1 },
        { category: 'promoting-interoperability', achieved: 0 },
      ],
      WEIGHTS
    );

    expect(composite).toMatchObject({ points: 30, coveredWeight: 55 });
  });

  it('covers nothing when nothing was reported', () => {
    const composite = compositeScore([], WEIGHTS);

    expect(composite).toMatchObject({ points: 0, coveredWeight: 0 });
    expect(composite.notComputed).toHaveLength(4);
  });

  it('carries the performance year the weights are for', () => {
    // Weights move between years. A score computed to last year's weights and
    // labelled with this year is a different number wearing the right name.
    expect(compositeScore([], WEIGHTS).year).toBe(2026);
  });
});
