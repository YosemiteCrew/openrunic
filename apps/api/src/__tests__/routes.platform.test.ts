import { describe, expect, it } from 'vitest';

import type { AuditChainStore, StoredAuditEvent } from '../audit/chain-store.js';
import type { ProblemDocument } from '../http/problem.js';
import type { RowContext } from '../repositories/collection.js';
import type { ScopedRow } from '../repositories/rows.js';
import {
  facilitySpec,
  formDefinitionSpec,
  formSubmissionSpec,
  roleAssignmentSpec,
  roleSpec,
  terminologyCodeSpec,
  userSpec,
} from '../repositories/specs/platform.js';
import { platformRouteContracts } from '../routes/platform.js';
import type { ListResponse } from '../schemas/pagination.js';
import type {
  AuditEventDto,
  AuditVerificationDto,
  FacilityDto,
  FormDefinitionDto,
  FormSubmissionDto,
  RoleAssignmentDto,
  RoleDto,
  TerminologyCodeDto,
  TerminologyLookupDto,
  UserDto,
} from '../schemas/platform.js';

import {
  bearer,
  createTestApp,
  jsonBearer,
  seed,
  storageColumns,
  DEMO_FACILITY_A,
  DEMO_FACILITY_B,
  DEMO_TENANT_A,
  FIXED_NOW,
  TOKENS,
  testId,
  UNPRIVILEGED_TOKEN,
  type TestApp,
} from './support.js';

/**
 * The platform surface, driven through the real app over the in-memory store.
 *
 * Synthetic data only: Testina Patientsson and Dr. Adaeze Okafor, `.invalid`
 * domains, `+1555` numbers, and code identifiers that are shaped like the real
 * thing without being anybody's licensed content.
 *
 * `TOKENS.adminA` does most of the work here because the administrative
 * permissions - `user.write`, `role.write`, `facility.write`,
 * `terminology.write` and `audit.read` - are held by the admin role and by no
 * other seeded one.
 */

type App = TestApp['app'];

const PATIENT_ID = testId(1);
const DEFINITION_ID = testId(10);
const SUBMISSION_ID = testId(20);
const USER_ID = testId(30);
const ROLE_ID = testId(40);
const FACILITY_ID = testId(50);
const CODE_ID = testId(60);
const ENCOUNTER_ID = testId(70);

const LOINC = 'http://loinc.org';
/** A deployment-local code system, which the column deliberately allows. */
const LOCAL_CODES = 'urn:testville:local-codes';

async function get(app: App, path: string, token: string = TOKENS.adminA): Promise<Response> {
  return await app.request(path, { headers: bearer(token) });
}

async function anonymous(app: App, path: string): Promise<Response> {
  return await app.request(path);
}

async function send(
  app: App,
  method: 'POST' | 'PATCH',
  path: string,
  payload: unknown,
  token: string = TOKENS.adminA
): Promise<Response> {
  return await app.request(path, {
    method,
    headers: jsonBearer(token),
    body: JSON.stringify(payload),
  });
}

async function body<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/* ---------------------------------------------------------------- fixtures */

function makeFormDefinitionRow(
  overrides: Partial<ScopedRow<'FormDefinition'>> = {}
): ScopedRow<'FormDefinition'> {
  return {
    ...storageColumns(DEFINITION_ID),
    key: 'intake-history',
    version: 1,
    status: 'DRAFT',
    title: 'Intake history',
    description: null,
    bindTo: 'ENCOUNTER',
    definition: { fields: [] },
    compiled: null,
    promotionManifest: null,
    publishedAt: null,
    publishedById: null,
    retiredAt: null,
    ...overrides,
  };
}

function makeFormSubmissionRow(
  overrides: Partial<ScopedRow<'FormSubmission'>> = {}
): ScopedRow<'FormSubmission'> {
  return {
    ...storageColumns(SUBMISSION_ID),
    formDefinitionId: DEFINITION_ID,
    patientId: PATIENT_ID,
    encounterId: null,
    status: 'IN_PROGRESS',
    values: { systolic: 118 },
    completedByType: 'USER',
    completedByUserId: null,
    completedAt: null,
    signedAt: null,
    signedById: null,
    effectiveAt: FIXED_NOW,
    ...overrides,
  };
}

function makeUserRow(overrides: Partial<ScopedRow<'User'>> = {}): ScopedRow<'User'> {
  return {
    ...storageColumns(USER_ID),
    email: 'adaeze.okafor@clinic.invalid',
    givenName: 'Adaeze',
    familyName: 'Okafor',
    credential: 'MD',
    npi: '1000000004',
    dea: 'XO1000004',
    taxonomyCode: '207Q00000X',
    isProvider: true,
    locale: 'en-US',
    status: 'ACTIVE',
    lastLoginAt: null,
    ...overrides,
  };
}

function makeRoleRow(overrides: Partial<ScopedRow<'Role'>> = {}): ScopedRow<'Role'> {
  return {
    ...storageColumns(ROLE_ID),
    key: 'clinician',
    name: 'Clinician',
    description: null,
    isSystem: true,
    ...overrides,
  };
}

function makeRoleAssignmentRow(
  overrides: Partial<ScopedRow<'RoleAssignment'>> = {}
): ScopedRow<'RoleAssignment'> {
  return {
    ...storageColumns(testId(45)),
    userId: USER_ID,
    roleId: ROLE_ID,
    facilityId: null,
    ...overrides,
  };
}

function makeFacilityRow(overrides: Partial<ScopedRow<'Facility'>> = {}): ScopedRow<'Facility'> {
  return {
    ...storageColumns(FACILITY_ID),
    name: 'Testville Clinic',
    code: 'TVC',
    npi: null,
    posCode: '11',
    timezone: 'UTC',
    addressLine1: null,
    addressLine2: null,
    city: null,
    state: null,
    postalCode: null,
    country: 'US',
    phone: null,
    active: true,
    ...overrides,
  };
}

function makeTerminologyRow(
  overrides: Partial<ScopedRow<'TerminologyCode'>> = {}
): ScopedRow<'TerminologyCode'> {
  return {
    ...storageColumns(CODE_ID),
    system: LOINC,
    code: '8302-2',
    display: 'Body height',
    version: '',
    parentCode: null,
    isActive: true,
    properties: null,
    ...overrides,
  };
}

/** An app with one published definition and one submission against it. */
function formsApp(): TestApp {
  const harness = createTestApp();
  seed(
    harness.dataset,
    'FormDefinition',
    makeFormDefinitionRow({
      id: DEFINITION_ID,
      status: 'PUBLISHED',
      publishedAt: FIXED_NOW,
      publishedById: testId(951),
    })
  );
  seed(harness.dataset, 'FormSubmission', makeFormSubmissionRow());
  return harness;
}

const DEFINITION_BODY = {
  key: 'vitals-intake',
  version: 1,
  title: 'Vitals intake',
  bindTo: 'ENCOUNTER',
  definition: { fields: [{ key: 'systolic' }] },
};

const PUBLISH_MANIFEST = {
  definitionKey: 'intake-history',
  definitionVersion: 1,
  fields: [{ fieldKey: 'systolic', type: 'number' }],
};

const SUBMISSION_BODY = {
  formDefinitionId: DEFINITION_ID,
  patientId: PATIENT_ID,
  values: { systolic: 120 },
};

const USER_BODY = {
  email: 'testina.staffsson@clinic.invalid',
  givenName: 'Testina',
  familyName: 'Staffsson',
};

const ROLE_BODY = { key: 'ward-clerk', name: 'Ward clerk' };

const FACILITY_BODY = { name: 'Testville Annexe', code: 'TVA' };

const CODE_BODY = { system: LOINC, code: '8867-4', display: 'Heart rate' };

/* ------------------------------------------------------- form definitions */

describe('GET /bff/v0/forms/definitions', () => {
  it('pages and reports the whole-set total', async () => {
    const { app, dataset } = createTestApp();
    for (let index = 0; index < 3; index += 1) {
      seed(
        dataset,
        'FormDefinition',
        makeFormDefinitionRow({ id: testId(10 + index), key: `form-${index}` })
      );
    }

    const page = await body<ListResponse<FormDefinitionDto>>(
      await get(app, '/bff/v0/forms/definitions?page=1&pageSize=2')
    );

    expect(page.data).toHaveLength(2);
    expect(page.page).toEqual({ page: 1, pageSize: 2, total: 3, totalPages: 2 });
  });

  it('narrows by key, status and binding at once', async () => {
    const { app, dataset } = createTestApp();
    seed(
      dataset,
      'FormDefinition',
      makeFormDefinitionRow({ id: testId(10) }),
      makeFormDefinitionRow({
        id: testId(11),
        key: 'portal-consent',
        status: 'PUBLISHED',
        bindTo: 'PORTAL',
      }),
      // Same key and binding, earlier version, still a draft: excluded by the
      // status filter alone, which is the only way that filter is proved.
      makeFormDefinitionRow({ id: testId(12), key: 'portal-consent', bindTo: 'PORTAL' }),
      // Same key and status, bound elsewhere: excluded by the binding alone.
      makeFormDefinitionRow({ id: testId(13), key: 'portal-consent', status: 'PUBLISHED' })
    );

    const page = await body<ListResponse<FormDefinitionDto>>(
      await get(app, '/bff/v0/forms/definitions?key=portal-consent&status=PUBLISHED&bindTo=PORTAL')
    );

    expect(page.data.map((row) => row.id)).toEqual([testId(11)]);
  });

  it('renders a JSON column that holds no object as an empty one', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'FormDefinition', makeFormDefinitionRow({ definition: null }));

    const dto = await body<FormDefinitionDto>(
      await get(app, `/bff/v0/forms/definitions/${DEFINITION_ID}`)
    );

    expect(dto.definition).toEqual({});
  });

  it('sorts by key, by version and by creation', async () => {
    const { app, dataset } = createTestApp();
    seed(
      dataset,
      'FormDefinition',
      makeFormDefinitionRow({ id: testId(10), key: 'alpha', version: 2 }),
      makeFormDefinitionRow({ id: testId(11), key: 'beta', version: 1 })
    );
    const ids = async (query: string): Promise<string[]> =>
      (
        await body<ListResponse<FormDefinitionDto>>(
          await get(app, `/bff/v0/forms/definitions?${query}`)
        )
      ).data.map((row) => row.id);

    expect(await ids('sort=key')).toEqual([testId(10), testId(11)]);
    expect(await ids('sort=key&order=desc')).toEqual([testId(11), testId(10)]);
    expect(await ids('sort=version')).toEqual([testId(11), testId(10)]);
    expect(await ids('sort=createdAt')).toHaveLength(2);
  });

  it('400s a filter nobody declared', async () => {
    const { app } = createTestApp();
    const res = await get(app, '/bff/v0/forms/definitions?stauts=DRAFT');

    expect(res.status).toBe(400);
    expect((await body<ProblemDocument>(res)).type).toBe(
      'https://openrunic.org/problems/malformed-request'
    );
  });

  it('401s without a token and 403s a role with nothing', async () => {
    const { app } = createTestApp();

    expect((await anonymous(app, '/bff/v0/forms/definitions')).status).toBe(401);
    expect((await get(app, '/bff/v0/forms/definitions', UNPRIVILEGED_TOKEN)).status).toBe(403);
  });
});

describe('GET /bff/v0/forms/definitions/:id', () => {
  it('reads one definition', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'FormDefinition', makeFormDefinitionRow());

    const dto = await body<FormDefinitionDto>(
      await get(app, `/bff/v0/forms/definitions/${DEFINITION_ID}`)
    );

    expect(dto).toMatchObject({
      id: DEFINITION_ID,
      key: 'intake-history',
      status: 'DRAFT',
      definition: { fields: [] },
      compiled: null,
      publishedAt: null,
    });
  });

  it('404s an unknown id', async () => {
    const { app } = createTestApp();

    expect((await get(app, `/bff/v0/forms/definitions/${testId(99)}`)).status).toBe(404);
  });
});

describe('POST /bff/v0/forms/definitions', () => {
  it('records a definition and points at it', async () => {
    const { app } = createTestApp();
    const res = await send(app, 'POST', '/bff/v0/forms/definitions', DEFINITION_BODY);

    expect(res.status).toBe(201);
    const dto = await body<FormDefinitionDto>(res);
    expect(res.headers.get('location')).toBe(`/bff/v0/forms/definitions/${dto.id}`);
    expect(dto).toMatchObject({ status: 'DRAFT', description: null, promotionManifest: null });
  });

  it('records every optional column it was given', async () => {
    const { app } = createTestApp();
    const dto = await body<FormDefinitionDto>(
      await send(app, 'POST', '/bff/v0/forms/definitions', {
        ...DEFINITION_BODY,
        status: 'DRAFT',
        description: 'Everything the front desk asks at registration.',
        compiled: { validator: 'v1' },
        promotionManifest: { ...PUBLISH_MANIFEST, definitionKey: 'vitals-intake' },
      })
    );

    expect(dto.description).toBe('Everything the front desk asks at registration.');
    expect(dto.compiled).toEqual({ validator: 'v1' });
    expect(dto.promotionManifest).toMatchObject({ definitionKey: 'vitals-intake' });
  });

  it('422s a body that breaks the contract', async () => {
    const { app } = createTestApp();
    const res = await send(app, 'POST', '/bff/v0/forms/definitions', {
      ...DEFINITION_BODY,
      key: 'Not Kebab Case',
    });

    expect(res.status).toBe(422);
    expect((await body<ProblemDocument>(res)).errors?.[0]?.path).toBe('key');
  });

  it('409s the same key and version twice', async () => {
    const { app } = createTestApp();
    const post = (): Promise<Response> =>
      send(app, 'POST', '/bff/v0/forms/definitions', DEFINITION_BODY);

    expect((await post()).status).toBe(201);
    const clash = await post();
    expect(clash.status).toBe(409);
    expect((await body<ProblemDocument>(clash)).detail).toContain('vitals-intake');
  });

  it('403s a role without form.write', async () => {
    const { app } = createTestApp();
    const res = await send(
      app,
      'POST',
      '/bff/v0/forms/definitions',
      DEFINITION_BODY,
      UNPRIVILEGED_TOKEN
    );

    expect(res.status).toBe(403);
  });
});

describe('PATCH /bff/v0/forms/definitions/:id', () => {
  it('amends a draft', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'FormDefinition', makeFormDefinitionRow());

    const dto = await body<FormDefinitionDto>(
      await send(app, 'PATCH', `/bff/v0/forms/definitions/${DEFINITION_ID}`, {
        title: 'Intake history (revised)',
      })
    );

    expect(dto.title).toBe('Intake history (revised)');
    expect(dto.key).toBe('intake-history');
  });

  it('amends every editable column at once', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'FormDefinition', makeFormDefinitionRow());

    const dto = await body<FormDefinitionDto>(
      await send(app, 'PATCH', `/bff/v0/forms/definitions/${DEFINITION_ID}`, {
        key: 'intake-history-v2',
        title: 'Intake history',
        description: 'Registration questions.',
        bindTo: 'PATIENT',
        definition: { fields: [{ key: 'height' }] },
      })
    );

    expect(dto).toMatchObject({
      key: 'intake-history-v2',
      description: 'Registration questions.',
      bindTo: 'PATIENT',
      definition: { fields: [{ key: 'height' }] },
    });
  });

  it('422s an empty patch', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'FormDefinition', makeFormDefinitionRow());

    expect(
      (await send(app, 'PATCH', `/bff/v0/forms/definitions/${DEFINITION_ID}`, {})).status
    ).toBe(422);
  });

  it('404s an unknown id', async () => {
    const { app } = createTestApp();

    expect(
      (await send(app, 'PATCH', `/bff/v0/forms/definitions/${testId(99)}`, { title: 'x' })).status
    ).toBe(404);
  });

  it('freezes the authored document once the version is published', async () => {
    const { app } = formsApp();
    const res = await send(app, 'PATCH', `/bff/v0/forms/definitions/${DEFINITION_ID}`, {
      definition: { fields: [] },
      bindTo: 'PATIENT',
    });

    expect(res.status).toBe(409);
    const problem = await body<ProblemDocument>(res);
    expect(problem.type).toBe('https://openrunic.org/problems/invalid-transition');
    expect(problem.errors?.map((issue) => issue.path)).toEqual(['bindTo', 'definition']);
  });

  it('still lets a published version be retitled', async () => {
    const { app } = formsApp();
    const res = await send(app, 'PATCH', `/bff/v0/forms/definitions/${DEFINITION_ID}`, {
      title: 'Intake history (2026)',
    });

    expect(res.status).toBe(200);
  });

  it('freezes a retired version too', async () => {
    const { app, dataset } = createTestApp();
    seed(
      dataset,
      'FormDefinition',
      makeFormDefinitionRow({ status: 'RETIRED', retiredAt: FIXED_NOW })
    );

    expect(
      (await send(app, 'PATCH', `/bff/v0/forms/definitions/${DEFINITION_ID}`, { key: 'renamed' }))
        .status
    ).toBe(409);
  });
});

describe('the form definition lifecycle', () => {
  it('publishes a draft, stamping who and when and the compiled artefacts', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'FormDefinition', makeFormDefinitionRow());

    const res = await send(app, 'POST', `/bff/v0/forms/definitions/${DEFINITION_ID}/publish`, {
      formDefinitionId: DEFINITION_ID,
      compiled: { validator: 'v1' },
      promotionManifest: PUBLISH_MANIFEST,
    });

    expect(res.status).toBe(200);
    const dto = await body<FormDefinitionDto>(res);
    expect(dto.status).toBe('PUBLISHED');
    expect(dto.publishedById).toBe(testId(951));
    // Stamped from the request's clock, so it is the same instant as the row's
    // own `updatedAt` rather than a second reading of the wall clock.
    expect(dto.publishedAt).toBe(FIXED_NOW.toISOString());
    expect(dto.compiled).toEqual({ validator: 'v1' });
    expect(dto.promotionManifest).toMatchObject({ definitionKey: 'intake-history' });
  });

  it('takes the publication instant the caller supplied, and no manifest at all', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'FormDefinition', makeFormDefinitionRow());

    const dto = await body<FormDefinitionDto>(
      await send(app, 'POST', `/bff/v0/forms/definitions/${DEFINITION_ID}/publish`, {
        formDefinitionId: DEFINITION_ID,
        compiled: {},
        publishedAt: '2026-08-01T08:00:00.000Z',
      })
    );

    expect(dto.publishedAt).toBe('2026-08-01T08:00:00.000Z');
    expect(dto.promotionManifest).toBeNull();
  });

  it('409s publishing something already published', async () => {
    const { app } = formsApp();
    const res = await send(app, 'POST', `/bff/v0/forms/definitions/${DEFINITION_ID}/publish`, {
      formDefinitionId: DEFINITION_ID,
      compiled: {},
    });

    expect(res.status).toBe(409);
    const problem = await body<ProblemDocument>(res);
    expect(problem.type).toBe('https://openrunic.org/problems/invalid-transition');
    expect(problem.detail).toContain('PUBLISHED');
  });

  it('422s a body that names a different definition than the path', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'FormDefinition', makeFormDefinitionRow());

    const res = await send(app, 'POST', `/bff/v0/forms/definitions/${DEFINITION_ID}/publish`, {
      formDefinitionId: testId(99),
      compiled: {},
    });

    expect(res.status).toBe(422);
    expect((await body<ProblemDocument>(res)).errors?.[0]?.path).toBe('formDefinitionId');
  });

  it('404s publishing an unknown definition', async () => {
    const { app } = createTestApp();
    const res = await send(app, 'POST', `/bff/v0/forms/definitions/${testId(99)}/publish`, {
      formDefinitionId: testId(99),
      compiled: {},
    });

    expect(res.status).toBe(404);
  });

  it('retires a published version and refuses to retire a draft', async () => {
    const { app, dataset } = createTestApp();
    seed(
      dataset,
      'FormDefinition',
      makeFormDefinitionRow({ id: DEFINITION_ID, status: 'PUBLISHED' }),
      makeFormDefinitionRow({ id: testId(11), key: 'still-a-draft' })
    );

    const retired = await body<FormDefinitionDto>(
      await send(app, 'POST', `/bff/v0/forms/definitions/${DEFINITION_ID}/retire`, {})
    );
    expect(retired.status).toBe('RETIRED');
    expect(retired.retiredAt).toBe(FIXED_NOW.toISOString());

    const draft = await send(app, 'POST', `/bff/v0/forms/definitions/${testId(11)}/retire`, {});
    expect(draft.status).toBe(409);
  });

  it('takes the retirement instant the caller supplied, and refuses a second retirement', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'FormDefinition', makeFormDefinitionRow({ status: 'PUBLISHED' }));

    const first = await body<FormDefinitionDto>(
      await send(app, 'POST', `/bff/v0/forms/definitions/${DEFINITION_ID}/retire`, {
        retiredAt: '2026-08-02T08:00:00.000Z',
      })
    );
    expect(first.retiredAt).toBe('2026-08-02T08:00:00.000Z');

    const again = await send(app, 'POST', `/bff/v0/forms/definitions/${DEFINITION_ID}/retire`, {});
    expect(again.status).toBe(409);
  });

  it('404s retiring an unknown definition', async () => {
    const { app } = createTestApp();

    expect(
      (await send(app, 'POST', `/bff/v0/forms/definitions/${testId(99)}/retire`, {})).status
    ).toBe(404);
  });
});

/* ------------------------------------------------------- form submissions */

describe('POST /bff/v0/forms/submissions', () => {
  it('records a submission against a published definition', async () => {
    const { app } = formsApp();
    const res = await send(app, 'POST', '/bff/v0/forms/submissions', SUBMISSION_BODY);

    expect(res.status).toBe(201);
    const dto = await body<FormSubmissionDto>(res);
    expect(res.headers.get('location')).toBe(`/bff/v0/forms/submissions/${dto.id}`);
    expect(dto).toMatchObject({
      status: 'IN_PROGRESS',
      completedByType: 'USER',
      encounterId: null,
      values: { systolic: 120 },
    });
    // Mirrors `@default(now())` from the request's clock, not from a second one.
    expect(dto.effectiveAt).toBe(FIXED_NOW.toISOString());
  });

  it('records every optional column it was given', async () => {
    const { app } = formsApp();
    const dto = await body<FormSubmissionDto>(
      await send(app, 'POST', '/bff/v0/forms/submissions', {
        ...SUBMISSION_BODY,
        encounterId: ENCOUNTER_ID,
        status: 'COMPLETED',
        completedByType: 'USER',
        completedByUserId: USER_ID,
        completedAt: '2026-08-13T10:00:00.000Z',
        effectiveAt: '2026-08-12T10:00:00.000Z',
      })
    );

    expect(dto).toMatchObject({
      encounterId: ENCOUNTER_ID,
      status: 'COMPLETED',
      completedByUserId: USER_ID,
      completedAt: '2026-08-13T10:00:00.000Z',
      effectiveAt: '2026-08-12T10:00:00.000Z',
    });
  });

  it('409s a submission pinned to a definition that is still a draft', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'FormDefinition', makeFormDefinitionRow());

    const res = await send(app, 'POST', '/bff/v0/forms/submissions', SUBMISSION_BODY);

    expect(res.status).toBe(409);
    expect((await body<ProblemDocument>(res)).detail).toContain('DRAFT');
    expect(dataset.table('FormSubmission')).toHaveLength(0);
  });

  it('422s a submission pinned to a definition that does not exist', async () => {
    const { app } = createTestApp();
    const res = await send(app, 'POST', '/bff/v0/forms/submissions', SUBMISSION_BODY);

    expect(res.status).toBe(422);
    expect((await body<ProblemDocument>(res)).errors?.[0]?.path).toBe('formDefinitionId');
  });

  it('422s a body that breaks the contract before it looks anything up', async () => {
    const { app } = formsApp();
    const res = await send(app, 'POST', '/bff/v0/forms/submissions', {
      ...SUBMISSION_BODY,
      values: 'not an object',
    });

    expect(res.status).toBe(422);
  });

  it('403s a role without form.write', async () => {
    const { app } = formsApp();

    expect(
      (await send(app, 'POST', '/bff/v0/forms/submissions', SUBMISSION_BODY, UNPRIVILEGED_TOKEN))
        .status
    ).toBe(403);
  });
});

describe('GET /bff/v0/forms/submissions', () => {
  it('narrows by patient, encounter, definition, status and window at once', async () => {
    const { app, dataset } = createTestApp();
    // One row matches; each of the others differs in exactly one column, so
    // every filter is the sole reason something is missing from the answer.
    seed(
      dataset,
      'FormSubmission',
      makeFormSubmissionRow({
        id: testId(21),
        encounterId: ENCOUNTER_ID,
        status: 'SIGNED',
        signedAt: FIXED_NOW,
      }),
      makeFormSubmissionRow({ id: testId(22), patientId: testId(2), status: 'SIGNED' }),
      makeFormSubmissionRow({ id: testId(23), status: 'SIGNED' }),
      makeFormSubmissionRow({
        id: testId(24),
        encounterId: ENCOUNTER_ID,
        formDefinitionId: testId(15),
        status: 'SIGNED',
      }),
      makeFormSubmissionRow({ id: testId(25), encounterId: ENCOUNTER_ID })
    );

    const page = await body<ListResponse<FormSubmissionDto>>(
      await get(
        app,
        `/bff/v0/forms/submissions?patientId=${PATIENT_ID}&encounterId=${ENCOUNTER_ID}` +
          `&formDefinitionId=${DEFINITION_ID}&status=SIGNED` +
          '&from=2026-08-13T00:00:00.000Z&to=2026-08-14T00:00:00.000Z'
      )
    );

    expect(page.data.map((row) => row.id)).toEqual([testId(21)]);
  });

  it('excludes a submission outside the half-open window', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'FormSubmission', makeFormSubmissionRow());

    const page = await body<ListResponse<FormSubmissionDto>>(
      await get(app, '/bff/v0/forms/submissions?to=2026-08-13T09:00:00.000Z')
    );

    expect(page.data).toEqual([]);
  });

  it('sorts by effective instant and by creation', async () => {
    const { app, dataset } = createTestApp();
    seed(
      dataset,
      'FormSubmission',
      makeFormSubmissionRow({ id: testId(20), effectiveAt: new Date('2026-08-10T09:00:00.000Z') }),
      makeFormSubmissionRow({ id: testId(21) })
    );
    const ids = async (query: string): Promise<string[]> =>
      (
        await body<ListResponse<FormSubmissionDto>>(
          await get(app, `/bff/v0/forms/submissions?${query}`)
        )
      ).data.map((row) => row.id);

    expect(await ids('sort=effectiveAt')).toEqual([testId(20), testId(21)]);
    expect(await ids('sort=effectiveAt&order=desc')).toEqual([testId(21), testId(20)]);
    expect(await ids('sort=createdAt')).toHaveLength(2);
  });

  it('reads one submission and 404s an unknown id', async () => {
    const { app } = formsApp();

    const dto = await body<FormSubmissionDto>(
      await get(app, `/bff/v0/forms/submissions/${SUBMISSION_ID}`)
    );
    expect(dto.id).toBe(SUBMISSION_ID);
    expect((await get(app, `/bff/v0/forms/submissions/${testId(99)}`)).status).toBe(404);
  });
});

describe('PATCH /bff/v0/forms/submissions/:id', () => {
  it('saves answers while the form is still being filled in', async () => {
    const { app } = formsApp();

    const dto = await body<FormSubmissionDto>(
      await send(app, 'PATCH', `/bff/v0/forms/submissions/${SUBMISSION_ID}`, {
        values: { systolic: 121 },
      })
    );

    expect(dto.values).toEqual({ systolic: 121 });
  });

  it('amends every other editable column at once', async () => {
    const { app } = formsApp();

    const dto = await body<FormSubmissionDto>(
      await send(app, 'PATCH', `/bff/v0/forms/submissions/${SUBMISSION_ID}`, {
        encounterId: ENCOUNTER_ID,
        completedByType: 'USER',
        completedByUserId: USER_ID,
        effectiveAt: '2026-08-11T09:00:00.000Z',
      })
    );

    expect(dto).toMatchObject({
      encounterId: ENCOUNTER_ID,
      completedByUserId: USER_ID,
      effectiveAt: '2026-08-11T09:00:00.000Z',
    });
  });

  it('refuses to edit the answers of a completed submission in place', async () => {
    const { app, dataset } = createTestApp();
    seed(
      dataset,
      'FormSubmission',
      makeFormSubmissionRow({ status: 'COMPLETED', completedAt: FIXED_NOW })
    );

    const res = await send(app, 'PATCH', `/bff/v0/forms/submissions/${SUBMISSION_ID}`, {
      values: { systolic: 999 },
    });

    expect(res.status).toBe(409);
    expect((await body<ProblemDocument>(res)).errors?.[0]?.path).toBe('values');
  });

  it('marks a submission entered in error from any live state', async () => {
    const { app } = formsApp();

    const dto = await body<FormSubmissionDto>(
      await send(app, 'PATCH', `/bff/v0/forms/submissions/${SUBMISSION_ID}`, {
        status: 'ENTERED_IN_ERROR',
      })
    );

    expect(dto.status).toBe('ENTERED_IN_ERROR');
  });

  it('409s a second correction, because entered-in-error is terminal', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'FormSubmission', makeFormSubmissionRow({ status: 'ENTERED_IN_ERROR' }));

    const res = await send(app, 'PATCH', `/bff/v0/forms/submissions/${SUBMISSION_ID}`, {
      status: 'ENTERED_IN_ERROR',
    });

    expect(res.status).toBe(409);
    expect((await body<ProblemDocument>(res)).type).toBe(
      'https://openrunic.org/problems/invalid-transition'
    );
  });

  it('422s an empty patch and a staff completion with no user', async () => {
    const { app } = formsApp();

    expect(
      (await send(app, 'PATCH', `/bff/v0/forms/submissions/${SUBMISSION_ID}`, {})).status
    ).toBe(422);
    expect(
      (
        await send(app, 'PATCH', `/bff/v0/forms/submissions/${SUBMISSION_ID}`, {
          completedByType: 'USER',
        })
      ).status
    ).toBe(422);
  });

  it('404s an unknown id', async () => {
    const { app } = createTestApp();

    expect(
      (
        await send(app, 'PATCH', `/bff/v0/forms/submissions/${testId(99)}`, {
          status: 'ENTERED_IN_ERROR',
        })
      ).status
    ).toBe(404);
  });
});

/** Each transition, with a state it must refuse and the body it takes. */
const TRANSITIONS: readonly {
  transition: string;
  refusedFrom: ScopedRow<'FormSubmission'>['status'];
  payload: Record<string, unknown>;
}[] = [
  { transition: 'complete', refusedFrom: 'SIGNED', payload: {} },
  { transition: 'sign', refusedFrom: 'IN_PROGRESS', payload: {} },
  { transition: 'amend', refusedFrom: 'COMPLETED', payload: { values: {} } },
];

describe('the form submission lifecycle', () => {
  it('completes, signs and amends, in that order', async () => {
    const { app } = formsApp();
    const url = `/bff/v0/forms/submissions/${SUBMISSION_ID}`;

    const completed = await body<FormSubmissionDto>(
      await send(app, 'POST', `${url}/complete`, {
        completedByType: 'PATIENT',
        completedAt: '2026-08-13T09:30:00.000Z',
      })
    );
    expect(completed).toMatchObject({
      status: 'COMPLETED',
      completedByType: 'PATIENT',
      completedAt: '2026-08-13T09:30:00.000Z',
    });

    const signed = await body<FormSubmissionDto>(
      await send(app, 'POST', `${url}/sign`, { signedAt: '2026-08-13T09:40:00.000Z' })
    );
    expect(signed).toMatchObject({
      status: 'SIGNED',
      signedAt: '2026-08-13T09:40:00.000Z',
      signedById: testId(951),
    });

    const amended = await body<FormSubmissionDto>(
      await send(app, 'POST', `${url}/amend`, {
        values: { systolic: 124 },
        effectiveAt: '2026-08-13T09:45:00.000Z',
      })
    );
    expect(amended).toMatchObject({
      status: 'AMENDED',
      values: { systolic: 124 },
      effectiveAt: '2026-08-13T09:45:00.000Z',
    });

    // An amendment may itself be amended; a second one is another correction.
    expect((await send(app, 'POST', `${url}/amend`, { values: { systolic: 125 } })).status).toBe(
      200
    );
  });

  it('stamps the completion instant and the signature itself when none was supplied', async () => {
    const { app } = formsApp();
    const url = `/bff/v0/forms/submissions/${SUBMISSION_ID}`;

    const completed = await body<FormSubmissionDto>(await send(app, 'POST', `${url}/complete`, {}));
    expect(completed.completedAt).toBe(FIXED_NOW.toISOString());

    const signed = await body<FormSubmissionDto>(await send(app, 'POST', `${url}/sign`, {}));
    expect(signed.signedAt).toBe(FIXED_NOW.toISOString());
  });

  it('names the user a staff completion was recorded by', async () => {
    const { app } = formsApp();

    const dto = await body<FormSubmissionDto>(
      await send(app, 'POST', `/bff/v0/forms/submissions/${SUBMISSION_ID}/complete`, {
        completedByType: 'USER',
        completedByUserId: USER_ID,
      })
    );

    expect(dto.completedByUserId).toBe(USER_ID);
  });

  it('422s a staff completion that names nobody', async () => {
    const { app } = formsApp();

    const res = await send(app, 'POST', `/bff/v0/forms/submissions/${SUBMISSION_ID}/complete`, {
      completedByType: 'USER',
    });

    expect(res.status).toBe(422);
    expect((await body<ProblemDocument>(res)).errors?.[0]?.path).toBe('completedByUserId');
  });

  it.each(TRANSITIONS)(
    '409s $transition from the wrong state',
    async ({ transition, refusedFrom, payload }) => {
      const { app, dataset } = createTestApp();
      seed(dataset, 'FormSubmission', makeFormSubmissionRow({ status: refusedFrom }));

      const res = await send(
        app,
        'POST',
        `/bff/v0/forms/submissions/${SUBMISSION_ID}/${transition}`,
        payload
      );

      expect(res.status).toBe(409);
      expect((await body<ProblemDocument>(res)).type).toBe(
        'https://openrunic.org/problems/invalid-transition'
      );
    }
  );

  it.each(TRANSITIONS)(
    '404s $transition on an unknown submission',
    async ({ transition, payload }) => {
      const { app } = createTestApp();

      expect(
        (await send(app, 'POST', `/bff/v0/forms/submissions/${testId(99)}/${transition}`, payload))
          .status
      ).toBe(404);
    }
  );
});

/* --------------------------------------------------------------- directory */

describe('users', () => {
  it('pages, filters and sorts the directory', async () => {
    const { app, dataset } = createTestApp();
    seed(
      dataset,
      'User',
      makeUserRow({ id: testId(30) }),
      makeUserRow({
        id: testId(31),
        email: 'billy.deskman@clinic.invalid',
        givenName: 'Billy',
        familyName: 'Deskman',
        isProvider: false,
        status: 'INVITED',
      })
    );
    const ids = async (query: string): Promise<string[]> =>
      (await body<ListResponse<UserDto>>(await get(app, `/bff/v0/users?${query}`))).data.map(
        (row) => row.id
      );

    expect(await ids('')).toEqual([testId(31), testId(30)]);
    expect(await ids('status=ACTIVE&isProvider=true&q=okafor')).toEqual([testId(30)]);
    expect(await ids('isProvider=false')).toEqual([testId(31)]);
    expect(await ids('q=clinic.invalid')).toHaveLength(2);
    expect(await ids('sort=email')).toEqual([testId(30), testId(31)]);
    expect(await ids('sort=familyName&order=desc')).toEqual([testId(30), testId(31)]);
    expect(await ids('sort=createdAt')).toHaveLength(2);
  });

  it('reports one empty page for an empty directory', async () => {
    const { app } = createTestApp();

    const page = await body<ListResponse<UserDto>>(await get(app, '/bff/v0/users'));

    expect(page.page).toEqual({ page: 1, pageSize: 25, total: 0, totalPages: 1 });
  });

  it('reads one user and 404s an unknown id', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'User', makeUserRow());

    const dto = await body<UserDto>(await get(app, `/bff/v0/users/${USER_ID}`));
    expect(dto).toMatchObject({ givenName: 'Adaeze', familyName: 'Okafor', credential: 'MD' });
    expect((await get(app, `/bff/v0/users/${testId(99)}`)).status).toBe(404);
  });

  it('never publishes the prescribing registration number', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'User', makeUserRow());

    const dto = await body<UserDto>(await get(app, `/bff/v0/users/${USER_ID}`));

    expect(Object.keys(dto)).not.toContain('dea');
    expect(JSON.stringify(dto)).not.toContain('XO1000004');
  });

  it('creates a user with the schema defaults and points at it', async () => {
    const { app } = createTestApp();
    const res = await send(app, 'POST', '/bff/v0/users', USER_BODY);

    expect(res.status).toBe(201);
    const dto = await body<UserDto>(res);
    expect(res.headers.get('location')).toBe(`/bff/v0/users/${dto.id}`);
    expect(dto).toMatchObject({
      status: 'INVITED',
      locale: 'en-US',
      isProvider: false,
      credential: null,
      npi: null,
      lastLoginAt: null,
    });
  });

  it('creates a user with every optional column', async () => {
    const { app } = createTestApp();
    const dto = await body<UserDto>(
      await send(app, 'POST', '/bff/v0/users', {
        ...USER_BODY,
        credential: 'RN',
        npi: '1000000012',
        dea: 'XT1000012',
        taxonomyCode: '163W00000X',
        isProvider: true,
        locale: 'sv-SE',
        status: 'ACTIVE',
      })
    );

    expect(dto).toMatchObject({
      credential: 'RN',
      npi: '1000000012',
      taxonomyCode: '163W00000X',
      isProvider: true,
      locale: 'sv-SE',
      status: 'ACTIVE',
    });
  });

  it('422s an address that is not an email and 409s the same one twice', async () => {
    const { app } = createTestApp();

    const invalid = await send(app, 'POST', '/bff/v0/users', { ...USER_BODY, email: 'nope' });
    expect(invalid.status).toBe(422);
    expect((await body<ProblemDocument>(invalid)).errors?.[0]?.path).toBe('email');

    expect((await send(app, 'POST', '/bff/v0/users', USER_BODY)).status).toBe(201);
    const clash = await send(app, 'POST', '/bff/v0/users', USER_BODY);
    expect(clash.status).toBe(409);
    expect((await body<ProblemDocument>(clash)).detail).toContain(USER_BODY.email);
  });

  it('amends one column, and every column', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'User', makeUserRow());

    const one = await body<UserDto>(
      await send(app, 'PATCH', `/bff/v0/users/${USER_ID}`, { credential: 'MD, MPH' })
    );
    expect(one).toMatchObject({ credential: 'MD, MPH', status: 'ACTIVE', givenName: 'Adaeze' });

    const another = await body<UserDto>(
      await send(app, 'PATCH', `/bff/v0/users/${USER_ID}`, { locale: 'en-IE' })
    );
    expect(another).toMatchObject({ locale: 'en-IE', credential: 'MD, MPH' });

    const all = await body<UserDto>(
      await send(app, 'PATCH', `/bff/v0/users/${USER_ID}`, {
        givenName: 'Adaeze A.',
        familyName: 'Okafor-Testsson',
        credential: 'MD, PhD',
        npi: '1000000020',
        dea: 'XO1000020',
        taxonomyCode: '208D00000X',
        isProvider: false,
        locale: 'en-GB',
        status: 'DEACTIVATED',
      })
    );
    expect(all).toMatchObject({
      givenName: 'Adaeze A.',
      familyName: 'Okafor-Testsson',
      credential: 'MD, PhD',
      isProvider: false,
      locale: 'en-GB',
      status: 'DEACTIVATED',
    });
  });

  it('422s an empty patch and 404s an unknown id', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'User', makeUserRow());

    expect((await send(app, 'PATCH', `/bff/v0/users/${USER_ID}`, {})).status).toBe(422);
    expect(
      (await send(app, 'PATCH', `/bff/v0/users/${testId(99)}`, { status: 'ACTIVE' })).status
    ).toBe(404);
  });

  it('401s without a token, and 403s a role that cannot write the directory', async () => {
    const { app } = createTestApp();

    expect((await anonymous(app, '/bff/v0/users')).status).toBe(401);
    expect((await send(app, 'POST', '/bff/v0/users', USER_BODY, TOKENS.clinicianA)).status).toBe(
      403
    );
  });
});

describe('roles', () => {
  it('filters by whether the role shipped with the deployment', async () => {
    const { app, dataset } = createTestApp();
    seed(
      dataset,
      'Role',
      makeRoleRow({ id: testId(40) }),
      makeRoleRow({ id: testId(41), key: 'ward-clerk', name: 'Ward clerk', isSystem: false })
    );
    const ids = async (query: string): Promise<string[]> =>
      (await body<ListResponse<RoleDto>>(await get(app, `/bff/v0/roles?${query}`))).data.map(
        (row) => row.id
      );

    expect(await ids('')).toEqual([testId(40), testId(41)]);
    expect(await ids('isSystem=true')).toEqual([testId(40)]);
    expect(await ids('isSystem=false')).toEqual([testId(41)]);
    expect(await ids('sort=name')).toEqual([testId(40), testId(41)]);
    expect(await ids('sort=key&order=desc')).toEqual([testId(41), testId(40)]);
    expect(await ids('sort=createdAt')).toHaveLength(2);
  });

  it('reads one role and 404s an unknown id', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Role', makeRoleRow());

    expect((await body<RoleDto>(await get(app, `/bff/v0/roles/${ROLE_ID}`))).key).toBe('clinician');
    expect((await get(app, `/bff/v0/roles/${testId(99)}`)).status).toBe(404);
  });

  it('creates a role, minimally and fully, and refuses a duplicate key', async () => {
    const { app } = createTestApp();

    const minimal = await send(app, 'POST', '/bff/v0/roles', ROLE_BODY);
    expect(minimal.status).toBe(201);
    const created = await body<RoleDto>(minimal);
    expect(minimal.headers.get('location')).toBe(`/bff/v0/roles/${created.id}`);
    expect(created).toMatchObject({ isSystem: false, description: null });

    const full = await body<RoleDto>(
      await send(app, 'POST', '/bff/v0/roles', {
        key: 'triage-nurse',
        name: 'Triage nurse',
        description: 'Works the walk-in queue.',
        isSystem: true,
      })
    );
    expect(full).toMatchObject({ isSystem: true, description: 'Works the walk-in queue.' });

    const clash = await send(app, 'POST', '/bff/v0/roles', ROLE_BODY);
    expect(clash.status).toBe(409);
    expect((await body<ProblemDocument>(clash)).detail).toContain('ward-clerk');
  });

  it('422s a key that is not kebab-case', async () => {
    const { app } = createTestApp();
    const res = await send(app, 'POST', '/bff/v0/roles', { ...ROLE_BODY, key: 'Ward Clerk' });

    expect(res.status).toBe(422);
    expect((await body<ProblemDocument>(res)).errors?.[0]?.path).toBe('key');
  });

  it('amends the name and the description, and 404s an unknown id', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Role', makeRoleRow());

    const one = await body<RoleDto>(
      await send(app, 'PATCH', `/bff/v0/roles/${ROLE_ID}`, {
        description: 'Charts, orders and results.',
      })
    );
    expect(one).toMatchObject({ description: 'Charts, orders and results.', name: 'Clinician' });

    const both = await body<RoleDto>(
      await send(app, 'PATCH', `/bff/v0/roles/${ROLE_ID}`, {
        name: 'Clinician (all sites)',
        description: 'Charts, orders and results.',
      })
    );
    expect(both.name).toBe('Clinician (all sites)');

    const renamed = await body<RoleDto>(
      await send(app, 'PATCH', `/bff/v0/roles/${ROLE_ID}`, { name: 'Clinician' })
    );
    expect(renamed).toMatchObject({
      name: 'Clinician',
      description: 'Charts, orders and results.',
    });

    expect((await send(app, 'PATCH', `/bff/v0/roles/${ROLE_ID}`, {})).status).toBe(422);
    expect((await send(app, 'PATCH', `/bff/v0/roles/${testId(99)}`, { name: 'x' })).status).toBe(
      404
    );
  });

  it('401s without a token and 403s a role with nothing', async () => {
    const { app } = createTestApp();

    expect((await anonymous(app, '/bff/v0/roles')).status).toBe(401);
    expect((await get(app, '/bff/v0/roles', UNPRIVILEGED_TOKEN)).status).toBe(403);
  });
});

describe("a user's role assignments", () => {
  function directoryApp(): TestApp {
    const harness = createTestApp();
    seed(harness.dataset, 'User', makeUserRow());
    seed(harness.dataset, 'Role', makeRoleRow());
    return harness;
  }

  it('lists the grants a user holds, filtered and unfiltered', async () => {
    const harness = directoryApp();
    seed(
      harness.dataset,
      'RoleAssignment',
      makeRoleAssignmentRow({ id: testId(45) }),
      makeRoleAssignmentRow({
        id: testId(46),
        facilityId: DEMO_FACILITY_A,
        // A distinct instant, because the in-memory tie-break on equal sort
        // values is the id and would make the descending case unprovable.
        createdAt: new Date('2026-08-14T09:00:00.000Z'),
      }),
      makeRoleAssignmentRow({ id: testId(47), userId: testId(31) }),
      // Same user and facility, another role: excluded by the role filter
      // alone, which is the only way that filter is proved.
      makeRoleAssignmentRow({
        id: testId(48),
        roleId: testId(41),
        facilityId: DEMO_FACILITY_A,
        createdAt: new Date('2026-08-15T09:00:00.000Z'),
      })
    );
    const ids = async (query: string): Promise<string[]> =>
      (
        await body<ListResponse<RoleAssignmentDto>>(
          await get(harness.app, `/bff/v0/users/${USER_ID}/roles?${query}`)
        )
      ).data.map((row) => row.id);

    expect(await ids('')).toEqual([testId(45), testId(46), testId(48)]);
    expect(await ids(`roleId=${ROLE_ID}&facilityId=${DEMO_FACILITY_A}`)).toEqual([testId(46)]);
    expect(await ids('sort=createdAt&order=desc')).toEqual([testId(48), testId(46), testId(45)]);
  });

  it('404s an unknown user rather than reporting an empty grant list', async () => {
    const { app } = directoryApp();

    expect((await get(app, `/bff/v0/users/${testId(99)}/roles`)).status).toBe(404);
  });

  it('400s an unknown filter', async () => {
    const { app } = directoryApp();

    expect((await get(app, `/bff/v0/users/${USER_ID}/roles?rolId=x`)).status).toBe(400);
  });

  it('grants a role across the organisation and refuses the same grant twice', async () => {
    const { app } = directoryApp();
    const url = `/bff/v0/users/${USER_ID}/roles`;

    const first = await send(app, 'POST', url, { roleId: ROLE_ID });
    expect(first.status).toBe(201);
    expect(first.headers.get('location')).toBe(url);
    expect(await body<RoleAssignmentDto>(first)).toMatchObject({
      userId: USER_ID,
      roleId: ROLE_ID,
      facilityId: null,
    });

    // Postgres treats NULLs as distinct, so this duplicate is refused by the
    // handler rather than by the unique index.
    const again = await send(app, 'POST', url, { roleId: ROLE_ID });
    expect(again.status).toBe(409);
    expect((await body<ProblemDocument>(again)).detail).toContain('across the organisation');
  });

  it('grants a role at one facility and refuses that grant twice', async () => {
    const { app } = directoryApp();
    const url = `/bff/v0/users/${USER_ID}/roles`;
    const grant = { roleId: ROLE_ID, facilityId: DEMO_FACILITY_A };

    const facilityScoped = await send(app, 'POST', url, grant);
    expect(facilityScoped.status).toBe(201);
    expect((await body<RoleAssignmentDto>(facilityScoped)).facilityId).toBe(DEMO_FACILITY_A);

    const again = await send(app, 'POST', url, grant);
    expect(again.status).toBe(409);
    expect((await body<ProblemDocument>(again)).detail).toContain('at that facility');
  });

  it('keeps the organisation-wide grant and the facility-scoped one apart', async () => {
    const { app } = directoryApp();
    const url = `/bff/v0/users/${USER_ID}/roles`;

    expect((await send(app, 'POST', url, { roleId: ROLE_ID })).status).toBe(201);
    expect(
      (await send(app, 'POST', url, { roleId: ROLE_ID, facilityId: DEMO_FACILITY_A })).status
    ).toBe(201);
  });

  it('404s an unknown user and 422s an unknown role', async () => {
    const { app } = directoryApp();

    expect(
      (await send(app, 'POST', `/bff/v0/users/${testId(99)}/roles`, { roleId: ROLE_ID })).status
    ).toBe(404);

    const unknownRole = await send(app, 'POST', `/bff/v0/users/${USER_ID}/roles`, {
      roleId: testId(99),
    });
    expect(unknownRole.status).toBe(422);
    expect((await body<ProblemDocument>(unknownRole)).errors?.[0]?.path).toBe('roleId');
  });

  it('401s without a token and 403s a role without role.write', async () => {
    const { app } = directoryApp();

    expect((await anonymous(app, `/bff/v0/users/${USER_ID}/roles`)).status).toBe(401);
    expect(
      (
        await send(
          app,
          'POST',
          `/bff/v0/users/${USER_ID}/roles`,
          { roleId: ROLE_ID },
          TOKENS.clinicianA
        )
      ).status
    ).toBe(403);
  });
});

describe('facilities', () => {
  it('filters by activity and free text, and sorts three ways', async () => {
    const { app, dataset } = createTestApp();
    seed(
      dataset,
      'Facility',
      makeFacilityRow({ id: testId(50) }),
      makeFacilityRow({ id: testId(51), name: 'Annexe', code: 'ANX', active: false })
    );
    const ids = async (query: string): Promise<string[]> =>
      (
        await body<ListResponse<FacilityDto>>(await get(app, `/bff/v0/facilities?${query}`))
      ).data.map((row) => row.id);

    expect(await ids('')).toEqual([testId(51), testId(50)]);
    expect(await ids('active=true&q=testville')).toEqual([testId(50)]);
    expect(await ids('active=false')).toEqual([testId(51)]);
    expect(await ids('q=ANX')).toEqual([testId(51)]);
    expect(await ids('sort=code')).toEqual([testId(51), testId(50)]);
    expect(await ids('sort=name&order=desc')).toEqual([testId(50), testId(51)]);
    expect(await ids('sort=createdAt')).toHaveLength(2);
  });

  it('reads one facility and 404s an unknown id', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Facility', makeFacilityRow());

    const dto = await body<FacilityDto>(await get(app, `/bff/v0/facilities/${FACILITY_ID}`));
    expect(dto).toMatchObject({ code: 'TVC', timezone: 'UTC', address: { country: 'US' } });
    expect((await get(app, `/bff/v0/facilities/${testId(99)}`)).status).toBe(404);
  });

  it('creates a facility with the schema defaults, and with every column', async () => {
    const { app } = createTestApp();

    const minimal = await send(app, 'POST', '/bff/v0/facilities', FACILITY_BODY);
    expect(minimal.status).toBe(201);
    const created = await body<FacilityDto>(minimal);
    expect(minimal.headers.get('location')).toBe(`/bff/v0/facilities/${created.id}`);
    expect(created).toMatchObject({
      timezone: 'UTC',
      active: true,
      npi: null,
      posCode: null,
      phone: null,
      address: { line1: null, country: 'US' },
    });

    const full = await body<FacilityDto>(
      await send(app, 'POST', '/bff/v0/facilities', {
        name: 'Testville North',
        code: 'TVN',
        npi: '1000000038',
        posCode: '19',
        timezone: 'Europe/Stockholm',
        addressLine1: '1 Test Street',
        addressLine2: 'Floor 2',
        city: 'Testville',
        state: 'TS',
        postalCode: '00001',
        country: 'SE',
        phone: '+15550100',
        active: false,
      })
    );
    expect(full).toMatchObject({
      npi: '1000000038',
      posCode: '19',
      timezone: 'Europe/Stockholm',
      phone: '+15550100',
      active: false,
      address: {
        line1: '1 Test Street',
        line2: 'Floor 2',
        city: 'Testville',
        state: 'TS',
        postalCode: '00001',
        country: 'SE',
      },
    });
  });

  it('422s a two-letter country that is not two letters, and 409s a duplicate code', async () => {
    const { app } = createTestApp();

    const invalid = await send(app, 'POST', '/bff/v0/facilities', {
      ...FACILITY_BODY,
      country: 'SWE',
    });
    expect(invalid.status).toBe(422);
    expect((await body<ProblemDocument>(invalid)).errors?.[0]?.path).toBe('country');

    expect((await send(app, 'POST', '/bff/v0/facilities', FACILITY_BODY)).status).toBe(201);
    const clash = await send(app, 'POST', '/bff/v0/facilities', FACILITY_BODY);
    expect(clash.status).toBe(409);
    expect((await body<ProblemDocument>(clash)).detail).toContain('TVA');
  });

  it('amends one column, and every column, and 404s an unknown id', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Facility', makeFacilityRow());

    const one = await body<FacilityDto>(
      await send(app, 'PATCH', `/bff/v0/facilities/${FACILITY_ID}`, { phone: '+15550199' })
    );
    expect(one).toMatchObject({ phone: '+15550199', active: true, code: 'TVC' });

    const all = await body<FacilityDto>(
      await send(app, 'PATCH', `/bff/v0/facilities/${FACILITY_ID}`, {
        name: 'Testville Clinic (main)',
        npi: '1000000046',
        posCode: '11',
        timezone: 'Europe/Stockholm',
        addressLine1: '2 Test Street',
        addressLine2: 'Ground floor',
        city: 'Testville',
        state: 'TS',
        postalCode: '00002',
        country: 'SE',
        phone: '+15550101',
        active: true,
      })
    );
    expect(all).toMatchObject({
      name: 'Testville Clinic (main)',
      npi: '1000000046',
      timezone: 'Europe/Stockholm',
      phone: '+15550101',
      active: true,
      address: { line1: '2 Test Street', city: 'Testville', country: 'SE' },
    });

    const closed = await body<FacilityDto>(
      await send(app, 'PATCH', `/bff/v0/facilities/${FACILITY_ID}`, { active: false })
    );
    expect(closed).toMatchObject({ active: false, phone: '+15550101' });

    expect((await send(app, 'PATCH', `/bff/v0/facilities/${FACILITY_ID}`, {})).status).toBe(422);
    expect(
      (await send(app, 'PATCH', `/bff/v0/facilities/${testId(99)}`, { active: true })).status
    ).toBe(404);
  });

  it('401s without a token and 403s a role that cannot write facilities', async () => {
    const { app } = createTestApp();

    expect((await anonymous(app, '/bff/v0/facilities')).status).toBe(401);
    expect(
      (await send(app, 'POST', '/bff/v0/facilities', FACILITY_BODY, TOKENS.clinicianA)).status
    ).toBe(403);
  });
});

/* ------------------------------------------------------------- terminology */

describe('terminology', () => {
  it('filters by system, code, activity and display text, and sorts three ways', async () => {
    const { app, dataset } = createTestApp();
    seed(
      dataset,
      'TerminologyCode',
      makeTerminologyRow({ id: testId(60) }),
      makeTerminologyRow({
        id: testId(61),
        code: '8867-4',
        display: 'Heart rate',
        isActive: false,
      }),
      // The same code from a deployment-local system: excluded by the system
      // filter alone, which is the only way that filter is proved.
      makeTerminologyRow({
        id: testId(62),
        system: LOCAL_CODES,
        code: '8867-4',
        display: 'Heart rate',
        isActive: false,
      })
    );
    const ids = async (query: string): Promise<string[]> =>
      (
        await body<ListResponse<TerminologyCodeDto>>(await get(app, `/bff/v0/terminology?${query}`))
      ).data.map((row) => row.id);

    expect(await ids('')).toEqual([testId(60), testId(61), testId(62)]);
    expect(
      await ids(`system=${encodeURIComponent(LOINC)}&code=8867-4&isActive=false&q=heart`)
    ).toEqual([testId(61)]);
    expect(await ids('isActive=true')).toEqual([testId(60)]);
    expect(await ids('sort=code')).toEqual([testId(60), testId(61), testId(62)]);
    expect(await ids('sort=display&order=desc')).toEqual([testId(61), testId(62), testId(60)]);
    expect(await ids('sort=createdAt')).toHaveLength(3);
  });

  it('reads one code and 404s an unknown id', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'TerminologyCode', makeTerminologyRow());

    const dto = await body<TerminologyCodeDto>(await get(app, `/bff/v0/terminology/${CODE_ID}`));
    expect(dto).toMatchObject({ code: '8302-2', version: '', isActive: true, properties: null });
    expect((await get(app, `/bff/v0/terminology/${testId(99)}`)).status).toBe(404);
  });

  it('loads a code with the schema defaults, and with every column', async () => {
    const { app } = createTestApp();

    const minimal = await send(app, 'POST', '/bff/v0/terminology', CODE_BODY);
    expect(minimal.status).toBe(201);
    const created = await body<TerminologyCodeDto>(minimal);
    expect(minimal.headers.get('location')).toBe(`/bff/v0/terminology/${created.id}`);
    expect(created).toMatchObject({
      version: '',
      isActive: true,
      parentCode: null,
      properties: null,
    });

    const full = await body<TerminologyCodeDto>(
      await send(app, 'POST', '/bff/v0/terminology', {
        ...CODE_BODY,
        version: '2.77',
        parentCode: '8867-0',
        isActive: false,
        properties: { unit: 'beats/min' },
      })
    );
    expect(full).toMatchObject({
      version: '2.77',
      parentCode: '8867-0',
      isActive: false,
      properties: { unit: 'beats/min' },
    });
  });

  it('422s a code with no display, and 409s the same system, code and version twice', async () => {
    const { app } = createTestApp();

    const invalid = await send(app, 'POST', '/bff/v0/terminology', {
      system: LOINC,
      code: '8867-4',
    });
    expect(invalid.status).toBe(422);
    expect((await body<ProblemDocument>(invalid)).errors?.[0]?.path).toBe('display');

    expect((await send(app, 'POST', '/bff/v0/terminology', CODE_BODY)).status).toBe(201);
    const clash = await send(app, 'POST', '/bff/v0/terminology', CODE_BODY);
    expect(clash.status).toBe(409);
    expect((await body<ProblemDocument>(clash)).detail).toContain('8867-4');
  });

  it('treats a different version of the same code as a different row', async () => {
    const { app } = createTestApp();

    expect((await send(app, 'POST', '/bff/v0/terminology', CODE_BODY)).status).toBe(201);
    expect(
      (await send(app, 'POST', '/bff/v0/terminology', { ...CODE_BODY, version: '2.77' })).status
    ).toBe(201);
  });

  it('amends the display, and every amendable column, and 404s an unknown id', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'TerminologyCode', makeTerminologyRow());

    const one = await body<TerminologyCodeDto>(
      await send(app, 'PATCH', `/bff/v0/terminology/${CODE_ID}`, { isActive: false })
    );
    expect(one).toMatchObject({ isActive: false, display: 'Body height', code: '8302-2' });

    const all = await body<TerminologyCodeDto>(
      await send(app, 'PATCH', `/bff/v0/terminology/${CODE_ID}`, {
        display: 'Body height',
        parentCode: '8302-0',
        isActive: false,
        properties: { unit: 'cm' },
      })
    );
    expect(all).toMatchObject({
      parentCode: '8302-0',
      isActive: false,
      properties: { unit: 'cm' },
    });

    const relabelled = await body<TerminologyCodeDto>(
      await send(app, 'PATCH', `/bff/v0/terminology/${CODE_ID}`, { display: 'Height' })
    );
    expect(relabelled).toMatchObject({ display: 'Height', isActive: false });

    expect((await send(app, 'PATCH', `/bff/v0/terminology/${CODE_ID}`, {})).status).toBe(422);
    expect(
      (await send(app, 'PATCH', `/bff/v0/terminology/${testId(99)}`, { display: 'x' })).status
    ).toBe(404);
  });

  it('401s without a token and 403s a role that cannot load code sets', async () => {
    const { app } = createTestApp();

    expect((await anonymous(app, '/bff/v0/terminology')).status).toBe(401);
    expect(
      (await send(app, 'POST', '/bff/v0/terminology', CODE_BODY, TOKENS.clinicianA)).status
    ).toBe(403);
  });
});

describe('GET /bff/v0/terminology/lookup', () => {
  it('resolves a loaded code rather than being read as an id', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'TerminologyCode', makeTerminologyRow());

    const res = await get(
      app,
      `/bff/v0/terminology/lookup?system=${encodeURIComponent(LOINC)}&code=8302-2`
    );

    // The literal route is registered before the collection's `/:id`, so this
    // is a lookup and not a malformed-id rejection.
    expect(res.status).toBe(200);
    expect(await body<TerminologyLookupDto>(res)).toEqual({
      system: LOINC,
      code: '8302-2',
      display: 'Body height',
      version: '',
      isActive: true,
    });
  });

  it('404s a code the deployment has not loaded, which degrades display and never data', async () => {
    const { app } = createTestApp();
    const res = await get(
      app,
      `/bff/v0/terminology/lookup?system=${encodeURIComponent(LOINC)}&code=99999-9`
    );

    expect(res.status).toBe(404);
    expect((await body<ProblemDocument>(res)).detail).toContain('99999-9');
  });

  it('400s a lookup with no code at all', async () => {
    const { app } = createTestApp();

    expect(
      (await get(app, `/bff/v0/terminology/lookup?system=${encodeURIComponent(LOINC)}`)).status
    ).toBe(400);
  });

  it('403s a role without terminology.read', async () => {
    const { app } = createTestApp();

    expect(
      (
        await get(
          app,
          `/bff/v0/terminology/lookup?system=${encodeURIComponent(LOINC)}&code=8302-2`,
          UNPRIVILEGED_TOKEN
        )
      ).status
    ).toBe(403);
  });
});

/* ------------------------------------------------------------------- audit */

/** The first event on a tenant's chain, which the fixture requests guarantee. */
function firstEvent(store: AuditChainStore, tenantId: string): StoredAuditEvent {
  const [event] = store.chain(tenantId);
  if (event === undefined) {
    throw new Error('the chain is empty: the fixture requests were not audited');
  }
  return event;
}

/** Makes real traffic, so the chain under test is one the app actually wrote. */
async function auditedApp(): Promise<TestApp> {
  const harness = createTestApp();
  seed(harness.dataset, 'Facility', makeFacilityRow());
  await get(harness.app, `/bff/v0/facilities/${FACILITY_ID}`);
  await send(harness.app, 'POST', '/bff/v0/users', USER_BODY);
  await get(harness.app, '/bff/v0/facilities', UNPRIVILEGED_TOKEN);
  return harness;
}

describe('the audit log and the caller\u2019s facilities', () => {
  /**
   * An auditor confined to one site should read that site's log, and not the
   * organisation's. The events themselves carry `facilityId` - where the act
   * happened - so this is a containment boundary rather than an attribution,
   * and narrowing on it is the same rule every row repository already applies.
   */
  function seedSitedEvents(store: AuditChainStore): void {
    const base = {
      actorType: 'user' as const,
      actorId: testId(900),
      actorDisplay: 'Adaeze Okafor',
      action: 'PATIENT_READ',
      targetType: 'Patient',
      purposeOfUse: 'TREAT',
      outcome: 'success' as const,
      metadata: {},
    };
    store.append(
      DEMO_TENANT_A,
      { ...base, targetId: testId(1), facilityId: DEMO_FACILITY_A },
      FIXED_NOW
    );
    store.append(
      DEMO_TENANT_A,
      { ...base, targetId: testId(2), facilityId: DEMO_FACILITY_B },
      FIXED_NOW
    );
    // No facility at all: an act that was not sited. It has to stay visible,
    // for the same reason a null facility stays visible on every other table -
    // hiding it would empty the page of exactly the organisation-wide events an
    // auditor most needs to see.
    store.append(DEMO_TENANT_A, { ...base, targetId: testId(3) }, FIXED_NOW);
  }

  it('shows a site-confined auditor their own site and the unsited events', async () => {
    const { app, auditStore } = createTestApp();
    seedSitedEvents(auditStore);

    const page = await body<ListResponse<AuditEventDto>>(
      await get(app, '/bff/v0/audit?pageSize=50', TOKENS.siteReaderA)
    );

    const targets = page.data.map((event) => event.targetId);
    expect(targets).toContain(testId(1));
    expect(targets).toContain(testId(3));
    // The other site's event is the one that must not be there. `read-only`
    // holds audit.read and not facility.all, so before this narrowing a site
    // auditor read the whole organisation's log.
    expect(targets).not.toContain(testId(2));
  });

  it('shows an organisation-wide auditor everything', async () => {
    const { app, auditStore } = createTestApp();
    seedSitedEvents(auditStore);

    const page = await body<ListResponse<AuditEventDto>>(
      await get(app, '/bff/v0/audit?pageSize=50')
    );

    // The narrowing is a floor for callers who lack facility.all, not a new
    // restriction on the ones who hold it. Without this, a clause that matched
    // nothing would satisfy the assertion above.
    const targets = page.data.map((event) => event.targetId);
    expect(targets).toContain(testId(1));
    expect(targets).toContain(testId(2));
  });

  it('hides another site\u2019s event from a by-id read as well as from the list', async () => {
    const { app, auditStore } = createTestApp();
    seedSitedEvents(auditStore);
    const all = await body<ListResponse<AuditEventDto>>(
      await get(app, '/bff/v0/audit?pageSize=50')
    );
    const other = all.data.find((event) => event.targetId === testId(2));
    expect(other, 'the facility-B event should exist for an admin').toBeDefined();

    const res = await get(app, `/bff/v0/audit/${other?.id ?? ''}`, TOKENS.siteReaderA);

    // 404 rather than 403: a distinguishable refusal would confirm the event
    // exists, which on an audit log tells the caller an act happened at a site
    // they cannot see.
    expect(res.status).toBe(404);
  });
});

describe('GET /bff/v0/audit', () => {
  it('returns the events this process wrote, newest first', async () => {
    const { app } = await auditedApp();

    const page = await body<ListResponse<AuditEventDto>>(await get(app, '/bff/v0/audit'));

    expect(page.page.total).toBeGreaterThan(2);
    const actions = page.data.map((event) => event.action);
    expect(actions).toContain('user.created');
    expect(actions).toContain('authorisation.denied');
    const sequences = page.data.map((event) => Number(event.seq));
    expect(sequences).toEqual([...sequences].sort((a, b) => b - a));
  });

  it('renders the chain position as a decimal string, never as a number', async () => {
    const { app } = await auditedApp();

    const page = await body<ListResponse<AuditEventDto>>(
      await get(app, '/bff/v0/audit?sort=seq&order=asc&pageSize=1')
    );

    expect(page.data[0]?.seq).toBe('1');
  });

  it('filters by actor, action, target, outcome, breakglass and a half-open window', async () => {
    const { app } = await auditedApp();
    const total = async (query: string): Promise<number> =>
      (await body<ListResponse<AuditEventDto>>(await get(app, `/bff/v0/audit?${query}`))).page
        .total;

    expect(await total('action=user.created')).toBe(1);
    expect(await total('targetType=User')).toBeGreaterThan(0);
    expect(await total(`actorId=${testId(951)}`)).toBeGreaterThan(0);
    expect(await total('outcome=failure')).toBe(1);
    expect(await total('breakglass=true')).toBe(0);
    expect(await total('breakglass=false')).toBeGreaterThan(0);
    expect(await total('from=2026-08-13T00:00:00.000Z')).toBeGreaterThan(0);
    expect(await total('to=2026-08-13T09:00:00.000Z')).toBe(0);
    expect(await total(`patientId=${PATIENT_ID}`)).toBe(0);

    const denial = await body<ListResponse<AuditEventDto>>(
      await get(app, '/bff/v0/audit?action=authorisation.denied')
    );
    const targetId = denial.data[0]?.targetId ?? '';
    expect(await total(`targetId=${encodeURIComponent(targetId)}`)).toBeGreaterThan(0);
  });

  it('400s a filter nobody declared', async () => {
    const { app } = createTestApp();

    expect((await get(app, '/bff/v0/audit?acton=x')).status).toBe(400);
  });

  it('is itself audited: reading the log leaves a record of the read', async () => {
    const { app, sink } = await auditedApp();

    await get(app, '/bff/v0/audit');

    const read = sink.reads().at(-1);
    expect(read?.event.metadata.targets).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'AuditEvent' })])
    );
  });

  it('401s without a token and 403s every role but the administrator', async () => {
    const { app } = createTestApp();

    expect((await anonymous(app, '/bff/v0/audit')).status).toBe(401);
    const denied = await get(app, '/bff/v0/audit', TOKENS.clinicianA);
    expect(denied.status).toBe(403);
    expect((await body<ProblemDocument>(denied)).detail).toContain('audit.read');
  });
});

describe('GET /bff/v0/audit/:id', () => {
  it('reads one event', async () => {
    const { app, auditStore } = await auditedApp();
    const event = firstEvent(auditStore, DEMO_TENANT_A);

    const dto = await body<AuditEventDto>(await get(app, `/bff/v0/audit/${event.id}`));

    expect(dto).toMatchObject({ id: event.id, seq: event.seq.toString(), hash: event.hash });
  });

  it('404s an unknown id', async () => {
    const { app } = await auditedApp();

    expect((await get(app, `/bff/v0/audit/${testId(99)}`)).status).toBe(404);
  });
});

describe('GET /bff/v0/audit/verify', () => {
  it('resolves as a verification rather than as an event id', async () => {
    const { app } = await auditedApp();
    const res = await get(app, '/bff/v0/audit/verify');

    // The literal route is registered before `/audit/:id`, so `verify` is not
    // read as a malformed event id.
    expect(res.status).toBe(200);
    const report = await body<AuditVerificationDto>(res);
    expect(report).toMatchObject({ valid: true, brokenAtSeq: null, reason: null });
    expect(report.checked).toBeGreaterThan(2);
    expect(report.tailSeq).toBe(String(report.checked));
  });

  it('reports an intact but empty chain', async () => {
    const { app } = createTestApp();

    const report = await body<AuditVerificationDto>(await get(app, '/bff/v0/audit/verify'));

    expect(report).toEqual({
      valid: true,
      checked: 0,
      tailSeq: null,
      brokenAtSeq: null,
      reason: null,
    });
  });

  it('catches a past event that was edited behind the API', async () => {
    const { app, auditStore } = await auditedApp();
    const target = firstEvent(auditStore, DEMO_TENANT_A);

    // Reaching into the store is the only way to produce a tampered chain,
    // which is exactly the point: the API has no endpoint that can write an
    // audit event, so a break can only come from outside it.
    Object.assign(target, { action: 'nothing.happened' });

    const report = await body<AuditVerificationDto>(await get(app, '/bff/v0/audit/verify'));

    expect(report.valid).toBe(false);
    expect(report.brokenAtSeq).toBe(target.seq.toString());
    expect(report.reason).toBe('hash-mismatch');
    expect(report.tailSeq).toBeNull();
  });

  it('403s a role without audit.read', async () => {
    const { app } = createTestApp();

    expect((await get(app, '/bff/v0/audit/verify', TOKENS.frontDeskA)).status).toBe(403);
  });
});

/* -------------------------------------------------- the Prisma projection */

/**
 * `matches` and `where` are the same filter written twice, and only one of them
 * runs in the suite above: the in-memory store never builds a Prisma `where`,
 * and neither implementation calls `orderBy` outside Postgres. These assertions
 * are what keeps the unrun half honest. No database is involved; the spec
 * functions are pure.
 */
describe('every filter has a matching Prisma projection', () => {
  const base = { page: 1, pageSize: 25, order: 'asc' as const };
  const ROW_CONTEXT: RowContext = {
    tenantId: DEMO_TENANT_A,
    now: FIXED_NOW,
    nextId: () => testId(1),
  };

  it('projects form definitions', () => {
    expect(
      formDefinitionSpec.where({
        ...base,
        sort: 'key',
        key: 'intake-history',
        status: 'PUBLISHED',
        bindTo: 'PORTAL',
      })
    ).toEqual({ key: 'intake-history', status: 'PUBLISHED', bindTo: 'PORTAL' });
    expect(formDefinitionSpec.where({ ...base, sort: 'key' })).toEqual({});
    expect(formDefinitionSpec.orderBy({ ...base, sort: 'key' })).toEqual([
      { key: 'asc' },
      { version: 'asc' },
      { id: 'asc' },
    ]);
    expect(formDefinitionSpec.orderBy({ ...base, sort: 'version' })).toEqual([
      { version: 'asc' },
      { id: 'asc' },
    ]);
    expect(formDefinitionSpec.orderBy({ ...base, sort: 'createdAt' })).toEqual([
      { createdAt: 'asc' },
      { id: 'asc' },
    ]);
    expect(
      formDefinitionSpec.uniqueBy?.where({
        key: 'intake-history',
        version: 2,
        title: 'Intake history',
        bindTo: 'ENCOUNTER',
        definition: {},
      })
    ).toEqual({ key: 'intake-history', version: 2 });
  });

  it('projects form submissions', () => {
    expect(
      formSubmissionSpec.where({
        ...base,
        sort: 'effectiveAt',
        patientId: PATIENT_ID,
        encounterId: ENCOUNTER_ID,
        formDefinitionId: DEFINITION_ID,
        status: 'SIGNED',
        from: FIXED_NOW,
        to: FIXED_NOW,
      })
    ).toEqual({
      patientId: PATIENT_ID,
      encounterId: ENCOUNTER_ID,
      formDefinitionId: DEFINITION_ID,
      status: 'SIGNED',
      effectiveAt: { gte: FIXED_NOW, lt: FIXED_NOW },
    });
    expect(formSubmissionSpec.where({ ...base, sort: 'effectiveAt' })).toEqual({});
    expect(formSubmissionSpec.orderBy({ ...base, sort: 'effectiveAt' })).toEqual([
      { effectiveAt: 'asc' },
      { id: 'asc' },
    ]);
    expect(formSubmissionSpec.orderBy({ ...base, sort: 'createdAt' })).toEqual([
      { createdAt: 'asc' },
      { id: 'asc' },
    ]);
  });

  it('projects users', () => {
    expect(
      userSpec.where({ ...base, sort: 'familyName', status: 'ACTIVE', isProvider: true, q: 'oka' })
    ).toMatchObject({
      status: 'ACTIVE',
      isProvider: true,
      OR: [
        { givenName: { contains: 'oka', mode: 'insensitive' } },
        { familyName: { contains: 'oka', mode: 'insensitive' } },
        { email: { contains: 'oka', mode: 'insensitive' } },
      ],
    });
    expect(userSpec.where({ ...base, sort: 'familyName' })).toEqual({});
    expect(userSpec.orderBy({ ...base, sort: 'familyName' })).toEqual([
      { familyName: 'asc' },
      { givenName: 'asc' },
      { id: 'asc' },
    ]);
    expect(userSpec.orderBy({ ...base, sort: 'email' })).toEqual([{ email: 'asc' }, { id: 'asc' }]);
    expect(userSpec.orderBy({ ...base, sort: 'createdAt' })).toEqual([
      { createdAt: 'asc' },
      { id: 'asc' },
    ]);
    expect(
      userSpec.uniqueBy?.where({
        email: USER_BODY.email,
        givenName: 'Testina',
        familyName: 'Staffsson',
      })
    ).toEqual({ email: USER_BODY.email });
  });

  it('projects roles', () => {
    expect(roleSpec.where({ ...base, sort: 'key', isSystem: true })).toEqual({ isSystem: true });
    expect(roleSpec.where({ ...base, sort: 'key' })).toEqual({});
    expect(roleSpec.orderBy({ ...base, sort: 'key' })).toEqual([{ key: 'asc' }, { id: 'asc' }]);
    expect(roleSpec.orderBy({ ...base, sort: 'name' })).toEqual([{ name: 'asc' }, { id: 'asc' }]);
    expect(roleSpec.orderBy({ ...base, sort: 'createdAt' })).toEqual([
      { createdAt: 'asc' },
      { id: 'asc' },
    ]);
    expect(roleSpec.uniqueBy?.where({ key: 'ward-clerk', name: 'Ward clerk' })).toEqual({
      key: 'ward-clerk',
    });
  });

  it('projects role assignments, which nothing may amend', () => {
    expect(
      roleAssignmentSpec.where({
        ...base,
        sort: 'createdAt',
        userId: USER_ID,
        roleId: ROLE_ID,
        facilityId: DEMO_FACILITY_A,
      })
    ).toEqual({ userId: USER_ID, roleId: ROLE_ID, facilityId: DEMO_FACILITY_A });
    expect(roleAssignmentSpec.where({ ...base, sort: 'createdAt' })).toEqual({});
    expect(roleAssignmentSpec.orderBy({ ...base, sort: 'createdAt' })).toEqual([
      { createdAt: 'asc' },
      { id: 'asc' },
    ]);
    expect(roleAssignmentSpec.sortValue(makeRoleAssignmentRow(), 'createdAt')).toBe(
      FIXED_NOW.getTime()
    );
    expect(roleAssignmentSpec.patchData({}, makeRoleAssignmentRow(), ROW_CONTEXT)).toEqual({});
  });

  it('projects facilities', () => {
    expect(facilitySpec.where({ ...base, sort: 'name', active: true, q: 'test' })).toMatchObject({
      active: true,
      OR: [
        { name: { contains: 'test', mode: 'insensitive' } },
        { code: { contains: 'test', mode: 'insensitive' } },
      ],
    });
    expect(facilitySpec.where({ ...base, sort: 'name' })).toEqual({});
    expect(facilitySpec.orderBy({ ...base, sort: 'name' })).toEqual([
      { name: 'asc' },
      { id: 'asc' },
    ]);
    expect(facilitySpec.orderBy({ ...base, sort: 'code' })).toEqual([
      { code: 'asc' },
      { id: 'asc' },
    ]);
    expect(facilitySpec.orderBy({ ...base, sort: 'createdAt' })).toEqual([
      { createdAt: 'asc' },
      { id: 'asc' },
    ]);
    expect(facilitySpec.uniqueBy?.where({ name: 'Testville Annexe', code: 'TVA' })).toEqual({
      code: 'TVA',
    });
  });

  it('projects terminology', () => {
    expect(
      terminologyCodeSpec.where({
        ...base,
        sort: 'display',
        system: LOINC,
        code: '8302-2',
        isActive: true,
        q: 'height',
      })
    ).toEqual({
      system: LOINC,
      code: '8302-2',
      isActive: true,
      display: { contains: 'height', mode: 'insensitive' },
    });
    expect(terminologyCodeSpec.where({ ...base, sort: 'display' })).toEqual({});
    expect(terminologyCodeSpec.orderBy({ ...base, sort: 'display' })).toEqual([
      { display: 'asc' },
      { id: 'asc' },
    ]);
    expect(terminologyCodeSpec.orderBy({ ...base, sort: 'code' })).toEqual([
      { code: 'asc' },
      { id: 'asc' },
    ]);
    expect(terminologyCodeSpec.orderBy({ ...base, sort: 'createdAt' })).toEqual([
      { createdAt: 'asc' },
      { id: 'asc' },
    ]);
    // An unversioned load takes the empty string rather than NULL, so that the
    // version really does take part in the natural key.
    expect(
      terminologyCodeSpec.uniqueBy?.where({ system: LOINC, code: '8302-2', display: 'Body height' })
    ).toEqual({ system: LOINC, code: '8302-2', version: '' });
    expect(
      terminologyCodeSpec.uniqueBy?.where({
        system: LOINC,
        code: '8302-2',
        display: 'Body height',
        version: '2.77',
      })
    ).toEqual({ system: LOINC, code: '8302-2', version: '2.77' });
  });
});

describe('the published contracts', () => {
  it('gives every operation a unique id and names the permission it needs', () => {
    const contracts = platformRouteContracts();
    const ids = contracts.map((contract) => contract.operationId);

    expect(new Set(ids).size).toBe(ids.length);
    expect(contracts.every((contract) => contract.permission !== undefined)).toBe(true);
  });

  it('documents the transitions, the nested grants, the lookup and the audit query', () => {
    const paths = platformRouteContracts().map((contract) => `${contract.method} ${contract.path}`);

    expect(paths).toEqual(
      expect.arrayContaining([
        'post /bff/v0/forms/definitions/{id}/publish',
        'post /bff/v0/forms/definitions/{id}/retire',
        'post /bff/v0/forms/submissions/{id}/complete',
        'post /bff/v0/forms/submissions/{id}/sign',
        'post /bff/v0/forms/submissions/{id}/amend',
        'get /bff/v0/users/{id}/roles',
        'post /bff/v0/users/{id}/roles',
        'get /bff/v0/terminology/lookup',
        'get /bff/v0/audit',
        'get /bff/v0/audit/verify',
        'get /bff/v0/audit/{id}',
      ])
    );
  });

  it('publishes no way at all to write the audit log', async () => {
    const audit = platformRouteContracts().filter((contract) =>
      contract.path.startsWith('/bff/v0/audit')
    );
    expect(audit).not.toHaveLength(0);
    expect(audit.every((contract) => contract.method === 'get')).toBe(true);

    // And mounts none either: an endpoint that could insert an audit event
    // would let an actor forge their own alibi.
    const { app } = createTestApp();
    expect((await send(app, 'POST', '/bff/v0/audit', {})).status).toBe(404);
  });
});
