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
  base64ToHex,
  codeableConcept,
  compact,
  hexToBase64,
  present,
  readCode,
  readString,
  setOptional,
} from './primitives.js';
import { fhirReference, optionalReference, referenceId } from './reference.js';
import { SYSTEMS } from './systems.js';

/** Carries how a document arrived, which R4 does not model. */
export const DOCUMENT_SOURCE_EXTENSION = openrunicExtension('document-source');

/** Code system for Openrunic's document intake sources. */
export const DOCUMENT_SOURCE_SYSTEM = openrunicCodeSystem('document-source');

export type DomainDocumentSource = 'UPLOAD' | 'SCAN' | 'FAX' | 'GENERATED' | 'PORTAL' | 'INTERFACE';

export type DomainDocumentStatus = 'INBOX' | 'FILED' | 'SUPERSEDED' | 'ENTERED_IN_ERROR';

export type DomainSensitivityClass = 'NORMAL' | 'RESTRICTED' | 'VERY_RESTRICTED';

const DOCUMENT_SOURCES: readonly DomainDocumentSource[] = [
  'UPLOAD',
  'SCAN',
  'FAX',
  'GENERATED',
  'PORTAL',
  'INTERFACE',
];

export const DOCUMENT_STATUS = enumMapping<DomainDocumentStatus, fhir4.DocumentReference['status']>(
  {
    map: {
      INBOX: 'current',
      FILED: 'current',
      SUPERSEDED: 'superseded',
      ENTERED_IN_ERROR: 'entered-in-error',
    },
    canonical: { current: 'INBOX' },
    fallback: 'INBOX',
  }
);

const SENSITIVITY = conceptMapping<DomainSensitivityClass>({
  NORMAL: { system: SYSTEMS.confidentiality, code: 'N' },
  RESTRICTED: { system: SYSTEMS.confidentiality, code: 'R' },
  VERY_RESTRICTED: { system: SYSTEMS.confidentiality, code: 'V' },
});

/** Any stored binary: uploads, scans, inbound faxes, generated PDFs. */
export interface DomainDocument {
  id: string;
  patientId?: string;
  encounterId?: string;
  /** Document category code, a LOINC document type where one exists. */
  category: string;
  title: string;
  /**
   * Externally resolvable location, normally `Binary/{id}`. The relational row
   * stores an object-storage key instead; the API resolves it to this.
   */
  url?: string;
  contentType: string;
  /** Lowercase hex SHA-256 of the stored bytes. */
  sha256: string;
  byteSize: number;
  source: DomainDocumentSource;
  status: DomainDocumentStatus;
  sensitivityClass: DomainSensitivityClass;
  /** ISO 8601 instant. */
  receivedAt: string;
}

/**
 * `storageKey` is the private object-storage key behind `url`, and filing state
 * (`filedAt`, `filedById`) plus retention (`expiresAt`) are inbox workflow
 * rather than document content.
 */
export const DOCUMENT_REFERENCE_DROPPED_FIELDS = [
  'tenantId',
  'storageKey',
  'filedAt',
  'filedById',
  'expiresAt',
  'createdAt',
  'updatedAt',
] as const;

/** Maps a {@link DomainDocument} to a FHIR R4 `DocumentReference`. */
export function toFhirDocumentReference(input: DomainDocument): fhir4.DocumentReference {
  const attachment = compact<fhir4.Attachment>({
    contentType: input.contentType,
    url: input.url,
    size: input.byteSize,
    hash: hexToBase64(input.sha256),
    title: input.title,
  });

  return compact<fhir4.DocumentReference>({
    resourceType: 'DocumentReference',
    id: input.id,
    extension: present<fhir4.Extension>([
      localStatusExtension(DOCUMENT_STATUS, input.status),
      codeExtension(DOCUMENT_SOURCE_EXTENSION, input.source),
    ]),
    status: DOCUMENT_STATUS.toFhir(input.status),
    type: codeableConcept({ system: SYSTEMS.loinc, code: input.category }),
    securityLabel: [SENSITIVITY.toConcept(input.sensitivityClass)],
    subject: optionalReference('Patient', input.patientId),
    date: input.receivedAt,
    content: [{ attachment }],
    context:
      input.encounterId === undefined || input.encounterId === ''
        ? undefined
        : { encounter: [fhirReference('Encounter', input.encounterId)] },
  });
}

/** Maps a FHIR R4 `DocumentReference` back to a {@link DomainDocument}. */
export function fromFhirDocumentReference(resource: fhir4.DocumentReference): DomainDocument {
  const attachment = resource.content?.[0]?.attachment;
  const source = readCodeExtension(resource.extension, DOCUMENT_SOURCE_EXTENSION);

  const domain: DomainDocument = {
    id: resource.id ?? '',
    category: readCode(resource.type, SYSTEMS.loinc) ?? '',
    title: attachment?.title ?? '',
    contentType: attachment?.contentType ?? '',
    sha256: base64ToHex(attachment?.hash) ?? '',
    byteSize: attachment?.size ?? 0,
    source: DOCUMENT_SOURCES.find((value) => value === source) ?? 'UPLOAD',
    status: readLocalStatus(DOCUMENT_STATUS, resource.extension, resource.status),
    sensitivityClass: SENSITIVITY.fromConcepts(resource.securityLabel) ?? 'NORMAL',
    receivedAt: resource.date ?? '',
  };
  setOptional(domain, 'patientId', referenceId(resource.subject, 'Patient'));
  setOptional(domain, 'encounterId', referenceId(resource.context?.encounter?.[0], 'Encounter'));
  setOptional(domain, 'url', readString(attachment?.url));
  return domain;
}
