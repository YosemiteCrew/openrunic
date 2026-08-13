import type { Delimiters } from './delimiters.js';
import type { X12Location } from './errors.js';

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
 * Serializes one segment.
 *
 * Trailing empty elements are dropped, which is not cosmetic: X12 treats a
 * trailing separator run as noise, several payers' parsers reject it, and
 * keeping it would make byte-exact golden files depend on how many optional
 * fields a mapper happened to enumerate.
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
export function readSegments(raw: string, delimiters: Delimiters): readonly Segment[] {
  const segments: Segment[] = [];
  for (const chunk of raw.split(delimiters.segment)) {
    const trimmed = chunk.replace(/^[\r\n\t ]+/, '').replace(/[\r\n]+$/, '');
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
