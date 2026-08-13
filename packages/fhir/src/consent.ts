/// <reference types="fhir" preserve="true" />

import { conceptMapping, enumMapping } from './enum-mapping.js';
import { localStatusExtension, openrunicCodeSystem, readLocalStatus } from './extensions.js';
import { codeableConcept, compact, period, present, setOptional } from './primitives.js';
import { fhirReference, optionalReference, referenceId } from './reference.js';
import { SYSTEMS } from './systems.js';

/** Code system for Openrunic's consent scopes. */
export const CONSENT_SCOPE_SYSTEM = openrunicCodeSystem('consent-scope');

export type DomainConsentScope =
  | 'TREATMENT'
  | 'PORTAL_ACCESS'
  | 'INFORMATION_SHARING'
  | 'RESEARCH'
  | 'COMMUNICATION'
  | 'FINANCIAL';

export type DomainConsentStatus = 'PROPOSED' | 'ACTIVE' | 'REJECTED' | 'REVOKED' | 'EXPIRED';

/**
 * The precise scope travels in `Consent.category`, which has an extensible
 * binding, while `Consent.scope` carries the closest core code. Nothing is
 * lost, so this mapping needs no extension.
 */
const CONSENT_CATEGORY = conceptMapping<DomainConsentScope>({
  TREATMENT: { system: CONSENT_SCOPE_SYSTEM, code: 'treatment' },
  PORTAL_ACCESS: { system: CONSENT_SCOPE_SYSTEM, code: 'portal-access' },
  INFORMATION_SHARING: { system: CONSENT_SCOPE_SYSTEM, code: 'information-sharing' },
  RESEARCH: { system: CONSENT_SCOPE_SYSTEM, code: 'research' },
  COMMUNICATION: { system: CONSENT_SCOPE_SYSTEM, code: 'communication' },
  FINANCIAL: { system: CONSENT_SCOPE_SYSTEM, code: 'financial' },
});

const CORE_SCOPE: Record<DomainConsentScope, string> = {
  TREATMENT: 'treatment',
  PORTAL_ACCESS: 'patient-privacy',
  INFORMATION_SHARING: 'patient-privacy',
  RESEARCH: 'research',
  COMMUNICATION: 'patient-privacy',
  FINANCIAL: 'treatment',
};

export const CONSENT_STATUS = enumMapping<DomainConsentStatus, fhir4.Consent['status']>({
  map: {
    PROPOSED: 'proposed',
    ACTIVE: 'active',
    REJECTED: 'rejected',
    REVOKED: 'inactive',
    EXPIRED: 'inactive',
  },
  canonical: { inactive: 'REVOKED' },
  fallback: 'ACTIVE',
});

/** A recorded consent or authorization. */
export interface DomainConsentGrant {
  id: string;
  patientId: string;
  scope: DomainConsentScope;
  status: DomainConsentStatus;
  /** Set when a related person granted it on the patient's behalf. */
  relatedPersonId?: string;
  /** Signed paper or generated PDF backing the grant. */
  documentId?: string;
  policyText?: string;
  /** ISO 8601 instant. */
  effectiveFrom: string;
  /** ISO 8601 instant. */
  effectiveTo?: string;
}

/**
 * Revocation detail (`revokedAt`, `revokedReason`) is carried by the status
 * plus the audit trail, and `formSubmissionId` points at the portal form that
 * captured the grant, which serializes as a QuestionnaireResponse.
 */
export const CONSENT_DROPPED_FIELDS = [
  'tenantId',
  'formSubmissionId',
  'revokedAt',
  'revokedReason',
  'recordedById',
  'createdAt',
  'updatedAt',
] as const;

/** Maps a {@link DomainConsentGrant} to a FHIR R4 `Consent`. */
export function toFhirConsent(input: DomainConsentGrant): fhir4.Consent {
  const provisionPeriod = period(input.effectiveFrom, input.effectiveTo);

  return compact<fhir4.Consent>({
    resourceType: 'Consent',
    id: input.id,
    extension: present<fhir4.Extension>([localStatusExtension(CONSENT_STATUS, input.status)]),
    status: CONSENT_STATUS.toFhir(input.status),
    scope:
      codeableConcept({
        system: SYSTEMS.consentScope,
        code: CORE_SCOPE[input.scope],
      }) ?? {},
    category: [CONSENT_CATEGORY.toConcept(input.scope)],
    patient: fhirReference('Patient', input.patientId),
    dateTime: input.effectiveFrom,
    performer: present<fhir4.Reference>([
      optionalReference('RelatedPerson', input.relatedPersonId),
    ]),
    sourceReference: optionalReference('DocumentReference', input.documentId),
    policyRule: codeableConcept({ text: input.policyText }),
    provision: provisionPeriod === undefined ? undefined : { period: provisionPeriod },
  });
}

/** Maps a FHIR R4 `Consent` back to a {@link DomainConsentGrant}. */
export function fromFhirConsent(resource: fhir4.Consent): DomainConsentGrant {
  const domain: DomainConsentGrant = {
    id: resource.id ?? '',
    patientId: referenceId(resource.patient, 'Patient') ?? '',
    scope: CONSENT_CATEGORY.fromConcepts(resource.category) ?? 'TREATMENT',
    status: readLocalStatus(CONSENT_STATUS, resource.extension, resource.status),
    effectiveFrom: resource.dateTime ?? '',
  };
  setOptional(domain, 'relatedPersonId', referenceId(resource.performer?.[0], 'RelatedPerson'));
  setOptional(domain, 'documentId', referenceId(resource.sourceReference, 'DocumentReference'));
  setOptional(domain, 'policyText', resource.policyRule?.text);
  setOptional(domain, 'effectiveTo', resource.provision?.period?.end);
  return domain;
}
