import { FHIR_VERSION, type CapabilityStatement, type OperationOutcome } from '@openrunic/fhir';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../app.js';
import { createMemoryAuditSink } from '../audit/memory-sink.js';
import { createStaticPrincipalResolver } from '../auth/static-resolver.js';
import { createMemoryRepositoryRegistry } from '../repositories/memory.js';

import { bearer, createTestApp, TOKENS } from './support.js';

describe('createApp', () => {
  it('GET /healthz reports service health without a token', async () => {
    const { app } = createTestApp();
    const res = await app.request('/healthz');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', service: 'openrunic-api' });
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('echoes a request id on every response', async () => {
    const { app } = createTestApp();
    const res = await app.request('/healthz');

    expect(res.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('GET /fhir/metadata serves a FHIR R4 CapabilityStatement', async () => {
    const { app } = createTestApp();
    const res = await app.request('/fhir/metadata');

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/fhir+json');

    const body = (await res.json()) as CapabilityStatement;
    expect(body.resourceType).toBe('CapabilityStatement');
    expect(body.status).toBe('active');
    expect(body.kind).toBe('instance');
    expect(body.fhirVersion).toBe(FHIR_VERSION);
    expect(body.format).toEqual(['application/fhir+json']);
    expect(body.software).toMatchObject({ name: 'openrunic' });
  });

  it('unknown /fhir/* routes return a 404 OperationOutcome', async () => {
    const { app } = createTestApp();
    const res = await app.request('/fhir/Observation/does-not-exist', {
      headers: bearer(TOKENS.clinicianA),
    });

    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toBe('application/fhir+json');

    const body = (await res.json()) as OperationOutcome;
    expect(body.resourceType).toBe('OperationOutcome');
    expect(body.issue[0]).toMatchObject({ severity: 'error', code: 'not-found' });
  });

  it('non-GET requests to an unserved /fhir path also return the FHIR 404', async () => {
    const { app } = createTestApp();
    const res = await app.request('/fhir/Observation', {
      method: 'POST',
      headers: bearer(TOKENS.clinicianA),
    });

    expect(res.status).toBe(404);
    expect(((await res.json()) as OperationOutcome).resourceType).toBe('OperationOutcome');
  });

  it('unknown non-FHIR routes return a problem document, not a FHIR outcome', async () => {
    const { app } = createTestApp();
    const res = await app.request('/nope', { headers: bearer(TOKENS.clinicianA) });

    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
  });

  it('answers an unknown path anonymously with 401, never with a 404 that maps the API', async () => {
    const { app } = createTestApp();

    expect((await app.request('/nope')).status).toBe(401);
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

  it('renders an unexpected exception as a bare 500 that leaks nothing', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // A resolver that throws produces an ordinary Error rather than an ApiError,
    // which is the path the generic 500 handler exists for.
    const exploding = createApp({
      repositories: createMemoryRepositoryRegistry(),
      auditSink: createMemoryAuditSink(),
      principalResolver: {
        resolve() {
          throw new Error('BOOM: postgres://USER:PASSWORD@db/emr');
        },
      },
    });

    const res = await exploding.request('/bff/v0/patients', { headers: bearer('anything') });
    expect(res.status).toBe(500);

    const body = await res.text();
    expect(body).not.toContain('BOOM');
    expect(body).not.toContain('hunter2');
    expect(body).toContain('request id');
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('refuses the development defaults under NODE_ENV=production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    try {
      expect(() => createApp()).toThrow(/repositories, principalResolver, auditSink/);
      expect(() =>
        createApp({
          repositories: createMemoryRepositoryRegistry(),
          auditSink: createMemoryAuditSink(),
          principalResolver: createStaticPrincipalResolver(new Map()),
        })
      ).not.toThrow();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
