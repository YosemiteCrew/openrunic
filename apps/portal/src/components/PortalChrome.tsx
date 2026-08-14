'use client';

/**
 * Binds the shell to the signed-in patient, and to whether this practice has an assistant.
 *
 * The shell itself is a pure layout component, which keeps it trivial to render in a test
 * at any width; this wrapper is the one place that reaches for the data source. It is a
 * client component because `@openrunic/ui` ships no 'use client' directive of its own, so
 * anything importing it has to be a client component itself.
 */

import type { ReactNode } from 'react';
import { useCallback } from 'react';
import { AppShell } from './AppShell';
import { useAssistant } from './assistant/AssistantProvider';
import { getPortalApi } from '@/lib/api';
import type { PortalApi } from '@/lib/api/types';
import { useAsync } from '@/lib/useAsync';

export interface PortalChromeProps {
  children: ReactNode;
  /** Injected in tests; defaults to the app's own data source. */
  api?: PortalApi;
}

export function PortalChrome({ children, api = getPortalApi() }: PortalChromeProps) {
  const load = useCallback(() => api.getPatient(), [api]);
  const { state } = useAsync(load);
  const { availability } = useAssistant();

  /* A failed identity read must not blank the portal: the sections still work, they just
     go unnamed, so this reads the ready state and ignores the other two. */
  const patient = state.status === 'ready' ? state.data : undefined;

  return (
    <AppShell assistantEnabled={availability.status === 'enabled'} patient={patient}>
      {children}
    </AppShell>
  );
}
