import type { MiddlewareHandler } from 'hono';

import type { AuditSink } from '../audit/types.js';
import type { PrincipalResolver } from '../auth/principal.js';
import type { AppEnv } from '../context.js';
import type { RepositoryRegistry } from '../repositories/types.js';

import { authn } from './authn.js';
import { auditCollector } from './audit.js';
import { policyContext } from './policy.js';
import { requestId } from './request-id.js';
import { tenantScope } from './tenant-scope.js';

/**
 * The middleware chain. The order is law (plan section 4.1):
 *
 *   1. `request-id`   correlation exists before anything can fail
 *   2. `authn`        who is asking
 *   3. `tenant-scope` which organisation, derived from the principal alone
 *   4. `policy`       what that principal may do
 *   5. `audit`        the collector, and the tenant-bound repositories it feeds
 *
 * Each stage depends on the one before it and on nothing after it, which is why
 * the order is not a preference. Authentication before scope means a tenant can
 * never be taken from an unverified request. Scope before policy means a role
 * is always evaluated inside an organisation. Policy before audit means a
 * denial has a collector to be recorded in. And request-id first means every
 * one of those failures is traceable.
 */
export const MIDDLEWARE_ORDER = ['request-id', 'authn', 'tenant-scope', 'policy', 'audit'] as const;

export type MiddlewareStage = (typeof MIDDLEWARE_ORDER)[number];

export interface ChainDependencies {
  principalResolver: PrincipalResolver;
  repositories: RepositoryRegistry;
  auditSink: AuditSink;
  publicPaths?: Iterable<string>;
  generateRequestId?: () => string;
  /** Chooses problem+json or OperationOutcome, per path. */
  responseFormatFor?: (path: string) => 'problem' | 'fhir';
  /**
   * Whether a path's repositories hide a row addressed by id when it sits in an
   * ungranted facility. See the note on
   * `AuditCollectorOptions.hideFacilityRowsFor`: the FHIR boundary hides, the
   * BFF loads the row and refuses. Lists are narrowed on every path either way.
   */
  hideFacilityRowsFor?: (path: string) => boolean;
  onAuditFlushError?: (error: unknown) => void;
}

export interface ChainLink {
  stage: MiddlewareStage;
  handler: MiddlewareHandler<AppEnv>;
}

/**
 * Builds the chain as data so `app.ts` mounts it in one loop and the test suite
 * can assert the order directly, rather than inferring it from behaviour.
 */
export function buildMiddlewareChain(deps: ChainDependencies): ChainLink[] {
  return [
    {
      stage: 'request-id',
      handler: requestId({
        ...(deps.generateRequestId === undefined ? {} : { generate: deps.generateRequestId }),
        ...(deps.responseFormatFor === undefined
          ? {}
          : { responseFormatFor: deps.responseFormatFor }),
      }),
    },
    {
      stage: 'authn',
      handler: authn({
        resolver: deps.principalResolver,
        ...(deps.publicPaths === undefined ? {} : { publicPaths: deps.publicPaths }),
      }),
    },
    { stage: 'tenant-scope', handler: tenantScope() },
    { stage: 'policy', handler: policyContext() },
    {
      stage: 'audit',
      handler: auditCollector({
        sink: deps.auditSink,
        repositories: deps.repositories,
        ...(deps.onAuditFlushError === undefined ? {} : { onFlushError: deps.onAuditFlushError }),
        ...(deps.hideFacilityRowsFor === undefined
          ? {}
          : { hideFacilityRowsFor: deps.hideFacilityRowsFor }),
      }),
    },
  ];
}
