import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '@openrunic/ui/styles.css';
import './globals.css';
import { PortalChrome } from '@/components/PortalChrome';
import { AssistantProvider } from '@/components/assistant/AssistantProvider';

export const metadata: Metadata = {
  title: {
    default: 'Patient portal',
    template: '%s - patient portal',
  },
  description: 'See your appointments, health record, messages, forms and bills.',
};

/**
 * The assistant provider wraps the chrome rather than the other way round: the navigation
 * has to know whether there is an assistant before it can decide whether to link to one,
 * and the probe runs once per app load rather than once per page.
 */
export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <AssistantProvider>
          <PortalChrome>{children}</PortalChrome>
        </AssistantProvider>
      </body>
    </html>
  );
}
