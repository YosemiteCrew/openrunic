import { err, ok } from '@openrunic/types';
import type { Result } from '@openrunic/types';

import type { X12Error } from './errors.js';

/**
 * X12 delimiters are per-document data, not constants.
 *
 * The ISA segment is the only fixed-width segment in the standard, and it
 * exists precisely so a reader can learn the four separators before it knows
 * how to split anything. Trading partners really do vary them, so every read
 * path detects rather than assumes, and every write path carries its choice
 * explicitly so a golden file is reproducible.
 */
export interface Delimiters {
  /** Separates elements within a segment. ISA character 4. */
  readonly element: string;
  /** Separates components within a composite element. ISA16. */
  readonly component: string;
  /** Separates repetitions within a repeating element. ISA11 in 5010. */
  readonly repetition: string;
  /** Terminates a segment. The character immediately after ISA16. */
  readonly segment: string;
}

/**
 * The separators this codec writes unless a caller overrides them.
 *
 * Chosen because they are the de facto interchange defaults and none of them
 * occurs in the character set of the data we emit, so no escaping is needed.
 */
export const DEFAULT_DELIMITERS: Delimiters = {
  element: '*',
  component: ':',
  repetition: '^',
  segment: '~',
};

/**
 * Total character length of an ISA segment including its terminator.
 *
 * ISA is fixed-width by design: 3 for the tag, 16 separators, and 86
 * characters of padded data, then the segment terminator. Anything else is a
 * truncated or corrupted interchange, and reading on would silently produce
 * garbage delimiters.
 */
export const ISA_SEGMENT_LENGTH = 106;

const ISA_ELEMENT_INDEX = 3;
const ISA_REPETITION_INDEX = 82;
const ISA_COMPONENT_INDEX = 104;
const ISA_TERMINATOR_INDEX = 105;

/**
 * Reads the four delimiters out of a raw interchange's ISA header.
 *
 * Rejects, rather than guesses, when the header is short or when two
 * separators collide: a document whose element and segment separators are the
 * same character cannot be tokenized unambiguously, and pretending otherwise
 * would turn a transport bug into a mis-posted payment.
 */
export function detectDelimiters(raw: string): Result<Delimiters, X12Error> {
  if (raw.length === 0) {
    return err({ kind: 'empty_input', message: 'the interchange is empty' });
  }
  if (!raw.startsWith('ISA')) {
    return err({
      kind: 'malformed_envelope',
      message: 'the interchange does not begin with an ISA segment',
    });
  }
  if (raw.length < ISA_SEGMENT_LENGTH) {
    return err({
      kind: 'malformed_envelope',
      message: `the ISA header is ${raw.length} characters, expected ${ISA_SEGMENT_LENGTH}`,
      at: { segmentIndex: 0, segmentTag: 'ISA' },
    });
  }

  const delimiters: Delimiters = {
    element: raw[ISA_ELEMENT_INDEX] ?? '',
    repetition: raw[ISA_REPETITION_INDEX] ?? '',
    component: raw[ISA_COMPONENT_INDEX] ?? '',
    segment: raw[ISA_TERMINATOR_INDEX] ?? '',
  };

  return validateDelimiters(delimiters);
}

/**
 * Checks that a delimiter set can tokenize unambiguously.
 *
 * Exported because the writer needs the same guarantee before it emits: a
 * caller that supplies colliding separators should be told at encode time, not
 * discovered by a payer's parser a week later.
 */
export function validateDelimiters(delimiters: Delimiters): Result<Delimiters, X12Error> {
  const entries: readonly (readonly [string, string])[] = [
    ['element', delimiters.element],
    ['component', delimiters.component],
    ['repetition', delimiters.repetition],
    ['segment', delimiters.segment],
  ];

  for (const [name, value] of entries) {
    if (value.length !== 1) {
      return err({
        kind: 'malformed_envelope',
        message: `the ${name} delimiter must be exactly one character`,
      });
    }
  }

  const distinct = new Set(entries.map(([, value]) => value));
  if (distinct.size !== entries.length) {
    return err({
      kind: 'malformed_envelope',
      message: 'the four delimiters must be four distinct characters',
    });
  }

  return ok(delimiters);
}
