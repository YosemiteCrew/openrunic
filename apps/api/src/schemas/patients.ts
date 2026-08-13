import { ADMINISTRATIVE_GENDERS, SENSITIVITY_CLASSES } from '@openrunic/database';
import { z } from 'zod';

import type { PatientListQuery, PatientRow } from '../repositories/types.js';

import { paginationQueryFields, sortOrderField } from './pagination.js';

/**
 * The patient list contract.
 *
 * `strictObject`, so `?famliy=Patientsson` is a 400 rather than a search that
 * quietly returns the whole chart index. A typo in a search parameter is the
 * difference between "no results" and "every patient", and only one of those is
 * safe to guess at.
 */
export const patientListQuerySchema = z.strictObject({
  ...paginationQueryFields,
  /** Free text over family name, given name, preferred name and MRN. */
  q: z.string().min(1).max(128).optional(),
  mrn: z.string().min(1).max(32).optional(),
  /** Prefix match, case-insensitive, matching the FHIR `string` search semantic. */
  family: z.string().min(1).max(128).optional(),
  given: z.string().min(1).max(128).optional(),
  birthDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
    .optional(),
  active: z.enum(['true', 'false']).optional(),
  sort: z.enum(['familyName', 'birthDate', 'createdAt']).default('familyName'),
  order: sortOrderField,
});

export type PatientListQueryInput = z.infer<typeof patientListQuerySchema>;

/** Reads a bare `YYYY-MM-DD` as UTC midnight, never as local midnight. */
export function parseLocalDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function toPatientListQuery(input: PatientListQueryInput): PatientListQuery {
  return {
    page: input.page,
    pageSize: input.pageSize,
    ...(input.q === undefined ? {} : { q: input.q }),
    ...(input.mrn === undefined ? {} : { mrn: input.mrn }),
    ...(input.family === undefined ? {} : { family: input.family }),
    ...(input.given === undefined ? {} : { given: input.given }),
    ...(input.birthDate === undefined ? {} : { birthDate: parseLocalDate(input.birthDate) }),
    ...(input.active === undefined ? {} : { active: input.active === 'true' }),
    sort: input.sort,
    order: input.order,
  };
}

/**
 * The JSON shape of a patient on the internal API, as a schema rather than an
 * interface. The TypeScript type is inferred from it, so the OpenAPI document
 * and the handler's return type cannot describe different objects.
 */
export const patientDtoSchema = z.strictObject({
  id: z.uuid(),
  mrn: z.string(),
  primaryFacilityId: z.uuid().nullable(),
  name: z.strictObject({
    given: z.string(),
    middle: z.string().nullable(),
    family: z.string(),
    prefix: z.string().nullable(),
    suffix: z.string().nullable(),
    preferred: z.string().nullable(),
  }),
  /** `YYYY-MM-DD`. A date of birth has no time and no timezone. */
  birthDate: z.string(),
  deceasedAt: z.string().nullable(),
  sexAtBirth: z.enum(ADMINISTRATIVE_GENDERS),
  genderIdentityCode: z.string().nullable(),
  pronouns: z.string().nullable(),
  raceCodes: z.array(z.string()),
  ethnicityCodes: z.array(z.string()),
  languageCode: z.string(),
  maritalStatusCode: z.string().nullable(),
  telecom: z.strictObject({
    email: z.string().nullable(),
    phoneMobile: z.string().nullable(),
    phoneHome: z.string().nullable(),
  }),
  address: z.strictObject({
    line1: z.string().nullable(),
    line2: z.string().nullable(),
    city: z.string().nullable(),
    state: z.string().nullable(),
    postalCode: z.string().nullable(),
    country: z.string(),
  }),
  sensitivityClass: z.enum(SENSITIVITY_CLASSES),
  portalEnabled: z.boolean(),
  active: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type PatientDto = z.infer<typeof patientDtoSchema>;

/**
 * Serialises a stored row for the wire.
 *
 * `birthDate` is emitted as a bare `YYYY-MM-DD`, never as an instant: it is a
 * `@db.Date` column, and rendering it with a time would let a timezone move a
 * date of birth by a day.
 */
export function toPatientDto(row: PatientRow): PatientDto {
  return {
    id: row.id,
    mrn: row.mrn,
    primaryFacilityId: row.primaryFacilityId,
    name: {
      given: row.givenName,
      middle: row.middleName,
      family: row.familyName,
      prefix: row.prefix,
      suffix: row.suffix,
      preferred: row.preferredName,
    },
    birthDate: toDateOnly(row.birthDate),
    deceasedAt: row.deceasedAt?.toISOString() ?? null,
    sexAtBirth: row.sexAtBirth,
    genderIdentityCode: row.genderIdentityCode,
    pronouns: row.pronouns,
    raceCodes: [...row.raceCodes],
    ethnicityCodes: [...row.ethnicityCodes],
    languageCode: row.languageCode,
    maritalStatusCode: row.maritalStatusCode,
    telecom: { email: row.email, phoneMobile: row.phoneMobile, phoneHome: row.phoneHome },
    address: {
      line1: row.addressLine1,
      line2: row.addressLine2,
      city: row.city,
      state: row.state,
      postalCode: row.postalCode,
      country: row.country,
    },
    sensitivityClass: row.sensitivityClass,
    portalEnabled: row.portalEnabled,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}
