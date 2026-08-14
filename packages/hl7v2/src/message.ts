import { DEFAULT_DELIMITERS, escapeValue, readDelimiters, unescapeValue } from './encoding.js';
import type { Delimiters } from './encoding.js';
import { Hl7Error } from './errors.js';

/**
 * THE MESSAGE MODEL, AND THE OFF-BY-ONE THAT DEFINES IT.
 *
 * An HL7 v2 message is segments separated by carriage returns, each a segment
 * identifier followed by fields, each field made of repetitions, components and
 * subcomponents. That much is simple. What is not is MSH.
 *
 * `MSH-1` is defined to be the field separator itself, and `MSH-2` the encoding
 * characters - so in `MSH|^~\&|SENDER|...`, the text `^~\&` is field 2 and
 * `SENDER` is field 3, even though splitting on `|` puts `^~\&` first and
 * `SENDER` second. Every other segment counts from 1 after the identifier.
 *
 * That single irregularity is behind a large share of the interface defects in
 * this format: a parser that indexes MSH like every other segment reads the
 * sending application as the receiving one, and the message still looks
 * plausible. It is handled once, here, so no caller has to remember it.
 */

/** A message as a list of segments, in the order they arrived. */
export interface Hl7Message {
  readonly delimiters: Delimiters;
  readonly segments: readonly Segment[];
}

export interface Segment {
  readonly id: string;
  /**
   * Fields by HL7 number, so `fields[3]` is field 3. Index 0 is unused and
   * always empty, which costs one array slot and removes every `- 1` from every
   * caller - and a `- 1` in the wrong place is the defect this shape exists to
   * make impossible.
   */
  readonly fields: readonly string[];
}

/** Segment separators seen in the wild: the standard one and the two others. */
const SEGMENT_SEPARATOR = /\r\n|\r|\n/;

/**
 * Parses a message.
 *
 * Accepts `\r`, `\n` and `\r\n` between segments. The standard says carriage
 * return, and a sender that uses newlines is out of conformance - but it is also
 * most senders at some point, usually because a file went through a text editor,
 * and refusing the message would mean losing a result over a byte nobody chose.
 */
export function parseMessage(raw: string): Hl7Message {
  const trimmed = raw.replace(/^\s+/, '').replace(/\s+$/, '');
  if (trimmed === '') {
    throw new Hl7Error('The message is empty.');
  }

  const lines = trimmed.split(SEGMENT_SEPARATOR).filter((line) => line.trim() !== '');
  const first = lines[0];
  if (first === undefined) {
    throw new Hl7Error('The message is empty.');
  }

  const delimiters = readDelimiters(first);
  const segments = lines.map((line, index) => parseSegment(line, delimiters, index + 1));

  return { delimiters, segments };
}

function parseSegment(line: string, delimiters: Delimiters, position: number): Segment {
  const id = line.slice(0, 3);
  if (id.length < 3) {
    throw new Hl7Error(`Segment ${String(position)} has no identifier.`, { segment: position });
  }

  if (id === 'MSH') {
    // MSH-1 is the separator; MSH-2 is the encoding characters. Splitting the
    // rest normally and pushing those two in front is what makes every other
    // index in this file mean what the specification says it means.
    const rest = line.slice(4).split(delimiters.field);
    return { id, fields: ['', delimiters.field, ...rest] };
  }

  return { id, fields: ['', ...line.slice(4).split(delimiters.field)] };
}

/** Every segment with this identifier, in order. */
export function segmentsNamed(message: Hl7Message, id: string): Segment[] {
  return message.segments.filter((segment) => segment.id === id);
}

/** The first segment with this identifier, or undefined. */
export function segmentNamed(message: Hl7Message, id: string): Segment | undefined {
  return segmentsNamed(message, id)[0];
}

/** The same, but a missing segment is an error naming what was expected. */
export function requireSegment(message: Hl7Message, id: string): Segment {
  const segment = segmentNamed(message, id);
  if (segment === undefined) {
    throw new Hl7Error(`This message has no ${id} segment.`);
  }
  return segment;
}

/** One field, unescaped. Absent fields and empty fields are both `''`. */
export function field(
  segment: Segment | undefined,
  number: number,
  delimiters: Delimiters
): string {
  const raw = segment?.fields[number];
  return raw === undefined ? '' : unescapeValue(raw, delimiters);
}

/**
 * One component of a field, unescaped.
 *
 * Components are 1-based, so `component(segment, 5, 1, …)` is `PID-5.1`, the
 * family name. A field with no component separator is its own first component,
 * which is what lets a sender write `SMITH` where the standard allows
 * `SMITH^JOHN`.
 */
export function component(
  segment: Segment | undefined,
  number: number,
  index: number,
  delimiters: Delimiters
): string {
  const raw = segment?.fields[number];
  if (raw === undefined) return '';
  const parts = raw.split(delimiters.component);
  return unescapeValue(parts[index - 1] ?? '', delimiters);
}

/** Every repetition of a field, each still component-delimited. */
export function repetitions(
  segment: Segment | undefined,
  number: number,
  delimiters: Delimiters
): string[] {
  const raw = segment?.fields[number];
  if (raw === undefined || raw === '') return [];
  return raw.split(delimiters.repetition);
}

/** One component out of one repetition. */
export function repetitionComponent(
  repetition: string,
  index: number,
  delimiters: Delimiters
): string {
  return unescapeValue(repetition.split(delimiters.component)[index - 1] ?? '', delimiters);
}

/**
 * Builds a field out of components, dropping the trailing empty ones.
 *
 * `SMITH^^^^` and `SMITH` mean the same thing, and the shorter is what a
 * receiving system's log is readable in. Interior empties are kept, because
 * `SMITH^^JR` says something the trimmed form would not.
 */
export function joinComponents(parts: readonly string[], delimiters: Delimiters): string {
  const escaped = parts.map((part) => escapeValue(part, delimiters));
  let end = escaped.length;
  while (end > 0 && escaped[end - 1] === '') end -= 1;
  return escaped.slice(0, end).join(delimiters.component);
}

/** Serialises a message. Segments are separated by carriage return, as the standard says. */
export function renderMessage(message: Hl7Message): string {
  return message.segments.map((segment) => renderSegment(segment, message.delimiters)).join('\r');
}

function renderSegment(segment: Segment, delimiters: Delimiters): string {
  if (segment.id === 'MSH') {
    // The separator is field 1 and is written by being there; the encoding
    // characters are field 2 and are written as a value. Writing field 1 as a
    // value as well would put two separators after MSH.
    const rest = segment.fields.slice(2);
    return `MSH${delimiters.field}${rest.join(delimiters.field)}`;
  }

  const fields = segment.fields.slice(1);
  let end = fields.length;
  while (end > 0 && fields[end - 1] === '') end -= 1;
  return `${segment.id}${delimiters.field}${fields.slice(0, end).join(delimiters.field)}`;
}

/** Builds a segment from HL7-numbered fields, so `set(3, 'X')` is field 3. */
export function buildSegment(id: string, values: Readonly<Record<number, string>>): Segment {
  const numbers = Object.keys(values).map(Number);
  const highest = numbers.length === 0 ? 0 : Math.max(...numbers);
  const fields: string[] = Array.from({ length: highest + 1 }, () => '');
  for (const [number, value] of Object.entries(values)) {
    fields[Number(number)] = value;
  }
  return { id, fields };
}

/** A message built from segments, with the delimiters this codec writes. */
export function message(segments: readonly Segment[]): Hl7Message {
  return { delimiters: DEFAULT_DELIMITERS, segments };
}
