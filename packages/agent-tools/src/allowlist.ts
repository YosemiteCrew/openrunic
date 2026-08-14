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
   * The patient surface, decided separately in
   * [ADR-0006](../../../docs/adr/0006-patient-agent-surface.md) as ADR-0005
   * rule 7 required, and still behind its own flag: the API mounts no agent
   * router without an endpoint, and grants here reach nobody until a deployer
   * configures one.
   *
   * Three read capabilities, and the shortness of the list is the point. Every
   * one of them returns stored rows from the reader's own chart and nothing
   * else: no grading, no measured values, no clinician prose, nothing a reader
   * with no clinician beside them could take for advice. ADR-0006 records what
   * was left out and why.
   *
   * `patient-portal` is the role the API's portal principal actually holds, so
   * this key is not a new concept invented for the agent. A patient who somehow
   * carried a staff role would still reach nothing extra, because a tool is
   * visible only when its own `surfaces` list names the caller's surface.
   */
  patient: {
    'patient-portal': ['record.list', 'visits.list', 'bills.list'],
  },
};
