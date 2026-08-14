// The `preserve` attribute keeps this directive in the emitted .d.ts so that
// consumers resolve the ambient fhir4 globals without hoisting @types/fhir.
/// <reference types="fhir" preserve="true" />

import { compact, isPresentString } from './primitives.js';

/**
 * Builds a FHIR R4 literal {@link fhir4.Reference}, e.g.
 * `fhirReference('Patient', 'abc')` → `{ type: 'Patient', reference: 'Patient/abc' }`.
 * An optional `display` is included only when it has content.
 */
export function fhirReference(resourceType: string, id: string, display?: string): fhir4.Reference {
  return compact<fhir4.Reference>({
    type: resourceType,
    reference: `${resourceType}/${id}`,
    display,
  });
}

/**
 * Like {@link fhirReference}, but yields `undefined` for an absent id so a
 * mapper can assign the result straight into an optional element.
 */
export function optionalReference(
  resourceType: string,
  id: string | undefined,
  display?: string
): fhir4.Reference | undefined {
  return isPresentString(id) ? fhirReference(resourceType, id, display) : undefined;
}

/**
 * Reads the id out of a literal reference, optionally requiring a resource
 * type. A reference to a different type, a contained resource (`#id`), an
 * absolute URL or a reference carrying only a display yields `undefined`:
 * the domain stores foreign keys, and a key it cannot resolve is not a key.
 */
export function referenceId(
  reference: fhir4.Reference | undefined,
  expectedType?: string
): string | undefined {
  const literal = reference?.reference;
  if (!isPresentString(literal)) {
    return undefined;
  }
  const separator = literal.lastIndexOf('/');
  if (separator <= 0 || separator === literal.length - 1) {
    return undefined;
  }
  const type = literal.slice(0, separator);
  const id = literal.slice(separator + 1);
  if (expectedType !== undefined && type !== expectedType) {
    return undefined;
  }
  return id;
}

/** Reads the resource type out of a literal reference. */
export function referenceType(reference: fhir4.Reference | undefined): string | undefined {
  const literal = reference?.reference;
  if (!isPresentString(literal)) {
    return isPresentString(reference?.type) ? reference.type : undefined;
  }
  const separator = literal.lastIndexOf('/');
  return separator > 0 ? literal.slice(0, separator) : undefined;
}

/** Reads the first resolvable id from a list of references. */
export function firstReferenceId(
  references: fhir4.Reference[] | undefined,
  expectedType?: string
): string | undefined {
  for (const reference of references ?? []) {
    const id = referenceId(reference, expectedType);
    if (id !== undefined) {
      return id;
    }
  }
  return undefined;
}

/** Reads every resolvable id from a list of references. */
export function referenceIds(
  references: fhir4.Reference[] | undefined,
  expectedType?: string
): string[] {
  const ids: string[] = [];
  for (const reference of references ?? []) {
    const id = referenceId(reference, expectedType);
    if (id !== undefined) {
      ids.push(id);
    }
  }
  return ids;
}
