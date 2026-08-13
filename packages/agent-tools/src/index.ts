/**
 * `@openrunic/agent-tools`: the agent's tool registry.
 *
 * One rule governs this package, and ADR-0005 records it as the single most
 * important security decision in the design: **tools call the existing HTTP API
 * with the end user's own credentials.** No tool receives a database client, no
 * tool imports Prisma, and no tool has a privileged path. An ESLint rule and
 * `registry.no-database-import.test.ts` both enforce it, because a lint rule can
 * be skipped and a test in CI cannot.
 */

export { DEFAULT_TOOL_TIMEOUT_MS, createHttpApiClient } from './api-client.js';
export type {
  ApiCallContext,
  ApiClient,
  ApiRequest,
  FetchLike,
  HttpApiClientOptions,
  HttpRequestInit,
  HttpResponse,
  QueryValue,
} from './api-client.js';

export { TOOL_ALLOWLIST } from './allowlist.js';
export type { SurfaceAllowlist, ToolAllowlist } from './allowlist.js';

export { V1_TOOLS, createV1Registry } from './catalogue.js';

export { assertWithinCompartment, countRows } from './compartment.js';
export type { CompartmentCheck } from './compartment.js';

export { TOOL_FAILURE_CODES, ToolError, isToolError } from './errors.js';
export type { ToolErrorOptions, ToolFailureCode } from './errors.js';

export { jsonObjectSchema, jsonValueSchema } from './json.js';
export type { JsonObject, JsonValue } from './json.js';

export { isPatientSurface } from './principal.js';
export type { AgentCredential, AgentPrincipal } from './principal.js';

export {
  commitDescriptorSchema,
  effectFieldSchema,
  pending,
  proposalResultSchema,
  resourceRefSchema,
  toolProposalSchema,
} from './proposal.js';
export type {
  CommitDescriptor,
  EffectField,
  ProposalResult,
  ResourceRef,
  ToolProposal,
} from './proposal.js';

export { collectSchemaKeys, createToolRegistry, defineTool } from './registry.js';
export type { AgentTool, ToolContext, ToolDefinition, ToolRegistry } from './registry.js';

export { grantedIds, resolveTool, resolveTools } from './resolve.js';
export type { ResolveOptions } from './resolve.js';

export {
  AGENT_SURFACES,
  APPROVAL_POLICIES,
  SIDE_EFFECTS,
  TOOL_TIERS,
  TRUST_CLASSES,
  sideEffectForTier,
} from './tiers.js';
export type { AgentSurface, ApprovalPolicy, SideEffect, ToolTier, TrustClass } from './tiers.js';

export {
  apiListSchema,
  authoredText,
  codedValueSchema,
  dateOnlySchema,
  deferred,
  deferredResultSchema,
  instantSchema,
  recordCardSchema,
  recordFieldSchema,
  retrievalResultSchema,
  sourceRefSchema,
} from './tools/shared.js';
export type {
  CodedValue,
  DeferredResult,
  RecordCard,
  RetrievalResult,
  SourceRef,
} from './tools/shared.js';

/* Individual tools, so a deployer can build a narrower registry than the v1 one. */
export { appointmentsFindSlots, freeSlots } from './tools/appointments-find-slots.js';
export {
  DEFAULT_APPOINTMENT_ENVELOPE,
  appointmentsPropose,
  createAppointmentsPropose,
} from './tools/appointments-propose.js';
export type { AppointmentEnvelope } from './tools/appointments-propose.js';
export { AUDIT_QUERY_SCOPE, auditQuery } from './tools/audit-query.js';
export { chartSearch } from './tools/chart-search.js';
export { codingSuggest } from './tools/coding-suggest.js';
export { denialDraftAppeal } from './tools/denial-draft-appeal.js';
export { categorise, denialTriage } from './tools/denial-triage.js';
export { documentsExtractCandidates } from './tools/documents-extract-candidates.js';
export { formsDraftDefinition } from './tools/forms-draft-definition.js';
export { INBOX_CATEGORIES, inboxClassify } from './tools/inbox-classify.js';
export { messagesDraftReply } from './tools/messages-draft-reply.js';
export { PRIOR_AUTH_FIELDS, priorauthAssemblePacket } from './tools/priorauth-assemble-packet.js';
