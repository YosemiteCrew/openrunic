// The `preserve` attribute keeps this directive in the emitted .d.ts so that
// consumers resolve the ambient fhir4 globals without hoisting @types/fhir.
/// <reference types="fhir" preserve="true" />

import type { EnumMapping } from './enum-mapping.js';
import { compactOrUndefined, isPresentString, present } from './primitives.js';

/**
 * Extension URLs, both the US Core ones Openrunic populates and the small
 * Openrunic-local set.
 *
 * The local set exists for exactly one reason: an Openrunic workflow enum is
 * sometimes wider than the FHIR value set it serializes into, and a mapper that
 * collapsed the difference would make the ADR-0002 round-trip test a lie. The
 * standard element keeps a valid FHIR code; the precise domain value rides in
 * the extension, and only when the plain mapping would lose it.
 */
export const OPENRUNIC_EXTENSION_BASE = 'https://openrunic.org/fhir/StructureDefinition/';

/** Namespace for Openrunic-local code systems referenced from `CodeableConcept`. */
export const OPENRUNIC_CODE_SYSTEM_BASE = 'https://openrunic.org/fhir/CodeSystem/';

/** Builds an Openrunic extension URL. */
export function openrunicExtension(name: string): string {
  return `${OPENRUNIC_EXTENSION_BASE}${name}`;
}

/** Builds an Openrunic code system URI. */
export function openrunicCodeSystem(name: string): string {
  return `${OPENRUNIC_CODE_SYSTEM_BASE}${name}`;
}

/** Carries the exact domain status when the FHIR status value set is narrower. */
export const LOCAL_STATUS_EXTENSION = openrunicExtension('local-status');

/** Carries the exact domain priority when the FHIR priority value set is narrower. */
export const LOCAL_PRIORITY_EXTENSION = openrunicExtension('local-priority');

/** US Core race, ethnicity, birth sex and gender identity extension URLs. */
export const US_CORE_RACE_EXTENSION =
  'http://hl7.org/fhir/us/core/StructureDefinition/us-core-race';
export const US_CORE_ETHNICITY_EXTENSION =
  'http://hl7.org/fhir/us/core/StructureDefinition/us-core-ethnicity';
export const US_CORE_BIRTHSEX_EXTENSION =
  'http://hl7.org/fhir/us/core/StructureDefinition/us-core-birthsex';
export const US_CORE_GENDER_IDENTITY_EXTENSION =
  'http://hl7.org/fhir/us/core/StructureDefinition/us-core-genderIdentity';

/** OMB race and ethnicity category code system. */
export const OMB_RACE_ETHNICITY_SYSTEM = 'urn:oid:2.16.840.1.113883.6.238';

// ---------------------------------------------------------------------------
// Generic extension helpers
// ---------------------------------------------------------------------------

/** Builds a `valueCode` extension. */
export function codeExtension(url: string, code: string | undefined): fhir4.Extension | undefined {
  return isPresentString(code) ? { url, valueCode: code } : undefined;
}

/** Builds a `valueString` extension. */
export function stringExtension(
  url: string,
  value: string | undefined
): fhir4.Extension | undefined {
  return isPresentString(value) ? { url, valueString: value } : undefined;
}

/** Builds a `valueBoolean` extension; `false` is a value, not an absence. */
export function booleanExtension(
  url: string,
  value: boolean | undefined
): fhir4.Extension | undefined {
  return value === undefined ? undefined : { url, valueBoolean: value };
}

/** Builds a `valueReference` extension. */
export function referenceExtension(
  url: string,
  value: fhir4.Reference | undefined
): fhir4.Extension | undefined {
  return value === undefined ? undefined : { url, valueReference: value };
}

/** Reads the `valueReference` of the first extension with `url`. */
export function readReferenceExtension(
  extensions: fhir4.Extension[] | undefined,
  url: string
): fhir4.Reference | undefined {
  for (const extension of extensions ?? []) {
    if (extension.url === url && extension.valueReference !== undefined) {
      return extension.valueReference;
    }
  }
  return undefined;
}

/**
 * Builds the local-status extension for `value`, or `undefined` when the plain
 * FHIR code already round-trips.
 */
export function localStatusExtension<D extends string, F extends string>(
  mapping: EnumMapping<D, F>,
  value: D,
  url: string = LOCAL_STATUS_EXTENSION
): fhir4.Extension | undefined {
  return mapping.isLossy(value) ? { url, valueCode: value } : undefined;
}

/** Reads the `valueCode` of the first extension with `url`. */
export function readCodeExtension(
  extensions: fhir4.Extension[] | undefined,
  url: string
): string | undefined {
  for (const extension of extensions ?? []) {
    if (extension.url === url && isPresentString(extension.valueCode)) {
      return extension.valueCode;
    }
  }
  return undefined;
}

/** Reads the `valueString` of the first extension with `url`. */
export function readStringExtension(
  extensions: fhir4.Extension[] | undefined,
  url: string
): string | undefined {
  for (const extension of extensions ?? []) {
    if (extension.url === url && isPresentString(extension.valueString)) {
      return extension.valueString;
    }
  }
  return undefined;
}

/** Reads the `valueBoolean` of the first extension with `url`. */
export function readBooleanExtension(
  extensions: fhir4.Extension[] | undefined,
  url: string
): boolean | undefined {
  for (const extension of extensions ?? []) {
    if (extension.url === url && typeof extension.valueBoolean === 'boolean') {
      return extension.valueBoolean;
    }
  }
  return undefined;
}

/**
 * Resolves a status: the local-status extension wins when it carries a known
 * domain value, otherwise the standard FHIR code is reversed.
 */
export function readLocalStatus<D extends string, F extends string>(
  mapping: EnumMapping<D, F>,
  extensions: fhir4.Extension[] | undefined,
  code: string | undefined,
  url: string = LOCAL_STATUS_EXTENSION
): D {
  const local = readCodeExtension(extensions, url);
  return mapping.isDomainValue(local) ? local : mapping.fromFhir(code);
}

// ---------------------------------------------------------------------------
// US Core patient extensions
// ---------------------------------------------------------------------------

/**
 * Builds a US Core race or ethnicity extension from OMB category codes.
 *
 * The `text` sub-element is emitted only when the caller supplies it: display
 * text comes from the terminology cache, and Openrunic vendors no code content
 * (see `TerminologyCode` in `packages/database`). A deployment with terminology
 * loaded is conformant; one without degrades visibly rather than inventing text.
 */
export function ombCategoryExtension(
  url: string,
  codes: readonly string[],
  text?: string
): fhir4.Extension | undefined {
  const categories: fhir4.Extension[] = codes.filter(isPresentString).map((code) => ({
    url: 'ombCategory',
    valueCoding: { system: OMB_RACE_ETHNICITY_SYSTEM, code },
  }));
  const textElement = stringExtension('text', text);
  const nested = present<fhir4.Extension>([...categories, textElement]);
  return nested.length > 0 ? { url, extension: nested } : undefined;
}

/** Reads the OMB category codes out of a US Core race or ethnicity extension. */
export function readOmbCategoryCodes(
  extensions: fhir4.Extension[] | undefined,
  url: string
): string[] {
  const parent = (extensions ?? []).find((extension) => extension.url === url);
  return present(
    (parent?.extension ?? []).map((nested) =>
      nested.url === 'ombCategory' && isPresentString(nested.valueCoding?.code)
        ? nested.valueCoding.code
        : undefined
    )
  );
}

/** Reads the `text` sub-element of a US Core race or ethnicity extension. */
export function readOmbCategoryText(
  extensions: fhir4.Extension[] | undefined,
  url: string
): string | undefined {
  const parent = (extensions ?? []).find((extension) => extension.url === url);
  return readStringExtension(parent?.extension, 'text');
}

/** Builds the US Core gender identity extension from a coded concept. */
export function genderIdentityExtension(
  code: string | undefined,
  system?: string
): fhir4.Extension | undefined {
  if (!isPresentString(code)) {
    return undefined;
  }
  const concept = compactOrUndefined<fhir4.CodeableConcept>({
    coding: [compactOrUndefined<fhir4.Coding>({ system, code }) ?? { code }],
  });
  return concept === undefined
    ? undefined
    : { url: US_CORE_GENDER_IDENTITY_EXTENSION, valueCodeableConcept: concept };
}

function genderIdentityCoding(extensions: fhir4.Extension[] | undefined): fhir4.Coding | undefined {
  for (const extension of extensions ?? []) {
    if (extension.url !== US_CORE_GENDER_IDENTITY_EXTENSION) {
      continue;
    }
    for (const entry of extension.valueCodeableConcept?.coding ?? []) {
      if (isPresentString(entry.code)) {
        return entry;
      }
    }
  }
  return undefined;
}

/** Reads the code out of the US Core gender identity extension. */
export function readGenderIdentityCode(
  extensions: fhir4.Extension[] | undefined
): string | undefined {
  return genderIdentityCoding(extensions)?.code;
}

/** Reads the code system out of the US Core gender identity extension. */
export function readGenderIdentitySystem(
  extensions: fhir4.Extension[] | undefined
): string | undefined {
  const system = genderIdentityCoding(extensions)?.system;
  return isPresentString(system) ? system : undefined;
}
