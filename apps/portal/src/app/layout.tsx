import { appCatalogue, createTranslator } from '@openrunic/i18n';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '@openrunic/ui/styles.css';
import './globals.css';
import { PortalChrome } from '@/components/PortalChrome';
import { AssistantProvider } from '@/components/assistant/AssistantProvider';
import { resolveLocale } from '@/lib/i18n/locale';
import { MessagesProvider } from '@/lib/i18n/messages';

/**
 * The title every tab falls back to, and the frame the route titles sit in.
 *
 * `%s` is Next's placeholder for the page title, so the template arrives from
 * the catalogue with the page name already substituted into it: which side of
 * the application name the page name sits on is a decision each language makes,
 * and a format string assembled in code would make it for all of them.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = createTranslator(appCatalogue, await resolveLocale());

  return {
    title: {
      default: t('portal.app.title'),
      template: t('portal.app.titleTemplate', { page: '%s' }),
    },
    description: t('portal.app.description'),
  };
}

/**
 * The assistant provider wraps the chrome rather than the other way round: the navigation
 * has to know whether there is an assistant before it can decide whether to link to one,
 * and the probe runs once per app load rather than once per page.
 */
export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  /* Resolved here, before the first byte. A page that renders in English and
     swaps once JavaScript arrives has shown the wrong language to the person
     least able to read it, and moved the layout under their cursor while doing
     it. `lang` follows, so assistive technology is told the truth. */
  const locale = await resolveLocale();

  return (
    <html lang={locale}>
      <body>
        <MessagesProvider locale={locale}>
          <AssistantProvider>
            <PortalChrome>{children}</PortalChrome>
          </AssistantProvider>
        </MessagesProvider>
      </body>
    </html>
  );
}
