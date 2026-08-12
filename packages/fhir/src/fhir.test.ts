import { describe, expect, it } from 'vitest';

import { FHIR_VERSION, fhirReference, fromFhirPatient, toFhirPatient } from './index.js';
import type { DomainPatient, Patient } from './index.js';

describe('FHIR_VERSION', () => {
  it('is the R4 release', () => {
    expect(FHIR_VERSION).toBe('4.0.1');
  });
});

describe('fhirReference', () => {
  it('builds a typed literal reference', () => {
    expect(fhirReference('Patient', 'abc-123')).toStrictEqual({
      type: 'Patient',
      reference: 'Patient/abc-123',
    });
  });
});

describe('patient mapping', () => {
  const fullPatient: DomainPatient = {
    id: '9b2f6a2e-2f9d-4c1a-9f7a-1d2e3f4a5b6c',
    familyName: 'Runeberg',
    givenNames: ['Astrid', 'Maja'],
    birthDate: '1984-06-02',
    gender: 'female',
  };

  const minimalPatient: DomainPatient = {
    id: 'minimal-1',
    familyName: 'Void',
    givenNames: [],
  };

  it('maps a domain patient to a FHIR R4 Patient', () => {
    expect(toFhirPatient(fullPatient)).toStrictEqual({
      resourceType: 'Patient',
      id: '9b2f6a2e-2f9d-4c1a-9f7a-1d2e3f4a5b6c',
      name: [{ family: 'Runeberg', given: ['Astrid', 'Maja'] }],
      birthDate: '1984-06-02',
      gender: 'female',
    });
  });

  it('omits absent optional fields instead of emitting undefined keys', () => {
    const resource = toFhirPatient(minimalPatient);
    expect(Object.keys(resource)).toStrictEqual(['resourceType', 'id', 'name']);
  });

  it.each([
    ['full', fullPatient],
    ['minimal', minimalPatient],
  ])('round-trips a %s patient: domain → FHIR → domain', (_label, domain) => {
    expect(fromFhirPatient(toFhirPatient(domain))).toStrictEqual(domain);
  });

  it('does not share array references between domain and FHIR shapes', () => {
    const resource = toFhirPatient(fullPatient);
    resource.name?.[0]?.given?.push('Mutation');
    expect(fullPatient.givenNames).toStrictEqual(['Astrid', 'Maja']);
  });

  it('degrades absent FHIR fields to empty domain values', () => {
    const sparse: Patient = { resourceType: 'Patient' };
    expect(fromFhirPatient(sparse)).toStrictEqual({
      id: '',
      familyName: '',
      givenNames: [],
    });
  });

  it('never emits FHIR-invalid empty arrays or empty strings', () => {
    const empty: DomainPatient = { id: '', familyName: '', givenNames: [] };
    expect(toFhirPatient(empty)).toStrictEqual({ resourceType: 'Patient' });

    const familyOnly = toFhirPatient({ id: '', familyName: 'Solo', givenNames: [] });
    expect(familyOnly).toStrictEqual({ resourceType: 'Patient', name: [{ family: 'Solo' }] });

    const givenOnly = toFhirPatient({ id: '', familyName: '', givenNames: ['Ada'] });
    expect(givenOnly).toStrictEqual({ resourceType: 'Patient', name: [{ given: ['Ada'] }] });

    const blankBirthDate = toFhirPatient({
      id: 'x-1',
      familyName: 'Blank',
      givenNames: [],
      birthDate: '',
    });
    expect(blankBirthDate).not.toHaveProperty('birthDate');
  });

  it('round-trips a fully empty domain patient through a valid resource', () => {
    const empty: DomainPatient = { id: '', familyName: '', givenNames: [] };
    expect(fromFhirPatient(toFhirPatient(empty))).toStrictEqual(empty);
  });
});
