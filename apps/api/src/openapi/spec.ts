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
 * Three conversion hooks earn their place. `unrepresentable: 'any'` keeps a
 * `z.date()` from aborting the whole document, and the `override` turns those
 * date nodes into `string` - which is what actually crosses the wire, since the
 * schemas accept an ISO string and preprocess it into a Date. Without the
 * override, every timestamp field would document as "anything".
 *
 * HOW A CALENDAR DATE KEEPS ITS OWN FORMAT. `timestamp` and `localDate` are
 * both a `z.preprocess` around `z.date()`, so this hook sees an identical inner
 * node for an instant and for a calendar date and cannot tell them apart. The
 * distinction is carried by `.meta({ format: 'date' })` on `localDate`, and zod
 * merges metadata AFTER this override runs - measured on 4.4.3: the emitted
 * property is `format: 'date'` whether this line assigns with `=` or `??=`.
 *
 * So the assignment stays unconditional on purpose. A `??=` would look like the
 * thing protecting the calendar date and would not be: it would also mask a
 * future zod that applied metadata first, which is the case the test
 * `publishes a calendar date as \`date\` and an instant as \`date-time\`` exists
 * to catch. Before the metadata existed, every birth date, service date and
 * onset date published as `date-time`, and a client generated from the document
 * sent `1990-01-01T00:00:00.000Z` to a route that refused it.
 *
 * WHY `required` IS RECOMPUTED. `z.toJSONSchema` with `io: 'input'` omits a
 * `z.preprocess` property from its object's `required` list whatever it wraps -
 * measured on zod 4.4.3 for a preprocess around `z.date()` AND around
 * `z.string()`, while the bare forms of both are listed. So every required
 * field built from `timestamp` or `localDate` published as optional: 69 such
 * properties across 117 request bodies at the time of writing. The document
 * said `POST /bff/v0/patients` needed only `mrn`, `givenName` and `familyName`,
 * and that exact body is a 422.
 *
 * The membership test is `safeParse(undefined)` rather than a check on the def
 * type, because the thing being asked is "may this be omitted" and only the
 * schema can answer that; `.optional()` is one of several ways to be omissible
 * and a def-type check would miss the others. Objects nest, and the hook runs
 * per node, so a nested body is covered by the same pass.
 *
 * WHY IT UNIONS RATHER THAN REPLACES, which is the part to keep. The first
 * version of this assigned the computed list over zod's, and that DROPPED
 * properties zod had listed correctly: `safeParse(undefined)` succeeds for a
 * bare `z.unknown()` and `z.any()`, so both read as omissible while zod - which
 * is asking a different question, "is there an `undefined` in the type" - had
 * put them in `required`. Measured, and live rather than hypothetical:
 * `valueSetDtoSchema.definition` is a bare `z.unknown()`, and three
 * `/bff/v0/value-sets` responses lost their `required` entry for it.
 *
 * The defect being fixed here is an OMISSION, so the repair may only ever add.
 * Replacing made this function authoritative about a question it answers less
 * well than zod does in every case except the preprocess one. Order follows the
 * shape so the document stays stable between runs.
 */
export function toJsonSchema(schema: z.ZodType): JsonSchema {
  return z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    io: 'input',
    unrepresentable: 'any',
    override: (context) => {
      const def = context.zodSchema._zod.def as { type: string; shape?: Record<string, z.ZodType> };

      if (def.type === 'date') {
        context.jsonSchema.type = 'string';
        context.jsonSchema.format = 'date-time';
      }

      if (def.type === 'object' && def.shape !== undefined) {
        const alreadyRequired = new Set(
          Array.isArray(context.jsonSchema.required)
            ? (context.jsonSchema.required as unknown[]).map(String)
            : []
        );

        const required = Object.keys(def.shape).filter(
          (name) =>
            alreadyRequired.has(name) ||
            !(def.shape as Record<string, z.ZodType>)[name]!.safeParse(undefined).success
        );

        if (required.length > 0) {
          context.jsonSchema.required = required;
        }
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

/**
 * The permission a route requires, as the vendor extensions the document
 * publishes.
 *
 * Not an OpenAPI keyword, but the one fact a reader of this spec most needs:
 * which role bundle can call the endpoint. Lifted out of the builder because it
 * is the only part with a nested condition, and the builder is already at the
 * complexity the linter allows.
 *
 * The plural form appears only when a route requires more than one, so the
 * common case reads exactly as it did and the exception is visible as one.
 */
function permissionExtensions(contract: RouteContract): Record<string, unknown> {
  if (contract.permission === undefined) {
    /* A route that decided it needs none says so in the document too. Silence
       here would read as an omission, which is the state this field exists to
       be distinguishable from. */
    return contract.authenticatedOnly === true ? { 'x-openrunic-authenticated': true } : {};
  }

  const also = contract.alsoRequires ?? [];
  return {
    'x-openrunic-permission': contract.permission,
    ...(also.length === 0 ? {} : { 'x-openrunic-permissions': [contract.permission, ...also] }),
  };
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
    Object.assign(operation, permissionExtensions(contract));

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
    tags: [...tags].sort(byTagName).map((name) => ({ name })),
  };
}

/**
 * Orders tag names by UTF-16 code unit.
 *
 * DELIBERATELY NOT `localeCompare`, which reads the RUNTIME's default locale, so
 * two builds of the same commit on machines with different locales would emit
 * documents that differ in tag order. A published specification is diffed and
 * generated from; its byte order is part of what it promises. The full argument
 * and the measurements are beside `byPermissionId` in `policy/permissions.ts`.
 *
 * Duplicated rather than imported from there because tag names are not
 * permissions, and `openapi/` importing from `policy/` to borrow a string
 * comparator is a worse coupling than three lines. `capabilities.ts` carries a
 * third copy for its own reason.
 *
 * THE TRIGGER, WRITTEN DOWN NOW RATHER THAN ARGUED LATER: at three copies this
 * is coupling avoidance and is worth the duplication. **A fourth makes it a
 * missing module** - extract a shared `byIdentifier` then, rather than
 * relitigating the boundary each time. This is the copy a fourth would be
 * modelled on, which is why the trigger lives here.
 *
 * `localeCompare` is correct at the other call sites in this package -
 * `errors.ts`, `memory.ts` - which order human-readable values for display
 * inside one runtime. This is not that.
 */
export function byTagName(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
