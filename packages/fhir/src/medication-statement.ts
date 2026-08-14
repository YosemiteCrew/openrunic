/// <reference types="fhir" preserve="true" />

import { enumMapping } from './enum-mapping.js';
import { codeExtension, openrunicExtension, readCodeExtension } from './extensions.js';
import {
  annotations,
  compact,
  period,
  present,
  readAnnotation,
  readCode,
  readString,
  setOptional,
} from './primitives.js';
import { fhirReference, optionalReference, referenceId } from './reference.js';
import { SYSTEMS } from './systems.js';

/** Carries where a medication statement came from, which R4 does not model. */
export const MEDICATION_SOURCE_EXTENSION = openrunicExtension('medication-source');

export type DomainMedicationStatementStatus =
  | 'ACTIVE'
  | 'COMPLETED'
  | 'ENTERED_IN_ERROR'
  | 'INTENDED'
  | 'STOPPED'
  | 'ON_HOLD'
  | 'NOT_TAKEN'
  | 'UNKNOWN';

export type DomainMedicationSource = 'REPORTED' | 'PRESCRIBED' | 'RECONCILED' | 'IMPORTED';

const MEDICATION_STATEMENT_STATUS = enumMapping<
  DomainMedicationStatementStatus,
  fhir4.MedicationStatement['status']
>({
  map: {
    ACTIVE: 'active',
    COMPLETED: 'completed',
    ENTERED_IN_ERROR: 'entered-in-error',
    INTENDED: 'intended',
    STOPPED: 'stopped',
    ON_HOLD: 'on-hold',
    NOT_TAKEN: 'not-taken',
    UNKNOWN: 'unknown',
  },
  fallback: 'UNKNOWN',
});

const MEDICATION_SOURCES: readonly DomainMedicationSource[] = [
  'REPORTED',
  'PRESCRIBED',
  'RECONCILED',
  'IMPORTED',
];

/** What the patient reports taking, including outside prescriptions. */
export interface DomainMedicationStatement {
  id: string;
  patientId: string;
  encounterId?: string;
  /** RxNorm concept id. */
  rxnormCode?: string;
  display: string;
  sigText?: string;
  status: DomainMedicationStatementStatus;
  source: DomainMedicationSource;
  /** ISO 8601 date. */
  effectiveStart?: string;
  /** ISO 8601 date. */
  effectiveEnd?: string;
  /** ISO 8601 instant. */
  reportedAt: string;
  note?: string;
}

export const MEDICATION_STATEMENT_DROPPED_FIELDS = ['tenantId', 'createdAt', 'updatedAt'] as const;

/** Maps a {@link DomainMedicationStatement} to a FHIR R4 `MedicationStatement`. */
export function toFhirMedicationStatement(
  input: DomainMedicationStatement
): fhir4.MedicationStatement {
  const codings = present<fhir4.Coding>([
    input.rxnormCode === undefined || input.rxnormCode === ''
      ? undefined
      : { system: SYSTEMS.rxnorm, code: input.rxnormCode },
  ]);

  return compact<fhir4.MedicationStatement>({
    resourceType: 'MedicationStatement',
    id: input.id,
    extension: present<fhir4.Extension>([codeExtension(MEDICATION_SOURCE_EXTENSION, input.source)]),
    status: MEDICATION_STATEMENT_STATUS.toFhir(input.status),
    medicationCodeableConcept: compact<fhir4.CodeableConcept>({
      coding: codings,
      text: input.display === '' ? undefined : input.display,
    }),
    subject: fhirReference('Patient', input.patientId),
    context: optionalReference('Encounter', input.encounterId),
    effectivePeriod: period(input.effectiveStart, input.effectiveEnd),
    dateAsserted: input.reportedAt,
    dosage:
      input.sigText === undefined || input.sigText === '' ? undefined : [{ text: input.sigText }],
    note: annotations(input.note),
  });
}

/** Maps a FHIR R4 `MedicationStatement` back to a {@link DomainMedicationStatement}. */
export function fromFhirMedicationStatement(
  resource: fhir4.MedicationStatement
): DomainMedicationStatement {
  const source = readCodeExtension(resource.extension, MEDICATION_SOURCE_EXTENSION);
  const domain: DomainMedicationStatement = {
    id: resource.id ?? '',
    patientId: referenceId(resource.subject, 'Patient') ?? '',
    display: resource.medicationCodeableConcept?.text ?? '',
    status: MEDICATION_STATEMENT_STATUS.fromFhir(resource.status),
    source: MEDICATION_SOURCES.find((value) => value === source) ?? 'REPORTED',
    reportedAt: resource.dateAsserted ?? '',
  };
  setOptional(domain, 'encounterId', referenceId(resource.context, 'Encounter'));
  setOptional(domain, 'rxnormCode', readCode(resource.medicationCodeableConcept, SYSTEMS.rxnorm));
  setOptional(domain, 'sigText', readString(resource.dosage?.[0]?.text));
  setOptional(domain, 'effectiveStart', readString(resource.effectivePeriod?.start));
  setOptional(domain, 'effectiveEnd', readString(resource.effectivePeriod?.end));
  setOptional(domain, 'note', readAnnotation(resource.note));
  return domain;
}
