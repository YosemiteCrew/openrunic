import {
  CdsHooksError,
  discoveryDocument,
  parseRequest,
  serviceById,
  type CdsResponse,
} from '@openrunic/cds-hooks';
import { Hono } from 'hono';

import type { AppEnv } from '../context.js';
import { ApiError } from '../errors.js';
import { requirePermission } from '../middleware/policy.js';

import { CDS_SERVICES, encounterOf } from './services.js';

/**
 * THE CDS HOOKS SURFACE.
 *
 * Two routes, and they are authorised differently on purpose.
 *
 * Discovery is public. A calling EMR needs it before it has been configured with
 * anything, which is why the specification treats it as open - and it is safe to
 * be, because the document is identical whichever organisation asks. It names
 * services, hooks and descriptions and says nothing about this practice.
 *
 * Invocation is not. A hook is a read of a patient's chart, dressed as a
 * question about a decision, so it goes through the same authentication,
 * tenanting and permission chain as every other read. A service that answered
 * questions about a chart without one would be a way around the rest of the API.
 *
 * The invocation response is deliberately shaped so that a caller cannot tell an
 * empty answer from a refused one by looking at the body: a 403 is a 403, and
 * "no cards" always means the services looked and had nothing to say.
 */

/** Mount point. Fixed by the specification, not a choice. */
export const CDS_BASE_PATH = '/cds-services';

export function cdsRoutes(): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.get('/', (c) =>
    c.json(discoveryDocument(CDS_SERVICES.map((service) => service.definition)), 200, {
      // Short, because a service list changes when the software does and a
      // client that cached it for a day would keep calling one that was removed.
      'cache-control': 'public, max-age=300',
    })
  );

  router.post('/:id', requirePermission('patient.read'), async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      throw ApiError.malformed('The request body is not valid JSON.');
    }

    const service = translate(() => serviceById(CDS_SERVICES, c.req.param('id')));
    const request = translate(() => parseRequest(body));

    if (request.hook !== service.definition.hook) {
      throw ApiError.malformed(
        `${service.definition.id} answers the ${service.definition.hook} hook; this request names ${request.hook}.`
      );
    }

    // Wrapped, because the services read the hook context and a context missing
    // the field a hook requires is the caller's error rather than this server's.
    const cards = await translateAsync(() => service.evaluate(c, request));

    // The invocation is audited as the chart read it is. `hookInstance` is
    // recorded because it is what joins a card a clinician was shown to the
    // request that produced it, and `offeredFhirServer` because a caller
    // offering one and not being followed is worth being able to demonstrate.
    await c.get('audit')?.write({
      action: 'cds.invoked',
      targetType: 'CdsService',
      targetId: service.definition.id,
      metadata: {
        hook: request.hook,
        hookInstance: request.hookInstance,
        cards: cards.length,
        ...(encounterOf(request) === undefined ? {} : { encounterId: encounterOf(request) }),
        ...(request.offeredFhirServer === undefined
          ? {}
          : { offeredFhirServer: request.offeredFhirServer, followed: false }),
        ...(request.prefetchOffered ? { prefetchOffered: true, used: false } : {}),
      },
    });

    return c.json({ cards } satisfies CdsResponse);
  });

  return router;
}

/**
 * Turns a protocol error into this API's own.
 *
 * The package raises `CdsHooksError` because it knows nothing about Hono; the
 * boundary is here so a malformed hook request produces the same problem
 * document as every other malformed request, rather than a second error shape a
 * client has to learn.
 */
function translate<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    throw asApiError(error);
  }
}

/** The same, for a service that reads the context while it works. */
async function translateAsync<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw asApiError(error);
  }
}

function asApiError(error: unknown): unknown {
  if (error instanceof CdsHooksError) {
    return error.status === 404
      ? ApiError.notFound(error.message)
      : ApiError.malformed(error.message);
  }
  return error;
}
