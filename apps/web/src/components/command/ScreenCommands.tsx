'use client';

import type { ReactElement } from 'react';

import { useRegisterCommands } from './CommandProvider';
import type { Command } from './types';

/**
 * Registers a screen's commands from inside the shell.
 *
 * The registry is provided by `AppShell`, which a screen *renders*: a screen
 * component's own body is therefore above the provider, and calling
 * `useRegisterCommands` there throws. This component is the fix, and it is one
 * line at the call site:
 *
 * ```tsx
 * <AppShell title="Chart">
 *   <ScreenCommands commands={commands} />
 *   ...
 * </AppShell>
 * ```
 *
 * `commands` must still be memoised with the screen's real dependencies: an
 * array literal is a new reference on every render, which would re-register on
 * every render.
 *
 * It renders nothing. The commands live exactly as long as the screen does.
 */
export function ScreenCommands({ commands }: { commands: Command[] }): ReactElement | null {
  useRegisterCommands(commands);
  return null;
}
