import type { AgentRuntime } from '@openrunic/agent';
import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';

import type { AuditCollector } from '../audit/collector.js';
import type { Principal } from '../auth/principal.js';
import type { AppEnv } from '../context.js';
import { ApiError } from '../errors.js';
import { problemDocumentSchema } from '../http/problem.js';
import { parseJsonBody, parseParam } from '../http/validate.js';
import type { RouteContract } from '../openapi/registry.js';
import { idParamSchema } from '../routes/helpers.js';

import { toAgentPrincipal, type AuditBridge } from './runtime.js';

/**
 * Three capabilities, and one thing they share: they only exist when a model is
 * configured.
 *
 * `app.ts` mounts this router only for an enabled subsystem, so under the
 * default configuration every path below answers 404 through the ordinary
 * not-found handler. That is the shipped open-source state and it is a normal
 * one; a 403 would tell an attacker the feature exists, and a 500 would tell a
 * clinician something is broken when nothing is.
 *
 * What is deliberately absent: any route that sends anything to anyone. The
 * agent holds no outbound-communication capability, so there is no endpoint
 * here that could become one.
 */

const AGENT_BASE = '/agent';

const turnBodySchema = z.strictObject({
  message: z.string().min(1).max(8000),
  turnIndex: z.coerce.number().int().min(0).max(1000).default(0),
  /** `read` answers; `propose` may additionally produce a proposal for a person. */
  mode: z.enum(['read', 'propose']).default('read'),
  /** The chart the caller has open. Narrows what a tool may return; never widens it. */
  chartPatientId: z.uuid().optional(),
  /** Whether the surface displayed the standing disclosure. Recorded as evidence. */
  disclosureShown: z.boolean().default(true),
});

const approvalBodySchema = z.strictObject({
  signature: z.string().min(16).max(256),
  /**
   * The input the caller believes it is confirming. Compared against the hash
   * the confirmation is bound to, so an approved call cannot be replayed with
   * different arguments.
   */
  input: z.unknown(),
});

const modelIdentitySchema = z.strictObject({
  modelId: z.string(),
  endpointHost: z.string(),
  remote: z.boolean(),
  dataLeavesDeployment: z.boolean(),
});

const toolSummarySchema = z.strictObject({
  id: z.string(),
  tier: z.string(),
  summary: z.string(),
  requiredScopes: z.array(z.string()),
  approval: z.string(),
});

const ERROR_RESPONSES = [
  { status: 401, description: 'No usable bearer token.', schema: problemDocumentSchema },
] as const;

export const agentRouteContracts: RouteContract[] = [
  {
    method: 'get',
    path: '/bff/v0/agent/tools',
    operationId: 'listAgentTools',
    summary: 'List the assistant capabilities this caller can reach.',
    description:
      'Deny by default: a capability the caller was not granted is absent from this list rather than listed as forbidden. The response also names the model and states whether data leaves the deployment.',
    tags: ['agent'],
    responses: [
      {
        status: 200,
        description: 'The capabilities available to this caller, and the model behind them.',
        schema: z.strictObject({
          model: modelIdentitySchema,
          tools: z.array(toolSummarySchema),
        }),
      },
      ...ERROR_RESPONSES,
    ],
  },
  {
    method: 'post',
    path: '/bff/v0/agent/turns',
    operationId: 'runAgentTurn',
    summary: 'Run one assistant turn, streamed as server-sent events.',
    description:
      'Prose streams as it arrives; structured output does not. Nothing in a turn changes the record: a write arrives as a proposal for a person to confirm.',
    tags: ['agent'],
    body: turnBodySchema,
    responses: [
      {
        status: 200,
        description: 'A stream of turn events.',
        mediaType: 'text/event-stream',
      },
      ...ERROR_RESPONSES,
      { status: 422, description: 'The body failed validation.', schema: problemDocumentSchema },
    ],
  },
  {
    method: 'post',
    path: '/bff/v0/agent/proposals/{id}/approve',
    operationId: 'approveAgentProposal',
    summary: 'Confirm a pending proposal and commit it.',
    description:
      'A fresh authenticated action by a person who independently holds the permission. The confirmation is single use and bound to the exact input it was issued for; it commits through the same endpoint the human interface uses.',
    tags: ['agent'],
    pathParams: [{ name: 'id', description: 'Proposal id (UUID).', schema: idParamSchema }],
    body: approvalBodySchema,
    responses: [
      { status: 200, description: 'The committed result.' },
      ...ERROR_RESPONSES,
      {
        status: 409,
        description: 'The confirmation is no longer valid.',
        schema: problemDocumentSchema,
      },
    ],
  },
  {
    method: 'post',
    path: '/bff/v0/agent/proposals/{id}/reject',
    operationId: 'rejectAgentProposal',
    summary: 'Discard a pending proposal.',
    description: 'Recorded in the audit chain as loudly as a confirmation.',
    tags: ['agent'],
    pathParams: [{ name: 'id', description: 'Proposal id (UUID).', schema: idParamSchema }],
    responses: [
      { status: 204, description: 'Discarded.' },
      ...ERROR_RESPONSES,
      { status: 404, description: 'No such pending proposal.', schema: problemDocumentSchema },
    ],
  },
];

export interface AgentRoutesOptions {
  runtime: Extract<AgentRuntime, { status: 'enabled' }>;
  /** Carries the request-scoped collector into the loop, so the human stays the actor. */
  audit: AuditBridge;
}

export function agentRoutes(options: AgentRoutesOptions): Hono<AppEnv> {
  const router = new Hono<AppEnv>();
  const { loop, profile } = options.runtime;

  router.get(`${AGENT_BASE}/tools`, (c) => {
    const principal = requirePrincipal(c);

    return c.json({
      // Model identity belongs in the surface rather than buried in an admin
      // screen: it is the information duty, and it is the restated
      // no-telemetry promise made visible.
      model: {
        modelId: profile.id,
        endpointHost: hostOf(profile.baseUrl),
        remote: profile.phiEgress !== 'none',
        dataLeavesDeployment: profile.phiEgress !== 'none',
      },
      tools: loop.visibleTools(toAgentPrincipal(principal)).map((tool) => ({
        id: tool.id,
        tier: tool.tier,
        summary: tool.summary,
        requiredScopes: [...tool.requiredScopes],
        approval: tool.approval,
      })),
    });
  });

  router.post(`${AGENT_BASE}/turns`, async (c) => {
    const principal = requirePrincipal(c);
    const body = await parseJsonBody(c, turnBodySchema);
    const collector = requireCollector(c);

    return streamSSE(c, async (stream) => {
      // The collector is bound around the **iteration**, not around building
      // the generator: an async generator runs no part of its body until it is
      // pulled, so binding at construction would leave every event emitted
      // during the turn with no request in scope, and an unattributable audit
      // row is worse than a missing one.
      await options.audit.run(collector, async () => {
        const events = loop.run({
          principal: toAgentPrincipal(principal, body.chartPatientId),
          credential: { authorization: c.req.header('authorization') ?? '' },
          message: body.message,
          turnIndex: body.turnIndex,
          mode: body.mode,
          disclosureShown: body.disclosureShown,
        });

        // Every branch of the loop ends in a `turn-finished` event, including
        // the refusals, so a client that reads to the end always learns the
        // outcome.
        for await (const event of events) {
          await stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
        }
      });
    });
  });

  router.post(`${AGENT_BASE}/proposals/:id/approve`, async (c) => {
    const principal = requirePrincipal(c);
    const proposalId = parseParam(c.req.param('id'), idParamSchema, 'id');
    const body = await parseJsonBody(c, approvalBodySchema);
    const collector = requireCollector(c);

    const result = await options.audit.run(collector, () =>
      loop.approve({
        token: { proposalId, signature: body.signature },
        input: body.input,
        approver: toAgentPrincipal(principal),
        credential: { authorization: c.req.header('authorization') ?? '' },
      })
    );

    if (!result.ok) throw ApiError.conflict(result.detail, { title: result.code });
    return c.json(result.committed ?? null);
  });

  router.post(`${AGENT_BASE}/proposals/:id/reject`, async (c) => {
    const principal = requirePrincipal(c);
    const proposalId = parseParam(c.req.param('id'), idParamSchema, 'id');
    const collector = requireCollector(c);

    const rejected = await options.audit.run(collector, () =>
      loop.reject(proposalId, toAgentPrincipal(principal))
    );
    if (!rejected) throw ApiError.notFound('No such pending proposal.');
    return c.body(null, 204);
  });

  return router;
}

function requirePrincipal(c: Context<AppEnv>): Principal {
  const principal = c.get('principal');
  if (principal === undefined) {
    throw ApiError.unauthenticated('A bearer token is required.');
  }
  return principal;
}

function requireCollector(c: Context<AppEnv>): AuditCollector {
  const collector = c.get('audit');
  if (collector === undefined) {
    throw new Error(
      'agent route reached without an audit collector: it is mounted outside the middleware chain'
    );
  }
  return collector;
}

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return 'unknown';
  }
}
