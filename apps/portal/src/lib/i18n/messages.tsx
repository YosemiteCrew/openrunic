'use client';

import { appCatalogue, createTranslator, type Translator } from '@openrunic/i18n';
import { createContext, useContext, useMemo, type ReactNode } from 'react';

/**
 * The translator, for the client components that are most of this application.
 *
 * The locale is resolved on the server and handed down through this provider
 * rather than negotiated again in the browser. Negotiating twice is how the
 * server renders one language and the client hydrates into another, which React
 * reports as a hydration mismatch and a reader experiences as the page changing
 * language under them.
 *
 * This is the same shape as `apps/web`'s provider and is deliberately a second
 * copy rather than a shared one. The rule about *which* language - the part with
 * a security consequence, because the cookie is attacker-writable - is shared,
 * in `@openrunic/i18n`. What is duplicated is thirty lines of React context, and
 * putting those in a package would mean `packages/i18n` growing a React
 * dependency for two consumers.
 */

const TranslatorContext = createContext<Translator | null>(null);

export function MessagesProvider({
  locale,
  children,
}: Readonly<{ locale: string; children: ReactNode }>) {
  // Memoised on the locale, because a translator carries the list of fallbacks
  // it has recorded and rebuilding it every render would throw that away.
  const translator = useMemo(() => createTranslator(appCatalogue, locale), [locale]);

  return <TranslatorContext.Provider value={translator}>{children}</TranslatorContext.Provider>;
}

/**
 * The translator for the current reader.
 *
 * Throws when there is no provider above it, rather than falling back to the
 * source language. A component rendering outside the provider is a wiring
 * mistake, and quietly rendering English would hide it until somebody who reads
 * Spanish opened that screen - which on this application is a patient looking at
 * their own record.
 */
export function useTranslator(): Translator {
  const translator = useContext(TranslatorContext);
  if (translator === null) {
    throw new Error('useTranslator was called outside MessagesProvider.');
  }
  return translator;
}
