/// <reference types="fhir" preserve="true" />

import {
  codeableConcept,
  codeableConcepts,
  compact,
  contactPoint,
  humanName,
  identifier,
  present,
  readCodes,
  readContactPoint,
  readIdentifier,
  readString,
  setOptional,
} from './primitives.js';
import { fhirReference, optionalReference, referenceId, referenceIds } from './reference.js';
import { SYSTEMS } from './systems.js';
import { openrunicCodeSystem } from './extensions.js';

/** Code system for Openrunic's own role keys, e.g. `provider`, `front-desk`. */
export const PRACTITIONER_ROLE_SYSTEM = openrunicCodeSystem('practitioner-role');

/**
 * A clinician, projected from the `User` row where `isProvider` is true. There
 * is no separate Practitioner table: in an ambulatory practice every clinician
 * is also a system user, so the FHIR split happens here at the boundary.
 */
export interface DomainPractitioner {
  id: string;
  familyName: string;
  givenNames: string[];
  /** Display credential suffix, e.g. `MD`, `NP`, `RN`. */
  credential?: string;
  npi?: string;
  dea?: string;
  email?: string;
  active?: boolean;
}

/**
 * `User` columns that stay inside Openrunic. `status` becomes
 * `Practitioner.active`; the rest are authentication and preference state with
 * no clinical meaning to an API consumer.
 */
export const PRACTITIONER_DROPPED_FIELDS = [
  'tenantId',
  'locale',
  'status',
  'lastLoginAt',
  'isProvider',
  'createdAt',
  'updatedAt',
] as const;

/** Maps a {@link DomainPractitioner} to a FHIR R4 `Practitioner`. */
export function toFhirPractitioner(input: DomainPractitioner): fhir4.Practitioner {
  const identifiers = present<fhir4.Identifier>([
    identifier({
      system: SYSTEMS.npi,
      value: input.npi,
      typeSystem: SYSTEMS.identifierType,
      typeCode: 'NPI',
    }),
    identifier({
      system: SYSTEMS.dea,
      value: input.dea,
      typeSystem: SYSTEMS.identifierType,
      typeCode: 'DEA',
    }),
  ]);

  const name = humanName({
    family: input.familyName,
    given: input.givenNames,
    suffix: input.credential,
  });

  return compact<fhir4.Practitioner>({
    resourceType: 'Practitioner',
    id: input.id,
    identifier: identifiers,
    active: input.active,
    name: name ? [name] : undefined,
    telecom: present<fhir4.ContactPoint>([contactPoint('email', input.email, 'work')]),
  });
}

/** Maps a FHIR R4 `Practitioner` back to a {@link DomainPractitioner}. */
export function fromFhirPractitioner(resource: fhir4.Practitioner): DomainPractitioner {
  const name = resource.name?.[0];
  const domain: DomainPractitioner = {
    id: resource.id ?? '',
    familyName: name?.family ?? '',
    givenNames: name?.given ? [...name.given] : [],
  };
  setOptional(domain, 'credential', readString(name?.suffix?.[0]));
  setOptional(domain, 'npi', readIdentifier(resource.identifier, SYSTEMS.npi));
  setOptional(domain, 'dea', readIdentifier(resource.identifier, SYSTEMS.dea));
  setOptional(domain, 'email', readContactPoint(resource.telecom, 'email', 'work'));
  if (typeof resource.active === 'boolean') {
    domain.active = resource.active;
  }
  return domain;
}

/**
 * A clinician's role at a facility: the `UserFacility` grant plus the NUCC
 * taxonomy code and role key that decide what they may do there.
 */
export interface DomainPractitionerRole {
  id: string;
  practitionerId: string;
  /** The tenant organisation the role is held in. */
  organizationId?: string;
  /** Facilities the grant covers, mapped to FHIR `Location`. */
  locationIds: string[];
  /** NUCC provider taxonomy codes. */
  specialtyCodes: string[];
  /** Openrunic role key, e.g. `provider`. */
  roleCode?: string;
  email?: string;
  active?: boolean;
}

/** Grant bookkeeping with no FHIR home. */
export const PRACTITIONER_ROLE_DROPPED_FIELDS = [
  'tenantId',
  'isPrimary',
  'createdAt',
  'updatedAt',
] as const;

/** Maps a {@link DomainPractitionerRole} to a FHIR R4 `PractitionerRole`. */
export function toFhirPractitionerRole(input: DomainPractitionerRole): fhir4.PractitionerRole {
  return compact<fhir4.PractitionerRole>({
    resourceType: 'PractitionerRole',
    id: input.id,
    active: input.active,
    practitioner: optionalReference('Practitioner', input.practitionerId),
    organization: optionalReference('Organization', input.organizationId),
    code: present<fhir4.CodeableConcept>([
      codeableConcept({ system: PRACTITIONER_ROLE_SYSTEM, code: input.roleCode }),
    ]),
    specialty: codeableConcepts(input.specialtyCodes, SYSTEMS.nucc),
    location: input.locationIds.map((id) => fhirReference('Location', id)),
    telecom: present<fhir4.ContactPoint>([contactPoint('email', input.email, 'work')]),
  });
}

/** Maps a FHIR R4 `PractitionerRole` back to a {@link DomainPractitionerRole}. */
export function fromFhirPractitionerRole(resource: fhir4.PractitionerRole): DomainPractitionerRole {
  const domain: DomainPractitionerRole = {
    id: resource.id ?? '',
    practitionerId: referenceId(resource.practitioner, 'Practitioner') ?? '',
    locationIds: referenceIds(resource.location, 'Location'),
    specialtyCodes: readCodes(resource.specialty, SYSTEMS.nucc),
  };
  setOptional(domain, 'organizationId', referenceId(resource.organization, 'Organization'));
  setOptional(domain, 'roleCode', readCodes(resource.code, PRACTITIONER_ROLE_SYSTEM)[0]);
  setOptional(domain, 'email', readContactPoint(resource.telecom, 'email', 'work'));
  if (typeof resource.active === 'boolean') {
    domain.active = resource.active;
  }
  return domain;
}
