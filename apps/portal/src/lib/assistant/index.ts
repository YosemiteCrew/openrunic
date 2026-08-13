/**
 * Reaching the optional assistant, and reading what it says back.
 *
 * Nothing in here decides whether a patient sees an assistant: the API does,
 * by mounting no agent router when a deployer has configured no endpoint. This
 * module's whole contribution to that question is to ask once and to treat
 * every answer other than a clear yes as a no.
 */

export {
  defaultProbe,
  defaultRunTurn,
  probeAssistant,
  streamTurn,
  unreachableEvents,
} from './client';
export type {
  AssistantAvailability,
  AssistantTransport,
  ProbeAssistant,
  RunTurn,
  TurnRequest,
} from './client';

export { decodeFrames, readStream } from './sse';
export type { DecodedFrames } from './sse';

export {
  ASSISTANT_UNEXPECTED_DRAFT,
  ASSISTANT_UNREACHABLE,
  parseAssistantCapabilities,
  parseAssistantEvent,
} from './types';
export type {
  AssistantCapabilities,
  AssistantCapability,
  AssistantEvent,
  AssistantService,
  AssistantSource,
} from './types';
