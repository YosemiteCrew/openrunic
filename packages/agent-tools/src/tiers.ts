/**
 * The tier ladder, in code rather than in a document.
 *
 * ADR-0005 gives every capability exactly one tier, and the tier is what the
 * runtime branches on: whether a human has to sign, whether an approval token
 * is minted, and what the audit event records.
 */

/**
 * - `READ` retrieves, filters, orders and cites. No write of any kind. The
 *   failure mode is an unhelpful answer.
 * - `DRAFT` produces an artifact in `pending` state with no effect until a
 *   human commits it. The human is the actor of record on commit.
 * - `EXECUTE_BOUNDED` is reversible, non-clinical, inside a declared policy
 *   envelope and immediately visible to a human. This list stays very short;
 *   it is empty on the staff surface in v1.
 *
 * There is deliberately no fourth member. Tier 3 in ADR-0005 is the set of
 * capabilities that are not reachable under any configuration - signing a note,
 * placing an order, marking a result reviewed, submitting a claim, making an
 * urgency determination, writing the audit log, changing consent, deleting
 * anything, break-glass - and the way to make that unreachable is to give it no
 * representation in the type system at all, not to give it a value someone can
 * assign.
 */
export const TOOL_TIERS = ['READ', 'DRAFT', 'EXECUTE_BOUNDED'] as const;

export type ToolTier = (typeof TOOL_TIERS)[number];

/**
 * Which half of the reader/writer split a tool belongs to.
 *
 * A `reader` may see untrusted content - note text, patient message bodies,
 * document text, observation comments - and therefore holds no state-changing
 * capability. A `writer` never sees free text: only ids, codes, enums, numbers
 * and dates cross into it. An injection in the reader produces a wrong answer;
 * it cannot produce an action, because the reader has no action to take.
 */
export const TRUST_CLASSES = ['reader', 'writer'] as const;

export type TrustClass = (typeof TRUST_CLASSES)[number];

/** Whether executing the tool can change state. Derived from the tier, and checked against it. */
export const SIDE_EFFECTS = ['read', 'write'] as const;

export type SideEffect = (typeof SIDE_EFFECTS)[number];

/**
 * Approval policy. Every write tool is `always` in v1; `never` is reachable
 * only by a `READ` tool, and {@link assertTierInvariants} enforces that.
 */
export const APPROVAL_POLICIES = ['never', 'always'] as const;

export type ApprovalPolicy = (typeof APPROVAL_POLICIES)[number];

/**
 * The surface a caller is on. The patient surface is defined here so the
 * registry shape supports it without a rewrite; it is granted nothing in v1 and
 * ships behind its own ADR and its own flag.
 */
export const AGENT_SURFACES = ['staff', 'patient'] as const;

export type AgentSurface = (typeof AGENT_SURFACES)[number];

/** True when the tier implies a state change. */
export function sideEffectForTier(tier: ToolTier): SideEffect {
  return tier === 'READ' ? 'read' : 'write';
}
