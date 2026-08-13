import { describe, expect, it } from 'vitest';

import { TOOL_ALLOWLIST, type ToolAllowlist } from './allowlist.js';
import { createV1Registry } from './catalogue.js';
import { grantedIds, resolveTool, resolveTools } from './resolve.js';
import { stubPrincipal } from './testing/index.js';

/**
 * Deny by default, and the difference between invisible and refused.
 *
 * A refusal is a disclosure: "you may not run the audit query" tells the caller
 * there is an audit query. So an ungranted tool and a tool that does not exist
 * produce the same answer, and this suite asserts that they are
 * indistinguishable.
 */

const registry = createV1Registry();

const ALL_SCOPES = [
  'patient.read',
  'appointment.read',
  'appointment.write',
  'encounter.read',
  'encounter.write',
  'claim.read',
  'claim.write',
  'task.read',
  'task.write',
  'form.read',
  'form.write',
];

describe('resolving tools for a principal', () => {
  it('gives a clinician exactly the clinician grants', () => {
    const tools = resolveTools(
      registry,
      stubPrincipal({ roleIds: ['clinician'], scopes: ALL_SCOPES })
    );
    expect(tools.map((tool) => tool.id)).toEqual([
      'chart.search',
      'priorauth.assemblePacket',
      'inbox.classify',
      'appointments.findSlots',
      'appointments.propose',
      'documents.extractCandidates',
      'messages.draftReply',
    ]);
  });

  it('gives a biller the billing grants and nothing clinical', () => {
    const tools = resolveTools(
      registry,
      stubPrincipal({ roleIds: ['biller'], scopes: ALL_SCOPES })
    );
    expect(tools.map((tool) => tool.id)).toEqual([
      'chart.search',
      'denial.triage',
      'denial.draftAppeal',
      'priorauth.assemblePacket',
      'coding.suggest',
    ]);
  });

  it('unions the grants of every role the principal holds', () => {
    const tools = resolveTools(
      registry,
      stubPrincipal({ roleIds: ['front-desk', 'biller'], scopes: ALL_SCOPES })
    );
    expect(tools.map((tool) => tool.id)).toContain('denial.triage');
    expect(tools.map((tool) => tool.id)).toContain('appointments.findSlots');
  });

  it('gives an unknown role nothing, rather than a default', () => {
    expect(resolveTools(registry, stubPrincipal({ roleIds: ['locum-cover'] }))).toEqual([]);
  });

  it('gives the patient surface nothing at all', () => {
    expect(
      resolveTools(
        registry,
        stubPrincipal({ surface: 'patient', roleIds: ['clinician'], scopes: ALL_SCOPES })
      )
    ).toEqual([]);
  });

  it('hides a granted tool whose scope the human does not independently hold', () => {
    const withoutClaims = resolveTools(
      registry,
      stubPrincipal({ roleIds: ['biller'], scopes: ['patient.read'] })
    );
    expect(withoutClaims.map((tool) => tool.id)).toEqual(['chart.search']);
  });

  it('hides the audit query from everyone, because no principal holds the scope yet', () => {
    const asAdmin = resolveTools(
      registry,
      stubPrincipal({ roleIds: ['admin'], scopes: [...ALL_SCOPES, 'facility.all'] })
    );
    expect(asAdmin.map((tool) => tool.id)).toEqual(['forms.draftDefinition']);
  });

  it('returns the audit query once the scope exists', () => {
    const asCompliance = resolveTools(
      registry,
      stubPrincipal({ roleIds: ['compliance'], scopes: ['audit.query'] })
    );
    expect(asCompliance.map((tool) => tool.id)).toEqual(['audit.query']);
  });
});

describe('an ungranted tool is invisible, not refused', () => {
  it('answers undefined for a tool the caller may not reach', () => {
    const principal = stubPrincipal({ roleIds: ['front-desk'], scopes: ALL_SCOPES });
    expect(resolveTool(registry, principal, 'coding.suggest')).toBeUndefined();
  });

  it('answers undefined for a tool that does not exist', () => {
    const principal = stubPrincipal({ roleIds: ['front-desk'], scopes: ALL_SCOPES });
    expect(resolveTool(registry, principal, 'nothing.here')).toBeUndefined();
  });

  it('cannot be distinguished from the caller side', () => {
    const principal = stubPrincipal({ roleIds: ['front-desk'], scopes: ALL_SCOPES });
    const ungranted = resolveTool(registry, principal, 'coding.suggest');
    const nonexistent = resolveTool(registry, principal, 'nothing.here');
    expect(ungranted).toEqual(nonexistent);
  });

  it('still finds it in the registry, which is a different question', () => {
    expect(registry.byId('coding.suggest')).toBeDefined();
  });
});

describe('the reader/writer split at resolve time', () => {
  it('gives the reader loop no state-changing tool at all', () => {
    const readerTools = resolveTools(
      registry,
      stubPrincipal({ roleIds: ['clinician'], scopes: ALL_SCOPES }),
      { trustClass: 'reader' }
    );
    expect(readerTools.map((tool) => tool.id)).toEqual(['chart.search', 'appointments.findSlots']);
    expect(readerTools.every((tool) => tool.sideEffect === 'read')).toBe(true);
  });

  it('gives the writer loop only proposal-emitting tools', () => {
    const writerTools = resolveTools(
      registry,
      stubPrincipal({ roleIds: ['clinician'], scopes: ALL_SCOPES }),
      { trustClass: 'writer' }
    );
    expect(writerTools.every((tool) => tool.approval === 'always')).toBe(true);
    expect(writerTools.map((tool) => tool.id)).not.toContain('chart.search');
  });
});

describe('capability caps', () => {
  it('narrows the exposed set without ever widening it', () => {
    const principal = stubPrincipal({ roleIds: ['clinician'], scopes: ALL_SCOPES });
    const capped = resolveTools(registry, principal, { maxToolsExposed: 2 });
    expect(capped.map((tool) => tool.id)).toEqual(['chart.search', 'priorauth.assemblePacket']);
  });

  it('accepts a deployer allowlist that is narrower than the shipped one', () => {
    const narrowed: ToolAllowlist = { staff: { clinician: ['chart.search'] }, patient: {} };
    const tools = resolveTools(
      registry,
      stubPrincipal({ roleIds: ['clinician'], scopes: ALL_SCOPES }),
      { allowlist: narrowed }
    );
    expect(tools.map((tool) => tool.id)).toEqual(['chart.search']);
  });
});

describe('grantedIds', () => {
  it('is empty for a surface with no grants', () => {
    expect(grantedIds(TOOL_ALLOWLIST, stubPrincipal({ surface: 'patient' })).size).toBe(0);
  });
});
