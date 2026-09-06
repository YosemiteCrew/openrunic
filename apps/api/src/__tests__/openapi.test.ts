import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createApp } from '../app.js';
import { toHonoPath } from '../openapi/registry.js';
import { buildOpenApiDocument, toJsonSchema } from '../openapi/spec.js';
import { internalRouteContracts } from '../routes/index.js';

import { bearer, createTestApp, TOKENS } from './support.js';

/**
 * The published spec, checked against the routes that exist.
 *
 * An OpenAPI file rots in two directions and both matter. A documented endpoint
 * that does not exist sends a client to a 404 it had no reason to expect; an
 * endpoint that exists without documentation is a surface nobody reviewed and
 * nobody can plan around. Both are failures here, and neither has an exemption
 * list, because an exemption list is where the rot starts.
 */

interface RegisteredRoute {
  method: string;
  path: string;
}

/** Every route Hono actually holds, normalised for comparison with the spec. */
function registeredRoutes(): Set<string> {
  const app = createApp() as unknown as { routes: RegisteredRoute[] };
  return new Set(
    app.routes
      .filter((route) => route.method !== 'ALL' && route.method !== 'USE')
      .map((route) => `${route.method.toLowerCase()} ${route.path}`)
  );
}

function documentedRoutes(): Set<string> {
  return new Set(
    internalRouteContracts().map((contract) => `${contract.method} ${toHonoPath(contract.path)}`)
  );
}

describe('the OpenAPI document', () => {
  it('is served at /openapi.json without a token', async () => {
    const { app } = createTestApp();
    const res = await app.request('/openapi.json');

    expect(res.status).toBe(200);
    const document = (await res.json()) as { openapi: string; info: { title: string } };
    expect(document.openapi).toBe('3.1.0');
    expect(document.info.title).toContain('openrunic');
  });

  it('documents nothing that is not mounted', () => {
    const registered = registeredRoutes();

    const phantom = [...documentedRoutes()].filter((route) => !registered.has(route));

    expect(phantom, 'documented but not mounted').toEqual([]);
  });

  it('leaves no internal route undocumented', () => {
    const documented = documentedRoutes();

    const undocumented = [...registeredRoutes()].filter(
      (route) => route.includes('/bff/v0/') && !documented.has(route)
    );

    expect(undocumented, 'mounted but not documented').toEqual([]);
  });

  it('covers every aggregate the product ships', () => {
    const tags = new Set(internalRouteContracts().flatMap((contract) => contract.tags));

    for (const tag of [
      'patients',
      'appointments',
      'encounters',
      'notes',
      'problems',
      'medications',
      'allergies',
      'immunisations',
      'observations',
      'orders',
      'results',
      'documents',
      'tasks',
      'messages',
      'coverage',
      'charges',
      'claims',
      'payments',
      'remittances',
      'statements',
      'forms',
      'inventory',
      'users',
      'roles',
      'facilities',
      'terminology',
      'audit',
    ]) {
      expect(tags, tag).toContain(tag);
    }
  });

  it('gives every operation a unique operationId', () => {
    const ids = internalRouteContracts().map((contract) => contract.operationId);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('names the permission every operation requires', () => {
    const missing = internalRouteContracts().filter(
      (contract) => contract.permission === undefined
    );

    // A route with no declared permission is a route nobody decided the
    // authorisation for, which is a worse failure than the wrong permission.
    expect(missing.map((contract) => contract.operationId)).toEqual([]);
  });

  it('converts a braced OpenAPI path to the Hono form', () => {
    expect(toHonoPath('/bff/v0/patients/{id}')).toBe('/bff/v0/patients/:id');
    expect(toHonoPath('/bff/v0/patients')).toBe('/bff/v0/patients');
  });

  it('flattens a query schema into one parameter per field', () => {
    const document = buildOpenApiDocument(internalRouteContracts());
    const list = document.paths['/bff/v0/patients']?.get as {
      parameters: { name: string; in: string; required: boolean }[];
    };

    const names = list.parameters.map((parameter) => parameter.name);
    expect(names).toContain('family');
    expect(names).toContain('pageSize');
    expect(list.parameters.every((parameter) => parameter.in === 'query')).toBe(true);
    // Everything on a search is optional; a required search parameter would be
    // a filter you cannot turn off.
    expect(list.parameters.every((parameter) => !parameter.required)).toBe(true);
  });

  it('describes the path parameter of an instance route', () => {
    const document = buildOpenApiDocument(internalRouteContracts());
    const read = document.paths['/bff/v0/patients/{id}']?.get as {
      parameters: { name: string; in: string; required: boolean }[];
    };

    expect(read.parameters[0]).toMatchObject({ name: 'id', in: 'path', required: true });
  });

  it('carries the request body schema generated from the domain contract', () => {
    const document = buildOpenApiDocument(internalRouteContracts());
    const create = document.paths['/bff/v0/patients']?.post as {
      requestBody: { content: { 'application/json': { schema: { properties: object } } } };
    };

    const properties = create.requestBody.content['application/json'].schema.properties;
    expect(Object.keys(properties)).toContain('mrn');
    expect(Object.keys(properties)).toContain('birthDate');
  });

  it('names the permission each operation requires in the document itself', () => {
    const document = buildOpenApiDocument(internalRouteContracts());
    const create = document.paths['/bff/v0/patients']?.post as Record<string, unknown>;

    expect(create['x-openrunic-permission']).toBe('patient.write');
  });

  it('declares bearer authentication for the whole surface', () => {
    const document = buildOpenApiDocument(internalRouteContracts());

    expect(document.security).toEqual([{ bearerAuth: [] }]);
    expect(document.components.securitySchemes.bearerAuth).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
  });

  it('lists one tag per aggregate, sorted', () => {
    const document = buildOpenApiDocument(internalRouteContracts());
    const tags = document.tags.map((tag) => tag.name);

    expect(tags).toEqual([...tags].sort());
    expect(tags).toContain('patients');
    expect(tags).toContain('claims');
  });

  it('documents every error status the routes can produce', () => {
    const document = buildOpenApiDocument(internalRouteContracts());
    const statuses = new Set(
      Object.values(document.paths).flatMap((methods) =>
        Object.values(methods).flatMap((operation) =>
          Object.keys((operation as { responses: Record<string, unknown> }).responses)
        )
      )
    );

    for (const status of ['400', '401', '403', '404', '409', '422']) {
      expect(statuses, status).toContain(status);
    }
  });
});

describe('zod to JSON Schema', () => {
  it('renders a date-preprocessing schema as a date-time string, not as "anything"', () => {
    const timestamp = z.preprocess(
      (value) => (typeof value === 'string' ? new Date(value) : value),
      z.date()
    );

    expect(toJsonSchema(z.strictObject({ at: timestamp })).properties).toEqual({
      at: { type: 'string', format: 'date-time' },
    });
  });

  it('renders enums, optionality and bounds', () => {
    const schema = z.strictObject({
      status: z.enum(['a', 'b']),
      count: z.int().min(1).max(10).optional(),
    });
    const json = toJsonSchema(schema) as {
      properties: Record<string, unknown>;
      required: string[];
      additionalProperties: boolean;
    };

    expect(json.properties.status).toMatchObject({ type: 'string', enum: ['a', 'b'] });
    expect(json.properties.count).toMatchObject({ type: 'integer', minimum: 1, maximum: 10 });
    expect(json.required).toEqual(['status']);
    // `strictObject` really does forbid extra keys, and the spec says so.
    expect(json.additionalProperties).toBe(false);
  });

  it('describes the query string as a client sends it, before coercion', () => {
    const json = toJsonSchema(z.strictObject({ page: z.coerce.number().int().min(1).default(1) }));

    // Coercion means the input side is not a number; documenting the coerced
    // type would tell a client to send something it cannot put in a URL.
    expect(json.properties).toHaveProperty('page');
  });

  it('renders a document with no routes at all', () => {
    expect(buildOpenApiDocument([])).toMatchObject({ paths: {}, tags: [] });
  });

  it('accepts a caller-supplied info block', () => {
    const document = buildOpenApiDocument([], {
      title: 'Test',
      version: '9.9.9',
      description: 'A test document.',
    });

    expect(document.info).toEqual({
      title: 'Test',
      version: '9.9.9',
      description: 'A test document.',
    });
  });

  it('groups two methods on one path into one path item', () => {
    const document = buildOpenApiDocument(internalRouteContracts());

    expect(Object.keys(document.paths['/bff/v0/patients'] ?? {}).sort()).toEqual(['get', 'post']);
  });
});

/**
 * The document is a contract, so the tests that matter are the ones that make it
 * answer to the routes rather than to itself.
 *
 * Every assertion here was red before the fix for #298, and each is red for a
 * different reason, so a failure says which half broke:
 *
 *   - the round trip fails if `required` under-states the body OR if a
 *     `localDate` publishes as `date-time`, because it builds its request out of
 *     the document and sends it to the route;
 *   - the `format` case fails only for the date/date-time confusion;
 *   - the `required` case fails only for the preprocess omission.
 *
 * The first is the one worth having. A document checked against itself agreed
 * with itself while `POST /bff/v0/patients` refused the exact body it described.
 */
describe('the OpenAPI document as a contract the routes honour', () => {
  /** A value the document itself says is acceptable for this property. */
  const sampleFor = (schema: { type?: string; format?: string }): unknown => {
    if (schema.type !== 'string') return 1;
    if (schema.format === 'date') return '1990-01-01';
    if (schema.format === 'date-time') return '1990-01-01T00:00:00.000Z';
    return 'QA-CONTRACT-1';
  };

  it('describes a create body the route accepts, built only from the document', async () => {
    const document = buildOpenApiDocument(internalRouteContracts());
    const post = document.paths['/bff/v0/patients']?.post as {
      requestBody: {
        content: {
          'application/json': {
            schema: {
              required?: string[];
              properties: Record<string, { type?: string; format?: string }>;
            };
          };
        };
      };
    };

    const schema = post.requestBody.content['application/json'].schema;
    const required = schema.required ?? [];

    // A body that names no required field would satisfy the round trip for the
    // wrong reason, so the set itself is pinned first.
    expect(required).toContain('birthDate');

    const body = Object.fromEntries(
      required.map((name) => [name, sampleFor(schema.properties[name] ?? {})])
    );

    const { app } = createTestApp();
    const response = await app.request('/bff/v0/patients', {
      method: 'POST',
      headers: { ...bearer(TOKENS.clinicianA), 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    expect(response.status, await response.text()).toBe(201);
  });

  /**
   * `patientCreateInput` is the fixture rather than a constructed one, because
   * it already holds both halves of the distinction in one object: `birthDate`
   * is a required `localDate` and `deceasedAt` is an optional `timestamp`. A
   * synthetic pair would prove the renderer works on a schema nothing ships.
   */
  const patientCreateSchema = (): {
    required?: string[];
    properties: Record<string, { type?: string; format?: string }>;
  } => {
    const document = buildOpenApiDocument(internalRouteContracts());
    const post = document.paths['/bff/v0/patients']?.post as {
      requestBody: {
        content: {
          'application/json': {
            schema: {
              required?: string[];
              properties: Record<string, { type?: string; format?: string }>;
            };
          };
        };
      };
    };

    return post.requestBody.content['application/json'].schema;
  };

  it('publishes a calendar date as `date` and an instant as `date-time`', () => {
    const { properties } = patientCreateSchema();

    // Asserted as a pair. Both were `date-time` before the fix, so pinning only
    // the calendar date would still pass on a build that had collapsed the two
    // the other way.
    expect(properties.birthDate).toEqual({ type: 'string', format: 'date' });
    expect(properties.deceasedAt).toEqual({ type: 'string', format: 'date-time' });
  });

  it('lists a required preprocess field, and still omits an optional one', () => {
    const { required = [] } = patientCreateSchema();

    // The optional half is what separates "required is computed from the shape"
    // from "required lists every property it can see".
    expect(required).toContain('birthDate');
    expect(required).not.toContain('deceasedAt');
    expect(required).toContain('mrn');
  });

  it('keeps a required `unknown`, which reads as omissible but is not', () => {
    // `safeParse(undefined)` succeeds for a bare `z.unknown()` and `z.any()`, so
    // the shape walk alone would drop them - while zod, asking whether the type
    // admits `undefined`, correctly lists them. The first version of this fix
    // replaced zod's list and lost them; the union is what this pins.
    const rendered = toJsonSchema(
      z.strictObject({
        mrn: z.string(),
        definition: z.unknown(),
        anything: z.any(),
        // The preprocess is the case the recomputation exists for, included so
        // this asserts the union rather than "leave zod's list alone".
        born: z.preprocess((value) => value, z.date()),
      })
    ) as { required?: string[] };

    expect(rendered.required).toEqual(['mrn', 'definition', 'anything', 'born']);
  });

  it('keeps the `definition` a value-set response actually always sends', () => {
    const document = buildOpenApiDocument(internalRouteContracts());
    const path = document.paths['/bff/v0/value-sets'] as Record<
      string,
      {
        responses: Record<
          string,
          {
            content: {
              'application/json': {
                schema: {
                  required?: string[];
                  properties?: { data?: { items?: { required?: string[] } } };
                };
              };
            };
          }
        >;
      }
    >;

    const listItem =
      path.get?.responses['200']?.content['application/json'].schema.properties?.data?.items;
    const created = path.post?.responses['201']?.content['application/json'].schema;

    // The live case that caught the replace-versus-union bug. The DTO is a
    // strictObject and the route always sends `definition`, so a document that
    // drops it from `required` under-states its own response - the same defect
    // as #298, on the way back out. Asserted on both the list item and the
    // created body, because the recomputation runs per object node and a fix
    // that reached only the top level would pass on one of them.
    // Optional chaining here cannot make the assertion vacuous: `toContain` on
    // `undefined` fails rather than passing, so a missing node is still red.
    expect(listItem?.required).toContain('definition');
    expect(created?.required).toContain('definition');
  });
});
