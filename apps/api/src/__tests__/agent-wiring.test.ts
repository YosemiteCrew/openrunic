import { createAgentRuntime, scriptedModel, type AgentRuntime } from '@openrunic/agent';
import { recordingApiClient } from '@openrunic/agent-tools/testing';
import { Hono, type Context } from 'hono';
import { describe, expect, it } from 'vitest';

import { agentRoutes } from '../agent/routes.js';
import { createAuditBridge, loadAgentRuntime, type AuditBridge } from '../agent/runtime.js';
import { AuditCollector } from '../audit/collector.js';
import { createMemoryAuditSink, type MemoryAuditSink } from '../audit/memory-sink.js';
import type { Principal } from '../auth/principal.js';
import type { AppEnv } from '../context.js';
import { isApiError } from '../errors.js';
import { problemResponse } from '../http/problem.js';

import { DEMO_TENANT_A, testId } from './support.js';

/**
 * The guards that only fire when something is wired wrongly.
 *
 * The router is mounted here **outside** the middleware chain, which is the
 * mistake these guards exist for. The property under test is the one
 * `requirePermission` already has elsewhere in this app: a route mounted
 * outside the chain must deny, never expose.
 */

function enabledRuntime(
  bridge: AuditBridge,
  baseUrl = 'http://vllm:8000/v1'
): Extract<AgentRuntime, { status: 'enabled' }> {
  const runtime = createAgentRuntime({
    env: { OPENRUNIC_AGENT_BASE_URL: baseUrl, OPENRUNIC_AGENT_MODEL: 'a-locally-served-model' },
    api: recordingApiClient(),
    audit: bridge.sink,
    approvalSecret: 'a-test-signing-secret-of-sufficient-length',
    modelClient: scriptedModel([{ text: 'ready' }]),
  });
  if (runtime.status !== 'enabled') throw new Error('expected an enabled runtime');
  return runtime;
}

interface BareApp {
  app: Hono<AppEnv>;
  sink: MemoryAuditSink;
}

/** The router with the same error boundary the real app has, and nothing else. */
type ContextInitialiser = (c: Context<AppEnv>) => void;

function bareApp(withContext?: ContextInitialiser): BareApp {
  const sink = createMemoryAuditSink();
  const bridge = createAuditBridge();
  const app = new Hono<AppEnv>();

  if (withContext !== undefined) {
    app.use(async (c, next) => {
      withContext(c);
      await next();
    });
  }

  app.route('/bff/v0', agentRoutes({ runtime: enabledRuntime(bridge), audit: bridge }));
  app.onError((error, c) => {
    if (!isApiError(error)) throw error;
    return problemResponse(c, error);
  });

  return { app, sink };
}

/**
 * A session of the kind a correctly wired app would serve.
 *
 * The token carries the same broad staff grant the demo clinician holds, so
 * when the routes below still refuse it, that is unambiguously the missing
 * chain and not a grant which was never there. Typed as `Principal` rather
 * than inferred, so a field added to the interface fails here once instead of
 * at each `c.set`.
 */
const PRINCIPAL: Principal = {
  subject: testId(900),
  tenantId: DEMO_TENANT_A,
  actorType: 'user',
  roles: [],
  facilityIds: [],
  scopes: ['user/*.read', 'user/*.write'],
  purposeOfUse: 'TREAT',
};

describe('mounted outside the middleware chain', () => {
  it('denies rather than exposing when no principal was resolved', async () => {
    const { app } = bareApp();
    expect((await app.request('/bff/v0/agent/tools')).status).toBe(401);
  });

  it('denies a turn the same way', async () => {
    const { app } = bareApp();
    const response = await app.request('/bff/v0/agent/turns', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'hello' }),
    });
    expect(response.status).toBe(401);
  });

  it('denies a confirmation and a discard the same way', async () => {
    const { app } = bareApp();
    for (const suffix of ['approve', 'reject']) {
      const response = await app.request(`/bff/v0/agent/proposals/${testId(1)}/${suffix}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ signature: 'a'.repeat(64), input: {} }),
      });
      expect(response.status, suffix).toBe(401);
    }
  });

  it('fails loudly when a principal exists but the audit collector does not', async () => {
    // A principal without a collector is a wiring bug, not a client error: an
    // agent action that cannot be audited must not run at all.
    const { app } = bareApp((c) => c.set('principal', PRINCIPAL));

    await expect(
      app.request('/bff/v0/agent/turns', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'hello' }),
      })
    ).rejects.toThrow(/mounted outside the middleware chain/);
  });

  it('fails the same way on a confirmation and on a discard', async () => {
    const { app } = bareApp((c) => c.set('principal', PRINCIPAL));

    for (const suffix of ['approve', 'reject']) {
      await expect(
        app.request(`/bff/v0/agent/proposals/${testId(1)}/${suffix}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ signature: 'a'.repeat(64), input: {} }),
        })
      ).rejects.toThrow(/mounted outside the middleware chain/);
    }
  });
});

describe('a turn from a caller who sent no credential', () => {
  it('still runs, and still records itself', async () => {
    const sink = createMemoryAuditSink();
    const bridge = createAuditBridge();
    const app = new Hono<AppEnv>();

    app.use(async (c, next) => {
      c.set('principal', PRINCIPAL);
      c.set(
        'audit',
        new AuditCollector(sink, {
          tenantId: DEMO_TENANT_A,
          actorType: 'user',
          actorId: testId(900),
          requestId: 'test-request',
          method: 'POST',
          path: '/bff/v0/agent/turns',
        })
      );
      await next();
    });
    app.route('/bff/v0', agentRoutes({ runtime: enabledRuntime(bridge), audit: bridge }));

    const response = await app.request('/bff/v0/agent/turns', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'hello' }),
    });

    expect(response.status).toBe(200);
    await response.text();
    // A missing credential would fail at the first tool call, not at the audit
    // record: the turn is still an event that happened.
    expect(sink.events.some((entry) => entry.event.action === 'agent.turn')).toBe(true);
  });
});

describe('the audit bridge', () => {
  it('writes an event with no target id, because not every event has one', async () => {
    const sink = createMemoryAuditSink();
    const bridge = createAuditBridge();
    const collector = new AuditCollector(sink, {
      tenantId: DEMO_TENANT_A,
      actorType: 'user',
      actorId: testId(900),
      requestId: 'test-request',
      method: 'POST',
      path: '/bff/v0/agent/turns',
    });

    await bridge.run(collector, () =>
      bridge.sink.record({
        action: 'agent.turn',
        targetType: 'AgentRun',
        outcome: 'success',
        metadata: { decision: 'abstained' },
      })
    );

    expect(sink.events[0]?.event.targetId).toBeUndefined();
    expect(sink.events[0]?.event.action).toBe('agent.turn');
  });

  it('reports an orphan event through the default handler rather than writing it', async () => {
    const bridge = createAuditBridge();
    await expect(
      bridge.sink.record({
        action: 'agent.turn',
        targetType: 'AgentRun',
        outcome: 'success',
        metadata: {},
      })
    ).resolves.toBeUndefined();
  });
});

describe('loading from the ambient environment', () => {
  it('is disabled, because the test environment configures no endpoint', () => {
    expect(loadAgentRuntime().status).toBe('disabled');
  });
});
