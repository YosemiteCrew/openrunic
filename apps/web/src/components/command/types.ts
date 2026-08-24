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

export interface CommandGroupHeading {
  readonly group: CommandGroup;
  /** Catalogue key for the heading the palette draws above the group. */
  readonly labelKey: string;
}

/**
 * The group headings, in the order the palette ranks them.
 *
 * The key is carried as data beside the group rather than assembled at render.
 * A template like `t(\`shell.palette.group.${group}\`)` would read the same and
 * be invisible to the catalogue drift test, which is another way of saying it
 * would be invisible to whoever has to find it when one of these three is
 * renamed.
 */
export const COMMAND_GROUP_HEADINGS: readonly CommandGroupHeading[] = [
  { group: 'patients', labelKey: 'shell.palette.group.patients' },
  { group: 'navigate', labelKey: 'shell.palette.group.navigate' },
  { group: 'actions', labelKey: 'shell.palette.group.actions' },
];

/** The same order on its own, for callers that only need the ranking. */
export const COMMAND_GROUP_ORDER: readonly CommandGroup[] = COMMAND_GROUP_HEADINGS.map(
  (heading) => heading.group
);
