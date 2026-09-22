import type { AuditCollector } from './audit/collector.js';
import type { Principal } from './auth/principal.js';
import type { ScopeCompartment } from './auth/scopes.js';
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
  /**
   * One instant for the whole request, read once by `request-id`.
   *
   * A decision that depends on time must not depend on WHEN inside the response
   * it is taken. `gateCharts` asks the care-relationship question once per
   * distinct chart on a page, sequentially, and three of the seven relationship
   * sources are bounded by a period or a window - so a grant, a membership or
   * the facility-activity window expiring between two of those calls
   * authorises one chart and refuses another inside one answer, or records the
   * same page under two compliance classifications. Neither is decided by
   * anything the reader did (#426).
   */
  receivedAt: Date;
  principal?: Principal;
  /** The organisation every query in this request is confined to. */
  tenantId?: string;
  policy?: PolicyContext;
  audit?: AuditCollector;
  /** Already bound to `tenantId`; there is no unscoped registry to reach. */
  repositories?: Repositories;
  /** Chooses the error representation: problem+json or OperationOutcome. */
  responseFormat: 'problem' | 'fhir';
  /**
   * Which SMART compartment granted the current FHIR interaction. Set by the
   * scope guard; absent everywhere else, because only the FHIR boundary speaks
   * scopes.
   */
  scopeCompartment?: ScopeCompartment;
}

export interface AppEnv {
  Variables: AppVariables;
}
