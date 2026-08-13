import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '@openrunic/ui/styles.css';
import './globals.css';
import { PortalChrome } from '@/components/PortalChrome';

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
      <body>
        <PortalChrome>{children}</PortalChrome>
      </body>
    </html>
  );
}
