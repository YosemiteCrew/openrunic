/**
 * The assistant transport. Components import from `@/lib/agent` and nothing
 * deeper, so the streaming shape can change without touching the surface.
 */
export { chartPatientIdFromPath } from './chart-context';
export { probeAssistant, streamAgentTurn, transportFailureEvents } from './client';
export type { AgentAvailability, AgentTurnRequest } from './client';
export { decodeSseFrames, readSseStream } from './sse';
export type { DecodedFrames } from './sse';
export { AGENT_TRANSPORT_FAILED, parseAgentCapabilities, parseAgentEvent } from './types';
export type {
  AgentCapabilities,
  AgentEvent,
  AgentModelIdentity,
  AgentProposal,
  AgentSource,
  AgentToolSummary,
  AgentUsage,
} from './types';
