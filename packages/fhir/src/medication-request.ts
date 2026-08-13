/// <reference types="fhir" preserve="true" />

import { enumMapping } from './enum-mapping.js';
import { localStatusExtension, readLocalStatus } from './extensions.js';
import {
  compact,
  present,
  quantity,
  readCode,
  readQuantityUnit,
  readQuantityValue,
  readString,
  setOptional,
} from './primitives.js';
import { fhirReference, optionalReference, referenceId } from './reference.js';
import { SYSTEMS } from './systems.js';

/**
 * Prescription lifecycle. `PENDED`, `SIGNED` and `TRANSMITTED` are Openrunic's
 * own steps between drafting and an active order; FHIR has no codes for them,
 * so they also travel in the local-status extension.
 */
export type DomainMedicationRequestStatus =
  | 'DRAFT'
  | 'PENDED'
  | 'SIGNED'
  | 'TRANSMITTED'
  | 'ACTIVE'
  | 'ON_HOLD'
  | 'CANCELLED'
  | 'COMPLETED'
  | 'STOPPED'
  | 'ERROR';

export type DomainMedicationRequestIntent =
  'PROPOSAL' | 'PLAN' | 'ORDER' | 'ORIGINAL_ORDER' | 'REFILL';

export const MEDICATION_REQUEST_STATUS = enumMapping<
  DomainMedicationRequestStatus,
  fhir4.MedicationRequest['status']
>({
  map: {
    DRAFT: 'draft',
    PENDED: 'draft',
    SIGNED: 'active',
    TRANSMITTED: 'active',
    ACTIVE: 'active',
    ON_HOLD: 'on-hold',
    CANCELLED: 'cancelled',
    COMPLETED: 'completed',
    STOPPED: 'stopped',
    ERROR: 'entered-in-error',
  },
  canonical: { draft: 'DRAFT', active: 'ACTIVE' },
  fallback: 'DRAFT',
});

const MEDICATION_REQUEST_INTENT = enumMapping<
  DomainMedicationRequestIntent,
  fhir4.MedicationRequest['intent']
>({
  map: {
    PROPOSAL: 'proposal',
    PLAN: 'plan',
    ORDER: 'order',
    ORIGINAL_ORDER: 'original-order',
    REFILL: 'filler-order',
  },
  fallback: 'ORDER',
});

/** A prescription, shaped so the eRx vendor behind the adapter stays swappable. */
export interface DomainMedicationRequest {
  id: string;
  patientId: string;
  encounterId?: string;
  prescriberId: string;
  rxnormCode?: string;
  ndcCode?: string;
  display: string;
  /** The sig as rendered for a human; the structured sig stays internal. */
  sigText: string;
  quantity: number;
  quantityUnit: string;
  refills: number;
  daysSupply?: number;
  dispenseAsWritten: boolean;
  pharmacyName?: string;
  /** NCPDP pharmacy id from the address book. */
  pharmacyNcpdpId?: string;
  status: DomainMedicationRequestStatus;
  intent: DomainMedicationRequestIntent;
  /** ISO 8601 instant. */
  writtenAt: string;
}

/**
 * Prescription columns that stay inside Openrunic.
 *
 * `sig` is the structured document the sig builder authors; `sigText` is its
 * rendering and is what an interoperating system can actually consume.
 * `controlledSchedule` is a property of the drug, resolvable from the RxNorm or
 * NDC code, not of the prescription. `erxRef` and `transmittedAt` are the eRx
 * adapter's transport bookkeeping.
 */
export const MEDICATION_REQUEST_DROPPED_FIELDS = [
  'tenantId',
  'sig',
  'controlledSchedule',
  'erxRef',
  'transmittedAt',
  'createdAt',
  'updatedAt',
] as const;

/** Maps a {@link DomainMedicationRequest} to a FHIR R4 `MedicationRequest`. */
export function toFhirMedicationRequest(input: DomainMedicationRequest): fhir4.MedicationRequest {
  const codings = present<fhir4.Coding>([
    input.rxnormCode === undefined || input.rxnormCode === ''
      ? undefined
      : { system: SYSTEMS.rxnorm, code: input.rxnormCode },
    input.ndcCode === undefined || input.ndcCode === ''
      ? undefined
      : { system: SYSTEMS.ndc, code: input.ndcCode },
  ]);

  const pharmacy: fhir4.Reference | undefined = compactReference(
    input.pharmacyName,
    input.pharmacyNcpdpId
  );

  return compact<fhir4.MedicationRequest>({
    resourceType: 'MedicationRequest',
    id: input.id,
    extension: present<fhir4.Extension>([
      localStatusExtension(MEDICATION_REQUEST_STATUS, input.status),
    ]),
    status: MEDICATION_REQUEST_STATUS.toFhir(input.status),
    intent: MEDICATION_REQUEST_INTENT.toFhir(input.intent),
    medicationCodeableConcept: compact<fhir4.CodeableConcept>({
      coding: codings,
      text: input.display === '' ? undefined : input.display,
    }),
    subject: fhirReference('Patient', input.patientId),
    encounter: optionalReference('Encounter', input.encounterId),
    authoredOn: input.writtenAt,
    requester: fhirReference('Practitioner', input.prescriberId),
    dosageInstruction: input.sigText === '' ? undefined : [{ text: input.sigText }],
    dispenseRequest: compact<fhir4.MedicationRequestDispenseRequest>({
      quantity: quantity(input.quantity, input.quantityUnit),
      numberOfRepeatsAllowed: input.refills,
      expectedSupplyDuration: quantity(input.daysSupply, 'd'),
      performer: pharmacy,
    }),
    substitution: { allowedBoolean: !input.dispenseAsWritten },
  });
}

function compactReference(
  display: string | undefined,
  ncpdpId: string | undefined
): fhir4.Reference | undefined {
  const hasDisplay = display !== undefined && display !== '';
  const hasId = ncpdpId !== undefined && ncpdpId !== '';
  if (!hasDisplay && !hasId) {
    return undefined;
  }
  return compact<fhir4.Reference>({
    identifier: hasId ? { system: SYSTEMS.ncpdp, value: ncpdpId } : undefined,
    display: hasDisplay ? display : undefined,
  });
}

/** Maps a FHIR R4 `MedicationRequest` back to a {@link DomainMedicationRequest}. */
export function fromFhirMedicationRequest(
  resource: fhir4.MedicationRequest
): DomainMedicationRequest {
  const concept = resource.medicationCodeableConcept;
  const dispense = resource.dispenseRequest;

  const domain: DomainMedicationRequest = {
    id: resource.id ?? '',
    patientId: referenceId(resource.subject, 'Patient') ?? '',
    prescriberId: referenceId(resource.requester, 'Practitioner') ?? '',
    display: concept?.text ?? '',
    sigText: resource.dosageInstruction?.[0]?.text ?? '',
    quantity: readQuantityValue(dispense?.quantity) ?? 0,
    quantityUnit: readQuantityUnit(dispense?.quantity) ?? '',
    refills: dispense?.numberOfRepeatsAllowed ?? 0,
    dispenseAsWritten: resource.substitution?.allowedBoolean === false,
    status: readLocalStatus(MEDICATION_REQUEST_STATUS, resource.extension, resource.status),
    intent: MEDICATION_REQUEST_INTENT.fromFhir(resource.intent),
    writtenAt: resource.authoredOn ?? '',
  };
  setOptional(domain, 'encounterId', referenceId(resource.encounter, 'Encounter'));
  setOptional(domain, 'rxnormCode', readCode(concept, SYSTEMS.rxnorm));
  setOptional(domain, 'ndcCode', readCode(concept, SYSTEMS.ndc));
  setOptional(domain, 'daysSupply', readQuantityValue(dispense?.expectedSupplyDuration));
  setOptional(domain, 'pharmacyName', readString(dispense?.performer?.display));
  setOptional(domain, 'pharmacyNcpdpId', readString(dispense?.performer?.identifier?.value));
  return domain;
}
