'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import type { AgentAvailability, AgentCapabilities } from '@/lib/agent';

import { defaultProbe, defaultRunTurn } from './transport';
import type { ProbeAssistant, RunAgentTurn } from './transport';

/**
 * Whether this deployment has an assistant, and whether the panel is open.
 *
 * The first question is answered by asking the API once per app load, never by
 * reading a build flag. ADR-0005 makes the agent default-off and `apps/api`
 * mounts no agent router without a configured endpoint, so the honest signal is
 * the one the server gives; a flag baked at build time would put the answer in
 * the wrong place and would be wrong the moment a deployer changed their
 * configuration.
 *
 * While the probe is in flight the answer is `absent`, so a page that has not
 * heard back yet renders exactly like a clinic that configured nothing. That
 * ordering is deliberate: ADR-0005 asks that no screen reserve layout space for
 * the agent, and a placeholder that appears and then disappears is layout space
 * reserved.
 */

interface AssistantContextValue {
  availability: AgentAvailability;
  capabilities: AgentCapabilities | null;
  isOpen: boolean;
  open: () => void;
  close: () => void;
  runTurn: RunAgentTurn;
}

const AssistantContext = createContext<AssistantContextValue | null>(null);

const ABSENT: AgentAvailability = { status: 'absent' };

export interface AssistantProviderProps {
  children: ReactNode;
  /**
   * Asks whether an assistant is configured. Contractually never rejects; a
   * rejection is nonetheless treated as `absent`, because a broken probe must
   * not be able to break the shell it renders inside.
   */
  probe?: ProbeAssistant;
  /** Runs one turn. Injected in tests; defaults to the streaming API client. */
  runTurn?: RunAgentTurn;
}

export function AssistantProvider({
  children,
  probe = defaultProbe,
  runTurn = defaultRunTurn,
}: Readonly<AssistantProviderProps>) {
  const [availability, setAvailability] = useState<AgentAvailability>(ABSENT);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    void probe(controller.signal).then(
      (result) => {
        if (active) setAvailability(result);
      },
      () => {
        // Already `absent`. Nothing to say and nothing to show.
      }
    );

    return () => {
      active = false;
      controller.abort();
    };
  }, [probe]);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  const value = useMemo<AssistantContextValue>(
    () => ({
      availability,
      capabilities: availability.status === 'enabled' ? availability.capabilities : null,
      isOpen,
      open,
      close,
      runTurn,
    }),
    [availability, isOpen, open, close, runTurn]
  );

  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}

/**
 * Reads the assistant state.
 *
 * Returns `absent` outside a provider rather than throwing. The palette's
 * registry throws in that position because a screen that registers a command
 * with no registry is a wiring bug; this one is the opposite case, because
 * "there is no assistant here" is the shipped default and rendering nothing is
 * the correct response to it.
 */
export function useAssistant(): AssistantContextValue {
  return (
    useContext(AssistantContext) ?? {
      availability: ABSENT,
      capabilities: null,
      isOpen: false,
      open: NOOP,
      close: NOOP,
      runTurn: defaultRunTurn,
    }
  );
}

function NOOP(): void {
  // The no-provider fallback cannot open a panel that is not rendered.
}
