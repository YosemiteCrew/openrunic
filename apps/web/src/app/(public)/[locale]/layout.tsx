import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { isSupportedLocale, SUPPORTED_LOCALES } from '@openrunic/i18n';
import { notFound } from 'next/navigation';

import { AppShell } from '@/app/_shell/AppShell';
import { baseMetadata } from '@/app/_shell/metadata';

/**
 * THE PUBLIC PAGES, AND WHY THEY HAVE A LOCALE IN THEIR URL.
 *
 * These four are the only routes a stranger is meant to find, and the only ones
 * that were ever worth prerendering. Resolving the reader's language from
 * `Accept-Language` means reading the request, and reading the request opts the
 * whole tree into rendering on demand - so the wiring that got the first byte
 * into the right language cost these four their prerender.
 *
 * Taking the locale from the URL instead gets both. `generateStaticParams`
 * returns the supported languages, so each page is built once per language,
 * and `<html lang>` is correct in the built output rather than decided at
 * request time. Adding a language is still a catalogue file and one line: this
 * reads `SUPPORTED_LOCALES` rather than listing them.
 *
 * The staff routes deliberately did NOT move under this segment. They are
 * dynamic whatever happens - every one of them is behind `SessionGate` and
 * fetches immediately - so a locale in the path would buy nothing, and it would
 * change every chart URL somebody has bookmarked or pasted into a ticket.
 * `(app)` keeps its own root layout and its own URLs.
 *
 * Two root layouts rather than one is what makes that possible: `<html lang>`
 * belongs to a root layout, and these two decide it from different places.
 * Everything inside `<body>` is shared, in `AppShell`.
 */
export function generateStaticParams(): { locale: string }[] {
  return SUPPORTED_LOCALES.map((locale) => ({ locale }));
}

/**
 * A stranger is meant to find these, so they opt back into indexing - the one
 * thing that separates them from every other route in this application.
 *
 * `alternates.languages` is not decoration. Prerendering one page per language
 * creates several URLs carrying the same article, and without an `hreflang`
 * pointing at each other a crawler has to guess which is canonical. The paths
 * are relative because the project has no canonical host yet, and inventing one
 * is exactly the kind of claim these pages are written to avoid.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return {
    ...baseMetadata,
    robots: { index: true, follow: true },
    alternates: {
      canonical: `/${locale}`,
      languages: Object.fromEntries(SUPPORTED_LOCALES.map((code) => [code, `/${code}`])),
    },
  };
}

export { baseViewport as viewport } from '@/app/_shell/metadata';

export default async function PublicLayout({
  children,
  params,
}: Readonly<{ children: ReactNode; params: Promise<{ locale: string }> }>) {
  const { locale } = await params;
  // A path segment is caller-supplied, so an unsupported one is a 404 rather
  // than a page rendered in a language this build has no catalogue for.
  if (!isSupportedLocale(locale)) notFound();

  return <AppShell locale={locale}>{children}</AppShell>;
}
