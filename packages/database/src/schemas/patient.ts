import { z } from 'zod';

import {
  ADMINISTRATIVE_GENDERS,
  CONSENT_SCOPES,
  CONSENT_STATUSES,
  COVERAGE_RANKS,
  COVERAGE_STATUSES,
  IDENTIFIER_USES,
  SENSITIVITY_CLASSES,
} from '../enums.js';
import {
  addressFields,
  code,
  codeList,
  codeSystem,
  localDate,
  longText,
  positiveCents,
  shortText,
  telecomFields,
  timestamp,
  uuid,
} from './common.js';

/** Registration aggregate: the patient, their identifiers, contacts and coverage. */

export const patientCreateInput = z.strictObject({
  /** Medical record number. Unique per organisation; assigned by the practice. */
  mrn: z.string().min(1).max(32),
  primaryFacilityId: uuid.optional(),
  givenName: z.string().min(1).max(128),
  middleName: z.string().min(1).max(128).optional(),
  familyName: z.string().min(1).max(128),
  prefix: z.string().min(1).max(16).optional(),
  suffix: z.string().min(1).max(16).optional(),
  preferredName: z.string().min(1).max(128).optional(),
  birthDate: localDate,
  deceasedAt: timestamp.optional(),
  sexAtBirth: z.enum(ADMINISTRATIVE_GENDERS).optional(),
  /** Coded gender identity; distinct from sex at birth and never inferred from it. */
  genderIdentityCode: code.optional(),
  pronouns: z.string().min(1).max(32).optional(),
  raceCodes: codeList.optional(),
  ethnicityCodes: codeList.optional(),
  /** BCP 47 language tag for the patient's preferred language. */
  languageCode: z.string().min(2).max(16).optional(),
  maritalStatusCode: code.optional(),
  email: z.email().max(320).optional(),
  phoneMobile: z.string().min(3).max(32).optional(),
  phoneHome: z.string().min(3).max(32).optional(),
  ...addressFields,
  sensitivityClass: z.enum(SENSITIVITY_CLASSES).optional(),
  portalEnabled: z.boolean().optional(),
  active: z.boolean().optional(),
});

/** Every field is optional on update, but `mrn` is not reassignable. */
export const patientUpdateInput = patientCreateInput.omit({ mrn: true }).partial();

export const patientIdentifierInput = z.strictObject({
  patientId: uuid,
  use: z.enum(IDENTIFIER_USES).optional(),
  system: codeSystem,
  value: z.string().min(1).max(128),
  typeCode: code.optional(),
  assigner: shortText.optional(),
  periodStart: timestamp.optional(),
  periodEnd: timestamp.optional(),
});

export const relatedPersonInput = z.strictObject({
  patientId: uuid,
  relationshipCode: code,
  relationshipText: shortText.optional(),
  givenName: z.string().min(1).max(128),
  familyName: z.string().min(1).max(128),
  ...telecomFields,
  ...addressFields,
  isGuardian: z.boolean().optional(),
  isEmergencyContact: z.boolean().optional(),
  isPortalProxy: z.boolean().optional(),
  active: z.boolean().optional(),
});

export const payerInput = z.strictObject({
  name: z.string().min(1).max(256),
  /** Trading-partner id used in the 837 NM109. */
  x12PayerId: z.string().min(1).max(64).optional(),
  claimFilingCode: code.optional(),
  eligibilityPayerId: z.string().min(1).max(64).optional(),
  ...addressFields,
  phone: z.string().min(3).max(32).optional(),
  active: z.boolean().optional(),
});

export const coverageInput = z
  .strictObject({
    patientId: uuid,
    payerId: uuid,
    rank: z.enum(COVERAGE_RANKS).optional(),
    status: z.enum(COVERAGE_STATUSES).optional(),
    memberId: z.string().min(1).max(64),
    groupNumber: z.string().min(1).max(64).optional(),
    planName: shortText.optional(),
    subscriberRelationshipCode: code.optional(),
    subscriberGivenName: z.string().min(1).max(128).optional(),
    subscriberFamilyName: z.string().min(1).max(128).optional(),
    subscriberBirthDate: localDate.optional(),
    effectiveFrom: localDate.optional(),
    effectiveTo: localDate.optional(),
    copayCents: positiveCents.optional(),
    deductibleCents: positiveCents.optional(),
    acceptAssignment: z.boolean().optional(),
  })
  .refine(
    (value) =>
      !value.effectiveFrom || !value.effectiveTo || value.effectiveTo >= value.effectiveFrom,
    { message: 'effectiveTo must not precede effectiveFrom', path: ['effectiveTo'] }
  );

export const consentGrantInput = z
  .strictObject({
    patientId: uuid,
    scope: z.enum(CONSENT_SCOPES),
    status: z.enum(CONSENT_STATUSES).optional(),
    relatedPersonId: uuid.optional(),
    documentId: uuid.optional(),
    formSubmissionId: uuid.optional(),
    policyText: longText.optional(),
    effectiveFrom: timestamp.optional(),
    effectiveTo: timestamp.optional(),
    revokedAt: timestamp.optional(),
    revokedReason: shortText.optional(),
  })
  .refine((value) => value.status !== 'REVOKED' || value.revokedAt !== undefined, {
    message: 'a REVOKED consent must record revokedAt',
    path: ['revokedAt'],
  });

export type PatientCreateInput = z.infer<typeof patientCreateInput>;
export type PatientUpdateInput = z.infer<typeof patientUpdateInput>;
export type PatientIdentifierInput = z.infer<typeof patientIdentifierInput>;
export type RelatedPersonInput = z.infer<typeof relatedPersonInput>;
export type PayerInput = z.infer<typeof payerInput>;
export type CoverageInput = z.infer<typeof coverageInput>;
export type ConsentGrantInput = z.infer<typeof consentGrantInput>;
