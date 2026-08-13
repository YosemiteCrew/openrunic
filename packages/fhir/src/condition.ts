/// <reference types="fhir" preserve="true" />

import { conceptMapping, enumMapping } from './enum-mapping.js';
import { openrunicCodeSystem } from './extensions.js';
import {
  annotations,
  codeableConcept,
  compact,
  present,
  readAnnotation,
  readCode,
  readString,
  setOptional,
} from './primitives.js';
import { fhirReference, optionalReference, referenceId } from './reference.js';
import { SYSTEMS } from './systems.js';

/** Code system for the issue-list categories FHIR does not define. */
export const CONDITION_CATEGORY_SYSTEM = openrunicCodeSystem('condition-category');

export type DomainConditionCategory =
  'PROBLEM_LIST_ITEM' | 'ENCOUNTER_DIAGNOSIS' | 'SURGERY' | 'DENTAL';

export type DomainConditionClinicalStatus =
  'ACTIVE' | 'RECURRENCE' | 'RELAPSE' | 'INACTIVE' | 'REMISSION' | 'RESOLVED';

export type DomainConditionVerificationStatus =
  'UNCONFIRMED' | 'PROVISIONAL' | 'DIFFERENTIAL' | 'CONFIRMED' | 'REFUTED' | 'ENTERED_IN_ERROR';

const CONDITION_CATEGORY = conceptMapping<DomainConditionCategory>({
  PROBLEM_LIST_ITEM: { system: SYSTEMS.conditionCategory, code: 'problem-list-item' },
  ENCOUNTER_DIAGNOSIS: { system: SYSTEMS.conditionCategory, code: 'encounter-diagnosis' },
  SURGERY: { system: CONDITION_CATEGORY_SYSTEM, code: 'surgery' },
  DENTAL: { system: CONDITION_CATEGORY_SYSTEM, code: 'dental' },
});

const CLINICAL_STATUS = enumMapping<DomainConditionClinicalStatus, string>({
  map: {
    ACTIVE: 'active',
    RECURRENCE: 'recurrence',
    RELAPSE: 'relapse',
    INACTIVE: 'inactive',
    REMISSION: 'remission',
    RESOLVED: 'resolved',
  },
  fallback: 'ACTIVE',
});

const VERIFICATION_STATUS = enumMapping<DomainConditionVerificationStatus, string>({
  map: {
    UNCONFIRMED: 'unconfirmed',
    PROVISIONAL: 'provisional',
    DIFFERENTIAL: 'differential',
    CONFIRMED: 'confirmed',
    REFUTED: 'refuted',
    ENTERED_IN_ERROR: 'entered-in-error',
  },
  fallback: 'CONFIRMED',
});

/** A problem-list entry or an encounter diagnosis. */
export interface DomainCondition {
  id: string;
  patientId: string;
  encounterId?: string;
  category: DomainConditionCategory;
  /** Primary code, normally ICD-10-CM. */
  code: string;
  codeSystem: string;
  display: string;
  /** Optional SNOMED CT equivalent for interop. */
  snomedCode?: string;
  clinicalStatus: DomainConditionClinicalStatus;
  verificationStatus: DomainConditionVerificationStatus;
  /** ISO 8601 date. */
  onsetDate?: string;
  /** ISO 8601 date. */
  abatementDate?: string;
  severityCode?: string;
  bodySiteCode?: string;
  note?: string;
  /** ISO 8601 instant. */
  recordedAt: string;
}

/** `recordedById` is provenance and is served as a Provenance resource. */
export const CONDITION_DROPPED_FIELDS = [
  'tenantId',
  'recordedById',
  'createdAt',
  'updatedAt',
] as const;

/** Maps a {@link DomainCondition} to a FHIR R4 `Condition`. */
export function toFhirCondition(input: DomainCondition): fhir4.Condition {
  const codings = present<fhir4.Coding>([
    input.code === '' ? undefined : compact({ system: input.codeSystem, code: input.code }),
    input.snomedCode === undefined || input.snomedCode === ''
      ? undefined
      : { system: SYSTEMS.snomed, code: input.snomedCode },
  ]);

  return compact<fhir4.Condition>({
    resourceType: 'Condition',
    id: input.id,
    clinicalStatus: codeableConcept({
      system: SYSTEMS.conditionClinical,
      code: CLINICAL_STATUS.toFhir(input.clinicalStatus),
    }),
    verificationStatus: codeableConcept({
      system: SYSTEMS.conditionVerStatus,
      code: VERIFICATION_STATUS.toFhir(input.verificationStatus),
    }),
    category: [CONDITION_CATEGORY.toConcept(input.category)],
    severity: codeableConcept({ system: SYSTEMS.snomed, code: input.severityCode }),
    code: compact<fhir4.CodeableConcept>({
      coding: codings,
      text: input.display === '' ? undefined : input.display,
    }),
    bodySite: present<fhir4.CodeableConcept>([
      codeableConcept({ system: SYSTEMS.snomed, code: input.bodySiteCode }),
    ]),
    subject: fhirReference('Patient', input.patientId),
    encounter: optionalReference('Encounter', input.encounterId),
    onsetDateTime: input.onsetDate,
    abatementDateTime: input.abatementDate,
    recordedDate: input.recordedAt,
    note: annotations(input.note),
  });
}

/** Maps a FHIR R4 `Condition` back to a {@link DomainCondition}. */
export function fromFhirCondition(resource: fhir4.Condition): DomainCondition {
  const codings = resource.code?.coding ?? [];
  const primary = codings[0];
  const snomed = codings.slice(1).find((entry) => entry.system === SYSTEMS.snomed);

  const domain: DomainCondition = {
    id: resource.id ?? '',
    patientId: referenceId(resource.subject, 'Patient') ?? '',
    category: CONDITION_CATEGORY.fromConcepts(resource.category) ?? 'PROBLEM_LIST_ITEM',
    code: primary?.code ?? '',
    codeSystem: primary?.system ?? '',
    display: resource.code?.text ?? '',
    clinicalStatus: CLINICAL_STATUS.fromFhir(
      readCode(resource.clinicalStatus, SYSTEMS.conditionClinical)
    ),
    verificationStatus: VERIFICATION_STATUS.fromFhir(
      readCode(resource.verificationStatus, SYSTEMS.conditionVerStatus)
    ),
    recordedAt: resource.recordedDate ?? '',
  };
  setOptional(domain, 'encounterId', referenceId(resource.encounter, 'Encounter'));
  setOptional(domain, 'snomedCode', readString(snomed?.code));
  setOptional(domain, 'onsetDate', readString(resource.onsetDateTime));
  setOptional(domain, 'abatementDate', readString(resource.abatementDateTime));
  setOptional(domain, 'severityCode', readCode(resource.severity, SYSTEMS.snomed));
  setOptional(domain, 'bodySiteCode', readCode(resource.bodySite?.[0], SYSTEMS.snomed));
  setOptional(domain, 'note', readAnnotation(resource.note));
  return domain;
}
