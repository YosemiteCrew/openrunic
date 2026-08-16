import { describe, expect, it } from 'vitest';

import {
  addressElement,
  codeSystemName,
  codedValue,
  effectiveTime,
  readAddress,
  readCodedValue,
  readStatus,
  readTelecom,
  telecom,
} from './datatypes.js';
import { CODE_SYSTEMS } from './oids.js';
import { attr, childNamed, element, textOf } from './xml/tree.js';
import { renderElement } from './xml/writer.js';

/**
 * The data types are where a document quietly becomes wrong. A code written
 * without its system, a span written closed when it is open, an address written
 * empty rather than omitted - each of those produces a document that validates
 * and says something other than what the chart says.
 */

describe('coded values', () => {
  it('writes a coded value with its system named', () => {
    const node = codedValue('code', {
      code: '7980',
      codeSystem: CODE_SYSTEMS.RXNORM.oid,
      display: 'Penicillin',
    });

    expect(attr(node, 'code')).toBe('7980');
    expect(attr(node, 'codeSystemName')).toBe('RxNorm');
  });

  /**
   * The tempting shortcut is to put the display name in `@code`. That asserts a
   * code in a system the document names, and the receiving system looks it up
   * and finds something else or nothing.
   */
  it('writes an uncoded value as nullFlavor with the text, not as a fake code', () => {
    const node = codedValue('code', { display: 'Shellfish' });

    expect(attr(node, 'nullFlavor')).toBe('OTH');
    expect(attr(node, 'code')).toBeUndefined();
    expect(textOf(childNamed(node, 'originalText'))).toBe('Shellfish');
  });

  it('treats a code with no system as uncoded, because a code alone means nothing', () => {
    expect(attr(codedValue('code', { code: '123', display: 'x' }), 'nullFlavor')).toBe('OTH');
  });

  it('carries extra attributes through, which is how xsi:type is set', () => {
    const node = codedValue('value', { display: 'x' }, { 'xsi:type': 'CD' });

    expect(attr(node, 'xsi:type')).toBe('CD');
  });

  it('leaves an OID it does not know unnamed rather than guessing', () => {
    expect(codeSystemName('1.2.3.4')).toBeUndefined();
    expect(codeSystemName(CODE_SYSTEMS.LOINC.oid)).toBe('LOINC');
  });

  it('reads a coded value back, falling back to the code when there is no display', () => {
    const node = element('code', { code: 'X', codeSystem: '1.2.3' });

    expect(readCodedValue(node)).toEqual({ code: 'X', codeSystem: '1.2.3', display: 'X' });
  });

  it('reads a nullFlavor value back by its text', () => {
    const node = element('code', { nullFlavor: 'OTH' }, [element('originalText', {}, ['Latex'])]);

    expect(readCodedValue(node)).toEqual({ display: 'Latex' });
  });

  it('reads nothing out of an element carrying nothing', () => {
    expect(readCodedValue(undefined)).toBeUndefined();
    expect(readCodedValue(element('code'))).toBeUndefined();
  });
});

describe('effective times', () => {
  it('writes a single instant as a value', () => {
    expect(attr(effectiveTime('2026-08-14T09:00:00Z'), 'value')).toBe('20260814090000+0000');
  });

  it('writes a closed span as low and high', () => {
    const node = effectiveTime('2026-01-01', '2026-02-01');

    expect(attr(childNamed(node, 'low'), 'value')).toBe('20260101');
    expect(attr(childNamed(node, 'high'), 'value')).toBe('20260201');
  });

  /**
   * "Still going" and "ended, and we did not record when" are different
   * statements. CDA distinguishes them with an explicit unknown high, and a
   * document that omits the element says the second.
   */
  it('writes an open span with an explicit unknown high', () => {
    const node = effectiveTime('2026-01-01', undefined, { openEnded: true });

    expect(attr(childNamed(node, 'high'), 'nullFlavor')).toBe('UNK');
  });

  it('writes nothing when there is no start', () => {
    expect(effectiveTime(undefined)).toBeUndefined();
    expect(effectiveTime('')).toBeUndefined();
  });
});

describe('status codes', () => {
  it('reads a status it recognises', () => {
    const node = element('act', {}, [element('statusCode', { code: 'active' })]);

    expect(readStatus(node)).toBe('active');
  });

  it('falls back rather than inventing a status it does not recognise', () => {
    const node = element('act', {}, [element('statusCode', { code: 'nonsense' })]);

    expect(readStatus(node)).toBe('completed');
    expect(readStatus(node, 'active')).toBe('active');
    expect(readStatus(undefined, 'suspended')).toBe('suspended');
  });
});

describe('addresses and telecoms', () => {
  it('writes the lines it has', () => {
    const node = addressElement({ line1: '1 Example Street', city: 'Testville' });

    expect(renderElement(node ?? element('x'), undefined)).toContain('1 Example Street');
  });

  /**
   * An empty `<addr/>` is a positive assertion that the practice holds an
   * address made of nothing. Omitting the element says it holds none, which is
   * what is true.
   */
  it('writes no element at all when there is nothing to put in it', () => {
    expect(addressElement(undefined)).toBeUndefined();
    expect(addressElement({})).toBeUndefined();
  });

  it('round-trips an address with two street lines', () => {
    const address = {
      line1: 'A',
      line2: 'B',
      city: 'C',
      state: 'D',
      postalCode: 'E',
      country: 'F',
    };

    expect(readAddress(addressElement(address))).toEqual(address);
  });

  it('reads nothing out of an absent or empty address', () => {
    expect(readAddress(undefined)).toBeUndefined();
    expect(readAddress(element('addr'))).toBeUndefined();
  });

  it('writes each telecom with the scheme its kind requires', () => {
    const nodes = telecom('+15550100', 'test@example.invalid');

    expect(attr(nodes[0], 'value')).toBe('tel:+15550100');
    expect(attr(nodes[1], 'value')).toBe('mailto:test@example.invalid');
  });

  it('writes no telecom for a blank one', () => {
    expect(telecom(undefined, undefined)).toEqual([]);
    expect(telecom('', '')).toEqual([]);
  });

  it('reads a telecom back without its scheme, and skips the other kind', () => {
    const nodes = telecom('+15550100', 'test@example.invalid');

    expect(readTelecom(nodes, 'tel')).toBe('+15550100');
    expect(readTelecom(nodes, 'mailto')).toBe('test@example.invalid');
    expect(readTelecom([], 'tel')).toBeUndefined();
    expect(readTelecom([element('telecom', { nullFlavor: 'UNK' })], 'tel')).toBeUndefined();
  });
});

describe('a span with only one end recorded', () => {
  /**
   * Ordinary in a real chart: a medication somebody stopped, first recorded at
   * the moment it was stopped. The stop date is exactly the half a receiving
   * prescriber needs, and an earlier version of this dropped the whole element
   * when the start was absent - losing it.
   */
  it('writes a known end even when the start was never recorded', () => {
    const node = effectiveTime(undefined, '2026-02-11');

    expect(attr(childNamed(node, 'low'), 'nullFlavor')).toBe('UNK');
    expect(attr(childNamed(node, 'high'), 'value')).toBe('20260211');
  });

  it('writes the same for an open-ended span with no start', () => {
    const node = effectiveTime('', '2026-02-11', { openEnded: true });

    expect(attr(childNamed(node, 'high'), 'value')).toBe('20260211');
  });

  /**
   * Both ends unknown is a claim that a span exists and neither boundary is
   * recorded. Omitting the element makes no claim, which is what is true.
   */
  it('writes nothing when neither end is recorded', () => {
    expect(effectiveTime(undefined, undefined)).toBeUndefined();
    expect(effectiveTime('', '', { openEnded: true })).toBeUndefined();
  });
});
