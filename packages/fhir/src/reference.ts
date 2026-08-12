// The `preserve` attribute keeps this directive in the emitted .d.ts so that
// consumers resolve the ambient fhir4 globals without hoisting @types/fhir.
/// <reference types="fhir" preserve="true" />

/**
 * Builds a FHIR R4 literal {@link fhir4.Reference}, e.g.
 * `fhirReference('Patient', 'abc')` → `{ type: 'Patient', reference: 'Patient/abc' }`.
 */
export function fhirReference(resourceType: string, id: string): fhir4.Reference {
  return {
    type: resourceType,
    reference: `${resourceType}/${id}`,
  };
}
