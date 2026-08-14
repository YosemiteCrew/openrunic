/**
 * The assistant wire contract, as the portal reads it.
 *
 * These mirror the union `packages/agent` emits and the body `apps/api` serves
 * on `GET /bff/v0/agent/tools`. They are declared here rather than imported:
 * `@openrunic/agent` is a server package, it reaches for `node:crypto` and
 * carries the provider clients, and nothing in a patient's browser should
 * depend on it, not even for a type.
 *
 * Drift is therefore caught at runtime rather than by the compiler.
 * {@link parseAssistantEvent} validates every frame and returns null for
 * anything it does not recognise, so a server that grows an event this build
 * has never seen is ignored rather than fatal.
 */

/** Which service answers, and whether asking it sends anything out of the practice. */
export interface AssistantService {
  modelId: string;
  endpointHost: string;
  /** True when the configured endpoint is not inside this deployment (ADR-0005 rule 6). */
  dataLeavesDeployment: boolean;
}

/** One thing this reader's assistant can look at. Deny by default: absent means never granted. */
export interface AssistantCapability {
  id: string;
  summary: string;
}

/** The capabilities response. Its presence is the only signal that the assistant is on. */
export interface AssistantCapabilities {
  service: AssistantService;
  capabilities: readonly AssistantCapability[];
}

/** One record the turn read. It is what a citation points at. */
export interface AssistantSource {
  resourceType: string;
  resourceId: string;
  label: string;
  /** True for text the reader or someone outside the practice wrote. Marked as such. */
  untrusted: boolean;
}

export type AssistantEvent =
  | { type: 'step'; label: string; done: boolean }
  | { type: 'text'; text: string }
  | { type: 'sources'; entries: readonly AssistantSource[] }
  | { type: 'deferred'; reason: string }
  | { type: 'failed'; code: string }
  | { type: 'finished'; outcome: 'completed' | 'stopped' | 'failed' };

/**
 * Codes this app raises itself. Every other code in a `failed` event comes from
 * the server's own list.
 */

/** The browser never reached openrunic at all, which is a different fact from a dead endpoint. */
export const ASSISTANT_UNREACHABLE = 'ASSISTANT_UNREACHABLE';

/**
 * A turn produced a draft change.
 *
 * The portal asks for `read` on every turn, so the half of the loop that drafts
 * changes never runs and this cannot happen. If it ever does, something has
 * gone wrong that this surface has no way to reason about, so it is treated as
 * a failure rather than rendered: a patient must never be shown a proposed
 * change to their own chart that nobody at the practice has seen.
 */
export const ASSISTANT_UNEXPECTED_DRAFT = 'ASSISTANT_UNEXPECTED_DRAFT';

type Row = Record<string, unknown>;

function isRow(value: unknown): value is Row {
  return typeof value === 'object' && value !== null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function parseSource(value: unknown): AssistantSource | null {
  if (!isRow(value)) return null;
  const resourceType = str(value.resourceType);
  const resourceId = str(value.resourceId);
  const label = str(value.label);
  if (resourceType === null || resourceId === null || label === null) return null;
  return { resourceType, resourceId, label, untrusted: value.untrusted === true };
}

/**
 * One parser per event, keyed by its own type.
 *
 * A table rather than a switch, so an event type this build does not know is a
 * missing key - the same "ignore it" answer as a malformed known one - rather
 * than a default branch someone has to remember to write.
 */
const PARSERS: Record<string, (row: Row) => AssistantEvent | null> = {
  step: (row) => {
    const label = str(row.label);
    return label === null ? null : { type: 'step', label, done: row.state === 'done' };
  },
  'text-delta': (row) => {
    const text = str(row.text);
    return text === null ? null : { type: 'text', text };
  },
  sources: (row) => {
    if (!Array.isArray(row.entries)) return null;
    const entries = row.entries
      .map(parseSource)
      .filter((entry): entry is AssistantSource => entry !== null);
    return { type: 'sources', entries };
  },
  proposal: () => ({ type: 'failed', code: ASSISTANT_UNEXPECTED_DRAFT }),
  deferred: (row) => {
    const reason = str(row.reason);
    return reason === null ? null : { type: 'deferred', reason };
  },
  failed: (row) => {
    const code = str(row.code);
    return code === null ? null : { type: 'failed', code };
  },
  'turn-finished': (row) => ({
    type: 'finished',
    outcome: row.outcome === 'completed' ? 'completed' : 'failed',
  }),
  /* The turn already exists on screen: the question was put there the moment it
     was asked rather than when the server acknowledged it. */
  'turn-started': () => null,
};

/** Narrows one decoded frame. Returns null for anything this build cannot use. */
export function parseAssistantEvent(value: unknown): AssistantEvent | null {
  if (!isRow(value)) return null;
  const type = str(value.type);
  if (type === null) return null;
  return PARSERS[type]?.(value) ?? null;
}

function parseCapability(value: unknown): AssistantCapability | null {
  if (!isRow(value)) return null;
  const id = str(value.id);
  const summary = str(value.summary);
  return id === null || summary === null ? null : { id, summary };
}

/**
 * Narrows the capabilities body.
 *
 * A body that does not name the service is not a usable assistant, so it reads
 * as absent rather than as a half-configured one, and the portal renders no
 * assistant at all.
 *
 * `dataLeavesDeployment` is required rather than coerced, and that is the
 * sharpest line in this file. Reading a missing flag with `=== true` would
 * answer "nothing you type leaves your practice" on no evidence whatsoever, so
 * an older or malformed response would produce the reassuring sentence at
 * exactly the moment the server declined to say. An absent answer is not a
 * comforting answer; it is no answer, and no answer means no assistant.
 */
export function parseAssistantCapabilities(value: unknown): AssistantCapabilities | null {
  if (!isRow(value) || !isRow(value.model)) return null;
  const modelId = str(value.model.modelId);
  const endpointHost = str(value.model.endpointHost);
  if (modelId === null || endpointHost === null) return null;
  if (typeof value.model.dataLeavesDeployment !== 'boolean') return null;

  return {
    service: { modelId, endpointHost, dataLeavesDeployment: value.model.dataLeavesDeployment },
    capabilities: Array.isArray(value.tools)
      ? value.tools
          .map(parseCapability)
          .filter((entry): entry is AssistantCapability => entry !== null)
      : [],
  };
}
