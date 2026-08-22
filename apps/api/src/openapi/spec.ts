import { z } from 'zod';

// Imported for its version and nothing else. See DEFAULT_INFO below.
import pkg from '../../package.json' with { type: 'json' };

import type { RouteContract } from './registry.js';

/**
 * OpenAPI 3.1 generated from the zod route contracts.
 *
 * Zod 4 emits JSON Schema natively (`z.toJSONSchema`), and OpenAPI 3.1's schema
 * object *is* JSON Schema 2020-12, so no adapter library is needed: the two
 * formats are the same format. That matters beyond tidiness - the repo refuses
 * dependencies published in the last three days (`minimumReleaseAge`), so
 * reaching for a wrapper here would either pin something stale or block the
 * build.
 *
 * Schemas are emitted in `input` mode, because a spec describes what a client
 * sends. The request schemas coerce and preprocess (a `page` arrives as the
 * string `"2"`, a birth date as `"1994-03-02"`), and it is the pre-coercion
 * shape a client has to produce.
 */

/**
 * Which revision of the OpenAPI specification this document is written to, not
 * the version of the API it describes. That number is `info.version` below.
 * Bumped by hand, and only when the document is actually rewritten to a newer
 * revision of the specification.
 */
export const OPENAPI_VERSION = '3.1.0';

export interface OpenApiInfo {
  title: string;
  version: string;
  description: string;
}

export const DEFAULT_INFO: OpenApiInfo = {
  title: 'openrunic internal API',
  // The same manifest version the CapabilityStatement reports, for the same
  // reason: the two documents describe one running server, so a reader who
  // compares them should never find two different numbers. See SOFTWARE_VERSION
  // in app.ts, which explains why the manifest is the one source. It is read
  // here directly rather than imported from app.ts, because app.ts imports this
  // module and the cycle would leave this constant reading an uninitialised
  // binding.
  version: pkg.version,
  description:
    'The internal REST surface behind openrunic web and portal. Unstable and first-party only: it changes with the screens it serves. The stable public contract is FHIR R4, described by the CapabilityStatement at /fhir/metadata.',
};

type JsonSchema = Record<string, unknown>;

/**
 * Renders one zod schema as a JSON Schema object.
 *
 * Two conversion hooks earn their place. `unrepresentable: 'any'` keeps a
 * `z.date()` from aborting the whole document, and the `override` turns those
 * date nodes into `string`/`date-time` - which is what actually crosses the
 * wire, since the schemas accept an ISO string and preprocess it into a Date.
 * Without the override, every timestamp field would document as "anything".
 */
export function toJsonSchema(schema: z.ZodType): JsonSchema {
  return z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    io: 'input',
    unrepresentable: 'any',
    override: (context) => {
      if (context.zodSchema._zod.def.type === 'date') {
        context.jsonSchema.type = 'string';
        context.jsonSchema.format = 'date-time';
      }
    },
  });
}

interface ParameterObject {
  name: string;
  in: 'query' | 'path';
  required: boolean;
  description?: string;
  schema: JsonSchema;
}

/**
 * Flattens a query object schema into one OpenAPI parameter per property.
 * OpenAPI has no notion of "the query string is this object", so the object is
 * taken apart here rather than published as something no tool would render.
 */
function queryParameters(schema: z.ZodType): ParameterObject[] {
  const json = toJsonSchema(schema);
  const properties = isRecord(json.properties) ? json.properties : {};
  const required = Array.isArray(json.required) ? json.required.map(String) : [];

  return Object.entries(properties).map(([name, propertySchema]) => ({
    name,
    in: 'query' as const,
    required: required.includes(name),
    schema: isRecord(propertySchema) ? propertySchema : {},
  }));
}

export interface OpenApiDocument {
  openapi: string;
  info: OpenApiInfo;
  paths: Record<string, Record<string, unknown>>;
  components: { securitySchemes: Record<string, unknown> };
  security: Record<string, unknown>[];
  tags: { name: string }[];
}

export function buildOpenApiDocument(
  contracts: readonly RouteContract[],
  info: OpenApiInfo = DEFAULT_INFO
): OpenApiDocument {
  const paths: Record<string, Record<string, unknown>> = {};
  const tags = new Set<string>();

  for (const contract of contracts) {
    for (const tag of contract.tags) tags.add(tag);

    const parameters: ParameterObject[] = [
      ...(contract.pathParams ?? []).map((param) => ({
        name: param.name,
        in: 'path' as const,
        required: true,
        description: param.description,
        schema: toJsonSchema(param.schema),
      })),
      ...(contract.query === undefined ? [] : queryParameters(contract.query)),
    ];

    const operation: Record<string, unknown> = {
      operationId: contract.operationId,
      summary: contract.summary,
      tags: contract.tags,
      responses: Object.fromEntries(
        contract.responses.map((response) => [
          String(response.status),
          {
            description: response.description,
            ...(response.schema === undefined
              ? {}
              : {
                  content: {
                    [response.mediaType ?? 'application/json']: {
                      schema: toJsonSchema(response.schema),
                    },
                  },
                }),
          },
        ])
      ),
    };

    if (contract.description !== undefined) operation.description = contract.description;
    if (parameters.length > 0) operation.parameters = parameters;
    if (contract.body !== undefined) {
      operation.requestBody = {
        required: true,
        content: { 'application/json': { schema: toJsonSchema(contract.body) } },
      };
    }
    if (contract.permission !== undefined) {
      // Not an OpenAPI keyword, but the one fact a reader of this spec most
      // needs: which role bundle can call the endpoint.
      operation['x-openrunic-permission'] = contract.permission;
      // Published as a list only when there is more than one, so the common
      // case reads exactly as it did and the exception is visible as one.
      if (contract.alsoRequires !== undefined && contract.alsoRequires.length > 0) {
        operation['x-openrunic-permissions'] = [contract.permission, ...contract.alsoRequires];
      }
    }

    paths[contract.path] = { ...paths[contract.path], [contract.method]: operation };
  }

  return {
    openapi: OPENAPI_VERSION,
    info,
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
    },
    security: [{ bearerAuth: [] }],
    tags: [...tags].sort((a, b) => a.localeCompare(b)).map((name) => ({ name })),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
