import { AsyncLocalStorage } from 'node:async_hooks';

import {
  createAgentRuntime,
  type AgentAuditEvent,
  type AgentAuditSink,
  type AgentRuntime,
} from '@openrunic/agent';
import { createHttpApiClient, type AgentPrincipal } from '@openrunic/agent-tools';

import type { AuditCollector } from '../audit/collector.js';
import type { Principal } from '../auth/principal.js';
import { PERMISSIONS, type Permission } from '../policy/permissions.js';
import { buildPolicyContext } from '../policy/policy.js';

/**
 * The agent subsystem, as this process sees it.
 *
 * Two properties before anything else.
 *
 * **It is off by default.** With no endpoint configured `loadAgentRuntime`
 * reports `disabled`, `app.ts` mounts no agent routes, and every agent path
 * answers 404 through the ordinary not-found handler. Not 403: a 403 tells an
 * attacker the feature exists, and the honest thing to say about a feature
 * nobody installed is that it is not there. Nothing else in the API changes,
 * which is what makes the agent-disabled CI target a real target rather than a
 * gesture.
 *
 * **Tools reach data over HTTP, holding the caller's own credential.** Even
 * with the loop running inside this process, its tools call this API across a
 * socket rather than reaching into the repositories. The loopback hop is
 * deliberate: the middleware chain - authentication, tenant scope, policy, the
 * hash-chained audit - runs for an agent-initiated read exactly as it runs for
 * a browser one, so there is one authorisation implementation rather than two.
 * It is also what lets the loop move into its own container later without a
 * single tool changing.
 */

/** Where tools address this API. Loopback by default; a sidecar sets it explicitly. */
export const AGENT_API_BASE_URL_ENV = 'OPENRUNIC_AGENT_API_BASE_URL';

/** Signs approval tokens. Absent means the agent stays off, whatever else is set. */
export const AGENT_APPROVAL_SECRET_ENV = 'OPENRUNIC_AGENT_APPROVAL_SECRET';

/**
 * Carries the request-scoped audit collector into the loop.
 *
 * The loop is built once; the collector is built per request and carries the
 * verified actor. Rather than handing the loop a collector it would then have
 * to keep swapping, the sink reads the one in scope. An event emitted with no
 * request in scope is **not** written under a fabricated actor: it is reported,
 * because a mis-attributed audit row is worse than a missing one.
 */
export interface AuditBridge {
  sink: AgentAuditSink;
  run<T>(collector: AuditCollector, work: () => T): T;
}

export function createAuditBridge(
  onOrphan: (event: AgentAuditEvent) => void = defaultOrphanHandler
): AuditBridge {
  const storage = new AsyncLocalStorage<AuditCollector>();

  return {
    sink: {
      async record(event: AgentAuditEvent): Promise<void> {
        const collector = storage.getStore();
        if (collector === undefined) {
          onOrphan(event);
          return;
        }
        await collector.write({
          action: event.action,
          targetType: event.targetType,
          ...(event.targetId === undefined ? {} : { targetId: event.targetId }),
          outcome: event.outcome,
          metadata: { ...event.metadata },
        });
      },
    },
    run: (collector, work) => storage.run(collector, work),
  };
}

function defaultOrphanHandler(event: AgentAuditEvent): void {
  console.error('agent audit event with no request in scope', { action: event.action });
}

export interface LoadAgentRuntimeOptions {
  env?: Readonly<Record<string, string | undefined>>;
  /** Origin of this API, as the tools should address it. */
  apiBaseUrl?: string;
  audit?: AgentAuditSink;
  /** Reported, not thrown: a broken assistant must not stop a clinic working. */
  onMisconfigured?: (reason: string) => void;
}

export function loadAgentRuntime(options: LoadAgentRuntimeOptions = {}): AgentRuntime {
  const env = options.env ?? process.env;
  const approvalSecret = env[AGENT_APPROVAL_SECRET_ENV]?.trim() ?? '';
  const baseUrl =
    options.apiBaseUrl ??
    env[AGENT_API_BASE_URL_ENV]?.trim() ??
    `http://127.0.0.1:${env['PORT'] ?? '4000'}`;

  const runtime = createAgentRuntime({
    env,
    api: createHttpApiClient({ baseUrl, fetch: globalThis.fetch }),
    audit: options.audit ?? createAuditBridge().sink,
    // The placeholder is only ever reached by a configuration that is about to
    // be rejected on the next line; a disabled subsystem returns before the
    // registry is built at all.
    approvalSecret: approvalSecret === '' ? PLACEHOLDER_SECRET : approvalSecret,
  });

  if (runtime.status === 'enabled' && approvalSecret === '') {
    const reason = `${AGENT_APPROVAL_SECRET_ENV} is required to sign confirmations. Without it a confirmation could not be bound to what it confirms.`;
    options.onMisconfigured?.(reason);
    return { status: 'misconfigured', reason };
  }

  if (runtime.status === 'misconfigured') options.onMisconfigured?.(runtime.reason);
  return runtime;
}

const PLACEHOLDER_SECRET = 'agent-subsystem-disabled-placeholder-secret';

/**
 * Mints the per-turn principal from the verified session, and from nothing
 * else.
 *
 * The scopes are the permissions the delegating human independently holds,
 * resolved by the API's own policy layer, so a capability is invisible unless
 * the caller could have performed it through the ordinary interface.
 *
 * **The chart comes from the token wherever the token names one.** A
 * patient-scoped session carries `compartmentPatientId`, which is the only
 * chart it may ever reach: the tenant-scope middleware hands its repositories
 * that identifier and nothing else. So the request body does not get a say. On
 * a patient surface there is no "change chart" to express, and honouring a body
 * field there would be a second, weaker source for a binding the verified token
 * already makes - the signed chart context ADR-0006 asks for, which for that
 * surface is the token itself.
 *
 * `chartPatientId` is therefore read only for a session the token left
 * chart-wide, which is every staff session: it is the chart the clinician has
 * open, and it can only ever **narrow**. A compartment-bound tool refuses rows
 * outside it, and every read and every commit is authorised again by this API
 * against the caller's own session, so naming a chart the caller cannot reach
 * gains nothing. A signed chart context for the staff surface is still the
 * intended hardening, and it would remove the need to reason about that at all.
 */
export function toAgentPrincipal(principal: Principal, chartPatientId?: string): AgentPrincipal {
  const policy = buildPolicyContext(principal);
  const boundChart = principal.compartmentPatientId ?? chartPatientId;

  return {
    tenantId: principal.tenantId,
    userId: principal.subject,
    roleIds: [...principal.roles],
    facilityIds: [...principal.facilityIds],
    surface: principal.actorType === 'patient' ? 'patient' : 'staff',
    purposeOfUse: principal.purposeOfUse,
    compartment: boundChart === undefined ? {} : { patientId: boundChart },
    scopes: PERMISSIONS.filter((permission: Permission) => policy.can(permission)),
  };
}
