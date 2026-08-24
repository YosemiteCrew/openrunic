import type { Command, CommandGroup } from './types';
import { COMMAND_GROUP_HEADINGS } from './types';

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
  /**
   * Catalogue key for the heading, not the heading itself. Filtering happens
   * outside React and has no translator; the palette renders the word.
   */
  labelKey: string;
  commands: Command[];
}

/**
 * Filters and groups, preserving both the group order and, inside a group, the
 * registration order for equally good matches. Stable order is a feature: a
 * keyboard user learns that the second item is always the same command.
 */
export function filterCommands(commands: Command[], query: string): CommandSection[] {
  const scored: { command: Command; score: number; index: number }[] = [];
  for (const [index, command] of commands.entries()) {
    const score = scoreCommand(command, query);
    if (score < NO_MATCH) scored.push({ command, score, index });
  }
  scored.sort((a, b) => a.score - b.score || a.index - b.index);

  /* Bucketed in one pass over the survivors rather than one pass per group:
     the sort above already fixed the order inside each bucket, so appending
     preserves it. */
  const buckets = new Map<CommandGroup, Command[]>();
  for (const entry of scored) {
    const bucket = buckets.get(entry.command.group);
    if (bucket) bucket.push(entry.command);
    else buckets.set(entry.command.group, [entry.command]);
  }

  const sections: CommandSection[] = [];
  for (const heading of COMMAND_GROUP_HEADINGS) {
    const groupCommands = buckets.get(heading.group);
    if (groupCommands) {
      sections.push({ group: heading.group, labelKey: heading.labelKey, commands: groupCommands });
    }
  }
  return sections;
}

/** The sections flattened into the order the arrow keys walk. */
export function flattenSections(sections: CommandSection[]): Command[] {
  return sections.flatMap((section) => section.commands);
}
