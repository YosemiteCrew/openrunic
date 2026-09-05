import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { COLLECTION_SPECS } from '../repositories/specs/index.js';

import {
  bearer,
  createTestApp,
  DEMO_FACILITY_A,
  DEMO_FACILITY_B,
  DEMO_TENANT_A,
  FIXED_NOW,
  makePatientRow,
  seed,
  seedCareRelationship,
  testId,
  TOKENS,
} from './support.js';

/**
 * The BFF gates a clinical read by the care relationship, not by knowing the id.
 *
 * #247 established that a chart read needs a relationship, and closed it on the
 * FHIR boundary and on `/patients/:id`. It did not reach the generic BFF CRUD
 * resources: `GET /bff/v0/problems/:id`, `?patientId=`, and the amendments,
 * across every clinical, order and financial aggregate. Those took the same id
 * `GET /fhir/Condition/{id}` refuses and answered 200, so a clinician with the
 * plain read permission could open any chart in the tenant - a different
 * facility's included, because a condition carries no facility of its own.
 *
 * The gate lives in the CRUD seam, keyed off each aggregate's `chartFrom`. The
 * enumeration guard below is what keeps it from rotting: an aggregate whose spec
 * says it is chart data (a `patientColumn`) and whose route forgets `chartFrom`
 * fails here rather than in production.
 */

const ROUTES_DIR = new URL('../routes/', import.meta.url).pathname;

interface CrudDecl {
  readonly file: string;
  readonly key: string;
  readonly chartFrom: string | undefined;
}

/**
 * Every `defineCrud` in the route files, with the collection key it serves and
 * the `chartFrom` it declares (if any).
 *
 * A source scan, and split on `defineCrud(` so each chunk holds exactly one
 * call's body: the failure being caught is an aggregate nobody thought to gate,
 * and a test that drives requests only covers the ones somebody drove.
 */
function crudDeclarations(): CrudDecl[] {
  const decls: CrudDecl[] = [];
  const files = readdirSync(ROUTES_DIR).filter(
    (name) => name.endsWith('.ts') && !name.endsWith('.test.ts')
  );
  for (const name of files) {
    const source = readFileSync(join(ROUTES_DIR, name), 'utf8');
    const chunks = source.split('defineCrud(');
    for (let i = 1; i < chunks.length; i += 1) {
      const chunk = chunks[i] ?? '';
      const key = /collection:\s*\(repos[^)]*\)\s*=>\s*repos\.(\w+)/.exec(chunk)?.[1];
      if (key === undefined) continue;
      const chartFrom = /chartFrom:\s*'(\w+)'/.exec(chunk)?.[1];
      decls.push({ file: name, key, chartFrom });
    }
  }
  return decls;
}

describe('every chart-bearing BFF aggregate declares its chart', () => {
  const decls = crudDeclarations();

  it('found the CRUD declarations to check', () => {
    // A guard whose scan silently matched nothing would pass forever. There are
    // well over a dozen CRUD aggregates across the route files.
    expect(decls.length).toBeGreaterThan(15);
  });

  it.each(decls.map((d) => [`${d.file}:${d.key}`, d] as const))(
    '%s gates iff its spec is chart data',
    (_label, decl) => {
      const spec = (COLLECTION_SPECS as Record<string, { patientColumn?: string }>)[decl.key];
      expect(spec, `no spec named ${decl.key}`).toBeDefined();
      const isChart = spec?.patientColumn !== undefined;

      if (isChart) {
        expect(
          decl.chartFrom,
          `${decl.key} is chart data (patientColumn) but its route sets no chartFrom, so its reads bypass the care-relationship gate`
        ).toBe(decl.key);
      } else {
        expect(
          decl.chartFrom,
          `${decl.key} is not chart data but declares chartFrom, which would refuse it for want of a relationship it can never have`
        ).toBeUndefined();
      }
    }
  );
});

describe('a BFF clinical read, driven through the app', () => {
  const STRANGER = testId(70801);
  const PROBLEM = testId(70802);

  function seedStrangerProblem(
    dataset: ReturnType<typeof createTestApp>['dataset'],
    facility: string
  ): void {
    seed(
      dataset,
      'Patient',
      makePatientRow({ id: STRANGER, mrn: 'OR-770801', primaryFacilityId: facility })
    );
    seed(dataset, 'Condition', {
      id: PROBLEM,
      tenantId: DEMO_TENANT_A,
      patientId: STRANGER,
      encounterId: null,
      category: 'PROBLEM_LIST_ITEM',
      code: 'C50.9',
      codeSystem: 'http://hl7.org/fhir/sid/icd-10-cm',
      display: 'Malignant neoplasm of breast',
      snomedCode: null,
      clinicalStatus: 'ACTIVE',
      verificationStatus: 'CONFIRMED',
      onsetDate: null,
      abatementDate: null,
      severityCode: null,
      bodySiteCode: null,
      note: null,
      recordedAt: FIXED_NOW,
      recordedById: null,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    });
  }

  it('refuses a read of a chart nothing connects the reader to', async () => {
    const { app, dataset } = createTestApp();
    seedStrangerProblem(dataset, DEMO_FACILITY_A);
    const res = await app.request(`/bff/v0/problems/${PROBLEM}`, {
      headers: bearer(TOKENS.clinicianA),
    });
    // 404, not 403: a 403 would confirm the row exists to a reader who may not see it.
    expect(res.status).toBe(404);
  });

  it("refuses a read of a different facility's chart, which carries no facility of its own", async () => {
    const { app, dataset } = createTestApp();
    seedStrangerProblem(dataset, DEMO_FACILITY_B);
    const res = await app.request(`/bff/v0/problems/${PROBLEM}`, {
      headers: bearer(TOKENS.clinicianA),
    });
    expect(res.status).toBe(404);
  });

  it('answers once a relationship exists', async () => {
    const { app, dataset } = createTestApp();
    seedStrangerProblem(dataset, DEMO_FACILITY_B);
    seedCareRelationship(dataset, {
      patientId: STRANGER,
      providerId: '01890000-0000-7000-8000-000000000101',
      as: 'appointment',
      id: testId(70803),
    });
    const res = await app.request(`/bff/v0/problems/${PROBLEM}`, {
      headers: bearer(TOKENS.clinicianA),
    });
    expect(res.status).toBe(200);
  });

  it('refuses a list that names a chart the reader is not on', async () => {
    const { app, dataset } = createTestApp();
    seedStrangerProblem(dataset, DEMO_FACILITY_A);
    const res = await app.request(`/bff/v0/problems?patientId=${STRANGER}`, {
      headers: bearer(TOKENS.clinicianA),
    });
    expect(res.status).toBe(404);
  });

  it('refuses an amendment of a chart the reader is not on', async () => {
    const { app, dataset } = createTestApp();
    seedStrangerProblem(dataset, DEMO_FACILITY_A);
    const res = await app.request(`/bff/v0/problems/${PROBLEM}`, {
      method: 'PATCH',
      headers: { ...bearer(TOKENS.clinicianA), 'content-type': 'application/json' },
      body: JSON.stringify({ display: 'Edited' }),
    });
    expect(res.status).toBe(404);
  });

  it('does not audit the relationship check as reads by the reader', async () => {
    // The check consults an appointment to authorise the read; that is the
    // system deciding, not the clinician accessing the appointment. The read
    // event names the problem alone, and the access is its own chart.access.
    const { app, dataset, sink } = createTestApp();
    seedStrangerProblem(dataset, DEMO_FACILITY_B);
    seedCareRelationship(dataset, {
      patientId: STRANGER,
      providerId: '01890000-0000-7000-8000-000000000101',
      as: 'appointment',
      id: testId(70804),
    });
    await app.request(`/bff/v0/problems/${PROBLEM}`, { headers: bearer(TOKENS.clinicianA) });

    const reads = sink.reads();
    expect(reads).toHaveLength(1);
    expect(reads[0]?.event.metadata.targets).toEqual([
      { type: 'Condition', id: PROBLEM, patientId: STRANGER },
    ]);
    const access = sink.writes().map((w) => w.event.action);
    expect(access).toContain('chart.access');
  });
});
