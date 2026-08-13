import { ToolError } from './errors.js';
import type { AgentPrincipal } from './principal.js';

/**
 * The boundary re-check, and the minimum-necessary cardinality check.
 *
 * Two enforcement points exist for scope: the advertise-time filter in
 * `resolve.ts`, which is an accuracy and prompt-budget win, and this one, which
 * is the actual control. Every tool result is re-checked against the
 * principal's compartment before it is serialised back into the turn.
 *
 * On mismatch we **abort the turn** rather than filtering the row out. A silent
 * filter hides the bug that produced it, and the bug that produced it is a
 * cross-tenant read.
 *
 * The cardinality check is positive security rather than negative: a staff tool
 * returning more charts than it declared is a scope violation regardless of how
 * reasonable the request sounded. Most clinical attacks are fluent,
 * legitimate-looking requests that carry no attack signal, so a check on the
 * shape of the answer beats a check on the wording of the question.
 */

/** Keys that name a compartment. Checked wherever they appear in a payload, at any depth. */
const TENANT_KEYS: readonly string[] = ['tenantId', 'organisationId'];
const PATIENT_KEYS: readonly string[] = ['patientId'];

export interface CompartmentCheck {
  toolId: string;
  /** Maximum rows the tool declared. Minimum necessary, per tool, not per product. */
  maxResultRows: number;
  /**
   * True when the tool may only return rows for the chart the caller has open.
   * Always true on the patient surface, whatever the tool says.
   */
  compartmentBound: boolean;
}

/**
 * Re-checks a tool result against the principal. Throws, never filters.
 */
export function assertWithinCompartment(
  payload: unknown,
  principal: AgentPrincipal,
  check: CompartmentCheck
): void {
  const rows = countRows(payload);
  if (rows > check.maxResultRows) {
    throw new ToolError(
      'AGENT_SCOPE_DENIED',
      `${check.toolId} returned ${String(rows)} rows against a declared maximum of ${String(check.maxResultRows)}.`,
      { toolId: check.toolId }
    );
  }

  const bound = check.compartmentBound || principal.surface === 'patient';
  const expectedPatientId = principal.compartment.patientId;

  walk(payload, (key, value) => {
    if (typeof value !== 'string') return;

    if (TENANT_KEYS.includes(key) && value !== principal.tenantId) {
      throw new ToolError(
        'AGENT_COMPARTMENT_VIOLATION',
        `${check.toolId} returned a row belonging to another organisation. The turn was aborted.`,
        { toolId: check.toolId }
      );
    }

    if (bound && PATIENT_KEYS.includes(key) && value !== expectedPatientId) {
      throw new ToolError(
        'AGENT_COMPARTMENT_VIOLATION',
        `${check.toolId} returned a row outside the open chart. The turn was aborted.`,
        { toolId: check.toolId }
      );
    }
  });
}

/**
 * How many records a payload carries.
 *
 * The API's list envelope is `{ data: [...], page: {...} }`, so the row count
 * is the length of `data` where one exists and one otherwise. A tool returning
 * a bare array is counted by its length.
 */
export function countRows(payload: unknown): number {
  if (Array.isArray(payload)) return payload.length;
  if (isRecord(payload) && Array.isArray(payload['data'])) return payload['data'].length;
  return 1;
}

function walk(value: unknown, visit: (key: string, value: unknown) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    visit(key, child);
    walk(child, visit);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
