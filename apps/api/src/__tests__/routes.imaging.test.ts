import type { Bundle } from '@openrunic/fhir';
import { describe, expect, it } from 'vitest';

import type { ImagingStudyDto } from '../schemas/orders.js';

import {
  bearer,
  createTestApp,
  jsonBearer,
  makePatientRow,
  seed,
  storageColumns,
  testId,
  TOKENS,
  UNPRIVILEGED_TOKEN,
} from './support.js';

/**
 * Imaging studies: the record that pictures exist.
 *
 * The property running through all of this is that openrunic is not a PACS. It
 * knows a study happened, ties it to the order and the chart, and can point a
 * viewer at it. It holds no images, and there is no field it could hold them
 * in.
 */

const PATIENT = testId(1);
const STUDY = testId(80);
const UID = '1.2.840.113619.2.55.3.604688119.868.1234567890.1';

function studyRow(overrides: Record<string, unknown> = {}) {
  return {
    ...storageColumns(STUDY),
    patientId: PATIENT,
    encounterId: null,
    serviceRequestId: null,
    diagnosticReportId: null,
    studyInstanceUid: UID,
    accessionNumber: 'ACC-100482',
    modalities: ['CT'],
    description: 'CT chest with contrast',
    status: 'AVAILABLE' as const,
    startedAt: new Date('2026-06-01T10:15:00.000Z'),
    numberOfSeries: 4,
    numberOfInstances: 512,
    retrieveUrl: 'https://pacs.example.invalid/dicomweb/studies/1.2.840',
    ...overrides,
  };
}

function harness(): ReturnType<typeof createTestApp> {
  const created = createTestApp();
  seed(created.dataset, 'Patient', makePatientRow({ id: PATIENT }));
  seed(created.dataset, 'ImagingStudy', studyRow());
  return created;
}

const VALID_STUDY = {
  patientId: PATIENT,
  studyInstanceUid: '1.2.840.113619.2.55.3.604688119.868.9999999999.9',
  modalities: ['MR'],
  startedAt: '2026-07-01T09:00:00.000Z',
};

async function post(
  app: ReturnType<typeof createTestApp>['app'],
  body: unknown,
  token: string = TOKENS.adminA
): Promise<Response> {
  return app.request('/bff/v0/imaging/studies', {
    method: 'POST',
    headers: jsonBearer(token),
    body: JSON.stringify(body),
  });
}

describe('recording that a study exists', () => {
  it('records one, with the identifiers a viewer and a PACS both need', async () => {
    const { app } = harness();

    const res = await post(app, {
      ...VALID_STUDY,
      accessionNumber: 'ACC-2',
      retrieveUrl: 'https://pacs.example.invalid/dicomweb/studies/1.2.840.9',
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as ImagingStudyDto;
    expect(body).toMatchObject({ accessionNumber: 'ACC-2', modalities: ['MR'] });
  });

  it('refuses a study instance UID that is not a DICOM UID', async () => {
    const { app } = harness();

    // The UID is the study's identity and is unique per organisation. A
    // malformed one creates a row nothing arriving from a PACS will ever match,
    // and the study looks recorded.
    const res = await post(app, { ...VALID_STUDY, studyInstanceUid: 'not-a-uid' });

    expect(res.status).toBe(422);
  });

  it('refuses a study with no modality', async () => {
    const { app } = harness();

    // A study with no modality cannot be routed to a reading list.
    const res = await post(app, { ...VALID_STUDY, modalities: [] });

    expect(res.status).toBe(422);
  });

  it('has nowhere to put image data, and refuses one that tries', async () => {
    const { app } = harness();

    // The schema is strict, so a field that does not exist is a rejection
    // rather than a silently dropped value. That is the guarantee: there is no
    // column for pixels and no way to smuggle them in.
    const res = await post(app, { ...VALID_STUDY, pixelData: 'AAAA' });

    expect(res.status).toBe(422);
  });

  it('never carries image data on the way out', async () => {
    const { app } = harness();

    const body = await (
      await app.request(`/bff/v0/imaging/studies/${STUDY}`, { headers: bearer(TOKENS.adminA) })
    ).text();

    expect(body).not.toContain('data:');
    expect(body).not.toContain('base64');
  });

  it('starts a study with no report, whatever the caller sends', async () => {
    const { app } = harness();

    // A study arriving from a modality has not been read yet, and a caller
    // asserting otherwise would attach a report that does not exist.
    const body = (await (await post(app, VALID_STUDY)).json()) as ImagingStudyDto;

    expect(body.diagnosticReportId).toBeNull();
  });

  it('refuses a principal who may not write results', async () => {
    const { app } = harness();

    expect((await post(app, VALID_STUDY, UNPRIVILEGED_TOKEN)).status).toBe(403);
  });
});

describe('finding a study again', () => {
  it('finds it by the accession number the order and the PACS share', async () => {
    const { app } = harness();

    const res = await app.request('/bff/v0/imaging/studies?accessionNumber=ACC-100482', {
      headers: bearer(TOKENS.adminA),
    });

    expect(((await res.json()) as { data: ImagingStudyDto[] }).data).toHaveLength(1);
  });

  it('finds it by study instance UID', async () => {
    const { app } = harness();

    const res = await app.request(`/bff/v0/imaging/studies?studyInstanceUid=${UID}`, {
      headers: bearer(TOKENS.adminA),
    });

    expect(((await res.json()) as { data: ImagingStudyDto[] }).data).toHaveLength(1);
  });

  it('narrows to the unread list', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Patient', makePatientRow({ id: PATIENT }));
    seed(
      dataset,
      'ImagingStudy',
      studyRow(),
      studyRow({
        ...storageColumns(testId(81)),
        studyInstanceUid: `${UID}.2`,
        status: 'REGISTERED',
      })
    );

    const res = await app.request('/bff/v0/imaging/studies?status=REGISTERED', {
      headers: bearer(TOKENS.adminA),
    });

    expect(((await res.json()) as { data: ImagingStudyDto[] }).data).toHaveLength(1);
  });
});

describe('the FHIR resource', () => {
  it('serves the study, with the UID as an identifier', async () => {
    const { app } = harness();

    const res = await app.request(`/fhir/ImagingStudy/${STUDY}`, {
      headers: bearer(TOKENS.adminA),
    });

    expect(res.status).toBe(200);
    const resource = (await res.json()) as fhir4.ImagingStudy;
    expect(resource.resourceType).toBe('ImagingStudy');
    // The resource id is this system's; the UID is DICOM's.
    expect(resource.id).toBe(STUDY);
    expect(resource.identifier?.[0]?.value).toBe(`urn:oid:${UID}`);
  });

  it('searches by accession number', async () => {
    const { app } = harness();

    const res = await app.request('/fhir/ImagingStudy?accession=ACC-100482', {
      headers: bearer(TOKENS.adminA),
    });

    expect(((await res.json()) as Bundle).total).toBe(1);
  });

  it('describes no series it has not seen', async () => {
    const { app } = harness();

    const resource = (await (
      await app.request(`/fhir/ImagingStudy/${STUDY}`, { headers: bearer(TOKENS.adminA) })
    ).json()) as fhir4.ImagingStudy;

    // openrunic is not a PACS. It carries counts and an endpoint; a consumer
    // that needs series-level detail asks the PACS by study UID.
    expect(resource.series).toBeUndefined();
    expect(resource).toMatchObject({ numberOfSeries: 4, numberOfInstances: 512 });
  });

  it('refuses a principal who may not read results', async () => {
    const { app } = harness();

    const res = await app.request(`/fhir/ImagingStudy/${STUDY}`, {
      headers: bearer(UNPRIVILEGED_TOKEN),
    });

    expect(res.status).toBe(403);
  });
});
