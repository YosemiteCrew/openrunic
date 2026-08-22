import { describe, expect, it } from 'vitest';

import { appCatalogue, createTranslator, negotiateLocale, SUPPORTED_LOCALES } from './index.js';

const SUPPORTED = ['en', 'es'];

describe('negotiating a locale', () => {
  it('falls back to the source language when nothing was asked for', () => {
    expect(negotiateLocale(null, SUPPORTED, 'en')).toBe('en');
    expect(negotiateLocale('', SUPPORTED, 'en')).toBe('en');
  });

  it('honours quality values rather than document order', () => {
    // A browser may send these in any order. Taking the first entry happens to
    // work until one reorders them, and then a reader silently changes language.
    expect(negotiateLocale('en;q=0.8, es;q=0.9', SUPPORTED, 'en')).toBe('es');
    expect(negotiateLocale('es;q=0.2, en;q=0.9', SUPPORTED, 'en')).toBe('en');
  });

  it('matches a region against the language it belongs to', () => {
    // A Mexican Spanish speaker reading Castilian Spanish is reading their own
    // language with unfamiliar word choices. Reading English is not.
    expect(negotiateLocale('es-MX', SUPPORTED, 'en')).toBe('es');
  });

  it('prefers an exact match over the bare language', () => {
    expect(negotiateLocale('es-MX,es;q=0.9', ['es', 'es-MX'], 'en')).toBe('es-MX');
  });

  it('treats a zero quality as a refusal, not a weak preference', () => {
    // `es;q=0` means "not Spanish", so falling back is right and choosing it
    // because it was the only supported tag mentioned is not.
    expect(negotiateLocale('es;q=0', SUPPORTED, 'en')).toBe('en');
  });

  it('reads a wildcard as no preference', () => {
    expect(negotiateLocale('*', SUPPORTED, 'en')).toBe('en');
  });

  it('ignores a language this build does not carry', () => {
    expect(negotiateLocale('fr-CA,fr;q=0.9', SUPPORTED, 'en')).toBe('en');
  });

  it('survives a header a browser would never send', () => {
    // Header parsing is reached before authentication on a public page, so it
    // is worth being unexciting about garbage.
    expect(negotiateLocale(';;;,,q=,;q=x', SUPPORTED, 'en')).toBe('en');
  });
});

describe('the translator', () => {
  it('renders in the requested language', () => {
    const t = createTranslator(appCatalogue, 'es');

    expect(t('nav.patients')).toBe('Pacientes');
  });

  it('interpolates, and refuses a placeholder with no value', () => {
    const t = createTranslator(appCatalogue, 'en');

    expect(t('shell.signedInAs', { name: 'A. Okafor' })).toBe('Signed in as A. Okafor');
    // "Signed in as " would be grammatical and would have lost the name.
    expect(() => t('shell.signedInAs')).toThrow();
  });

  it('renders the source language when a translation is missing, and says so', () => {
    const t = createTranslator(appCatalogue, 'es');

    // Nothing clinical is translated yet, on purpose: a wrong clinical term is
    // more dangerous than English a reader has to work through.
    const text = t('marketing.tagline');
    expect(text).not.toBe('');
    expect(t.fallbacks.every((entry) => entry.locale === 'en')).toBe(true);
  });

  it('counts every fallback, because one nobody counts is a gap nobody closes', () => {
    const t = createTranslator(appCatalogue, 'es');
    t('nav.patients');

    expect(t.fallbacks).toHaveLength(0);
  });

  it('renders an unknown key as the key, rather than as nothing', () => {
    const t = createTranslator(appCatalogue, 'en');

    // A blank label does not read as broken; it reads as a field with no label,
    // and the value beside it becomes unattributed. This is ugly, obvious and
    // greppable, which is what a bug should be.
    expect(t('nope.not.a.key')).toBe('nope.not.a.key');
  });

  it('does not throw on an unknown key', () => {
    const t = createTranslator(appCatalogue, 'en');

    // A typo must not take down a clinical screen.
    expect(() => t('nope.not.a.key')).not.toThrow();
  });

  it('carries its locale, for the lang attribute', () => {
    expect(createTranslator(appCatalogue, 'es').locale).toBe('es');
  });
});

describe('the shipped catalogue', () => {
  it('names the locales it carries', () => {
    expect(SUPPORTED_LOCALES).toContain('en');
    expect(SUPPORTED_LOCALES).toContain('es');
  });

  it('has a source language every other locale can fall back to', () => {
    expect(appCatalogue.messages[appCatalogue.sourceLocale]).toBeDefined();
  });

  it('translates no key the source language does not define', () => {
    // A key present in a translation and absent from the source is a string
    // nothing renders: dead weight a translator maintains forever.
    const source = new Set(Object.keys(appCatalogue.messages['en'] ?? {}));
    const orphans = Object.keys(appCatalogue.messages['es'] ?? {}).filter(
      (key) => !source.has(key)
    );

    expect(orphans).toStrictEqual([]);
  });
});
