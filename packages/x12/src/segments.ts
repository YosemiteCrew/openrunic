import type { Delimiters } from './delimiters.js';
import type { X12Error, X12Location } from './errors.js';

/**
 * The low-level document model: a segment is a tag plus positional elements,
 * and an element is either simple or composite.
 *
 * This layer knows nothing about claims, remittances or loops. That separation
 * is the whole point of the package's structure: envelope and tokenization
 * bugs live here where they are cheap to test exhaustively, and can never
 * reach into the transaction-set mappers to corrupt a mapping. The mappers, in
 * turn, only ever see already-validated segments.
 */

/** A simple element is a string; a composite is its ordered components. */
export type ElementValue = string | readonly string[];

/** One X12 segment. Elements are positional, so absence matters and is kept. */
export interface Segment {
  readonly tag: string;
  readonly elements: readonly ElementValue[];
}

/** Builds a segment, which is nicer to read than an object literal at 400 call sites. */
export function segment(tag: string, ...elements: readonly ElementValue[]): Segment {
  return { tag, elements };
}

/**
 * Reads element `position` (one-based, matching how the standard names them, so
 * `NM103` is position 3) as a simple string.
 *
 * Returns the empty string for an absent element rather than `undefined`,
 * because X12 does not distinguish "omitted" from "present but empty" and
 * pretending it does would push a meaningless branch into every mapper. A
 * composite yields its first component, which is what the standard means when
 * a simple read is specified against a composite position.
 */
export function simpleAt(source: Segment, position: number): string {
  const value = source.elements[position - 1];
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  return value[0] ?? '';
}

/** Reads one component of a composite element, both indices one-based. */
export function componentAt(source: Segment, position: number, component: number): string {
  const value = source.elements[position - 1];
  if (value === undefined) return '';
  if (typeof value === 'string') return component === 1 ? value : '';
  return value[component - 1] ?? '';
}

/** True when the element at `position` carries no data. */
export function isEmptyAt(source: Segment, position: number): boolean {
  return simpleAt(source, position) === '';
}

/** Builds a location for an error, so mappers do not hand-assemble them. */
export function locate(
  source: Segment,
  segmentIndex: number,
  elementPosition?: number
): X12Location {
  return elementPosition === undefined
    ? { segmentIndex, segmentTag: source.tag }
    : { segmentIndex, segmentTag: source.tag, elementPosition };
}

/**
 * The delimiter characters an element may not contain, and why there is no
 * escaping alternative.
 *
 * X12 has no escape mechanism. A separator inside an element IS a separator, so
 * a member id of `A*B` does not produce an element containing an asterisk - it
 * produces two elements, and every element after it shifts left. On an 837P that
 * moves NM109 into NM108's position and the claim is submitted for whatever
 * identifier lands there; a `~` does the same one level up and invents a
 * segment. The values reaching the mappers are demographics, member ids, claim
 * references and service codes, all of which a low-privileged user can influence.
 *
 * So the only two honest answers are refuse or mangle, and this refuses. A claim
 * that cannot be encoded is a work item; a claim encoded for somebody else's
 * member id is a payment.
 */
export function delimiterFault(
  source: Segment,
  delimiters: Delimiters,
  segmentIndex: number
): X12Error | undefined {
  // The repetition separator is deliberately absent. This codec never splits on
  // it: a repeating element arrives as one string and is re-emitted as one
  // string, so the character shifts nothing here. Real payer documents use it -
  // EB03 on a 271 carries repeated service type codes that way - and refusing it
  // would reject legal traffic while protecting nothing.
  const separators = [
    ['element', delimiters.element],
    ['component', delimiters.component],
    ['segment', delimiters.segment],
  ] as const;

  const offending = (value: string): string | undefined =>
    separators.find(([, character]) => value.includes(character))?.[0];

  if (offending(source.tag) !== undefined) {
    return {
      kind: 'invalid_element',
      message: `the segment tag "${source.tag}" contains an X12 delimiter`,
      at: { segmentIndex, segmentTag: source.tag },
      value: source.tag,
      expected: 'a tag free of the active delimiters',
    };
  }

  for (const [index, value] of source.elements.entries()) {
    const components = typeof value === 'string' ? [value] : value;
    for (const component of components) {
      const name = offending(component);
      if (name === undefined) continue;
      return {
        kind: 'invalid_element',
        message: `element ${String(index + 1)} of ${source.tag} contains the ${name} delimiter, which would split it into fields this document does not mean`,
        at: { segmentIndex, segmentTag: source.tag, elementPosition: index + 1 },
        value: component,
        expected: 'a value free of the active delimiters',
      };
    }
  }

  return undefined;
}

/**
 * Serializes one segment.
 *
 * Trailing empty elements are dropped, which is not cosmetic: X12 treats a
 * trailing separator run as noise, several payers' parsers reject it, and
 * keeping it would make byte-exact golden files depend on how many optional
 * fields a mapper happened to enumerate.
 *
 * It does NOT check its input, and cannot usefully: it returns a string, and the
 * refusal has to reach a caller as a `Result`. {@link delimiterFault} is that
 * check, and `writeInterchange` applies it to every segment before any of them
 * is serialized.
 */
export function writeSegment(source: Segment, delimiters: Delimiters): string {
  const rendered = source.elements.map((value) =>
    typeof value === 'string' ? value : value.join(delimiters.component)
  );
  while (rendered.length > 0 && rendered[rendered.length - 1] === '') {
    rendered.pop();
  }
  return [source.tag, ...rendered].join(delimiters.element) + delimiters.segment;
}

/**
 * Splits a raw document into segments.
 *
 * Line breaks around segments are discarded: partners routinely pretty-print
 * with a newline after each terminator, and a reader that choked on that would
 * fail on half the files a support engineer pastes into a ticket. Only line
 * breaks and leading indentation are stripped, never a trailing space inside
 * an element, because ISA's fixed-width fields are space-padded and that
 * padding is data.
 *
 * The ISA is exempted from component splitting. It has no composite elements
 * by definition, and ISA16 carries the component separator itself as a literal
 * value, so splitting it would turn the one element that defines the rule into
 * an empty pair.
 */
/**
 * Trims the whitespace an interchange puts around a segment, linearly.
 *
 * The trailing half used to be `/[\r\n]+$/`, anchored at the end but not the
 * start, so the engine retried the run from every position and cost grew with
 * the square of the segment length (CodeQL js/polynomial-redos). An X12 file
 * comes from a payer, and a padded segment is ordinary rather than exotic.
 *
 * Leading and trailing sets differ on purpose, and that is not a typo: a
 * segment may be indented with tabs and spaces, but only the line break itself
 * is stripped from the end. Trailing spaces inside an element are data in a
 * fixed-width ISA header.
 */
function trimSegment(chunk: string): string {
  let start = 0;
  while (start < chunk.length && LEADING.has(chunk.charCodeAt(start))) {
    start += 1;
  }
  let end = chunk.length;
  while (end > start && TRAILING.has(chunk.charCodeAt(end - 1))) {
    end -= 1;
  }
  return start === 0 && end === chunk.length ? chunk : chunk.slice(start, end);
}

/** `\r`, `\n`, `\t`, space. */
const LEADING = new Set([13, 10, 9, 32]);
/** `\r`, `\n` only: a trailing space can be significant. */
const TRAILING = new Set([13, 10]);

export function readSegments(raw: string, delimiters: Delimiters): readonly Segment[] {
  const segments: Segment[] = [];
  for (const chunk of raw.split(delimiters.segment)) {
    const trimmed = trimSegment(chunk);
    if (trimmed === '') continue;
    const parts = trimmed.split(delimiters.element);
    const [tag = '', ...rest] = parts;
    const isFixedWidthHeader = tag === 'ISA';
    segments.push({
      tag,
      elements: rest.map((value) =>
        !isFixedWidthHeader && value.includes(delimiters.component)
          ? value.split(delimiters.component)
          : value
      ),
    });
  }
  return segments;
}
