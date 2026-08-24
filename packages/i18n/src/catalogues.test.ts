import { describe, expect, it } from 'vitest';

import { appCatalogue, en, enAreas } from './catalogues/index.js';

/**
 * THE AREA FILES COMPOSE INTO ONE CATALOGUE, AND ONLY ONE OF THEM OWNS A KEY.
 *
 * The source catalogue is a spread of a file per area. That is what lets
 * several screens be converted at once, and it introduces one failure the
 * single file could not have: two areas defining the same key. The spread takes
 * the later one and says nothing, so the screen whose file lost renders text
 * somebody else wrote and the diff that caused it touched neither screen.
 *
 * Refused rather than ordered around. Two files claiming one key is two people
 * disagreeing about what a screen says, and the answer is to pick an owner -
 * usually `common`.
 */
describe('the source catalogue composes from its areas', () => {
  it('gives every key exactly one owner', () => {
    const owners = new Map<string, string[]>();
    for (const [area, messages] of Object.entries(enAreas)) {
      for (const key of Object.keys(messages)) {
        owners.set(key, [...(owners.get(key) ?? []), area]);
      }
    }

    const contested = [...owners.entries()]
      .filter(([, areas]) => areas.length > 1)
      .map(([key, areas]) => `${key} (${areas.join(', ')})`);

    expect(contested).toStrictEqual([]);
  });

  it('loses nothing on the way through the spread', () => {
    const fromAreas = Object.values(enAreas).reduce((count, messages) => {
      return count + Object.keys(messages).length;
    }, 0);

    expect(Object.keys(en)).toHaveLength(fromAreas);
  });

  /**
   * The guard the split itself needs. Every assertion above passes trivially
   * against a barrel that imported nothing, which is exactly what a bad merge
   * of this file would leave behind.
   */
  it('carries the strings the shell already shipped', () => {
    expect(en['shell.skipToContent']).toBe('Skip to content');
    expect(en['downtime.degraded.title']).toBe('Read-only: records cannot be saved');
    expect(Object.keys(en).length).toBeGreaterThan(60);
  });

  /**
   * Named as a fact rather than left to be noticed. The Spanish catalogue has
   * no clinical areas on purpose, and a well-meant `chart.ts` appearing there
   * without a Spanish-speaking clinician behind it is the thing this refuses.
   */
  it('leaves the clinical areas untranslated', () => {
    const spanish = appCatalogue.messages['es'] ?? {};
    const clinical = ['chart.', 'encounter.', 'orders.', 'results.', 'insurance.', 'assistant.'];

    const translated = Object.keys(spanish).filter((key) =>
      clinical.some((area) => key.startsWith(area))
    );

    expect(translated).toStrictEqual([]);
  });
});
