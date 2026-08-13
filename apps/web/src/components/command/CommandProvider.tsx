'use client';

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import type { Command } from './types';

/**
 * The command registry.
 *
 * Screens do not edit a central list; they register their own commands while
 * they are mounted and unregister on the way out. That is what keeps the
 * palette honest: if a verb is offered, the screen that performs it is on
 * screen, and a screen that is gone cannot leave a dead command behind.
 */

interface CommandContextValue {
  commands: Command[];
  register: (sourceId: string, commands: Command[]) => void;
  unregister: (sourceId: string) => void;
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

const CommandContext = createContext<CommandContextValue | null>(null);

export interface CommandProviderProps {
  children: ReactNode;
  /** Registered for the lifetime of the app: the navigate group. */
  baseCommands?: Command[];
  /** Starts open. Tests only. */
  defaultOpen?: boolean;
}

export function CommandProvider({
  children,
  baseCommands,
  defaultOpen = false,
}: CommandProviderProps) {
  const [sources, setSources] = useState<Record<string, Command[]>>({});
  const [isOpen, setIsOpen] = useState(defaultOpen);

  const register = useCallback((sourceId: string, commands: Command[]) => {
    setSources((previous) => ({ ...previous, [sourceId]: commands }));
  }, []);

  const unregister = useCallback((sourceId: string) => {
    setSources((previous) => {
      if (!(sourceId in previous)) return previous;
      const next = { ...previous };
      delete next[sourceId];
      return next;
    });
  }, []);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((value) => !value), []);

  /* Cmd-K on macOS, Ctrl-K elsewhere. Registered once, on the window, so the
     palette opens from anywhere including a focused field. */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      setIsOpen((value) => !value);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const commands = useMemo(() => {
    const registered = Object.values(sources).flat();
    return [...(baseCommands ?? []), ...registered];
  }, [sources, baseCommands]);

  const value = useMemo(
    () => ({ commands, register, unregister, isOpen, open, close, toggle }),
    [commands, register, unregister, isOpen, open, close, toggle]
  );

  return <CommandContext.Provider value={value}>{children}</CommandContext.Provider>;
}

function useCommandContext(): CommandContextValue {
  const value = useContext(CommandContext);
  if (!value) {
    throw new Error('Command hooks must be used inside <AppShell>, which provides the registry.');
  }
  return value;
}

/** Open, close and read the palette. The top bar's search control uses this. */
export function useCommandPalette(): Pick<
  CommandContextValue,
  'isOpen' | 'open' | 'close' | 'toggle' | 'commands'
> {
  const { isOpen, open, close, toggle, commands } = useCommandContext();
  return { isOpen, open, close, toggle, commands };
}

/**
 * Registers this screen's commands for as long as it is mounted.
 *
 * Pass a memoised array. An array literal is a new reference on every render,
 * which would register on every render; `useMemo` with the screen's real
 * dependencies is the contract.
 *
 * ```tsx
 * useRegisterCommands(
 *   useMemo<Command[]>(
 *     () => [{ id: 'schedule.book', label: 'Book appointment', group: 'actions', perform: openBooking }],
 *     [openBooking]
 *   )
 * );
 * ```
 */
export function useRegisterCommands(commands: Command[]): void {
  const { register, unregister } = useCommandContext();
  const sourceId = useId();

  useEffect(() => {
    register(sourceId, commands);
    return () => unregister(sourceId);
  }, [commands, register, unregister, sourceId]);
}
