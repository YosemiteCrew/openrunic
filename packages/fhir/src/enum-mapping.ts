/**
 * Enum mapping with an explicit, computed notion of loss.
 *
 * Openrunic's workflow enums are frequently wider than the FHIR value set they
 * serialize into: the appointment status list carries the front-desk states a
 * Flow Board needs, and FHIR R4 has no code for "roomed". Collapsing those
 * silently would make a round trip lie, so every mapping declares which FHIR
 * code each domain value takes, and which domain value a FHIR code comes back
 * as. Loss is then *derived*, never asserted by hand: a domain value is lossy
 * exactly when reading its own FHIR code does not return it.
 *
 * Mappers pair this with `localStatusExtension` (see `extensions.ts`): the
 * standard element always carries a valid FHIR code, and the precise domain
 * value rides along in an extension whenever - and only whenever - the mapping
 * would otherwise lose it.
 */

/** A bidirectional mapping between a domain enum and a FHIR code system. */
export interface EnumMapping<D extends string, F extends string> {
  /** Every domain value, in declaration order. */
  readonly domainValues: readonly D[];
  /** The FHIR code a domain value serializes to. */
  readonly toFhir: (value: D) => F;
  /** The domain value a FHIR code deserializes to; `fallback` when unknown. */
  readonly fromFhir: (code: string | undefined) => D;
  /** True when `toFhir` is not reversible for this value. */
  readonly isLossy: (value: D) => boolean;
  /** Type guard for a string that is one of the domain values. */
  readonly isDomainValue: (value: string | undefined) => value is D;
  /** The domain values that cannot survive a round trip through FHIR alone. */
  readonly lossyValues: readonly D[];
}

export interface EnumMappingOptions<D extends string, F extends string> {
  /** Domain value to FHIR code. Declaration order decides the default inverse. */
  readonly map: Readonly<Record<D, F>>;
  /**
   * The domain value a FHIR code comes back as, when several domain values
   * share it. Without an entry the first declared domain value wins.
   */
  readonly canonical?: Readonly<Partial<Record<F, D>>>;
  /** The domain value used for an absent or unrecognised FHIR code. */
  readonly fallback: D;
}

/**
 * A domain enum that serializes to a `CodeableConcept` rather than to a bare
 * code. Unlike {@link EnumMapping} this is always lossless: values that no
 * standard code system covers keep their own system URI, so nothing has to be
 * collapsed and no extension is needed.
 */
export interface ConceptMapping<D extends string> {
  readonly domainValues: readonly D[];
  /** The system and code a domain value serializes to. */
  readonly codingFor: (value: D) => { readonly system: string; readonly code: string };
  /** Builds the `CodeableConcept` for a domain value. */
  readonly toConcept: (value: D) => { coding: [{ system: string; code: string }] };
  /** Finds the domain value carried by any coding in the list. */
  readonly fromConcepts: (
    concepts: readonly { coding?: { system?: string; code?: string }[] }[] | undefined
  ) => D | undefined;
}

/** Builds a {@link ConceptMapping} over a domain enum. */
export function conceptMapping<D extends string>(
  map: Readonly<Record<D, { readonly system: string; readonly code: string }>>
): ConceptMapping<D> {
  const domainValues = Object.keys(map) as D[];
  return {
    domainValues,
    codingFor: (value) => map[value],
    toConcept: (value) => ({ coding: [{ system: map[value].system, code: map[value].code }] }),
    fromConcepts: (concepts) => {
      for (const concept of concepts ?? []) {
        for (const entry of concept.coding ?? []) {
          const match = domainValues.find(
            (value) => map[value].system === entry.system && map[value].code === entry.code
          );
          if (match !== undefined) {
            return match;
          }
        }
      }
      return undefined;
    },
  };
}

/** Builds an {@link EnumMapping} and computes which values it loses. */
export function enumMapping<D extends string, F extends string>(
  options: EnumMappingOptions<D, F>
): EnumMapping<D, F> {
  const domainValues = Object.keys(options.map) as D[];
  const inverse = new Map<string, D>();
  for (const value of domainValues) {
    const code = options.map[value];
    if (!inverse.has(code)) {
      inverse.set(code, value);
    }
  }
  for (const [code, value] of Object.entries(options.canonical ?? {})) {
    if (value !== undefined) {
      inverse.set(code, value as D);
    }
  }

  const toFhir = (value: D): F => options.map[value];
  const fromFhir = (code: string | undefined): D =>
    code === undefined ? options.fallback : (inverse.get(code) ?? options.fallback);
  const isLossy = (value: D): boolean => fromFhir(toFhir(value)) !== value;
  const isDomainValue = (value: string | undefined): value is D =>
    value !== undefined && (domainValues as string[]).includes(value);

  return {
    domainValues,
    toFhir,
    fromFhir,
    isLossy,
    isDomainValue,
    lossyValues: domainValues.filter(isLossy),
  };
}
