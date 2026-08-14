import { describe, expect, it } from 'vitest';

import type { TerminologyConcept, TerminologyService } from '../service.js';
import {
  FIXTURE_CONCEPTS,
  PROBLEM_SYSTEM,
  PROCEDURE_SYSTEM,
  UNLOADED_SYSTEM,
  VS_ALL_PROBLEM_RELEASES,
  VS_ELBOW_PROBLEMS,
  VS_EXPLICIT_PROCEDURES,
  VS_HISTORICAL_PROBLEMS,
  VS_JOINT_PROBLEMS,
  VS_NO_RULES,
  VS_OVERLAPPING_PROBLEMS,
  VS_PROBLEMS_MINUS_LEFT,
  VS_UNCONFIGURED,
} from './fixture.js';

/**
 * The contract suite, written once and run against every implementation.
 *
 * Two implementations of the same interface are only interchangeable if
 * something checks that they behave the same, and a suite written twice drifts
 * the first time somebody fixes a bug in one copy. So the behaviour lives here,
 * and `in-memory.test.ts` and `store.test.ts` each hand it a factory. A test
 * elsewhere in the monorepo that uses the array-backed service is therefore
 * testing production behaviour, which is the only reason it is safe to use a
 * fake terminology service in a clinical test at all.
 *
 * Each implementation's own test file keeps what is genuinely specific to it:
 * for the store-backed one, the shape of the queries it issues.
 */

/** How the suite obtains an implementation. Options mirror the ones both factories accept. */
export interface TerminologyContractHarness {
  readonly name: string;
  create(options?: { readonly maxExpansionSize?: number }): TerminologyService;
}

function displaysOf(concepts: readonly TerminologyConcept[]): string[] {
  return concepts.map((concept) => concept.display);
}

export function describeTerminologyServiceContract(harness: TerminologyContractHarness): void {
  describe(`${harness.name}: terminology service contract`, () => {
    const service = harness.create();

    describe('lookup', () => {
      it('resolves a code to its display, hierarchy and status', async () => {
        const result = await service.lookup({ system: PROBLEM_SYSTEM, code: 'PB-110' });
        expect(result).toStrictEqual({
          ok: true,
          value: {
            system: PROBLEM_SYSTEM,
            code: 'PB-110',
            display: 'Aching left elbow',
            version: '2026-01',
            parentCode: 'PB-100',
            isActive: true,
            properties: null,
          },
        });
      });

      it('resolves the newest loaded release when the caller does not pin one', async () => {
        const result = await service.lookup({ system: PROBLEM_SYSTEM, code: 'PB-100' });
        expect(result.ok && result.value.version).toBe('2026-01');
      });

      it('resolves an older release when the caller pins it', async () => {
        const result = await service.lookup({
          system: PROBLEM_SYSTEM,
          code: 'PB-100',
          version: '2025-01',
        });
        expect(result.ok && result.value.version).toBe('2025-01');
      });

      it('passes publisher properties through untouched', async () => {
        const result = await service.lookup({ system: PROCEDURE_SYSTEM, code: 'PR-10' });
        expect(result.ok && result.value.properties).toStrictEqual({ defaultMinutes: 15 });
      });

      it('resolves a retired code, leaving the judgement to validate', async () => {
        const result = await service.lookup({ system: PROBLEM_SYSTEM, code: 'PB-900' });
        expect(result.ok && result.value.isActive).toBe(false);
      });

      it('reports an unknown code as code_not_found', async () => {
        const result = await service.lookup({ system: PROBLEM_SYSTEM, code: 'PB-404' });
        expect(result.ok).toBe(false);
        expect(!result.ok && result.error).toStrictEqual({
          kind: 'code_not_found',
          system: PROBLEM_SYSTEM,
          code: 'PB-404',
          version: null,
          message: `Code PB-404 was not found in ${PROBLEM_SYSTEM}.`,
        });
      });

      it('names the pinned release when that release does not carry the code', async () => {
        const result = await service.lookup({
          system: PROBLEM_SYSTEM,
          code: 'PB-110',
          version: '2025-01',
        });
        expect(!result.ok && result.error.kind).toBe('code_not_found');
        expect(!result.ok && result.error.message).toContain('at version 2025-01');
      });

      it('separates a system that was never loaded from a code that does not exist', async () => {
        const result = await service.lookup({ system: UNLOADED_SYSTEM, code: 'PB-100' });
        expect(!result.ok && result.error.kind).toBe('system_not_found');
      });
    });

    describe('validate', () => {
      it('accepts an active code and hands back the concept', async () => {
        const result = await service.validate({ system: PROBLEM_SYSTEM, code: 'PB-110' });
        expect(result.ok && result.value.valid).toBe(true);
        expect(result.ok && result.value.valid && result.value.concept.display).toBe(
          'Aching left elbow'
        );
      });

      it('refuses a retired code and says so', async () => {
        const result = await service.validate({ system: PROBLEM_SYSTEM, code: 'PB-900' });
        expect(result.ok && !result.value.valid && result.value.reason).toBe('code_inactive');
        expect(result.ok && !result.value.valid && result.value.message).toContain('retired');
        expect(result.ok && !result.value.valid && result.value.concept?.code).toBe('PB-900');
      });

      it('accepts a retired code when the caller is validating historical data', async () => {
        const result = await service.validate({
          system: PROBLEM_SYSTEM,
          code: 'PB-900',
          allowInactive: true,
        });
        expect(result.ok && result.value.valid).toBe(true);
      });

      it('refuses an unknown code with code_not_found and no concept', async () => {
        const result = await service.validate({ system: PROBLEM_SYSTEM, code: 'PB-404' });
        expect(result.ok && !result.value.valid && result.value.reason).toBe('code_not_found');
        expect(result.ok && !result.value.valid && result.value.concept).toBeNull();
      });

      it('refuses a system that was never loaded with system_not_known', async () => {
        const result = await service.validate({ system: UNLOADED_SYSTEM, code: 'PB-100' });
        expect(result.ok && !result.value.valid && result.value.reason).toBe('system_not_known');
      });

      it('accepts a member of the bound value set', async () => {
        const result = await service.validate({
          system: PROBLEM_SYSTEM,
          code: 'PB-110',
          valueSet: VS_ELBOW_PROBLEMS,
        });
        expect(result.ok && result.value.valid).toBe(true);
      });

      it('refuses a good code that is not on this form', async () => {
        const result = await service.validate({
          system: PROBLEM_SYSTEM,
          code: 'PB-200',
          valueSet: VS_ELBOW_PROBLEMS,
        });
        expect(result.ok && !result.value.valid && result.value.reason).toBe('not_in_value_set');
        expect(result.ok && !result.value.valid && result.value.message).toContain(
          VS_ELBOW_PROBLEMS
        );
      });

      it('refuses a code the value set excludes', async () => {
        const result = await service.validate({
          system: PROBLEM_SYSTEM,
          code: 'PB-110',
          version: '2026-01',
          valueSet: VS_PROBLEMS_MINUS_LEFT,
        });
        expect(result.ok && !result.value.valid && result.value.reason).toBe('not_in_value_set');
      });

      it('accepts a retired code when the value set exists to describe history', async () => {
        const result = await service.validate({
          system: PROBLEM_SYSTEM,
          code: 'PB-900',
          valueSet: VS_HISTORICAL_PROBLEMS,
        });
        expect(result.ok && result.value.valid).toBe(true);
      });

      it('fails rather than judges when the value set is not configured', async () => {
        const result = await service.validate({
          system: PROBLEM_SYSTEM,
          code: 'PB-110',
          valueSet: VS_UNCONFIGURED,
        });
        expect(!result.ok && result.error.kind).toBe('value_set_not_found');
      });

      it('reports the unconfigured value set even when the code is also wrong', async () => {
        const result = await service.validate({
          system: UNLOADED_SYSTEM,
          code: 'PB-404',
          valueSet: VS_UNCONFIGURED,
        });
        expect(!result.ok && result.error.kind).toBe('value_set_not_found');
      });
    });

    describe('expandValueSet', () => {
      it('expands a parent rule to the direct children of that code', async () => {
        const result = await service.expandValueSet({ valueSet: VS_ELBOW_PROBLEMS });
        expect(result.ok && displaysOf(result.value.concepts)).toStrictEqual([
          'Aching left elbow',
          'Aching right elbow',
        ]);
        expect(result.ok && result.value.total).toBe(2);
        expect(result.ok && result.value.valueSet).toBe(VS_ELBOW_PROBLEMS);
      });

      it('expands an explicit member list', async () => {
        const result = await service.expandValueSet({ valueSet: VS_EXPLICIT_PROCEDURES });
        expect(result.ok && displaysOf(result.value.concepts)).toStrictEqual([
          'Elbow examination',
          'Knee examination',
        ]);
      });

      it('merges several include rules', async () => {
        const result = await service.expandValueSet({ valueSet: VS_JOINT_PROBLEMS });
        expect(result.ok && displaysOf(result.value.concepts)).toStrictEqual([
          'Aching left elbow',
          'Aching right elbow',
          'Bruised left knee',
        ]);
      });

      it('counts a concept once when two include rules select it', async () => {
        const result = await service.expandValueSet({ valueSet: VS_OVERLAPPING_PROBLEMS });
        expect(result.ok && displaysOf(result.value.concepts)).toStrictEqual([
          'Aching left elbow',
          'Aching right elbow',
          'Bruised knee',
        ]);
        expect(result.ok && result.value.total).toBe(3);
      });

      it('applies exclusions after the includes', async () => {
        const result = await service.expandValueSet({ valueSet: VS_PROBLEMS_MINUS_LEFT });
        expect(result.ok && displaysOf(result.value.concepts)).toStrictEqual([
          'Aching elbow',
          'Aching right elbow',
          'Bruised knee',
        ]);
      });

      it('returns every loaded release of a code, ordered oldest first', async () => {
        const result = await service.expandValueSet({ valueSet: VS_ALL_PROBLEM_RELEASES });
        expect(result.ok && displaysOf(result.value.concepts)).toStrictEqual([
          'Aching elbow',
          'Aching elbow',
          'Aching left elbow',
          'Aching right elbow',
          'Bruised knee',
          'Bruised left knee',
        ]);
        expect(result.ok && result.value.concepts.map((concept) => concept.version)).toStrictEqual([
          '2025-01',
          '2026-01',
          '2026-01',
          '2026-01',
          '2026-01',
          '2026-01',
        ]);
      });

      it('leaves retired codes out unless the definition admits them', async () => {
        const withoutRetired = await service.expandValueSet({ valueSet: VS_ALL_PROBLEM_RELEASES });
        const withRetired = await service.expandValueSet({ valueSet: VS_HISTORICAL_PROBLEMS });
        expect(withoutRetired.ok && displaysOf(withoutRetired.value.concepts)).not.toContain(
          'Retired swelling entry'
        );
        expect(withRetired.ok && displaysOf(withRetired.value.concepts)).toContain(
          'Retired swelling entry'
        );
        expect(withRetired.ok && withRetired.value.total).toBe(7);
      });

      it('pages a database-side expansion while reporting the full total', async () => {
        const result = await service.expandValueSet({
          valueSet: VS_ELBOW_PROBLEMS,
          offset: 1,
          limit: 1,
        });
        expect(result.ok && displaysOf(result.value.concepts)).toStrictEqual([
          'Aching right elbow',
        ]);
        expect(result.ok && result.value.total).toBe(2);
        expect(result.ok && result.value.offset).toBe(1);
      });

      it('pages a merged expansion the same way', async () => {
        const result = await service.expandValueSet({
          valueSet: VS_JOINT_PROBLEMS,
          offset: 1,
          limit: 1,
        });
        expect(result.ok && displaysOf(result.value.concepts)).toStrictEqual([
          'Aching right elbow',
        ]);
        expect(result.ok && result.value.total).toBe(3);
      });

      it('returns an empty page when the offset is past the end', async () => {
        const result = await service.expandValueSet({ valueSet: VS_ELBOW_PROBLEMS, offset: 99 });
        expect(result.ok && result.value.concepts).toStrictEqual([]);
        expect(result.ok && result.value.total).toBe(2);
      });

      it('filters by display, case-insensitively', async () => {
        const result = await service.expandValueSet({
          valueSet: VS_ALL_PROBLEM_RELEASES,
          filter: 'LEFT',
        });
        expect(result.ok && displaysOf(result.value.concepts)).toStrictEqual([
          'Aching left elbow',
          'Bruised left knee',
        ]);
        expect(result.ok && result.value.total).toBe(2);
      });

      it('clamps a nonsensical page rather than refusing it', async () => {
        const result = await service.expandValueSet({
          valueSet: VS_ELBOW_PROBLEMS,
          offset: -5,
          limit: 0,
        });
        expect(result.ok && result.value.offset).toBe(0);
        expect(result.ok && result.value.concepts).toHaveLength(1);
      });

      it('expands a definition with no rules to nothing', async () => {
        const result = await service.expandValueSet({ valueSet: VS_NO_RULES });
        expect(result.ok && result.value.total).toBe(0);
        expect(result.ok && result.value.concepts).toStrictEqual([]);
      });

      it('fails when the value set is not configured', async () => {
        const result = await service.expandValueSet({ valueSet: VS_UNCONFIGURED });
        expect(!result.ok && result.error.kind).toBe('value_set_not_found');
      });
    });

    describe('expansion cap', () => {
      const capped = harness.create({ maxExpansionSize: 2 });

      it('refuses a database-side expansion that is larger than the cap', async () => {
        const result = await capped.expandValueSet({ valueSet: VS_ALL_PROBLEM_RELEASES });
        expect(!result.ok && result.error.kind).toBe('expansion_too_large');
        expect(!result.ok && result.error.message).toContain('maxExpansionSize');
      });

      it('refuses a merged expansion that is larger than the cap', async () => {
        const result = await capped.expandValueSet({ valueSet: VS_JOINT_PROBLEMS });
        expect(!result.ok && result.error.kind).toBe('expansion_too_large');
      });

      it('allows an expansion that exactly fills the cap', async () => {
        const result = await capped.expandValueSet({ valueSet: VS_ELBOW_PROBLEMS });
        expect(result.ok && result.value.total).toBe(2);
      });
    });

    describe('search', () => {
      it('ranks prefix matches ahead of substring matches', async () => {
        const result = await service.search({ query: 'elbow' });
        expect(result.ok && displaysOf(result.value)).toStrictEqual([
          'Elbow examination',
          'Aching elbow',
          'Aching elbow',
          'Aching left elbow',
          'Aching right elbow',
        ]);
      });

      it('ignores case', async () => {
        const upper = await service.search({ query: 'ELBOW' });
        const lower = await service.search({ query: 'elbow' });
        expect(upper.ok && displaysOf(upper.value)).toStrictEqual(
          lower.ok ? displaysOf(lower.value) : []
        );
      });

      it('scopes to one system when the caller knows it', async () => {
        const result = await service.search({ system: PROCEDURE_SYSTEM, query: 'examination' });
        expect(result.ok && displaysOf(result.value)).toStrictEqual([
          'Elbow examination',
          'Knee examination',
        ]);
      });

      it('hides retired codes from a picker unless asked for them', async () => {
        const result = await service.search({
          system: PROCEDURE_SYSTEM,
          query: 'examination',
          includeInactive: true,
        });
        expect(result.ok && displaysOf(result.value)).toStrictEqual([
          'Elbow examination',
          'Knee examination',
          'Withdrawn examination',
        ]);
      });

      it('honours the limit, keeping the best-ranked matches', async () => {
        const result = await service.search({ query: 'elbow', limit: 2 });
        expect(result.ok && displaysOf(result.value)).toStrictEqual([
          'Elbow examination',
          'Aching elbow',
        ]);
      });

      it('answers an empty box with nothing rather than everything', async () => {
        const result = await service.search({ query: '   ' });
        expect(result.ok && result.value).toStrictEqual([]);
      });

      it('answers nothing when nothing matches', async () => {
        const result = await service.search({ query: 'appendix' });
        expect(result.ok && result.value).toStrictEqual([]);
      });

      it('never invents a concept that is not in the loaded content', async () => {
        const result = await service.search({ query: 'e', limit: 100 });
        const loaded = new Set(FIXTURE_CONCEPTS.map((concept) => concept.code));
        expect(result.ok && result.value.every((concept) => loaded.has(concept.code))).toBe(true);
      });
    });
  });
}
