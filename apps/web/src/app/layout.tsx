import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { SessionGate } from '@/lib/auth/SessionGate';

// Order matters: the design system first, then the app's own layer, so the
// shell can win ties against the library's element selectors.
import '@openrunic/ui/styles.css';
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

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {/* First stop in the tab order on every page. It is visually hidden
            until focused, then it lands on the shell's <main>. */}
        <a className="or-skip-link" href="#main-content">
          Skip to content
        </a>
        {/* Holds a clinical screen back until the token from the session cookie
            is in memory, and takes both away when the workstation goes quiet.
            Public routes pass straight through it. */}
        <SessionGate>{children}</SessionGate>
      </body>
    </html>
  );
}
