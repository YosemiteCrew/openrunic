import { describe, expect, it } from 'vitest';

import { TOOL_ALLOWLIST } from './allowlist.js';
import { V1_TOOLS, createV1Registry } from './catalogue.js';
import { collectSchemaKeys } from './registry.js';
import type { AgentTool } from './registry.js';
import { AUDIT_QUERY_SCOPE } from './tools/audit-query.js';

/**
 * The catalogue, asserted against ADR-0005 rather than against itself.
 *
 * The table below is the specification restated in code. If a tool's tier,
 * trust class, approval policy or grants change, this test fails, which is the
 * point: the catalogue is a regulatory artefact, not a configuration file.
 */

interface Expected {
  tier: AgentTool['tier'];
  trustClass: AgentTool['trustClass'];
  approval: AgentTool['approval'];
  roles: readonly string[];
}

const EXPECTED: Readonly<Record<string, Expected>> = {
  'chart.search': {
    tier: 'READ',
    trustClass: 'reader',
    approval: 'never',
    roles: ['clinician', 'biller'],
  },
  'denial.triage': { tier: 'READ', trustClass: 'reader', approval: 'never', roles: ['biller'] },
  'denial.draftAppeal': {
    tier: 'DRAFT',
    trustClass: 'writer',
    approval: 'always',
    roles: ['biller'],
  },
  'priorauth.assemblePacket': {
    tier: 'DRAFT',
    trustClass: 'writer',
    approval: 'always',
    roles: ['biller', 'clinician'],
  },
  'forms.draftDefinition': {
    tier: 'DRAFT',
    trustClass: 'writer',
    approval: 'always',
    roles: ['admin'],
  },
  'inbox.classify': {
    tier: 'DRAFT',
    trustClass: 'writer',
    approval: 'always',
    roles: ['front-desk', 'clinician'],
  },
  'audit.query': {
    tier: 'READ',
    trustClass: 'reader',
    approval: 'never',
    roles: ['admin', 'compliance'],
  },
  'appointments.findSlots': {
    tier: 'READ',
    trustClass: 'reader',
    approval: 'never',
    roles: ['front-desk', 'clinician'],
  },
  'appointments.propose': {
    tier: 'DRAFT',
    trustClass: 'writer',
    approval: 'always',
    roles: ['front-desk', 'clinician'],
  },
  'documents.extractCandidates': {
    tier: 'DRAFT',
    trustClass: 'writer',
    approval: 'always',
    roles: ['clinician', 'front-desk'],
  },
  'messages.draftReply': {
    tier: 'DRAFT',
    trustClass: 'writer',
    approval: 'always',
    roles: ['clinician'],
  },
  'coding.suggest': { tier: 'DRAFT', trustClass: 'writer', approval: 'always', roles: ['biller'] },
};

/**
 * Banned in every string the product renders. Intended use is established by
 * claims, so this vocabulary is labelling, and an enthusiastic contributor is
 * the most likely way it re-enters.
 */
const BANNED_VOCABULARY = [
  'diagnose',
  'diagnosis',
  'triage',
  'acuity',
  'urgency',
  'urgent',
  'advice',
  'recommend',
];

describe('the v1 catalogue', () => {
  it('ships in the order the ADR sets, chart search first and coding suggestion last', () => {
    expect(V1_TOOLS.map((tool) => tool.id)).toEqual([
      'chart.search',
      'denial.triage',
      'denial.draftAppeal',
      'priorauth.assemblePacket',
      'forms.draftDefinition',
      'inbox.classify',
      'audit.query',
      'appointments.findSlots',
      'appointments.propose',
      'documents.extractCandidates',
      'messages.draftReply',
      'coding.suggest',
    ]);
  });

  it('carries the tier, trust class and approval policy the ADR assigns', () => {
    for (const tool of V1_TOOLS) {
      const expected = EXPECTED[tool.id];
      expect(expected, `${tool.id} is not in the specification table`).toBeDefined();
      expect({
        tier: tool.tier,
        trustClass: tool.trustClass,
        approval: tool.approval,
      }).toEqual({
        tier: expected?.tier,
        trustClass: expected?.trustClass,
        approval: expected?.approval,
      });
    }
  });

  it('makes every write tool approval-always, with no exceptions in v1', () => {
    for (const tool of V1_TOOLS.filter((candidate) => candidate.sideEffect === 'write')) {
      expect(tool.approval, tool.id).toBe('always');
    }
  });

  it('holds no EXECUTE_BOUNDED tool on the staff surface in v1', () => {
    expect(V1_TOOLS.filter((tool) => tool.tier === 'EXECUTE_BOUNDED')).toEqual([]);
  });

  it('appears in exactly the grants each catalogue entry names', () => {
    for (const tool of V1_TOOLS) {
      const grantedTo = Object.entries(TOOL_ALLOWLIST.staff)
        .filter(([, ids]) => ids.includes(tool.id))
        .map(([role]) => role);
      expect(new Set(grantedTo), tool.id).toEqual(new Set(EXPECTED[tool.id]?.roles));
    }
  });

  it('grants the patient surface nothing at all', () => {
    expect(TOOL_ALLOWLIST.patient).toEqual({});
    expect(V1_TOOLS.every((tool) => !tool.surfaces.includes('patient'))).toBe(true);
  });

  it('grants nothing that is not a registered tool', () => {
    const registered = new Set(V1_TOOLS.map((tool) => tool.id));
    for (const ids of Object.values(TOOL_ALLOWLIST.staff)) {
      for (const id of ids) expect(registered, id).toContain(id);
    }
  });

  it('names no compartment in any tool input schema', () => {
    for (const tool of V1_TOOLS) {
      const keys = collectSchemaKeys(tool.inputSchema);
      expect(keys.has('tenantId'), tool.id).toBe(false);
      expect(keys.has('organisationId'), tool.id).toBe(false);
    }
  });

  it('keeps the banned clinical vocabulary out of every rendered string', () => {
    for (const tool of V1_TOOLS) {
      const text = `${tool.summary} ${tool.activityLabel}`.toLowerCase();
      for (const word of BANNED_VOCABULARY) {
        expect(text.includes(word), `${tool.id} says "${word}"`).toBe(false);
      }
    }
  });

  it('carries no outbound-communication capability', () => {
    const verbs = V1_TOOLS.map((tool) => tool.id.split('.')[1] ?? '');
    for (const banned of ['send', 'email', 'fax', 'notify', 'publish', 'export']) {
      expect(verbs.some((verb) => verb.toLowerCase().startsWith(banned))).toBe(false);
    }
  });

  it('declares the audit scope the platform does not have yet, rather than borrowing one', () => {
    const audit = V1_TOOLS.find((tool) => tool.id === 'audit.query');
    expect(audit?.requiredScopes).toEqual([AUDIT_QUERY_SCOPE]);
  });

  it('builds a registry with every tool reachable by id', () => {
    const registry = createV1Registry();
    expect(registry.tools).toHaveLength(V1_TOOLS.length);
    for (const tool of V1_TOOLS) {
      expect(registry.byId(tool.id)).toBeDefined();
    }
  });
});
