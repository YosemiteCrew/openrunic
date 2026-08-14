/// <reference types="fhir" preserve="true" />

import { conceptMapping, enumMapping } from './enum-mapping.js';
import {
  codeExtension,
  openrunicExtension,
  readCodeExtension,
  readReferenceExtension,
  referenceExtension,
} from './extensions.js';
import {
  codeableConcept,
  compact,
  present,
  quantity,
  readCode,
  readQuantityUnit,
  readQuantityValue,
  readString,
  setOptional,
  simpleQuantity,
} from './primitives.js';
import { fhirReference, optionalReference, referenceId } from './reference.js';
import { SYSTEMS } from './systems.js';

/** Carries the three-value triage flag, which is an Openrunic product concept. */
export const ABNORMAL_FLAG_EXTENSION = openrunicExtension('abnormal-flag');

/** Links a discrete result back to the report it belongs to. */
export const DIAGNOSTIC_REPORT_EXTENSION = openrunicExtension('diagnostic-report');

/**
 * Report-level and result-level triage flag. Deliberately not the HL7
 * interpretation value set, which stays a coded string in `interpretationCode`.
 */
export type DomainAbnormalFlag = 'NORMAL' | 'ABNORMAL' | 'CRITICAL';

const ABNORMAL_FLAGS: readonly DomainAbnormalFlag[] = ['NORMAL', 'ABNORMAL', 'CRITICAL'];

/** Reads the abnormal-flag extension, defaulting to `NORMAL`. */
export function readAbnormalFlag(extensions: fhir4.Extension[] | undefined): DomainAbnormalFlag {
  const code = readCodeExtension(extensions, ABNORMAL_FLAG_EXTENSION);
  return ABNORMAL_FLAGS.find((flag) => flag === code) ?? 'NORMAL';
}

export type DomainObservationCategory =
  | 'VITAL_SIGNS'
  | 'LABORATORY'
  | 'IMAGING'
  | 'SOCIAL_HISTORY'
  | 'SDOH'
  | 'SURVEY'
  | 'EXAM'
  | 'PROCEDURE'
  | 'THERAPY'
  | 'ACTIVITY';

export type DomainObservationStatus =
  | 'REGISTERED'
  | 'PRELIMINARY'
  | 'FINAL'
  | 'AMENDED'
  | 'CORRECTED'
  | 'CANCELLED'
  | 'ENTERED_IN_ERROR';

const OBSERVATION_CATEGORY = conceptMapping<DomainObservationCategory>({
  VITAL_SIGNS: { system: SYSTEMS.observationCategory, code: 'vital-signs' },
  LABORATORY: { system: SYSTEMS.observationCategory, code: 'laboratory' },
  IMAGING: { system: SYSTEMS.observationCategory, code: 'imaging' },
  SOCIAL_HISTORY: { system: SYSTEMS.observationCategory, code: 'social-history' },
  SDOH: { system: SYSTEMS.usCoreCategory, code: 'sdoh' },
  SURVEY: { system: SYSTEMS.observationCategory, code: 'survey' },
  EXAM: { system: SYSTEMS.observationCategory, code: 'exam' },
  PROCEDURE: { system: SYSTEMS.observationCategory, code: 'procedure' },
  THERAPY: { system: SYSTEMS.observationCategory, code: 'therapy' },
  ACTIVITY: { system: SYSTEMS.observationCategory, code: 'activity' },
});

export const OBSERVATION_STATUS = enumMapping<DomainObservationStatus, fhir4.Observation['status']>(
  {
    map: {
      REGISTERED: 'registered',
      PRELIMINARY: 'preliminary',
      FINAL: 'final',
      AMENDED: 'amended',
      CORRECTED: 'corrected',
      CANCELLED: 'cancelled',
      ENTERED_IN_ERROR: 'entered-in-error',
    },
    fallback: 'FINAL',
  }
);

/**
 * Vitals, in-house labs, SDOH answers and survey scores.
 *
 * Exactly one value column is populated on a real row. When several are, the
 * mapper keeps the highest-precedence one - number, then code, then boolean,
 * then text - and the round-trip contract applies to that value only.
 */
export interface DomainObservation {
  id: string;
  patientId: string;
  encounterId?: string;
  category: DomainObservationCategory;
  status: DomainObservationStatus;
  code: string;
  codeSystem: string;
  display: string;
  valueNumber?: number;
  valueText?: string;
  valueCode?: string;
  valueBoolean?: boolean;
  /** UCUM unit. */
  unit?: string;
  referenceLow?: number;
  referenceHigh?: number;
  /** HL7 ObservationInterpretation code, e.g. `H`, `L`, `A`. */
  interpretationCode?: string;
  bodySiteCode?: string;
  /** ISO 8601 instant. */
  effectiveAt: string;
  /** ISO 8601 instant. */
  issuedAt?: string;
  performerId?: string;
}

/**
 * `loincCode` is a denormalized copy of `code` kept for index support: when
 * `codeSystem` is LOINC the two are the same value, and the API reconstructs it
 * on the way in. `formSubmissionId` is form-engine provenance.
 */
export const OBSERVATION_DROPPED_FIELDS = [
  'tenantId',
  'loincCode',
  'formSubmissionId',
  'createdAt',
  'updatedAt',
] as const;

interface ObservationValue {
  valueQuantity?: fhir4.Quantity;
  valueCodeableConcept?: fhir4.CodeableConcept;
  valueBoolean?: boolean;
  valueString?: string;
}

function toObservationValue(input: {
  valueNumber?: number;
  valueCode?: string;
  valueBoolean?: boolean;
  valueText?: string;
  unit?: string;
}): ObservationValue {
  if (input.valueNumber !== undefined) {
    return { valueQuantity: quantity(input.valueNumber, input.unit) };
  }
  if (input.valueCode !== undefined && input.valueCode !== '') {
    return { valueCodeableConcept: codeableConcept({ code: input.valueCode }) };
  }
  if (input.valueBoolean !== undefined) {
    return { valueBoolean: input.valueBoolean };
  }
  if (input.valueText !== undefined && input.valueText !== '') {
    return { valueString: input.valueText };
  }
  return {};
}

function referenceRange(
  low: number | undefined,
  high: number | undefined,
  unit: string | undefined,
  text?: string
): fhir4.ObservationReferenceRange[] {
  const range = compact<fhir4.ObservationReferenceRange>({
    low: simpleQuantity(low, unit),
    high: simpleQuantity(high, unit),
    text,
  });
  return Object.keys(range).length > 0 ? [range] : [];
}

function codeConcept(code: string, codeSystem: string, display: string): fhir4.CodeableConcept {
  return compact<fhir4.CodeableConcept>({
    coding: present<fhir4.Coding>([
      code === '' ? undefined : compact({ system: codeSystem, code }),
    ]),
    text: display === '' ? undefined : display,
  });
}

/** Maps a {@link DomainObservation} to a FHIR R4 `Observation`. */
export function toFhirObservation(input: DomainObservation): fhir4.Observation {
  return compact<fhir4.Observation>({
    resourceType: 'Observation',
    id: input.id,
    status: OBSERVATION_STATUS.toFhir(input.status),
    category: [OBSERVATION_CATEGORY.toConcept(input.category)],
    code: codeConcept(input.code, input.codeSystem, input.display),
    subject: fhirReference('Patient', input.patientId),
    encounter: optionalReference('Encounter', input.encounterId),
    effectiveDateTime: input.effectiveAt,
    issued: input.issuedAt,
    performer: present<fhir4.Reference>([optionalReference('Practitioner', input.performerId)]),
    ...toObservationValue(input),
    interpretation: present<fhir4.CodeableConcept>([
      codeableConcept({
        system: SYSTEMS.observationInterpretation,
        code: input.interpretationCode,
      }),
    ]),
    bodySite: codeableConcept({ system: SYSTEMS.snomed, code: input.bodySiteCode }),
    referenceRange: referenceRange(input.referenceLow, input.referenceHigh, input.unit),
  });
}

function readObservationValue(resource: fhir4.Observation): ObservationDomainValue {
  const value = readQuantityValue(resource.valueQuantity);
  if (value !== undefined) {
    const read: ObservationDomainValue = { valueNumber: value };
    setOptional(read, 'unit', readQuantityUnit(resource.valueQuantity));
    return read;
  }
  const code = readCode(resource.valueCodeableConcept);
  if (code !== undefined) {
    return { valueCode: code };
  }
  if (typeof resource.valueBoolean === 'boolean') {
    return { valueBoolean: resource.valueBoolean };
  }
  const text = readString(resource.valueString);
  return text === undefined ? {} : { valueText: text };
}

interface ObservationDomainValue {
  valueNumber?: number;
  valueCode?: string;
  valueBoolean?: boolean;
  valueText?: string;
  unit?: string;
}

/** Maps a FHIR R4 `Observation` back to a {@link DomainObservation}. */
export function fromFhirObservation(resource: fhir4.Observation): DomainObservation {
  const primary = resource.code?.coding?.[0];
  const range = resource.referenceRange?.[0];

  const domain: DomainObservation = {
    id: resource.id ?? '',
    patientId: referenceId(resource.subject, 'Patient') ?? '',
    category: OBSERVATION_CATEGORY.fromConcepts(resource.category) ?? 'VITAL_SIGNS',
    status: OBSERVATION_STATUS.fromFhir(resource.status),
    code: primary?.code ?? '',
    codeSystem: primary?.system ?? '',
    display: resource.code?.text ?? '',
    effectiveAt: resource.effectiveDateTime ?? '',
  };
  setOptional(domain, 'encounterId', referenceId(resource.encounter, 'Encounter'));
  const value = readObservationValue(resource);
  setOptional(domain, 'valueNumber', value.valueNumber);
  setOptional(domain, 'valueCode', value.valueCode);
  setOptional(domain, 'valueBoolean', value.valueBoolean);
  setOptional(domain, 'valueText', value.valueText);
  setOptional(domain, 'unit', value.unit);
  setOptional(domain, 'referenceLow', readQuantityValue(range?.low));
  setOptional(domain, 'referenceHigh', readQuantityValue(range?.high));
  if (domain.unit === undefined) {
    setOptional(domain, 'unit', readQuantityUnit(range?.low) ?? readQuantityUnit(range?.high));
  }
  setOptional(
    domain,
    'interpretationCode',
    readCode(resource.interpretation?.[0], SYSTEMS.observationInterpretation)
  );
  setOptional(domain, 'bodySiteCode', readCode(resource.bodySite, SYSTEMS.snomed));
  setOptional(domain, 'issuedAt', readString(resource.issued));
  setOptional(domain, 'performerId', referenceId(resource.performer?.[0], 'Practitioner'));
  return domain;
}

/**
 * One discrete analyte within a DiagnosticReport. It serializes as an
 * `Observation` too, with the parent report carried in an extension so a
 * standalone read still knows where the value came from.
 *
 * A result line has no boolean value column, so an incoming `valueBoolean` is
 * read as no value at all rather than being coerced into text.
 */
export interface DomainResultObservation {
  id: string;
  diagnosticReportId: string;
  patientId: string;
  status: DomainObservationStatus;
  code: string;
  codeSystem: string;
  display: string;
  valueNumber?: number;
  valueText?: string;
  valueCode?: string;
  unit?: string;
  referenceLow?: number;
  referenceHigh?: number;
  referenceRangeText?: string;
  interpretationCode?: string;
  abnormalFlag: DomainAbnormalFlag;
  /** ISO 8601 instant. */
  effectiveAt: string;
}

/**
 * `sequence` is the result's position inside its report, and that ordering is
 * carried by `DiagnosticReport.result`; `loincCode` is the same denormalized
 * index column as on Observation.
 */
export const RESULT_OBSERVATION_DROPPED_FIELDS = [
  'tenantId',
  'sequence',
  'loincCode',
  'createdAt',
  'updatedAt',
] as const;

/** Maps a {@link DomainResultObservation} to a FHIR R4 `Observation`. */
export function toFhirResultObservation(input: DomainResultObservation): fhir4.Observation {
  return compact<fhir4.Observation>({
    resourceType: 'Observation',
    id: input.id,
    extension: present<fhir4.Extension>([
      referenceExtension(
        DIAGNOSTIC_REPORT_EXTENSION,
        optionalReference('DiagnosticReport', input.diagnosticReportId)
      ),
      codeExtension(ABNORMAL_FLAG_EXTENSION, input.abnormalFlag),
    ]),
    status: OBSERVATION_STATUS.toFhir(input.status),
    category: [OBSERVATION_CATEGORY.toConcept('LABORATORY')],
    code: codeConcept(input.code, input.codeSystem, input.display),
    subject: fhirReference('Patient', input.patientId),
    effectiveDateTime: input.effectiveAt,
    ...toObservationValue(input),
    interpretation: present<fhir4.CodeableConcept>([
      codeableConcept({
        system: SYSTEMS.observationInterpretation,
        code: input.interpretationCode,
      }),
    ]),
    referenceRange: referenceRange(
      input.referenceLow,
      input.referenceHigh,
      input.unit,
      input.referenceRangeText
    ),
  });
}

/** Maps a FHIR R4 `Observation` back to a {@link DomainResultObservation}. */
export function fromFhirResultObservation(resource: fhir4.Observation): DomainResultObservation {
  const primary = resource.code?.coding?.[0];
  const range = resource.referenceRange?.[0];
  const report = readReferenceExtension(resource.extension, DIAGNOSTIC_REPORT_EXTENSION);

  const domain: DomainResultObservation = {
    id: resource.id ?? '',
    diagnosticReportId: referenceId(report, 'DiagnosticReport') ?? '',
    patientId: referenceId(resource.subject, 'Patient') ?? '',
    status: OBSERVATION_STATUS.fromFhir(resource.status),
    code: primary?.code ?? '',
    codeSystem: primary?.system ?? '',
    display: resource.code?.text ?? '',
    abnormalFlag: readAbnormalFlag(resource.extension),
    effectiveAt: resource.effectiveDateTime ?? '',
  };
  const value = readObservationValue(resource);
  setOptional(domain, 'valueNumber', value.valueNumber);
  setOptional(domain, 'valueCode', value.valueCode);
  setOptional(domain, 'valueText', value.valueText);
  setOptional(domain, 'unit', value.unit);
  setOptional(domain, 'referenceLow', readQuantityValue(range?.low));
  setOptional(domain, 'referenceHigh', readQuantityValue(range?.high));
  setOptional(domain, 'referenceRangeText', readString(range?.text));
  if (domain.unit === undefined) {
    setOptional(domain, 'unit', readQuantityUnit(range?.low) ?? readQuantityUnit(range?.high));
  }
  setOptional(
    domain,
    'interpretationCode',
    readCode(resource.interpretation?.[0], SYSTEMS.observationInterpretation)
  );
  return domain;
}
