import { describe, expect, it } from 'vitest';

import { LOCALE_COOKIE, localeFrom, readLocaleCookie } from './choice.js';

/**
 * THE CHOICE COOKIE, WHICH IS ATTACKER-WRITABLE AND REACHES AN ATTRIBUTE.
 *
 * This was covered indirectly, through the proxy and the root layout of one
 * application. Moving it here made that visible: the rule now has two callers in
 * two applications and none of them is where it should be tested.
 *
 * The value it returns reaches `<html lang>` and a catalogue lookup. A cookie is
 * written by whoever holds the browser, so what matters is not that it picks the
 * right supported locale - it is that it picks nothing else.
 */

describe('reading the language somebody chose', () => {
  it('finds the choice among other cookies, wherever it sits', () => {
    expect(readLocaleCookie('or_locale=es')).toBe('es');
    expect(readLocaleCookie('a=1; or_locale=es; b=2')).toBe('es');
    expect(readLocaleCookie(' or_locale=es ; other=x')).toBe('es');
  });

  it('answers null when nobody has chosen', () => {
    expect(readLocaleCookie(null)).toBeNull();
    expect(readLocaleCookie('')).toBeNull();
    expect(readLocaleCookie('other=x; another=y')).toBeNull();
  });

  it('refuses anything this build does not carry, however it is spelled', () => {
    // The whole reason the rule is shared rather than copied. A second copy is a
    // second place for this check to be dropped, and dropping it does not give a
    // reader the wrong language - it puts arbitrary text into an attribute.
    expect(readLocaleCookie('or_locale=fr')).toBeNull();
    expect(readLocaleCookie('or_locale=EN')).toBeNull();
    expect(readLocaleCookie('or_locale=')).toBeNull();
    expect(readLocaleCookie('or_locale=en-US')).toBeNull();
  });

  it('refuses a percent-encoded value that decodes to something unsupported', () => {
    // `%22` is a quote. Decoded and unchecked it would close the attribute.
    expect(readLocaleCookie(`${LOCALE_COOKIE}=%22%20onload%3Dalert(1)`)).toBeNull();
    // Decoding happens before the check, so an encoded supported value is still one.
    expect(readLocaleCookie(`${LOCALE_COOKIE}=%65%73`)).toBe('es');
  });

  it('is not fooled by a cookie whose name merely ends with the right word', () => {
    expect(readLocaleCookie('not_or_locale=es')).toBeNull();
  });
});

describe('deciding what language to render in', () => {
  it('takes the choice over the browser, because a person said so', () => {
    expect(localeFrom('or_locale=es', 'en-GB,en;q=0.9')).toBe('es');
  });

  it('falls back to what the browser asked for when nobody has chosen', () => {
    expect(localeFrom(null, 'es-MX,es;q=0.9,en;q=0.8')).toBe('es');
  });

  it('honours the quality values rather than the order they arrive in', () => {
    // A browser is free to reorder these, and taking the first entry happens to
    // work only until one does.
    expect(localeFrom(null, 'en;q=0.8, es;q=0.9')).toBe('es');
  });

  it('falls back to the source language when it has nothing to go on', () => {
    expect(localeFrom(null, null)).toBe('en');
    expect(localeFrom('other=x', 'fr,de;q=0.9')).toBe('en');
  });

  it('ignores a rejected choice rather than treating it as one', () => {
    // `q=0` is a refusal, not a weak preference, and an unsupported cookie is
    // not a choice at all - so this reader gets what their browser will accept.
    expect(localeFrom('or_locale=fr', 'es;q=0.9, en;q=0')).toBe('es');
  });
});
