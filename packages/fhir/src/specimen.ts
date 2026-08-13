/// <reference types="fhir" preserve="true" />

import { enumMapping } from './enum-mapping.js';
import {
  annotations,
  codeableConcept,
  compact,
  present,
  quantity,
  readAnnotation,
  readCode,
  readConceptText,
  readQuantityUnit,
  readQuantityValue,
  readString,
  setOptional,
} from './primitives.js';
import { fhirReference, optionalReference, referenceId } from './reference.js';
import { SYSTEMS } from './systems.js';

/** Namespace for the lab's accession number. */
export const ACCESSION_SYSTEM = 'https://openrunic.org/fhir/sid/accession';

export type DomainSpecimenStatus =
  'AVAILABLE' | 'UNAVAILABLE' | 'UNSATISFACTORY' | 'ENTERED_IN_ERROR';

const SPECIMEN_STATUS = enumMapping<DomainSpecimenStatus, NonNullable<fhir4.Specimen['status']>>({
  map: {
    AVAILABLE: 'available',
    UNAVAILABLE: 'unavailable',
    UNSATISFACTORY: 'unsatisfactory',
    ENTERED_IN_ERROR: 'entered-in-error',
  },
  fallback: 'AVAILABLE',
});

/** A collected sample, from draw to receipt or rejection. */
export interface DomainSpecimen {
  id: string;
  patientId: string;
  serviceRequestId?: string;
  status: DomainSpecimenStatus;
  accessionNumber?: string;
  /** SNOMED CT specimen type. */
  typeCode: string;
  typeDisplay: string;
  collectionMethodCode?: string;
  bodySiteCode?: string;
  /** ISO 8601 instant. */
  collectedAt?: string;
  collectedById?: string;
  /** ISO 8601 instant. */
  receivedAt?: string;
  containerType?: string;
  volumeValue?: number;
  volumeUnit?: string;
  rejectionReason?: string;
  note?: string;
}

export const SPECIMEN_DROPPED_FIELDS = ['tenantId', 'createdAt', 'updatedAt'] as const;

/** Maps a {@link DomainSpecimen} to a FHIR R4 `Specimen`. */
export function toFhirSpecimen(input: DomainSpecimen): fhir4.Specimen {
  const collection = compact<fhir4.SpecimenCollection>({
    collector: optionalReference('Practitioner', input.collectedById),
    collectedDateTime: input.collectedAt,
    quantity: quantity(input.volumeValue, input.volumeUnit),
    method: codeableConcept({ system: SYSTEMS.snomed, code: input.collectionMethodCode }),
    bodySite: codeableConcept({ system: SYSTEMS.snomed, code: input.bodySiteCode }),
  });

  return compact<fhir4.Specimen>({
    resourceType: 'Specimen',
    id: input.id,
    accessionIdentifier:
      input.accessionNumber === undefined || input.accessionNumber === ''
        ? undefined
        : { system: ACCESSION_SYSTEM, value: input.accessionNumber },
    status: SPECIMEN_STATUS.toFhir(input.status),
    type: compact<fhir4.CodeableConcept>({
      coding: present<fhir4.Coding>([
        input.typeCode === '' ? undefined : { system: SYSTEMS.snomed, code: input.typeCode },
      ]),
      text: input.typeDisplay === '' ? undefined : input.typeDisplay,
    }),
    subject: fhirReference('Patient', input.patientId),
    receivedTime: input.receivedAt,
    request: present<fhir4.Reference>([
      optionalReference('ServiceRequest', input.serviceRequestId),
    ]),
    collection: Object.keys(collection).length > 0 ? collection : undefined,
    container: present<fhir4.SpecimenContainer>([
      input.containerType === undefined || input.containerType === ''
        ? undefined
        : { type: { text: input.containerType } },
    ]),
    condition: present<fhir4.CodeableConcept>([
      input.rejectionReason === undefined || input.rejectionReason === ''
        ? undefined
        : { text: input.rejectionReason },
    ]),
    note: annotations(input.note),
  });
}

/** Maps a FHIR R4 `Specimen` back to a {@link DomainSpecimen}. */
export function fromFhirSpecimen(resource: fhir4.Specimen): DomainSpecimen {
  const collection = resource.collection;
  const domain: DomainSpecimen = {
    id: resource.id ?? '',
    patientId: referenceId(resource.subject, 'Patient') ?? '',
    status: SPECIMEN_STATUS.fromFhir(resource.status),
    typeCode: readCode(resource.type, SYSTEMS.snomed) ?? '',
    typeDisplay: resource.type?.text ?? '',
  };
  setOptional(domain, 'serviceRequestId', referenceId(resource.request?.[0], 'ServiceRequest'));
  setOptional(domain, 'accessionNumber', readString(resource.accessionIdentifier?.value));
  setOptional(domain, 'collectionMethodCode', readCode(collection?.method, SYSTEMS.snomed));
  setOptional(domain, 'bodySiteCode', readCode(collection?.bodySite, SYSTEMS.snomed));
  setOptional(domain, 'collectedAt', readString(collection?.collectedDateTime));
  setOptional(domain, 'collectedById', referenceId(collection?.collector, 'Practitioner'));
  setOptional(domain, 'receivedAt', readString(resource.receivedTime));
  setOptional(domain, 'containerType', readConceptText(resource.container?.[0]?.type));
  setOptional(domain, 'volumeValue', readQuantityValue(collection?.quantity));
  setOptional(domain, 'volumeUnit', readQuantityUnit(collection?.quantity));
  setOptional(domain, 'rejectionReason', readConceptText(resource.condition?.[0]));
  setOptional(domain, 'note', readAnnotation(resource.note));
  return domain;
}
