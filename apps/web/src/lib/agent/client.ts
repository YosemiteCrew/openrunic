import { BFF_BASE_PATH } from '@/lib/api';
import type { ApiClientConfig } from '@/lib/api';

import { readSseStream } from './sse';
import type { AgentCapabilities, AgentEvent } from './types';
import { AGENT_TRANSPORT_FAILED, parseAgentCapabilities, parseAgentEvent } from './types';

/**
 * The transport for the assistant routes, and the only place this app decides
 * whether the assistant exists at all.
 *
 * ADR-0005 makes the agent default-off, and `apps/api` mounts no agent router
 * when no endpoint is configured, so every path here answers 404 through the
 * ordinary not-found handler. That 404 is not an error to report: it is the
 * shipped open-source state, and the surface's whole job on seeing it is to
 * render nothing.
 *
 * So {@link probeAssistant} never throws and never distinguishes one failure
 * from another. Absent, unauthenticated, and broken all resolve to the same
 * `absent`, because every one of them means the same thing to the person
 * looking at the screen: there is no assistant here, and nothing about the
 * screen should change to say so.
 */

/** The only two states the surface branches on. There is no third. */
export type AgentAvailability =
  { status: 'enabled'; capabilities: AgentCapabilities } | { status: 'absent' };

const ABSENT: AgentAvailability = { status: 'absent' };

const CAPABILITIES_PATH = '/agent/tools';
const TURNS_PATH = '/agent/turns';

function agentUrl(config: ApiClientConfig, path: string): string {
  return `${config.baseUrl}${config.basePath ?? BFF_BASE_PATH}${path}`;
}

function agentHeaders(config: ApiClientConfig, accept: string): Headers {
  const headers = new Headers({ accept });
  const token = config.getToken?.() ?? null;
  if (token) headers.set('authorization', `Bearer ${token}`);
  return headers;
}

/**
 * Asks the API whether an assistant is configured for this caller.
 *
 * A 200 carrying a model identity is the single condition that turns the
 * surface on. Anything else - 404, 401, a 500, a dead socket, a body in a
 * shape this build cannot read - is `absent`.
 */
export async function probeAssistant(
  config: ApiClientConfig,
  signal?: AbortSignal
): Promise<AgentAvailability> {
  const fetchImpl = config.fetchImpl ?? globalThis.fetch;

  try {
    const response = await fetchImpl(agentUrl(config, CAPABILITIES_PATH), {
      headers: agentHeaders(config, 'application/json'),
      ...(signal === undefined ? {} : { signal }),
    });
    if (!response.ok) return ABSENT;

    const capabilities = parseAgentCapabilities(await response.json());
    return capabilities === null ? ABSENT : { status: 'enabled', capabilities };
  } catch {
    return ABSENT;
  }
}

export interface AgentTurnRequest {
  /** The clinician's own words. The only free text that reaches the model. */
  message: string;
  /** Position in this conversation. The server caps how far it may run. */
  turnIndex: number;
  /**
   * The chart on screen. It can only narrow what a tool may return: a
   * compartment-bound tool refuses rows outside it, and the API authorises
   * every read again against the caller's own session.
   */
  chartPatientId?: string;
  signal?: AbortSignal;
}

/**
 * Runs one turn and yields its events as they arrive.
 *
 * `mode` is fixed at `read`. This surface answers questions; it does not ask
 * the server to draft a change, so the writer half of the loop never runs and
 * no proposal can be produced from here. That is the ADR-0005 "never
 * auto-commit" rule made structural rather than asserted: the surface holds no
 * commit control because it cannot produce anything to commit.
 *
 * A transport failure is yielded as an ordinary `failed` followed by
 * `turn-finished`, which is the same shape the loop guarantees on every branch
 * of its own. The caller therefore has one settle path rather than two.
 */
export async function* streamAgentTurn(
  config: ApiClientConfig,
  request: AgentTurnRequest
): AsyncGenerator<AgentEvent> {
  const fetchImpl = config.fetchImpl ?? globalThis.fetch;
  const headers = agentHeaders(config, 'text/event-stream');
  headers.set('content-type', 'application/json');

  let body: ReadableStream<Uint8Array> | null;
  try {
    const response = await fetchImpl(agentUrl(config, TURNS_PATH), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        message: request.message,
        turnIndex: request.turnIndex,
        mode: 'read',
        // Sent as the truth about this render: the panel draws the purpose and
        // the endpoint above the composer before a turn can be started, so the
        // disclosure the server records was genuinely on screen.
        disclosureShown: true,
        ...(request.chartPatientId === undefined ? {} : { chartPatientId: request.chartPatientId }),
      }),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
    body = response.ok ? response.body : null;
  } catch {
    body = null;
  }

  if (body === null) {
    yield* transportFailureEvents();
    return;
  }

  try {
    for await (const payload of readSseStream(body)) {
      const event = parseAgentEvent(safeParseJson(payload));
      if (event !== null) yield event;
    }
  } catch {
    // A socket that dies mid-answer, or the abort that stopping the turn
    // raises. Stopping is a thing the clinician chose and is not reported as a
    // failure; anything else ends the turn the same way a refusal does, so the
    // surface has one settle path rather than two.
    if (request.signal?.aborted !== true) yield* transportFailureEvents();
  }
}

/**
 * The pair a dead transport produces: a failure, then the `turn-finished` every
 * branch of the server's own loop also ends with. Exported so a caller that
 * loses the stream outside this module settles a turn identically.
 */
export function transportFailureEvents(): AgentEvent[] {
  return [
    {
      type: 'failed',
      code: AGENT_TRANSPORT_FAILED,
      detail: 'openrunic could not reach the assistant.',
    },
    {
      type: 'turn-finished',
      outcome: 'failed',
      usage: { inputTokens: 0, outputTokens: 0, costCents: 0 },
    },
  ];
}

function safeParseJson(payload: string): unknown {
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}
