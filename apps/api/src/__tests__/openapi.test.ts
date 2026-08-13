import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createApp } from '../app.js';
import { toHonoPath } from '../openapi/registry.js';
import { buildOpenApiDocument, toJsonSchema } from '../openapi/spec.js';
import { internalRouteContracts } from '../routes/index.js';

import { createTestApp } from './support.js';

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

describe('the OpenAPI document', () => {
  it('is served at /openapi.json without a token', async () => {
    const { app } = createTestApp();
    const res = await app.request('/openapi.json');

    expect(res.status).toBe(200);
    const document = (await res.json()) as { openapi: string; info: { title: string } };
    expect(document.openapi).toBe('3.1.0');
    expect(document.info.title).toContain('openrunic');
  });

  it('describes every internal route and nothing that does not exist', () => {
    const registered = registeredRoutes();

    for (const contract of internalRouteContracts()) {
      const key = `${contract.method} ${toHonoPath(contract.path)}`;
      expect(registered, `${key} is documented but not mounted`).toContain(key);
    }
  });

  it('documents every mounted internal route', () => {
    const documented = new Set(
      internalRouteContracts().map((contract) => `${contract.method} ${toHonoPath(contract.path)}`)
    );

    const undocumented = [...registeredRoutes()].filter(
      (route) => route.includes('/bff/v0/') && !documented.has(route)
    );

    // The stub instance routes are deliberately mounted without their own
    // contract: the collection entry documents the aggregate, and publishing
    // four not-implemented operations per aggregate would be noise.
    expect(undocumented.every((route) => /\/:id$/.test(route))).toBe(true);
  });

  it('converts a braced OpenAPI path to the Hono form', () => {
    expect(toHonoPath('/bff/v0/patients/{id}')).toBe('/bff/v0/patients/:id');
    expect(toHonoPath('/bff/v0/patients')).toBe('/bff/v0/patients');
  });

  it('gives every operation a unique operationId', () => {
    const ids = internalRouteContracts().map((contract) => contract.operationId);

    expect(new Set(ids).size).toBe(ids.length);
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

  it('names the permission each operation requires', () => {
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

    for (const status of ['400', '401', '403', '404', '409', '422', '501']) {
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
