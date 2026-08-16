import type { Address, CodedValue, ClinicalStatus } from './domain.js';
import { CODE_SYSTEMS, type TemplateId } from './oids.js';
import { hl7Instant } from './time.js';
import { attr, childNamed, element, textOf, type XmlElement } from './xml/tree.js';

/**
 * The HL7 v3 data types, as the two or three elements each actually needs.
 *
 * CDA is mostly these: `II` for an identifier, `CD`/`CE` for a coded value, `TS`
 * for a timestamp, `IVL_TS` for a range. Writing them once here is what keeps
 * every section from having its own slightly different idea of how a code with
 * no code system should be written - which is the difference between a document
 * a receiving system reads and one it quietly drops entries from.
 */

/** `<templateId root="..." extension="..."/>`. */
export function templateId(template: TemplateId): XmlElement {
  return element('templateId', { root: template.root, extension: template.extension });
}

/**
 * `<id root="..."/>`.
 *
 * Our identifiers are UUIDs, and a UUID goes in `@root` on its own rather than
 * as an extension under an assigning-authority OID. That is the form the
 * specification gives for a globally unique identifier, and it is what stops a
 * receiving system from having to know who we are to tell two ids apart.
 */
export function id(value: string): XmlElement {
  return element('id', { root: value });
}

/**
 * A coded value.
 *
 * A code with no code system is written as `nullFlavor="OTH"` carrying the
 * original text, which is the specification's answer for "we know what this is
 * and we have no code for it". Writing the display name into `@code` instead -
 * the tempting shortcut - produces a document that asserts a code in a system it
 * names, and the receiving system will look it up and find something else or
 * nothing.
 */
export function codedValue(
  name: string,
  value: CodedValue,
  extra: Record<string, string> = {}
): XmlElement {
  if (value.code === undefined || value.code === '' || value.codeSystem === undefined) {
    return element(name, { nullFlavor: 'OTH', ...extra }, [
      element('originalText', {}, [value.display]),
    ]);
  }
  return element(name, {
    code: value.code,
    codeSystem: value.codeSystem,
    codeSystemName: codeSystemName(value.codeSystem),
    displayName: value.display,
    ...extra,
  });
}

/** The published name for an OID this codec knows, for readability only. */
export function codeSystemName(oid: string): string | undefined {
  return Object.values(CODE_SYSTEMS).find((system) => system.oid === oid)?.name;
}

/** Reads a coded element back, `nullFlavor` form included. */
export function readCodedValue(node: XmlElement | undefined): CodedValue | undefined {
  if (node === undefined) return undefined;

  const code = attr(node, 'code');
  const codeSystem = attr(node, 'codeSystem');
  const display = attr(node, 'displayName') ?? textOf(childNamed(node, 'originalText'));

  if (code === undefined || codeSystem === undefined) {
    return display === '' ? undefined : { display };
  }
  return { code, codeSystem, display: display === '' ? code : display };
}

/**
 * `<effectiveTime>`, in whichever of its three forms fits.
 *
 * A single instant is written as `@value`; a span with an end as `low`/`high`; a
 * span without one as `low` plus `high nullFlavor="UNK"`, which is how CDA says
 * "still going" and is different from omitting the high altogether - that would
 * say the span ended and we did not record when.
 */
export function effectiveTime(
  start: string | undefined,
  end?: string | undefined,
  options: { readonly openEnded?: boolean } = {}
): XmlElement | undefined {
  // Nothing at either end is nothing to say. An `effectiveTime` with two unknown
  // boundaries asserts that a span exists and that neither end is recorded,
  // which is a claim; omitting the element makes none.
  if ((start === undefined || start === '') && (end === undefined || end === '')) return undefined;

  if (start !== undefined && start !== '' && end === undefined && options.openEnded !== true) {
    return element('effectiveTime', { value: writeTime(start) });
  }

  return element('effectiveTime', {}, [
    // A known end with no known start is ordinary in a real chart - a medication
    // somebody stopped, first recorded at the moment it was stopped - and it is
    // exactly the half a receiving prescriber needs. Writing `low nullFlavor` is
    // how CDA says "it ended then, and when it began was never recorded"; the
    // alternative of omitting the element loses the stop date altogether.
    start === undefined || start === ''
      ? element('low', { nullFlavor: 'UNK' })
      : element('low', { value: writeTime(start) }),
    end === undefined
      ? element('high', { nullFlavor: 'UNK' })
      : element('high', { value: writeTime(end) }),
  ]);
}

/** Writes a date as a date and an instant as an instant. See time.ts. */
export function writeTime(value: string): string {
  return value.length === 10 ? value.replaceAll('-', '') : hl7Instant(value);
}

/** `<statusCode code="active"/>` and the rest of the act status vocabulary. */
export function statusCode(status: ClinicalStatus): XmlElement {
  return element('statusCode', { code: status });
}

/** Reads a status back, defaulting to `completed` the way the vocabulary does. */
export function readStatus(
  node: XmlElement | undefined,
  fallback: ClinicalStatus = 'completed'
): ClinicalStatus {
  const code = attr(childNamed(node, 'statusCode'), 'code');
  if (code === 'active' || code === 'completed' || code === 'aborted' || code === 'suspended') {
    return code;
  }
  return fallback;
}

/** `<addr>`, omitted entirely when there is nothing to put in it. */
export function addressElement(address: Address | undefined): XmlElement | undefined {
  if (address === undefined) return undefined;
  const parts: XmlElement[] = [];
  if (address.line1 !== undefined) parts.push(element('streetAddressLine', {}, [address.line1]));
  if (address.line2 !== undefined) parts.push(element('streetAddressLine', {}, [address.line2]));
  if (address.city !== undefined) parts.push(element('city', {}, [address.city]));
  if (address.state !== undefined) parts.push(element('state', {}, [address.state]));
  if (address.postalCode !== undefined) parts.push(element('postalCode', {}, [address.postalCode]));
  if (address.country !== undefined) parts.push(element('country', {}, [address.country]));
  return parts.length === 0 ? undefined : element('addr', { use: 'HP' }, parts);
}

/** Reads an address back. Undefined when the element carried nothing. */
export function readAddress(node: XmlElement | undefined): Address | undefined {
  if (node === undefined) return undefined;
  const lines = node.children
    .filter((child): child is XmlElement => typeof child !== 'string')
    .filter((child) => child.name === 'streetAddressLine')
    .map((child) => textOf(child));

  const address: Address = {
    ...(lines[0] === undefined ? {} : { line1: lines[0] }),
    ...(lines[1] === undefined ? {} : { line2: lines[1] }),
    ...textField(node, 'city', 'city'),
    ...textField(node, 'state', 'state'),
    ...textField(node, 'postalCode', 'postalCode'),
    ...textField(node, 'country', 'country'),
  };
  return Object.keys(address).length === 0 ? undefined : address;
}

function textField(node: XmlElement, tag: string, key: string): Record<string, string> {
  const value = textOf(childNamed(node, tag));
  return value === '' ? {} : { [key]: value };
}

/** `<telecom value="tel:..."/>`, with the scheme CDA expects. */
export function telecom(phone: string | undefined, email: string | undefined): XmlElement[] {
  const nodes: XmlElement[] = [];
  if (phone !== undefined && phone !== '') {
    nodes.push(element('telecom', { use: 'MC', value: `tel:${phone}` }));
  }
  if (email !== undefined && email !== '') {
    nodes.push(element('telecom', { value: `mailto:${email}` }));
  }
  return nodes;
}

/** Strips the `tel:` or `mailto:` scheme back off a telecom value. */
export function readTelecom(
  nodes: readonly XmlElement[],
  scheme: 'tel' | 'mailto'
): string | undefined {
  for (const node of nodes) {
    const value = attr(node, 'value');
    if (value?.startsWith(`${scheme}:`) === true) return value.slice(scheme.length + 1);
  }
  return undefined;
}

/** `<name><given>..</given><family>..</family></name>`. */
export function personName(given: string, family: string): XmlElement {
  return element('name', {}, [element('given', {}, [given]), element('family', {}, [family])]);
}
