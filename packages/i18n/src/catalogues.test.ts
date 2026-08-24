import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { appCatalogue, catalogueAreas, SUPPORTED_LOCALES } from './catalogues/index.js';

/**
 * THE AREA FILES COMPOSE INTO ONE CATALOGUE, AND ONLY ONE OF THEM OWNS A KEY.
 *
 * The catalogues are a file per area, merged. That is what lets several screens
 * be converted at once, and it introduces two failures the single file could
 * not have. Both are silent, which is why they are tested rather than
 * documented.
 *
 * The locales come from `catalogueAreas` rather than from a list here, and the
 * last test in this file refuses the two drifting apart. A hardcoded pair was
 * the first version, and it meant a third language would have skipped every
 * guard below while the file went on looking thorough.
 */

describe.each(Object.keys(catalogueAreas))('the %s catalogue', (locale) => {
  const areas = catalogueAreas[locale] ?? {};

  /**
   * A merge takes one definition and says nothing about the other, so a key
   * defined in two areas renders text somebody else wrote, on a screen whose
   * file lost, from a diff that touched neither.
   *
   * Refused rather than ordered around. Two files claiming one key is two
   * people disagreeing about what a screen says, and the answer is to pick an
   * owner - usually `common`.
   */
  it('gives every key exactly one owner', () => {
    const owners = new Map<string, string[]>();
    for (const [area, messages] of Object.entries(areas)) {
      for (const key of Object.keys(messages)) {
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
   * what was registered, so the missing line is a red build.
   */
  it('registers every area file that exists on disk', () => {
    const onDisk = readdirSync(join(import.meta.dirname, 'catalogues', locale))
      .filter((entry) => entry.endsWith('.ts') && entry !== 'index.ts')
      .map((entry) => entry.replace(/\.ts$/u, ''))
      .sort();

    expect(Object.keys(areas).sort()).toStrictEqual(onDisk);
  });

  it('loses nothing on the way through the merge', () => {
    const fromAreas = Object.values(areas).reduce(
      (count, messages) => count + Object.keys(messages).length,
      0
    );

    expect(Object.keys(appCatalogue.messages[locale] ?? {})).toHaveLength(fromAreas);
  });
});

describe('the composed catalogues', () => {
  /**
   * The guard the split itself needs. Every assertion above passes trivially
   * against a barrel that imported nothing, which is exactly what a bad merge
   * of one of these files would leave behind.
   */
  it('carry the strings the shell already shipped', () => {
    const en = appCatalogue.messages['en'] ?? {};
    const es = appCatalogue.messages['es'] ?? {};

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
    const clinical = [
      'chart.',
      'clinical.',
      'encounter.',
      'orders.',
      'results.',
      'insurance.',
      'assistant.',
    ];

    const translated = Object.keys(spanish).filter((key) =>
      clinical.some((area) => key.startsWith(area))
    );

    expect(translated).toStrictEqual([]);
  });

  /**
   * The guard on the guards.
   *
   * Everything above is driven from `catalogueAreas`, and a locale reaching
   * `SUPPORTED_LOCALES` by some other route would be negotiable, renderable,
   * and unchecked - which is the worst of the three states to be in, because
   * the file would still read as though it covered everything.
   */
  it('guard every locale this build offers a reader', () => {
    expect(Object.keys(catalogueAreas).sort()).toStrictEqual([...SUPPORTED_LOCALES].sort());
  });
});
