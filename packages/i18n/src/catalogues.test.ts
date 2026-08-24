import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { appCatalogue, en, enAreas, es, esAreas } from './catalogues/index.js';

/**
 * THE AREA FILES COMPOSE INTO ONE CATALOGUE, AND ONLY ONE OF THEM OWNS A KEY.
 *
 * The catalogues are a spread of a file per area. That is what lets several
 * screens be converted at once, and it introduces two failures the single file
 * could not have. Both are silent, which is why they are tested rather than
 * documented.
 */

const AREAS: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  en: enAreas,
  es: esAreas,
};

describe.each(Object.keys(AREAS))('the %s catalogue composes from its areas', (locale) => {
  const areas = AREAS[locale] ?? {};

  /**
   * A spread takes the later definition and says nothing, so a key defined in
   * two areas renders text somebody else wrote, on a screen whose file lost,
   * from a diff that touched neither.
   *
   * Refused rather than ordered around. Two files claiming one key is two
   * people disagreeing about what a screen says, and the answer is to pick an
   * owner - usually `common`.
   */
  it('gives every key exactly one owner', () => {
    const owners = new Map<string, string[]>();
    for (const [area, messages] of Object.entries(areas)) {
      for (const key of Object.keys(messages as Record<string, string>)) {
        owners.set(key, [...(owners.get(key) ?? []), area]);
      }
    }

    const contested = [...owners.entries()]
      .filter(([, held]) => held.length > 1)
      .map(([key, held]) => `${key} (${held.join(', ')})`);

    expect(contested).toStrictEqual([]);
  });

  /**
   * The barrel discovers nothing, and an area file that nothing imports
   * type-checks perfectly.
   *
   * So a contributor who writes `es/chart.ts` and stops there has written a
   * language that never arrives: every clinical string goes on falling back to
   * English, which is exactly the outcome this package exists to make visible
   * rather than one to introduce. The directory is read and compared against
   * what was actually composed, so the missing import is a red build.
   */
  it('composes every area file that exists on disk', () => {
    const directory = join(import.meta.dirname, 'catalogues', locale);
    const onDisk = readdirSync(directory)
      .filter((entry) => entry.endsWith('.ts') && entry !== 'index.ts')
      .map((entry) => entry.replace(/\.ts$/u, ''))
      .sort();

    expect(Object.keys(areas).sort()).toStrictEqual(onDisk);
  });
});

describe('the composed catalogues', () => {
  it('lose nothing on the way through the spread', () => {
    const total = (areas: Readonly<Record<string, Readonly<Record<string, unknown>>>>): number =>
      Object.values(areas).reduce((count, messages) => count + Object.keys(messages).length, 0);

    expect(Object.keys(en)).toHaveLength(total(enAreas));
    expect(Object.keys(es)).toHaveLength(total(esAreas));
  });

  /**
   * The guard the split itself needs. Every assertion above passes trivially
   * against a barrel that imported nothing, which is exactly what a bad merge
   * of one of these files would leave behind.
   */
  it('carry the strings the shell already shipped', () => {
    expect(en['shell.skipToContent']).toBe('Skip to content');
    expect(en['downtime.degraded.title']).toBe('Read-only: records cannot be saved');
    expect(es['shell.skipToContent']).toBe('Saltar al contenido');
    expect(Object.keys(en).length).toBeGreaterThan(60);
    expect(Object.keys(es).length).toBeGreaterThan(40);
  });

  /**
   * Named as a fact rather than left to be noticed. The Spanish catalogue has
   * no clinical areas on purpose, and a well-meant `chart.ts` appearing there
   * without a Spanish-speaking clinician behind it is the thing this refuses.
   */
  it('leave the clinical areas untranslated', () => {
    const spanish = appCatalogue.messages['es'] ?? {};
    const clinical = ['chart.', 'encounter.', 'orders.', 'results.', 'insurance.', 'assistant.'];

    const translated = Object.keys(spanish).filter((key) =>
      clinical.some((area) => key.startsWith(area))
    );

    expect(translated).toStrictEqual([]);
  });
});
