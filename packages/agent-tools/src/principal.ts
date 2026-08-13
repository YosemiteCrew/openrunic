import type { AgentSurface } from './tiers.js';

/**
 * Who the turn is running as.
 *
 * One immutable object per turn, minted from the session before the model runs
 * and passed to every tool **by the runtime, never by the model**. Nothing in
 * it is ever read from a tool argument, which is the property that makes
 * compartment crossing impossible rather than merely forbidden: if the model
 * can name a compartment, the model can cross one.
 */
export interface AgentPrincipal {
  tenantId: string;
  /** The delegating human: a user id on the staff surface, a patient id on the patient surface. */
  userId: string;
  roleIds: readonly string[];
  facilityIds: readonly string[];
  surface: AgentSurface;
  /** HL7 PurposeOfUse asserted for the turn, so the audit record is truthful. */
  purposeOfUse: string;
  /**
   * The chart the caller has open, taken from the request rather than from the
   * conversation. The agent cannot switch patients; the user switches patients
   * by navigating, which is an audited act with its own access check.
   */
  compartment: { patientId?: string };
  /**
   * Permissions the delegating human independently holds, resolved by the API's
   * own policy layer. A tool is invisible unless every one of its required
   * scopes appears here.
   */
  scopes: readonly string[];
}

/**
 * The caller's own credential, kept off {@link AgentPrincipal} on purpose.
 *
 * The principal is logged, hashed and passed around; the credential is neither.
 * Keeping them in separate objects is what stops a bearer token reaching an
 * audit payload through an innocent spread.
 */
export interface AgentCredential {
  /** Verbatim `Authorization` header value, e.g. `Bearer <token>`. */
  authorization: string;
}

/** Break-glass through the agent is prohibited outright, so it is not on the principal at all. */
export function isPatientSurface(principal: AgentPrincipal): boolean {
  return principal.surface === 'patient';
}
