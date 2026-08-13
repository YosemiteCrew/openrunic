import type { Command, CommandGroup } from './types';
import { COMMAND_GROUP_LABELS, COMMAND_GROUP_ORDER } from './types';

/**
 * Ranking for the palette.
 *
 * Subsequence matching, not fuzzy scoring: "fesh" finds "Fee sheet" because the
 * letters appear in order, and nothing surprising ever outranks a prefix match.
 * A palette that reorders unpredictably is worse than one that reorders never.
 */

const PREFIX = 0;
const WORD_START = 1;
const CONTAINS = 2;
const SUBSEQUENCE = 3;
const NO_MATCH = 4;

function subjectOf(command: Command): string {
  return [command.label, command.searchText ?? '', ...(command.keywords ?? [])]
    .join(' ')
    .toLowerCase();
}

function isSubsequence(needle: string, haystack: string): boolean {
  let index = 0;
  for (const character of haystack) {
    if (character === needle[index]) index += 1;
    if (index === needle.length) return true;
  }
  return needle.length === 0;
}

/** Lower is better. NO_MATCH means the command is filtered out. */
export function scoreCommand(command: Command, query: string): number {
  const needle = query.trim().toLowerCase();
  if (!needle) return WORD_START;

  const label = command.label.toLowerCase();
  if (label.startsWith(needle)) return PREFIX;
  if (label.split(/\s+/).some((word) => word.startsWith(needle))) return WORD_START;

  const subject = subjectOf(command);
  if (subject.includes(needle)) return CONTAINS;
  if (isSubsequence(needle, subject)) return SUBSEQUENCE;
  return NO_MATCH;
}

export interface CommandSection {
  group: CommandGroup;
  label: string;
  commands: Command[];
}

/**
 * Filters and groups, preserving both the group order and, inside a group, the
 * registration order for equally good matches. Stable order is a feature: a
 * keyboard user learns that the second item is always the same command.
 */
export function filterCommands(commands: Command[], query: string): CommandSection[] {
  const scored = commands
    .map((command, index) => ({ command, score: scoreCommand(command, query), index }))
    .filter((entry) => entry.score < NO_MATCH)
    .sort((a, b) => a.score - b.score || a.index - b.index);

  return COMMAND_GROUP_ORDER.map((group) => ({
    group,
    label: COMMAND_GROUP_LABELS[group],
    commands: scored.filter((entry) => entry.command.group === group).map((entry) => entry.command),
  })).filter((section) => section.commands.length > 0);
}

/** The sections flattened into the order the arrow keys walk. */
export function flattenSections(sections: CommandSection[]): Command[] {
  return sections.flatMap((section) => section.commands);
}
