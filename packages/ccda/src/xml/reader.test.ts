import { describe, expect, it } from 'vitest';

import { CcdaError } from './errors.js';
import { parseXml } from './reader.js';
import { attr, childNamed, childrenNamed, textOf } from './tree.js';

/**
 * The reader parses documents other organisations send, so half of these are
 * about what it refuses. The other half are about what it must not refuse: a
 * parser that rejects a legal document is a practice that cannot receive a
 * chart, and "your file is invalid" is a sentence nobody on the other end can
 * act on.
 */

describe('what it refuses', () => {
  /**
   * The one that matters. A DOCTYPE is where an external entity is declared, and
   * an XML parser that resolves one turns a clinical import into a file read or
   * an outbound request from inside the network. There is no legitimate DOCTYPE
   * on a CDA, so it is refused by name rather than skipped.
   */
  it('refuses a DOCTYPE outright', () => {
    const attack = `<?xml version="1.0"?>
<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
<ClinicalDocument><title>&xxe;</title></ClinicalDocument>`;

    expect(() => parseXml(attack)).toThrow(CcdaError);
    expect(() => parseXml(attack)).toThrow(/DOCTYPE/);
  });

  it('refuses a DOCTYPE that declares nothing, because the mechanism is the risk', () => {
    expect(() => parseXml('<!DOCTYPE ClinicalDocument><ClinicalDocument/>')).toThrow(/DOCTYPE/);
  });

  /**
   * Billion laughs works by declaring nested entities. There is no entity table
   * here to declare into, so the expansion has nowhere to start - and the
   * document is refused at the reference rather than at some size limit that
   * would have to be tuned.
   */
  it('refuses an entity it does not know, rather than passing it through', () => {
    expect(() => parseXml('<a>&lol;</a>')).toThrow(/Unknown entity/);
  });

  it('refuses a declaration inside the document, where an entity would hide', () => {
    expect(() => parseXml('<a><!ENTITY x "y"><b/></a>')).toThrow(/Declarations are not read/);
  });

  it('refuses mismatched tags', () => {
    expect(() => parseXml('<a><b></c></a>')).toThrow(/closed by/);
  });

  it('refuses an unclosed element', () => {
    expect(() => parseXml('<a><b></b>')).toThrow(/never closed/);
  });

  it('refuses an unquoted attribute', () => {
    expect(() => parseXml('<a code=1/>')).toThrow(/not quoted/);
  });

  it('refuses an attribute with no value', () => {
    expect(() => parseXml('<a code/>')).toThrow(/no value/);
  });

  it('refuses content after the root element', () => {
    expect(() => parseXml('<a/><b/>')).toThrow(/after the root/);
  });

  it('refuses an unterminated comment', () => {
    expect(() => parseXml('<a><!-- forever</a>')).toThrow(/Unterminated comment/);
  });

  it('refuses an unterminated CDATA section', () => {
    expect(() => parseXml('<a><![CDATA[forever</a>')).toThrow(/Unterminated CDATA/);
  });

  it('refuses a character reference outside the Unicode range', () => {
    expect(() => parseXml('<a>&#1114112;</a>')).toThrow(/out of range/);
  });

  it('reports where it gave up', () => {
    try {
      parseXml('<a><b></c></a>');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(CcdaError);
      expect((error as CcdaError).offset).toBeGreaterThan(0);
      expect((error as CcdaError).message).toContain('offset');
    }
  });
});

describe('what it must not refuse', () => {
  it('reads an element with attributes in either quote style', () => {
    const root = parseXml(`<code code="1" codeSystem='2'/>`);

    expect(attr(root, 'code')).toBe('1');
    expect(attr(root, 'codeSystem')).toBe('2');
  });

  it('reads a self-closing element and a nested one', () => {
    const root = parseXml('<a><b/><c><d/></c></a>');

    expect(childrenNamed(root, 'b')).toHaveLength(1);
    expect(childNamed(childNamed(root, 'c'), 'd')).toBeDefined();
  });

  it('resolves the five predefined entities and both numeric forms', () => {
    const root = parseXml('<a>&amp;&lt;&gt;&quot;&apos;&#65;&#x42;</a>');

    expect(textOf(root)).toBe('&<>"\'AB');
  });

  it('resolves entities inside attribute values too', () => {
    const root = parseXml('<a title="Smith &amp; Sons"/>');

    expect(attr(root, 'title')).toBe('Smith & Sons');
  });

  it('takes a CDATA section verbatim, which is what a CDATA section is for', () => {
    const root = parseXml('<a><![CDATA[1 < 2 && 3 > 2]]></a>');

    expect(textOf(root)).toBe('1 < 2 && 3 > 2');
  });

  it('skips the declaration, comments and processing instructions', () => {
    const root = parseXml(
      `<?xml version="1.0" encoding="UTF-8"?>\n<!-- a note -->\n<?target data?>\n<a><!-- another --><b/></a>`
    );

    expect(root.name).toBe('a');
    expect(childrenNamed(root, 'b')).toHaveLength(1);
  });

  it('skips a byte-order mark, which real files carry', () => {
    expect(parseXml('﻿<a/>').name).toBe('a');
  });

  it('keeps namespace prefixes as written, because CDA depends on them', () => {
    const root = parseXml('<a xmlns:xsi="urn:x"><value xsi:type="PQ" value="1"/></a>');

    expect(attr(childNamed(root, 'value'), 'xsi:type')).toBe('PQ');
    expect(attr(root, 'xmlns:xsi')).toBe('urn:x');
  });

  it('drops whitespace between elements and keeps it inside text', () => {
    const root = parseXml('<a>\n  <b>  spaced  out  </b>\n</a>');

    expect(root.children).toHaveLength(1);
    expect(textOf(childNamed(root, 'b'))).toBe('spaced  out');
  });

  it('keeps mixed content, which is what a narrative block is made of', () => {
    const root = parseXml('<paragraph>before <content>middle</content> after</paragraph>');

    expect(root.children).toHaveLength(3);
    expect(textOf(root)).toBe('before middle after');
  });

  it('reads accented element and attribute names', () => {
    const root = parseXml('<pruébame título="sí"/>');

    expect(root.name).toBe('pruébame');
    expect(attr(root, 'título')).toBe('sí');
  });

  /**
   * A duplicate attribute is malformed XML that generators do emit. Refusing the
   * document over it would lose a chart because somebody else's serialiser has a
   * bug, so the last value wins the way every mainstream parser resolves it.
   */
  it('takes the last of a duplicated attribute rather than refusing', () => {
    expect(attr(parseXml('<a code="1" code="2"/>'), 'code')).toBe('2');
  });
});

describe('the cost of parsing', () => {
  /**
   * A scanner visits each character once, so the work is linear. This is the
   * regression test for that property: the pathological input for a
   * regex-based parser - deep nesting and long runs of the characters that
   * would anchor a backtracking match - stays fast here.
   */
  it('stays linear on input that would make a backtracking parser hang', () => {
    const depth = 2_000;
    const nested = `${'<a>'.repeat(depth)}${'x'.repeat(50_000)}${'</a>'.repeat(depth)}`;

    const started = performance.now();
    const root = parseXml(nested);
    const elapsed = performance.now() - started;

    expect(root.name).toBe('a');
    expect(elapsed).toBeLessThan(2_000);
  });
});
