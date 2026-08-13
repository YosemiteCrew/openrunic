import { describe, expect, it } from 'vitest';

import type { OperationOutcome } from '@openrunic/fhir';

import { TENANT_HEADER } from '../middleware/tenant-scope.js';
import type { ProblemDocument } from '../http/problem.js';
import type { PatientDto } from '../schemas/patients.js';
import type { ListResponse } from '../schemas/pagination.js';

import {
  DEMO_TENANT_A,
  DEMO_TENANT_B,
  bearer,
  createTestApp,
  jsonBearer,
  makeAppointmentRow,
  makePatientRow,
  TOKENS,
  seed,
  testId,
} from './support.js';

/**
 * Cross-tenant isolation, end to end.
 *
 * Two organisations share one store, and a principal from B is pointed at
 * every id belonging to A. Nothing in these tests stubs the isolation: the
 * rows are all in the same array, so if the scoping came out, they would leak.
 *
 * Isolation is enforced in three places, and each one is asserted here:
 *
 *   1. The tenant comes only from the verified principal, so a request cannot
 *      name an organisation (`tenantScope`).
 *   2. The repositories a handler receives are already bound to that tenant,
 *      so no handler can ask about another one (`repositories/types.ts`).
 *   3. A miss is reported as absent, never as forbidden, so ids cannot be
 *      enumerated across the boundary.
 *
 * The fourth layer, Postgres RLS, is the database's and is out of reach here.
 */

function twoTenantApp(): ReturnType<typeof createTestApp> {
  const harness = createTestApp();
  seed(
    harness.dataset,
    'Patient',
    makePatientRow({ id: testId(1), tenantId: DEMO_TENANT_A, mrn: 'OR-100482' }),
    makePatientRow({ id: testId(2), tenantId: DEMO_TENANT_B, mrn: 'OR-200001' })
  );
  seed(
    harness.dataset,
    'Appointment',
    makeAppointmentRow({ id: testId(101), tenantId: DEMO_TENANT_A }),
    makeAppointmentRow({ id: testId(102), tenantId: DEMO_TENANT_B })
  );
  return harness;
}

describe('a principal from tenant A cannot reach tenant B', () => {
  it('sees only its own patients in a list', async () => {
    const { app } = twoTenantApp();

    const body = (await (
      await app.request('/bff/v0/patients', { headers: bearer(TOKENS.clinicianA) })
    ).json()) as ListResponse<PatientDto>;

    expect(body.page.total).toBe(1);
    expect(body.data.map((row) => row.id)).toEqual([testId(1)]);
  });

  it('sees only its own appointments in a list', async () => {
    const { app } = twoTenantApp();

    const body = (await (
      await app.request('/bff/v0/appointments', { headers: bearer(TOKENS.clinicianA) })
    ).json()) as ListResponse<{ id: string }>;

    expect(body.data.map((row) => row.id)).toEqual([testId(101)]);
  });

  it("reads another tenant's patient as absent, not as forbidden", async () => {
    const { app } = twoTenantApp();

    const res = await app.request(`/bff/v0/patients/${testId(2)}`, {
      headers: bearer(TOKENS.clinicianA),
    });

    // 403 would confirm the id exists somewhere, which is an enumeration oracle.
    expect(res.status).toBe(404);
    expect(((await res.json()) as ProblemDocument).type).toBe(
      'https://openrunic.org/problems/not-found'
    );
  });

  it("reads another tenant's appointment as absent", async () => {
    const { app } = twoTenantApp();

    expect(
      (
        await app.request(`/bff/v0/appointments/${testId(102)}`, {
          headers: bearer(TOKENS.clinicianA),
        })
      ).status
    ).toBe(404);
  });

  it("cannot amend another tenant's patient", async () => {
    const { app, dataset } = twoTenantApp();

    const res = await app.request(`/bff/v0/patients/${testId(2)}`, {
      method: 'PATCH',
      headers: jsonBearer(TOKENS.clinicianA),
      body: JSON.stringify({ familyName: 'Rewritten' }),
    });

    expect(res.status).toBe(404);
    expect(dataset.table('Patient').find((row) => row.id === testId(2))?.familyName).toBe(
      'Patientsson'
    );
  });

  it("cannot amend another tenant's appointment", async () => {
    const { app, dataset } = twoTenantApp();

    const res = await app.request(`/bff/v0/appointments/${testId(102)}`, {
      method: 'PATCH',
      headers: jsonBearer(TOKENS.clinicianA),
      body: JSON.stringify({ room: '9' }),
    });

    expect(res.status).toBe(404);
    expect(dataset.table('Appointment').find((row) => row.id === testId(102))?.room).toBeNull();
  });

  it('cannot search another tenant by MRN', async () => {
    const { app } = twoTenantApp();

    const body = (await (
      await app.request('/bff/v0/patients?mrn=OR-200001', { headers: bearer(TOKENS.clinicianA) })
    ).json()) as ListResponse<PatientDto>;

    expect(body.data).toEqual([]);
  });

  it("cannot reach another tenant's patient through the FHIR boundary either", async () => {
    const { app } = twoTenantApp();

    const res = await app.request(`/fhir/Patient/${testId(2)}`, {
      headers: bearer(TOKENS.clinicianA),
    });

    expect(res.status).toBe(404);
    expect(((await res.json()) as OperationOutcome).issue[0]).toMatchObject({ code: 'not-found' });
  });

  it('cannot widen a FHIR search past its own organisation', async () => {
    const { app } = twoTenantApp();

    const body = (await (
      await app.request('/fhir/Patient?identifier=OR-200001', {
        headers: bearer(TOKENS.clinicianA),
      })
    ).json()) as { total: number };

    expect(body.total).toBe(0);
  });

  it('writes land in the acting tenant, never in the one the body names', async () => {
    const { app, dataset } = twoTenantApp();

    await app.request('/bff/v0/patients', {
      method: 'POST',
      headers: jsonBearer(TOKENS.clinicianB),
      body: JSON.stringify({
        mrn: 'OR-300001',
        givenName: 'Testina',
        familyName: 'Patientsson',
        birthDate: '1994-03-02',
      }),
    });

    expect(dataset.table('Patient').find((row) => row.mrn === 'OR-300001')?.tenantId).toBe(
      DEMO_TENANT_B
    );
  });

  it('lets each organisation use the same MRN independently', async () => {
    const { app } = twoTenantApp();
    const body = JSON.stringify({
      mrn: 'OR-100482',
      givenName: 'Testina',
      familyName: 'Patientsson',
      birthDate: '1994-03-02',
    });

    // Taken in A, free in B.
    expect(
      (
        await app.request('/bff/v0/patients', {
          method: 'POST',
          headers: jsonBearer(TOKENS.clinicianA),
          body,
        })
      ).status
    ).toBe(409);
    expect(
      (
        await app.request('/bff/v0/patients', {
          method: 'POST',
          headers: jsonBearer(TOKENS.clinicianB),
          body,
        })
      ).status
    ).toBe(201);
  });
});

describe('the tenant assertion header', () => {
  it('is accepted when it agrees with the principal', async () => {
    const { app } = twoTenantApp();

    const res = await app.request('/bff/v0/patients', {
      headers: { ...bearer(TOKENS.clinicianA), [TENANT_HEADER]: DEMO_TENANT_A },
    });

    expect(res.status).toBe(200);
  });

  it('is refused, not ignored, when it names another organisation', async () => {
    const { app } = twoTenantApp();

    const res = await app.request('/bff/v0/patients', {
      headers: { ...bearer(TOKENS.clinicianA), [TENANT_HEADER]: DEMO_TENANT_B },
    });

    expect(res.status).toBe(403);
  });

  it('cannot be used to steer a write', async () => {
    const { app, dataset } = twoTenantApp();

    const res = await app.request('/bff/v0/patients', {
      method: 'POST',
      headers: { ...jsonBearer(TOKENS.clinicianA), [TENANT_HEADER]: DEMO_TENANT_B },
      body: JSON.stringify({
        mrn: 'OR-400001',
        givenName: 'Testina',
        familyName: 'Patientsson',
        birthDate: '1994-03-02',
      }),
    });

    expect(res.status).toBe(403);
    expect(dataset.table('Patient').some((row) => row.mrn === 'OR-400001')).toBe(false);
  });
});

describe('the audit trail', () => {
  it('attributes every event to the acting organisation', async () => {
    const { app, sink } = twoTenantApp();

    await app.request('/bff/v0/patients', { headers: bearer(TOKENS.clinicianA) });
    await app.request('/bff/v0/patients', { headers: bearer(TOKENS.clinicianB) });

    expect(sink.reads().map((entry) => entry.tenantId)).toEqual([DEMO_TENANT_A, DEMO_TENANT_B]);
  });
});
