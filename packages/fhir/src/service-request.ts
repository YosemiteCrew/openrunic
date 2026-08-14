/// <reference types="fhir" preserve="true" />

import { conceptMapping, enumMapping } from './enum-mapping.js';
import {
  codeExtension,
  localStatusExtension,
  openrunicCodeSystem,
  openrunicExtension,
  readCodeExtension,
  readLocalStatus,
} from './extensions.js';
import {
  annotations,
  codeableConcepts,
  compact,
  present,
  readAnnotation,
  readCodes,
  readString,
  setOptional,
} from './primitives.js';
import { fhirReference, optionalReference, referenceId } from './reference.js';
import { SYSTEMS } from './systems.js';

/** Code system for the five order categories Openrunic routes on. */
export const SERVICE_CATEGORY_SYSTEM = openrunicCodeSystem('service-category');

/** Namespace for the requisition number printed on the order. */
export const REQUISITION_SYSTEM = 'https://openrunic.org/fhir/sid/requisition';

/** Carries the compendium's specimen type, which R4 models only as a Specimen. */
export const SPECIMEN_TYPE_EXTENSION = openrunicExtension('specimen-type');

/** An order is a lab, imaging, procedure, referral or therapy request. */
export type DomainServiceCategory = 'LAB' | 'IMAGING' | 'PROCEDURE' | 'REFERRAL' | 'THERAPY';

/**
 * Order lifecycle. `PENDED`, `TRANSMITTED`, `IN_PROGRESS` and `RESULTED` are
 * Openrunic states with no distinct FHIR code, so they also travel in the
 * local-status extension.
 */
export type DomainServiceRequestStatus =
  | 'DRAFT'
  | 'PENDED'
  | 'SIGNED'
  | 'TRANSMITTED'
  | 'IN_PROGRESS'
  | 'RESULTED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'ENTERED_IN_ERROR';

export type DomainServiceRequestIntent =
  'PROPOSAL' | 'PLAN' | 'ORDER' | 'ORIGINAL_ORDER' | 'REFLEX_ORDER';

export type DomainOrderPriority = 'ROUTINE' | 'URGENT' | 'ASAP' | 'STAT';

export const SERVICE_REQUEST_CATEGORY = conceptMapping<DomainServiceCategory>({
  LAB: { system: SERVICE_CATEGORY_SYSTEM, code: 'lab' },
  IMAGING: { system: SERVICE_CATEGORY_SYSTEM, code: 'imaging' },
  PROCEDURE: { system: SERVICE_CATEGORY_SYSTEM, code: 'procedure' },
  REFERRAL: { system: SERVICE_CATEGORY_SYSTEM, code: 'referral' },
  THERAPY: { system: SERVICE_CATEGORY_SYSTEM, code: 'therapy' },
});

export const SERVICE_REQUEST_STATUS = enumMapping<
  DomainServiceRequestStatus,
  fhir4.ServiceRequest['status']
>({
  map: {
    DRAFT: 'draft',
    PENDED: 'draft',
    SIGNED: 'active',
    TRANSMITTED: 'active',
    IN_PROGRESS: 'active',
    RESULTED: 'completed',
    COMPLETED: 'completed',
    CANCELLED: 'revoked',
    ENTERED_IN_ERROR: 'entered-in-error',
  },
  canonical: { draft: 'DRAFT', active: 'SIGNED', completed: 'COMPLETED' },
  fallback: 'DRAFT',
});

const SERVICE_REQUEST_INTENT = enumMapping<
  DomainServiceRequestIntent,
  fhir4.ServiceRequest['intent']
>({
  map: {
    PROPOSAL: 'proposal',
    PLAN: 'plan',
    ORDER: 'order',
    ORIGINAL_ORDER: 'original-order',
    REFLEX_ORDER: 'reflex-order',
  },
  fallback: 'ORDER',
});

export const ORDER_PRIORITY = enumMapping<
  DomainOrderPriority,
  NonNullable<fhir4.ServiceRequest['priority']>
>({
  map: { ROUTINE: 'routine', URGENT: 'urgent', ASAP: 'asap', STAT: 'stat' },
  fallback: 'ROUTINE',
});

/** The order itself: lab, imaging, procedure, referral or therapy. */
export interface DomainServiceRequest {
  id: string;
  patientId: string;
  encounterId?: string;
  orderedById: string;
  category: DomainServiceCategory;
  status: DomainServiceRequestStatus;
  intent: DomainServiceRequestIntent;
  priority: DomainOrderPriority;
  /** Orderable code from the tenant's compendium (LOINC, CPT, local). */
  code: string;
  codeSystem: string;
  display: string;
  specimenTypeCode?: string;
  /** ICD-10-CM codes justifying medical necessity. */
  reasonCodes: string[];
  note?: string;
  requisitionNumber?: string;
  performingLabName?: string;
  /** ISO 8601 instant. */
  requestedAt: string;
  /** ISO 8601 instant. */
  scheduledFor?: string;
}

/**
 * `aoeAnswers` is a form-engine document keyed by compendium question ids and
 * belongs to a QuestionnaireResponse, not to the order. `labRef` and
 * `transmittedAt` are the labs adapter's transport bookkeeping.
 */
export const SERVICE_REQUEST_DROPPED_FIELDS = [
  'tenantId',
  'aoeAnswers',
  'labRef',
  'transmittedAt',
  'createdAt',
  'updatedAt',
] as const;

/** Maps a {@link DomainServiceRequest} to a FHIR R4 `ServiceRequest`. */
export function toFhirServiceRequest(input: DomainServiceRequest): fhir4.ServiceRequest {
  return compact<fhir4.ServiceRequest>({
    resourceType: 'ServiceRequest',
    id: input.id,
    extension: present<fhir4.Extension>([
      localStatusExtension(SERVICE_REQUEST_STATUS, input.status),
      codeExtension(SPECIMEN_TYPE_EXTENSION, input.specimenTypeCode),
    ]),
    status: SERVICE_REQUEST_STATUS.toFhir(input.status),
    intent: SERVICE_REQUEST_INTENT.toFhir(input.intent),
    category: [SERVICE_REQUEST_CATEGORY.toConcept(input.category)],
    priority: ORDER_PRIORITY.toFhir(input.priority),
    code: compact<fhir4.CodeableConcept>({
      coding: present<fhir4.Coding>([
        input.code === '' ? undefined : compact({ system: input.codeSystem, code: input.code }),
      ]),
      text: input.display === '' ? undefined : input.display,
    }),
    requisition:
      input.requisitionNumber === undefined || input.requisitionNumber === ''
        ? undefined
        : { system: REQUISITION_SYSTEM, value: input.requisitionNumber },
    subject: fhirReference('Patient', input.patientId),
    encounter: optionalReference('Encounter', input.encounterId),
    occurrenceDateTime: input.scheduledFor,
    authoredOn: input.requestedAt,
    requester: fhirReference('Practitioner', input.orderedById),
    performer:
      input.performingLabName === undefined || input.performingLabName === ''
        ? undefined
        : [{ display: input.performingLabName }],
    reasonCode: codeableConcepts(input.reasonCodes, SYSTEMS.icd10cm),
    note: annotations(input.note),
  });
}

/** Maps a FHIR R4 `ServiceRequest` back to a {@link DomainServiceRequest}. */
export function fromFhirServiceRequest(resource: fhir4.ServiceRequest): DomainServiceRequest {
  const primary = resource.code?.coding?.[0];
  const domain: DomainServiceRequest = {
    id: resource.id ?? '',
    patientId: referenceId(resource.subject, 'Patient') ?? '',
    orderedById: referenceId(resource.requester, 'Practitioner') ?? '',
    category: SERVICE_REQUEST_CATEGORY.fromConcepts(resource.category) ?? 'LAB',
    status: readLocalStatus(SERVICE_REQUEST_STATUS, resource.extension, resource.status),
    intent: SERVICE_REQUEST_INTENT.fromFhir(resource.intent),
    priority: ORDER_PRIORITY.fromFhir(resource.priority),
    code: primary?.code ?? '',
    codeSystem: primary?.system ?? '',
    display: resource.code?.text ?? '',
    reasonCodes: readCodes(resource.reasonCode, SYSTEMS.icd10cm),
    requestedAt: resource.authoredOn ?? '',
  };
  setOptional(domain, 'encounterId', referenceId(resource.encounter, 'Encounter'));
  setOptional(
    domain,
    'specimenTypeCode',
    readCodeExtension(resource.extension, SPECIMEN_TYPE_EXTENSION)
  );
  setOptional(domain, 'note', readAnnotation(resource.note));
  setOptional(domain, 'requisitionNumber', readString(resource.requisition?.value));
  setOptional(domain, 'performingLabName', readString(resource.performer?.[0]?.display));
  setOptional(domain, 'scheduledFor', readString(resource.occurrenceDateTime));
  return domain;
}
