/// <reference types="fhir" preserve="true" />

/**
 * The relational (Prisma) side of a patient, as stored by Openrunic.
 * FHIR is a serialization boundary: domain shapes like this one are the
 * source of truth, and mappers translate at the API edge.
 */
export interface DomainPatient {
  id: string;
  familyName: string;
  givenNames: string[];
  /** ISO 8601 date, e.g. `1980-04-01`. */
  birthDate?: string;
  gender?: 'male' | 'female' | 'other' | 'unknown';
}

/**
 * Maps a {@link DomainPatient} to a FHIR R4 `Patient` resource.
 *
 * FHIR JSON forbids empty arrays and empty-string property values, so empty
 * domain fields are omitted rather than serialized - a sparse domain patient
 * still produces a valid resource.
 */
export function toFhirPatient(input: DomainPatient): fhir4.Patient {
  const patient: fhir4.Patient = { resourceType: 'Patient' };
  if (input.id !== '') {
    patient.id = input.id;
  }
  const name: fhir4.HumanName = {};
  if (input.familyName !== '') {
    name.family = input.familyName;
  }
  if (input.givenNames.length > 0) {
    name.given = [...input.givenNames];
  }
  if (Object.keys(name).length > 0) {
    patient.name = [name];
  }
  if (input.birthDate !== undefined && input.birthDate !== '') {
    patient.birthDate = input.birthDate;
  }
  if (input.gender !== undefined) {
    patient.gender = input.gender;
  }
  return patient;
}

/**
 * Maps a FHIR R4 `Patient` back to a {@link DomainPatient}, the inverse of
 * {@link toFhirPatient}. Only the first `name` entry is read; absent fields
 * map to empty values rather than throwing, so partial upstream resources
 * degrade predictably.
 */
export function fromFhirPatient(patient: fhir4.Patient): DomainPatient {
  const name = patient.name?.[0];
  const domain: DomainPatient = {
    id: patient.id ?? '',
    familyName: name?.family ?? '',
    givenNames: name?.given ? [...name.given] : [],
  };
  if (patient.birthDate !== undefined) {
    domain.birthDate = patient.birthDate;
  }
  if (patient.gender !== undefined) {
    domain.gender = patient.gender;
  }
  return domain;
}
