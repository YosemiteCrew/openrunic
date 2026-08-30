import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { Principal } from '../auth/principal.js';
import type { AppEnv } from '../context.js';
import { ApiError, isApiError } from '../errors.js';
import { problemResponse } from '../http/problem.js';
import type { PolicyContext } from '../policy/policy.js';
import type { BaseQuery, Collection } from '../repositories/collection.js';
import type { Repositories } from '../repositories/types.js';
import {
  assertTransition,
  CONFLICT_RESPONSE,
  CRUD_ERRORS,
  type CrudModule,
  defineCrud,
  NOT_FOUND_RESPONSE,
  UNPROCESSABLE_RESPONSE,
} from '../routes/crud.js';

import { testId } from './support.js';

/**
 * Direct harness tests for the shared CRUD factory.
 *
 * `defineCrud` mounts two dozen aggregates, so its own branches - the facility
 * guard, the `Location` header, the 404-not-403 rule - are exercised through
 * every aggregate's route suite. What those suites cannot reach are the seams
 * the factory keeps for when an aggregate is wired wrong: a repository that
 * returns a row with no id, a facility a stored row belongs to that the
 * principal has no grant for. Reproducing those against a real repository would
 * mean corrupting one, so instead this file drives the factory over a fake
 * `Collection` whose every method is a stub the test controls, mounted behind a
 * middleware that seeds the context the real chain would have seeded. Synthetic
 * ids throughout, per the repo's hard rule.
 */

/** The row this fake aggregate stores. `facilityId` drives the guard branches. */
interface Widget {
  id: string;
  facilityId: string | null;
  name: string;
}

interface WidgetCreate {
  facilityId: string | null;
  name: string;
}

interface WidgetPatch {
  name?: string;
}

const listQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).default(25),
  sort: z.string().default('id'),
  order: z.enum(['asc', 'desc']).default('asc'),
});

const createSchema = z.strictObject({
  name: z.string(),
  facilityId: z.string().nullable().default(null),
});

const patchSchema = z.strictObject({ name: z.string().optional() });

const dtoSchema = z.strictObject({
  id: z.string(),
  facilityId: z.string().nullable(),
  name: z.string(),
});

/**
 * A `Collection` whose methods default to the least interesting answer - an
 * empty page, a missing row, an echo create - and whose behaviour any one test
 * overrides for the branch it is after.
 */
function fakeCollection(
  overrides: Partial<Collection<Widget, WidgetCreate, WidgetPatch, BaseQuery>> = {}
): Collection<Widget, WidgetCreate, WidgetPatch, BaseQuery> {
  return {
    list: () => Promise.resolve({ rows: [], total: 0, page: 1, pageSize: 25 }),
    findById: () => Promise.resolve(null),
    findByIds: () => Promise.resolve([]),
    create: (input) =>
      Promise.resolve({ id: testId(1), facilityId: input.facilityId, name: input.name }),
    update: () => Promise.resolve(null),
    ...overrides,
  };
}

/**
 * Turns a fake collection into a mounted module. The facility hooks and the
 * two contract-shaping fields are optional so a route test can leave them off
 * and a contract test can turn them on.
 */
function defineWidgets(
  collection: Collection<Widget, WidgetCreate, WidgetPatch, BaseQuery>,
  hooks: {
    facilityOfRow?: (row: Widget) => string | null;
    facilityOfInput?: (input: WidgetCreate) => string | null;
    listDescription?: string;
    writeResponses?: readonly { status: number; description: string }[];
  } = {}
): CrudModule {
  return defineCrud<
    Widget,
    WidgetCreate,
    WidgetPatch,
    BaseQuery,
    BaseQuery,
    WidgetCreate,
    WidgetPatch,
    Widget
  >({
    segment: 'widgets',
    singular: 'widget',
    plural: 'widgets',
    tag: 'Widgets',
    operation: 'Widget',
    readPermission: 'patient.read',
    writePermission: 'patient.write',
    collection: () => collection,
    listQuerySchema,
    toQuery: (input) => input,
    createSchema,
    toCreate: (body) => body,
    patchSchema,
    toPatch: (body) => body,
    dtoSchema,
    toDto: (row) => row,
    ...hooks,
  });
}

const PRINCIPAL: Principal = {
  subject: testId(900),
  tenantId: testId(1),
  actorType: 'user',
  roles: [],
  facilityIds: [],
  scopes: [],
  purposeOfUse: 'TREAT',
};

/**
 * A policy that grants every capability - so `requirePermission` is never the
 * reason a request fails here - while its facility answer stays configurable,
 * because the facility guard is exactly the branch under test.
 */
function stubPolicy(
  canAccessFacility: (facilityId: string) => boolean = () => true
): PolicyContext {
  return {
    roles: [],
    permissions: new Set(),
    facilityIds: [],
    can: () => true,
    canAccessFacility,
  };
}

interface Mounted {
  app: Hono<AppEnv>;
  /** The last non-`ApiError` the error boundary saw, for the wiring assertions. */
  captured: { error: unknown };
}

/**
 * Mounts the module behind a middleware that seeds exactly what the real chain
 * seeds - a principal, a policy, the tenant-bound repositories - and an error
 * boundary that renders an `ApiError` as its problem document but records
 * anything else and answers 500, so a thrown wiring assertion is observable
 * rather than swallowed.
 */
function mount(module: CrudModule, policy: PolicyContext = stubPolicy()): Mounted {
  const captured: { error: unknown } = { error: undefined };
  const app = new Hono<AppEnv>();

  app.use(async (c, next) => {
    c.set('principal', PRINCIPAL);
    c.set('policy', policy);
    // The fake collection ignores its registry argument, so an empty object is
    // all the tenant-scope middleware needs to have supplied.
    c.set('repositories', {} as Repositories);
    await next();
  });

  app.route('/bff/v0', module.routes);

  app.onError((error, c) => {
    if (isApiError(error)) return problemResponse(c, error);
    captured.error = error;
    return c.body(null, 500);
  });

  return { app, captured };
}

describe('list', () => {
  it('answers 200 with the paging envelope', async () => {
    const row: Widget = { id: testId(1), facilityId: null, name: 'Splint' };
    const { app } = mount(
      defineWidgets(
        fakeCollection({
          list: () => Promise.resolve({ rows: [row], total: 1, page: 1, pageSize: 25 }),
        })
      )
    );

    const response = await app.request('/bff/v0/widgets');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: Widget[]; page: { total: number } };
    expect(body.data).toHaveLength(1);
    expect(body.page.total).toBe(1);
  });
});

describe('read', () => {
  it('answers 200 for a row in scope', async () => {
    const row: Widget = { id: testId(1), facilityId: null, name: 'Splint' };
    const { app } = mount(defineWidgets(fakeCollection({ findById: () => Promise.resolve(row) })));

    const response = await app.request(`/bff/v0/widgets/${testId(1)}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(row);
  });

  it('answers 404 when the repository resolves null', async () => {
    const { app } = mount(defineWidgets(fakeCollection()));

    const response = await app.request(`/bff/v0/widgets/${testId(1)}`);
    expect(response.status).toBe(404);
  });

  it('answers 403 when the stored row belongs to a facility the principal cannot see', async () => {
    const facility = testId(700);
    const row: Widget = { id: testId(1), facilityId: facility, name: 'Splint' };
    const { app } = mount(
      defineWidgets(fakeCollection({ findById: () => Promise.resolve(row) }), {
        facilityOfRow: (r) => r.facilityId,
      }),
      stubPolicy((id) => id !== facility)
    );

    const response = await app.request(`/bff/v0/widgets/${testId(1)}`);
    expect(response.status).toBe(403);
  });
});

describe('create', () => {
  it('answers 201 with a Location header naming the new row', async () => {
    const { app } = mount(defineWidgets(fakeCollection()));

    const response = await app.request('/bff/v0/widgets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Splint' }),
    });
    expect(response.status).toBe(201);
    expect(response.headers.get('Location')).toBe(`/bff/v0/widgets/${testId(1)}`);
  });

  it('refuses before the write when the input names a facility the principal cannot see', async () => {
    const facility = testId(700);
    const { app } = mount(
      defineWidgets(fakeCollection(), { facilityOfInput: (input) => input.facilityId }),
      stubPolicy((id) => id !== facility)
    );

    const response = await app.request('/bff/v0/widgets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Splint', facilityId: facility }),
    });
    expect(response.status).toBe(403);
  });

  it('surfaces a repository that returns a row with no string id as a TypeError', async () => {
    // rowId() builds the Location header, and it is the one place the factory
    // assumes the storage layer honoured its own contract. A repository that
    // returned an unkeyed row is a bug in that repository, not a client error,
    // so it throws rather than shipping a malformed header.
    const badRow = { id: 42, facilityId: null, name: 'Splint' } as unknown as Widget;
    const { app, captured } = mount(
      defineWidgets(fakeCollection({ create: () => Promise.resolve(badRow) }))
    );

    const response = await app.request('/bff/v0/widgets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Splint' }),
    });
    expect(response.status).toBe(500);
    expect(captured.error).toBeInstanceOf(TypeError);
  });
});

describe('update', () => {
  it('answers 200 after amending an existing row', async () => {
    const existing: Widget = { id: testId(1), facilityId: null, name: 'Splint' };
    const amended: Widget = { ...existing, name: 'Cast' };
    const { app } = mount(
      defineWidgets(
        fakeCollection({
          findById: () => Promise.resolve(existing),
          update: () => Promise.resolve(amended),
        })
      )
    );

    const response = await app.request(`/bff/v0/widgets/${testId(1)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Cast' }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(amended);
  });

  it('answers 404 when there is no row to amend', async () => {
    const { app } = mount(defineWidgets(fakeCollection()));

    const response = await app.request(`/bff/v0/widgets/${testId(1)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Cast' }),
    });
    expect(response.status).toBe(404);
  });
});

describe('assertTransition', () => {
  const table = { draft: ['submitted'], submitted: [] } as const;

  it('allows a move the table lists', () => {
    expect(() => assertTransition(table, 'claim', 'draft', 'submitted')).not.toThrow();
  });

  it('refuses a move the table omits with a typed 409', () => {
    try {
      assertTransition(table, 'claim', 'submitted', 'draft');
      expect.unreachable('assertTransition must throw on a disallowed move');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(409);
      expect((error as ApiError).kind).toBe('invalid-transition');
    }
  });
});

describe('contracts', () => {
  it('carries the list description and the aggregate-specific write statuses through', () => {
    // The route suites drive the handlers; the published contracts are the
    // other half of what the factory produces, and the `listDescription` and
    // `writeResponses` branches only run for an aggregate that sets them.
    const module = defineWidgets(fakeCollection(), {
      listDescription: 'Only the widgets on this shelf.',
      writeResponses: [CONFLICT_RESPONSE],
    });

    const list = module.contracts.find(
      (contract) => contract.method === 'get' && !contract.path.endsWith('{id}')
    );
    expect(list?.description).toBe('Only the widgets on this shelf.');

    const create = module.contracts.find((contract) => contract.method === 'post');
    expect(create?.responses.some((response) => response.status === 409)).toBe(true);
  });
});

describe('response constants', () => {
  it('publish the status codes the factory documents', () => {
    expect(NOT_FOUND_RESPONSE.status).toBe(404);
    expect(UNPROCESSABLE_RESPONSE.status).toBe(422);
    expect(CONFLICT_RESPONSE.status).toBe(409);
    expect(CRUD_ERRORS.map((response) => response.status)).toEqual([400, 401, 403]);
  });
});
