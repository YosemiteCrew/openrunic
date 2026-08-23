import type { ReactNode } from 'react';

import { appCatalogue, createTranslator, type Locale } from '@openrunic/i18n';

import { ConnectivityProvider, DowntimeBanner, DowntimeBoundary } from '@/components/downtime';
import { SessionGate } from '@/lib/auth/SessionGate';
import { MessagesProvider } from '@/lib/i18n/messages';

// Order matters: the design system first, then the app's own layer, so the
// shell can win ties against the library's element selectors.
import '@openrunic/ui/styles.css';

import '../globals.css';
/* The sign-in surface. It is imported here rather than in the `(auth)` group
   because `SessionGate` renders its holding notice on protected routes, which
   never pass through that group's layout, and a notice that arrives unstyled is
   a flash of unstyled text on every reload of a chart.

   Here rather than in either root layout because both need it and there are now
   two: the notice appears on staff routes, and the stylesheet has to be in the
   built CSS for the public pages too or the first paint of a downtime notice is
   unstyled. */
import '../(app)/(auth)/auth.css';

/**
 * The document, and everything every page is wrapped in.
 *
 * This exists because there are two root layouts rather than one. The public
 * pages take their locale from the URL, which is what lets them prerender once
 * per language; every other route takes it from the request, which cannot. A
 * root layout owns `<html lang>`, so the two cannot share one - but they must
 * share everything inside `<body>`, or the shell drifts between the sign-in
 * screen and the page a stranger lands on.
 *
 * So the difference between them is exactly one argument: where the locale came
 * from. Everything else is here.
 *
 * The downtime wrappers live at this level rather than in individual screens.
 * Both failures they cover - the records database going away, and a screen
 * throwing during render - can happen on any route, and the outcome without
 * them is a white page or a stack trace in front of a patient. Putting them
 * here means no future screen has to remember.
 */
export function AppShell({ locale, children }: Readonly<{ locale: Locale; children: ReactNode }>) {
  // This is a server component, so it renders its own strings directly rather
  // than through the hook the client components use.
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
