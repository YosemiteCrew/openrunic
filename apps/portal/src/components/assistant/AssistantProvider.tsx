'use client';

/**
 * Whether this deployment gives patients an assistant.
 *
 * The question is answered by asking the API once per app load, never by
 * reading a build flag. ADR-0005 makes the whole subsystem default-off and
 * `apps/api` mounts no agent router without a configured endpoint, so the
 * honest signal is the one the server gives; a flag baked in at build time
 * would put the answer in the wrong place and would be wrong the moment a
 * practice changed its configuration.
 *
 * Two values come out, and both of them default to "show nothing".
 *
 * `availability` is `absent` until the probe says otherwise, so the navigation
 * never grows a link that then disappears. ADR-0005 asks that no screen reserve
 * space for the assistant, and a link that flickers is space reserved.
 *
 * `settled` is false until the probe has answered at all, and it exists because
 * the assistant is a page here rather than a panel. A page that decided it was
 * missing before the probe came back would answer 404 on every first load; one
 * that assumed it was present would flash a working assistant at a practice
 * that has none. So the page renders nothing until the answer is in, and then
 * renders either the assistant or a 404. A broken probe never settles as
 * enabled, so broken and unconfigured produce the same page.
 */

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { defaultProbe, defaultRunTurn } from '@/lib/assistant';
import type { AssistantAvailability, ProbeAssistant, RunTurn } from '@/lib/assistant';

export interface AssistantContextValue {
  availability: AssistantAvailability;
  /** True once the probe has answered, however it answered. */
  settled: boolean;
  runTurn: RunTurn;
}

const ABSENT: AssistantAvailability = { status: 'absent' };

const AssistantContext = createContext<AssistantContextValue | null>(null);

export interface AssistantProviderProps {
  children: ReactNode;
  /**
   * Asks whether an assistant is configured. Contractually never rejects; a
   * rejection is nonetheless treated as absent, because a broken probe must not
   * be able to break the portal it renders inside.
   */
  probe?: ProbeAssistant;
  /** Runs one turn. Injected in tests; defaults to the streaming client. */
  runTurn?: RunTurn;
}

export function AssistantProvider({
  children,
  probe = defaultProbe,
  runTurn = defaultRunTurn,
}: Readonly<AssistantProviderProps>) {
  const [state, setState] = useState<{ availability: AssistantAvailability; settled: boolean }>({
    availability: ABSENT,
    settled: false,
  });

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    void probe(controller.signal).then(
      (availability) => {
        if (active) setState({ availability, settled: true });
      },
      () => {
        /* A probe that rejected has told us nothing, and nothing is the answer
           the surface already holds. It still settles: the page has to stop
           waiting, and a broken probe means no assistant just as firmly as a
           404 does. */
        if (active) setState({ availability: ABSENT, settled: true });
      }
    );

    return () => {
      active = false;
      controller.abort();
    };
  }, [probe]);

  const value = useMemo<AssistantContextValue>(
    () => ({ availability: state.availability, settled: state.settled, runTurn }),
    [state, runTurn]
  );

  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}

/**
 * Reads the assistant state.
 *
 * Outside a provider it answers "there is no assistant and we have not heard
 * back", rather than throwing. That is the shipped default of this product, so
 * rendering nothing is the correct response to it rather than a bug to report.
 */
export function useAssistant(): AssistantContextValue {
  return (
    useContext(AssistantContext) ?? {
      availability: ABSENT,
      settled: false,
      runTurn: defaultRunTurn,
    }
  );
}
