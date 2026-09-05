import type { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import type { Principal } from '../auth/principal.js';
import { createStaticPrincipalResolver, DEMO_PRINCIPALS } from '../auth/static-resolver.js';
import type { AppEnv } from '../context.js';
import type { ProblemDocument } from '../http/problem.js';
import type { MemoryDataset } from '../repositories/memory.js';
import {
  diagnosticReportSpec,
  documentSpec,
  messageSpec,
  messageThreadSpec,
  resultObservationSpec,
  serviceRequestSpec,
  specimenSpec,
  taskSpec,
  type DiagnosticReportRow,
  type DocumentRow,
  type MessageRow,
  type MessageThreadRow,
  type ResultObservationRow,
  type ServiceRequestRow,
  type SpecimenRow,
  type TaskRow,
} from '../repositories/specs/orders.js';
import { orderRouteContracts } from '../routes/orders.js';
import type {
  DiagnosticReportDto,
  DocumentDto,
  MessageDto,
  MessageThreadDto,
  ResultObservationDto,
  ServiceRequestDto,
  SpecimenDto,
  TaskDto,
} from '../schemas/orders.js';
import type { ListResponse } from '../schemas/pagination.js';

import {
  bearer,
  createTestApp,
  DEMO_FACILITY_A,
  DEMO_TENANT_A,
  FIXED_NOW,
  jsonBearer,
  seed,
  seedCareRelationship,
  storageColumns,
  testId,
  TOKENS,
  UNPRIVILEGED_TOKEN,
} from './support.js';

/**
 * Orders, results, documents, the typed inbox and messaging, driven through
 * `app.request()` against the in-memory store.
 *
 * Nothing here stubs a repository. The rows go into the same arrays the
 * production code path reads, so what these tests prove is the behaviour of the
 * real handlers, the real specs and the real audit collector - the only thing
 * swapped out is Postgres, and the `where`-clause half of each spec, which
 * Postgres would be the one to evaluate, is asserted directly at the bottom of
 * the file.
 *
 * Synthetic data only: Testina Patientsson, MRN OR-100482, a `.invalid`
 * reference lab and `+1555` numbers. Nothing here should be mistaken for a real
 * person if it ends up in a log.
 */

/* ------------------------------------------------------------------ fixtures */

/** The chart the demo portal token is pinned to, so the compartment is testable. */
const PATIENT = testId(1);
const OTHER_PATIENT = testId(2);
const ENCOUNTER = testId(50);
const OTHER_ENCOUNTER = testId(51);
/** The demo clinician's subject, which is what a sign-off should record. */
const CLINICIAN = '01890000-0000-7000-8000-000000000101';

let relSeq = 9000;
function authorise(
  dataset: Parameters<typeof seedCareRelationship>[0],
  ...patientIds: readonly string[]
): void {
  for (const patientId of patientIds) {
    relSeq += 1;
    seedCareRelationship(dataset, {
      patientId,
      providerId: CLINICIAN,
      as: 'appointment',
      id: testId(relSeq),
    });
  }
}
const OTHER_USER = testId(902);

const ORDER_A = testId(200);
const ORDER_B = testId(201);
const SPECIMEN_A = testId(210);
const SPECIMEN_B = testId(211);
const REPORT_A = testId(220);
const REPORT_B = testId(221);
const OBSERVATION_A = testId(230);
const DOCUMENT_A = testId(240);
const DOCUMENT_B = testId(241);
const TASK_A = testId(250);
const TASK_B = testId(251);
const THREAD_A = testId(260);
const THREAD_B = testId(261);
const MESSAGE_A = testId(270);

const EARLY = new Date('2026-08-10T08:00:00.000Z');
const LATE = new Date('2026-08-20T08:00:00.000Z');

function makeOrderRow(overrides: Partial<ServiceRequestRow> = {}): ServiceRequestRow {
  return {
    ...storageColumns(ORDER_A),
    patientId: PATIENT,
    encounterId: null,
    orderedById: CLINICIAN,
    category: 'LAB',
    status: 'DRAFT',
    intent: 'ORDER',
    priority: 'ROUTINE',
    code: '58410-2',
    codeSystem: 'http://loinc.org',
    display: 'CBC panel',
    specimenTypeCode: null,
    reasonCodes: [],
    aoeAnswers: null,
    note: null,
    requisitionNumber: null,
    performingLabName: null,
    labRef: null,
    requestedAt: EARLY,
    scheduledFor: null,
    transmittedAt: null,
    ...overrides,
  };
}

function makeSpecimenRow(overrides: Partial<SpecimenRow> = {}): SpecimenRow {
  return {
    ...storageColumns(SPECIMEN_A),
    patientId: PATIENT,
    serviceRequestId: ORDER_A,
    status: 'AVAILABLE',
    accessionNumber: null,
    typeCode: '119297000',
    typeDisplay: 'Blood specimen',
    collectionMethodCode: null,
    bodySiteCode: null,
    collectedAt: EARLY,
    collectedById: CLINICIAN,
    receivedAt: null,
    containerType: null,
    volumeValue: null,
    volumeUnit: null,
    rejectionReason: null,
    note: null,
    ...overrides,
  };
}

function makeReportRow(overrides: Partial<DiagnosticReportRow> = {}): DiagnosticReportRow {
  return {
    ...storageColumns(REPORT_A),
    patientId: PATIENT,
    encounterId: null,
    serviceRequestId: ORDER_A,
    specimenId: null,
    status: 'FINAL',
    category: 'LAB',
    code: '58410-2',
    codeSystem: 'http://loinc.org',
    display: 'CBC panel',
    performingLabName: null,
    abnormalFlag: 'NORMAL',
    narrative: null,
    rawStorageKey: null,
    effectiveAt: null,
    issuedAt: EARLY,
    reviewedById: null,
    reviewedAt: null,
    ...overrides,
  };
}

function makeObservationRow(overrides: Partial<ResultObservationRow> = {}): ResultObservationRow {
  return {
    ...storageColumns(OBSERVATION_A),
    diagnosticReportId: REPORT_A,
    patientId: PATIENT,
    status: 'FINAL',
    sequence: 0,
    loincCode: '718-7',
    code: '718-7',
    codeSystem: 'http://loinc.org',
    display: 'Haemoglobin',
    valueNumber: 11.2,
    valueText: null,
    valueCode: null,
    unit: 'g/dL',
    referenceLow: 12,
    referenceHigh: 16,
    referenceRangeText: null,
    interpretationCode: null,
    abnormalFlag: 'ABNORMAL',
    effectiveAt: EARLY,
    ...overrides,
  };
}

function makeDocumentRow(overrides: Partial<DocumentRow> = {}): DocumentRow {
  return {
    ...storageColumns(DOCUMENT_A),
    patientId: PATIENT,
    encounterId: null,
    category: '11488-4',
    title: 'Consult note',
    storageKey: 'documents/consult-note.pdf',
    contentType: 'application/pdf',
    sha256: 'a'.repeat(64),
    byteSize: 20_480,
    source: 'FAX',
    status: 'INBOX',
    sensitivityClass: 'NORMAL',
    receivedAt: EARLY,
    filedAt: null,
    filedById: null,
    expiresAt: null,
    supersededById: null,
    errorReason: null,
    ...overrides,
  };
}

function makeTaskRow(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    ...storageColumns(TASK_A),
    type: 'RESULT',
    status: 'OPEN',
    priority: 'NORMAL',
    patientId: PATIENT,
    encounterId: null,
    subjectType: 'DiagnosticReport',
    subjectId: REPORT_A,
    title: 'Review the CBC panel',
    description: null,
    assigneeType: 'USER',
    assigneeUserId: CLINICIAN,
    assigneeTeamKey: null,
    // Delegated by someone else, so the assigned-task source authorises the
    // assignee: a task with no recorded assigner no longer grants chart access.
    assignedById: OTHER_USER,
    dueAt: EARLY,
    slaState: 'OK',
    expiresAt: null,
    sourceEventId: null,
    completedAt: null,
    completedById: null,
    outcome: null,
    ...overrides,
  };
}

function makeThreadRow(overrides: Partial<MessageThreadRow> = {}): MessageThreadRow {
  return {
    ...storageColumns(THREAD_A),
    kind: 'PATIENT',
    patientId: PATIENT,
    subject: 'Question about my results',
    lastMessageAt: null,
    closedAt: null,
    ...overrides,
  };
}

function makeMessageRow(overrides: Partial<MessageRow> = {}): MessageRow {
  return {
    ...storageColumns(MESSAGE_A),
    threadId: THREAD_A,
    senderType: 'USER',
    senderUserId: CLINICIAN,
    senderPatientId: null,
    body: 'Your results look normal.',
    sentAt: EARLY,
    readAt: null,
    ...overrides,
  };
}

/* -------------------------------------------------------------- request help */

type Method = 'get' | 'post' | 'patch';

interface Harness {
  app: Hono<AppEnv>;
  dataset: MemoryDataset;
  sink: ReturnType<typeof createTestApp>['sink'];
}

async function call(
  app: Hono<AppEnv>,
  method: Method,
  path: string,
  options: { token?: string; body?: unknown } = {}
): Promise<Response> {
  const token = options.token ?? TOKENS.clinicianA;
  if (method === 'get') return app.request(path, { headers: bearer(token) });
  return app.request(path, {
    method: method.toUpperCase(),
    headers: jsonBearer(token),
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
}

async function body<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

async function problem(res: Response): Promise<ProblemDocument> {
  return body<ProblemDocument>(res);
}

/** Seeds one row of every aggregate, for the tests that only need a target id. */
function seededApp(): Harness {
  const harness = createTestApp();
  const { dataset } = harness;
  seed(dataset, 'ServiceRequest', makeOrderRow());
  seed(dataset, 'Specimen', makeSpecimenRow());
  seed(dataset, 'DiagnosticReport', makeReportRow());
  seed(dataset, 'ResultObservation', makeObservationRow());
  seed(dataset, 'Document', makeDocumentRow());
  seed(dataset, 'Task', makeTaskRow());
  seed(dataset, 'MessageThread', makeThreadRow());
  seed(dataset, 'Message', makeMessageRow());
  return harness;
}

const VALID_ORDER = {
  patientId: PATIENT,
  orderedById: CLINICIAN,
  code: '58410-2',
  codeSystem: 'http://loinc.org',
  display: 'CBC panel',
};

const FULL_ORDER = {
  ...VALID_ORDER,
  encounterId: ENCOUNTER,
  category: 'IMAGING',
  status: 'PENDED',
  intent: 'PLAN',
  priority: 'STAT',
  specimenTypeCode: '119297000',
  reasonCodes: ['R50.9'],
  aoeAnswers: { fasting: true },
  note: 'Fasting since 22:00 the night before.',
  requisitionNumber: 'REQ-000114',
  performingLabName: 'Testville Reference Lab',
  scheduledFor: '2026-08-14T09:00:00.000Z',
};

const VALID_SPECIMEN = {
  patientId: PATIENT,
  typeCode: '119297000',
  typeDisplay: 'Blood specimen',
};

const FULL_SPECIMEN = {
  ...VALID_SPECIMEN,
  serviceRequestId: ORDER_A,
  status: 'AVAILABLE',
  accessionNumber: 'ACC-000114',
  collectionMethodCode: '129300006',
  bodySiteCode: '368208006',
  collectedAt: '2026-08-12T08:00:00.000Z',
  collectedById: CLINICIAN,
  receivedAt: '2026-08-12T09:00:00.000Z',
  containerType: 'EDTA tube',
  volumeValue: 4.5,
  volumeUnit: 'mL',
  rejectionReason: 'Haemolysed on arrival.',
  note: 'Drawn from the left antecubital fossa.',
};

const FULL_ANALYTE = {
  sequence: 0,
  status: 'FINAL',
  loincCode: '718-7',
  code: '718-7',
  codeSystem: 'http://loinc.org',
  display: 'Haemoglobin',
  valueNumber: 11.2,
  valueText: 'below the reference range',
  valueCode: 'L',
  unit: 'g/dL',
  referenceLow: 12,
  referenceHigh: 16,
  referenceRangeText: '12-16 g/dL',
  interpretationCode: 'L',
  abnormalFlag: 'ABNORMAL',
  effectiveAt: '2026-08-12T10:00:00.000Z',
};

const MINIMAL_ANALYTE = {
  sequence: 1,
  code: '789-8',
  display: 'Erythrocytes',
  effectiveAt: '2026-08-12T10:00:00.000Z',
};

const VALID_REPORT = {
  patientId: PATIENT,
  code: '58410-2',
  display: 'CBC panel',
};

const FULL_REPORT = {
  ...VALID_REPORT,
  encounterId: ENCOUNTER,
  serviceRequestId: ORDER_A,
  specimenId: SPECIMEN_A,
  status: 'PRELIMINARY',
  category: 'LAB',
  codeSystem: 'http://loinc.org',
  performingLabName: 'Testville Reference Lab',
  abnormalFlag: 'ABNORMAL',
  narrative: 'Mild anaemia; correlate clinically.',
  rawStorageKey: 'results/raw/000114.hl7',
  effectiveAt: '2026-08-12T10:00:00.000Z',
  issuedAt: '2026-08-12T11:00:00.000Z',
  results: [FULL_ANALYTE, MINIMAL_ANALYTE],
};

const VALID_DOCUMENT = {
  category: '11488-4',
  title: 'Consult note',
  storageKey: 'documents/consult-note.pdf',
  contentType: 'application/pdf',
  sha256: 'b'.repeat(64),
  byteSize: 20_480,
};

const FULL_DOCUMENT = {
  ...VALID_DOCUMENT,
  patientId: PATIENT,
  encounterId: ENCOUNTER,
  source: 'FAX',
  status: 'INBOX',
  sensitivityClass: 'RESTRICTED',
  receivedAt: '2026-08-12T07:00:00.000Z',
  expiresAt: '2027-08-12T07:00:00.000Z',
};

const VALID_TASK = {
  type: 'RESULT',
  title: 'Review the CBC panel',
  assigneeType: 'USER',
  assigneeUserId: CLINICIAN,
} as const;

const FULL_TASK = {
  ...VALID_TASK,
  status: 'OPEN',
  priority: 'HIGH',
  patientId: PATIENT,
  encounterId: ENCOUNTER,
  subjectType: 'DiagnosticReport',
  subjectId: REPORT_A,
  description: 'Haemoglobin is below the reference range.',
  dueAt: '2026-08-14T09:00:00.000Z',
  slaState: 'AGING',
  expiresAt: '2026-09-14T09:00:00.000Z',
  sourceEventId: 'evt-000114',
};

/* -------------------------------------------------------------------- orders */

describe('GET /bff/v0/orders', () => {
  it('returns one page and the whole-set total', async () => {
    const { app, dataset } = createTestApp();
    authorise(dataset, PATIENT, OTHER_PATIENT);
    for (let index = 0; index < 30; index += 1) {
      seed(dataset, 'ServiceRequest', makeOrderRow({ id: testId(300 + index) }));
    }

    const res = await call(app, 'get', '/bff/v0/orders?page=2&pageSize=10');

    expect(res.status).toBe(200);
    const page = await body<ListResponse<ServiceRequestDto>>(res);
    expect(page.data).toHaveLength(10);
    expect(page.page).toEqual({ page: 2, pageSize: 10, total: 30, totalPages: 3 });
  });

  it('narrows by every filter it advertises', async () => {
    const { app, dataset } = createTestApp();
    authorise(dataset, PATIENT, OTHER_PATIENT);
    seed(
      dataset,
      'ServiceRequest',
      makeOrderRow(),
      makeOrderRow({
        id: ORDER_B,
        createdAt: LATE,
        patientId: OTHER_PATIENT,
        encounterId: OTHER_ENCOUNTER,
        orderedById: OTHER_USER,
        status: 'SIGNED',
        category: 'IMAGING',
        priority: 'STAT',
        requestedAt: LATE,
      })
    );
    const ids = async (query: string): Promise<string[]> =>
      (
        await body<ListResponse<ServiceRequestDto>>(
          await call(app, 'get', `/bff/v0/orders?${query}`)
        )
      ).data.map((row) => row.id);

    expect(await ids('')).toEqual([ORDER_A, ORDER_B]);
    expect(await ids(`patientId=${PATIENT}`)).toEqual([ORDER_A]);
    expect(await ids(`encounterId=${OTHER_ENCOUNTER}`)).toEqual([ORDER_B]);
    expect(await ids('status=SIGNED')).toEqual([ORDER_B]);
    expect(await ids('category=LAB')).toEqual([ORDER_A]);
    expect(await ids('priority=STAT')).toEqual([ORDER_B]);
    expect(await ids(`orderedById=${CLINICIAN}`)).toEqual([ORDER_A]);
    expect(await ids('from=2026-08-15T00:00:00.000Z')).toEqual([ORDER_B]);
    expect(await ids('to=2026-08-15T00:00:00.000Z')).toEqual([ORDER_A]);
    expect(await ids('sort=requestedAt&order=desc')).toEqual([ORDER_B, ORDER_A]);
    expect(await ids('sort=createdAt&order=desc')).toEqual([ORDER_B, ORDER_A]);
    expect(await ids('sort=scheduledFor')).toEqual([ORDER_A, ORDER_B]);
  });

  it('400s a filter name nobody declared', async () => {
    const { app } = createTestApp();
    const res = await call(app, 'get', '/bff/v0/orders?statuss=SIGNED');

    expect(res.status).toBe(400);
    expect((await problem(res)).type).toBe('https://openrunic.org/problems/malformed-request');
  });
});

describe('GET /bff/v0/orders/:id', () => {
  it('reads one order', async () => {
    const { app } = seededApp();
    const res = await call(app, 'get', `/bff/v0/orders/${ORDER_A}`);

    expect(res.status).toBe(200);
    expect(await body<ServiceRequestDto>(res)).toMatchObject({
      id: ORDER_A,
      status: 'DRAFT',
      code: '58410-2',
      aoeAnswers: null,
      requestedAt: EARLY.toISOString(),
      scheduledFor: null,
    });
  });

  it('404s an unknown id', async () => {
    const { app } = createTestApp();
    expect((await call(app, 'get', `/bff/v0/orders/${testId(999)}`)).status).toBe(404);
  });
});

describe('POST /bff/v0/orders', () => {
  it('records a minimal order on the schema defaults and points at it', async () => {
    const { app, dataset } = createTestApp();
    authorise(dataset, PATIENT, OTHER_PATIENT);
    const res = await call(app, 'post', '/bff/v0/orders', { body: VALID_ORDER });

    expect(res.status).toBe(201);
    const dto = await body<ServiceRequestDto>(res);
    expect(res.headers.get('location')).toBe(`/bff/v0/orders/${dto.id}`);
    expect(dto).toMatchObject({
      category: 'LAB',
      status: 'DRAFT',
      intent: 'ORDER',
      priority: 'ROUTINE',
      reasonCodes: [],
      aoeAnswers: null,
      labRef: null,
      transmittedAt: null,
      requestedAt: FIXED_NOW.toISOString(),
    });
    expect(dataset.table('ServiceRequest')).toHaveLength(1);
  });

  it('records every optional column a full order carries', async () => {
    const { app } = createTestApp();
    const dto = await body<ServiceRequestDto>(
      await call(app, 'post', '/bff/v0/orders', { body: FULL_ORDER })
    );

    expect(dto).toMatchObject({
      encounterId: ENCOUNTER,
      category: 'IMAGING',
      status: 'PENDED',
      intent: 'PLAN',
      priority: 'STAT',
      specimenTypeCode: '119297000',
      reasonCodes: ['R50.9'],
      aoeAnswers: { fasting: true },
      requisitionNumber: 'REQ-000114',
      performingLabName: 'Testville Reference Lab',
      scheduledFor: '2026-08-14T09:00:00.000Z',
    });
  });

  it('422s a body that parses but breaks the contract', async () => {
    const { app } = createTestApp();
    const res = await call(app, 'post', '/bff/v0/orders', {
      body: { ...VALID_ORDER, patientId: 'not-a-uuid' },
    });

    expect(res.status).toBe(422);
    expect((await problem(res)).errors?.[0]?.path).toBe('patientId');
  });
});

describe('PATCH /bff/v0/orders/:id', () => {
  it('amends the fields it was given and leaves the rest alone', async () => {
    const { app } = seededApp();
    const res = await call(app, 'patch', `/bff/v0/orders/${ORDER_A}`, {
      body: { priority: 'URGENT' },
    });

    expect(res.status).toBe(200);
    expect(await body<ServiceRequestDto>(res)).toMatchObject({
      priority: 'URGENT',
      status: 'DRAFT',
      display: 'CBC panel',
    });

    const second = await call(app, 'patch', `/bff/v0/orders/${ORDER_A}`, {
      body: { note: 'Patient ate breakfast.' },
    });
    expect(await body<ServiceRequestDto>(second)).toMatchObject({
      note: 'Patient ate breakfast.',
      priority: 'URGENT',
    });
  });

  it('amends every field the patch contract exposes', async () => {
    const { app } = seededApp();
    const dto = await body<ServiceRequestDto>(
      await call(app, 'patch', `/bff/v0/orders/${ORDER_A}`, {
        body: {
          priority: 'ASAP',
          specimenTypeCode: '119297000',
          reasonCodes: ['R50.9', 'D64.9'],
          aoeAnswers: { fasting: false },
          note: 'Patient ate breakfast.',
          requisitionNumber: 'REQ-000115',
          performingLabName: 'Testville Reference Lab',
          scheduledFor: '2026-08-15T09:00:00.000Z',
        },
      })
    );

    expect(dto).toMatchObject({
      priority: 'ASAP',
      reasonCodes: ['R50.9', 'D64.9'],
      aoeAnswers: { fasting: false },
      scheduledFor: '2026-08-15T09:00:00.000Z',
    });
  });

  it('refuses to move the status, which only a transition may do', async () => {
    const { app } = seededApp();
    const res = await call(app, 'patch', `/bff/v0/orders/${ORDER_A}`, {
      body: { status: 'TRANSMITTED' },
    });

    expect(res.status).toBe(422);
  });

  it('422s a patch that changes nothing', async () => {
    const { app } = seededApp();
    expect((await call(app, 'patch', `/bff/v0/orders/${ORDER_A}`, { body: {} })).status).toBe(422);
  });

  it('404s an unknown id', async () => {
    const { app } = createTestApp();
    const res = await call(app, 'patch', `/bff/v0/orders/${testId(999)}`, {
      body: { priority: 'STAT' },
    });

    expect(res.status).toBe(404);
  });
});

describe('the order state machine', () => {
  function orderApp(status: ServiceRequestRow['status']): Harness {
    const harness = createTestApp();
    seed(harness.dataset, 'ServiceRequest', makeOrderRow({ status }));
    return harness;
  }

  it.each([
    ['DRAFT', 'sign', 'SIGNED'],
    ['PENDED', 'sign', 'SIGNED'],
    ['SIGNED', 'transmit', 'TRANSMITTED'],
    ['DRAFT', 'cancel', 'CANCELLED'],
    ['TRANSMITTED', 'cancel', 'CANCELLED'],
    ['IN_PROGRESS', 'cancel', 'CANCELLED'],
  ] as const)('moves a %s order through /%s to %s', async (from, action, to) => {
    const { app } = orderApp(from);
    const res = await call(app, 'post', `/bff/v0/orders/${ORDER_A}/${action}`, { body: {} });

    expect(res.status).toBe(200);
    expect((await body<ServiceRequestDto>(res)).status).toBe(to);
  });

  it.each([
    ['SIGNED', 'sign'],
    ['CANCELLED', 'sign'],
    ['DRAFT', 'transmit'],
    ['TRANSMITTED', 'transmit'],
    ['COMPLETED', 'cancel'],
    ['CANCELLED', 'cancel'],
    ['ENTERED_IN_ERROR', 'cancel'],
  ] as const)('refuses /%2$s on a %1$s order with a typed 409', async (from, action) => {
    const { app } = orderApp(from);
    const res = await call(app, 'post', `/bff/v0/orders/${ORDER_A}/${action}`, { body: {} });

    expect(res.status).toBe(409);
    const document = await problem(res);
    expect(document.type).toBe('https://openrunic.org/problems/invalid-transition');
    expect(document.detail).toContain(from);
  });

  it('stamps transmittedAt when the order is transmitted', async () => {
    const { app } = orderApp('SIGNED');
    const dto = await body<ServiceRequestDto>(
      await call(app, 'post', `/bff/v0/orders/${ORDER_A}/transmit`, { body: {} })
    );

    expect(dto.transmittedAt).toMatch(/T.*Z$/);
  });

  it('accepts a transition with no request body at all', async () => {
    const { app } = orderApp('DRAFT');
    const res = await app.request(`/bff/v0/orders/${ORDER_A}/sign`, {
      method: 'POST',
      headers: bearer(TOKENS.clinicianA),
    });

    expect(res.status).toBe(200);
  });

  it('422s a transition body carrying a field the route does not read', async () => {
    const { app } = orderApp('DRAFT');
    const res = await call(app, 'post', `/bff/v0/orders/${ORDER_A}/sign`, {
      body: { status: 'COMPLETED' },
    });

    expect(res.status).toBe(422);
  });

  it('404s a transition on an unknown order', async () => {
    const { app } = createTestApp();
    const res = await call(app, 'post', `/bff/v0/orders/${testId(999)}/sign`, { body: {} });

    expect(res.status).toBe(404);
  });
});

/* ----------------------------------------------------------------- specimens */

describe('specimens', () => {
  it('narrows by every filter it advertises', async () => {
    const { app, dataset } = createTestApp();
    authorise(dataset, PATIENT, OTHER_PATIENT);
    seed(
      dataset,
      'Specimen',
      makeSpecimenRow({ accessionNumber: 'ACC-000114' }),
      makeSpecimenRow({
        id: SPECIMEN_B,
        createdAt: LATE,
        patientId: OTHER_PATIENT,
        serviceRequestId: ORDER_B,
        status: 'UNSATISFACTORY',
        accessionNumber: 'ACC-000115',
        rejectionReason: 'Haemolysed.',
        collectedAt: LATE,
      })
    );
    const ids = async (query: string): Promise<string[]> =>
      (
        await body<ListResponse<SpecimenDto>>(await call(app, 'get', `/bff/v0/specimens?${query}`))
      ).data.map((row) => row.id);

    expect(await ids('')).toEqual([SPECIMEN_A, SPECIMEN_B]);
    expect(await ids(`patientId=${PATIENT}`)).toEqual([SPECIMEN_A]);
    expect(await ids(`serviceRequestId=${ORDER_B}`)).toEqual([SPECIMEN_B]);
    expect(await ids('status=UNSATISFACTORY')).toEqual([SPECIMEN_B]);
    expect(await ids('accessionNumber=ACC-000114')).toEqual([SPECIMEN_A]);
    expect(await ids('sort=collectedAt&order=desc')).toEqual([SPECIMEN_B, SPECIMEN_A]);
    expect(await ids('sort=createdAt&order=desc')).toEqual([SPECIMEN_B, SPECIMEN_A]);
  });

  it('records a minimal specimen on the schema defaults', async () => {
    const { app } = createTestApp();
    const res = await call(app, 'post', '/bff/v0/specimens', { body: VALID_SPECIMEN });

    expect(res.status).toBe(201);
    expect(await body<SpecimenDto>(res)).toMatchObject({
      status: 'AVAILABLE',
      accessionNumber: null,
      collectedAt: null,
      volumeValue: null,
    });
  });

  it('records every optional column a full specimen carries', async () => {
    const { app } = createTestApp();
    const dto = await body<SpecimenDto>(
      await call(app, 'post', '/bff/v0/specimens', { body: FULL_SPECIMEN })
    );

    expect(dto).toMatchObject({
      serviceRequestId: ORDER_A,
      accessionNumber: 'ACC-000114',
      collectionMethodCode: '129300006',
      bodySiteCode: '368208006',
      collectedById: CLINICIAN,
      containerType: 'EDTA tube',
      volumeValue: 4.5,
      volumeUnit: 'mL',
      rejectionReason: 'Haemolysed on arrival.',
      note: 'Drawn from the left antecubital fossa.',
    });
  });

  it('409s a second specimen claiming the same accession number', async () => {
    const { app } = createTestApp();
    const post = (): Promise<Response> =>
      call(app, 'post', '/bff/v0/specimens', { body: FULL_SPECIMEN });

    expect((await post()).status).toBe(201);
    const clash = await post();
    expect(clash.status).toBe(409);
    expect((await problem(clash)).detail).toContain('ACC-000114');
  });

  it('lets two specimens exist without accession numbers', async () => {
    const { app } = createTestApp();
    const post = (): Promise<Response> =>
      call(app, 'post', '/bff/v0/specimens', { body: VALID_SPECIMEN });

    expect((await post()).status).toBe(201);
    expect((await post()).status).toBe(201);
  });

  it('amends every field the patch contract exposes', async () => {
    const { app } = seededApp();
    const dto = await body<SpecimenDto>(
      await call(app, 'patch', `/bff/v0/specimens/${SPECIMEN_A}`, {
        body: {
          accessionNumber: 'ACC-000116',
          collectionMethodCode: '129300006',
          bodySiteCode: '368208006',
          collectedAt: '2026-08-12T08:00:00.000Z',
          collectedById: OTHER_USER,
          containerType: 'EDTA tube',
          volumeValue: 3,
          volumeUnit: 'mL',
          note: 'Second attempt.',
        },
      })
    );

    expect(dto).toMatchObject({ accessionNumber: 'ACC-000116', volumeValue: 3 });

    // Two narrower patches, to prove an unnamed column keeps what it had.
    await call(app, 'patch', `/bff/v0/specimens/${SPECIMEN_A}`, {
      body: { accessionNumber: 'ACC-000117' },
    });
    const narrowed = await body<SpecimenDto>(
      await call(app, 'patch', `/bff/v0/specimens/${SPECIMEN_A}`, {
        body: { note: 'Third attempt.' },
      })
    );
    expect(narrowed).toMatchObject({
      accessionNumber: 'ACC-000117',
      note: 'Third attempt.',
      volumeValue: 3,
    });
  });

  it('422s a patch that changes nothing', async () => {
    const { app } = seededApp();
    const res = await call(app, 'patch', `/bff/v0/specimens/${SPECIMEN_A}`, { body: {} });

    expect(res.status).toBe(422);
  });

  it('receives a collected specimen and refuses an uncollected one', async () => {
    const { app, dataset } = createTestApp();
    authorise(dataset, PATIENT, OTHER_PATIENT);
    seed(
      dataset,
      'Specimen',
      makeSpecimenRow(),
      makeSpecimenRow({ id: SPECIMEN_B, collectedAt: null })
    );

    const received = await call(app, 'post', `/bff/v0/specimens/${SPECIMEN_A}/receive`, {
      body: {},
    });
    expect(received.status).toBe(200);
    expect((await body<SpecimenDto>(received)).receivedAt).toMatch(/T.*Z$/);

    const refused = await call(app, 'post', `/bff/v0/specimens/${SPECIMEN_B}/receive`, {
      body: {},
    });
    expect(refused.status).toBe(409);
    expect((await problem(refused)).type).toBe('https://openrunic.org/problems/conflict');
  });

  it('rejects an available specimen and refuses to reject it twice', async () => {
    const { app } = seededApp();
    const rejected = await call(app, 'post', `/bff/v0/specimens/${SPECIMEN_A}/reject`, {
      body: { rejectionReason: 'Haemolysed on arrival.' },
    });

    expect(rejected.status).toBe(200);
    expect(await body<SpecimenDto>(rejected)).toMatchObject({
      status: 'UNSATISFACTORY',
      rejectionReason: 'Haemolysed on arrival.',
    });

    const again = await call(app, 'post', `/bff/v0/specimens/${SPECIMEN_A}/reject`, {
      body: { rejectionReason: 'Haemolysed on arrival.' },
    });
    expect(again.status).toBe(409);
    expect((await problem(again)).type).toBe('https://openrunic.org/problems/invalid-transition');
  });

  it('422s a rejection with no reason, body or no body', async () => {
    const { app } = seededApp();
    const withBody = await call(app, 'post', `/bff/v0/specimens/${SPECIMEN_A}/reject`, {
      body: {},
    });
    const withoutBody = await app.request(`/bff/v0/specimens/${SPECIMEN_A}/reject`, {
      method: 'POST',
      headers: bearer(TOKENS.clinicianA),
    });

    expect(withBody.status).toBe(422);
    expect(withoutBody.status).toBe(422);
    expect((await problem(withoutBody)).errors?.[0]?.path).toBe('rejectionReason');
  });
});

/* ------------------------------------------------------------------- results */

describe('results', () => {
  it('narrows by every filter it advertises', async () => {
    const { app, dataset } = createTestApp();
    authorise(dataset, PATIENT, OTHER_PATIENT);
    seed(
      dataset,
      'DiagnosticReport',
      makeReportRow(),
      makeReportRow({
        id: REPORT_B,
        createdAt: LATE,
        patientId: OTHER_PATIENT,
        encounterId: OTHER_ENCOUNTER,
        serviceRequestId: ORDER_B,
        status: 'PRELIMINARY',
        category: 'IMAGING',
        abnormalFlag: 'CRITICAL',
        reviewedAt: EARLY,
        reviewedById: CLINICIAN,
        issuedAt: LATE,
        effectiveAt: LATE,
      })
    );
    const ids = async (query: string): Promise<string[]> =>
      (
        await body<ListResponse<DiagnosticReportDto>>(
          await call(app, 'get', `/bff/v0/results?${query}`)
        )
      ).data.map((row) => row.id);

    expect(await ids('')).toEqual([REPORT_A, REPORT_B]);
    expect(await ids(`patientId=${PATIENT}`)).toEqual([REPORT_A]);
    expect(await ids(`encounterId=${OTHER_ENCOUNTER}`)).toEqual([REPORT_B]);
    expect(await ids(`serviceRequestId=${ORDER_A}`)).toEqual([REPORT_A]);
    expect(await ids('status=PRELIMINARY')).toEqual([REPORT_B]);
    expect(await ids('category=IMAGING')).toEqual([REPORT_B]);
    expect(await ids('abnormalFlag=CRITICAL')).toEqual([REPORT_B]);
    expect(await ids('reviewed=false')).toEqual([REPORT_A]);
    expect(await ids('reviewed=true')).toEqual([REPORT_B]);
    expect(await ids('from=2026-08-15T00:00:00.000Z')).toEqual([REPORT_B]);
    expect(await ids('to=2026-08-15T00:00:00.000Z')).toEqual([REPORT_A]);
    expect(await ids('sort=issuedAt&order=desc')).toEqual([REPORT_B, REPORT_A]);
    // A report with no effective time sorts last ascending, the same rule a
    // task with no due date follows: absent is not the earliest, it is unknown.
    expect(await ids('sort=effectiveAt')).toEqual([REPORT_B, REPORT_A]);
    expect(await ids('sort=createdAt&order=desc')).toEqual([REPORT_B, REPORT_A]);
  });

  it('records a minimal report on the schema defaults', async () => {
    const { app } = createTestApp();
    const res = await call(app, 'post', '/bff/v0/results', { body: VALID_REPORT });

    expect(res.status).toBe(201);
    expect(await body<DiagnosticReportDto>(res)).toMatchObject({
      status: 'FINAL',
      category: 'LAB',
      codeSystem: 'http://loinc.org',
      abnormalFlag: 'NORMAL',
      effectiveAt: null,
      reviewedAt: null,
      reviewedById: null,
      issuedAt: FIXED_NOW.toISOString(),
    });
  });

  it('writes the analytes in the same call and reads them back from the nested route', async () => {
    const { app, dataset } = createTestApp();
    authorise(dataset, PATIENT, OTHER_PATIENT);
    const created = await body<DiagnosticReportDto>(
      await call(app, 'post', '/bff/v0/results', { body: FULL_REPORT })
    );

    // Written with the parent, not by a second request: the row is in the table
    // the moment the report exists.
    expect(dataset.table('ResultObservation')).toHaveLength(2);

    const res = await call(app, 'get', `/bff/v0/results/${created.id}/observations`);
    expect(res.status).toBe(200);
    const page = await body<ListResponse<ResultObservationDto>>(res);
    expect(page.page.total).toBe(2);
    expect(page.data.map((row) => row.sequence)).toEqual([0, 1]);
    expect(page.data[0]).toMatchObject({
      diagnosticReportId: created.id,
      patientId: PATIENT,
      loincCode: '718-7',
      valueNumber: 11.2,
      unit: 'g/dL',
      referenceLow: 12,
      referenceHigh: 16,
      abnormalFlag: 'ABNORMAL',
    });
    // The second analyte carried nothing optional, so it lands on the defaults.
    expect(page.data[1]).toMatchObject({
      status: 'FINAL',
      codeSystem: 'http://loinc.org',
      abnormalFlag: 'NORMAL',
      loincCode: null,
      valueNumber: null,
      unit: null,
    });
  });

  it('writes no analytes when the report carries none', async () => {
    const { app, dataset } = createTestApp();
    authorise(dataset, PATIENT, OTHER_PATIENT);
    await call(app, 'post', '/bff/v0/results', { body: VALID_REPORT });

    expect(dataset.table('ResultObservation')).toHaveLength(0);
  });

  it('sorts the analytes by sequence and pages them', async () => {
    const { app } = seededApp();
    const res = await call(
      app,
      'get',
      `/bff/v0/results/${REPORT_A}/observations?sort=effectiveAt&order=desc&pageSize=1`
    );

    expect(res.status).toBe(200);
    expect((await body<ListResponse<ResultObservationDto>>(res)).data).toHaveLength(1);
  });

  it('404s the nested analytes of a report that does not exist', async () => {
    const { app } = createTestApp();
    const res = await call(app, 'get', `/bff/v0/results/${testId(999)}/observations`);

    expect(res.status).toBe(404);
  });

  it('amends every field the patch contract exposes', async () => {
    const { app } = seededApp();
    const dto = await body<DiagnosticReportDto>(
      await call(app, 'patch', `/bff/v0/results/${REPORT_A}`, {
        body: {
          status: 'CORRECTED',
          category: 'IMAGING',
          display: 'CBC panel, corrected',
          performingLabName: 'Testville Reference Lab',
          abnormalFlag: 'CRITICAL',
          narrative: 'Corrected haemoglobin.',
          rawStorageKey: 'results/raw/000115.hl7',
          effectiveAt: '2026-08-13T10:00:00.000Z',
        },
      })
    );

    expect(dto).toMatchObject({
      status: 'CORRECTED',
      abnormalFlag: 'CRITICAL',
      effectiveAt: '2026-08-13T10:00:00.000Z',
    });

    await call(app, 'patch', `/bff/v0/results/${REPORT_A}`, { body: { status: 'AMENDED' } });
    const narrowed = await body<DiagnosticReportDto>(
      await call(app, 'patch', `/bff/v0/results/${REPORT_A}`, {
        body: { effectiveAt: '2026-08-14T10:00:00.000Z' },
      })
    );
    expect(narrowed).toMatchObject({
      status: 'AMENDED',
      abnormalFlag: 'CRITICAL',
      effectiveAt: '2026-08-14T10:00:00.000Z',
    });
  });

  it('422s a patch that changes nothing', async () => {
    const { app } = seededApp();
    expect((await call(app, 'patch', `/bff/v0/results/${REPORT_A}`, { body: {} })).status).toBe(
      422
    );
  });

  it('signs off a result once and refuses a second sign-off', async () => {
    const { app } = seededApp();
    const reviewed = await call(app, 'post', `/bff/v0/results/${REPORT_A}/review`, { body: {} });

    expect(reviewed.status).toBe(200);
    const dto = await body<DiagnosticReportDto>(reviewed);
    expect(dto.reviewedById).toBe(CLINICIAN);
    expect(dto.reviewedAt).toMatch(/T.*Z$/);

    const again = await call(app, 'post', `/bff/v0/results/${REPORT_A}/review`, { body: {} });
    expect(again.status).toBe(409);
    expect((await problem(again)).detail).toContain('already been reviewed');
  });

  it('refuses a sign-off from a service account holding the permission', async () => {
    const { app, dataset } = serviceApp();
    seed(dataset, 'DiagnosticReport', makeReportRow());

    const res = await call(app, 'post', `/bff/v0/results/${REPORT_A}/review`, {
      body: {},
      token: SERVICE_TOKEN,
    });

    expect(res.status).toBe(403);
    expect((await problem(res)).detail).toContain('signed-in user');
  });
});

/* ----------------------------------------------------------------- documents */

describe('documents', () => {
  it('narrows by every filter it advertises', async () => {
    const { app, dataset } = createTestApp();
    authorise(dataset, PATIENT, OTHER_PATIENT);
    seed(
      dataset,
      'Document',
      makeDocumentRow(),
      makeDocumentRow({
        id: DOCUMENT_B,
        createdAt: LATE,
        patientId: OTHER_PATIENT,
        encounterId: OTHER_ENCOUNTER,
        status: 'FILED',
        category: '34133-9',
        source: 'UPLOAD',
        title: 'Zebra summary',
        receivedAt: LATE,
      })
    );
    const ids = async (query: string): Promise<string[]> =>
      (
        await body<ListResponse<DocumentDto>>(await call(app, 'get', `/bff/v0/documents?${query}`))
      ).data.map((row) => row.id);

    expect(await ids('')).toEqual([DOCUMENT_A, DOCUMENT_B]);
    expect(await ids(`patientId=${PATIENT}`)).toEqual([DOCUMENT_A]);
    expect(await ids(`encounterId=${OTHER_ENCOUNTER}`)).toEqual([DOCUMENT_B]);
    expect(await ids('status=INBOX')).toEqual([DOCUMENT_A]);
    expect(await ids('category=34133-9')).toEqual([DOCUMENT_B]);
    expect(await ids('source=FAX')).toEqual([DOCUMENT_A]);
    expect(await ids('from=2026-08-15T00:00:00.000Z')).toEqual([DOCUMENT_B]);
    expect(await ids('to=2026-08-15T00:00:00.000Z')).toEqual([DOCUMENT_A]);
    expect(await ids('sort=receivedAt&order=desc')).toEqual([DOCUMENT_B, DOCUMENT_A]);
    expect(await ids('sort=title')).toEqual([DOCUMENT_A, DOCUMENT_B]);
    expect(await ids('sort=createdAt&order=desc')).toEqual([DOCUMENT_B, DOCUMENT_A]);
  });

  it('records a minimal document on the schema defaults', async () => {
    const { app } = createTestApp();
    const res = await call(app, 'post', '/bff/v0/documents', { body: VALID_DOCUMENT });

    expect(res.status).toBe(201);
    expect(await body<DocumentDto>(res)).toMatchObject({
      patientId: null,
      source: 'UPLOAD',
      status: 'INBOX',
      sensitivityClass: 'NORMAL',
      filedAt: null,
      filedById: null,
      expiresAt: null,
      receivedAt: FIXED_NOW.toISOString(),
    });
  });

  it('records every optional column a full document carries', async () => {
    const { app } = createTestApp();
    const dto = await body<DocumentDto>(
      await call(app, 'post', '/bff/v0/documents', { body: FULL_DOCUMENT })
    );

    expect(dto).toMatchObject({
      patientId: PATIENT,
      encounterId: ENCOUNTER,
      source: 'FAX',
      sensitivityClass: 'RESTRICTED',
      receivedAt: '2026-08-12T07:00:00.000Z',
      expiresAt: '2027-08-12T07:00:00.000Z',
    });
  });

  it('422s a digest that is not a lowercase hex SHA-256', async () => {
    const { app } = createTestApp();
    const res = await call(app, 'post', '/bff/v0/documents', {
      body: { ...VALID_DOCUMENT, sha256: 'NOTAHASH' },
    });

    expect(res.status).toBe(422);
    expect((await problem(res)).errors?.[0]?.path).toBe('sha256');
  });

  it('attaches an unfiled fax to a chart through the patch contract', async () => {
    const { app, dataset } = seededApp();
    // Re-filing touches two charts in turn, and amending a filed document needs
    // standing on the chart it is filed under at that moment.
    authorise(dataset, PATIENT, OTHER_PATIENT);
    const dto = await body<DocumentDto>(
      await call(app, 'patch', `/bff/v0/documents/${DOCUMENT_A}`, {
        body: {
          patientId: OTHER_PATIENT,
          encounterId: ENCOUNTER,
          category: '34133-9',
          title: 'Outside summary',
          sensitivityClass: 'RESTRICTED',
          expiresAt: '2027-08-12T07:00:00.000Z',
        },
      })
    );

    expect(dto).toMatchObject({
      patientId: OTHER_PATIENT,
      encounterId: ENCOUNTER,
      title: 'Outside summary',
      sensitivityClass: 'RESTRICTED',
      status: 'INBOX',
    });

    await call(app, 'patch', `/bff/v0/documents/${DOCUMENT_A}`, { body: { patientId: PATIENT } });
    const narrowed = await body<DocumentDto>(
      await call(app, 'patch', `/bff/v0/documents/${DOCUMENT_A}`, {
        body: { expiresAt: '2028-08-12T07:00:00.000Z' },
      })
    );
    expect(narrowed).toMatchObject({
      patientId: PATIENT,
      title: 'Outside summary',
      expiresAt: '2028-08-12T07:00:00.000Z',
    });
  });

  it('422s a patch that changes nothing', async () => {
    const { app } = seededApp();
    expect((await call(app, 'patch', `/bff/v0/documents/${DOCUMENT_A}`, { body: {} })).status).toBe(
      422
    );
  });

  it('files an inbox document once and refuses to file it again', async () => {
    const { app } = seededApp();
    const filed = await call(app, 'post', `/bff/v0/documents/${DOCUMENT_A}/file`, { body: {} });

    expect(filed.status).toBe(200);
    expect(await body<DocumentDto>(filed)).toMatchObject({
      status: 'FILED',
      filedById: CLINICIAN,
    });

    const again = await call(app, 'post', `/bff/v0/documents/${DOCUMENT_A}/file`, { body: {} });
    expect(again.status).toBe(409);
    expect((await problem(again)).type).toBe('https://openrunic.org/problems/invalid-transition');
  });

  it('refuses to file a document that belongs to no chart', async () => {
    const { app, dataset } = createTestApp();
    authorise(dataset, PATIENT, OTHER_PATIENT);
    seed(dataset, 'Document', makeDocumentRow({ patientId: null }));

    const res = await call(app, 'post', `/bff/v0/documents/${DOCUMENT_A}/file`, { body: {} });

    // The failure this guard exists for: filing used to take an empty body and
    // change only the status, so an unclaimed document left the triage queue
    // and arrived nowhere. It looked like success.
    expect(res.status).toBe(409);
    expect((await problem(res)).detail).toContain('needs a chart');
  });

  it('files an unclaimed document into the chart the filer names', async () => {
    const { app, dataset } = createTestApp();
    authorise(dataset, PATIENT, OTHER_PATIENT);
    seed(dataset, 'Document', makeDocumentRow({ patientId: null }));

    const res = await call(app, 'post', `/bff/v0/documents/${DOCUMENT_A}/file`, {
      body: { patientId: PATIENT, title: 'Cardiology consult', category: '11488-4' },
    });

    expect(res.status).toBe(200);
    expect(await body<DocumentDto>(res)).toMatchObject({
      status: 'FILED',
      patientId: PATIENT,
      // Corrected in the same request. A fax arrives titled by the sending
      // machine, and a filer who has to patch first and file second is a filer
      // who sometimes forgets the second.
      title: 'Cardiology consult',
    });
  });

  it('records which document replaced a superseded one', async () => {
    const { app, dataset } = createTestApp();
    authorise(dataset, PATIENT, OTHER_PATIENT);
    seed(
      dataset,
      'Document',
      makeDocumentRow(),
      makeDocumentRow({ id: DOCUMENT_B, sha256: 'b'.repeat(64) })
    );

    const res = await call(app, 'post', `/bff/v0/documents/${DOCUMENT_A}/supersede`, {
      body: { supersededById: DOCUMENT_B },
    });

    expect(res.status).toBe(200);
    // SUPERSEDED was in the transition graph from the start with no route to
    // reach it and nothing to say what had done the superseding.
    expect(await body<DocumentDto>(res)).toMatchObject({
      status: 'SUPERSEDED',
      supersededById: DOCUMENT_B,
    });
  });

  it('refuses to point a superseded document at nothing', async () => {
    const { app, dataset } = createTestApp();
    authorise(dataset, PATIENT, OTHER_PATIENT);
    seed(dataset, 'Document', makeDocumentRow());

    const res = await call(app, 'post', `/bff/v0/documents/${DOCUMENT_A}/supersede`, {
      body: { supersededById: testId(9_999) },
    });

    // Read back before the write, so a pointer into nothing is never stored.
    expect(res.status).toBe(404);
  });

  it('refuses to let a document supersede itself', async () => {
    const { app, dataset } = createTestApp();
    authorise(dataset, PATIENT, OTHER_PATIENT);
    seed(dataset, 'Document', makeDocumentRow());

    const res = await call(app, 'post', `/bff/v0/documents/${DOCUMENT_A}/supersede`, {
      body: { supersededById: DOCUMENT_A },
    });

    expect(res.status).toBe(422);
  });

  it('keeps the reason a document was rejected', async () => {
    const { app } = seededApp();

    const res = await call(app, 'post', `/bff/v0/documents/${DOCUMENT_A}/reject`, {
      body: { reason: 'Wrong patient: this is another practice\u2019s fax' },
    });

    expect(res.status).toBe(200);
    const rejected = await body<DocumentDto>(res);
    expect(rejected.status).toBe('ENTERED_IN_ERROR');
    // The audit trail records who and when. What it cannot record is what they
    // saw, and that is the part somebody asks about when a page is missing.
    expect(rejected.errorReason).toContain('Wrong patient');
  });

  it('refuses a rejection with no reason', async () => {
    const { app } = seededApp();

    const res = await call(app, 'post', `/bff/v0/documents/${DOCUMENT_A}/reject`, { body: {} });

    expect(res.status).toBe(422);
  });

  it('refuses bytes this organisation already holds, naming what it holds', async () => {
    const { app } = seededApp();

    const res = await call(app, 'post', '/bff/v0/documents', {
      body: { ...VALID_DOCUMENT, sha256: 'a'.repeat(64) },
    });

    // A fax that arrives twice is one document. The second copy looks exactly
    // like new work, and whoever triages it files a duplicate into a chart,
    // where it reads as a second result rather than the same one seen twice.
    expect(res.status).toBe(409);
    expect((await problem(res)).detail).toContain(DOCUMENT_A);
  });

  it.each(['SUPERSEDED', 'ENTERED_IN_ERROR'] as const)(
    'allows the same bytes again once the earlier copy is %s',
    async (status) => {
      const { app, dataset } = createTestApp();
      authorise(dataset, PATIENT, OTHER_PATIENT);
      seed(dataset, 'Document', makeDocumentRow({ status }));

      const res = await call(app, 'post', '/bff/v0/documents', {
        body: { ...VALID_DOCUMENT, sha256: 'a'.repeat(64) },
      });

      // Re-uploading is how somebody fixes a mistake. Refusing it would leave
      // them with a chart they cannot correct.
      expect(res.status).toBe(201);
    }
  );

  it('finds an existing document by its digest', async () => {
    const { app } = seededApp();

    const res = await call(app, 'get', `/bff/v0/documents?sha256=${'a'.repeat(64)}`);

    expect(res.status).toBe(200);
    expect((await body<{ data: DocumentDto[] }>(res)).data).toHaveLength(1);
  });
});

/* --------------------------------------------------------------------- tasks */

describe('tasks', () => {
  it('narrows by every filter the typed inbox advertises', async () => {
    const { app, dataset } = createTestApp();
    authorise(dataset, PATIENT, OTHER_PATIENT);
    seed(
      dataset,
      'Task',
      makeTaskRow(),
      makeTaskRow({
        id: TASK_B,
        createdAt: LATE,
        type: 'FAX',
        status: 'IN_PROGRESS',
        priority: 'URGENT',
        patientId: OTHER_PATIENT,
        assigneeType: 'TEAM',
        assigneeUserId: null,
        assigneeTeamKey: 'front-desk',
        slaState: 'BREACH',
        dueAt: LATE,
      })
    );
    const ids = async (query: string): Promise<string[]> =>
      (
        await body<ListResponse<TaskDto>>(await call(app, 'get', `/bff/v0/tasks?${query}`))
      ).data.map((row) => row.id);

    expect(await ids('')).toEqual([TASK_A, TASK_B]);
    expect(await ids('type=RESULT')).toEqual([TASK_A]);
    expect(await ids('status=IN_PROGRESS')).toEqual([TASK_B]);
    expect(await ids('priority=URGENT')).toEqual([TASK_B]);
    expect(await ids(`patientId=${PATIENT}`)).toEqual([TASK_A]);
    expect(await ids(`assigneeUserId=${CLINICIAN}`)).toEqual([TASK_A]);
    expect(await ids('assigneeTeamKey=front-desk')).toEqual([TASK_B]);
    expect(await ids('slaState=BREACH')).toEqual([TASK_B]);
    expect(await ids('from=2026-08-15T00:00:00.000Z')).toEqual([TASK_B]);
    expect(await ids('to=2026-08-15T00:00:00.000Z')).toEqual([TASK_A]);
    expect(await ids('sort=dueAt&order=desc')).toEqual([TASK_B, TASK_A]);
    expect(await ids('sort=priority')).toEqual([TASK_A, TASK_B]);
    expect(await ids('sort=createdAt&order=desc')).toEqual([TASK_B, TASK_A]);
  });

  it('sorts a task with no due date last rather than first', async () => {
    const { app, dataset } = createTestApp();
    authorise(dataset, PATIENT, OTHER_PATIENT);
    seed(
      dataset,
      'Task',
      makeTaskRow({ id: TASK_B, dueAt: null }),
      makeTaskRow({ id: TASK_A, dueAt: LATE })
    );

    const page = await body<ListResponse<TaskDto>>(await call(app, 'get', '/bff/v0/tasks'));
    expect(page.data.map((row) => row.id)).toEqual([TASK_A, TASK_B]);
  });

  it('records a minimal task on the schema defaults', async () => {
    const { app } = createTestApp();
    const res = await call(app, 'post', '/bff/v0/tasks', { body: VALID_TASK });

    expect(res.status).toBe(201);
    expect(await body<TaskDto>(res)).toMatchObject({
      status: 'OPEN',
      priority: 'NORMAL',
      slaState: 'OK',
      patientId: null,
      dueAt: null,
      sourceEventId: null,
      completedAt: null,
      outcome: null,
    });
  });

  it('records every optional column a full task carries', async () => {
    const { app } = createTestApp();
    const dto = await body<TaskDto>(await call(app, 'post', '/bff/v0/tasks', { body: FULL_TASK }));

    expect(dto).toMatchObject({
      priority: 'HIGH',
      patientId: PATIENT,
      encounterId: ENCOUNTER,
      subjectType: 'DiagnosticReport',
      subjectId: REPORT_A,
      slaState: 'AGING',
      sourceEventId: 'evt-000114',
    });
  });

  it('records a task assigned to a team pool rather than a person', async () => {
    const { app } = createTestApp();
    const dto = await body<TaskDto>(
      await call(app, 'post', '/bff/v0/tasks', {
        body: {
          ...VALID_TASK,
          assigneeType: 'TEAM',
          assigneeUserId: undefined,
          assigneeTeamKey: 'front-desk',
        },
      })
    );

    expect(dto).toMatchObject({
      assigneeType: 'TEAM',
      assigneeUserId: null,
      assigneeTeamKey: 'front-desk',
    });
  });

  it('409s a second task for the same source event and type', async () => {
    const { app } = createTestApp();
    const post = (): Promise<Response> => call(app, 'post', '/bff/v0/tasks', { body: FULL_TASK });

    expect((await post()).status).toBe(201);
    const clash = await post();
    expect(clash.status).toBe(409);
    expect((await problem(clash)).detail).toContain('evt-000114');
  });

  it('lets the same source event raise a task of another type', async () => {
    const { app } = createTestApp();

    expect((await call(app, 'post', '/bff/v0/tasks', { body: FULL_TASK })).status).toBe(201);
    expect(
      (await call(app, 'post', '/bff/v0/tasks', { body: { ...FULL_TASK, type: 'COSIGN' } })).status
    ).toBe(201);
  });

  it('lets two tasks exist without a source event', async () => {
    const { app } = createTestApp();
    const post = (): Promise<Response> => call(app, 'post', '/bff/v0/tasks', { body: VALID_TASK });

    expect((await post()).status).toBe(201);
    expect((await post()).status).toBe(201);
  });

  it('422s a task naming an assignee its type does not use', async () => {
    const { app } = createTestApp();
    const res = await call(app, 'post', '/bff/v0/tasks', {
      body: { ...VALID_TASK, assigneeType: 'TEAM' },
    });

    expect(res.status).toBe(422);
  });

  it('reassigns to a team and clears the user column', async () => {
    const { app } = seededApp();
    const dto = await body<TaskDto>(
      await call(app, 'patch', `/bff/v0/tasks/${TASK_A}`, {
        body: { assigneeType: 'TEAM', assigneeTeamKey: 'front-desk' },
      })
    );

    expect(dto).toMatchObject({ assigneeTeamKey: 'front-desk', assigneeUserId: null });
  });

  it('reassigns to a user and clears the team column', async () => {
    const { app, dataset } = createTestApp();
    authorise(dataset, PATIENT, OTHER_PATIENT);
    seed(
      dataset,
      'Task',
      makeTaskRow({ assigneeType: 'TEAM', assigneeUserId: null, assigneeTeamKey: 'front-desk' })
    );

    const dto = await body<TaskDto>(
      await call(app, 'patch', `/bff/v0/tasks/${TASK_A}`, {
        body: { assigneeType: 'USER', assigneeUserId: OTHER_USER },
      })
    );

    expect(dto).toMatchObject({ assigneeUserId: OTHER_USER, assigneeTeamKey: null });
  });

  it('422s a reassignment that names no assignee for its new type', async () => {
    const { app } = seededApp();
    const res = await call(app, 'patch', `/bff/v0/tasks/${TASK_A}`, {
      body: { assigneeType: 'TEAM' },
    });

    expect(res.status).toBe(422);
  });

  it('amends every other field the patch contract exposes', async () => {
    const { app } = seededApp();
    const dto = await body<TaskDto>(
      await call(app, 'patch', `/bff/v0/tasks/${TASK_A}`, {
        body: {
          priority: 'URGENT',
          title: 'Review the corrected CBC panel',
          description: 'Haemoglobin was restated.',
          dueAt: '2026-08-15T09:00:00.000Z',
          slaState: 'AGING',
          expiresAt: '2026-09-15T09:00:00.000Z',
        },
      })
    );

    expect(dto).toMatchObject({
      priority: 'URGENT',
      title: 'Review the corrected CBC panel',
      slaState: 'AGING',
      dueAt: '2026-08-15T09:00:00.000Z',
    });
  });

  it('422s a patch that changes nothing', async () => {
    const { app } = seededApp();
    expect((await call(app, 'patch', `/bff/v0/tasks/${TASK_A}`, { body: {} })).status).toBe(422);
  });

  it.each([
    ['OPEN', 'complete', 'DONE'],
    ['IN_PROGRESS', 'complete', 'DONE'],
    ['ON_HOLD', 'complete', 'DONE'],
    ['OPEN', 'cancel', 'CANCELLED'],
    ['IN_PROGRESS', 'cancel', 'CANCELLED'],
    ['ON_HOLD', 'cancel', 'CANCELLED'],
  ] as const)('moves a %s task through /%s to %s', async (from, action, to) => {
    const { app, dataset } = createTestApp();
    authorise(dataset, PATIENT, OTHER_PATIENT);
    seed(dataset, 'Task', makeTaskRow({ status: from }));

    const res = await call(app, 'post', `/bff/v0/tasks/${TASK_A}/${action}`, { body: {} });

    expect(res.status).toBe(200);
    expect(await body<TaskDto>(res)).toMatchObject({
      status: to,
      completedById: CLINICIAN,
      outcome: null,
    });
  });

  it.each([
    ['DONE', 'complete'],
    ['CANCELLED', 'complete'],
    ['EXPIRED', 'complete'],
    ['DONE', 'cancel'],
    ['CANCELLED', 'cancel'],
    ['EXPIRED', 'cancel'],
  ] as const)('refuses /%2$s on a %1$s task with a typed 409', async (from, action) => {
    const { app, dataset } = createTestApp();
    authorise(dataset, PATIENT, OTHER_PATIENT);
    seed(dataset, 'Task', makeTaskRow({ status: from }));

    const res = await call(app, 'post', `/bff/v0/tasks/${TASK_A}/${action}`, { body: {} });

    expect(res.status).toBe(409);
    expect((await problem(res)).type).toBe('https://openrunic.org/problems/invalid-transition');
  });

  it('records the outcome a completion carries', async () => {
    const { app } = seededApp();
    const dto = await body<TaskDto>(
      await call(app, 'post', `/bff/v0/tasks/${TASK_A}/complete`, {
        body: { outcome: 'Patient telephoned; no action needed.' },
      })
    );

    expect(dto).toMatchObject({
      status: 'DONE',
      outcome: 'Patient telephoned; no action needed.',
    });
    expect(dto.completedAt).toMatch(/T.*Z$/);
  });
});

/* ------------------------------------------------------------------ messages */

describe('message threads', () => {
  it('narrows by every filter it advertises', async () => {
    const { app, dataset } = createTestApp();
    authorise(dataset, PATIENT, OTHER_PATIENT);
    seed(
      dataset,
      'MessageThread',
      makeThreadRow({ lastMessageAt: EARLY }),
      makeThreadRow({
        id: THREAD_B,
        createdAt: LATE,
        kind: 'STAFF',
        patientId: null,
        subject: 'Zebra rota',
        closedAt: EARLY,
        lastMessageAt: LATE,
      })
    );
    const ids = async (query: string): Promise<string[]> =>
      (
        await body<ListResponse<MessageThreadDto>>(
          await call(app, 'get', `/bff/v0/messages/threads?${query}`)
        )
      ).data.map((row) => row.id);

    expect(await ids('')).toEqual([THREAD_A, THREAD_B]);
    expect(await ids('kind=STAFF')).toEqual([THREAD_B]);
    expect(await ids(`patientId=${PATIENT}`)).toEqual([THREAD_A]);
    expect(await ids('open=true')).toEqual([THREAD_A]);
    expect(await ids('open=false')).toEqual([THREAD_B]);
    expect(await ids('sort=lastMessageAt&order=desc')).toEqual([THREAD_B, THREAD_A]);
    expect(await ids('sort=subject')).toEqual([THREAD_A, THREAD_B]);
    expect(await ids('sort=createdAt&order=desc')).toEqual([THREAD_B, THREAD_A]);
  });

  it('opens a staff thread on the schema default', async () => {
    const { app } = createTestApp();
    const res = await call(app, 'post', '/bff/v0/messages/threads', {
      body: { subject: 'Rota for the long weekend' },
    });

    expect(res.status).toBe(201);
    const dto = await body<MessageThreadDto>(res);
    expect(res.headers.get('location')).toBe(`/bff/v0/messages/threads/${dto.id}`);
    expect(dto).toMatchObject({
      kind: 'STAFF',
      patientId: null,
      lastMessageAt: null,
      closedAt: null,
    });
  });

  it('opens a patient thread against a chart', async () => {
    const { app } = createTestApp();
    const dto = await body<MessageThreadDto>(
      await call(app, 'post', '/bff/v0/messages/threads', {
        body: { kind: 'PATIENT', patientId: PATIENT, subject: 'Question about my results' },
      })
    );

    expect(dto).toMatchObject({ kind: 'PATIENT', patientId: PATIENT });
  });

  it('422s a patient thread that names no chart', async () => {
    const { app } = createTestApp();
    const res = await call(app, 'post', '/bff/v0/messages/threads', {
      body: { kind: 'PATIENT', subject: 'Question about my results' },
    });

    expect(res.status).toBe(422);
    expect((await problem(res)).errors?.[0]?.path).toBe('patientId');
  });

  it('amends the subject and the kind', async () => {
    const { app } = seededApp();
    const dto = await body<MessageThreadDto>(
      await call(app, 'patch', `/bff/v0/messages/threads/${THREAD_A}`, {
        body: { kind: 'CARE_TEAM', subject: 'Results follow-up' },
      })
    );

    expect(dto).toMatchObject({ kind: 'CARE_TEAM', subject: 'Results follow-up' });

    await call(app, 'patch', `/bff/v0/messages/threads/${THREAD_A}`, { body: { kind: 'STAFF' } });
    const narrowed = await body<MessageThreadDto>(
      await call(app, 'patch', `/bff/v0/messages/threads/${THREAD_A}`, {
        body: { subject: 'Rota for the long weekend' },
      })
    );
    expect(narrowed).toMatchObject({ kind: 'STAFF', subject: 'Rota for the long weekend' });
  });

  it('422s a patch that changes nothing', async () => {
    const { app } = seededApp();
    expect(
      (await call(app, 'patch', `/bff/v0/messages/threads/${THREAD_A}`, { body: {} })).status
    ).toBe(422);
  });

  it('closes an open thread once and refuses to close it twice', async () => {
    const { app } = seededApp();
    const closed = await call(app, 'post', `/bff/v0/messages/threads/${THREAD_A}/close`, {
      body: {},
    });

    expect(closed.status).toBe(200);
    expect((await body<MessageThreadDto>(closed)).closedAt).toMatch(/T.*Z$/);

    const again = await call(app, 'post', `/bff/v0/messages/threads/${THREAD_A}/close`, {
      body: {},
    });
    expect(again.status).toBe(409);
    expect((await problem(again)).detail).toContain('already closed');
  });
});

describe('the messages inside a thread', () => {
  it('lists them oldest first and pages them', async () => {
    const { app, dataset } = createTestApp();
    authorise(dataset, PATIENT, OTHER_PATIENT);
    seed(dataset, 'MessageThread', makeThreadRow());
    seed(dataset, 'MessageThread', makeThreadRow({ id: THREAD_B }));
    seed(
      dataset,
      'Message',
      makeMessageRow({ id: testId(271), sentAt: LATE, body: 'Thank you.' }),
      makeMessageRow(),
      makeMessageRow({ id: testId(272), threadId: THREAD_B, body: 'Another conversation.' })
    );

    const res = await call(app, 'get', `/bff/v0/messages/threads/${THREAD_A}/messages`);

    expect(res.status).toBe(200);
    const page = await body<ListResponse<MessageDto>>(res);
    expect(page.data.map((row) => row.id)).toEqual([MESSAGE_A, testId(271)]);
    expect(page.page.total).toBe(2);

    const newest = await body<ListResponse<MessageDto>>(
      await call(
        app,
        'get',
        `/bff/v0/messages/threads/${THREAD_A}/messages?sort=createdAt&order=desc&pageSize=1`
      )
    );
    expect(newest.data).toHaveLength(1);
  });

  it('404s the messages of a thread that does not exist', async () => {
    const { app } = createTestApp();
    const res = await call(app, 'get', `/bff/v0/messages/threads/${testId(999)}/messages`);

    expect(res.status).toBe(404);
  });

  it('posts a message signed by the acting user and advances the thread', async () => {
    const { app } = seededApp();
    const res = await call(app, 'post', `/bff/v0/messages/threads/${THREAD_A}/messages`, {
      body: { body: 'Your haemoglobin is slightly low.' },
    });

    expect(res.status).toBe(201);
    expect(res.headers.get('location')).toBe(`/bff/v0/messages/threads/${THREAD_A}/messages`);
    const dto = await body<MessageDto>(res);
    expect(dto).toMatchObject({
      threadId: THREAD_A,
      senderType: 'USER',
      senderUserId: CLINICIAN,
      senderPatientId: null,
      readAt: null,
    });

    const thread = await body<MessageThreadDto>(
      await call(app, 'get', `/bff/v0/messages/threads/${THREAD_A}`)
    );
    expect(thread.lastMessageAt).toBe(dto.sentAt);
  });

  it('posts a message signed by the acting patient', async () => {
    const { app } = seededApp();
    const dto = await body<MessageDto>(
      await call(app, 'post', `/bff/v0/messages/threads/${THREAD_A}/messages`, {
        body: { body: 'Should I be worried?' },
        token: TOKENS.portalA,
      })
    );

    expect(dto).toMatchObject({
      senderType: 'PATIENT',
      senderUserId: null,
      senderPatientId: PATIENT,
    });
  });

  it('posts a message signed by a service account as the system', async () => {
    const { app, dataset } = serviceApp();
    seed(dataset, 'MessageThread', makeThreadRow());

    const dto = await body<MessageDto>(
      await call(app, 'post', `/bff/v0/messages/threads/${THREAD_A}/messages`, {
        body: { body: 'Result delivered by the results interface.' },
        token: SERVICE_TOKEN,
      })
    );

    expect(dto).toMatchObject({
      senderType: 'SYSTEM',
      senderUserId: null,
      senderPatientId: null,
    });
  });

  it('refuses a message posted to a closed thread', async () => {
    const { app, dataset } = createTestApp();
    authorise(dataset, PATIENT, OTHER_PATIENT);
    seed(dataset, 'MessageThread', makeThreadRow({ closedAt: EARLY }));

    const res = await call(app, 'post', `/bff/v0/messages/threads/${THREAD_A}/messages`, {
      body: { body: 'One more thing.' },
    });

    expect(res.status).toBe(409);
    expect((await problem(res)).detail).toContain('closed');
  });

  it('422s a message with no body text', async () => {
    const { app } = seededApp();
    const res = await call(app, 'post', `/bff/v0/messages/threads/${THREAD_A}/messages`, {
      body: { body: '' },
    });

    expect(res.status).toBe(422);
  });

  it('marks a message read, idempotently', async () => {
    const { app } = seededApp();
    const first = await call(app, 'post', `/bff/v0/messages/${MESSAGE_A}/read`, { body: {} });

    expect(first.status).toBe(200);
    const readAt = (await body<MessageDto>(first)).readAt;
    expect(readAt).toMatch(/T.*Z$/);

    const second = await call(app, 'post', `/bff/v0/messages/${MESSAGE_A}/read`, { body: {} });
    expect(second.status).toBe(200);
    expect((await body<MessageDto>(second)).readAt).toBe(readAt);
  });

  it('404s a read on a message that does not exist', async () => {
    const { app } = createTestApp();
    const res = await call(app, 'post', `/bff/v0/messages/${testId(999)}/read`, { body: {} });

    expect(res.status).toBe(404);
  });

  it('serves a compartment-restricted principal no messages at all', async () => {
    // `Message` reaches a chart only through its thread, which the repository
    // layer does not join, so a portal token is refused the table wholesale
    // rather than served one nobody narrowed.
    const { app } = seededApp();
    const page = await body<ListResponse<MessageDto>>(
      await call(app, 'get', `/bff/v0/messages/threads/${THREAD_A}/messages`, {
        token: TOKENS.portalA,
      })
    );

    expect(page.data).toEqual([]);
  });
});

/* --------------------------------------------------------- the shared envelope */

const GUARDED_ROUTES: readonly [Method, string, string][] = [
  ['get', '/bff/v0/orders', 'order.read'],
  ['post', '/bff/v0/orders', 'order.write'],
  ['patch', `/bff/v0/orders/${ORDER_A}`, 'order.write'],
  ['post', `/bff/v0/orders/${ORDER_A}/sign`, 'order.write'],
  ['post', `/bff/v0/orders/${ORDER_A}/transmit`, 'order.write'],
  ['post', `/bff/v0/orders/${ORDER_A}/cancel`, 'order.write'],
  ['get', '/bff/v0/specimens', 'order.read'],
  ['post', `/bff/v0/specimens/${SPECIMEN_A}/receive`, 'order.write'],
  ['post', `/bff/v0/specimens/${SPECIMEN_A}/reject`, 'order.write'],
  ['get', '/bff/v0/results', 'result.read'],
  ['get', `/bff/v0/results/${REPORT_A}/observations`, 'result.read'],
  ['post', `/bff/v0/results/${REPORT_A}/review`, 'result.write'],
  ['get', '/bff/v0/documents', 'document.read'],
  ['post', `/bff/v0/documents/${DOCUMENT_A}/file`, 'document.write'],
  ['get', '/bff/v0/tasks', 'task.read'],
  ['post', `/bff/v0/tasks/${TASK_A}/complete`, 'task.write'],
  ['post', `/bff/v0/tasks/${TASK_A}/cancel`, 'task.write'],
  ['get', '/bff/v0/messages/threads', 'message.read'],
  ['post', `/bff/v0/messages/threads/${THREAD_A}/close`, 'message.write'],
  ['get', `/bff/v0/messages/threads/${THREAD_A}/messages`, 'message.read'],
  ['post', `/bff/v0/messages/threads/${THREAD_A}/messages`, 'message.write'],
  ['post', `/bff/v0/messages/${MESSAGE_A}/read`, 'message.write'],
];

describe('the envelope every route inherits', () => {
  it.each(GUARDED_ROUTES)('401s %s %s with no bearer token', async (method, path) => {
    const { app } = seededApp();
    const res = await app.request(path, {
      method: method.toUpperCase(),
      ...(method === 'get' ? {} : { headers: { 'content-type': 'application/json' }, body: '{}' }),
    });

    expect(res.status).toBe(401);
  });

  it.each(GUARDED_ROUTES)(
    '403s %s %s for a principal whose roles grant nothing',
    async (method, path, permission) => {
      const { app } = seededApp();
      const res = await call(app, method, path, { token: UNPRIVILEGED_TOKEN, body: {} });

      expect(res.status).toBe(403);
      expect((await problem(res)).detail).toContain(permission);
    }
  );

  it.each([
    ['get', '/bff/v0/orders'],
    ['get', '/bff/v0/specimens'],
    ['get', '/bff/v0/results'],
    ['get', '/bff/v0/documents'],
    ['get', '/bff/v0/tasks'],
    ['get', '/bff/v0/messages/threads'],
  ] as const)('404s %s %s/<unknown id>', async (method, base) => {
    const { app } = createTestApp();
    expect((await call(app, method, `${base}/${testId(999)}`)).status).toBe(404);
  });

  it('400s an id that is not a UUID, without reaching the store', async () => {
    const { app } = createTestApp();
    const res = await call(app, 'get', '/bff/v0/orders/12');

    expect(res.status).toBe(400);
    expect((await problem(res)).errors?.[0]?.path).toBe('id');
  });

  it('resolves the literal sub-paths alongside the :id routes', async () => {
    const { app } = seededApp();

    // `observations` and `messages` are literals in the same position an id
    // occupies on the sibling route, so this is the assertion that the
    // registration order is right.
    expect((await call(app, 'get', `/bff/v0/results/${REPORT_A}/observations`)).status).toBe(200);
    expect((await call(app, 'get', `/bff/v0/messages/threads/${THREAD_A}/messages`)).status).toBe(
      200
    );
    expect((await call(app, 'get', '/bff/v0/messages/threads')).status).toBe(200);
  });
});

/* --------------------------------------------------------------------- audit */

describe('audit', () => {
  it('emits one batched read event naming the target type', async () => {
    const { app, sink } = seededApp();
    await call(app, 'get', `/bff/v0/results/${REPORT_A}`);

    expect(sink.reads()).toHaveLength(1);
    expect(sink.reads()[0]?.event).toMatchObject({
      action: 'phi.read',
      patientId: PATIENT,
      metadata: { targets: [{ type: 'DiagnosticReport', id: REPORT_A }], targetCount: 1 },
    });
  });

  it('names the analyte type when the nested route is read', async () => {
    const { app, sink } = seededApp();
    await call(app, 'get', `/bff/v0/results/${REPORT_A}/observations`);

    const targets = sink.reads()[0]?.event.metadata.targets;
    expect(targets).toEqual([
      { type: 'DiagnosticReport', id: REPORT_A, patientId: PATIENT },
      { type: 'ResultObservation', id: OBSERVATION_A, patientId: PATIENT },
    ]);
  });

  it('records a create as a transactional write carrying the new state', async () => {
    const { app, sink } = createTestApp();
    await call(app, 'post', '/bff/v0/orders', { body: VALID_ORDER });

    expect(sink.writes()).toHaveLength(1);
    expect(sink.writes()[0]).toMatchObject({
      transactional: true,
      event: {
        action: 'order.created',
        targetType: 'ServiceRequest',
        patientId: PATIENT,
        metadata: { status: 'DRAFT', code: '58410-2' },
      },
    });
  });

  it('records a transition as the move it was', async () => {
    const { app, sink } = seededApp();
    await call(app, 'post', `/bff/v0/orders/${ORDER_A}/sign`, { body: {} });

    expect(sink.writes()[0]?.event).toMatchObject({
      action: 'order.updated',
      metadata: { statusFrom: 'DRAFT', statusTo: 'SIGNED' },
    });
  });

  it('records an amendment that moved no status without a transition', async () => {
    const { app, sink } = seededApp();
    await call(app, 'patch', `/bff/v0/orders/${ORDER_A}`, { body: { priority: 'STAT' } });

    // The gate records a `chart.access` on the amendment before the update
    // event; the amendment is the one carrying the changed fields.
    const amendment = sink.writes().find((entry) => entry.event.action !== 'chart.access');
    const metadata = amendment?.event.metadata;
    expect(metadata).toMatchObject({ fields: ['priority'] });
    expect(metadata).not.toHaveProperty('statusFrom');
  });

  it('names the encounter and the chart on a document event', async () => {
    const { app, sink } = createTestApp();
    await call(app, 'post', '/bff/v0/documents', { body: FULL_DOCUMENT });

    expect(sink.writes()[0]?.event).toMatchObject({
      action: 'document.created',
      targetType: 'Document',
      patientId: PATIENT,
      encounterId: ENCOUNTER,
      metadata: { category: '11488-4', status: 'INBOX' },
    });
  });

  it('files a message event under no chart, because a message names a sender and not a chart', async () => {
    const { app, sink } = seededApp();
    await call(app, 'post', `/bff/v0/messages/threads/${THREAD_A}/messages`, {
      body: { body: 'Noted, thank you.' },
    });

    const created = sink.writes().find((entry) => entry.event.action === 'message.created');
    expect(created?.event.targetType).toBe('Message');
    expect(created?.event.patientId).toBeUndefined();
  });
});

/* ------------------------------------------------------- the published contract */

describe('the route contracts', () => {
  const contracts = orderRouteContracts();

  it('documents every operation exactly once', () => {
    const keys = contracts.map((contract) => `${contract.method} ${contract.path}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain('post /bff/v0/orders/{id}/sign');
    expect(keys).toContain('get /bff/v0/results/{id}/observations');
    expect(keys).toContain('post /bff/v0/messages/threads/{id}/messages');
    expect(keys).toContain('post /bff/v0/messages/{id}/read');
  });

  it('gives every operation a unique id and a permission', () => {
    const ids = contracts.map((contract) => contract.operationId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(contracts.every((contract) => contract.permission !== undefined)).toBe(true);
  });

  it('documents the one transition that creates a row as a 201', () => {
    const post = contracts.find((contract) => contract.operationId === 'postMessage');
    expect(post?.responses[0]?.status).toBe(201);

    const sign = contracts.find((contract) => contract.operationId === 'signOrder');
    expect(sign?.responses[0]?.status).toBe(200);
  });
});

/* ------------------------------------------------------- the Prisma filter half */

const BASE_QUERY = { page: 1, pageSize: 25, order: 'asc' } as const;

describe('the Prisma half of each filter, which Postgres would evaluate', () => {
  it('narrows an order query the way `matches` does', () => {
    expect(serviceRequestSpec.where({ ...BASE_QUERY, sort: 'requestedAt' })).toEqual({});
    expect(
      serviceRequestSpec.where({
        ...BASE_QUERY,
        sort: 'requestedAt',
        patientId: PATIENT,
        encounterId: ENCOUNTER,
        status: 'SIGNED',
        category: 'LAB',
        priority: 'STAT',
        orderedById: CLINICIAN,
        from: EARLY,
        to: LATE,
      })
    ).toEqual({
      patientId: PATIENT,
      encounterId: ENCOUNTER,
      status: 'SIGNED',
      category: 'LAB',
      priority: 'STAT',
      orderedById: CLINICIAN,
      requestedAt: { gte: EARLY, lt: LATE },
    });
  });

  it('narrows a specimen query the way `matches` does', () => {
    expect(specimenSpec.where({ ...BASE_QUERY, sort: 'collectedAt' })).toEqual({});
    expect(
      specimenSpec.where({
        ...BASE_QUERY,
        sort: 'collectedAt',
        patientId: PATIENT,
        serviceRequestId: ORDER_A,
        status: 'AVAILABLE',
        accessionNumber: 'ACC-000114',
      })
    ).toEqual({
      patientId: PATIENT,
      serviceRequestId: ORDER_A,
      status: 'AVAILABLE',
      accessionNumber: 'ACC-000114',
    });
  });

  it('narrows a report query, including the sign-off queue', () => {
    expect(diagnosticReportSpec.where({ ...BASE_QUERY, sort: 'issuedAt' })).toEqual({});
    expect(
      diagnosticReportSpec.where({
        ...BASE_QUERY,
        sort: 'issuedAt',
        patientId: PATIENT,
        encounterId: ENCOUNTER,
        serviceRequestId: ORDER_A,
        status: 'FINAL',
        category: 'LAB',
        abnormalFlag: 'CRITICAL',
        reviewed: false,
        from: EARLY,
        to: LATE,
      })
    ).toEqual({
      patientId: PATIENT,
      encounterId: ENCOUNTER,
      serviceRequestId: ORDER_A,
      status: 'FINAL',
      category: 'LAB',
      abnormalFlag: 'CRITICAL',
      reviewedAt: null,
      issuedAt: { gte: EARLY, lt: LATE },
    });
    expect(diagnosticReportSpec.where({ ...BASE_QUERY, sort: 'issuedAt', reviewed: true })).toEqual(
      { reviewedAt: { not: null } }
    );
  });

  it('narrows an analyte query', () => {
    expect(resultObservationSpec.where({ ...BASE_QUERY, sort: 'sequence' })).toEqual({});
    expect(
      resultObservationSpec.where({
        ...BASE_QUERY,
        sort: 'sequence',
        diagnosticReportId: REPORT_A,
        patientId: PATIENT,
        loincCode: '718-7',
        abnormalFlag: 'ABNORMAL',
      })
    ).toEqual({
      diagnosticReportId: REPORT_A,
      patientId: PATIENT,
      loincCode: '718-7',
      abnormalFlag: 'ABNORMAL',
    });
  });

  it('narrows a document query', () => {
    expect(documentSpec.where({ ...BASE_QUERY, sort: 'receivedAt' })).toEqual({});
    expect(
      documentSpec.where({
        ...BASE_QUERY,
        sort: 'receivedAt',
        patientId: PATIENT,
        encounterId: ENCOUNTER,
        status: 'INBOX',
        category: '11488-4',
        source: 'FAX',
        from: EARLY,
        to: LATE,
      })
    ).toEqual({
      patientId: PATIENT,
      encounterId: ENCOUNTER,
      status: 'INBOX',
      category: '11488-4',
      source: 'FAX',
      receivedAt: { gte: EARLY, lt: LATE },
    });
  });

  it('narrows a task query', () => {
    expect(taskSpec.where({ ...BASE_QUERY, sort: 'dueAt' })).toEqual({});
    expect(
      taskSpec.where({
        ...BASE_QUERY,
        sort: 'dueAt',
        type: 'RESULT',
        status: 'OPEN',
        priority: 'HIGH',
        patientId: PATIENT,
        assigneeUserId: CLINICIAN,
        assigneeTeamKey: 'front-desk',
        slaState: 'AGING',
        from: EARLY,
        to: LATE,
      })
    ).toEqual({
      type: 'RESULT',
      status: 'OPEN',
      priority: 'HIGH',
      patientId: PATIENT,
      assigneeUserId: CLINICIAN,
      assigneeTeamKey: 'front-desk',
      slaState: 'AGING',
      dueAt: { gte: EARLY, lt: LATE },
    });
  });

  it('narrows a thread query on both sides of `open`', () => {
    expect(messageThreadSpec.where({ ...BASE_QUERY, sort: 'lastMessageAt' })).toEqual({});
    expect(
      messageThreadSpec.where({
        ...BASE_QUERY,
        sort: 'lastMessageAt',
        kind: 'PATIENT',
        patientId: PATIENT,
        open: true,
      })
    ).toEqual({ kind: 'PATIENT', patientId: PATIENT, closedAt: null });
    expect(messageThreadSpec.where({ ...BASE_QUERY, sort: 'lastMessageAt', open: false })).toEqual({
      closedAt: { not: null },
    });
  });

  it('narrows a message query on both sides of `read`', () => {
    expect(messageSpec.where({ ...BASE_QUERY, sort: 'sentAt' })).toEqual({});
    expect(
      messageSpec.where({
        ...BASE_QUERY,
        sort: 'sentAt',
        threadId: THREAD_A,
        senderUserId: CLINICIAN,
        read: true,
      })
    ).toEqual({ threadId: THREAD_A, senderUserId: CLINICIAN, readAt: { not: null } });
    expect(messageSpec.where({ ...BASE_QUERY, sort: 'sentAt', read: false })).toEqual({
      readAt: null,
    });
    expect(
      messageSpec.matches(makeMessageRow({ readAt: EARLY }), {
        ...BASE_QUERY,
        sort: 'sentAt',
        read: true,
      })
    ).toBe(true);
    expect(
      messageSpec.matches(makeMessageRow(), {
        ...BASE_QUERY,
        sort: 'sentAt',
        senderUserId: OTHER_USER,
      })
    ).toBe(false);
  });

  it('always tie-breaks the ordering on id', () => {
    const orderings = [
      serviceRequestSpec.orderBy({ ...BASE_QUERY, sort: 'requestedAt' }),
      serviceRequestSpec.orderBy({ ...BASE_QUERY, sort: 'scheduledFor' }),
      serviceRequestSpec.orderBy({ ...BASE_QUERY, sort: 'createdAt' }),
      specimenSpec.orderBy({ ...BASE_QUERY, sort: 'collectedAt' }),
      specimenSpec.orderBy({ ...BASE_QUERY, sort: 'createdAt' }),
      diagnosticReportSpec.orderBy({ ...BASE_QUERY, sort: 'issuedAt' }),
      diagnosticReportSpec.orderBy({ ...BASE_QUERY, sort: 'effectiveAt' }),
      diagnosticReportSpec.orderBy({ ...BASE_QUERY, sort: 'createdAt' }),
      resultObservationSpec.orderBy({ ...BASE_QUERY, sort: 'sequence' }),
      resultObservationSpec.orderBy({ ...BASE_QUERY, sort: 'effectiveAt' }),
      resultObservationSpec.orderBy({ ...BASE_QUERY, sort: 'createdAt' }),
      documentSpec.orderBy({ ...BASE_QUERY, sort: 'receivedAt' }),
      documentSpec.orderBy({ ...BASE_QUERY, sort: 'title' }),
      documentSpec.orderBy({ ...BASE_QUERY, sort: 'createdAt' }),
      taskSpec.orderBy({ ...BASE_QUERY, sort: 'dueAt' }),
      taskSpec.orderBy({ ...BASE_QUERY, sort: 'priority' }),
      taskSpec.orderBy({ ...BASE_QUERY, sort: 'createdAt' }),
      messageThreadSpec.orderBy({ ...BASE_QUERY, sort: 'lastMessageAt' }),
      messageThreadSpec.orderBy({ ...BASE_QUERY, sort: 'subject' }),
      messageThreadSpec.orderBy({ ...BASE_QUERY, sort: 'createdAt' }),
      messageSpec.orderBy({ ...BASE_QUERY, sort: 'sentAt' }),
      messageSpec.orderBy({ ...BASE_QUERY, sort: 'createdAt' }),
    ];

    for (const ordering of orderings) {
      expect(Array.isArray(ordering) ? ordering.at(-1) : undefined).toEqual({ id: 'asc' });
    }
  });

  it('asks for nothing at all when a conditional natural key is absent', () => {
    expect(specimenSpec.uniqueBy?.where(VALID_SPECIMEN)).toEqual({
      accessionNumber: { in: [] },
    });
    expect(specimenSpec.uniqueBy?.where({ ...VALID_SPECIMEN, accessionNumber: 'ACC-1' })).toEqual({
      accessionNumber: 'ACC-1',
    });
    expect(taskSpec.uniqueBy?.where(VALID_TASK)).toEqual({ sourceEventId: { in: [] } });
    expect(taskSpec.uniqueBy?.where({ ...VALID_TASK, sourceEventId: 'evt-1' })).toEqual({
      sourceEventId: 'evt-1',
      type: 'RESULT',
    });
    expect(specimenSpec.uniqueBy?.message(VALID_SPECIMEN)).toContain('already exists');
    expect(taskSpec.uniqueBy?.message(VALID_TASK)).toContain('already exists');
  });
});

/* ------------------------------- the analyte spec, which no route writes today */

/**
 * `ResultObservation` is written with its report and read through it, so the
 * halves of its spec that a standalone write would use have no HTTP surface
 * yet. They are asserted here directly rather than left unproven, because the
 * first route that does write one should inherit a spec somebody has looked at.
 */
describe('the analyte spec', () => {
  const listQuery = { ...BASE_QUERY, sort: 'sequence' } as const;
  /** The ids and clock a repository hands a spec while it builds a row. */
  const ROW_CONTEXT = { tenantId: DEMO_TENANT_A, now: FIXED_NOW, nextId: () => testId(999) };

  it('builds a row against the report and the chart that own it', () => {
    const row = resultObservationSpec.newRow(
      {
        sequence: 1,
        code: '789-8',
        display: 'Erythrocytes',
        effectiveAt: EARLY,
        diagnosticReportId: REPORT_A,
        patientId: PATIENT,
      },
      ROW_CONTEXT
    );

    expect(row).toMatchObject({
      diagnosticReportId: REPORT_A,
      patientId: PATIENT,
      status: 'FINAL',
      codeSystem: 'http://loinc.org',
      abnormalFlag: 'NORMAL',
      valueNumber: null,
    });
  });

  it('keeps the columns a patch names and drops the ones it does not', () => {
    expect(
      resultObservationSpec.patchData(
        { status: 'CORRECTED', abnormalFlag: undefined },
        makeObservationRow(),
        ROW_CONTEXT
      )
    ).toEqual({ status: 'CORRECTED' });
  });

  it('narrows in memory the same way its `where` narrows in Postgres', () => {
    const row = makeObservationRow();

    expect(resultObservationSpec.matches(row, { ...listQuery, diagnosticReportId: REPORT_B })).toBe(
      false
    );
    expect(resultObservationSpec.matches(row, { ...listQuery, patientId: OTHER_PATIENT })).toBe(
      false
    );
    expect(resultObservationSpec.matches(row, { ...listQuery, loincCode: '789-8' })).toBe(false);
    expect(resultObservationSpec.matches(row, { ...listQuery, abnormalFlag: 'NORMAL' })).toBe(
      false
    );
    expect(resultObservationSpec.matches(row, { ...listQuery, abnormalFlag: 'ABNORMAL' })).toBe(
      true
    );
  });

  it('sorts by effective time and by creation time as well as by sequence', () => {
    const row = makeObservationRow();

    expect(resultObservationSpec.sortValue(row, 'sequence')).toBe(0);
    expect(resultObservationSpec.sortValue(row, 'effectiveAt')).toBe(EARLY.getTime());
    expect(resultObservationSpec.sortValue(row, 'createdAt')).toBe(FIXED_NOW.getTime());
  });
});

/* ------------------------------------------------------- a service principal */

const SERVICE_TOKEN = 'test-service-a';

/**
 * A machine account holding a clinician's permissions. It exists to prove the
 * one thing a permission cannot express: that some acts have to be answered for
 * by a person.
 */
const SERVICE_PRINCIPAL: Principal = {
  subject: testId(960),
  tenantId: DEMO_TENANT_A,
  actorType: 'service',
  displayName: 'Results interface',
  roles: ['clinician'],
  facilityIds: [DEMO_FACILITY_A],
  scopes: ['system/*.read', 'system/*.write'],
  purposeOfUse: 'HOPERAT',
};

function serviceApp(): Harness {
  return createTestApp({
    principalResolver: createStaticPrincipalResolver(
      new Map([...DEMO_PRINCIPALS, [SERVICE_TOKEN, SERVICE_PRINCIPAL]])
    ),
  });
}
