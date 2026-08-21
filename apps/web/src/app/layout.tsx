import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { appCatalogue, createTranslator } from '@openrunic/i18n';

import { SessionGate } from '@/lib/auth/SessionGate';
import { resolveLocale } from '@/lib/i18n/locale';
import { MessagesProvider } from '@/lib/i18n/messages';

// Order matters: the design system first, then the app's own layer, so the
// shell can win ties against the library's element selectors.
import '@openrunic/ui/styles.css';

import { ConnectivityProvider, DowntimeBanner, DowntimeBoundary } from '@/components/downtime';
import './globals.css';
/* The sign-in surface. It is imported here rather than in the `(auth)` group
   because `SessionGate` renders its holding notice on protected routes, which
   never pass through that group's layout, and a notice that arrives unstyled is
   a flash of unstyled text on every reload of a chart. */
import './(auth)/auth.css';

export const metadata: Metadata = {
  title: {
    default: 'openrunic',
    /**
     * Screens set their own `title`. Chart screens use "PATIENTSSON, Testina -
     * Chart": two browser tabs on two patients must be impossible to confuse.
     */
    template: '%s - openrunic',
  },
  description: 'Open-source operating system for human health',
  applicationName: 'openrunic',
  // The staff EMR is an internal tool behind auth; it has no business in a
  // search index, and a chart URL certainly does not.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  // Bone, so the browser chrome matches the page rather than flashing white.
  themeColor: '#f5efe6',
};

/**
 * The downtime wrappers live in the root layout, not in individual screens.
 *
 * Both failures they cover - the records database going away, and a screen
 * throwing during render - can happen on any route, and the outcome without
 * them is a white page or a stack trace in front of a patient. Putting them
 * here means no future screen has to remember.
 */
export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  // Resolved here, before the first byte. A page that renders in English and
  // swaps to Spanish once JavaScript arrives has shown the wrong language to
  // the person least able to read it, and moved the layout under their cursor
  // while doing it.
  const locale = await resolveLocale();
  // This layout is a server component, so it renders its own strings directly
  // rather than through the hook the client components use.
  const t = createTranslator(appCatalogue, locale);

  return (
    <html lang={locale}>
      <body>
        {/* First stop in the tab order on every page. It is visually hidden
            until focused, then it lands on the shell's <main>. */}
        <a className="or-skip-link" href="#main-content">
          {t('shell.skipToContent')}
        </a>
        {/* The order here is the design, not an accident.

            ConnectivityProvider is outermost so every screen can read the
            connection state, and the banner sits above the gate so a receptionist
            staring at a sign-in form still learns the server is unreachable
            rather than concluding they typed their password wrong.

            DowntimeBoundary wraps the gate rather than sitting inside it, so a
            render error thrown while deciding whether someone is signed in is
            still caught and still shows a calm page instead of a stack trace.

            SessionGate is innermost: it holds a clinical screen back until the
            token from the session cookie is in memory, and takes both away when
            the workstation goes quiet. Public routes pass straight through.

            MessagesProvider is outside all of them, because the downtime notices
            and the sign-in screen both need a language and both render before
            there is a session to read one from. */}
        <MessagesProvider locale={locale}>
          <ConnectivityProvider>
            <DowntimeBanner />
            <DowntimeBoundary>
              <SessionGate>{children}</SessionGate>
            </DowntimeBoundary>
          </ConnectivityProvider>
        </MessagesProvider>
      </body>
    </html>
  );
}
