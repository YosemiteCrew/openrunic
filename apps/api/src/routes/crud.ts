import { Hono, type Context } from 'hono';
import type { z } from 'zod';

import type { AppEnv } from '../context.js';
import { ApiError } from '../errors.js';
import { problemDocumentSchema } from '../http/problem.js';
import { parseJsonBody, parseParam, parseQuery } from '../http/validate.js';
import { assertFacilityAccess, requirePermission } from '../middleware/policy.js';
import type { RouteContract } from '../openapi/registry.js';
import type { Permission } from '../policy/permissions.js';
import type { BaseQuery, Collection } from '../repositories/collection.js';
import type { CollectionKey, Repositories } from '../repositories/types.js';
import { listResponseSchema, toListResponse } from '../schemas/pagination.js';

import { gateCharts, idParamSchema, policyOf, repositories, required } from './helpers.js';

/**
 * List, read, create and amend, written once.
 *
 * Two dozen aggregates share the same four operations, the same paging
 * envelope, the same 404-not-403 rule for a row in another organisation and
 * the same facility check. Writing them twenty-four times would mean
 * twenty-four chances to leave one out, and the ones that would go missing
 * first are the security-relevant ones, because they are the ones a passing
 * screen never notices. So an aggregate describes itself and this factory
 * mounts the handlers and publishes the contracts from that one description.
 *
 * Anything that is not those four operations - signing a note, submitting a
 * claim, posting a remittance - is written by hand in the aggregate's own
 * router, because a state transition is exactly the place where a generic
 * abstraction would hide the rules that matter.
 */

export const CRUD_ERRORS = [
  { status: 400, description: 'The query string is not valid.', schema: problemDocumentSchema },
  { status: 401, description: 'No usable bearer token.', schema: problemDocumentSchema },
  {
    status: 403,
    description: 'The role lacks the permission, or the facility is not granted.',
    schema: problemDocumentSchema,
  },
] as const;

export const NOT_FOUND_RESPONSE = {
  status: 404,
  description: 'No such record in this organisation.',
  schema: problemDocumentSchema,
} as const;

export const UNPROCESSABLE_RESPONSE = {
  status: 422,
  description: 'The body failed validation.',
  schema: problemDocumentSchema,
} as const;

export const CONFLICT_RESPONSE = {
  status: 409,
  description: 'The record is not in a state that allows this.',
  schema: problemDocumentSchema,
} as const;

/** Everything the factory needs to serve one aggregate. */
export interface CrudResource<
  TRow,
  TCreate,
  TPatch,
  TQuery extends BaseQuery,
  TQueryInput,
  TCreateBody,
  TPatchBody,
  TDto,
> {
  /** Path segment under `/bff/v0`, e.g. `encounters` or `medications/prescriptions`. */
  readonly segment: string;
  /** Singular noun used in summaries and in the 404 detail. */
  readonly singular: string;
  /** Plural noun used in summaries. */
  readonly plural: string;
  /** OpenAPI tag, and the `operationId` stem. */
  readonly tag: string;
  /** Capitalised stem for `operationId`, e.g. `Encounter`. */
  readonly operation: string;
  readonly readPermission: Permission;
  readonly writePermission: Permission;
  /**
   * The collection whose spec says which patient a row of this aggregate is
   * about, when the aggregate is chart data.
   *
   * Its presence is the whole gate: a resource that sets it has its reads and
   * amendments refused unless the caller has a care relationship with the row's
   * patient, exactly as the FHIR boundary and `/patients/:id` are. It is the
   * collection's own key - `chartFrom: 'problems'` on the problems resource -
   * because the patient column lives on the spec, and `bff.chart-crud-gate`
   * fails the build if a chart-bearing aggregate (one whose spec declares a
   * `patientColumn`) omits it. A non-chart aggregate leaves it unset and is
   * gated by permission, tenant and facility alone.
   */
  readonly chartFrom?: CollectionKey;
  /** How to reach this aggregate's repository. */
  collection(repos: Repositories): Collection<TRow, TCreate, TPatch, TQuery>;
  readonly listQuerySchema: z.ZodType<TQueryInput>;
  toQuery(input: TQueryInput): TQuery;
  /** What the list query means, in one line, for the published spec. */
  readonly listDescription?: string;
  readonly createSchema: z.ZodType<TCreateBody>;
  toCreate(body: TCreateBody): TCreate;
  readonly patchSchema: z.ZodType<TPatchBody>;
  toPatch(body: TPatchBody, row: TRow): TPatch;
  readonly dtoSchema: z.ZodType<TDto>;
  toDto(row: TRow): TDto;
  /** The facility a stored row belongs to, when the aggregate is facility-scoped. */
  facilityOfRow?(row: TRow): string | null;
  /** The facility a create names, checked before anything is written. */
  facilityOfInput?(input: TCreate): string | null;
  /**
   * The facility a list query names, when it names one.
   *
   * A list that names no facility is narrowed to the caller's grants by the
   * repository, because there is nothing to refuse and hiding is the only
   * answer. A list that names one is a question with a wrong answer, and this
   * boundary gives it: 403, so a caller filtering on a site they were never
   * granted is told so rather than handed an empty page that reads as "no
   * charges today".
   */
  facilityOfQuery?(query: TQuery): string | null;
  /**
   * A last check before a create is written, for rules the schema cannot state.
   *
   * Throws to refuse. Runs after the facility check and before anything reaches
   * the database, so a refused create leaves nothing behind. Exists because
   * some rules need to read what is already stored, and a Zod schema cannot:
   * whether these exact bytes have arrived before is the case that drove it.
   */
  beforeCreate?(c: Context<AppEnv>, input: TCreate): Promise<void>;
  /**
   * Columns the writer owns rather than the request, filled in from the
   * authenticated caller after the body has been parsed.
   *
   * The difference from `toCreate` is where the value can come from. `toCreate`
   * sees only the body, so anything it sets is something the caller could have
   * set; this sees the request, so what it sets is a fact about who is asking.
   * Authorisation reads some of those columns - a task's assigner decides
   * whether that task lets its assignee open the chart - and a column
   * authorisation reads must never be one the body can name.
   */
  stampCreate?(input: TCreate, c: Context<AppEnv>): TCreate;
  /** The same, for an amendment. See {@link CrudResource.stampCreate}. */
  stampPatch?(patch: TPatch, c: Context<AppEnv>): TPatch;
  /** Extra statuses this aggregate's writes can produce, for the spec. */
  readonly writeResponses?: readonly { status: number; description: string }[];
}

/**
 * One aggregate, already mounted and already documented.
 *
 * Route modules hold heterogeneous lists of these, and the only things they do
 * with one are mount its router and publish its contracts. Erasing the eight
 * type parameters at the boundary is what lets such a list exist at all: the
 * parameters are checked inside {@link defineCrud}, where they are known, and
 * a list of resources with different row types has no common supertype that
 * would keep them.
 */
export interface CrudModule {
  readonly segment: string;
  readonly contracts: readonly RouteContract[];
  readonly routes: Hono<AppEnv>;
}

export function defineCrud<
  TRow,
  TCreate,
  TPatch,
  TQuery extends BaseQuery,
  TQueryInput,
  TCreateBody,
  TPatchBody,
  TDto,
>(
  resource: CrudResource<TRow, TCreate, TPatch, TQuery, TQueryInput, TCreateBody, TPatchBody, TDto>
): CrudModule {
  return {
    segment: resource.segment,
    contracts: crudContracts(resource),
    routes: crudRoutes(resource),
  };
}

function crudContracts<
  TRow,
  TCreate,
  TPatch,
  TQuery extends BaseQuery,
  TQueryInput,
  TCreateBody,
  TPatchBody,
  TDto,
>(
  resource: CrudResource<TRow, TCreate, TPatch, TQuery, TQueryInput, TCreateBody, TPatchBody, TDto>
): RouteContract[] {
  const base = `/bff/v0/${resource.segment}`;
  const idParam = {
    name: 'id',
    description: `${capitalise(resource.singular)} id (UUIDv7).`,
    schema: idParamSchema,
  };
  const extra = (resource.writeResponses ?? []).map((response) => ({
    ...response,
    schema: problemDocumentSchema,
  }));

  return [
    {
      method: 'get',
      path: base,
      operationId: `list${resource.operation}s`,
      summary: `List ${resource.plural}.`,
      ...(resource.listDescription === undefined ? {} : { description: resource.listDescription }),
      tags: [resource.tag],
      permission: resource.readPermission,
      query: resource.listQuerySchema,
      responses: [
        {
          status: 200,
          description: `One page of ${resource.plural}.`,
          schema: listResponseSchema(resource.dtoSchema),
        },
        ...CRUD_ERRORS,
      ],
    },
    {
      method: 'get',
      path: `${base}/{id}`,
      operationId: `read${resource.operation}`,
      summary: `Read one ${resource.singular}.`,
      tags: [resource.tag],
      permission: resource.readPermission,
      pathParams: [idParam],
      responses: [
        { status: 200, description: `The ${resource.singular}.`, schema: resource.dtoSchema },
        ...CRUD_ERRORS,
        NOT_FOUND_RESPONSE,
      ],
    },
    {
      method: 'post',
      path: base,
      operationId: `create${resource.operation}`,
      summary: `Record a ${resource.singular}.`,
      tags: [resource.tag],
      permission: resource.writePermission,
      body: resource.createSchema,
      responses: [
        {
          status: 201,
          description: `The recorded ${resource.singular}.`,
          schema: resource.dtoSchema,
        },
        ...CRUD_ERRORS,
        ...extra,
        UNPROCESSABLE_RESPONSE,
      ],
    },
    {
      method: 'patch',
      path: `${base}/{id}`,
      operationId: `update${resource.operation}`,
      summary: `Amend a ${resource.singular}.`,
      tags: [resource.tag],
      permission: resource.writePermission,
      pathParams: [idParam],
      body: resource.patchSchema,
      responses: [
        {
          status: 200,
          description: `The amended ${resource.singular}.`,
          schema: resource.dtoSchema,
        },
        ...CRUD_ERRORS,
        NOT_FOUND_RESPONSE,
        ...extra,
        UNPROCESSABLE_RESPONSE,
      ],
    },
  ];
}

function crudRoutes<
  TRow,
  TCreate,
  TPatch,
  TQuery extends BaseQuery,
  TQueryInput,
  TCreateBody,
  TPatchBody,
  TDto,
>(
  resource: CrudResource<TRow, TCreate, TPatch, TQuery, TQueryInput, TCreateBody, TPatchBody, TDto>
): Hono<AppEnv> {
  const router = new Hono<AppEnv>();
  const base = `/${resource.segment}`;
  const missing = `No such ${resource.singular}.`;

  const guardRow = (c: Context<AppEnv>, row: TRow): void => {
    const facilityId = resource.facilityOfRow?.(row) ?? null;
    if (facilityId !== null) assertFacilityAccess(policyOf(c), facilityId);
  };

  // The care-relationship half of the read guard, for a resource that is chart
  // data. Refuses the row - as 404, like every other chart refusal - unless the
  // caller is involved in its patient's care. Runs after `guardRow` so a
  // refusal reveals nothing the facility check would already have hidden, and
  // before the row is serialised, so the body never forms for a refused read.
  const guardChart = async (c: Context<AppEnv>, res: typeof resource, row: TRow): Promise<void> => {
    if (res.chartFrom === undefined) return;
    await gateCharts(c, res.chartFrom, [row]);
  };

  router.get(base, requirePermission(resource.readPermission), async (c) => {
    const query = resource.toQuery(parseQuery(c, resource.listQuerySchema));
    // Only when the caller named one. The rows themselves are narrowed to the
    // caller's grants by the repository whether or not this fires, which is
    // what stops an omitted filter returning the whole tenant.
    const named = resource.facilityOfQuery?.(query) ?? null;
    if (named !== null) assertFacilityAccess(policyOf(c), named);
    const page = await resource.collection(repositories(c)).list(query);
    // A list of chart data is a read of every chart it returns, so it needs a
    // relationship with each - the same rule as the read, applied to whatever
    // came back. A row that names no chart (an unfiled document) has none to
    // check; a broad clinical list of other patients' rows is refused, which is
    // the FHIR search's rule on this boundary. Only the DTOs form after the
    // gate, so a refused list never serialises the rows it read to decide.
    if (resource.chartFrom !== undefined) await gateCharts(c, resource.chartFrom, page.rows);
    return c.json(toListResponse(page, (row) => resource.toDto(row)));
  });

  router.get(`${base}/:id`, requirePermission(resource.readPermission), async (c) => {
    const id = parseParam(c.req.param('id'), idParamSchema, 'id');
    const row = required(await resource.collection(repositories(c)).findById(id), missing);
    guardRow(c, row);
    await guardChart(c, resource, row);
    return c.json(resource.toDto(row));
  });

  router.post(base, requirePermission(resource.writePermission), async (c) => {
    const parsed = resource.toCreate(await parseJsonBody(c, resource.createSchema));
    const input = resource.stampCreate?.(parsed, c) ?? parsed;
    const facilityId = resource.facilityOfInput?.(input) ?? null;
    // Asked before the write rather than after, so a refused create never
    // reaches the database.
    if (facilityId !== null) assertFacilityAccess(policyOf(c), facilityId);
    await resource.beforeCreate?.(c, input);
    const row = await resource.collection(repositories(c)).create(input);
    return c.json(resource.toDto(row), 201, {
      Location: `/bff/v0/${resource.segment}/${rowId(row)}`,
    } satisfies Record<string, string>);
  });

  router.patch(`${base}/:id`, requirePermission(resource.writePermission), async (c) => {
    const id = parseParam(c.req.param('id'), idParamSchema, 'id');
    const body = await parseJsonBody(c, resource.patchSchema);
    const collection = resource.collection(repositories(c));
    const existing = required(await collection.findById(id), missing);
    guardRow(c, existing);
    await guardChart(c, resource, existing);
    const patch = resource.toPatch(body, existing);
    const row = required(
      await collection.update(id, resource.stampPatch?.(patch, c) ?? patch),
      missing
    );
    return c.json(resource.toDto(row));
  });

  return router;
}

function rowId(row: unknown): string {
  const id = (row as { id?: unknown }).id;
  if (typeof id !== 'string') {
    throw new TypeError('crudRoutes: the repository returned a row with no id');
  }
  return id;
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Refuses a move the state machine does not allow.
 *
 * The table is the whole rule, written as data next to the aggregate it governs
 * rather than as a chain of conditionals inside a handler, so "what can a
 * submitted claim become" is answerable by reading one object. A refusal is a
 * typed 409 carrying the current state and the reachable ones; it is never an
 * unhandled exception, because a clinician who clicked the wrong button
 * deserves a sentence rather than a request id.
 */
export function assertTransition<TState extends string>(
  table: Readonly<Record<TState, readonly TState[]>>,
  subject: string,
  from: TState,
  to: TState
): void {
  const allowed = table[from];
  if (!allowed.includes(to)) {
    throw ApiError.invalidTransition({ subject, from, to, allowed });
  }
}
