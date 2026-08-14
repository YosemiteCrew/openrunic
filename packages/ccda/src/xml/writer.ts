import { isElement, type XmlElement, type XmlNode } from './tree.js';

/**
 * Serialises the tree.
 *
 * Hand-written rather than borrowed, for the same reason the reader is: a
 * document that leaves this building is one another vendor will parse, so the
 * two things that matter are that the escaping is right and that the output is
 * deterministic. Determinism is not cosmetic - it is what makes a round-trip
 * test comparable, a diff between two exports readable, and a signature over the
 * document reproducible.
 *
 * Attributes are written in insertion order rather than sorted. CDA convention
 * puts `root` before `extension` and `code` before `codeSystem`, and a reader
 * skimming for a template id should find it where every other vendor's document
 * has it.
 */

/**
 * Whether a code point is one XML 1.0 permits at all.
 *
 * `Char ::= #x9 | #xA | #xD | [#x20-#xD7FF] | [#xE000-#xFFFD] | [#x10000-#x10FFFF]`.
 * Everything else - the C0 control range, unpaired surrogates, the two
 * non-characters at the end of the BMP - has no escape and no representation: a
 * document containing one is not XML, and no receiving system will read it.
 */
function isXmlChar(code: number): boolean {
  if (code === 0x09 || code === 0x0a || code === 0x0d) return true;
  if (code >= 0x20 && code <= 0xd7ff) return true;
  if (code >= 0xe000 && code <= 0xfffd) return true;
  return code >= 0x10000 && code <= 0x10ffff;
}

/**
 * Escapes text, dropping what XML cannot carry.
 *
 * Dropping is the only option rather than the lenient one. A stray control
 * character in a name field - and they do turn up, out of scanned intake forms
 * and pasted spreadsheet cells - cannot be escaped, so the choice is between a
 * document missing one invisible character and a document no parser will accept.
 *
 * `>` is escaped although only `]]>` strictly requires it, because a receiving
 * system that mishandles a bare `>` is a real system and the cost of being
 * conservative here is three characters.
 */
export function escapeText(value: string): string {
  let out = '';
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (!isXmlChar(code)) continue;
    if (character === '&') out += '&amp;';
    else if (character === '<') out += '&lt;';
    else if (character === '>') out += '&gt;';
    else out += character;
  }
  return out;
}

/** Attribute values additionally cannot carry the quote they are delimited by. */
export function escapeAttribute(value: string): string {
  return escapeText(value).replaceAll('"', '&quot;');
}

const DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';

export interface RenderOptions {
  /** Two spaces per level. Off produces one line, for a hash or a signature. */
  readonly indent?: boolean;
}

/** Serialises a document, declaration included. */
export function renderDocument(root: XmlElement, options: RenderOptions = {}): string {
  return `${DECLARATION}\n${renderElement(root, options.indent === false ? undefined : 0)}\n`;
}

/**
 * Serialises one element. `depth` undefined means no indentation at all.
 *
 * An element whose children are all text stays on one line: breaking
 * `<title>Allergies</title>` across three lines would put whitespace inside the
 * value, and whitespace inside a value is a difference a receiving system may or
 * may not collapse.
 */
export function renderElement(node: XmlElement, depth: number | undefined): string {
  const pad = depth === undefined ? '' : '  '.repeat(depth);
  const attributes = Object.entries(node.attributes)
    .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
    .join('');

  if (node.children.length === 0) return `${pad}<${node.name}${attributes}/>`;

  const inline = node.children.every((child) => !isElement(child));
  if (inline) {
    const text = node.children.map((child) => escapeText(child as string)).join('');
    return `${pad}<${node.name}${attributes}>${text}</${node.name}>`;
  }

  const nested = node.children
    .map((child) => renderChild(child, depth))
    .join(depth === undefined ? '' : '\n');
  return depth === undefined
    ? `<${node.name}${attributes}>${nested}</${node.name}>`
    : `${pad}<${node.name}${attributes}>\n${nested}\n${pad}</${node.name}>`;
}

function renderChild(child: XmlNode, depth: number | undefined): string {
  if (isElement(child)) return renderElement(child, depth === undefined ? undefined : depth + 1);
  // Mixed content: a text run beside elements. Narrative blocks are the only
  // place CDA produces it, and the text is written where it sits rather than
  // indented, because indentation would change the value.
  return escapeText(child);
}
