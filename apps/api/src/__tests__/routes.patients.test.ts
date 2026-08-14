import { describe, expect, it } from 'vitest';

import type { ProblemDocument } from '../http/problem.js';
import type { PatientDto } from '../schemas/patients.js';
import type { ListResponse } from '../schemas/pagination.js';

import {
  bearer,
  createTestApp,
  jsonBearer,
  makePatientRow,
  seedPatients,
  TOKENS,
  testId,
  UNPRIVILEGED_TOKEN,
  seed,
} from './support.js';

const VALID_BODY = {
  mrn: 'OR-100482',
  givenName: 'Testina',
  familyName: 'Patientsson',
  birthDate: '1994-03-02',
};

describe('GET /bff/v0/patients', () => {
  it('returns one page and the whole-set total', async () => {
    const { app, dataset } = createTestApp();
    seedPatients(dataset, 30);

    const res = await app.request('/bff/v0/patients?page=2&pageSize=10', {
      headers: bearer(TOKENS.frontDeskA),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as ListResponse<PatientDto>;
    expect(body.data).toHaveLength(10);
    expect(body.page).toEqual({ page: 2, pageSize: 10, total: 30, totalPages: 3 });
  });

  it('reports one empty page for an empty index, never zero pages', async () => {
    const { app } = createTestApp();

    const body = (await (
      await app.request('/bff/v0/patients', { headers: bearer(TOKENS.frontDeskA) })
    ).json()) as ListResponse<PatientDto>;

    expect(body.data).toEqual([]);
    expect(body.page).toEqual({ page: 1, pageSize: 25, total: 0, totalPages: 1 });
  });

  it('searches by name prefix, MRN, birth date and free text', async () => {
    const { app, dataset } = createTestApp();
    seed(
      dataset,
      'Patient',
      makePatientRow({ id: testId(1), mrn: 'OR-100482', preferredName: 'Tess' }),
      makePatientRow({ id: testId(2), mrn: 'OR-100999', familyName: 'Nobody', givenName: 'Nemo' })
    );
    const search = async (query: string): Promise<ListResponse<PatientDto>> =>
      (await (
        await app.request(`/bff/v0/patients?${query}`, { headers: bearer(TOKENS.frontDeskA) })
      ).json()) as ListResponse<PatientDto>;

    expect((await search('family=Patient')).data[0]?.id).toBe(testId(1));
    expect((await search('mrn=OR-100999')).data[0]?.id).toBe(testId(2));
    expect((await search('birthDate=1994-03-02')).data).toHaveLength(2);
    expect((await search('q=Tess')).data[0]?.id).toBe(testId(1));
    expect((await search('given=Nemo&sort=birthDate&order=desc')).data[0]?.id).toBe(testId(2));
  });

  it.each([
    ['an unknown parameter', 'famliy=Pat'],
    ['a page below one', 'page=0'],
    ['a page size over the cap', 'pageSize=1000'],
    ['a non-numeric page', 'page=first'],
    ['a malformed birth date', 'birthDate=02-03-1994'],
    ['an unknown sort key', 'sort=luck'],
    ['a non-boolean active flag', 'active=maybe'],
  ])('rejects %s with a 400 problem document', async (_label, query) => {
    const { app } = createTestApp();
    const res = await app.request(`/bff/v0/patients?${query}`, {
      headers: bearer(TOKENS.frontDeskA),
    });

    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
    const body = (await res.json()) as ProblemDocument;
    expect(body.type).toBe('https://openrunic.org/problems/malformed-request');
    expect(body.errors?.length).toBeGreaterThan(0);
  });

  it('denies a principal whose roles grant no permissions', async () => {
    const { app } = createTestApp();
    const res = await app.request('/bff/v0/patients', { headers: bearer(UNPRIVILEGED_TOKEN) });

    expect(res.status).toBe(403);
    expect(((await res.json()) as ProblemDocument).detail).toContain('patient.read');
  });

  it('audits the denial as a failure', async () => {
    const { app, sink } = createTestApp();
    await app.request('/bff/v0/patients', { headers: bearer(UNPRIVILEGED_TOKEN) });

    expect(sink.writes()[0]?.event).toMatchObject({
      action: 'authorisation.denied',
      outcome: 'failure',
      metadata: { permission: 'patient.read' },
    });
  });
});

describe('GET /bff/v0/patients/:id', () => {
  it('reads one patient', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Patient', makePatientRow({ id: testId(1) }));

    const res = await app.request(`/bff/v0/patients/${testId(1)}`, {
      headers: bearer(TOKENS.clinicianA),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as PatientDto;
    expect(body).toMatchObject({
      id: testId(1),
      mrn: 'OR-100482',
      name: { given: 'Testina', family: 'Patientsson' },
      birthDate: '1994-03-02',
    });
  });

  it('emits a date of birth with no time component', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Patient', makePatientRow({ id: testId(1) }));

    const body = (await (
      await app.request(`/bff/v0/patients/${testId(1)}`, { headers: bearer(TOKENS.clinicianA) })
    ).json()) as PatientDto;

    expect(body.birthDate).toBe('1994-03-02');
    expect(body.createdAt).toMatch(/T.*Z$/);
  });

  it('404s an unknown id', async () => {
    const { app } = createTestApp();
    const res = await app.request(`/bff/v0/patients/${testId(77)}`, {
      headers: bearer(TOKENS.clinicianA),
    });

    expect(res.status).toBe(404);
  });

  it('400s an id that is not a UUID, without reaching the store', async () => {
    const { app } = createTestApp();
    const res = await app.request('/bff/v0/patients/12', { headers: bearer(TOKENS.clinicianA) });

    expect(res.status).toBe(400);
    expect(((await res.json()) as ProblemDocument).errors?.[0]?.path).toBe('id');
  });
});

describe('POST /bff/v0/patients', () => {
  it('registers a patient and points at it', async () => {
    const { app, dataset } = createTestApp();
    const res = await app.request('/bff/v0/patients', {
      method: 'POST',
      headers: jsonBearer(TOKENS.frontDeskA),
      body: JSON.stringify(VALID_BODY),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as PatientDto;
    expect(res.headers.get('location')).toBe(`/bff/v0/patients/${body.id}`);
    expect(dataset.table('Patient')).toHaveLength(1);
  });

  it('422s a body that parses but breaks the contract', async () => {
    const { app } = createTestApp();
    const res = await app.request('/bff/v0/patients', {
      method: 'POST',
      headers: jsonBearer(TOKENS.frontDeskA),
      body: JSON.stringify({ ...VALID_BODY, birthDate: 'not-a-date' }),
    });

    expect(res.status).toBe(422);
    const body = (await res.json()) as ProblemDocument;
    expect(body.type).toBe('https://openrunic.org/problems/validation-failed');
    expect(body.errors?.[0]?.path).toBe('birthDate');
  });

  it('422s an unexpected field rather than dropping it', async () => {
    const { app } = createTestApp();
    const res = await app.request('/bff/v0/patients', {
      method: 'POST',
      headers: jsonBearer(TOKENS.frontDeskA),
      body: JSON.stringify({ ...VALID_BODY, tenantId: testId(1) }),
    });

    expect(res.status).toBe(422);
  });

  it('400s a body that is not JSON at all', async () => {
    const { app } = createTestApp();
    const res = await app.request('/bff/v0/patients', {
      method: 'POST',
      headers: jsonBearer(TOKENS.frontDeskA),
      body: '{ not json',
    });

    expect(res.status).toBe(400);
  });

  it('409s a duplicate MRN', async () => {
    const { app } = createTestApp();
    const post = () =>
      app.request('/bff/v0/patients', {
        method: 'POST',
        headers: jsonBearer(TOKENS.frontDeskA),
        body: JSON.stringify(VALID_BODY),
      });

    expect((await post()).status).toBe(201);
    expect((await post()).status).toBe(409);
  });

  it('denies a role without patient.write', async () => {
    const { app } = createTestApp();
    const res = await app.request('/bff/v0/patients', {
      method: 'POST',
      headers: jsonBearer(TOKENS.billerA),
      body: JSON.stringify(VALID_BODY),
    });

    expect(res.status).toBe(403);
    expect(((await res.json()) as ProblemDocument).detail).toContain('patient.write');
  });
});

describe('PATCH /bff/v0/patients/:id', () => {
  it('amends the fields it was given and leaves the rest alone', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Patient', makePatientRow({ id: testId(1) }));

    const res = await app.request(`/bff/v0/patients/${testId(1)}`, {
      method: 'PATCH',
      headers: jsonBearer(TOKENS.frontDeskA),
      body: JSON.stringify({ preferredName: 'Tess' }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as PatientDto;
    expect(body.name).toMatchObject({ preferred: 'Tess', family: 'Patientsson' });
  });

  it('refuses to reassign the MRN', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Patient', makePatientRow({ id: testId(1) }));

    const res = await app.request(`/bff/v0/patients/${testId(1)}`, {
      method: 'PATCH',
      headers: jsonBearer(TOKENS.frontDeskA),
      body: JSON.stringify({ mrn: 'OR-999999' }),
    });

    expect(res.status).toBe(422);
    expect(dataset.table('Patient')[0]?.mrn).toBe('OR-100482');
  });

  it('404s an unknown id', async () => {
    const { app } = createTestApp();
    const res = await app.request(`/bff/v0/patients/${testId(77)}`, {
      method: 'PATCH',
      headers: jsonBearer(TOKENS.frontDeskA),
      body: JSON.stringify({ preferredName: 'Tess' }),
    });

    expect(res.status).toBe(404);
  });
});

describe('audit', () => {
  it('emits one batched read event per request, not one per row', async () => {
    const { app, dataset, sink } = createTestApp();
    seedPatients(dataset, 5);

    await app.request('/bff/v0/patients', { headers: bearer(TOKENS.frontDeskA) });

    expect(sink.reads()).toHaveLength(1);
    expect(sink.reads()[0]?.event.metadata.targetCount).toBe(5);
  });

  it('records a create as a transactional write plus the read of what it returned', async () => {
    const { app, sink } = createTestApp();
    await app.request('/bff/v0/patients', {
      method: 'POST',
      headers: jsonBearer(TOKENS.frontDeskA),
      body: JSON.stringify(VALID_BODY),
    });

    expect(sink.writes()).toHaveLength(1);
    expect(sink.writes()[0]).toMatchObject({
      transactional: true,
      event: { action: 'patient.created', actorId: '01890000-0000-7000-8000-000000000102' },
    });
  });
});
