/**
 * `@openrunic/database` - the relational source of truth.
 *
 * What this package owns: the Prisma schema and its migrations, the tenant
 * scoping layer, the id generator, the audit hash chain, the form-promotion
 * rule, and the Zod write contract for every aggregate. FHIR serialization is
 * `@openrunic/fhir`'s job; this package is deliberately storage-only.
 */

// Clients. `createPrismaClient` returns a root, unscoped client: it is for
// migrations, the seed and the CLI. Request paths must wrap it in
// `createTenantClient`, so that isolation is not something a handler can forget.
export { createPrismaClient } from './client.js';
export type { CreatePrismaClientOptions } from './client.js';
export type { PrismaClient } from './generated/prisma/client.js';
export { Prisma } from './generated/prisma/client.js';

export {
  TENANT_SCOPED_MODELS,
  createTenantClient,
  isTenantScopedModel,
  withTenantData,
  withTenantWhere,
} from './tenant.js';
export type { TenantClient, TenantContext, TenantScopedModel } from './tenant.js';

// Row-level security. `withTenantSession` is the only supported way to reach
// Postgres with the tenant setting the policies read; a query issued outside it
// sees zero rows, because the policies fail closed.
export { TENANT_SETTING, withTenantSession } from './rls.js';
export type { TenantTransactionClient } from './rls.js';

// Identity.
export { createUuidv7, isUuidv7, uuidv7, uuidv7Timestamp } from './uuid.js';
export type { Uuidv7Options } from './uuid.js';

// Audit: the input schema plus the hash chain.
export {
  AUDIT_CHAINED_FIELDS,
  AUDIT_GENESIS_HASH,
  auditChainPayload,
  auditEventInput,
  canonicalJson,
  computeAuditHash,
  linkAuditEvent,
  verifyAuditChain,
} from './audit.js';
export type {
  AuditChainBreak,
  AuditChainFields,
  AuditChainTail,
  AuditChainVerification,
  AuditChainedEvent,
  AuditChainedField,
  AuditEventInput,
  JsonValue,
} from './audit.js';

// Form engine storage: the promotion rule.
export { FormPromotionError, PROMOTED_FIELD_TYPES, promoteSubmission } from './forms.js';
export type {
  PromotableSubmission,
  PromoteOptions,
  PromotedFieldSpec,
  PromotedFieldType,
  PromotedValueRow,
  PromotionManifest,
} from './forms.js';

// The schema's closed value sets, as tuples usable by Zod and by the UI.
export * from './enums.js';

// Zod input schemas, one module per aggregate.
export * from './schemas/index.js';
