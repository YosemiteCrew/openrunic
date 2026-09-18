'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { AssistantProvider } from '@/components/assistant/AssistantProvider';
import { isLiveMode } from '@/lib/api/config';
import { SIGN_IN_PATH } from '@/lib/auth/routes';

import { PortalChrome } from './PortalChrome';
import { PortalSessionBoundary } from './PortalSessionBoundary';

export function PortalFrame({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname();
  if (isLiveMode() && pathname === SIGN_IN_PATH) return <>{children}</>;
  return (
    <PortalSessionBoundary>
      <AssistantProvider>
        <PortalChrome>{children}</PortalChrome>
      </AssistantProvider>
    </PortalSessionBoundary>
  );
}
