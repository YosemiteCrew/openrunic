import { createMiddleware } from 'hono/factory';

import { AuditCollector } from '../audit/collector.js';
import type { AuditSink } from '../audit/types.js';
import type { AppEnv } from '../context.js';
import { buildPolicyContext } from '../policy/policy.js';
import type { RepositoryRegistry } from '../repositories/types.js';

export interface AuditCollectorOptions {
  sink: AuditSink;
  repositories: RepositoryRegistry;
  /** Called when the post-response flush fails. Defaults to a console warning. */
  onFlushError?: (error: unknown) => void;
  /**
   * Whether this path's repositories should hide rows outside the caller's
   * facilities, rather than letting the route refuse them.
   *
   * The two boundaries answer differently on purpose. The FHIR boundary hides:
   * a resource at a site the caller has no grant for is a 404, the same answer
   * as one that does not exist, so search cannot be used to enumerate what
   * exists elsewhere in the tenant. The BFF refuses: those routes serve a staff
   * application whose user is already inside the organisation, and telling them
   * "you have no grant for that site" is more useful than pretending the
   * appointment is not there.
   *
   * Defaults to hiding nothing, so a caller that does not pass this keeps the
   * behaviour it had.
   */
  facilityScopedFor?: (path: string) => boolean;
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
  const scopeFacilities = options.facilityScopedFor ?? ((): boolean => false);
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
        // Omitted entirely for a principal holding `facility.all`, because the
        // scope reads undefined as unrestricted and an empty array as nothing.
        // Passing `principal.facilityIds` unconditionally would give an
        // organisation-wide role the empty grant list it happens to carry, and
        // it would see no sited rows at all.
        // Undefined for a principal holding `facility.all`, and for any path
        // that did not ask to be scoped. The scope reads undefined as
        // unrestricted and an empty array as nothing, so passing
        // `principal.facilityIds` unconditionally would give an
        // organisation-wide role its empty grant list and show it no sited rows
        // at all.
        ...(scopeFacilities(c.req.path) && !buildPolicyContext(principal).can('facility.all')
          ? { facilityIds: principal.facilityIds }
          : {}),
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
