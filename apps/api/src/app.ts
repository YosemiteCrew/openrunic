import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';

import type { AgentRuntime } from '@openrunic/agent';

import { agentRouteContracts, agentRoutes } from './agent/routes.js';
import { createAuditBridge, loadAgentRuntime, type AuditBridge } from './agent/runtime.js';
import { createAuditChainStore } from './audit/chain-store.js';
import { createMemoryAuditSink } from './audit/memory-sink.js';
import type { AuditSink } from './audit/types.js';
import type { PrincipalResolver } from './auth/principal.js';
import { DEMO_PRINCIPALS, createStaticPrincipalResolver } from './auth/static-resolver.js';
import type { AppEnv } from './context.js';
import { ApiError, isApiError } from './errors.js';
import { CDS_BASE_PATH, cdsRoutes } from './cds/index.js';
import { FHIR_BASE_PATH, fhirRoutes, isFhirPath } from './fhir/index.js';
import { operationOutcomeResponse } from './http/fhir.js';
import { problemResponse } from './http/problem.js';
import { buildMiddlewareChain } from './middleware/chain.js';
import { buildOpenApiDocument } from './openapi/spec.js';
import { createMemoryRepositoryRegistry } from './repositories/memory.js';
import type { RepositoryRegistry } from './repositories/types.js';
import { BFF_BASE_PATH, internalRouteContracts, internalRoutes } from './routes/index.js';

/** Reported in the CapabilityStatement and the OpenAPI document. */
export const SOFTWARE_VERSION = '0.0.0';

export interface CreateAppOptions {
  /**
   * Data access. Defaults to the in-memory registry, which is right for tests
   * and for a database-less development run and wrong for everything else -
   * hence the production guard below.
   */
  repositories?: RepositoryRegistry;
  /** Token verification. Defaults to the static demo table. */
  principalResolver?: PrincipalResolver;
  auditSink?: AuditSink;
  now?: () => Date;
  generateRequestId?: () => string;
  onAuditFlushError?: (error: unknown) => void;
  /**
   * The assistant subsystem (ADR-0005). Defaults to whatever the environment
   * says, which by default says nothing: no endpoint configured means no agent
   * routes are mounted at all, so every agent path answers 404 and the rest of
   * the API is byte-for-byte the same product.
   */
  agent?: AgentRuntime;
  /**
   * Carries the request-scoped audit collector into the loop. Supply it
   * alongside `agent`, because the loop was built holding this bridge's sink
   * and a different one would drop every event on the floor.
   */
  agentAudit?: AuditBridge;
  /**
   * Whether the API can actually serve data right now.
   *
   * Distinct from liveness, and the distinction is the point. `/healthz` says
   * the process is running; a process with no database is running perfectly and
   * cannot answer a single clinical question. Without a separate readiness
   * check, a database outage reads as healthy to every orchestrator and every
   * status page, which is precisely when staff most need to be told.
   *
   * Absent in development, where there is no database to be ready for.
   */
  readiness?: () => Promise<boolean>;
}

/**
 * Builds the openrunic API.
 *
 * No port binding, so the suite drives the whole stack through
 * `app.request()`: middleware order, tenant isolation, authorisation, paging
 * and the FHIR contract are all tested against the same object that runs in
 * production, not against a test double of it.
 *
 * The defaults are development defaults - an in-memory store, a table of
 * public demo tokens - and `assertProductionWiring` refuses to start with them
 * under `NODE_ENV=production`. A convenience default that silently survives
 * into production is how a demo token becomes a credential.
 */
export function createApp(options: CreateAppOptions = {}): Hono<AppEnv> {
  const isProduction = process.env.NODE_ENV === 'production';
  assertProductionWiring(options, isProduction);

  // One chain, shared by the default sink and the default store, so a
  // database-less development run can read back the events it just wrote. A
  // second, plausible-looking copy of the audit log would be worse than none.
  const auditStore = createAuditChainStore();
  const repositories = options.repositories ?? createMemoryRepositoryRegistry({ auditStore });
  const principalResolver =
    options.principalResolver ?? createStaticPrincipalResolver(DEMO_PRINCIPALS);
  const auditSink = options.auditSink ?? createMemoryAuditSink({ store: auditStore });
  const now = options.now ?? ((): Date => new Date());

  const app = new Hono<AppEnv>();

  if (process.env.NODE_ENV !== 'test') {
    app.use(logger());
  }
  app.use(secureHeaders());

  for (const link of buildMiddlewareChain({
    principalResolver,
    repositories,
    auditSink,
    responseFormatFor: (path) => (isFhirPath(path) ? 'fhir' : 'problem'),
    ...(options.generateRequestId === undefined
      ? {}
      : { generateRequestId: options.generateRequestId }),
    ...(options.onAuditFlushError === undefined
      ? {}
      : { onAuditFlushError: options.onAuditFlushError }),
  })) {
    app.use(link.handler);
  }

  const auditBridge = options.agentAudit ?? createAuditBridge();
  const agent =
    options.agent ??
    loadAgentRuntime({
      audit: auditBridge.sink,
      onMisconfigured: (reason) => {
        // Loud, and only about the agent. A misconfigured assistant must never
        // stop a clinic booking an appointment (ADR-0005).
        console.error(`openrunic agent subsystem disabled: ${reason}`);
      },
    });

  // Liveness: is this process running. Deliberately checks nothing else, so a
  // restart loop cannot be caused by a dependency being briefly slow.
  app.get('/healthz', (c) => c.json({ status: 'ok', service: 'openrunic-api' }));

  // Readiness: can this process serve data. 503 when the database is gone, so
  // an outage is visible to the container runtime and to the web application
  // rather than hiding behind a liveness check that can never fail.
  app.get('/readyz', async (c) => {
    if (options.readiness === undefined) {
      return c.json({ status: 'ok', service: 'openrunic-api', checked: [] });
    }

    const ready = await options.readiness().catch(() => false);
    return c.json(
      { status: ready ? 'ok' : 'degraded', service: 'openrunic-api', checked: ['database'] },
      ready ? 200 : 503
    );
  });

  app.get('/openapi.json', (c) =>
    c.json(
      buildOpenApiDocument([
        ...internalRouteContracts(),
        // Documented only where it exists. An endpoint in the specification
        // that answers 404 is worse than an undocumented one.
        ...(agent.status === 'enabled' ? agentRouteContracts : []),
      ])
    )
  );

  app.route(FHIR_BASE_PATH, fhirRoutes({ softwareVersion: SOFTWARE_VERSION, now }));
  app.route(CDS_BASE_PATH, cdsRoutes());
  app.route(BFF_BASE_PATH, internalRoutes());

  if (agent.status === 'enabled') {
    app.route(BFF_BASE_PATH, agentRoutes({ runtime: agent, audit: auditBridge }));
  }

  app.notFound(() => {
    throw ApiError.notFound('No route matches this path.');
  });

  /**
   * The single error boundary. It is the only place a status code becomes a
   * response body, which is what keeps the two error contracts - problem+json
   * on the internal API, OperationOutcome on FHIR - from drifting apart: they
   * render the same `ApiError`, so they always agree on the status and the
   * reason.
   *
   * An unexpected exception becomes a bare 500 whose body carries the request
   * id and nothing else. A stack trace or a database message in the body would
   * be a PHI leak and a reconnaissance gift; the request id is enough to find
   * the real error in the logs.
   */
  app.onError((error, c) => {
    const apiError = isApiError(error)
      ? error
      : new ApiError('internal-error', {
          detail: 'The request could not be completed. Quote the request id when reporting it.',
        });

    if (!isApiError(error)) {
      console.error('unhandled error', { requestId: c.get('requestId'), error });
    }

    return c.get('responseFormat') === 'fhir'
      ? operationOutcomeResponse(c, apiError)
      : problemResponse(c, apiError);
  });

  return app;
}

/**
 * Refuses the development defaults in production.
 *
 * Thrown at construction rather than logged as a warning: a process that
 * cannot serve real data safely should fail to start, loudly, while someone is
 * watching the deploy.
 */
function assertProductionWiring(options: CreateAppOptions, isProduction: boolean): void {
  if (!isProduction) return;

  const missing = [
    options.repositories === undefined ? 'repositories' : undefined,
    options.principalResolver === undefined ? 'principalResolver' : undefined,
    options.auditSink === undefined ? 'auditSink' : undefined,
  ].filter((name): name is string => name !== undefined);

  if (missing.length > 0) {
    throw new Error(
      `createApp: NODE_ENV=production requires explicit ${missing.join(', ')}. The defaults are an in-memory store and a table of public demo tokens.`
    );
  }
}
