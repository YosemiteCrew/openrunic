import { describe, expect, it } from 'vitest';

import {
  bearer,
  createTestApp,
  makePatientRow,
  seed,
  storageColumns,
  testId,
  TOKENS,
} from './support.js';

/**
 * The growth chart, as a screen would fetch it.
 *
 * The behaviour worth asserting is not that a percentile comes back - the
 * library's own tests prove it agrees with the CDC - but that the right chart is
 * chosen for the right reading and that nothing is dropped quietly. A growth
 * chart missing a measurement looks exactly like a measurement that was never
 * taken.
 */

const PATIENT = testId(1);
const BIRTH = new Date('2024-08-14T00:00:00.000Z');

interface GrowthBody {
  patientId: string;
  sex?: string;
  points: {
    observationId: string;
    measure: string;
    ageMonths: number;
    value: number;
    percentile: number;
    z: number;
  }[];
  curves: { measure: string; percentile: number; points: { index: number; value: number }[] }[];
  uncharted: { observationId: string; code: string; reason: string }[];
  reference: string;
}

function harness(
  sexAtBirth: 'MALE' | 'FEMALE' | null = 'FEMALE'
): ReturnType<typeof createTestApp> {
  const created = createTestApp();
  seed(
    created.dataset,
    'Patient',
    makePatientRow({ id: PATIENT, birthDate: BIRTH, sexAtBirth: sexAtBirth as never })
  );
  return created;
}

function seedVital(
  dataset: ReturnType<typeof createTestApp>['dataset'],
  overrides: Record<string, unknown>
): void {
  seed(dataset, 'Observation', {
    ...storageColumns(testId(600)),
    patientId: PATIENT,
    encounterId: null,
    category: 'VITAL_SIGNS',
    status: 'FINAL',
    loincCode: '29463-7',
    code: '29463-7',
    codeSystem: 'http://loinc.org',
    display: 'Body weight',
    valueNumber: 9.5,
    valueText: null,
    valueCode: null,
    valueBoolean: null,
    unit: 'kg',
    referenceLow: null,
    referenceHigh: null,
    interpretationCode: null,
    bodySiteCode: null,
    effectiveAt: new Date('2025-08-14T00:00:00.000Z'),
    issuedAt: null,
    performerId: null,
    note: null,
    ...overrides,
  } as never);
}

async function growthFor(
  app: ReturnType<typeof createTestApp>['app'],
  path = `/bff/v0/patients/${PATIENT}/growth`
): Promise<GrowthBody> {
  const res = await app.request(path, { headers: bearer(TOKENS.clinicianA) });
  expect(res.status, path).toBe(200);
  return (await res.json()) as GrowthBody;
}

describe('plotting a patient', () => {
  it('scores a weight against the chart and says which reference it used', async () => {
    const { app, dataset } = harness();
    seedVital(dataset, {});

    const body = await growthFor(app);

    expect(body.points).toHaveLength(1);
    expect(body.points[0]?.measure).toBe('weight-for-age');
    // Twelve months, to the day.
    expect(body.points[0]?.ageMonths).toBeCloseTo(12, 1);
    expect(body.points[0]?.percentile).toBeGreaterThan(0);
    expect(body.points[0]?.percentile).toBeLessThan(100);
    expect(body.reference).toBe('CDC 2000 growth charts');
  });

  /**
   * A height at eighteen months is `length-for-age` if it was taken lying down
   * and `stature-for-age` if standing, and those are different LOINC codes
   * precisely because they are different measurements. Guessing from the age
   * would plot a standing height against a recumbent reference.
   */
  it('chooses the chart from the LOINC code, not from the age', async () => {
    const { app, dataset } = harness();
    seedVital(dataset, {
      ...storageColumns(testId(601)),
      loincCode: '8306-3',
      code: '8306-3',
      display: 'Body length',
      valueNumber: 75,
      unit: 'cm',
    });
    seedVital(dataset, {
      ...storageColumns(testId(602)),
      loincCode: '8302-2',
      code: '8302-2',
      display: 'Body height',
      valueNumber: 90,
      unit: 'cm',
      effectiveAt: new Date('2027-08-14T00:00:00.000Z'),
    });

    const body = await growthFor(app);

    expect(body.points.map((point) => point.measure).sort()).toEqual([
      'length-for-age',
      'stature-for-age',
    ]);
  });

  it('draws the conventional curves, for the measures that have points', async () => {
    const { app, dataset } = harness();
    seedVital(dataset, {});

    const body = await growthFor(app);

    expect(new Set(body.curves.map((curve) => curve.measure))).toEqual(new Set(['weight-for-age']));
    expect(body.curves.map((curve) => curve.percentile).sort((a, b) => a - b)).toEqual([
      3, 10, 25, 50, 75, 90, 97,
    ]);
    expect(body.curves[0]?.points.length).toBeGreaterThan(10);
  });

  /**
   * Every one of these references is sex-specific, and a chart whose curves
   * belong to the other sex is wrong in a way that looks like the child is.
   */
  it('draws the curves for the patient’s own sex', async () => {
    const male = harness('MALE');
    const female = harness('FEMALE');
    seedVital(male.dataset, {});
    seedVital(female.dataset, {});

    const forMale = await growthFor(male.app);
    const forFemale = await growthFor(female.app);

    const medianAt = (body: GrowthBody): number =>
      body.curves.find((curve) => curve.percentile === 50)?.points[24]?.value ?? 0;

    expect(medianAt(forMale)).not.toBe(medianAt(forFemale));
    expect(forMale.points[0]?.percentile).not.toBe(forFemale.points[0]?.percentile);
  });

  it('narrows to one measure when asked', async () => {
    const { app, dataset } = harness();
    seedVital(dataset, {});
    seedVital(dataset, {
      ...storageColumns(testId(603)),
      loincCode: '8306-3',
      code: '8306-3',
      display: 'Body length',
      valueNumber: 75,
      unit: 'cm',
    });

    const body = await growthFor(app, `/bff/v0/patients/${PATIENT}/growth?measure=weight-for-age`);

    expect(body.points.map((point) => point.measure)).toEqual(['weight-for-age']);
  });
});

describe('what it will not chart, and says so', () => {
  /**
   * "We have no weight for this child at two years" and "we have one and could
   * not plot it" are different problems with different fixes, and a chart that
   * silently omits the second reports the first.
   */
  it('reports a reading whose code is not a growth measurement', async () => {
    const { app, dataset } = harness();
    seedVital(dataset, {
      loincCode: '8867-4',
      code: '8867-4',
      display: 'Heart rate',
      valueNumber: 110,
      unit: '/min',
    });

    const body = await growthFor(app);

    expect(body.points).toEqual([]);
    expect(body.uncharted).toHaveLength(1);
    expect(body.uncharted[0]?.code).toBe('8867-4');
    expect(body.uncharted[0]?.reason).toContain('not one of the measurements');
  });

  it('reports a reading with no numeric value', async () => {
    const { app, dataset } = harness();
    seedVital(dataset, { valueNumber: null, valueText: 'refused' });

    const body = await growthFor(app);

    expect(body.uncharted[0]?.reason).toContain('no numeric value');
  });

  it('reports a reading the charts do not reach, with the library’s own reason', async () => {
    const { app, dataset } = harness();
    seedVital(dataset, {
      valueNumber: 70,
      effectiveAt: new Date('2050-08-14T00:00:00.000Z'),
    });

    const body = await growthFor(app);

    expect(body.points).toEqual([]);
    expect(body.uncharted[0]?.reason).toContain('weightForAge');
  });

  /**
   * There is no sex-neutral growth chart to fall back to. Answering with an
   * empty chart would read as "this child has no measurements".
   */
  it('refuses a patient with no sex recorded, rather than charting nothing', async () => {
    const { app, dataset } = harness(null);
    seedVital(dataset, {});

    const res = await app.request(`/bff/v0/patients/${PATIENT}/growth`, {
      headers: bearer(TOKENS.clinicianA),
    });

    expect(res.status).toBe(400);
    expect(await res.text()).toContain('sex-specific');
  });
});

describe('who may see it', () => {
  it('refuses a caller with no token', async () => {
    const { app } = harness();

    expect((await app.request(`/bff/v0/patients/${PATIENT}/growth`)).status).toBe(401);
  });

  it('answers 404 for a patient this organisation does not have', async () => {
    const { app } = harness();

    const res = await app.request(`/bff/v0/patients/${testId(999)}/growth`, {
      headers: bearer(TOKENS.clinicianA),
    });

    expect(res.status).toBe(404);
  });

  it('cannot see another organisation’s patient', async () => {
    const { app, dataset } = harness();
    seedVital(dataset, {});

    const res = await app.request(`/bff/v0/patients/${PATIENT}/growth`, {
      headers: bearer(TOKENS.clinicianB),
    });

    expect(res.status).toBe(404);
  });
});

describe('readings recorded the way a real chart records them', () => {
  /**
   * `loincCode` is the coded column and `code` the one a practice fills when it
   * has no LOINC. Reading only the first would leave every locally-coded vital
   * uncharted; reading only the second would miss the coded ones.
   */
  it('reads the code from either column', async () => {
    const { app, dataset } = harness();
    seedVital(dataset, { loincCode: null, code: '29463-7' });

    const body = await growthFor(app);

    expect(body.points).toHaveLength(1);
    expect(body.uncharted).toEqual([]);
  });

  /**
   * The points below 24 months were scored against the infant chart, so the
   * infant chart is the one to draw. Drawing the child curves under an infant's
   * points would show a two-month-old apparently far below every line.
   */
  it('draws the infant curves for an infant and the child curves for a child', async () => {
    const infant = harness();
    const child = harness();
    seedVital(infant.dataset, { effectiveAt: new Date('2024-11-14T00:00:00.000Z') });
    seedVital(child.dataset, {
      valueNumber: 15,
      effectiveAt: new Date('2028-08-14T00:00:00.000Z'),
    });

    const forInfant = await growthFor(infant.app);
    const forChild = await growthFor(child.app);

    expect(forInfant.curves[0]?.points[0]?.index).toBe(0);
    expect(forChild.curves[0]?.points[0]?.index).toBe(24);
  });

  it('answers with an empty chart for a patient who has no vitals at all', async () => {
    const { app } = harness();

    const body = await growthFor(app);

    expect(body.points).toEqual([]);
    expect(body.curves).toEqual([]);
    expect(body.uncharted).toEqual([]);
  });
});

describe('every charted point has a curve under it', () => {
  /**
   * The rule that picks the curve has to be the rule that scored the point, or a
   * reading is plotted against a reference it was not measured against. The case
   * that catches it is a length between 24 and 36 months: the library charts it
   * on the infant curve, and a rule keyed on age alone would have drawn the
   * child curves - or, as it did, none at all.
   */
  it('draws the infant curves for a length recorded past two years', async () => {
    const { app, dataset } = harness();
    seedVital(dataset, {
      loincCode: '8306-3',
      code: '8306-3',
      display: 'Body length',
      valueNumber: 92,
      unit: 'cm',
      effectiveAt: new Date('2027-02-14T00:00:00.000Z'),
    });

    const body = await growthFor(app);

    expect(body.points).toHaveLength(1);
    expect(body.points[0]?.ageMonths).toBeGreaterThan(24);
    expect(body.curves.length).toBeGreaterThan(0);
    expect(body.curves[0]?.points[0]?.index).toBe(0);
  });

  it('gives every measure with a point a full set of curves', async () => {
    const { app, dataset } = harness();
    seedVital(dataset, {});
    seedVital(dataset, {
      ...storageColumns(testId(610)),
      loincCode: '8302-2',
      code: '8302-2',
      display: 'Body height',
      valueNumber: 95,
      unit: 'cm',
      effectiveAt: new Date('2028-08-14T00:00:00.000Z'),
    });

    const body = await growthFor(app);

    for (const measure of new Set(body.points.map((point) => point.measure))) {
      const drawn = body.curves.filter((curve) => curve.measure === measure);

      expect(drawn, measure).toHaveLength(7);
      expect(
        drawn.every((curve) => curve.points.length > 0),
        measure
      ).toBe(true);
    }
  });

  it('names the code it could not chart even when only the local column is set', async () => {
    const { app, dataset } = harness();
    seedVital(dataset, { loincCode: null, code: 'LOCAL-PULSE', display: 'Pulse' });

    const body = await growthFor(app);

    expect(body.uncharted[0]?.code).toBe('LOCAL-PULSE');
  });
});

describe('a child whose weights span the two charts', () => {
  /**
   * A weight at six months and another at five years are on different
   * references, and there is nothing unusual about a chart holding both.
   * Choosing one chart for the set strands the points on the other side with no
   * line under them - `some` strands the older ones and `every` strands the
   * younger ones - so a set that spans the boundary gets both.
   */
  it('draws both the infant and the child curves', async () => {
    const { app, dataset } = harness();
    seedVital(dataset, { effectiveAt: new Date('2025-02-14T00:00:00.000Z') });
    seedVital(dataset, {
      ...storageColumns(testId(620)),
      valueNumber: 18,
      effectiveAt: new Date('2029-08-14T00:00:00.000Z'),
    });

    const body = await growthFor(app);
    const weight = body.curves.filter((curve) => curve.measure === 'weight-for-age');
    const starts = new Set(weight.map((curve) => curve.points[0]?.index));

    expect(body.points).toHaveLength(2);
    // Seven percentile lines on each of the two charts.
    expect(weight).toHaveLength(14);
    expect(starts).toEqual(new Set([0, 24]));
  });

  it('gives every point a curve that actually covers its age', async () => {
    const { app, dataset } = harness();
    seedVital(dataset, { effectiveAt: new Date('2025-02-14T00:00:00.000Z') });
    seedVital(dataset, {
      ...storageColumns(testId(621)),
      valueNumber: 18,
      effectiveAt: new Date('2029-08-14T00:00:00.000Z'),
    });

    const body = await growthFor(app);

    for (const point of body.points) {
      const covering = body.curves.filter(
        (curve) =>
          curve.measure === point.measure &&
          curve.points.some((entry) => entry.index <= point.ageMonths) &&
          curve.points.some((entry) => entry.index >= point.ageMonths)
      );

      expect(
        covering.length,
        `${point.measure} at ${String(point.ageMonths)} months`
      ).toBeGreaterThan(0);
    }
  });

  it('draws one chart only where every point is on the same side', async () => {
    const { app, dataset } = harness();
    seedVital(dataset, { effectiveAt: new Date('2025-02-14T00:00:00.000Z') });

    const body = await growthFor(app);

    expect(body.curves.filter((curve) => curve.measure === 'weight-for-age')).toHaveLength(7);
  });
});
