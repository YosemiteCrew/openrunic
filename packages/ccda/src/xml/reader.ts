import { CcdaError } from './errors.js';
import { element, type XmlElement, type XmlNode } from './tree.js';

/**
 * THE XML READER, AND WHY IT IS WRITTEN HERE.
 *
 * Importing a C-CDA means parsing a file another organisation sent, which is the
 * most hostile input this system accepts. The historic way that goes wrong is
 * XXE: a document declares an external entity, the parser resolves it, and a
 * clinical import becomes a file read or an outbound request from inside the
 * network. Every mainstream XML library has had that as a default at some point,
 * and every one of them fixes it by asking the caller to remember a flag.
 *
 * This reader has no flag to remember, because the machinery is absent:
 *
 * - `<!DOCTYPE` is refused outright, by name, with an error that says why. No
 *   internal subset is parsed, so no entity can be declared.
 * - The only entities are the five predefined ones and numeric character
 *   references. There is no entity table to add to, so there is nothing that
 *   could expand, nest, or resolve to a URI - which also rules out the billion
 *   laughs expansion, since an entity that cannot be declared cannot recurse.
 * - Nothing in this file opens a file, a socket, or a URL.
 *
 * It is a character scanner rather than a set of regular expressions, so there
 * is no backtracking to be catastrophic: every character is visited once and the
 * cost is linear in the length of the document.
 *
 * What it deliberately does NOT do is validate. Namespaces are kept as written
 * rather than resolved, unknown attributes are kept, and unknown elements are
 * kept. A CDA from a real vendor carries extensions, and a reader that rejected
 * what it did not recognise would reject most of the documents it exists to
 * accept.
 */

const PREDEFINED: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/** Parses a document and returns its root element. */
export function parseXml(source: string): XmlElement {
  const scanner = new Scanner(source);
  const root = scanner.readDocument();
  return root;
}

class Scanner {
  private readonly source: string;
  private index = 0;

  constructor(source: string) {
    // A leading byte-order mark is legal in a UTF-8 file and is not part of the
    // document. Systems that write one are common enough that refusing it would
    // reject correct files.
    this.source = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  }

  readDocument(): XmlElement {
    this.skipProlog();
    const root = this.readElement();
    this.skipMisc();
    if (this.index < this.source.length) {
      throw new CcdaError('Content after the root element', this.index);
    }
    return root;
  }

  /** Whitespace, the declaration, comments and processing instructions. */
  private skipProlog(): void {
    this.skipMisc();
    if (this.source.startsWith('<!DOCTYPE', this.index)) {
      throw new CcdaError(
        'This document carries a DOCTYPE. A clinical document has no use for one, and parsing it is how an XML external entity attack gets in, so it is refused rather than ignored.',
        this.index
      );
    }
  }

  private skipMisc(): void {
    for (;;) {
      this.skipWhitespace();
      if (this.source.startsWith('<!--', this.index)) {
        this.consumeUntil('-->', 'comment');
        continue;
      }
      if (this.source.startsWith('<?', this.index)) {
        this.consumeUntil('?>', 'processing instruction');
        continue;
      }
      return;
    }
  }

  private skipWhitespace(): void {
    while (this.index < this.source.length && isSpace(this.source[this.index])) this.index += 1;
  }

  private consumeUntil(terminator: string, what: string): void {
    const end = this.source.indexOf(terminator, this.index);
    if (end === -1) throw new CcdaError(`Unterminated ${what}`, this.index);
    this.index = end + terminator.length;
  }

  private readElement(): XmlElement {
    if (this.source[this.index] !== '<') {
      throw new CcdaError('Expected an element', this.index);
    }
    this.index += 1;

    const name = this.readName('element name');
    const attributes = this.readAttributes();

    if (this.source.startsWith('/>', this.index)) {
      this.index += 2;
      return element(name, attributes);
    }
    if (this.source[this.index] !== '>') {
      throw new CcdaError(`Malformed start tag for <${name}>`, this.index);
    }
    this.index += 1;

    const children = this.readChildren(name);
    return element(name, attributes, children);
  }

  private readAttributes(): Record<string, string> {
    const attributes: Record<string, string> = {};
    for (;;) {
      this.skipWhitespace();
      const next = this.source[this.index];
      if (next === undefined || next === '>' || next === '/') return attributes;

      const name = this.readName('attribute name');
      this.skipWhitespace();
      if (this.source[this.index] !== '=') {
        throw new CcdaError(`Attribute ${name} has no value`, this.index);
      }
      this.index += 1;
      this.skipWhitespace();

      const quote = this.source[this.index];
      if (quote !== '"' && quote !== "'") {
        throw new CcdaError(`Attribute ${name} is not quoted`, this.index);
      }
      this.index += 1;
      const end = this.source.indexOf(quote, this.index);
      if (end === -1) throw new CcdaError(`Unterminated value for ${name}`, this.index);

      // Last one wins, matching every mainstream parser. A duplicate attribute
      // is malformed XML, but rejecting the document over it would lose a chart
      // for a defect in the sender's serialiser.
      attributes[name] = this.decode(this.source.slice(this.index, end));
      this.index = end + 1;
    }
  }

  private readChildren(parent: string): XmlNode[] {
    const children: XmlNode[] = [];

    for (;;) {
      if (this.index >= this.source.length) {
        throw new CcdaError(`<${parent}> is never closed`, this.index);
      }

      if (this.source[this.index] !== '<') {
        const next = this.source.indexOf('<', this.index);
        const end = next === -1 ? this.source.length : next;
        const text = this.decode(this.source.slice(this.index, end));
        // Whitespace between elements is layout, not content. Keeping it would
        // put indentation into every narrative block this reader parses.
        if (text.trim() !== '') children.push(text);
        this.index = end;
        continue;
      }

      if (this.source.startsWith('</', this.index)) {
        this.index += 2;
        const name = this.readName('closing tag');
        this.skipWhitespace();
        if (this.source[this.index] !== '>') {
          throw new CcdaError(`Malformed closing tag for <${parent}>`, this.index);
        }
        this.index += 1;
        if (name !== parent) {
          throw new CcdaError(`<${parent}> is closed by </${name}>`, this.index);
        }
        return children;
      }

      if (this.source.startsWith('<!--', this.index)) {
        this.consumeUntil('-->', 'comment');
        continue;
      }
      if (this.source.startsWith('<![CDATA[', this.index)) {
        const start = this.index + '<![CDATA['.length;
        const end = this.source.indexOf(']]>', start);
        if (end === -1) throw new CcdaError('Unterminated CDATA section', this.index);
        // Verbatim: a CDATA section is defined as text that is not decoded.
        children.push(this.source.slice(start, end));
        this.index = end + ']]>'.length;
        continue;
      }
      if (this.source.startsWith('<?', this.index)) {
        this.consumeUntil('?>', 'processing instruction');
        continue;
      }
      if (this.source.startsWith('<!', this.index)) {
        throw new CcdaError(
          'Declarations are not read inside a document, because that is where an entity declaration would go.',
          this.index
        );
      }

      children.push(this.readElement());
    }
  }

  private readName(what: string): string {
    const start = this.index;
    while (this.index < this.source.length && isNameChar(this.source[this.index])) {
      this.index += 1;
    }
    if (this.index === start) throw new CcdaError(`Expected ${what}`, start);
    return this.source.slice(start, this.index);
  }

  /**
   * Resolves references.
   *
   * Five names and the numeric forms, and nothing else - an unknown reference is
   * an error rather than a passthrough, because `&myEntity;` reaching a
   * downstream system unresolved is how a value nobody checked ends up in a
   * chart. Numeric references are bounded by what XML permits, so a document
   * cannot use one to smuggle in a character the writer would have dropped.
   */
  private decode(raw: string): string {
    if (!raw.includes('&')) return raw;

    let out = '';
    let cursor = 0;
    for (;;) {
      const start = raw.indexOf('&', cursor);
      if (start === -1) {
        out += raw.slice(cursor);
        return out;
      }
      const end = raw.indexOf(';', start);
      if (end === -1 || end - start > 12) {
        throw new CcdaError('Unterminated entity reference', this.index);
      }

      out += raw.slice(cursor, start);
      out += this.resolve(raw.slice(start + 1, end));
      cursor = end + 1;
    }
  }

  private resolve(name: string): string {
    const predefined = PREDEFINED[name];
    if (predefined !== undefined) return predefined;

    if (name.startsWith('#')) {
      const hex = name.startsWith('#x') || name.startsWith('#X');
      const digits = name.slice(hex ? 2 : 1);
      const code = Number.parseInt(digits, hex ? 16 : 10);
      if (!Number.isInteger(code) || digits === '' || code < 0 || code > 0x10ffff) {
        throw new CcdaError(`Character reference &${name}; is out of range`, this.index);
      }
      return String.fromCodePoint(code);
    }

    throw new CcdaError(
      `Unknown entity &${name};. This reader declares no entities, so a document that uses one was built against a DTD this reader deliberately does not read.`,
      this.index
    );
  }
}

function isSpace(character: string | undefined): boolean {
  return character === ' ' || character === '\t' || character === '\n' || character === '\r';
}

/**
 * Name characters, generously.
 *
 * Wider than the XML production, on purpose: a name this accepts and the
 * specification does not is a name that would have been rejected on a document
 * this reader is not the validator for. Narrower would mean refusing the accented
 * element names that turn up in documents from outside English-speaking systems.
 */
function isNameChar(character: string | undefined): boolean {
  if (character === undefined) return false;
  if (character === ':' || character === '_' || character === '-' || character === '.') return true;
  const code = character.codePointAt(0) ?? 0;
  if (code >= 0x30 && code <= 0x39) return true;
  if (code >= 0x41 && code <= 0x5a) return true;
  if (code >= 0x61 && code <= 0x7a) return true;
  return code >= 0xc0;
}
