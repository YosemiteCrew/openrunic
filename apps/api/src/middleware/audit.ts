import { createMiddleware } from 'hono/factory';

import { AuditCollector } from '../audit/collector.js';
import type { AuditSink } from '../audit/types.js';
import type { AppEnv } from '../context.js';
import type { RepositoryRegistry } from '../repositories/types.js';

export interface AuditCollectorOptions {
  sink: AuditSink;
  repositories: RepositoryRegistry;
  /** Called when the post-response flush fails. Defaults to a console warning. */
  onFlushError?: (error: unknown) => void;
}

/**
 * Stage 5 of the chain, and the last. Creates the request-scoped audit
 * collector, binds the repositories to it, and flushes the batched read event
 * once the response is settled.
 *
 * Binding happens here rather than in the tenant middleware because the
 * repositories need both halves - the organisation and the collector - and
 * giving them out only when both exist is what makes "every PHI path is
 * audited" structural instead of a review checklist.
 *
 * The flush is deliberately after `next()` and outside the response path: a
 * read must not wait on its own audit write (plan section 3.3). A failed flush
 * is reported, never rethrown, because the response has already been decided
 * and turning a delivered read into a 500 would lose the clinical data *and*
 * the audit record.
 */
export function auditCollector(options: AuditCollectorOptions) {
  const onFlushError =
    options.onFlushError ??
    ((error: unknown): void => {
      console.error('audit flush failed', error);
    });

  return createMiddleware<AppEnv>(async (c, next) => {
    const principal = c.get('principal');
    const tenantId = c.get('tenantId');
    if (principal === undefined || tenantId === undefined) {
      await next();
      return;
    }

    const collector = new AuditCollector(options.sink, {
      tenantId,
      actorType: principal.actorType,
      actorId: principal.subject,
      ...(principal.displayName === undefined ? {} : { actorDisplay: principal.displayName }),
      purposeOfUse: principal.purposeOfUse,
      ...(principal.breakglass === undefined ? {} : { breakglass: principal.breakglass }),
      requestId: c.get('requestId'),
      method: c.req.method,
      path: c.req.path,
    });

    c.set('audit', collector);
    // The launch context travels with the repositories, not with the handlers.
    // A patient-scoped token therefore reaches one chart because the objects it
    // is given cannot reach another, rather than because every handler
    // remembered to ask.
    c.set(
      'repositories',
      options.repositories.forRequest({
        tenantId,
        ...(principal.compartmentPatientId === undefined
          ? {}
          : { compartmentPatientId: principal.compartmentPatientId }),
        audit: collector,
      })
    );

    try {
      await next();
    } finally {
      try {
        await collector.flush();
      } catch (error) {
        onFlushError(error);
      }
    }
  });
}
