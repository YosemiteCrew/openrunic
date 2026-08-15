import type { Card, Indicator, Link, Source, Suggestion } from './protocol.js';

/**
 * BUILDING A CARD, AND THE TWO RULES THAT KEEP THEM READ.
 *
 * A card competes for a prescriber's attention against everything else on the
 * screen, and the failure mode of decision support is not a missing card - it is
 * a stream of them that trains the reader to dismiss without looking. So:
 *
 * The indicator is the promise. `critical` means stop, and a system that says
 * critical about something routine has spent the word. `info` is for things
 * worth knowing and not worth interrupting for, and most cards are `info`.
 *
 * The summary is capped at 140 characters by the specification, and the cap is
 * enforced here rather than left to a receiving system to truncate wherever it
 * likes - a summary cut mid-clause by somebody else's renderer can invert its
 * meaning.
 */

const SUMMARY_LIMIT = 140;

export interface CardInput {
  readonly summary: string;
  readonly detail?: string;
  readonly indicator: Indicator;
  readonly source: Source;
  readonly suggestions?: readonly Suggestion[];
  readonly selectionBehavior?: 'at-most-one' | 'any';
  readonly links?: readonly Link[];
  readonly uuid?: string;
}

export function card(input: CardInput): Card {
  if (input.suggestions !== undefined && input.selectionBehavior === undefined) {
    // The specification requires it whenever suggestions are present, and a
    // receiving EMR that finds it missing has no defined way to render the
    // choice it is being offered.
    throw new Error('A card carrying suggestions must state its selectionBehavior.');
  }

  return {
    summary: truncate(input.summary),
    ...(input.detail === undefined ? {} : { detail: input.detail }),
    indicator: input.indicator,
    source: input.source,
    ...(input.suggestions === undefined ? {} : { suggestions: input.suggestions }),
    ...(input.selectionBehavior === undefined
      ? {}
      : { selectionBehavior: input.selectionBehavior }),
    ...(input.links === undefined ? {} : { links: input.links }),
    ...(input.uuid === undefined ? {} : { uuid: input.uuid }),
  };
}

/**
 * Trims at a word boundary and marks the cut.
 *
 * A summary sliced mid-word reads as a rendering fault; one that ends in an
 * ellipsis reads as "there is more in the detail", which is true.
 */
function truncate(summary: string): string {
  if (summary.length <= SUMMARY_LIMIT) return summary;

  const cut = summary.slice(0, SUMMARY_LIMIT - 1);
  const boundary = cut.lastIndexOf(' ');
  return `${(boundary > SUMMARY_LIMIT / 2 ? cut.slice(0, boundary) : cut).trimEnd()}…`;
}
