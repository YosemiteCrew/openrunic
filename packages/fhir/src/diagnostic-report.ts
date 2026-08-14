/// <reference types="fhir" preserve="true" />

import { conceptMapping, enumMapping } from './enum-mapping.js';
import { codeExtension, openrunicCodeSystem } from './extensions.js';
import { ABNORMAL_FLAG_EXTENSION, readAbnormalFlag } from './observation.js';
import type { DomainAbnormalFlag } from './observation.js';
import { compact, present, readString, setOptional } from './primitives.js';
import { fhirReference, optionalReference, referenceId, referenceIds } from './reference.js';
import type { DomainServiceCategory } from './service-request.js';
import { SYSTEMS } from './systems.js';

/** Code system for the report categories v2-0074 does not cover. */
export const REPORT_CATEGORY_SYSTEM = openrunicCodeSystem('report-category');

export type DomainDiagnosticReportStatus =
  | 'REGISTERED'
  | 'PARTIAL'
  | 'PRELIMINARY'
  | 'FINAL'
  | 'AMENDED'
  | 'CORRECTED'
  | 'APPENDED'
  | 'CANCELLED'
  | 'ENTERED_IN_ERROR';

const REPORT_CATEGORY = conceptMapping<DomainServiceCategory>({
  LAB: { system: SYSTEMS.diagnosticServiceSection, code: 'LAB' },
  IMAGING: { system: SYSTEMS.diagnosticServiceSection, code: 'RAD' },
  PROCEDURE: { system: REPORT_CATEGORY_SYSTEM, code: 'procedure' },
  REFERRAL: { system: REPORT_CATEGORY_SYSTEM, code: 'referral' },
  THERAPY: { system: REPORT_CATEGORY_SYSTEM, code: 'therapy' },
});

const REPORT_STATUS = enumMapping<DomainDiagnosticReportStatus, fhir4.DiagnosticReport['status']>({
  map: {
    REGISTERED: 'registered',
    PARTIAL: 'partial',
    PRELIMINARY: 'preliminary',
    FINAL: 'final',
    AMENDED: 'amended',
    CORRECTED: 'corrected',
    APPENDED: 'appended',
    CANCELLED: 'cancelled',
    ENTERED_IN_ERROR: 'entered-in-error',
  },
  fallback: 'FINAL',
});

/** A result report from a lab or imaging centre. */
export interface DomainDiagnosticReport {
  id: string;
  patientId: string;
  encounterId?: string;
  serviceRequestId?: string;
  specimenId?: string;
  status: DomainDiagnosticReportStatus;
  category: DomainServiceCategory;
  /** LOINC panel code. */
  code: string;
  codeSystem: string;
  display: string;
  performingLabName?: string;
  abnormalFlag: DomainAbnormalFlag;
  narrative?: string;
  /** Ids of the discrete results that hang off this report. */
  resultIds: string[];
  /** ISO 8601 instant. */
  effectiveAt?: string;
  /** ISO 8601 instant. */
  issuedAt: string;
}

/**
 * `rawStorageKey` is the object-storage key for the original HL7 or PDF
 * payload; the API serves that through a Binary endpoint rather than leaking a
 * bucket key. `reviewedAt` and `reviewedById` are inbox sign-off state, which
 * travels as a Task.
 */
export const DIAGNOSTIC_REPORT_DROPPED_FIELDS = [
  'tenantId',
  'rawStorageKey',
  'reviewedById',
  'reviewedAt',
  'createdAt',
  'updatedAt',
] as const;

/** Maps a {@link DomainDiagnosticReport} to a FHIR R4 `DiagnosticReport`. */
export function toFhirDiagnosticReport(input: DomainDiagnosticReport): fhir4.DiagnosticReport {
  return compact<fhir4.DiagnosticReport>({
    resourceType: 'DiagnosticReport',
    id: input.id,
    extension: present<fhir4.Extension>([
      codeExtension(ABNORMAL_FLAG_EXTENSION, input.abnormalFlag),
    ]),
    status: REPORT_STATUS.toFhir(input.status),
    category: [REPORT_CATEGORY.toConcept(input.category)],
    code: compact<fhir4.CodeableConcept>({
      coding: present<fhir4.Coding>([
        input.code === '' ? undefined : compact({ system: input.codeSystem, code: input.code }),
      ]),
      text: input.display === '' ? undefined : input.display,
    }),
    subject: fhirReference('Patient', input.patientId),
    encounter: optionalReference('Encounter', input.encounterId),
    basedOn: present<fhir4.Reference>([
      optionalReference('ServiceRequest', input.serviceRequestId),
    ]),
    effectiveDateTime: input.effectiveAt,
    issued: input.issuedAt,
    performer:
      input.performingLabName === undefined || input.performingLabName === ''
        ? undefined
        : [{ display: input.performingLabName }],
    specimen: present<fhir4.Reference>([optionalReference('Specimen', input.specimenId)]),
    result: input.resultIds.map((id) => fhirReference('Observation', id)),
    conclusion: input.narrative,
  });
}

/** Maps a FHIR R4 `DiagnosticReport` back to a {@link DomainDiagnosticReport}. */
export function fromFhirDiagnosticReport(resource: fhir4.DiagnosticReport): DomainDiagnosticReport {
  const primary = resource.code?.coding?.[0];
  const domain: DomainDiagnosticReport = {
    id: resource.id ?? '',
    patientId: referenceId(resource.subject, 'Patient') ?? '',
    status: REPORT_STATUS.fromFhir(resource.status),
    category: REPORT_CATEGORY.fromConcepts(resource.category) ?? 'LAB',
    code: primary?.code ?? '',
    codeSystem: primary?.system ?? '',
    display: resource.code?.text ?? '',
    abnormalFlag: readAbnormalFlag(resource.extension),
    resultIds: referenceIds(resource.result, 'Observation'),
    issuedAt: resource.issued ?? '',
  };
  setOptional(domain, 'encounterId', referenceId(resource.encounter, 'Encounter'));
  setOptional(domain, 'serviceRequestId', referenceId(resource.basedOn?.[0], 'ServiceRequest'));
  setOptional(domain, 'specimenId', referenceId(resource.specimen?.[0], 'Specimen'));
  setOptional(domain, 'performingLabName', readString(resource.performer?.[0]?.display));
  setOptional(domain, 'narrative', readString(resource.conclusion));
  setOptional(domain, 'effectiveAt', readString(resource.effectiveDateTime));
  return domain;
}
