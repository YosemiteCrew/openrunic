/// <reference types="fhir" preserve="true" />

import { enumMapping } from './enum-mapping.js';
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
} from './primitives.js';
import { fhirReference, optionalReference, referenceId } from './reference.js';
import { SYSTEMS } from './systems.js';

export type DomainImmunizationStatus = 'COMPLETED' | 'NOT_DONE' | 'ENTERED_IN_ERROR';

const IMMUNIZATION_STATUS = enumMapping<DomainImmunizationStatus, fhir4.Immunization['status']>({
  map: {
    COMPLETED: 'completed',
    NOT_DONE: 'not-done',
    ENTERED_IN_ERROR: 'entered-in-error',
  },
  fallback: 'COMPLETED',
});

/** An administered or refused vaccine dose. */
export interface DomainImmunization {
  id: string;
  patientId: string;
  encounterId?: string;
  status: DomainImmunizationStatus;
  /** CDC CVX vaccine code. */
  cvxCode: string;
  /** CDC MVX manufacturer code. */
  mvxCode?: string;
  ndcCode?: string;
  display: string;
  lotNumber?: string;
  /** ISO 8601 date. */
  expirationDate?: string;
  siteCode?: string;
  routeCode?: string;
  doseQuantity?: number;
  doseUnit?: string;
  /** ISO 8601 instant. */
  administeredAt: string;
  administeredById?: string;
  /** Vaccine Information Statement publication date, required for reporting. */
  visDate?: string;
  refusalReasonCode?: string;
}

/**
 * Registry submission state is Openrunic's own transport bookkeeping: the VXU
 * message is generated from this row, and when it was accepted says nothing
 * about the clinical fact.
 */
export const IMMUNIZATION_DROPPED_FIELDS = [
  'tenantId',
  'reportedToRegistryAt',
  'createdAt',
  'updatedAt',
] as const;

/** Maps a {@link DomainImmunization} to a FHIR R4 `Immunization`. */
export function toFhirImmunization(input: DomainImmunization): fhir4.Immunization {
  const codings = present<fhir4.Coding>([
    input.cvxCode === '' ? undefined : { system: SYSTEMS.cvx, code: input.cvxCode },
    input.ndcCode === undefined || input.ndcCode === ''
      ? undefined
      : { system: SYSTEMS.ndc, code: input.ndcCode },
  ]);

  const manufacturer: fhir4.Reference | undefined =
    input.mvxCode === undefined || input.mvxCode === ''
      ? undefined
      : { identifier: { system: SYSTEMS.mvx, value: input.mvxCode } };

  const performer: fhir4.ImmunizationPerformer[] = [];
  if (input.administeredById !== undefined && input.administeredById !== '') {
    performer.push({ actor: fhirReference('Practitioner', input.administeredById) });
  }

  return compact<fhir4.Immunization>({
    resourceType: 'Immunization',
    id: input.id,
    status: IMMUNIZATION_STATUS.toFhir(input.status),
    statusReason: codeableConcept({ code: input.refusalReasonCode }),
    vaccineCode: compact<fhir4.CodeableConcept>({
      coding: codings,
      text: input.display === '' ? undefined : input.display,
    }),
    patient: fhirReference('Patient', input.patientId),
    encounter: optionalReference('Encounter', input.encounterId),
    occurrenceDateTime: input.administeredAt,
    manufacturer,
    lotNumber: input.lotNumber,
    expirationDate: input.expirationDate,
    site: codeableConcept({ system: SYSTEMS.actSite, code: input.siteCode }),
    route: codeableConcept({ system: SYSTEMS.routeOfAdministration, code: input.routeCode }),
    doseQuantity: quantity(input.doseQuantity, input.doseUnit),
    performer,
    education:
      input.visDate === undefined || input.visDate === ''
        ? undefined
        : [{ publicationDate: input.visDate }],
  });
}

/** Maps a FHIR R4 `Immunization` back to a {@link DomainImmunization}. */
export function fromFhirImmunization(resource: fhir4.Immunization): DomainImmunization {
  const domain: DomainImmunization = {
    id: resource.id ?? '',
    patientId: referenceId(resource.patient, 'Patient') ?? '',
    status: IMMUNIZATION_STATUS.fromFhir(resource.status),
    cvxCode: readCode(resource.vaccineCode, SYSTEMS.cvx) ?? '',
    display: resource.vaccineCode?.text ?? '',
    administeredAt: resource.occurrenceDateTime ?? '',
  };
  setOptional(domain, 'encounterId', referenceId(resource.encounter, 'Encounter'));
  setOptional(domain, 'mvxCode', readString(resource.manufacturer?.identifier?.value));
  setOptional(domain, 'ndcCode', readCode(resource.vaccineCode, SYSTEMS.ndc));
  setOptional(domain, 'lotNumber', readString(resource.lotNumber));
  setOptional(domain, 'expirationDate', readString(resource.expirationDate));
  setOptional(domain, 'siteCode', readCode(resource.site, SYSTEMS.actSite));
  setOptional(domain, 'routeCode', readCode(resource.route, SYSTEMS.routeOfAdministration));
  setOptional(domain, 'doseQuantity', readQuantityValue(resource.doseQuantity));
  setOptional(domain, 'doseUnit', readQuantityUnit(resource.doseQuantity));
  setOptional(
    domain,
    'administeredById',
    referenceId(resource.performer?.[0]?.actor, 'Practitioner')
  );
  setOptional(domain, 'visDate', readString(resource.education?.[0]?.publicationDate));
  setOptional(domain, 'refusalReasonCode', readCode(resource.statusReason));
  return domain;
}
