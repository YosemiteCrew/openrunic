import { describe, expect, it } from 'vitest';

import {
  coverageOf,
  format,
  formatCount,
  formatProblems,
  isUnknown,
  localeChain,
  lookup,
  plural,
  staleKeys,
  verbatim,
  type Catalogue,
} from './index.js';

const CATALOGUE: Catalogue = {
  sourceLocale: 'en',
  messages: {
    en: {
      'allergy.severity': 'Severity',
      'dose.instruction': 'Give {dose} mg',
      'patient.name': 'Name',
    },
    es: { 'allergy.severity': 'Gravedad' },
    'es-MX': { 'patient.name': 'Nombre' },
  },
};

describe('finding a message', () => {
  it('answers from the locale asked for when it has one', () => {
    const found = lookup(CATALOGUE, 'es', 'allergy.severity');

    expect(isUnknown(found)).toBe(false);
    expect(found).toEqual({ text: 'Gravedad', locale: 'es', fellBack: false });
  });

  /**
   * The chain is the reason storing a region is worth anything. A Mexican
   * Spanish speaker reading Castilian Spanish is reading their own language
   * with unfamiliar word choices; reading English is not.
   */
  it('falls to the language before it falls to the source', () => {
    expect(localeChain('es-MX', 'en')).toEqual(['es-MX', 'es', 'en']);

    const found = lookup(CATALOGUE, 'es-MX', 'allergy.severity');

    expect(found).toEqual({ text: 'Gravedad', locale: 'es', fellBack: true });
  });

  /**
   * A missing translation renders in the source language, never as nothing.
   *
   * An empty label does not read as broken - it reads as a field with no label,
   * and the value beside it becomes unattributed. On a medication list that is
   * a dose with nothing saying what it is a dose of.
   */
  it('renders the source language rather than a blank, and says that it did', () => {
    const found = lookup(CATALOGUE, 'es', 'dose.instruction');

    expect(found).toEqual({ text: 'Give {dose} mg', locale: 'en', fellBack: true });
  });

  /**
   * An untranslated key is a translation job; an unknown key is a bug in the
   * code that asked for it. Rendering both the same way is how a typo survives
   * to production looking like a translation backlog.
   */
  it('distinguishes a key nobody has translated from a key nobody has', () => {
    const missing = lookup(CATALOGUE, 'es', 'no.such.key');

    expect(isUnknown(missing)).toBe(true);
    expect(missing).toEqual({ unknown: true, key: 'no.such.key' });
  });

  it('does not repeat a locale whose language part is itself', () => {
    expect(localeChain('en', 'en')).toEqual(['en']);
  });
});

describe('measuring coverage', () => {
  /**
   * Measured rather than declared, because a declared number drifts the moment
   * a source string is added - every new key is missing in every locale by
   * definition, and the figure that says so should move on its own.
   */
  it('counts what a locale has against the source, and names what it lacks', () => {
    expect(coverageOf(CATALOGUE, 'es')).toEqual({
      locale: 'es',
      translated: 1,
      total: 3,
      missing: ['dose.instruction', 'patient.name'],
    });
  });

  it('reports a locale nobody has started as covering nothing, not as absent', () => {
    expect(coverageOf(CATALOGUE, 'fr').translated).toBe(0);
    expect(coverageOf(CATALOGUE, 'fr').total).toBe(3);
  });

  /**
   * A translation the source can no longer reach, almost always a renamed key.
   * Surfaced rather than deleted: it is somebody's work, and it usually wants
   * moving to the new key rather than retranslating.
   */
  it('finds a translation the source has no key for', () => {
    const renamed: Catalogue = {
      sourceLocale: 'en',
      messages: { en: { 'patient.name': 'Name' }, es: { 'patient.fullName': 'Nombre' } },
    };

    expect(staleKeys(renamed, 'es')).toEqual(['patient.fullName']);
  });
});

/**
 * The two kinds of number, and the rule that tells them apart: localise what is
 * measured, render verbatim what is matched.
 */
describe('verbatim', () => {
  it('renders a number the reader will compare exactly as it is stored', () => {
    // The whole reason it is not formatCount. A form version, an audit sequence
    // number or a claim number is read back, pasted and searched for, so a
    // locale that regroups the digits has changed the identity rather than the
    // presentation.
    //
    // English is the shorter demonstration and Spanish is the one that shows it
    // is not about the separator: `es` carries minimumGroupingDigits 2, so it
    // leaves four digits alone and groups from five. A worked example at 1234
    // shows nothing in `es` at all, which is worth knowing before quoting one.
    expect(formatCount(1234, 'en')).toBe('1,234');
    expect(formatCount(12345, 'es')).toBe('12.345');
    expect(verbatim(1234)).toBe('1234');
    expect(verbatim(12345)).toBe('12345');
  });

  it('passes a string through untouched', () => {
    expect(verbatim('MRN-000123')).toBe('MRN-000123');
  });

  it('refuses a number that is not finite', () => {
    expect(() => verbatim(Number.NaN)).toThrow(/finite number/u);
    expect(() => verbatim(Number.POSITIVE_INFINITY)).toThrow(/finite number/u);
  });
});

describe('filling in the values', () => {
  it('puts the value where the placeholder was', () => {
    expect(format('Give {dose} mg', { dose: 500 }, 'dose.instruction')).toBe('Give 500 mg');
  });

  /**
   * The failure this file exists to prevent. "Give {dose} mg" without a dose
   * becomes "Give  mg" wherever a missing value is treated as an empty string:
   * nothing throws, the sentence is still grammatical, and the number that made
   * it an instruction is gone.
   */
  it('refuses a message whose placeholder has no value', () => {
    expect(() => format('Give {dose} mg', {}, 'dose.instruction')).toThrow(
      /placeholder \{dose\} and no value/u
    );
  });

  it('refuses a count that is not a number rather than writing the word NaN', () => {
    expect(String(Number.NaN), 'what would otherwise be rendered').toBe('NaN');
    expect(() => format('Give {dose} mg', { dose: Number.NaN }, 'dose.instruction')).toThrow(
      /not a number/u
    );
  });

  /**
   * A value nobody asked for is usually a renamed placeholder - so the message
   * is missing one and silently dropping the other, and the pair is the signal.
   */
  it('reports a value the message does not use', () => {
    expect(formatProblems('Give {dose} mg', { dose: 5, route: 'oral' }, 'k')).toContain(
      'k was given a value for {route}, which the message does not use.'
    );
  });

  it('leaves a brace that is not a placeholder alone', () => {
    expect(format('A { b } c', {}, 'k')).toBe('A { b } c');
  });
});

describe('plurals', () => {
  const forms = { one: '{n} allergy', other: '{n} allergies' };

  it("uses the locale's rules rather than n === 1", () => {
    expect(plural(forms, 1, 'en')).toBe('{n} allergy');
    expect(plural(forms, 2, 'en')).toBe('{n} allergies');
    // Zero is `other` in English, which `n === 1` also gets right, and 0.5 is
    // `other` too - which it does not.
    expect(plural(forms, 0.5, 'en')).toBe('{n} allergies');
  });

  /**
   * English has two forms and is why everybody writes `n === 1`. Polish has
   * four, and the failure is not a crash: it is a sentence that reads as broken
   * to a native speaker and fine to whoever shipped it.
   */
  it('selects a category English does not have', () => {
    const polish = { one: 'jeden', few: 'kilka', many: 'wiele', other: 'inne' };

    expect(plural(polish, 1, 'pl')).toBe('jeden');
    expect(plural(polish, 3, 'pl')).toBe('kilka');
    expect(plural(polish, 5, 'pl')).toBe('wiele');
  });

  it('falls to other when the catalogue lacks the category the rules picked', () => {
    expect(plural({ other: 'inne' }, 3, 'pl')).toBe('inne');
  });

  /**
   * The case the obvious guard misses.
   *
   * `new Intl.PluralRules('zz')` does not throw - it accepts any well-formed
   * tag and quietly uses root rules, which have only `other`. So a locale
   * nobody has rules for produces a sentence with no plural agreement at all,
   * and only a malformed tag throws, which was never the hazard.
   */
  it.each(['zz', 'not-a-locale', 'xx-YY'])(
    'refuses %s, which Intl accepts and then silently gives root rules',
    (unsupported) => {
      expect(
        () => new Intl.PluralRules(unsupported),
        'the constructor this guard cannot rely on'
      ).not.toThrow();
      expect(() => plural(forms, 1, unsupported)).toThrow(
        /not a locale this runtime has plural rules for/u
      );
    }
  );

  it('accepts a locale the runtime does have rules for', () => {
    expect(plural(forms, 1, 'es-MX')).toBe('{n} allergy');
  });

  it('refuses a count that is not one', () => {
    expect(() => plural(forms, Number.NaN, 'en')).toThrow(/needs a count/u);
  });

  /**
   * The form and the digits are two different locale decisions. A catalogue
   * interpolating a raw `String(count)` gets the grammar right and the numerals
   * wrong.
   */
  it('writes the number the way the locale writes numbers', () => {
    expect(formatCount(1234.5, 'en-US')).toBe('1,234.5');
    expect(formatCount(1234.5, 'de-DE')).toBe('1.234,5');
  });
});

describe('the edges a catalogue actually has', () => {
  /**
   * A catalogue whose source locale has no messages at all. Real during a
   * migration, and the coverage figure has to be zero-of-zero rather than a
   * division nobody can read.
   */
  it('reports nothing to translate when the source is empty', () => {
    const bare: Catalogue = { sourceLocale: 'en', messages: {} };

    expect(coverageOf(bare, 'es')).toEqual({
      locale: 'es',
      translated: 0,
      total: 0,
      missing: [],
    });
    expect(staleKeys(bare, 'es')).toEqual([]);
  });

  it('finds no stale keys for a locale that has none of its own', () => {
    expect(staleKeys(CATALOGUE, 'fr')).toEqual([]);
  });

  /**
   * A bare language tag has no region to strip, so the chain must not contain
   * it twice - a duplicate would make the second lookup a wasted read and, more
   * to the point, make `fellBack` wrong for the source language itself.
   */
  it('does not put a locale in the chain twice when it is also the source', () => {
    expect(localeChain('es', 'es')).toEqual(['es']);
    expect(localeChain('', 'en')).toEqual(['en']);
  });

  it('refuses a count it cannot write, rather than writing Infinity', () => {
    expect(() => formatCount(Number.POSITIVE_INFINITY, 'en')).toThrow(/must be a number/u);
  });
});
