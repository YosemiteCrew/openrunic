import { FHIR_VERSION, type CapabilityStatement, type OperationOutcome } from '@openrunic/fhir';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../app.js';

describe('createApp', () => {
  const app = createApp();

  it('GET /healthz reports service health', async () => {
    const res = await app.request('/healthz');

    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    expect(body).toEqual({ status: 'ok', service: 'openrunic-api' });
    // secure-headers middleware is wired in
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('GET /fhir/metadata serves a FHIR R4 CapabilityStatement', async () => {
    const res = await app.request('/fhir/metadata');

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/fhir+json');

    const body = (await res.json()) as CapabilityStatement;
    expect(body.resourceType).toBe('CapabilityStatement');
    expect(body.status).toBe('active');
    expect(body.kind).toBe('instance');
    expect(body.fhirVersion).toBe(FHIR_VERSION);
    expect(body.format).toEqual(['application/fhir+json']);
    expect(body.rest).toEqual([{ mode: 'server', resource: [] }]);
    expect(body.software).toEqual({ name: 'openrunic' });
  });

  it('unknown /fhir/* routes return a 404 OperationOutcome', async () => {
    const res = await app.request('/fhir/Patient/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toBe('application/fhir+json');

    const body = (await res.json()) as OperationOutcome;
    expect(body.resourceType).toBe('OperationOutcome');
    expect(body.issue).toHaveLength(1);
    expect(body.issue[0]).toMatchObject({ severity: 'error', code: 'not-found' });
  });

  it('non-GET requests to /fhir/* also return the FHIR 404', async () => {
    const res = await app.request('/fhir/metadata', { method: 'POST' });

    expect(res.status).toBe(404);
    const body = (await res.json()) as OperationOutcome;
    expect(body.resourceType).toBe('OperationOutcome');
  });

  it('enables request logging outside the test environment', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.stubEnv('NODE_ENV', 'development');
    try {
      const devApp = createApp();
      const res = await devApp.request('/healthz');
      expect(res.status).toBe(200);
      expect(logSpy).toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
      logSpy.mockRestore();
    }
  });
});
