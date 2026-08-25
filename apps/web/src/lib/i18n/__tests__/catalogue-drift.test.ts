import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { appCatalogue } from '@openrunic/i18n';
import { describe, expect, it } from 'vitest';

/**
 * EVERY KEY THIS APPLICATION ASKS FOR EXISTS.
 *
 * An unknown key renders as the key itself: `nav.patients` appears where a
 * label should be. That is deliberate, because the alternatives are worse - a
 * blank label reads as a field with no label rather than as a bug, and throwing
 * takes down a clinical screen over a typo.
 *
 * But it is still a bug, and it is one nothing else catches: type-checking
 * cannot see inside a string, and a screen with one wrong key renders fine
 * until somebody looks at the label. So the source is scanned for the keys it
 * asks for, and every one has to be in the catalogue.
 *
 * The scan is deliberately literal, and it looks for the two shapes this
 * codebase actually uses: a direct `t('some.key')` call, and a `somethingKey:
 * 'some.key'` property, which is how the navigation table and the downtime copy
 * carry keys as data so the words stay reviewable in one place.
 *
 * A key assembled at runtime is invisible to both. That is a reason not to
 * assemble keys at runtime rather than a reason for a cleverer regex: a key a
 * test cannot see is a key nobody can find when it breaks.
 *
 * ## The scan is checked in both directions, and the second one is why
 *
 * The codebase uses a third shape the scan does not see: a key as a bare string
 * value in a lookup map, where the property name is an enum member rather than
 * `somethingKey`.
 *
 *     const CLAIM_STATUS_LABEL_KEYS: Record<ClaimStatus, string> = {
 *       CAPTURED: 'billing.claimStatus.captured',
 *
 * About ninety keys are referenced only that way: claim statuses, appointment
 * statuses, ageing buckets, dunning stages, inbox streams. Those are the labels
 * that tell a clinician or a biller what state something is in, and a typo in
 * one renders a raw dotted key in a status column with nothing going red.
 *
 * Widening the pattern to "any string that looks like a key" is the obvious
 * move and it is wrong: a permission is spelled `patient.read` and a scope
 * `role.write`, so the scan would start demanding catalogue entries for things
 * that are not copy. #132 recorded the same hazard about sweeping source with a
 * loose pattern.
 *
 * Checking the other direction closes it without widening anything. Every key
 * the catalogue defines has to appear somewhere in the source, as a literal.
 * A typo in one of those maps orphans the key it meant to name, and the orphan
 * is what this reports. It has no false positives, because a key that appears
 * nowhere is a key nothing renders.
 */

const SOURCE_ROOT = join(import.meta.dirname, '../../..');

const KEY = String.raw`[a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)+`;

/** `t('key')` and `translate('key')`, single or double quoted. */
const KEY_CALL = new RegExp(
  String.raw`\b(?:t|translate)\(\s*(?<quote>['"])(?<key>${KEY})\k<quote>`,
  'gu'
);

/** `labelKey: 'key'`, `titleKey: 'key'`, and the rest of the same shape. */
const KEY_PROPERTY = new RegExp(
  String.raw`\b[a-zA-Z]*Key\s*:\s*(?<quote>['"])(?<key>${KEY})\k<quote>`,
  'gu'
);

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      found.push(...sourceFiles(path));
      continue;
    }
    if (/\.tsx?$/u.test(entry)) found.push(path);
  }
  return found;
}

function keysUsed(): Map<string, string[]> {
  const used = new Map<string, string[]>();
  for (const path of sourceFiles(SOURCE_ROOT)) {
    const text = readFileSync(path, 'utf8');
    for (const pattern of [KEY_CALL, KEY_PROPERTY]) {
      for (const match of text.matchAll(pattern)) {
        const key = match.groups?.['key'];
        if (key === undefined) continue;
        used.set(key, [...(used.get(key) ?? []), path.slice(SOURCE_ROOT.length + 1)]);
      }
    }
  }
  return used;
}

const SOURCE_MESSAGES = appCatalogue.messages[appCatalogue.sourceLocale] ?? {};

describe('the catalogue and the code agree', () => {
  it('finds the keys the application asks for', () => {
    // Guards the scanner itself. A regex that matched nothing would make every
    // assertion below pass while proving nothing, which is the failure mode of
    // every test that greps a codebase.
    expect(keysUsed().size).toBeGreaterThan(10);
  });

  it('defines every key the application asks for', () => {
    const missing = [...keysUsed().entries()]
      .filter(([key]) => SOURCE_MESSAGES[key] === undefined)
      .map(([key, files]) => `${key} (${files.join(', ')})`);

    expect(missing).toStrictEqual([]);
  });

  it('keeps every message the source catalogue defines non-empty', () => {
    // An empty source string is the blank-label failure by another route: the
    // lookup succeeds, so nothing falls back and nothing reports a gap.
    const blank = Object.entries(SOURCE_MESSAGES)
      .filter(([, text]) => text.trim() === '')
      .map(([key]) => key);

    expect(blank).toStrictEqual([]);
  });

  it('renders every key the catalogue defines', () => {
    /*
     * The other direction. This does not use `keysUsed`: the point is to catch
     * the keys that scan cannot see, so it asks the weaker question the scan is
     * not needed for - does this exact string appear anywhere in the source at
     * all - and gets a true answer for every shape.
     */
    const sources = sourceFiles(SOURCE_ROOT).map((path) => readFileSync(path, 'utf8'));
    const orphaned = Object.keys(SOURCE_MESSAGES).filter(
      (key) => !sources.some((text) => text.includes(`'${key}'`))
    );

    expect(orphaned).toStrictEqual([]);
  });

  it('gives every translation the same placeholders as its source', () => {
    // A translation that drops `{name}` loses the name and stays grammatical;
    // one that invents `{nombre}` throws at render, in that language only.
    const placeholders = (text: string): string[] =>
      [...text.matchAll(/\{(?<name>[a-zA-Z][a-zA-Z0-9_]*)\}/gu)]
        .map((match) => match.groups?.['name'] ?? '')
        .sort();

    const mismatched: string[] = [];
    for (const [locale, messages] of Object.entries(appCatalogue.messages)) {
      if (locale === appCatalogue.sourceLocale) continue;
      for (const [key, text] of Object.entries(messages)) {
        const source = SOURCE_MESSAGES[key];
        if (source === undefined) continue;
        if (placeholders(source).join() !== placeholders(text).join()) {
          mismatched.push(`${locale}:${key}`);
        }
      }
    }

    expect(mismatched).toStrictEqual([]);
  });
});
