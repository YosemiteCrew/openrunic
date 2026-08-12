import { FHIR_VERSION, type CapabilityStatement, type OperationOutcome } from '@openrunic/fhir';
import { Hono, type Context } from 'hono';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';

const FHIR_JSON = 'application/fhir+json';

function fhirResponse(
  c: Context,
  resource: CapabilityStatement | OperationOutcome,
  status: 200 | 404
): Response {
  return c.body(JSON.stringify(resource), status, { 'Content-Type': FHIR_JSON });
}

/**
 * Build the openrunic API app. Kept free of port binding so tests can drive it
 * through `app.request()` directly.
 */
export function createApp(): Hono {
  const app = new Hono();

  if (process.env.NODE_ENV !== 'test') {
    app.use(logger());
  }
  app.use(secureHeaders());

  app.get('/healthz', (c) => c.json({ status: 'ok', service: 'openrunic-api' }));

  app.get('/fhir/metadata', (c) => {
    const capabilityStatement: CapabilityStatement = {
      resourceType: 'CapabilityStatement',
      status: 'active',
      date: new Date().toISOString(),
      kind: 'instance',
      software: { name: 'openrunic' },
      fhirVersion: FHIR_VERSION,
      format: [FHIR_JSON],
      rest: [{ mode: 'server', resource: [] }],
    };
    return fhirResponse(c, capabilityStatement, 200);
  });

  app.all('/fhir/*', (c) => {
    const outcome: OperationOutcome = {
      resourceType: 'OperationOutcome',
      issue: [{ severity: 'error', code: 'not-found' }],
    };
    return fhirResponse(c, outcome, 404);
  });

  return app;
}
