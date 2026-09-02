import type { PrismaClient } from './generated/prisma/client.js';

/**
 * Tenant scoping: layer 1 of the three-layer isolation model documented at the
 * top of `prisma/schema.prisma`.
 *
 * `createTenantClient` wraps a root PrismaClient in an extension that injects
 * `tenantId` into every query it issues, for every model that carries one. A
 * caller holding a tenant client cannot read or write another tenant's rows
 * even if it forgets a filter, because the filter is not the caller's to forget.
 *
 * What this layer is not: it is not the last line of defence. It runs in the
 * same process as the code it is protecting, so a bug in the extension, a raw
 * `$queryRaw`, or a future Prisma operation this file does not know about could
 * all bypass it. That is why the Postgres RLS policy (layer 2) and the
 * cross-tenant test suite (layer 3) exist. Treat this as the thing that makes
 * correct code easy, not as the thing that makes incorrect code safe.
 *
 * A client from here still has to reach the database through
 * `withTenantSession` (see `rls.ts`), which declares the tenant to Postgres for
 * the transaction. Used on its own it reads nothing, because the policies fail
 * closed - which is the intended failure mode, but it is a failure.
 */

/**
 * Every model that carries a `tenantId` column, i.e. everything except the
 * Organisation root itself. Kept as data so the cross-tenant test suite can
 * enumerate it, and asserted against the schema by
 * `tenantScopedModelsMatchSchema` in the API's integration tests.
 */
export const TENANT_SCOPED_MODELS = [
  'Facility',
  'User',
  'UserFacility',
  'StockItem',
  'StockLot',
  'StockPosting',
  'StockMovement',
  'StockLotStatusChange',
  'Role',
  'Permission',
  'RolePermission',
  'RoleAssignment',
  'Patient',
  'PatientIdentifier',
  'RelatedPerson',
  'Payer',
  'Coverage',
  'Document',
  'Appointment',
  'AppointmentStatusHistory',
  'Encounter',
  'ClinicalNote',
  'NoteAddendum',
  'Condition',
  'Procedure',
  'MedicationStatement',
  'MedicationRequest',
  'AllergyIntolerance',
  'Immunization',
  'Observation',
  'Referral',
  'ServiceRequest',
  'Specimen',
  'DiagnosticReport',
  'ResultObservation',
  'Task',
  'MessageThread',
  'Message',
  'ChargeItem',
  'Claim',
  'ClaimLine',
  'ClaimStatusHistory',
  'Payment',
  'PaymentAllocation',
  'Remittance',
  'RemittanceLine',
  'Statement',
  'FormDefinition',
  'FormSubmission',
  'FormPromotedValue',
  'TerminologyCode',
  'ConsentGrant',
  'AuditEvent',
  'ImagingStudy',
  'ValueSet',
  'TelehealthVisit',
] as const;

export type TenantScopedModel = (typeof TENANT_SCOPED_MODELS)[number];

const TENANT_SCOPED_MODEL_SET: ReadonlySet<string> = new Set(TENANT_SCOPED_MODELS);

export function isTenantScopedModel(model: string): model is TenantScopedModel {
  return TENANT_SCOPED_MODEL_SET.has(model);
}

/** Operations whose `where` clause must be narrowed to the tenant. */
const FILTERED_OPERATIONS: ReadonlySet<string> = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
  'upsert',
]);

/** Operations whose `data` must be stamped with the tenant. */
const STAMPED_OPERATIONS: ReadonlySet<string> = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
]);

/**
 * Operations this file does not know how to scope. Reaching one means Prisma
 * grew an operation since this was written, and the safe response is to fail
 * loudly rather than to let an unscoped query through.
 */
const UNSCOPED_ESCAPE_HATCHES: ReadonlySet<string> = new Set([
  '$queryRaw',
  '$queryRawUnsafe',
  '$executeRaw',
  '$executeRawUnsafe',
]);

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Narrows a `where` clause to one tenant.
 *
 * The predicate is ANDed rather than merged, so a caller that supplies its own
 * `tenantId` (or hides one inside `OR`) cannot widen the result: the outer AND
 * still has to hold.
 */
export function withTenantWhere(where: unknown, tenantId: string): UnknownRecord {
  if (where === undefined || where === null) {
    return { tenantId };
  }
  if (!isRecord(where)) {
    throw new TypeError('createTenantClient: `where` must be an object');
  }
  return { AND: [where, { tenantId }] };
}

/**
 * Stamps `tenantId` onto create or update data, accepting the single-object and
 * array forms that `create`, `createMany` and `updateMany` take.
 *
 * The stamp is applied last, so data that names a different tenant is corrected
 * rather than honoured.
 */
export function withTenantData(data: unknown, tenantId: string): unknown {
  if (data === undefined) return { tenantId };
  if (Array.isArray(data)) {
    return data.map((entry) => withTenantData(entry, tenantId));
  }
  if (!isRecord(data)) {
    throw new TypeError('createTenantClient: `data` must be an object or an array of objects');
  }
  return { ...data, tenantId };
}

/** Who is asking, on whose behalf, and why. Carried for the audit collector. */
export interface TenantContext {
  /** Organisation id. Every query issued through the client is bound to it. */
  tenantId: string;
  /** Acting principal, e.g. a User id, recorded on the events this client emits. */
  actorId?: string;
  actorType?: string;
  /** Facilities the actor may see; enforced by the policy layer above this one. */
  facilityIds?: readonly string[];
  /** HL7 PurposeOfUse for the request, e.g. `TREAT`. */
  purposeOfUse?: string;
}

interface ScopedArgs {
  where?: unknown;
  data?: unknown;
  create?: unknown;
  update?: unknown;
}

/**
 * Binds a root client to one organisation.
 *
 * Call it once per request, from the middleware that resolved the principal,
 * and pass the result down. Do not cache it across requests: the context it
 * closes over is request-scoped.
 */
export function createTenantClient(client: PrismaClient, context: TenantContext) {
  const { tenantId } = context;
  if (!tenantId) {
    throw new TypeError('createTenantClient: context.tenantId is required');
  }

  return client.$extends({
    name: 'openrunic-tenant-scope',
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          if (!isTenantScopedModel(model)) {
            return query(args);
          }
          if (UNSCOPED_ESCAPE_HATCHES.has(operation)) {
            throw new Error(
              `createTenantClient: ${operation} cannot be tenant-scoped. Use a typed query, or take a root client deliberately.`
            );
          }

          const scoped: ScopedArgs = isRecord(args) ? { ...args } : {};

          if (FILTERED_OPERATIONS.has(operation)) {
            scoped.where = withTenantWhere(scoped.where, tenantId);
          }
          if (STAMPED_OPERATIONS.has(operation)) {
            if (operation === 'upsert') {
              scoped.create = withTenantData(scoped.create, tenantId);
              scoped.update = withTenantData(scoped.update, tenantId);
            } else if (scoped.data !== undefined || operation.startsWith('create')) {
              scoped.data = withTenantData(scoped.data, tenantId);
            }
          }

          // `query` is typed as the union of every operation's args for every
          // model, which no single narrowed object can satisfy. The cast is
          // confined to this one line: everything above it is typed.
          return query(scoped as Parameters<typeof query>[0]);
        },
      },
    },
  });
}

/** The client type request handlers should accept. */
export type TenantClient = ReturnType<typeof createTenantClient>;
