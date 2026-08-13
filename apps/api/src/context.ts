import type { AuditCollector } from './audit/collector.js';
import type { Principal } from './auth/principal.js';
import type { PolicyContext } from './policy/policy.js';
import type { Repositories } from './repositories/types.js';

/**
 * The typed request context.
 *
 * Every variable here is set by exactly one middleware, in the order declared
 * by `middleware/chain.ts`. The optional ones are optional because the public
 * routes - health, CapabilityStatement, OpenAPI - run the same chain without a
 * principal; a handler that needs one asks through `requirePermission`, which
 * fails closed rather than reading an absent value.
 */
export interface AppVariables {
  /** Correlates logs, audit events and the `x-request-id` response header. */
  requestId: string;
  principal?: Principal;
  /** The organisation every query in this request is confined to. */
  tenantId?: string;
  policy?: PolicyContext;
  audit?: AuditCollector;
  /** Already bound to `tenantId`; there is no unscoped registry to reach. */
  repositories?: Repositories;
  /** Chooses the error representation: problem+json or OperationOutcome. */
  responseFormat: 'problem' | 'fhir';
}

export interface AppEnv {
  Variables: AppVariables;
}
