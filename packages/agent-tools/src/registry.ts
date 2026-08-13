import { z } from 'zod';

import type { ApiClient } from './api-client.js';
import { assertWithinCompartment } from './compartment.js';
import { ToolError } from './errors.js';
import type { AgentCredential, AgentPrincipal } from './principal.js';
import {
  sideEffectForTier,
  type AgentSurface,
  type ApprovalPolicy,
  type SideEffect,
  type ToolTier,
  type TrustClass,
} from './tiers.js';

/**
 * One registry, and everything about a capability declared in one place.
 *
 * A tool that is not in this file's shape does not exist: there is no way to
 * hand the loop a callable that skipped the tier, the scopes, the surfaces, the
 * schemas or the approval policy, because the loop only ever sees
 * {@link AgentTool}, and the only way to make one is {@link defineTool}.
 */

export interface ToolContext {
  principal: AgentPrincipal;
  credential: AgentCredential;
  api: ApiClient;
  signal?: AbortSignal;
}

export interface ToolDefinition<Input, Output> {
  /** `aggregate.verb`, lower camel on both sides. Stable: it appears in the audit chain. */
  id: string;
  tier: ToolTier;
  trustClass: TrustClass;
  approval: ApprovalPolicy;
  /** Permissions the delegating human must independently hold. */
  requiredScopes: readonly string[];
  surfaces: readonly AgentSurface[];
  /** One sentence, in the caller's vocabulary, for the "what can it do?" surface. */
  summary: string;
  /** Present-tense step label, e.g. "Reading the last three encounters". Never a call signature. */
  activityLabel: string;
  /** Minimum necessary, per tool. Exceeding it is a scope violation, not a truncation. */
  maxResultRows: number;
  /** True when the tool may only return rows for the chart the caller has open. */
  compartmentBound: boolean;
  input: z.ZodType<Input>;
  output: z.ZodType<Output>;
  execute: (input: Input, context: ToolContext) => Promise<Output>;
}

/** A registered tool, type-erased so one registry can hold all of them. */
export interface AgentTool {
  readonly id: string;
  readonly tier: ToolTier;
  readonly trustClass: TrustClass;
  readonly approval: ApprovalPolicy;
  readonly sideEffect: SideEffect;
  readonly requiredScopes: readonly string[];
  readonly surfaces: readonly AgentSurface[];
  readonly summary: string;
  readonly activityLabel: string;
  readonly maxResultRows: number;
  readonly compartmentBound: boolean;
  readonly inputSchema: z.ZodType;
  readonly outputSchema: z.ZodType;
  /** Validates, executes, validates again, re-checks the compartment. In that order. */
  run(rawInput: unknown, context: ToolContext): Promise<unknown>;
}

const TOOL_ID_PATTERN = /^[a-z][a-z0-9]*\.[a-z][a-zA-Z0-9]*$/;

/**
 * Identifiers a tool input may never contain.
 *
 * If the model can name a compartment, the model can cross one. The runtime
 * supplies the tenant and the open chart; the model supplies neither, ever.
 */
const FORBIDDEN_INPUT_KEYS: readonly string[] = ['tenantId', 'organisationId'];
const PATIENT_SURFACE_FORBIDDEN_KEYS: readonly string[] = ['patientId', 'patientMrn', 'mrn'];

/**
 * Verbs that would make the agent able to communicate externally.
 *
 * The exfiltration trifecta is access to private data, exposure to untrusted
 * content, and the ability to communicate externally. An EMR agent has the
 * first two by definition, so the third is made structurally impossible: there
 * is no outbound-communication tool, and one cannot be registered.
 */
const BANNED_TOOL_VERBS: readonly string[] = [
  'send',
  'email',
  'sms',
  'fax',
  'webhook',
  'fetch',
  'notify',
  'publish',
  'transmit',
  'dispatch',
  'share',
  'export',
  'upload',
];

/**
 * Registers a tool, refusing at construction anything the tier ladder forbids.
 *
 * These checks run when the module is imported, not when a turn runs, so a tool
 * that breaks an invariant cannot be shipped: the process that loads it fails.
 */
export function defineTool<Input, Output>(definition: ToolDefinition<Input, Output>): AgentTool {
  assertToolInvariants(definition);

  const sideEffect = sideEffectForTier(definition.tier);

  return {
    id: definition.id,
    tier: definition.tier,
    trustClass: definition.trustClass,
    approval: definition.approval,
    sideEffect,
    requiredScopes: [...definition.requiredScopes],
    surfaces: [...definition.surfaces],
    summary: definition.summary,
    activityLabel: definition.activityLabel,
    maxResultRows: definition.maxResultRows,
    compartmentBound: definition.compartmentBound,
    inputSchema: definition.input,
    outputSchema: definition.output,

    async run(rawInput: unknown, context: ToolContext): Promise<unknown> {
      const parsedInput = definition.input.safeParse(rawInput);
      if (!parsedInput.success) {
        // One repair round-trip happens above this, in the loop. Here we only
        // refuse: guessing at what the model meant is how a wrong id gets read.
        throw new ToolError(
          'AGENT_TOOL_INPUT_INVALID',
          `${definition.id} was called with arguments its schema rejects.`,
          { toolId: definition.id }
        );
      }

      const result = await definition.execute(parsedInput.data, context);

      const parsedOutput = definition.output.safeParse(result);
      if (!parsedOutput.success) {
        throw new ToolError(
          'AGENT_TOOL_OUTPUT_INVALID',
          `${definition.id} returned a result its own output schema does not describe.`,
          { toolId: definition.id }
        );
      }

      assertWithinCompartment(parsedOutput.data, context.principal, {
        toolId: definition.id,
        maxResultRows: definition.maxResultRows,
        compartmentBound: definition.compartmentBound,
      });

      return parsedOutput.data;
    },
  };
}

export interface ToolRegistry {
  readonly tools: readonly AgentTool[];
  /**
   * Registry-level lookup. **Not authorisation**: it answers "is this a tool
   * that exists", which is a different question from "may this caller see it".
   * The loop calls `resolveTool` instead.
   */
  byId(id: string): AgentTool | undefined;
}

export function createToolRegistry(tools: readonly AgentTool[]): ToolRegistry {
  const byId = new Map<string, AgentTool>();
  for (const tool of tools) {
    if (byId.has(tool.id)) {
      throw new Error(`Duplicate tool id: ${tool.id}`);
    }
    byId.set(tool.id, tool);
  }

  return {
    tools: [...tools],
    byId: (id: string): AgentTool | undefined => byId.get(id),
  };
}

function assertToolInvariants<Input, Output>(definition: ToolDefinition<Input, Output>): void {
  const { id } = definition;

  if (!TOOL_ID_PATTERN.test(id)) {
    throw new Error(`Tool id "${id}" must be aggregate.verb, lower camel on both sides.`);
  }

  const verb = id.split('.')[1] ?? '';
  const bannedVerb = BANNED_TOOL_VERBS.find((banned) => verb.toLowerCase().startsWith(banned));
  if (bannedVerb !== undefined) {
    throw new Error(
      `Tool "${id}" looks like outbound communication ("${bannedVerb}"). ADR-0005: the agent has no outbound-communication tool of any kind, ever.`
    );
  }

  if (definition.surfaces.length === 0) {
    throw new Error(`Tool "${id}" is registered for no surface, which is a typo, not a policy.`);
  }

  if (definition.maxResultRows < 1) {
    throw new Error(`Tool "${id}" must declare a minimum-necessary row cap of at least 1.`);
  }

  if (definition.tier === 'READ' && definition.trustClass !== 'reader') {
    throw new Error(`Tool "${id}" is READ, so it belongs to the reader.`);
  }

  if (definition.tier !== 'READ' && definition.approval !== 'always') {
    throw new Error(
      `Tool "${id}" changes state, so it is approval:'always' in v1. There is no such thing as an unapproved write.`
    );
  }

  if (definition.tier !== 'READ' && definition.requiredScopes.length === 0) {
    throw new Error(`Tool "${id}" changes state and must name the permission the human holds.`);
  }

  const inputKeys = collectSchemaKeys(definition.input);

  for (const forbidden of FORBIDDEN_INPUT_KEYS) {
    if (inputKeys.has(forbidden)) {
      throw new Error(
        `Tool "${id}" accepts "${forbidden}". The runtime supplies the compartment; the model never names one.`
      );
    }
  }

  if (definition.surfaces.includes('patient')) {
    for (const forbidden of PATIENT_SURFACE_FORBIDDEN_KEYS) {
      if (inputKeys.has(forbidden)) {
        throw new Error(
          `Tool "${id}" is patient-facing and accepts "${forbidden}". On the patient surface the chart is bound from the session and there is no lookup.`
        );
      }
    }
  }
}

/**
 * Every property name a schema mentions, at any depth.
 *
 * Read off the JSON Schema projection rather than zod internals: that is the
 * same projection the model is shown, so the check and the advertisement can
 * never disagree about what a tool accepts.
 */
export function collectSchemaKeys(schema: z.ZodType): Set<string> {
  const keys = new Set<string>();
  walkJsonSchema(z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }), keys);
  return keys;
}

function walkJsonSchema(node: unknown, keys: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) walkJsonSchema(item, keys);
    return;
  }
  if (typeof node !== 'object' || node === null) return;

  const record: Record<string, unknown> = node as Record<string, unknown>;
  const properties = record['properties'];
  if (typeof properties === 'object' && properties !== null) {
    for (const key of Object.keys(properties)) keys.add(key);
  }

  for (const value of Object.values(record)) walkJsonSchema(value, keys);
}
