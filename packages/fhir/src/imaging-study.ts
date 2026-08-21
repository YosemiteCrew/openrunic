/// <reference types="fhir" preserve="true" />

import { enumMapping } from './enum-mapping.js';
import { compact, present, readString, setOptional } from './primitives.js';
import { fhirReference, optionalReference, referenceId } from './reference.js';
import { SYSTEMS } from './systems.js';

/**
 * IMAGING STUDY: THE RECORD THAT PICTURES EXIST.
 *
 * openrunic is not a PACS, and this mapper is where that shows. A FHIR
 * `ImagingStudy` can carry every series and every instance in a study; this one
 * carries counts and an endpoint, because that is what is stored and inventing
 * the rest would be describing images this system has never seen.
 *
 * `numberOfSeries` and `numberOfInstances` are what a viewer uses to know
 * whether it has the whole study, and `endpoint` is where it goes to get it. A
 * consumer that needs series-level detail queries the PACS by study UID, which
 * is the identifier this resource exists to carry.
 */

export type DomainImagingStudyStatus = 'REGISTERED' | 'AVAILABLE' | 'ENTERED_IN_ERROR';

const STUDY_STATUS = enumMapping<DomainImagingStudyStatus, fhir4.ImagingStudy['status']>({
  map: {
    REGISTERED: 'registered',
    AVAILABLE: 'available',
    ENTERED_IN_ERROR: 'entered-in-error',
  },
  fallback: 'AVAILABLE',
});

export interface DomainImagingStudy {
  id: string;
  patientId: string;
  encounterId?: string;
  serviceRequestId?: string;
  /** DICOM Study Instance UID (0020,000D). */
  studyInstanceUid: string;
  /** Shared by the order, the modality worklist and the PACS. */
  accessionNumber?: string;
  /** DICOM modality codes present in the study: CT, MR, US, and so on. */
  modalities: string[];
  description?: string;
  status: DomainImagingStudyStatus;
  /** ISO 8601 instant. */
  startedAt: string;
  numberOfSeries: number;
  numberOfInstances: number;
  /** Normally a DICOMweb WADO-RS study URL. */
  retrieveUrl?: string;
}

/**
 * `diagnosticReportId` is dropped because the link travels the other way: the
 * report carries `imagingStudy`, and duplicating it here would give one
 * association two records that can disagree. `tenantId` and the timestamps are
 * dropped as everywhere else.
 */
export const IMAGING_STUDY_DROPPED_FIELDS = [
  'tenantId',
  'diagnosticReportId',
  'createdAt',
  'updatedAt',
] as const;

/** Maps a {@link DomainImagingStudy} to a FHIR R4 `ImagingStudy`. */
export function toFhirImagingStudy(input: DomainImagingStudy): fhir4.ImagingStudy {
  return compact<fhir4.ImagingStudy>({
    resourceType: 'ImagingStudy',
    id: input.id,
    // The study UID is an identifier and not the resource id, because the
    // resource id is this system's and the UID is DICOM's. Carrying the UID as
    // the id would make two systems' identifiers the same string and neither
    // able to change.
    identifier: present<fhir4.Identifier>([
      input.studyInstanceUid === ''
        ? undefined
        : { system: SYSTEMS.dicomUid, value: `urn:oid:${input.studyInstanceUid}` },
      input.accessionNumber === undefined || input.accessionNumber === ''
        ? undefined
        : {
            type: { coding: [{ system: SYSTEMS.identifierType, code: 'ACSN' }] },
            value: input.accessionNumber,
          },
    ]),
    status: STUDY_STATUS.toFhir(input.status),
    modality: input.modalities.map((code) => ({ system: SYSTEMS.dicomModality, code })),
    subject: fhirReference('Patient', input.patientId),
    encounter: optionalReference('Encounter', input.encounterId),
    started: input.startedAt === '' ? undefined : input.startedAt,
    basedOn: present<fhir4.Reference>([
      optionalReference('ServiceRequest', input.serviceRequestId),
    ]),
    numberOfSeries: input.numberOfSeries,
    numberOfInstances: input.numberOfInstances,
    endpoint:
      input.retrieveUrl === undefined || input.retrieveUrl === ''
        ? undefined
        : [{ display: input.retrieveUrl }],
    description: input.description,
  });
}

/** The DICOM UID out of `urn:oid:1.2.3`, or the value as it stands. */
function readUid(value: string | undefined): string {
  if (value === undefined) return '';
  return value.startsWith('urn:oid:') ? value.slice('urn:oid:'.length) : value;
}

/** Maps a FHIR R4 `ImagingStudy` back to a {@link DomainImagingStudy}. */
export function fromFhirImagingStudy(resource: fhir4.ImagingStudy): DomainImagingStudy {
  const accession = resource.identifier?.find((identifier) =>
    identifier.type?.coding?.some((coding) => coding.code === 'ACSN')
  );
  const studyUid = resource.identifier?.find(
    (identifier) => identifier.system === SYSTEMS.dicomUid
  );

  const domain: DomainImagingStudy = {
    id: resource.id ?? '',
    patientId: referenceId(resource.subject, 'Patient') ?? '',
    studyInstanceUid: readUid(studyUid?.value),
    modalities: (resource.modality ?? [])
      .map((coding) => coding.code)
      .filter((code): code is string => code !== undefined && code !== ''),
    status: STUDY_STATUS.fromFhir(resource.status),
    startedAt: resource.started ?? '',
    numberOfSeries: resource.numberOfSeries ?? 0,
    numberOfInstances: resource.numberOfInstances ?? 0,
  };
  setOptional(domain, 'encounterId', referenceId(resource.encounter, 'Encounter'));
  setOptional(domain, 'serviceRequestId', referenceId(resource.basedOn?.[0], 'ServiceRequest'));
  setOptional(domain, 'accessionNumber', readString(accession?.value));
  setOptional(domain, 'description', readString(resource.description));
  setOptional(domain, 'retrieveUrl', readString(resource.endpoint?.[0]?.display));
  return domain;
}
