import { createToolRegistry, type AgentTool, type ToolRegistry } from './registry.js';
import { appointmentsFindSlots } from './tools/appointments-find-slots.js';
import { appointmentsPropose } from './tools/appointments-propose.js';
import { auditQuery } from './tools/audit-query.js';
import { billsList } from './tools/bills-list.js';
import { chartSearch } from './tools/chart-search.js';
import { codingSuggest } from './tools/coding-suggest.js';
import { denialDraftAppeal } from './tools/denial-draft-appeal.js';
import { denialTriage } from './tools/denial-triage.js';
import { documentsExtractCandidates } from './tools/documents-extract-candidates.js';
import { formsDraftDefinition } from './tools/forms-draft-definition.js';
import { inboxClassify } from './tools/inbox-classify.js';
import { messagesDraftReply } from './tools/messages-draft-reply.js';
import { priorauthAssemblePacket } from './tools/priorauth-assemble-packet.js';
import { recordList } from './tools/record-list.js';
import { visitsList } from './tools/visits-list.js';

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

/**
 * The patient catalogue, decided in
 * [ADR-0006](../../../docs/adr/0006-patient-agent-surface.md).
 *
 * Kept as its own list rather than appended to {@link V1_TOOLS} because the two
 * are separate decisions with separate regulatory arguments behind them, and a
 * single flat array would make it possible to grant a staff capability to a
 * patient by moving one line. Nothing here appears on the staff surface and
 * nothing above appears on this one; `patient-surface.test.ts` asserts both.
 *
 * The order is the order they answer questions people actually open a portal
 * to ask: what does my record say, when am I next in, what do I owe.
 */
export const PATIENT_TOOLS: readonly AgentTool[] = [recordList, visitsList, billsList];

/** Every registered tool. Registration is still not authorisation. */
export const ALL_TOOLS: readonly AgentTool[] = [...V1_TOOLS, ...PATIENT_TOOLS];

/** The registry the runtime consumes. One registry, no second source of tools. */
export function createV1Registry(tools: readonly AgentTool[] = ALL_TOOLS): ToolRegistry {
  return createToolRegistry(tools);
}
