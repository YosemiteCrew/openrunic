import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { AuditCollector } from '../audit/collector.js';
import { createMemoryAuditSink } from '../audit/memory-sink.js';
import { parseBearerToken, type Principal } from '../auth/principal.js';
import { createStaticPrincipalResolver } from '../auth/static-resolver.js';
import type { AppEnv } from '../context.js';
import { ApiError, isApiError } from '../errors.js';
import { auditCollector } from '../middleware/audit.js';
import { authn, DEFAULT_PUBLIC_PATHS } from '../middleware/authn.js';
import { buildMiddlewareChain, MIDDLEWARE_ORDER } from '../middleware/chain.js';
import { policyContext, requirePermission } from '../middleware/policy.js';
import { requestId } from '../middleware/request-id.js';
import { TENANT_HEADER, tenantScope } from '../middleware/tenant-scope.js';
import { createMemoryRepositoryRegistry } from '../repositories/memory.js';

import { DEMO_TENANT_A, DEMO_TENANT_B, TOKENS, bearer, testId } from './support.js';

/**
 * Each middleware is exercised on its own, in a bare Hono app with a probe
 * handler. Testing them composed only would mean a stage could be silently
 * doing nothing as long as another stage happened to cover for it.
 */

const PRINCIPAL: Principal = {
  subject: testId(900),
  tenantId: DEMO_TENANT_A,
  actorType: 'user',
  displayName: 'Dr. Okafor',
  roles: ['clinician'],
  facilityIds: [testId(800)],
  scopes: ['user/*.read', 'user/*.write'],
  purposeOfUse: 'TREAT',
};

function probeApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.onError((error) => {
    if (isApiError(error)) return new Response(error.kind, { status: error.status });
    throw error;
  });
  return app;
}

describe('parseBearerToken', () => {
  it('reads a bearer token case-insensitively and ignores anything else', () => {
    expect(parseBearerToken('Bearer abc')).toBe('abc');
    expect(parseBearerToken('bearer abc')).toBe('abc');
    expect(parseBearerToken('Bearer\tabc')).toBe('abc');
    expect(parseBearerToken('Basic abc')).toBeNull();
    expect(parseBearerToken('Bearer')).toBeNull();
    expect(parseBearerToken('Bearer a b')).toBeNull();
    expect(parseBearerToken(undefined)).toBeNull();
  });
});

describe('requestId middleware', () => {
  it('generates an id, exposes it on the context and echoes it back', async () => {
    const app = probeApp();
    app.use(requestId({ generate: () => 'generated-id' }));
    app.get('/', (c) => c.text(c.get('requestId')));

    const res = await app.request('/');

    expect(await res.text()).toBe('generated-id');
    expect(res.headers.get('x-request-id')).toBe('generated-id');
  });

  it('honours a well-formed inbound correlation id', async () => {
    const app = probeApp();
    app.use(requestId({ generate: () => 'generated-id' }));
    app.get('/', (c) => c.text(c.get('requestId')));

    const res = await app.request('/', { headers: { 'x-request-id': 'trace-abc-123' } });

    expect(await res.text()).toBe('trace-abc-123');
  });

  // The guard is a printable-ASCII-without-whitespace regex, so it rejects the
  // header-splitting and log-injection shapes for the same reason it rejects a
  // space. Those shapes cannot be sent through `fetch` at all - `Headers`
  // refuses to construct them - which is why the rows here are the ones a real
  // client can actually put on the wire.
  it.each([
    ['with whitespace', 'trace with spaces'],
    ['over the length cap', 'x'.repeat(129)],
    ['empty', ''],
  ])('replaces an inbound id %s rather than trusting it', async (_label, value) => {
    const app = probeApp();
    app.use(requestId({ generate: () => 'generated-id' }));
    app.get('/', (c) => c.text(c.get('requestId')));

    const res = await app.request('/', { headers: { 'x-request-id': value } });

    expect(await res.text()).toBe('generated-id');
  });

  it('defaults the response format to the problem document', async () => {
    const app = probeApp();
    app.use(requestId());
    app.get('/', (c) => c.text(c.get('responseFormat')));

    expect(await (await app.request('/')).text()).toBe('problem');
  });
});

describe('authn middleware', () => {
  const resolver = createStaticPrincipalResolver(new Map([['good', PRINCIPAL]]));

  function authnApp(): Hono<AppEnv> {
    const app = probeApp();
    app.use(authn({ resolver, publicPaths: ['/open'] }));
    app.get('/open', (c) => c.text(c.get('principal') === undefined ? 'anonymous' : 'principal'));
    app.get('/closed', (c) => c.text(c.get('principal')?.subject ?? 'none'));
    return app;
  }

  it('resolves a valid token to a principal', async () => {
    const res = await authnApp().request('/closed', { headers: bearer('good') });

    expect(await res.text()).toBe(PRINCIPAL.subject);
  });

  it('serves public paths anonymously', async () => {
    expect(await (await authnApp().request('/open')).text()).toBe('anonymous');
  });

  it.each([
    ['a missing header', {}],
    ['a non-bearer scheme', { authorization: 'Basic good' }],
    ['an unknown token', { authorization: 'Bearer nope' }],
  ])('rejects %s with an indistinguishable 401', async (_label, headers) => {
    const res = await authnApp().request('/closed', { headers });

    expect(res.status).toBe(401);
    expect(await res.text()).toBe('unauthenticated');
  });

  it('matches public paths exactly, never by prefix', async () => {
    const app = probeApp();
    app.use(authn({ resolver, publicPaths: DEFAULT_PUBLIC_PATHS }));
    app.get('/fhir/metadata/extra', (c) => c.text('reached'));

    expect((await app.request('/fhir/metadata/extra')).status).toBe(401);
  });

  it('awaits an asynchronous resolver, as a real token verifier will be', async () => {
    const app = probeApp();
    app.use(authn({ resolver: { resolve: () => Promise.resolve(PRINCIPAL) } }));
    app.get('/closed', (c) => c.text(c.get('principal')?.subject ?? 'none'));

    expect(await (await app.request('/closed', { headers: bearer('x') })).text()).toBe(
      PRINCIPAL.subject
    );
  });
});

describe('tenantScope middleware', () => {
  function scopeApp(): Hono<AppEnv> {
    const app = probeApp();
    app.use(async (c, next) => {
      if (c.req.header('x-anonymous') === undefined) c.set('principal', PRINCIPAL);
      await next();
    });
    app.use(tenantScope());
    app.get('/', (c) => c.text(c.get('tenantId') ?? 'unscoped'));
    return app;
  }

  it('takes the tenant from the principal', async () => {
    expect(await (await scopeApp().request('/')).text()).toBe(DEMO_TENANT_A);
  });

  it('accepts a tenant header that agrees with the principal', async () => {
    const res = await scopeApp().request('/', { headers: { [TENANT_HEADER]: DEMO_TENANT_A } });

    expect(await res.text()).toBe(DEMO_TENANT_A);
  });

  it('rejects a tenant header that names another organisation', async () => {
    const res = await scopeApp().request('/', { headers: { [TENANT_HEADER]: DEMO_TENANT_B } });

    expect(res.status).toBe(403);
    expect(await res.text()).toBe('forbidden');
  });

  it('leaves the scope unset when there is no principal', async () => {
    const res = await scopeApp().request('/', { headers: { 'x-anonymous': '1' } });

    expect(await res.text()).toBe('unscoped');
  });
});

describe('policy middleware', () => {
  function policyApp(principal?: Principal): Hono<AppEnv> {
    const app = probeApp();
    app.use(async (c, next) => {
      if (principal !== undefined) c.set('principal', principal);
      await next();
    });
    app.use(policyContext());
    app.get('/read', requirePermission('patient.read'), (c) => c.text('ok'));
    app.get('/claim', requirePermission('claim.write'), (c) => c.text('ok'));
    return app;
  }

  it('grants a permission the role holds', async () => {
    expect((await policyApp(PRINCIPAL).request('/read')).status).toBe(200);
  });

  it('denies a permission the role does not hold', async () => {
    const res = await policyApp(PRINCIPAL).request('/claim');

    expect(res.status).toBe(403);
    expect(await res.text()).toBe('forbidden');
  });

  it('answers 401, not 403, when no principal reached the guard', async () => {
    expect((await policyApp().request('/read')).status).toBe(401);
  });

  it('denies when the chain ran without the policy stage', async () => {
    const app = probeApp();
    app.use(async (c, next) => {
      c.set('principal', PRINCIPAL);
      await next();
    });
    app.get('/read', requirePermission('patient.read'), (c) => c.text('ok'));

    expect((await app.request('/read')).status).toBe(403);
  });

  it('contributes nothing for an unknown role rather than throwing', async () => {
    const stranger: Principal = { ...PRINCIPAL, roles: ['role-that-was-renamed'] };

    expect((await policyApp(stranger).request('/read')).status).toBe(403);
  });

  it('audits the denial before the error propagates', async () => {
    const sink = createMemoryAuditSink();
    const app = probeApp();
    app.use(async (c, next) => {
      c.set('principal', PRINCIPAL);
      c.set(
        'audit',
        new AuditCollector(sink, {
          tenantId: DEMO_TENANT_A,
          actorType: 'user',
          actorId: PRINCIPAL.subject,
          requestId: 'req-denial',
          method: 'GET',
          path: '/claim',
        })
      );
      await next();
    });
    app.use(policyContext());
    app.get('/claim', requirePermission('claim.write'), (c) => c.text('ok'));

    expect((await app.request('/claim')).status).toBe(403);
    expect(sink.writes()).toHaveLength(1);
    expect(sink.writes()[0]?.event).toMatchObject({
      action: 'authorisation.denied',
      outcome: 'failure',
      targetType: 'Route',
      targetId: '/claim',
    });
  });
});

describe('audit middleware', () => {
  function auditApp(sink = createMemoryAuditSink()) {
    const app = probeApp();
    app.use(async (c, next) => {
      c.set('requestId', 'req-audit');
      if (c.req.header('x-anonymous') === undefined) {
        c.set('principal', PRINCIPAL);
        c.set('tenantId', DEMO_TENANT_A);
      }
      await next();
    });
    app.use(auditCollector({ sink, repositories: createMemoryRepositoryRegistry() }));
    app.get('/read', (c) => {
      c.get('audit')?.read({ targetType: 'Patient', targetId: testId(1), patientId: testId(1) });
      return c.text('ok');
    });
    app.get('/none', (c) => c.text(c.get('repositories') === undefined ? 'unbound' : 'bound'));
    app.get('/boom', () => {
      throw ApiError.notFound('gone');
    });
    return { app, sink };
  }

  it('binds tenant-scoped repositories for the request', async () => {
    const { app } = auditApp();

    expect(await (await app.request('/none')).text()).toBe('bound');
  });

  it('flushes one batched read event after the response', async () => {
    const { app, sink } = auditApp();
    await app.request('/read');

    expect(sink.reads()).toHaveLength(1);
    expect(sink.reads()[0]?.event).toMatchObject({
      action: 'phi.read',
      targetType: 'Request',
      targetId: 'req-audit',
      patientId: testId(1),
    });
  });

  it('flushes even when the handler threw', async () => {
    const { app, sink } = auditApp();
    const res = await app.request('/boom');

    expect(res.status).toBe(404);
    expect(sink.events).toHaveLength(0);
  });

  it('does nothing without a principal', async () => {
    const { app, sink } = auditApp();
    const res = await app.request('/none', { headers: { 'x-anonymous': '1' } });

    expect(await res.text()).toBe('unbound');
    expect(sink.events).toHaveLength(0);
  });

  it('reports a failed flush instead of turning a served read into a 500', async () => {
    const onFlushError = vi.fn();
    const failing = {
      recordReadBatch: () => Promise.reject(new Error('sink down')),
      recordWrite: () => Promise.resolve(),
    };
    const app = probeApp();
    app.use(async (c, next) => {
      c.set('requestId', 'req-x');
      c.set('principal', PRINCIPAL);
      c.set('tenantId', DEMO_TENANT_A);
      await next();
    });
    app.use(
      auditCollector({
        sink: failing,
        repositories: createMemoryRepositoryRegistry(),
        onFlushError,
      })
    );
    app.get('/read', (c) => {
      c.get('audit')?.read({ targetType: 'Patient', targetId: testId(1) });
      return c.text('ok');
    });

    const res = await app.request('/read');

    expect(res.status).toBe(200);
    expect(onFlushError).toHaveBeenCalledOnce();
  });

  it('warns on the console by default when the flush fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = probeApp();
    app.use(async (c, next) => {
      c.set('requestId', 'req-y');
      c.set('principal', PRINCIPAL);
      c.set('tenantId', DEMO_TENANT_A);
      await next();
    });
    app.use(
      auditCollector({
        sink: {
          recordReadBatch: () => Promise.reject(new Error('sink down')),
          recordWrite: () => Promise.resolve(),
        },
        repositories: createMemoryRepositoryRegistry(),
      })
    );
    app.get('/read', (c) => {
      c.get('audit')?.read({ targetType: 'Patient', targetId: testId(1) });
      return c.text('ok');
    });

    expect((await app.request('/read')).status).toBe(200);
    expect(errorSpy).toHaveBeenCalledWith('audit flush failed', expect.any(Error));
    errorSpy.mockRestore();
  });
});

describe('the chain', () => {
  it('is built in the order the plan fixes', () => {
    const chain = buildMiddlewareChain({
      principalResolver: createStaticPrincipalResolver(new Map()),
      repositories: createMemoryRepositoryRegistry(),
      auditSink: createMemoryAuditSink(),
    });

    expect(chain.map((link) => link.stage)).toEqual([...MIDDLEWARE_ORDER]);
    expect(MIDDLEWARE_ORDER).toEqual(['request-id', 'authn', 'tenant-scope', 'policy', 'audit']);
  });

  it('threads every optional dependency through', () => {
    const chain = buildMiddlewareChain({
      principalResolver: createStaticPrincipalResolver(new Map([[TOKENS.clinicianA, PRINCIPAL]])),
      repositories: createMemoryRepositoryRegistry(),
      auditSink: createMemoryAuditSink(),
      publicPaths: ['/healthz'],
      generateRequestId: () => 'fixed',
      onAuditFlushError: () => undefined,
    });

    expect(chain).toHaveLength(MIDDLEWARE_ORDER.length);
  });
});
