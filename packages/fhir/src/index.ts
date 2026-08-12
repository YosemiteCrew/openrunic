/// <reference types="fhir" preserve="true" />

/**
 * The FHIR release Openrunic serializes to at its API boundary (R4).
 * Matches `CapabilityStatement.fhirVersion`.
 */
export const FHIR_VERSION = '4.0.1';

// @types/fhir exposes its types as ambient `fhir4.*` globals rather than
// module exports, so re-export the ones Openrunic's API surface needs as
// proper named module types.
export type CapabilityStatement = fhir4.CapabilityStatement;
export type Patient = fhir4.Patient;
export type Bundle<T = fhir4.FhirResource> = fhir4.Bundle<T>;
export type OperationOutcome = fhir4.OperationOutcome;
export type Reference = fhir4.Reference;

export { fhirReference } from './reference.js';
export { toFhirPatient, fromFhirPatient } from './patient.js';
export type { DomainPatient } from './patient.js';
