import { probeAssistant, streamAgentTurn } from '@/lib/agent';
import type { AgentAvailability, AgentEvent, AgentTurnRequest } from '@/lib/agent';
import { API_CONFIG, IS_MOCK_MODE } from '@/lib/api';

/**
 * How the surface reaches the API by default.
 *
 * The mock branch is not a feature flag for the assistant. `NEXT_PUBLIC_API_MODE`
 * already decides whether this app talks to `apps/api` at all, and against
 * fixtures there is no API to ask, so there is nothing to detect and the answer
 * is `absent` without a request. Firing one at a server that is not running
 * would put a failed fetch in the console of every demo to learn what the mode
 * already said.
 *
 * With `NEXT_PUBLIC_API_MODE=live` the answer comes from the API and from
 * nothing else: no build flag turns this surface on, because ADR-0005 requires
 * a clinic that configured nothing to get the product it had before.
 */

export type ProbeAssistant = (signal: AbortSignal) => Promise<AgentAvailability>;
export type RunAgentTurn = (request: AgentTurnRequest) => AsyncIterable<AgentEvent>;

const ABSENT: AgentAvailability = { status: 'absent' };

export const defaultProbe: ProbeAssistant = (signal) =>
  IS_MOCK_MODE ? Promise.resolve(ABSENT) : probeAssistant(API_CONFIG, signal);

export const defaultRunTurn: RunAgentTurn = (request) => streamAgentTurn(API_CONFIG, request);
