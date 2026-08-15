import { Hl7Error } from './errors.js';

/**
 * THE DELIMITERS, WHICH THE MESSAGE DECLARES ABOUT ITSELF.
 *
 * HL7 v2 does not fix its own punctuation. `MSH-1` is the field separator, and
 * it is whatever character sits in position 4 of the message; `MSH-2` is the
 * four characters used for components, repetitions, escapes and subcomponents.
 * Almost every message in the world says `|^~\&`, and a parser that assumes so
 * is a parser that silently mangles the one interface that does not.
 *
 * So the delimiters are read from each message and threaded through everything,
 * and the writer emits the same set it was given rather than a house default.
 */

export interface Delimiters {
  readonly field: string;
  readonly component: string;
  readonly repetition: string;
  readonly escape: string;
  readonly subcomponent: string;
}

/** What `|^~\&` means, and what almost every message on earth actually sends. */
export const DEFAULT_DELIMITERS: Delimiters = {
  field: '|',
  component: '^',
  repetition: '~',
  escape: '\\',
  subcomponent: '&',
};

/**
 * Reads the delimiters out of an MSH segment.
 *
 * The segment must be at least `MSH` plus five punctuation characters, and the
 * five must be distinct: a message declaring the same character for fields and
 * components cannot be unambiguously parsed at all, and guessing which one was
 * meant would produce a plausible message with the wrong values in it.
 */
export function readDelimiters(msh: string): Delimiters {
  if (!msh.startsWith('MSH')) {
    throw new Hl7Error('A message must begin with MSH.');
  }
  if (msh.length < 8) {
    throw new Hl7Error('The MSH segment is too short to declare its delimiters.');
  }

  const delimiters: Delimiters = {
    field: msh.charAt(3),
    component: msh.charAt(4),
    repetition: msh.charAt(5),
    escape: msh.charAt(6),
    subcomponent: msh.charAt(7),
  };

  const distinct = new Set(Object.values(delimiters));
  if (distinct.size !== 5) {
    throw new Hl7Error(
      `This message declares a delimiter twice (${Object.values(delimiters).join('')}), so its fields cannot be told apart.`
    );
  }
  return delimiters;
}

/**
 * The escape sequences HL7 defines for its own punctuation.
 *
 * A patient named `O'Brien & Sons` and an address containing a pipe both have to
 * survive a format that gives those characters structural meaning, and the
 * sequences below are how. `\X..\` carries arbitrary bytes as hex, which is how
 * a receiving system gets a character the sender's encoding could not name.
 */
function escapeMap(delimiters: Delimiters): ReadonlyMap<string, string> {
  return new Map([
    [delimiters.field, 'F'],
    [delimiters.component, 'S'],
    [delimiters.subcomponent, 'T'],
    [delimiters.repetition, 'R'],
    [delimiters.escape, 'E'],
  ]);
}

/** Escapes a value so it can carry the delimiters as data. */
export function escapeValue(value: string, delimiters: Delimiters): string {
  const map = escapeMap(delimiters);
  let out = '';
  for (const character of value) {
    const code = map.get(character);
    out += code === undefined ? character : `${delimiters.escape}${code}${delimiters.escape}`;
  }
  return out;
}

/**
 * Resolves escape sequences.
 *
 * An unknown sequence is left exactly as it arrived rather than dropped or
 * guessed at. `\Zxyz\` is a locally-defined escape somebody's interface uses,
 * and a value silently missing a run of characters is far worse for the person
 * reading the chart than one carrying a sequence they can look up.
 */
export function unescapeValue(value: string, delimiters: Delimiters): string {
  if (!value.includes(delimiters.escape)) return value;

  const codes = new Map([...escapeMap(delimiters)].map(([character, code]) => [code, character]));
  let out = '';
  let index = 0;

  while (index < value.length) {
    const character = value.charAt(index);
    if (character !== delimiters.escape) {
      out += character;
      index += 1;
      continue;
    }

    const end = value.indexOf(delimiters.escape, index + 1);
    if (end === -1) {
      // An unterminated escape is the sender's defect; carrying the rest
      // verbatim keeps the value readable rather than truncating it.
      out += value.slice(index);
      return out;
    }

    const sequence = value.slice(index + 1, end);
    out += resolveSequence(sequence, codes, delimiters);
    index = end + 1;
  }

  return out;
}

function resolveSequence(
  sequence: string,
  codes: ReadonlyMap<string, string>,
  delimiters: Delimiters
): string {
  const known = codes.get(sequence);
  if (known !== undefined) return known;

  // `\X0D\` and friends: bytes as hex, which is how a sender carries a
  // character its own encoding could not name.
  if (/^X[0-9A-Fa-f]+$/.test(sequence) && sequence.length % 2 === 1) {
    const bytes = sequence.slice(1).match(/../g) ?? [];
    return bytes.map((byte) => String.fromCharCode(Number.parseInt(byte, 16))).join('');
  }

  // Formatting commands in a formatted-text field. `.br` is a line break and is
  // worth honouring because it is what makes a multi-line result readable.
  if (sequence === '.br') return '\n';

  return `${delimiters.escape}${sequence}${delimiters.escape}`;
}
