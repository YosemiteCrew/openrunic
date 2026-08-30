import { appCatalogue, createTranslator } from '@openrunic/i18n';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { AppShell } from '@/app/_shell/AppShell';
import { baseMetadata } from '@/app/_shell/metadata';
import { resolveLocale } from '@/lib/i18n/locale';

/**
 * EVERY ROUTE THAT IS NOT ONE OF THE FOUR PUBLIC PAGES.
 *
 * The staff EMR and the sign-in screen. These take the reader's language from
 * the request - a cookie they set, then `Accept-Language` - which reads
 * `headers()` and therefore renders on demand.
 *
 * That is close to free here, and it is worth saying why rather than leaving it
 * to be rediscovered. Every route under this layout sits behind `SessionGate`,
 * which holds the screen back until a token is in memory; their prerendered
 * output was an empty shell that immediately fetched. Server-rendering an empty
 * shell on demand costs about what serving a built one did.
 *
 * The four pages where it was not free are under `(public)/[locale]`, which
 * takes the locale from the URL and prerenders once per language. Two root
 * layouts rather than one is what lets the two answer that question
 * differently: `<html lang>` belongs to a root layout. Everything inside
 * `<body>` is shared, in `AppShell`.
 *
 * These URLs deliberately did not gain a locale prefix. A chart URL is
 * bookmarked, pasted into tickets and mailed between colleagues, and moving
 * every one of them to buy a prerender these routes cannot use would be a cost
 * with nothing on the other side of it.
 */
export { baseViewport as viewport } from '@/app/_shell/metadata';

/**
 * The application's description, in the reader's language.
 *
 * A route that writes its own overrides this; most do not, so this is what a
 * bookmark of the schedule or the inbox carries. It is a function rather than a
 * constant for the same reason the layout below is: the language comes from the
 * request.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = createTranslator(appCatalogue, await resolveLocale());
  return { ...baseMetadata, description: t('shell.metaDescription') };
}

export default async function AppLayout({ children }: Readonly<{ children: ReactNode }>) {
  // Resolved here, before the first byte. A page that renders in English and
  // swaps to Spanish once JavaScript arrives has shown the wrong language to
  // the person least able to read it, and moved the layout under their cursor
  // while doing it.
  const locale = await resolveLocale();

  return <AppShell locale={locale}>{children}</AppShell>;
}
