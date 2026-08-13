import { createToolRegistry, type AgentTool, type ToolRegistry } from './registry.js';
import { appointmentsFindSlots } from './tools/appointments-find-slots.js';
import { appointmentsPropose } from './tools/appointments-propose.js';
import { auditQuery } from './tools/audit-query.js';
import { chartSearch } from './tools/chart-search.js';
import { codingSuggest } from './tools/coding-suggest.js';
import { denialDraftAppeal } from './tools/denial-draft-appeal.js';
import { denialTriage } from './tools/denial-triage.js';
import { documentsExtractCandidates } from './tools/documents-extract-candidates.js';
import { formsDraftDefinition } from './tools/forms-draft-definition.js';
import { inboxClassify } from './tools/inbox-classify.js';
import { messagesDraftReply } from './tools/messages-draft-reply.js';
import { priorauthAssemblePacket } from './tools/priorauth-assemble-packet.js';

/**
 * The v1 catalogue, in ship order.
 *
 * The order is value times safety, and it is not arbitrary. Natural-language
 * chart search ships first because its failure mode is a visible null result -
 * the only task on this list with that property. Coding suggestion ships last
 * because its failure mode is a statistical signature across thousands of
 * encounters that no single review would catch.
 *
 * Registration is not authorisation. Everything below is unreachable until it
 * is granted in `allowlist.ts` to a surface and a role, and until the caller
 * independently holds every scope it names.
 */
export const V1_TOOLS: readonly AgentTool[] = [
  chartSearch,
  denialTriage,
  denialDraftAppeal,
  priorauthAssemblePacket,
  formsDraftDefinition,
  inboxClassify,
  auditQuery,
  appointmentsFindSlots,
  appointmentsPropose,
  documentsExtractCandidates,
  messagesDraftReply,
  codingSuggest,
];

/** The registry the runtime consumes. One registry, no second source of tools. */
export function createV1Registry(tools: readonly AgentTool[] = V1_TOOLS): ToolRegistry {
  return createToolRegistry(tools);
}
