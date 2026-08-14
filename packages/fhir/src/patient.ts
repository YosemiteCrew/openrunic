/// <reference types="fhir" preserve="true" />

import { enumMapping } from './enum-mapping.js';
import {
  US_CORE_BIRTHSEX_EXTENSION,
  US_CORE_ETHNICITY_EXTENSION,
  US_CORE_RACE_EXTENSION,
  codeExtension,
  genderIdentityExtension,
  ombCategoryExtension,
  readCodeExtension,
  readGenderIdentityCode,
  readGenderIdentitySystem,
  readOmbCategoryCodes,
  readOmbCategoryText,
} from './extensions.js';
import {
  address,
  codeableConcept,
  compact,
  contactPoint,
  identifier,
  humanName,
  present,
  readCode,
  readContactPoint,
  readIdentifier,
  readString,
  setOptional,
} from './primitives.js';
import { SYSTEMS } from './systems.js';

/** Namespace for the Openrunic medical record number. */
export const MRN_SYSTEM = 'https://openrunic.org/fhir/sid/mrn';

/** HL7 v2-0203 identifier type codes, used for `Identifier.type`. */
export const IDENTIFIER_TYPE_SYSTEM = SYSTEMS.identifierType;

const MARITAL_STATUS_SYSTEM = 'http://terminology.hl7.org/CodeSystem/v3-MaritalStatus';
const LANGUAGE_SYSTEM = SYSTEMS.bcp47;

/** `PatientIdentifier.use`, which is FHIR's closed `IdentifierUse` value set. */
export type DomainIdentifierUse = 'USUAL' | 'OFFICIAL' | 'TEMP' | 'SECONDARY' | 'OLD';

const IDENTIFIER_USE = enumMapping<DomainIdentifierUse, NonNullable<fhir4.Identifier['use']>>({
  map: {
    USUAL: 'usual',
    OFFICIAL: 'official',
    TEMP: 'temp',
    SECONDARY: 'secondary',
    OLD: 'old',
  },
  fallback: 'SECONDARY',
});

/**
 * An identifier that is not the MRN: SSN, driving licence, payer member id, or
 * an external EHR's patient id kept after a migration.
 */
export interface DomainPatientIdentifier {
  /** Namespace URI, e.g. `http://hl7.org/fhir/sid/us-ssn`. */
  system: string;
  value: string;
  use?: DomainIdentifierUse;
  /** HL7 v2-0203 type code, e.g. `SS`, `DL`. */
  typeCode?: string;
}

/**
 * The relational (Prisma) side of a patient, as stored by Openrunic.
 * FHIR is a serialization boundary: domain shapes like this one are the
 * source of truth, and mappers translate at the API edge.
 *
 * Values are the JSON-serializable projection of the `Patient` row: dates are
 * ISO 8601 strings, and an optional list field is absent when it is empty
 * rather than an empty array, because FHIR cannot represent an empty array and
 * a round trip has to be able to tell the two apart.
 */
export interface DomainPatient {
  id: string;
  familyName: string;
  /** Given names in order; the Prisma row's `givenName` then `middleName`. */
  givenNames: string[];
  /** ISO 8601 date, e.g. `1980-04-01`. */
  birthDate?: string;
  gender?: 'male' | 'female' | 'other' | 'unknown';
  /** Medical record number, unique per organisation. */
  mrn?: string;
  identifiers?: DomainPatientIdentifier[];
  prefix?: string;
  suffix?: string;
  preferredName?: string;
  /** ISO 8601 instant of death. */
  deceasedAt?: string;
  /** US Core birth sex: `F`, `M`, `OTH` or `UNK`. */
  birthSex?: 'F' | 'M' | 'OTH' | 'UNK';
  /** Coded gender identity (SNOMED CT / US Core value set). */
  genderIdentityCode?: string;
  genderIdentitySystem?: string;
  /** OMB race category codes. */
  raceCodes?: string[];
  raceText?: string;
  /** OMB ethnicity category codes. */
  ethnicityCodes?: string[];
  ethnicityText?: string;
  /** BCP-47 language tag. */
  languageCode?: string;
  maritalStatusCode?: string;
  email?: string;
  phoneMobile?: string;
  phoneHome?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  active?: boolean;
}

/**
 * Prisma columns on `Patient` that deliberately do not cross the FHIR boundary.
 * They are operational or policy state, not clinical content: exposing them
 * would leak Openrunic's internals into a standards-based API.
 */
export const PATIENT_DROPPED_FIELDS = [
  'tenantId',
  'primaryFacilityId',
  'pronouns',
  'sensitivityClass',
  'portalEnabled',
  'createdAt',
  'updatedAt',
] as const;

/**
 * Maps a {@link DomainPatient} to a FHIR R4 `Patient` resource.
 *
 * FHIR JSON forbids empty arrays and empty-string property values, so empty
 * domain fields are omitted rather than serialized - a sparse domain patient
 * still produces a valid resource.
 */
export function toFhirPatient(input: DomainPatient): fhir4.Patient {
  const extensions = present<fhir4.Extension>([
    ombCategoryExtension(US_CORE_RACE_EXTENSION, input.raceCodes ?? [], input.raceText),
    ombCategoryExtension(
      US_CORE_ETHNICITY_EXTENSION,
      input.ethnicityCodes ?? [],
      input.ethnicityText
    ),
    codeExtension(US_CORE_BIRTHSEX_EXTENSION, input.birthSex),
    genderIdentityExtension(input.genderIdentityCode, input.genderIdentitySystem),
  ]);

  const identifiers = present<fhir4.Identifier>([
    identifier({
      system: MRN_SYSTEM,
      value: input.mrn,
      use: 'official',
      typeSystem: IDENTIFIER_TYPE_SYSTEM,
      typeCode: 'MR',
    }),
    ...(input.identifiers ?? []).map((entry) =>
      identifier({
        system: entry.system,
        value: entry.value,
        use: entry.use === undefined ? undefined : IDENTIFIER_USE.toFhir(entry.use),
        typeSystem: entry.typeCode === undefined ? undefined : IDENTIFIER_TYPE_SYSTEM,
        typeCode: entry.typeCode,
      })
    ),
  ]);

  const name = humanName({
    family: input.familyName,
    given: input.givenNames,
    prefix: input.prefix,
    suffix: input.suffix,
  });
  const preferred = humanName({ use: 'nickname', text: input.preferredName });
  const names = present<fhir4.HumanName>([name, preferred]);

  const telecom = present<fhir4.ContactPoint>([
    contactPoint('phone', input.phoneMobile, 'mobile'),
    contactPoint('phone', input.phoneHome, 'home'),
    contactPoint('email', input.email),
  ]);

  const home = address({
    line1: input.addressLine1,
    line2: input.addressLine2,
    city: input.city,
    state: input.state,
    postalCode: input.postalCode,
    country: input.country,
    use: 'home',
  });

  const language = codeableConcept({ system: LANGUAGE_SYSTEM, code: input.languageCode });

  return compact<fhir4.Patient>({
    resourceType: 'Patient',
    id: input.id,
    extension: extensions,
    identifier: identifiers,
    active: input.active,
    name: names,
    telecom,
    gender: input.gender,
    birthDate: input.birthDate,
    deceasedDateTime: input.deceasedAt,
    address: home ? [home] : undefined,
    maritalStatus: codeableConcept({
      system: MARITAL_STATUS_SYSTEM,
      code: input.maritalStatusCode,
    }),
    communication: language ? [{ language }] : undefined,
  });
}

/**
 * Maps a FHIR R4 `Patient` back to a {@link DomainPatient}, the inverse of
 * {@link toFhirPatient}. Only the first non-nickname `name` entry is read;
 * absent fields map to empty values rather than throwing, so partial upstream
 * resources degrade predictably.
 */
export function fromFhirPatient(patient: fhir4.Patient): DomainPatient {
  const names = patient.name ?? [];
  const name = names.find((entry) => entry.use !== 'nickname');
  const nickname = names.find((entry) => entry.use === 'nickname');

  const domain: DomainPatient = {
    id: patient.id ?? '',
    familyName: name?.family ?? '',
    givenNames: name?.given ? [...name.given] : [],
  };

  setOptional(domain, 'birthDate', patient.birthDate);
  setOptional(domain, 'gender', patient.gender);
  setOptional(domain, 'mrn', readIdentifier(patient.identifier, MRN_SYSTEM));

  const identifiers = (patient.identifier ?? [])
    .filter((entry) => entry.system !== MRN_SYSTEM && entry.value !== undefined)
    .map((entry) => {
      const mapped: DomainPatientIdentifier = {
        system: entry.system ?? '',
        value: entry.value ?? '',
      };
      if (entry.use !== undefined) {
        mapped.use = IDENTIFIER_USE.fromFhir(entry.use);
      }
      setOptional(mapped, 'typeCode', readCode(entry.type, IDENTIFIER_TYPE_SYSTEM));
      return mapped;
    });
  if (identifiers.length > 0) {
    domain.identifiers = identifiers;
  }

  setOptional(domain, 'prefix', name?.prefix?.[0]);
  setOptional(domain, 'suffix', name?.suffix?.[0]);
  setOptional(domain, 'preferredName', readString(nickname?.text));
  setOptional(domain, 'deceasedAt', readString(patient.deceasedDateTime));

  const birthSex = readCodeExtension(patient.extension, US_CORE_BIRTHSEX_EXTENSION);
  if (birthSex === 'F' || birthSex === 'M' || birthSex === 'OTH' || birthSex === 'UNK') {
    domain.birthSex = birthSex;
  }
  setOptional(domain, 'genderIdentityCode', readGenderIdentityCode(patient.extension));
  setOptional(domain, 'genderIdentitySystem', readGenderIdentitySystem(patient.extension));

  const raceCodes = readOmbCategoryCodes(patient.extension, US_CORE_RACE_EXTENSION);
  if (raceCodes.length > 0) {
    domain.raceCodes = raceCodes;
  }
  setOptional(domain, 'raceText', readOmbCategoryText(patient.extension, US_CORE_RACE_EXTENSION));

  const ethnicityCodes = readOmbCategoryCodes(patient.extension, US_CORE_ETHNICITY_EXTENSION);
  if (ethnicityCodes.length > 0) {
    domain.ethnicityCodes = ethnicityCodes;
  }
  setOptional(
    domain,
    'ethnicityText',
    readOmbCategoryText(patient.extension, US_CORE_ETHNICITY_EXTENSION)
  );

  setOptional(
    domain,
    'languageCode',
    readCode(patient.communication?.[0]?.language, LANGUAGE_SYSTEM)
  );
  setOptional(domain, 'maritalStatusCode', readCode(patient.maritalStatus, MARITAL_STATUS_SYSTEM));
  setOptional(domain, 'email', readContactPoint(patient.telecom, 'email'));
  setOptional(domain, 'phoneMobile', readContactPoint(patient.telecom, 'phone', 'mobile'));
  setOptional(domain, 'phoneHome', readContactPoint(patient.telecom, 'phone', 'home'));

  const home = patient.address?.[0];
  setOptional(domain, 'addressLine1', readString(home?.line?.[0]));
  setOptional(domain, 'addressLine2', readString(home?.line?.[1]));
  setOptional(domain, 'city', readString(home?.city));
  setOptional(domain, 'state', readString(home?.state));
  setOptional(domain, 'postalCode', readString(home?.postalCode));
  setOptional(domain, 'country', readString(home?.country));
  if (typeof patient.active === 'boolean') {
    domain.active = patient.active;
  }

  return domain;
}
