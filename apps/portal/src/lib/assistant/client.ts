import { API_ENV, resolveApiMode } from '@/lib/api';

import { readStream } from './sse';
import type { AssistantCapabilities, AssistantEvent } from './types';
import { ASSISTANT_UNREACHABLE, parseAssistantCapabilities, parseAssistantEvent } from './types';

/**
 * The transport for the assistant routes, and the only place this app decides
 * whether a patient has an assistant at all.
 *
 * ADR-0005 makes the whole subsystem default-off, and `apps/api` mounts no
 * agent router without a configured endpoint, so every path here answers 404
 * through the ordinary not-found handler. That 404 is not an error to report:
 * it is the shipped state of the open-source product, and the surface's only
 * job on seeing it is to not exist.
 *
 * So {@link probeAssistant} never throws and never distinguishes one failure
 * from another. Absent, signed out, and broken all resolve to the same
 * `absent`, because they mean the same thing to the person holding the phone:
 * there is no assistant here.
 */

/** The only two states the surface branches on. There is no third. */
export type AssistantAvailability =
  { status: 'enabled'; capabilities: AssistantCapabilities } | { status: 'absent' };

export interface AssistantTransport {
  /** API origin without a trailing slash, e.g. 'https://api.example.invalid'. */
  baseUrl: string;
  /** Returns the current `Authorization` header value, or undefined while signed out. */
  authorization?: () => string | undefined;
  /** Injected in tests; defaults to the platform fetch. */
  fetchImpl?: typeof fetch;
}

export interface TurnRequest {
  /** The reader's own words. The only free text that reaches the service. */
  message: string;
  /** Position in this conversation. The server caps how far it may run. */
  turnIndex: number;
  /**
   * The reader's own chart. It can only ever narrow: the API scopes every
   * response to the chart on the bearer token whatever this says, and a tool
   * result that disagrees with it aborts the turn. Sending the wrong one
   * therefore buys nothing and fails shut.
   */
  chartPatientId: string;
  signal?: AbortSignal;
}

const ABSENT: AssistantAvailability = { status: 'absent' };

const CAPABILITIES_PATH = '/bff/v0/agent/tools';
const TURNS_PATH = '/bff/v0/agent/turns';

function headers(transport: AssistantTransport, accept: string): Record<string, string> {
  const authorization = transport.authorization?.();
  return { accept, ...(authorization === undefined ? {} : { authorization }) };
}

/**
 * Asks the API whether this reader has an assistant.
 *
 * A 200 carrying a named service is the single condition that turns the surface
 * on. Anything else - 404, 401, a 500, a dead socket, a body in a shape this
 * build cannot read - is `absent`.
 */
export async function probeAssistant(
  transport: AssistantTransport,
  signal?: AbortSignal
): Promise<AssistantAvailability> {
  const doFetch = transport.fetchImpl ?? fetch;

  try {
    const response = await doFetch(`${transport.baseUrl}${CAPABILITIES_PATH}`, {
      headers: headers(transport, 'application/json'),
      ...(signal === undefined ? {} : { signal }),
    });
    if (!response.ok) return ABSENT;

    const capabilities = parseAssistantCapabilities(await response.json());
    return capabilities === null ? ABSENT : { status: 'enabled', capabilities };
  } catch {
    return ABSENT;
  }
}

/**
 * Runs one turn and yields its events as they arrive.
 *
 * `mode` is fixed at `read`, and not as a default a caller could change: this
 * surface answers questions about what is already written down, so the half of
 * the loop that drafts changes never runs. That is ADR-0005's "never
 * auto-commit" rule made structural rather than asserted, and it matters more
 * here than on the staff surface, because there is nobody beside the reader to
 * notice a draft that should not exist.
 *
 * A transport failure is yielded as an ordinary `failed` followed by
 * `finished`, which is the shape every branch of the server's own loop also
 * ends with, so the caller has one settle path rather than two.
 */
export async function* streamTurn(
  transport: AssistantTransport,
  request: TurnRequest
): AsyncGenerator<AssistantEvent> {
  const doFetch = transport.fetchImpl ?? fetch;

  let body: ReadableStream<Uint8Array> | null;
  try {
    const response = await doFetch(`${transport.baseUrl}${TURNS_PATH}`, {
      method: 'POST',
      headers: {
        ...headers(transport, 'text/event-stream'),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        message: request.message,
        turnIndex: request.turnIndex,
        mode: 'read',
        /* Sent as the truth about this render: the screen draws what the
           assistant can and cannot do, and names the service, above the box
           before a question can be asked. So the disclosure the server records
           was genuinely on screen. */
        disclosureShown: true,
        chartPatientId: request.chartPatientId,
      }),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
    body = response.ok ? response.body : null;
  } catch {
    body = null;
  }

  if (body === null) {
    yield* unreachableEvents();
    return;
  }

  try {
    for await (const payload of readStream(body)) {
      const event = parseAssistantEvent(safeParse(payload));
      if (event !== null) yield event;
    }
  } catch {
    /* A socket that dies mid-answer, or the abort that stopping raises.
       Stopping is a thing the reader chose and is not reported as a failure;
       anything else ends the turn the same way a refusal does. */
    if (request.signal?.aborted !== true) yield* unreachableEvents();
  }
}

/**
 * The pair a dead transport produces: a failure, then the `finished` every
 * branch of the server's own loop also ends with. Exported so a caller that
 * loses the stream outside this module settles a turn identically.
 */
export function unreachableEvents(): AssistantEvent[] {
  return [
    { type: 'failed', code: ASSISTANT_UNREACHABLE },
    { type: 'finished', outcome: 'failed' },
  ];
}

export type ProbeAssistant = (signal: AbortSignal) => Promise<AssistantAvailability>;
export type RunTurn = (request: TurnRequest) => AsyncIterable<AssistantEvent>;

/**
 * How the surface reaches the API by default.
 *
 * The mock branch is not a switch for the assistant. `NEXT_PUBLIC_API_MODE`
 * already decides whether this app talks to `apps/api` at all, and against
 * fixtures there is no API to ask, so the answer is `absent` without a request
 * rather than a failed fetch in the console of every demo. With
 * `NEXT_PUBLIC_API_MODE=live` the answer comes from the API and from nothing
 * else: no build flag turns this on.
 */
const DEFAULT_TRANSPORT: AssistantTransport = { baseUrl: API_ENV.baseUrl ?? '' };

const IS_MOCK_MODE = resolveApiMode(API_ENV.mode) !== 'live';

export const defaultProbe: ProbeAssistant = (signal) =>
  IS_MOCK_MODE ? Promise.resolve(ABSENT) : probeAssistant(DEFAULT_TRANSPORT, signal);

export const defaultRunTurn: RunTurn = (request) => streamTurn(DEFAULT_TRANSPORT, request);

function safeParse(payload: string): unknown {
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}
