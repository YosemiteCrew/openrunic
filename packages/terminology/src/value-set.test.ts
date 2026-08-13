import { describe, expect, it } from 'vitest';

import {
  conceptInValueSet,
  conceptMatchesRule,
  parseValueSetDefinition,
  valueSetDefinitionSchema,
} from './value-set.js';
import type { TerminologyConcept } from './service.js';
import { PROBLEM_SYSTEM, PROCEDURE_SYSTEM } from './test-support/fixture.js';

const child: TerminologyConcept = {
  system: PROBLEM_SYSTEM,
  code: 'PB-110',
  display: 'Aching left elbow',
  version: '2026-01',
  parentCode: 'PB-100',
  isActive: true,
  properties: null,
};

describe('value set definitions', () => {
  it('accepts a definition that a settings screen would produce', () => {
    const result = parseValueSetDefinition({
      url: 'http://example.invalid/vs/intake-problems',
      name: 'Intake problems',
      description: 'Offered on the intake form',
      include: [{ system: PROBLEM_SYSTEM, parentCode: 'PB-100' }],
      exclude: [{ system: PROBLEM_SYSTEM, codes: ['PB-111'] }],
      includeRetired: false,
    });
    expect(result.ok && result.value.include).toHaveLength(1);
  });

  it('refuses a definition with no include rules, which would silently accept nothing', () => {
    const result = parseValueSetDefinition({
      url: 'http://example.invalid/vs/empty',
      include: [],
    });
    expect(!result.ok && result.error.kind).toBe('invalid_value_set');
    expect(!result.ok && result.error.issues[0]).toContain('include');
  });

  it('refuses a misspelled key rather than widening the set by ignoring it', () => {
    const result = parseValueSetDefinition({
      url: 'http://example.invalid/vs/typo',
      include: [{ system: PROBLEM_SYSTEM, parentcode: 'PB-100' }],
    });
    expect(result.ok).toBe(false);
  });

  it('reports a root-level problem without inventing a field path', () => {
    const result = parseValueSetDefinition('not an object at all');
    expect(!result.ok && result.error.issues).toHaveLength(1);
    expect(!result.ok && result.error.message).toContain('not usable');
  });

  it('exposes the schema so a caller can validate before it saves', () => {
    expect(
      valueSetDefinitionSchema.safeParse({ url: 'x', include: [{ system: 'y' }] }).success
    ).toBe(true);
  });
});

describe('rule matching', () => {
  it('matches every code in a system when the rule names only the system', () => {
    expect(conceptMatchesRule(child, { system: PROBLEM_SYSTEM })).toBe(true);
  });

  it('does not match across systems', () => {
    expect(conceptMatchesRule(child, { system: PROCEDURE_SYSTEM })).toBe(false);
  });

  it('narrows to an explicit code list', () => {
    expect(conceptMatchesRule(child, { system: PROBLEM_SYSTEM, codes: ['PB-110'] })).toBe(true);
    expect(conceptMatchesRule(child, { system: PROBLEM_SYSTEM, codes: ['PB-111'] })).toBe(false);
  });

  it('narrows to the direct children of one parent', () => {
    expect(conceptMatchesRule(child, { system: PROBLEM_SYSTEM, parentCode: 'PB-100' })).toBe(true);
    expect(conceptMatchesRule(child, { system: PROBLEM_SYSTEM, parentCode: 'PB-200' })).toBe(false);
  });

  it('pins to one loaded release when the rule names a version', () => {
    expect(conceptMatchesRule(child, { system: PROBLEM_SYSTEM, version: '2026-01' })).toBe(true);
    expect(conceptMatchesRule(child, { system: PROBLEM_SYSTEM, version: '2025-01' })).toBe(false);
  });

  it('ignores status, which is the definition and the request to decide', () => {
    const retired: TerminologyConcept = { ...child, isActive: false };
    expect(conceptMatchesRule(retired, { system: PROBLEM_SYSTEM })).toBe(true);
  });
});

describe('membership', () => {
  it('requires an include and no exclude', () => {
    expect(conceptInValueSet(child, { url: 'vs', include: [{ system: PROBLEM_SYSTEM }] })).toBe(
      true
    );
    expect(conceptInValueSet(child, { url: 'vs', include: [{ system: PROCEDURE_SYSTEM }] })).toBe(
      false
    );
  });

  it('lets an exclusion override an include', () => {
    expect(
      conceptInValueSet(child, {
        url: 'vs',
        include: [{ system: PROBLEM_SYSTEM }],
        exclude: [{ system: PROBLEM_SYSTEM, codes: ['PB-110'] }],
      })
    ).toBe(false);
  });
});
