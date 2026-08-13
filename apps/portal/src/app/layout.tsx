import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { PortalChrome } from '@/components/PortalChrome';

/* The library stylesheet is served from public/ rather than imported, because it carries
   @font-face rules pointing at font binaries the package deliberately does not ship. A
   bundler asked to resolve those URLs fails the build; a browser asked to fetch them falls
   back to the system stacks, which is the degradation the library documents.
   `scripts/copy-ui-styles.mjs` puts it there on dev and build. */

export const metadata: Metadata = {
  title: {
    default: 'Patient portal',
    template: '%s - patient portal',
  },
  description: 'See your appointments, health record, messages, forms and bills.',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      {/* eslint's no-css-tags rule wants this imported instead. It cannot be: see the note
          above. The warning is the honest cost of consuming the library as documented. */}
      <head>
        <link href="/styles.css" rel="stylesheet" />
      </head>
      <body>
        <PortalChrome>{children}</PortalChrome>
      </body>
    </html>
  );
}
