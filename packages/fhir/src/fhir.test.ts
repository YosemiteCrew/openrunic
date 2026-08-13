import { describe, expect, it } from 'vitest';

import {
  FHIR_VERSION,
  MRN_SYSTEM,
  PATIENT_DROPPED_FIELDS,
  US_CORE_BIRTHSEX_EXTENSION,
  US_CORE_RACE_EXTENSION,
  fhirReference,
  fromFhirPatient,
  toFhirPatient,
} from './index.js';
import type { DomainPatient, Patient } from './index.js';
import { describeRoundTrips, expectDroppedFields } from './test-support/round-trip.js';

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

  it('includes a display only when it has content', () => {
    expect(fhirReference('Practitioner', 'u-1', 'Dr. Okafor')).toStrictEqual({
      type: 'Practitioner',
      reference: 'Practitioner/u-1',
      display: 'Dr. Okafor',
    });
    expect(fhirReference('Practitioner', 'u-1', '')).toStrictEqual({
      type: 'Practitioner',
      reference: 'Practitioner/u-1',
    });
  });
});

describe('patient mapping', () => {
  const fullPatient: DomainPatient = {
    id: '9b2f6a2e-2f9d-4c1a-9f7a-1d2e3f4a5b6c',
    familyName: 'Testperson',
    givenNames: ['Exampla', 'Marit'],
    birthDate: '1984-06-02',
    gender: 'female',
  };

  const minimalPatient: DomainPatient = {
    id: 'minimal-1',
    familyName: 'Void',
    givenNames: [],
  };

  const emptyPatient: DomainPatient = { id: '', familyName: '', givenNames: [] };

  const usCorePatient: DomainPatient = {
    id: 'a3f1c0de-0000-4000-8000-000000000001',
    mrn: 'OR-100482',
    identifiers: [
      {
        system: 'http://hl7.org/fhir/sid/us-ssn',
        value: '000-00-0000',
        use: 'SECONDARY',
        typeCode: 'SS',
      },
    ],
    familyName: 'Patientsson',
    givenNames: ['Testina', 'Marit'],
    prefix: 'Ms',
    suffix: 'Jr',
    preferredName: 'Tess',
    birthDate: '1984-06-02',
    gender: 'female',
    birthSex: 'F',
    genderIdentityCode: '446141000124107',
    genderIdentitySystem: 'http://snomed.info/sct',
    raceCodes: ['2106-3'],
    raceText: 'White',
    ethnicityCodes: ['2186-5'],
    ethnicityText: 'Not Hispanic or Latino',
    languageCode: 'en',
    maritalStatusCode: 'M',
    email: 'testina.patientsson@example.invalid',
    phoneMobile: '+15550100',
    phoneHome: '+15550101',
    addressLine1: '1 Alder Way',
    addressLine2: 'Apt 2',
    city: 'Ashford',
    state: 'OR',
    postalCode: '97001',
    country: 'US',
    active: true,
  };

  it('maps a domain patient to a FHIR R4 Patient', () => {
    expect(toFhirPatient(fullPatient)).toStrictEqual({
      resourceType: 'Patient',
      id: '9b2f6a2e-2f9d-4c1a-9f7a-1d2e3f4a5b6c',
      name: [{ family: 'Testperson', given: ['Exampla', 'Marit'] }],
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
    expect(fullPatient.givenNames).toStrictEqual(['Exampla', 'Marit']);
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

  it('writes the MRN as an official identifier with an MR type', () => {
    const resource = toFhirPatient(usCorePatient);
    expect(resource.identifier?.[0]).toStrictEqual({
      use: 'official',
      type: {
        coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0203', code: 'MR' }],
      },
      system: MRN_SYSTEM,
      value: 'OR-100482',
    });
  });

  it('writes race as a US Core OMB category extension', () => {
    const resource = toFhirPatient(usCorePatient);
    const race = resource.extension?.find((entry) => entry.url === US_CORE_RACE_EXTENSION);
    expect(race).toStrictEqual({
      url: US_CORE_RACE_EXTENSION,
      extension: [
        {
          url: 'ombCategory',
          valueCoding: { system: 'urn:oid:2.16.840.1.113883.6.238', code: '2106-3' },
        },
        { url: 'text', valueString: 'White' },
      ],
    });
  });

  it('writes birth sex as a US Core code extension', () => {
    const resource = toFhirPatient(usCorePatient);
    expect(resource.extension).toContainEqual({
      url: US_CORE_BIRTHSEX_EXTENSION,
      valueCode: 'F',
    });
  });

  it('keeps the preferred name as a nickname rather than the primary name', () => {
    const resource = toFhirPatient(usCorePatient);
    expect(resource.name?.[0]?.family).toBe('Patientsson');
    expect(resource.name?.[1]).toStrictEqual({ use: 'nickname', text: 'Tess' });
  });

  it('never emits a nickname entry without a name in it', () => {
    const resource = toFhirPatient(fullPatient);
    expect(resource.name).toHaveLength(1);
  });

  it('ignores a birth sex code that is not in the US Core value set', () => {
    const resource = toFhirPatient(usCorePatient);
    const tampered: Patient = {
      ...resource,
      extension: [{ url: US_CORE_BIRTHSEX_EXTENSION, valueCode: 'X' }],
    };
    expect(fromFhirPatient(tampered)).not.toHaveProperty('birthSex');
  });

  it('reads an identifier that carries neither a use nor a type', () => {
    expect(
      fromFhirPatient({
        resourceType: 'Patient',
        identifier: [{ system: 'urn:legacy', value: 'L-1' }, { system: 'urn:blank' }],
      }).identifiers
    ).toStrictEqual([{ system: 'urn:legacy', value: 'L-1' }]);
  });

  it('documents the Patient columns that stay inside Openrunic', () => {
    expectDroppedFields(usCorePatient, PATIENT_DROPPED_FIELDS);
  });

  describeRoundTrips(
    { resourceType: 'Patient', toFhir: toFhirPatient, fromFhir: fromFhirPatient },
    [
      { label: 'US Core', domain: usCorePatient },
      { label: 'sparse', domain: fullPatient },
      { label: 'minimal', domain: minimalPatient },
      { label: 'degenerate', domain: emptyPatient },
    ]
  );
});
