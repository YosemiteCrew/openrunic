/**
 * Tool failures, as codes rather than as prose.
 *
 * Every code here also appears in the API response body and in the rendered
 * surface, so an operator reading a log, a clinician reading a transcript and a
 * test asserting a refusal are all naming the same thing.
 */
export const TOOL_FAILURE_CODES = [
  /** The tool is not granted to this principal and surface. Callers must not distinguish it from an unknown id. */
  'AGENT_TOOL_UNKNOWN',
  /** The arguments did not satisfy the input schema. */
  'AGENT_TOOL_INPUT_INVALID',
  /** The tool returned something its own output schema does not describe. */
  'AGENT_TOOL_OUTPUT_INVALID',
  /** The upstream API refused or failed. */
  'AGENT_TOOL_FAILED',
  /** A result named a tenant, patient or facility outside the principal's compartment. */
  'AGENT_COMPARTMENT_VIOLATION',
  /** A result exceeded the declared minimum-necessary cardinality. */
  'AGENT_SCOPE_DENIED',
] as const;

export type ToolFailureCode = (typeof TOOL_FAILURE_CODES)[number];

export interface ToolErrorOptions {
  /** Tool id, when one is known. Absent for an unknown id, by design. */
  toolId?: string;
  /** Upstream HTTP status, when the failure came from the API. */
  status?: number;
  cause?: unknown;
}

/**
 * The one error type a tool raises.
 *
 * `detail` is written for a human reading a transcript and never carries chart
 * content: a failure message is a channel out of the compartment like any
 * other.
 */
export class ToolError extends Error {
  readonly code: ToolFailureCode;
  readonly toolId: string | undefined;
  readonly status: number | undefined;

  constructor(code: ToolFailureCode, detail: string, options: ToolErrorOptions = {}) {
    super(detail, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ToolError';
    this.code = code;
    this.toolId = options.toolId;
    this.status = options.status;
  }

  /**
   * A compartment violation aborts the turn. It never filters the offending row
   * out and continues: a silent filter hides the bug that produced it, and the
   * bug that produced it is a cross-tenant read.
   */
  get abortsTurn(): boolean {
    return this.code === 'AGENT_COMPARTMENT_VIOLATION';
  }
}

export function isToolError(value: unknown): value is ToolError {
  return value instanceof ToolError;
}
