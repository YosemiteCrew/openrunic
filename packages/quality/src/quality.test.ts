import { describe, expect, it } from 'vitest';

import {
  ageAt,
  cms122,
  cms165,
  evaluateMeasure,
  isComputable,
  measureById,
  MEASURES,
  MEASURE_VALUE_SETS,
  mostRecent,
  withinPeriod,
  type CodedEvent,
  type EvaluateOptions,
  type MeasureDefinition,
  type MeasurementPeriod,
  type MeasureSubject,
  type NumericEvent,
} from './index.js';

const PERIOD: MeasurementPeriod = {
  start: new Date('2026-01-01T00:00:00.000Z'),
  end: new Date('2027-01-01T00:00:00.000Z'),
};

/**
 * Invented codes under `example.invalid`, and a value set map built here.
 *
 * No real value set is used, and none could be: the code lists these measures
 * reference are licensed content this project does not redistribute. What is
 * being tested is the measure logic, which is public, so the test supplies its
 * own codes and its own membership function - exactly as a deployment does.
 */
const SYSTEM = 'http://example.invalid/codes';

const MEMBERS: Readonly<Record<string, readonly string[]>> = {
  hypertension: ['HTN'],
  diabetes: ['DM'],
  systolicBloodPressure: ['SBP'],
  diastolicBloodPressure: ['DBP'],
  hba1cLaboratoryTest: ['A1C'],
  outpatientEncounter: ['VISIT'],
  pregnancy: ['PREG'],
  endStageRenalDisease: ['ESRD'],
  palliativeCare: ['PALL'],
  hospiceCare: ['HOSP'],
};

/**
 * Maps each canonical URL to the invented codes standing in for it, BY NAME.
 *
 * An earlier version of this harness matched by position in two arrays and
 * silently produced an empty denominator: every assertion still ran, and every
 * one of them was about a measure that had matched nothing. `MEASURE_VALUE_SETS`
 * is exported precisely so a test can name the set it means.
 */
const CODES_BY_URL = new Map<string, readonly string[]>(
  Object.entries(MEMBERS).map(([name, codes]) => [
    MEASURE_VALUE_SETS[name as keyof typeof MEASURE_VALUE_SETS],
    codes,
  ])
);

const ALL_URLS = [...new Set(MEASURES.flatMap((measure) => measure.valueSets))];

const options: EvaluateOptions = {
  loadedValueSets: new Set(ALL_URLS),
  inValueSet: (url, event) =>
    event.system === SYSTEM && (CODES_BY_URL.get(url) ?? []).includes(event.code),
};

function coded(code: string, at = new Date('2026-06-01T00:00:00.000Z')): CodedEvent {
  return { system: SYSTEM, code, at };
}

function numeric(
  code: string,
  value: number,
  at = new Date('2026-06-01T00:00:00.000Z')
): NumericEvent {
  return { system: SYSTEM, code, value, at };
}

function subject(overrides: Partial<MeasureSubject> = {}): MeasureSubject {
  return {
    patientId: 'p1',
    birthDate: new Date('1975-03-02T00:00:00.000Z'),
    deceasedAt: null,
    conditions: [],
    encounters: [coded('VISIT')],
    observations: [],
    procedures: [],
    immunisations: [],
    medications: [],
    ...overrides,
  };
}

function run(measure: MeasureDefinition, subjects: readonly MeasureSubject[]) {
  const outcome = evaluateMeasure(measure, subjects, PERIOD, options);
  if (!isComputable(outcome)) throw new Error('expected a computable report');
  return outcome;
}

describe('the harness itself', () => {
  it('matches codes, so an assertion about a measure is about a measure', () => {
    // This exists because an earlier version of this file matched value sets by
    // position in two arrays that did not line up. Every test still ran and
    // every denominator was zero, which is the shape of a suite that proves
    // nothing while reporting that it passed.
    const report = run(cms165, [
      subject({
        conditions: [coded('HTN')],
        observations: [numeric('SBP', 120), numeric('DBP', 70)],
      }),
    ]);

    expect(report.initialPopulation).toBe(1);
    expect(report.denominator).toBe(1);
  });

  it('resolves every value set the measures declare', () => {
    for (const url of ALL_URLS) {
      expect(CODES_BY_URL.get(url), url).toBeDefined();
    }
  });
});

describe('the value sets a measure needs', () => {
  it('refuses to compute a rate from code lists it does not have', () => {
    const outcome = evaluateMeasure(cms165, [subject()], PERIOD, {
      ...options,
      loadedValueSets: new Set(),
    });

    // A denominator built from half a value set is a smaller, wronger
    // denominator, and it looks exactly like a real one.
    expect(outcome.computable).toBe(false);
  });

  it('names what is missing, so the deployment knows what to obtain', () => {
    const outcome = evaluateMeasure(cms165, [subject()], PERIOD, {
      ...options,
      loadedValueSets: new Set(ALL_URLS.slice(1)),
    });

    expect(isComputable(outcome)).toBe(false);
    if (!isComputable(outcome)) {
      expect(outcome.missingValueSets).toHaveLength(1);
      expect(outcome.missingValueSets[0]).toContain('cts.nlm.nih.gov');
    }
  });

  it('ships no value set of its own', () => {
    // The specifications are public; the code lists are licensed. Every URL a
    // measure names points at VSAC, and nothing in this package defines the
    // codes behind one.
    for (const measure of MEASURES) {
      for (const url of measure.valueSets) {
        expect(url.startsWith('http://cts.nlm.nih.gov/fhir/ValueSet/')).toBe(true);
      }
    }
  });
});

describe('CMS165, controlling high blood pressure', () => {
  const hypertensive = (observations: NumericEvent[]) =>
    subject({ conditions: [coded('HTN')], observations });

  it('counts a controlled patient in the numerator', () => {
    const report = run(cms165, [hypertensive([numeric('SBP', 128), numeric('DBP', 78)])]);

    expect(report).toMatchObject({ denominator: 1, numerator: 1, performanceRate: 1 });
  });

  it('does not count a patient whose last reading was high', () => {
    const report = run(cms165, [hypertensive([numeric('SBP', 152), numeric('DBP', 94)])]);

    expect(report).toMatchObject({ denominator: 1, numerator: 0, performanceRate: 0 });
  });

  it('NEVER counts a patient with no reading as controlled', () => {
    // The defect that inflates every quality score reported wrongly. Written as
    // "systolic is not above 139", a missing reading passes, the rate rises,
    // and nothing reports that it was never measured.
    const report = run(cms165, [hypertensive([])]);

    expect(report.numerator).toBe(0);
    expect(report.numeratorUnknown).toBe(1);
    expect(report.performanceRate).toBe(0);
  });

  it('does not accept half a blood pressure', () => {
    // A systolic of 128 with no diastolic is not a controlled blood pressure.
    const report = run(cms165, [hypertensive([numeric('SBP', 128)])]);

    expect(report.numerator).toBe(0);
    expect(report.numeratorUnknown).toBe(1);
  });

  it('takes the most recent reading, not the best one', () => {
    const report = run(cms165, [
      hypertensive([
        numeric('SBP', 118, new Date('2026-03-01T00:00:00.000Z')),
        numeric('DBP', 74, new Date('2026-03-01T00:00:00.000Z')),
        numeric('SBP', 168, new Date('2026-11-01T00:00:00.000Z')),
        numeric('DBP', 98, new Date('2026-11-01T00:00:00.000Z')),
      ]),
    ]);

    // Controlled in March and uncontrolled in November is not controlled.
    expect(report.numerator).toBe(0);
  });

  it('ignores a reading from outside the period', () => {
    const report = run(cms165, [
      hypertensive([
        numeric('SBP', 120, new Date('2025-06-01T00:00:00.000Z')),
        numeric('DBP', 76, new Date('2025-06-01T00:00:00.000Z')),
      ]),
    ]);

    expect(report.numeratorUnknown).toBe(1);
  });

  it.each([
    ['at the top of the range', 139, 89, 1],
    ['exactly at the threshold', 140, 89, 0],
    ['diastolic exactly at the threshold', 139, 90, 0],
  ])('reads the threshold as strictly under: %s', (_name, systolic, diastolic, expected) => {
    // The specification says under 140 and under 90, so 140/89 is not
    // controlled. An inclusive comparison passes a patient the measure fails.
    const report = run(cms165, [
      hypertensive([numeric('SBP', systolic), numeric('DBP', diastolic)]),
    ]);

    expect(report.numerator).toBe(expected);
  });

  it.each([
    ['too young', new Date('2012-01-01T00:00:00.000Z')],
    ['too old', new Date('1930-01-01T00:00:00.000Z')],
  ])('leaves a patient %s out of the initial population', (_name, birthDate) => {
    const report = run(cms165, [
      subject({ birthDate, conditions: [coded('HTN')], observations: [numeric('SBP', 120)] }),
    ]);

    expect(report.initialPopulation).toBe(0);
  });

  it('leaves out a patient with no visit in the period', () => {
    const report = run(cms165, [subject({ encounters: [], conditions: [coded('HTN')] })]);

    expect(report.initialPopulation).toBe(0);
  });

  it('leaves out a patient who died during the period', () => {
    // A measure asking whether a year's blood pressure was brought under
    // control cannot sensibly be asked about somebody who died in March.
    const report = run(cms165, [
      subject({ conditions: [coded('HTN')], deceasedAt: new Date('2026-03-01T00:00:00.000Z') }),
    ]);

    expect(report.initialPopulation).toBe(0);
  });

  it('counts a patient without hypertension in the population but not the denominator', () => {
    const report = run(cms165, [subject({ observations: [numeric('SBP', 120)] })]);

    expect(report).toMatchObject({ initialPopulation: 1, denominator: 0 });
  });

  it('keeps a hypertension diagnosis made before the period', () => {
    // Chronic. A diagnosis from three years ago still describes the patient in
    // front of you, and requiring one inside the period would empty the
    // denominator of exactly the patients the measure is about.
    const report = run(cms165, [
      subject({
        conditions: [coded('HTN', new Date('2019-04-02T00:00:00.000Z'))],
        observations: [numeric('SBP', 120), numeric('DBP', 70)],
      }),
    ]);

    expect(report).toMatchObject({ denominator: 1, numerator: 1 });
  });

  it.each(['PREG', 'ESRD', 'HOSP', 'PALL'])('excludes a patient with %s', (code) => {
    const isCondition = code === 'PREG' || code === 'ESRD';
    const report = run(cms165, [
      subject({
        conditions: [coded('HTN'), ...(isCondition ? [coded(code)] : [])],
        procedures: isCondition ? [] : [coded(code)],
        observations: [numeric('SBP', 180), numeric('DBP', 110)],
      }),
    ]);

    expect(report.denominatorExclusion).toBe(1);
    // Removed from the denominator, not counted as a failure.
    expect(report.performanceRate).toBeNull();
  });
});

describe('CMS122, diabetes with poor HbA1c control', () => {
  const diabetic = (observations: NumericEvent[]) =>
    subject({ conditions: [coded('DM')], observations });

  it('is an inverse measure, and says so', () => {
    // A dashboard that sorted this with the others would show a practice its
    // worst measure as its best.
    expect(cms122.higherIsBetter).toBe(false);
    expect(cms165.higherIsBetter).toBe(true);
  });

  it('counts a patient above nine per cent', () => {
    const report = run(cms122, [diabetic([numeric('A1C', 10.4)])]);

    expect(report).toMatchObject({ denominator: 1, numerator: 1 });
  });

  it('does not count a patient at or below nine per cent', () => {
    const report = run(cms122, [diabetic([numeric('A1C', 9)])]);

    expect(report.numerator).toBe(0);
  });

  it('counts a patient with no test as poor control, per the specification', () => {
    // The one place in this package where an absent value counts against the
    // practice. A year with no test is a year of unmonitored diabetes, and the
    // specification refuses to let that look like a good result.
    const report = run(cms122, [diabetic([])]);

    expect(report.numerator).toBe(1);
  });

  it('also reports that patient as untested, not only as poor control', () => {
    // Both, and both matter. Review caught an earlier version where the
    // numerator returned `met` directly: the patient landed in the numerator
    // and never in `numeratorUnknown`, so a practice could not tell the part of
    // its number that was measured and was bad from the part that was never
    // measured. One of those means change a treatment; the other means order a
    // test.
    const report = run(cms122, [diabetic([])]);

    expect(report.numeratorUnknown).toBe(1);
  });

  it('separates an untested patient from one whose result was bad', () => {
    const report = run(cms122, [
      diabetic([numeric('A1C', 11)]),
      subject({ patientId: 'p2', conditions: [coded('DM')], observations: [] }),
    ]);

    expect(report).toMatchObject({ numerator: 2, numeratorUnknown: 1 });
  });

  it('does not count an untested patient in a measure where absence is not the failure', () => {
    // The default, and the reason this package exists. CMS165 must not count a
    // patient with no reading; CMS122 must. The difference is declared on the
    // measure rather than buried in a return value.
    const report = run(cms165, [subject({ conditions: [coded('HTN')], observations: [] })]);

    expect(report).toMatchObject({ numerator: 0, numeratorUnknown: 1 });
  });

  it('takes the most recent test', () => {
    const report = run(cms122, [
      diabetic([
        numeric('A1C', 12, new Date('2026-02-01T00:00:00.000Z')),
        numeric('A1C', 7.1, new Date('2026-10-01T00:00:00.000Z')),
      ]),
    ]);

    expect(report.numerator).toBe(0);
  });
});

describe('the report itself', () => {
  it('has no rate when nothing remains to divide by', () => {
    // Zero would say the practice failed every patient it had, when it had
    // none.
    const report = run(cms165, []);

    expect(report.performanceRate).toBeNull();
  });

  it('subtracts exclusions from the denominator, not from the numerator', () => {
    const report = run(cms165, [
      subject({
        conditions: [coded('HTN')],
        observations: [numeric('SBP', 120), numeric('DBP', 70)],
      }),
      subject({
        patientId: 'p2',
        conditions: [coded('HTN'), coded('PREG')],
        observations: [numeric('SBP', 190), numeric('DBP', 120)],
      }),
    ]);

    // Two in the denominator, one excluded, one met: 1/1 and not 1/2.
    expect(report).toMatchObject({ denominator: 2, denominatorExclusion: 1, numerator: 1 });
    expect(report.performanceRate).toBe(1);
  });

  it('never reports a numerator larger than the eligible denominator', () => {
    const report = run(cms165, [
      subject({
        conditions: [coded('HTN')],
        observations: [numeric('SBP', 120), numeric('DBP', 70)],
      }),
    ]);

    expect(report.numerator).toBeLessThanOrEqual(
      report.denominator - report.denominatorExclusion - report.denominatorException
    );
  });

  it('separates care that did not happen from care that was not written down', () => {
    const report = run(cms165, [
      subject({
        conditions: [coded('HTN')],
        observations: [numeric('SBP', 190), numeric('DBP', 120)],
      }),
      subject({ patientId: 'p2', conditions: [coded('HTN')], observations: [] }),
    ]);

    // Both count against the rate, and a practice works on them in completely
    // different ways.
    expect(report).toMatchObject({ numerator: 0, numeratorUnknown: 1 });
    expect(report.performanceRate).toBe(0);
  });

  it('carries the period and the version it was computed to', () => {
    const report = run(cms165, []);

    // These change annually. A measure computed to last year's rules and
    // labelled with this year's is worse than no measure.
    expect(report.version).toBe('2026');
    expect(report.period).toStrictEqual(PERIOD);
  });
});

describe('a measure with a denominator exception', () => {
  /**
   * Neither shipped measure has one, and the evaluator has to handle them
   * anyway: an exception is a documented clinical reason not to act, and it is
   * reported separately from an exclusion because they mean different things.
   */
  const withException: MeasureDefinition = {
    ...cms165,
    id: 'TEST-EXCEPTION',
    denominatorException: (context) =>
      context.subject.medications.some((medication) => medication.code === 'REFUSED')
        ? 'met'
        : 'not-met',
  };

  it('removes the patient from the denominator and reports them apart from exclusions', () => {
    const outcome = evaluateMeasure(
      withException,
      [
        subject({
          conditions: [coded('HTN')],
          medications: [coded('REFUSED')],
          observations: [numeric('SBP', 190), numeric('DBP', 120)],
        }),
      ],
      PERIOD,
      options
    );
    if (!isComputable(outcome)) throw new Error('expected a computable report');

    expect(outcome).toMatchObject({
      denominator: 1,
      denominatorException: 1,
      denominatorExclusion: 0,
      numerator: 0,
    });
    expect(outcome.performanceRate).toBeNull();
  });
});

describe('the helpers', () => {
  it('counts age the way an age is spoken', () => {
    expect(ageAt(new Date('1975-03-02T00:00:00.000Z'), new Date('2026-03-01T00:00:00.000Z'))).toBe(
      50
    );
    expect(ageAt(new Date('1975-03-02T00:00:00.000Z'), new Date('2026-03-02T00:00:00.000Z'))).toBe(
      51
    );
  });

  it('has no age for a patient with no birth date', () => {
    expect(ageAt(null, new Date())).toBeNull();
  });

  it.each([cms165, cms122])('leaves a patient with no birth date out of $id', (measure) => {
    // Every one of these measures has an age band. A patient with no date of
    // birth cannot be placed in one, and guessing would put somebody in a
    // population the measure was never about.
    const report = run(measure, [
      subject({ birthDate: null, conditions: [coded('HTN'), coded('DM')] }),
    ]);

    expect(report.initialPopulation).toBe(0);
  });

  it('treats the end of the period as exclusive', () => {
    expect(withinPeriod(PERIOD.start, PERIOD)).toBe(true);
    expect(withinPeriod(PERIOD.end, PERIOD)).toBe(false);
  });

  it('finds nothing when nothing matches', () => {
    expect(mostRecent([], PERIOD, () => true)).toBeUndefined();
  });

  it('finds the newest event, not the last one in the list', () => {
    // Nothing guarantees a repository returns events in order, and taking the
    // last one in the array instead of the newest is exactly the "most recent"
    // bug these measures turn on.
    const events = [
      numeric('SBP', 118, new Date('2026-11-01T00:00:00.000Z')),
      numeric('SBP', 190, new Date('2026-02-01T00:00:00.000Z')),
    ];

    expect(mostRecent(events, PERIOD, () => true)?.value).toBe(118);
  });

  it('reads an unsorted chart the same as a sorted one', () => {
    const readings = [
      numeric('SBP', 190, new Date('2026-11-01T00:00:00.000Z')),
      numeric('DBP', 120, new Date('2026-11-01T00:00:00.000Z')),
      numeric('SBP', 118, new Date('2026-02-01T00:00:00.000Z')),
      numeric('DBP', 74, new Date('2026-02-01T00:00:00.000Z')),
    ];
    const forwards = run(cms165, [subject({ conditions: [coded('HTN')], observations: readings })]);
    const backwards = run(cms165, [
      subject({ conditions: [coded('HTN')], observations: [...readings].reverse() }),
    ]);

    expect(forwards.numerator).toBe(backwards.numerator);
    expect(forwards.numerator).toBe(0);
  });

  it('looks a measure up by its identifier', () => {
    expect(measureById('CMS165')).toBe(cms165);
    expect(measureById('CMS999')).toBeUndefined();
  });
});
