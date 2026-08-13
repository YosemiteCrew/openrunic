import type { AgentSurface } from './tiers.js';

/**
 * Deny by default, keyed on surface and then on role.
 *
 * Adding a tool to the codebase adds it to no surface. The default is `{}`, and
 * `{}` means nothing is reachable. A grant is a deliberate line in this file,
 * and `registry.allowlist.test.ts` asserts that every registered tool appears
 * in exactly the grants its own catalogue entry names, so this table and the
 * catalogue cannot drift apart.
 *
 * Note what admin does **not** get. An organisation administrator is not a
 * clinician, so `admin` holds the form-design and audit-query capabilities and
 * nothing clinical. A role that can reach everything is a role that makes the
 * allowlist decorative.
 */

/** Role id to tool ids. A role absent from the map holds nothing. */
export type SurfaceAllowlist = Readonly<Record<string, readonly string[]>>;

export type ToolAllowlist = Readonly<Record<AgentSurface, SurfaceAllowlist>>;

export const TOOL_ALLOWLIST: ToolAllowlist = {
  staff: {
    clinician: [
      'chart.search',
      'priorauth.assemblePacket',
      'inbox.classify',
      'appointments.findSlots',
      'appointments.propose',
      'documents.extractCandidates',
      'messages.draftReply',
    ],
    biller: [
      'chart.search',
      'denial.triage',
      'denial.draftAppeal',
      'priorauth.assemblePacket',
      'coding.suggest',
    ],
    'front-desk': [
      'inbox.classify',
      'appointments.findSlots',
      'appointments.propose',
      'documents.extractCandidates',
    ],
    admin: ['forms.draftDefinition', 'audit.query'],
    /**
     * Not a seeded system role. A tenant that defines one gets the audit query
     * and nothing else; until it does, the grant is inert. Recorded here so the
     * compliance capability has an owner rather than defaulting to admin.
     */
    compliance: ['audit.query'],
  },
  /**
   * The patient surface is a separate regulatory decision with its own ADR
   * (ADR-0006, not written), its own flag and its own budget pool. Empty is not
   * an oversight: it is the decision, and shipping staff and patient behind one
   * switch would silently adopt ADR-0004's own worst case.
   */
  patient: {},
};
