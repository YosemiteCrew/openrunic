import type { ReactNode } from 'react';

/**
 * The command vocabulary.
 *
 * Every route and every primary action in openrunic must be reachable from the
 * palette. That is an accessibility requirement (the whole core loop is
 * operable without a mouse) and an agent-friendliness requirement: a software
 * agent driving this app should never have to find a button on a canvas when it
 * can name what it wants.
 */

export type CommandGroup =
  /** Screens, by name and by synonym. Registered once by the shell. */
  | 'navigate'
  /** Patient results from the live search. Never registered by hand. */
  | 'patients'
  /** Verbs the current screen owns: "Book appointment", "Sign note". */
  | 'actions';

interface CommandBase {
  /** Stable and unique across the app. Prefix it with the screen: `schedule.book`. */
  id: string;
  /** Sentence case. An action names its verb and its object: "Void claim". */
  label: string;
  group: CommandGroup;
  /** Synonyms a tired person would type. "fee sheet", "charges" both hit billing. */
  keywords?: string[];
  /** Lucide slug. */
  icon?: string;
  /** Right-aligned context: an MRN, a date of birth, a shortcut. */
  hint?: ReactNode;
  /** Filtering text beyond label and keywords, e.g. an MRN. */
  searchText?: string;
}

export interface NavigateCommand extends CommandBase {
  group: 'navigate' | 'patients';
  /** A real route in this app. The palette pushes it and closes. */
  href: string;
  perform?: never;
}

export interface ActionCommand extends CommandBase {
  group: 'actions';
  /** Runs, then the palette closes. Keep it synchronous or fire-and-forget. */
  perform: () => void;
  href?: never;
}

export type Command = NavigateCommand | ActionCommand;

/** Group headings, in the order the palette ranks them. */
export const COMMAND_GROUP_ORDER: readonly CommandGroup[] = ['patients', 'navigate', 'actions'];

export const COMMAND_GROUP_LABELS: Record<CommandGroup, string> = {
  patients: 'Patients',
  navigate: 'Go to',
  actions: 'Actions',
};
