import { MEASURE_VALUE_SETS } from '@openrunic/quality';
import { describe, expect, it } from 'vitest';

import type { MeasureReportDto, MeasureSummaryDto } from '../schemas/quality.js';

import {
  bearer,
  createTestApp,
  jsonBearer,
  makeAppointmentRow,
  makePatientRow,
  seed,
  storageColumns,
  testId,
  TOKENS,
  UNPRIVILEGED_TOKEN,
} from './support.js';

/**
 * Quality reporting end to end, with the deployment supplying its own codes.
 *
 * Everything coded here is invented and lives under `example.invalid`. That is
 * not a shortcut around a fixture: the code lists these measures reference are
 * licensed content this project does not redistribute, and a test that used
 * them would be redistributing them. What is being exercised is that a
 * deployment's own value sets reach the measure, which is the whole mechanism.
 */

const SYSTEM = 'http://example.invalid/codes';
const PATIENT = testId(1);
const PERIOD = 'periodStart=2026-01-01T00:00:00Z&periodEnd=2027-01-01T00:00:00Z';

function valueSetBody(url: string, codes: readonly string[], system = SYSTEM) {
  return { url, definition: { url, include: [{ system, codes: [...codes] }] } };
}

async function loadValueSets(
  app: ReturnType<typeof createTestApp>['app'],
  sets: readonly (readonly [string, readonly string[], string?])[]
): Promise<void> {
  for (const [url, codes, system] of sets) {
    const res = await app.request('/bff/v0/value-sets', {
      method: 'POST',
      headers: jsonBearer(TOKENS.adminA),
      body: JSON.stringify(valueSetBody(url, codes, system)),
    });
    expect(res.status, `loading ${url}`).toBe(201);
  }
}

const APPOINTMENT_SYSTEM = 'http://openrunic.org/fhir/CodeSystem/appointment-type';

/** The value sets CMS165 reads, with invented codes standing in for each. */
const CMS165_SETS = [
  [MEASURE_VALUE_SETS.hypertension, ['HTN']],
  [MEASURE_VALUE_SETS.systolicBloodPressure, ['SBP']],
  [MEASURE_VALUE_SETS.diastolicBloodPressure, ['DBP']],
  // Under the appointment system, not the clinical one. An appointment carries
  // a practice-defined type code rather than a published one, so a deployment
  // has to map its own codes into the encounter value set. This is the first
  // thing to check when a denominator comes back empty, and this fixture is
  // what that mapping looks like.
  [MEASURE_VALUE_SETS.outpatientEncounter, ['OFFICE-30'], APPOINTMENT_SYSTEM],
  [MEASURE_VALUE_SETS.pregnancy, ['PREG']],
  [MEASURE_VALUE_SETS.endStageRenalDisease, ['ESRD']],
  [MEASURE_VALUE_SETS.hospiceCare, ['HOSP']],
  [MEASURE_VALUE_SETS.palliativeCare, ['PALL']],
] as const;

function seedCodes(dataset: ReturnType<typeof createTestApp>['dataset']): void {
  const codes = ['HTN', 'SBP', 'DBP', 'PREG', 'ESRD', 'HOSP', 'PALL'];
  for (const [index, code] of codes.entries()) {
    seed(dataset, 'TerminologyCode', {
      ...storageColumns(testId(600 + index)),
      system: SYSTEM,
      code,
      display: code,
      version: '',
      parentCode: null,
      isActive: true,
      properties: null,
    });
  }
  // The appointment type lives under its own system, because an appointment
  // carries a practice-defined type rather than a published code.
  seed(dataset, 'TerminologyCode', {
    ...storageColumns(testId(699)),
    system: APPOINTMENT_SYSTEM,
    code: 'OFFICE-30',
    display: 'Office visit',
    version: '',
    parentCode: null,
    isActive: true,
    properties: null,
  });
}

function seedChart(
  dataset: ReturnType<typeof createTestApp>['dataset'],
  options: { systolic?: number; diastolic?: number; hypertensive?: boolean } = {}
): void {
  const { systolic, diastolic, hypertensive = true } = options;
  seed(dataset, 'Patient', makePatientRow({ id: PATIENT }));
  seed(dataset, 'Appointment', makeAppointmentRow({ id: testId(101), patientId: PATIENT }));

  if (hypertensive) {
    seed(dataset, 'Condition', {
      ...storageColumns(testId(300)),
      patientId: PATIENT,
      encounterId: null,
      code: 'HTN',
      codeSystem: SYSTEM,
      display: 'Hypertension',
      category: 'PROBLEM_LIST_ITEM',
      clinicalStatus: 'ACTIVE',
      verificationStatus: 'CONFIRMED',
      snomedCode: null,
      onsetDate: new Date('2020-01-01T00:00:00.000Z'),
      abatementDate: null,
      severityCode: null,
      bodySiteCode: null,
      note: null,
      recordedAt: new Date('2020-01-01T00:00:00.000Z'),
      recordedById: null,
    });
  }

  const readings: [string, number | undefined][] = [
    ['SBP', systolic],
    ['DBP', diastolic],
  ];
  for (const [index, [code, value]] of readings.entries()) {
    if (value === undefined) continue;
    // `Observation`, not `ResultObservation`: a blood pressure is a vital sign
    // recorded at a visit, and `ResultObservation` is a line under a diagnostic
    // report. Seeding the wrong one produced an empty numerator that looked
    // exactly like a patient who had not been measured.
    seed(dataset, 'Observation', {
      ...storageColumns(testId(400 + index)),
      patientId: PATIENT,
      encounterId: null,
      category: 'VITAL_SIGNS',
      status: 'FINAL',
      loincCode: null,
      code,
      codeSystem: SYSTEM,
      display: code,
      valueNumber: value,
      valueText: null,
      valueCode: null,
      valueBoolean: null,
      unit: 'mm[Hg]',
      referenceLow: null,
      referenceHigh: null,
      interpretationCode: null,
      bodySiteCode: null,
      effectiveAt: new Date('2026-06-01T00:00:00.000Z'),
      issuedAt: null,
      performerId: null,
      formSubmissionId: null,
    });
  }
}

async function report(
  app: ReturnType<typeof createTestApp>['app'],
  measure = 'CMS165'
): Promise<Response> {
  return app.request(`/bff/v0/quality/measures/${measure}/report?${PERIOD}`, {
    headers: bearer(TOKENS.adminA),
  });
}

describe('listing the measures', () => {
  it('names what a fresh deployment cannot compute, and why', async () => {
    const { app } = createTestApp();

    const res = await app.request('/bff/v0/quality/measures', { headers: bearer(TOKENS.adminA) });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: MeasureSummaryDto[] };
    const cms165 = body.data.find((measure) => measure.id === 'CMS165');
    // Nothing ships in the value set table, so a fresh install computes none of
    // these and this is how an operator finds out which lists to obtain.
    expect(cms165?.computable).toBe(false);
    expect(cms165?.missingValueSets.length).toBeGreaterThan(0);
  });

  it('reports a measure as computable once its value sets are loaded', async () => {
    const { app } = createTestApp();
    await loadValueSets(app, CMS165_SETS);

    const body = (await (
      await app.request('/bff/v0/quality/measures', { headers: bearer(TOKENS.adminA) })
    ).json()) as { data: MeasureSummaryDto[] };

    expect(body.data.find((measure) => measure.id === 'CMS165')?.computable).toBe(true);
  });

  it('says which way is better for each measure', async () => {
    const { app } = createTestApp();

    const body = (await (
      await app.request('/bff/v0/quality/measures', { headers: bearer(TOKENS.adminA) })
    ).json()) as { data: MeasureSummaryDto[] };

    expect(body.data.find((measure) => measure.id === 'CMS165')?.higherIsBetter).toBe(true);
    // CMS122 counts failures. A dashboard that sorted them together would show
    // a practice its worst measure as its best.
    expect(body.data.find((measure) => measure.id === 'CMS122')?.higherIsBetter).toBe(false);
  });
});

describe('computing a measure', () => {
  it('refuses rather than computing from code lists this deployment lacks', async () => {
    const { app, dataset } = createTestApp();
    seedChart(dataset, { systolic: 128, diastolic: 78 });

    const res = await report(app);

    // 409, not 404 and not 500: the measure exists and nothing is broken.
    expect(res.status).toBe(409);
    expect(await res.text()).toContain('cts.nlm.nih.gov');
  });

  it('counts a controlled patient once the deployment supplies its codes', async () => {
    const { app, dataset } = createTestApp();
    seedCodes(dataset);
    seedChart(dataset, { systolic: 128, diastolic: 78 });
    await loadValueSets(app, CMS165_SETS);

    const res = await report(app);

    expect(res.status).toBe(200);
    const body = (await res.json()) as MeasureReportDto;
    expect(body).toMatchObject({ measureId: 'CMS165', denominator: 1, numerator: 1 });
    expect(body.performanceRate).toBe(1);
  });

  it('never counts a patient with no reading as controlled', async () => {
    const { app, dataset } = createTestApp();
    seedCodes(dataset);
    seedChart(dataset);
    await loadValueSets(app, CMS165_SETS);

    const body = (await (await report(app)).json()) as MeasureReportDto;

    // The whole reason this package exists. Reported apart from a failure so a
    // practice can tell care that did not happen from care that was not
    // written down.
    expect(body).toMatchObject({ denominator: 1, numerator: 0, numeratorUnknown: 1 });
    expect(body.performanceRate).toBe(0);
  });

  it('carries the specification version the numbers were computed to', async () => {
    const { app, dataset } = createTestApp();
    seedCodes(dataset);
    seedChart(dataset, { systolic: 128, diastolic: 78 });
    await loadValueSets(app, CMS165_SETS);

    const body = (await (await report(app)).json()) as MeasureReportDto;

    // These change annually. A report labelled this year and computed to last
    // year's rules is worse than no report.
    expect(body.version).not.toBe('');
  });

  it('counts a diagnosis recorded years before the period', async () => {
    const { app, dataset } = createTestApp();
    seedCodes(dataset);
    // The fixture records the hypertension in 2020 and reports on 2026. These
    // conditions are chronic, and a problem list narrowed to the measurement
    // period would empty the denominator of exactly the patients the measure
    // is about.
    seedChart(dataset, { systolic: 128, diastolic: 78 });
    await loadValueSets(app, CMS165_SETS);

    const body = (await (await report(app)).json()) as MeasureReportDto;

    expect(body.denominator).toBe(1);
  });

  it('cannot compute when a stored value set definition will not parse', async () => {
    const { app, dataset } = createTestApp();
    seedCodes(dataset);
    seedChart(dataset, { systolic: 128, diastolic: 78 });
    await loadValueSets(app, CMS165_SETS);

    // Written straight into the table, bypassing the validation the route does
    // on the way in. That is the only way this state arises, and it is worth
    // handling: a definition nobody can read is treated as absent rather than
    // as an empty set, because an empty set and a set that matched nothing look
    // identical at the point of use and mean opposite things.
    const stored = dataset.table('ValueSet');
    const target = stored.find((row) => row.url === MEASURE_VALUE_SETS.hypertension);
    expect(target, 'the hypertension value set should have been loaded').toBeDefined();
    if (target !== undefined) target.definition = { nonsense: true };

    const res = await report(app);

    expect(res.status).toBe(409);
    expect(await res.text()).toContain(MEASURE_VALUE_SETS.hypertension);
  });

  it('answers 404 for a measure this build does not carry', async () => {
    const { app } = createTestApp();

    const res = await app.request(`/bff/v0/quality/measures/CMS999/report?${PERIOD}`, {
      headers: bearer(TOKENS.adminA),
    });

    expect(res.status).toBe(404);
  });

  it('refuses a period that ends before it starts', async () => {
    const { app } = createTestApp();

    const res = await app.request(
      '/bff/v0/quality/measures/CMS165/report?periodStart=2027-01-01T00:00:00Z&periodEnd=2026-01-01T00:00:00Z',
      { headers: bearer(TOKENS.adminA) }
    );

    expect(res.status).toBe(422);
  });

  it('refuses a caller who cannot read the whole organisation', async () => {
    const { app } = createTestApp();

    // A report computed over one site and labelled with the practice's name is
    // a number about a different population than it claims.
    const res = await app.request(`/bff/v0/quality/measures/CMS165/report?${PERIOD}`, {
      headers: bearer(TOKENS.siteReaderA),
    });

    expect(res.status).toBe(403);
  });
});

describe('value sets a deployment supplies', () => {
  it('refuses a definition that is not well formed', async () => {
    const { app } = createTestApp();

    const res = await app.request('/bff/v0/value-sets', {
      method: 'POST',
      headers: jsonBearer(TOKENS.adminA),
      body: JSON.stringify({ url: 'http://example.invalid/vs', definition: { nope: true } }),
    });

    expect(res.status).toBe(422);
  });

  it('refuses a rule field the terminology package does not know', async () => {
    const { app } = createTestApp();

    // A misspelled `parentcode` that silently widened a value set to a whole
    // code system would be discovered by a clinician reading a quality report,
    // not by an operator.
    const res = await app.request('/bff/v0/value-sets', {
      method: 'POST',
      headers: jsonBearer(TOKENS.adminA),
      body: JSON.stringify({
        url: 'http://example.invalid/vs',
        definition: {
          url: 'http://example.invalid/vs',
          include: [{ system: SYSTEM, parentcode: 'X' }],
        },
      }),
    });

    expect(res.status).toBe(422);
  });

  it('refuses a caller who may not load terminology', async () => {
    const { app } = createTestApp();

    const res = await app.request('/bff/v0/value-sets', {
      method: 'POST',
      headers: jsonBearer(UNPRIVILEGED_TOKEN),
      body: JSON.stringify(valueSetBody('http://example.invalid/vs', ['X'])),
    });

    expect(res.status).toBe(403);
  });
});
