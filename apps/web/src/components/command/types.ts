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
  /**
   * Sentence case. An action names its verb and its object: "Void claim".
   *
   * Already translated when it reaches the registry, because it is also what
   * the palette filters on: a reader typing in Spanish has to match the Spanish
   * label, and ranking a key would rank a string nobody reads.
   */
  label: string;
  group: CommandGroup;
  /**
   * Synonyms a tired person would type. "fee sheet", "charges" both hit
   * billing. Translated with the label, and per-language rather than
   * transliterated: a Spanish speaker does not type "fee sheet".
   */
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

/**
 * What the palette calls each group, as catalogue keys.
 *
 * Keys rather than words because `filterCommands` is a pure function with no
 * reader and no translator: it decides which group a command lands in, and the
 * palette looks the heading up per render in the language of whoever opened it.
 *
 * Carried as `labelKey` data so `catalogue-drift.test.ts` can see them. It
 * reads `somethingKey:` out of the source, so a heading whose key is defined
 * nowhere fails the build rather than rendering as itself above three commands.
 */
export const COMMAND_GROUP_LABEL_KEYS: Record<CommandGroup, { labelKey: string }> = {
  patients: { labelKey: 'shell.palette.group.patients' },
  navigate: { labelKey: 'shell.palette.group.navigate' },
  actions: { labelKey: 'shell.palette.group.actions' },
};
