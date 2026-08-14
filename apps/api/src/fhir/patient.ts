import {
  MRN_SYSTEM,
  fromFhirPatient,
  toFhirPatient,
  type DomainPatient,
  type Patient as FhirPatient,
} from '@openrunic/fhir';
import { patientCreateInput, type PatientCreateInput } from '@openrunic/database';

import { ApiError } from '../errors.js';
import type { AdministrativeGender, PatientRow } from '../repositories/types.js';
import { toDateOnly } from '../schemas/patients.js';

/**
 * Patient at the FHIR boundary.
 *
 * This file is a projection, not a mapper. `packages/fhir` owns the translation
 * in both directions; all that happens here is `PatientRow` (Prisma shapes:
 * `Date`, `null`, non-null defaults) to `DomainPatient` (the JSON-serializable
 * projection the package's mappers speak: ISO strings, absent-not-null, absent-
 * not-empty) and back to the domain create contract.
 *
 * It used to hand-roll identifier, telecom, address, deceased and language
 * serialization on top of a five-field `toFhirPatient` call. That duplicated
 * logic the package already had round-trip tests for, and it silently dropped
 * five fields the package can carry: `preferredName`, `genderIdentityCode`,
 * `raceCodes`, `ethnicityCodes` and `maritalStatusCode`. A mapper written on
 * both sides of a package boundary is a mapper that eventually disagrees with
 * itself, so there is now exactly one.
 *
 * ADR-0002 requires round-trip tests. `__tests__/fhir.test.ts` proves
 * `row -> FHIR -> create input` preserves every field this projection claims to
 * carry, and names the ones it drops.
 */

/** Re-exported so callers bind to the package's constant, never a copy of it. */
export { MRN_SYSTEM };

/**
 * `PatientRow` fields the FHIR representation does not carry, asserted by the
 * round-trip test so a silent loss shows up as a failing name rather than as a
 * missing value in production.
 *
 * `pronouns` has no R4 element or US Core extension. `sensitivityClass` and
 * `portalEnabled` are access-control facts about the record, not clinical facts
 * about the person, and publishing them would leak policy to every API client.
 * `primaryFacilityId` is an internal routing key. `tenantId`, `createdAt` and
 * `updatedAt` are carried by the Bundle and `meta`, not by the resource body.
 */
export const DROPPED_FIELDS: readonly string[] = [
  'tenantId',
  'primaryFacilityId',
  'pronouns',
  'sensitivityClass',
  'portalEnabled',
  'createdAt',
  'updatedAt',
];

const TO_FHIR_GENDER: Record<AdministrativeGender, NonNullable<DomainPatient['gender']>> = {
  FEMALE: 'female',
  MALE: 'male',
  OTHER: 'other',
  UNKNOWN: 'unknown',
};

const FROM_FHIR_GENDER: Record<string, AdministrativeGender> = {
  female: 'FEMALE',
  male: 'MALE',
  other: 'OTHER',
  unknown: 'UNKNOWN',
};

/** US Core `birthsex` codes, keyed by the same column that fills `gender`. */
const TO_BIRTH_SEX: Record<AdministrativeGender, NonNullable<DomainPatient['birthSex']>> = {
  FEMALE: 'F',
  MALE: 'M',
  OTHER: 'OTH',
  UNKNOWN: 'UNK',
};

const FROM_BIRTH_SEX: Record<string, AdministrativeGender> = {
  F: 'FEMALE',
  M: 'MALE',
  OTH: 'OTHER',
  UNK: 'UNKNOWN',
};

export function toFhirGender(value: AdministrativeGender): NonNullable<DomainPatient['gender']> {
  return TO_FHIR_GENDER[value];
}

export function fromFhirGender(value: string | undefined): AdministrativeGender | undefined {
  return value === undefined ? undefined : FROM_FHIR_GENDER[value];
}

/**
 * Assigns a key only when the value is a non-empty string.
 *
 * `PatientRow` spells absence three ways - `null`, `''` for the non-null
 * `languageCode` column, and an empty array - while `DomainPatient` spells it
 * one way: the key is not there. Assigning `undefined` would not do, because an
 * own key holding `undefined` still serializes differently from an absent one
 * and defeats the package's absent-versus-empty round-trip guarantee.
 */
function setOptional(target: DomainPatient, key: StringField, value: string | null): void {
  if (value === null || value === '') return;
  target[key] = value;
}

/** The `DomainPatient` keys that hold a plain string, resolved by the compiler. */
type StringField = {
  [K in keyof DomainPatient]-?: string extends DomainPatient[K] ? K : never;
}[keyof DomainPatient];

/**
 * Whether the stored address has any substance beyond its country default.
 *
 * `PatientRow.country` is non-null and defaults to `US`, so passing it
 * unconditionally would emit `{ use: 'home', country: 'US' }` for every patient
 * who has never given an address - a resource that asserts a fact nobody
 * entered. Country therefore rides along with a real address rather than
 * creating one.
 */
function hasAddress(row: PatientRow): boolean {
  return (
    row.addressLine1 !== null ||
    row.addressLine2 !== null ||
    row.city !== null ||
    row.state !== null ||
    row.postalCode !== null
  );
}

/**
 * Projects a stored row onto the package's domain shape.
 *
 * Optional keys are omitted rather than set to `undefined`: the package treats
 * an absent key and an empty list as different from an empty value, because
 * FHIR cannot represent an empty array and a round trip has to tell them apart.
 */
export function patientRowToDomain(row: PatientRow): DomainPatient {
  const givenNames = row.middleName === null ? [row.givenName] : [row.givenName, row.middleName];

  const domain: DomainPatient = {
    id: row.id,
    familyName: row.familyName,
    givenNames,
    mrn: row.mrn,
    birthDate: toDateOnly(row.birthDate),
    gender: toFhirGender(row.sexAtBirth),
    birthSex: TO_BIRTH_SEX[row.sexAtBirth],
    active: row.active,
  };

  setOptional(domain, 'prefix', row.prefix);
  setOptional(domain, 'suffix', row.suffix);
  setOptional(domain, 'preferredName', row.preferredName);
  setOptional(domain, 'genderIdentityCode', row.genderIdentityCode);
  setOptional(domain, 'languageCode', row.languageCode);
  setOptional(domain, 'maritalStatusCode', row.maritalStatusCode);
  setOptional(domain, 'email', row.email);
  setOptional(domain, 'phoneMobile', row.phoneMobile);
  setOptional(domain, 'phoneHome', row.phoneHome);
  setOptional(domain, 'addressLine1', row.addressLine1);
  setOptional(domain, 'addressLine2', row.addressLine2);
  setOptional(domain, 'city', row.city);
  setOptional(domain, 'state', row.state);
  setOptional(domain, 'postalCode', row.postalCode);
  setOptional(domain, 'country', hasAddress(row) ? row.country : null);
  setOptional(domain, 'deceasedAt', row.deceasedAt === null ? null : row.deceasedAt.toISOString());

  if (row.raceCodes.length > 0) domain.raceCodes = row.raceCodes;
  if (row.ethnicityCodes.length > 0) domain.ethnicityCodes = row.ethnicityCodes;

  return domain;
}

/** Serialises a stored patient as a US Core-shaped `Patient` resource. */
export function patientRowToFhir(row: PatientRow): FhirPatient {
  return toFhirPatient(patientRowToDomain(row));
}

/**
 * Reads an inbound `Patient` resource into the domain create contract.
 *
 * Two failure classes, deliberately different statuses. A body that is not a
 * Patient resource at all is a 400 - the request was not understood. A Patient
 * that is well-formed but unusable, such as one with no MRN identifier, is a
 * 422 - understood and rejected. Collapsing them would make a client's parser
 * bug and its data-quality bug look identical.
 *
 * The assembly is split along the resource's own seams - identifier, name, the
 * plain elements, the US Core extensions, telecom, address - rather than into
 * arbitrary halves. A question about this mapper is always a question about one
 * of those, so the seam that has to be read to answer it is the unit here.
 */
export function fhirPatientToCreateInput(payload: unknown): PatientCreateInput {
  if (!isPatientResource(payload)) {
    throw ApiError.malformed('The request body must be a FHIR Patient resource.');
  }

  const domain = fromFhirPatient(payload);

  // Assembled in the resource's own order, and `mrn` first because a resource
  // with no medical record number is rejected before anything else is read.
  const candidate = {
    mrn: readMrn(domain, payload),
    ...nameFields(domain),
    ...coreElementFields(domain),
    ...extensionFields(domain),
    ...telecomFields(domain),
    ...addressFields(domain),
  };

  // The same schema the internal API validates against. A resource that
  // survives the mapper still has to satisfy the domain contract; there is no
  // second, looser definition of a valid patient for FHIR callers.
  const parsed = patientCreateInput.safeParse(candidate);
  if (!parsed.success) {
    throw ApiError.validation(
      'The Patient resource did not satisfy the patient contract.',
      parsed.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
      }))
    );
  }
  return parsed.data;
}

/**
 * `Patient.identifier` -> `mrn`, the one identifier this contract requires.
 *
 * A Patient with no MRN is a 422 rather than a create with a blank column: the
 * MRN is how the record is found again, and inventing one on the server would
 * make a duplicate patient the caller's next problem instead of this one.
 */
function readMrn(domain: DomainPatient, resource: FhirPatient): string {
  const mrn = domain.mrn ?? readMrnByType(resource);
  if (mrn === undefined) {
    throw ApiError.validation('The Patient resource is missing a medical record number.', [
      { path: 'identifier', message: `an identifier with system ${MRN_SYSTEM} is required` },
    ]);
  }
  return mrn;
}

/**
 * `Patient.name` -> the name columns.
 *
 * `givenNames` is a list on the FHIR side and two columns here, so the first
 * entry is the given name and the second is the middle name; anything beyond
 * the second has nowhere to go. An absent first entry becomes `''` rather than
 * an absent key on purpose, so the contract rejects it with a message about
 * `givenName` instead of about a missing property.
 */
function nameFields(domain: DomainPatient): {
  givenName: string;
  familyName: string;
  middleName?: string;
  prefix?: string;
  suffix?: string;
  preferredName?: string;
} {
  return {
    givenName: domain.givenNames[0] ?? '',
    familyName: domain.familyName,
    ...(domain.givenNames[1] === undefined ? {} : { middleName: domain.givenNames[1] }),
    ...(domain.prefix === undefined ? {} : { prefix: domain.prefix }),
    ...(domain.suffix === undefined ? {} : { suffix: domain.suffix }),
    ...(domain.preferredName === undefined ? {} : { preferredName: domain.preferredName }),
  };
}

/**
 * The elements that map straight onto a column: `birthDate`,
 * `deceasedDateTime`, `maritalStatus`, `communication` and `active`.
 *
 * Only `deceasedAt` is converted, from the ISO instant the domain shape carries
 * to the `Date` the contract stores.
 */
function coreElementFields(domain: DomainPatient): {
  birthDate?: string;
  deceasedAt?: Date;
  maritalStatusCode?: string;
  languageCode?: string;
  active?: boolean;
} {
  return {
    ...(domain.birthDate === undefined ? {} : { birthDate: domain.birthDate }),
    ...(domain.deceasedAt === undefined ? {} : { deceasedAt: new Date(domain.deceasedAt) }),
    ...(domain.maritalStatusCode === undefined
      ? {}
      : { maritalStatusCode: domain.maritalStatusCode }),
    ...(domain.languageCode === undefined ? {} : { languageCode: domain.languageCode }),
    ...(domain.active === undefined ? {} : { active: domain.active }),
  };
}

/**
 * The US Core extensions - race, ethnicity, birth sex, gender identity - and
 * the one element that competes with one of them.
 *
 * `gender` wins over the `birthsex` extension. One column stores both, so a
 * resource that disagrees with itself has to resolve somewhere, and the element
 * beats the extension.
 */
function extensionFields(domain: DomainPatient): {
  sexAtBirth?: AdministrativeGender;
  genderIdentityCode?: string;
  raceCodes?: string[];
  ethnicityCodes?: string[];
} {
  const sexAtBirth =
    fromFhirGender(domain.gender) ??
    (domain.birthSex === undefined ? undefined : FROM_BIRTH_SEX[domain.birthSex]);

  return {
    ...(sexAtBirth === undefined ? {} : { sexAtBirth }),
    ...(domain.genderIdentityCode === undefined
      ? {}
      : { genderIdentityCode: domain.genderIdentityCode }),
    ...(domain.raceCodes === undefined ? {} : { raceCodes: domain.raceCodes }),
    ...(domain.ethnicityCodes === undefined ? {} : { ethnicityCodes: domain.ethnicityCodes }),
  };
}

/** `Patient.telecom` -> the contact columns, one per system and use. */
function telecomFields(domain: DomainPatient): {
  email?: string;
  phoneMobile?: string;
  phoneHome?: string;
} {
  return {
    ...(domain.email === undefined ? {} : { email: domain.email }),
    ...(domain.phoneMobile === undefined ? {} : { phoneMobile: domain.phoneMobile }),
    ...(domain.phoneHome === undefined ? {} : { phoneHome: domain.phoneHome }),
  };
}

/**
 * `Patient.address` -> the address columns.
 *
 * Every part is optional here, including `country`, which the outbound
 * projection only emits alongside a real address. A resource that carries no
 * address therefore sets no address column rather than storing a lone country.
 */
function addressFields(domain: DomainPatient): {
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
} {
  return {
    ...(domain.addressLine1 === undefined ? {} : { addressLine1: domain.addressLine1 }),
    ...(domain.addressLine2 === undefined ? {} : { addressLine2: domain.addressLine2 }),
    ...(domain.city === undefined ? {} : { city: domain.city }),
    ...(domain.state === undefined ? {} : { state: domain.state }),
    ...(domain.postalCode === undefined ? {} : { postalCode: domain.postalCode }),
    ...(domain.country === undefined ? {} : { country: domain.country }),
  };
}

/**
 * Falls back to the `MR` type code when the caller omitted the MRN system.
 *
 * The package's mapper matches on system, which is the correct strict reading.
 * This endpoint is more forgiving on the way in only: a resource that codes the
 * type as `MR` still means an MRN, and rejecting it would fail a conformant
 * client over a namespace it had no way to know.
 */
function readMrnByType(resource: FhirPatient): string | undefined {
  return (resource.identifier ?? []).find((entry) =>
    entry.type?.coding?.some((coding) => coding.code === 'MR')
  )?.value;
}

/**
 * Narrows an untrusted body to `Patient`.
 *
 * Only `resourceType` is checked, so the result is a shape claim rather than a
 * proof. That is why the assembled candidate is put through `patientCreateInput`
 * before it becomes a row: the validation is the zod schema's job, not the type
 * system's.
 */
function isPatientResource(value: unknown): value is FhirPatient {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (value as { resourceType?: unknown }).resourceType === 'Patient'
  );
}
