import { describe, expect, it } from 'vitest';

import { planUpgrade } from './upgrade-plan.js';

/**
 * The upgrade decision, tested in isolation.
 *
 * This function decides whether a release can be applied while the clinic is
 * seeing patients. It is the one piece of judgement in the upgrade path, so it
 * lives outside the shell orchestration where it can be proved.
 */

const expand = (name: string) => ({ name, classification: 'expand' as const });
const contract = (name: string) => ({ name, classification: 'contract' as const });

describe('planUpgrade', () => {
  it('takes the zero-downtime path when nothing is pending', () => {
    const plan = planUpgrade(['1_a'], [expand('1_a')]);

    expect(plan.path).toBe('zero-downtime');
    expect(plan.pending).toEqual([]);
    expect(plan.reason).toContain('already current');
  });

  it('takes the zero-downtime path when every pending migration is additive', () => {
    const plan = planUpgrade(['1_a'], [expand('1_a'), expand('2_b'), expand('3_c')]);

    expect(plan.path).toBe('zero-downtime');
    expect(plan.pending).toEqual(['2_b', '3_c']);
    expect(plan.destructive).toEqual([]);
  });

  it('demands a maintenance window when a pending migration is destructive', () => {
    const plan = planUpgrade(['1_a'], [expand('1_a'), expand('2_b'), contract('3_c')]);

    expect(plan.path).toBe('maintenance-window');
    expect(plan.destructive).toEqual(['3_c']);
    expect(plan.reason).toContain('maintenance window');
  });

  it('ignores a destructive migration that has already been applied', () => {
    // It ran in a previous release. Its damage is done and its risk is spent;
    // holding this upgrade for it would be superstition.
    const plan = planUpgrade(['1_a', '2_b'], [expand('1_a'), contract('2_b'), expand('3_c')]);

    expect(plan.path).toBe('zero-downtime');
    expect(plan.pending).toEqual(['3_c']);
  });

  it('names every destructive migration, not just the first', () => {
    const plan = planUpgrade([], [contract('1_a'), expand('2_b'), contract('3_c')]);

    expect(plan.destructive).toEqual(['1_a', '3_c']);
  });

  it('treats a first install, with nothing applied, as additive', () => {
    const plan = planUpgrade([], [expand('1_a'), expand('2_b')]);

    expect(plan.path).toBe('zero-downtime');
    expect(plan.pending).toEqual(['1_a', '2_b']);
  });
});
