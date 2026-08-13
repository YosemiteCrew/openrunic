// The `preserve` attribute keeps this directive in the emitted .d.ts so that
// consumers resolve the ambient fhir4 globals without hoisting @types/fhir.
/// <reference types="fhir" preserve="true" />

/**
 * Shared element builders and readers used by every resource mapper.
 *
 * Three rules hold across this file, and they are what make the mappers emit
 * FHIR-valid JSON without each one restating the same guards:
 *
 * 1. A builder returns `undefined` rather than an empty element. FHIR JSON
 *    forbids empty arrays and empty-string values, and an element with no
 *    content is not a valid element.
 * 2. {@link compact} drops keys whose value is absent, an empty string, an
 *    empty array or an empty object, so a mapper can assemble a resource
 *    optimistically and let the guard run once at the end.
 * 3. Readers treat an empty string in an incoming resource as absent, so a
 *    sloppy upstream server degrades to the same domain shape as a silent one.
 */

/** True when `value` is a non-empty string. Empty strings are not FHIR values. */
export function isPresentString(value: string | null | undefined): value is string {
  return typeof value === 'string' && value !== '';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Returns a copy of `input` without keys that FHIR JSON must not carry:
 * `undefined`, `null`, empty strings, empty arrays and empty objects.
 */
export function compact<T extends object>(input: T): T {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (typeof value === 'string' && value === '') {
      continue;
    }
    if (Array.isArray(value) && value.length === 0) {
      continue;
    }
    if (isPlainObject(value) && Object.keys(value).length === 0) {
      continue;
    }
    output[key] = value;
  }
  return output as T;
}

/**
 * Returns `undefined` when the compacted element has no content, so callers can
 * assign the result straight into a resource and let {@link compact} drop it.
 */
export function compactOrUndefined<T extends object>(input: T): T | undefined {
  const compacted = compact(input);
  return Object.keys(compacted).length > 0 ? compacted : undefined;
}

/**
 * Assigns `value` to `target[key]` only when it is defined. Mappers use this
 * for optional domain fields: writing `undefined` would create a key that
 * `toStrictEqual` sees but `JSON.stringify` drops, and round-trip tests would
 * then pass on shapes that differ.
 */
export function setOptional<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: T[K] | undefined
): void {
  if (value !== undefined) {
    target[key] = value;
  }
}

/** Drops absent entries from a list of built elements. */
export function present<T>(values: readonly (T | undefined)[]): T[] {
  return values.filter((value): value is T => value !== undefined);
}

// ---------------------------------------------------------------------------
// Builders: domain -> FHIR
// ---------------------------------------------------------------------------

/** Builds a `Coding`, or `undefined` when there is nothing to code. */
export function coding(
  system: string | undefined,
  code: string | undefined,
  display?: string
): fhir4.Coding | undefined {
  if (!isPresentString(code)) {
    return undefined;
  }
  return compactOrUndefined<fhir4.Coding>({ system, code, display });
}

/** Builds a single-coding `CodeableConcept` with optional text. */
export function codeableConcept(input: {
  system?: string | undefined;
  code?: string | undefined;
  display?: string | undefined;
  text?: string | undefined;
}): fhir4.CodeableConcept | undefined {
  const single = coding(input.system, input.code, input.display);
  return compactOrUndefined<fhir4.CodeableConcept>({
    coding: single ? [single] : undefined,
    text: input.text,
  });
}

/** Builds one `CodeableConcept` per code in `codes`, all in the same system. */
export function codeableConcepts(
  codes: readonly string[] | undefined,
  system?: string
): fhir4.CodeableConcept[] {
  if (codes === undefined) {
    return [];
  }
  return present(codes.map((code) => codeableConcept({ system, code })));
}

/** Builds an `Identifier`. */
export function identifier(input: {
  system?: string | undefined;
  value?: string | undefined;
  use?: fhir4.Identifier['use'] | undefined;
  typeCode?: string | undefined;
  typeSystem?: string | undefined;
  typeDisplay?: string | undefined;
  assigner?: string | undefined;
  period?: fhir4.Period | undefined;
}): fhir4.Identifier | undefined {
  if (!isPresentString(input.value)) {
    return undefined;
  }
  return compactOrUndefined<fhir4.Identifier>({
    use: input.use,
    type: codeableConcept({
      system: input.typeSystem,
      code: input.typeCode,
      display: input.typeDisplay,
    }),
    system: input.system,
    value: input.value,
    period: input.period,
    assigner: isPresentString(input.assigner) ? { display: input.assigner } : undefined,
  });
}

/** Builds a `HumanName`. Empty given-name entries are dropped, not emitted. */
export function humanName(input: {
  family?: string | undefined;
  given?: readonly (string | undefined)[] | undefined;
  prefix?: string | undefined;
  suffix?: string | undefined;
  text?: string | undefined;
  use?: fhir4.HumanName['use'] | undefined;
}): fhir4.HumanName | undefined {
  const given = (input.given ?? []).filter(isPresentString);
  const content = compact<fhir4.HumanName>({
    text: input.text,
    family: input.family,
    given: given.length > 0 ? given : undefined,
    prefix: isPresentString(input.prefix) ? [input.prefix] : undefined,
    suffix: isPresentString(input.suffix) ? [input.suffix] : undefined,
  });
  if (Object.keys(content).length === 0) {
    return undefined;
  }
  return compact<fhir4.HumanName>({ use: input.use, ...content });
}

/** Builds an `Address` from the flat address columns the domain stores. */
export function address(input: {
  line1?: string | undefined;
  line2?: string | undefined;
  city?: string | undefined;
  state?: string | undefined;
  postalCode?: string | undefined;
  country?: string | undefined;
  use?: fhir4.Address['use'] | undefined;
}): fhir4.Address | undefined {
  const line = [input.line1, input.line2].filter(isPresentString);
  const content = compact<fhir4.Address>({
    line: line.length > 0 ? line : undefined,
    city: input.city,
    state: input.state,
    postalCode: input.postalCode,
    country: input.country,
  });
  if (Object.keys(content).length === 0) {
    return undefined;
  }
  return compact<fhir4.Address>({ use: input.use, ...content });
}

/** Builds a `ContactPoint`. */
export function contactPoint(
  system: fhir4.ContactPoint['system'],
  value: string | undefined,
  use?: fhir4.ContactPoint['use']
): fhir4.ContactPoint | undefined {
  if (!isPresentString(value)) {
    return undefined;
  }
  return compactOrUndefined<fhir4.ContactPoint>({ system, value, use });
}

/** Builds a `Period`. */
export function period(start?: string, end?: string): fhir4.Period | undefined {
  return compactOrUndefined<fhir4.Period>({ start, end });
}

/** UCUM, the unit system FHIR quantities use unless a mapper says otherwise. */
export const UCUM_SYSTEM = 'http://unitsofmeasure.org';

/** Builds a `Quantity` with a UCUM unit. */
export function quantity(
  value: number | undefined,
  unit?: string,
  comparator?: fhir4.Quantity['comparator']
): fhir4.Quantity | undefined {
  if (value === undefined) {
    return undefined;
  }
  return compactOrUndefined<fhir4.Quantity>({
    value,
    comparator,
    unit,
    system: isPresentString(unit) ? UCUM_SYSTEM : undefined,
    code: unit,
  });
}

/** Builds a `SimpleQuantity` range bound with no comparator. */
export function simpleQuantity(
  value: number | undefined,
  unit?: string
): fhir4.Quantity | undefined {
  return quantity(value, unit);
}

/** Builds `Money` from integer cents, the only representation the domain uses. */
export function money(cents: number | undefined, currency = 'USD'): fhir4.Money | undefined {
  if (cents === undefined) {
    return undefined;
  }
  return { value: cents / 100, currency };
}

/** Builds a single-element `Annotation` list, or an empty list. */
export function annotations(text: string | undefined): fhir4.Annotation[] {
  return isPresentString(text) ? [{ text }] : [];
}

// ---------------------------------------------------------------------------
// Readers: FHIR -> domain
// ---------------------------------------------------------------------------

/** Reads a non-empty string, mapping `''` to `undefined`. */
export function readString(value: string | undefined): string | undefined {
  return isPresentString(value) ? value : undefined;
}

/**
 * Reads the first code from a `CodeableConcept`, optionally restricted to one
 * system. An unqualified read takes the first coding, which is where every
 * mapper in this package puts the code it wrote.
 */
export function readCode(
  concept: fhir4.CodeableConcept | undefined,
  system?: string
): string | undefined {
  const codings = concept?.coding ?? [];
  for (const entry of codings) {
    if (system !== undefined && entry.system !== system) {
      continue;
    }
    if (isPresentString(entry.code)) {
      return entry.code;
    }
  }
  return undefined;
}

/** Reads the display of the first matching coding. */
export function readCodeDisplay(
  concept: fhir4.CodeableConcept | undefined,
  system?: string
): string | undefined {
  const codings = concept?.coding ?? [];
  for (const entry of codings) {
    if (system !== undefined && entry.system !== system) {
      continue;
    }
    if (isPresentString(entry.display)) {
      return entry.display;
    }
  }
  return undefined;
}

/** Reads the system of the first coding that carries a code. */
export function readCodeSystem(concept: fhir4.CodeableConcept | undefined): string | undefined {
  for (const entry of concept?.coding ?? []) {
    if (isPresentString(entry.code)) {
      return readString(entry.system);
    }
  }
  return undefined;
}

/** Reads `text`, or the first coding's display when `text` is absent. */
export function readConceptText(concept: fhir4.CodeableConcept | undefined): string | undefined {
  return readString(concept?.text) ?? readCodeDisplay(concept);
}

/** Reads one code per `CodeableConcept` in a list, dropping uncoded entries. */
export function readCodes(
  concepts: fhir4.CodeableConcept[] | undefined,
  system?: string
): string[] {
  return present((concepts ?? []).map((concept) => readCode(concept, system)));
}

/** Reads the value of the first identifier in `system`. */
export function readIdentifier(
  identifiers: fhir4.Identifier[] | undefined,
  system: string
): string | undefined {
  for (const entry of identifiers ?? []) {
    if (entry.system === system && isPresentString(entry.value)) {
      return entry.value;
    }
  }
  return undefined;
}

/** Reads the value of the first identifier carrying `typeCode` in `type.coding`. */
export function readIdentifierByType(
  identifiers: fhir4.Identifier[] | undefined,
  typeCode: string
): string | undefined {
  for (const entry of identifiers ?? []) {
    const codes = (entry.type?.coding ?? []).map((item) => item.code);
    if (codes.includes(typeCode) && isPresentString(entry.value)) {
      return entry.value;
    }
  }
  return undefined;
}

/** Reads the first contact point of a given system. */
export function readContactPoint(
  telecom: fhir4.ContactPoint[] | undefined,
  system: fhir4.ContactPoint['system'],
  use?: fhir4.ContactPoint['use']
): string | undefined {
  for (const entry of telecom ?? []) {
    if (entry.system !== system) {
      continue;
    }
    if (use !== undefined && entry.use !== use) {
      continue;
    }
    if (isPresentString(entry.value)) {
      return entry.value;
    }
  }
  return undefined;
}

/** Reads the numeric value of a `Quantity`. */
export function readQuantityValue(value: fhir4.Quantity | undefined): number | undefined {
  return typeof value?.value === 'number' ? value.value : undefined;
}

/** Reads the unit of a `Quantity`, preferring `code` over the display `unit`. */
export function readQuantityUnit(value: fhir4.Quantity | undefined): string | undefined {
  return readString(value?.code) ?? readString(value?.unit);
}

/** Reads `Money` back to integer cents. */
export function readCents(value: fhir4.Money | undefined): number | undefined {
  return typeof value?.value === 'number' ? Math.round(value.value * 100) : undefined;
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function base64Char(index: number): string {
  return BASE64_ALPHABET[index] ?? '';
}

/**
 * Converts a hex digest to base64, which is how FHIR carries `Attachment.hash`.
 * Returns `undefined` for anything that is not an even-length hex string, so a
 * malformed digest is omitted rather than serialized as a lie.
 */
export function hexToBase64(hex: string | undefined): string | undefined {
  if (hex === undefined || hex.length === 0 || hex.length % 2 !== 0) {
    return undefined;
  }
  if (!/^[0-9a-fA-F]+$/.test(hex)) {
    return undefined;
  }
  const bytes: number[] = [];
  for (let index = 0; index < hex.length; index += 2) {
    bytes.push(Number.parseInt(hex.slice(index, index + 2), 16));
  }
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    output += base64Char(first >> 2);
    output += base64Char(((first & 0b11) << 4) | ((second ?? 0) >> 4));
    output +=
      second === undefined ? '=' : base64Char(((second & 0b1111) << 2) | ((third ?? 0) >> 6));
    output += third === undefined ? '=' : base64Char(third & 0b111111);
  }
  return output;
}

/**
 * Converts a base64 digest back to lowercase hex. Digests therefore round-trip
 * in lowercase, which is the casing Openrunic stores.
 */
export function base64ToHex(value: string | undefined): string | undefined {
  if (value === undefined || value.length === 0) {
    return undefined;
  }
  const cleaned = value.replace(/=+$/, '');
  let buffer = 0;
  let bits = 0;
  let hex = '';
  for (const character of cleaned) {
    const index = BASE64_ALPHABET.indexOf(character);
    if (index < 0) {
      return undefined;
    }
    buffer = (buffer << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      hex += ((buffer >> bits) & 0xff).toString(16).padStart(2, '0');
    }
  }
  return hex.length > 0 ? hex : undefined;
}

/** Reads the text of the first annotation. */
export function readAnnotation(notes: fhir4.Annotation[] | undefined): string | undefined {
  for (const note of notes ?? []) {
    if (isPresentString(note.text)) {
      return note.text;
    }
  }
  return undefined;
}
