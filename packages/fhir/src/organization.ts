/// <reference types="fhir" preserve="true" />

import { openrunicCodeSystem } from './extensions.js';
import {
  address,
  codeableConcept,
  compact,
  contactPoint,
  identifier,
  present,
  readCode,
  readContactPoint,
  readIdentifier,
  readString,
  setOptional,
} from './primitives.js';
import { optionalReference, referenceId } from './reference.js';
import { SYSTEMS } from './systems.js';

/** Namespace for X12 trading-partner payer identifiers (837 NM109). */
export const X12_PAYER_SYSTEM = 'https://openrunic.org/fhir/sid/x12-payer-id';

/** Namespace for the short facility code printed on requisitions and labels. */
export const FACILITY_CODE_SYSTEM = 'https://openrunic.org/fhir/sid/facility-code';

/** Code system for the 837 SBR09 claim filing indicator. */
export const CLAIM_FILING_SYSTEM = openrunicCodeSystem('claim-filing-indicator');

/**
 * An organisation at the boundary. Three relational rows serialize through
 * this one shape: the tenant `Organisation` (type `prov`), a `Payer` (type
 * `ins`), and any external directory entry the API needs to reference.
 */
export interface DomainOrganization {
  id: string;
  name: string;
  /** HL7 organization-type code, normally `prov` or `ins`. */
  typeCode?: string;
  npi?: string;
  /** X12 payer id, set when this organisation is an insurer. */
  x12PayerId?: string;
  /** 837 SBR09 claim filing indicator, e.g. `MC`, `CI`. */
  claimFilingCode?: string;
  phone?: string;
  addressLine1?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  active?: boolean;
}

/**
 * Tenant and payer bookkeeping that stays inside Openrunic. `mode`, `status`
 * and `flags` are deployment state, and `eligibilityPayerId` is a credential
 * for the clearinghouse adapter rather than a public identifier.
 */
export const ORGANIZATION_DROPPED_FIELDS = [
  'tenantId',
  'slug',
  'mode',
  'status',
  'timezone',
  'flags',
  'eligibilityPayerId',
  'createdAt',
  'updatedAt',
] as const;

/** Maps a {@link DomainOrganization} to a FHIR R4 `Organization`. */
export function toFhirOrganization(input: DomainOrganization): fhir4.Organization {
  const identifiers = present<fhir4.Identifier>([
    identifier({
      system: SYSTEMS.npi,
      value: input.npi,
      typeSystem: SYSTEMS.identifierType,
      typeCode: 'NPI',
    }),
    identifier({ system: X12_PAYER_SYSTEM, value: input.x12PayerId }),
  ]);

  const home = address({
    line1: input.addressLine1,
    city: input.city,
    state: input.state,
    postalCode: input.postalCode,
    country: input.country,
    use: 'work',
  });

  return compact<fhir4.Organization>({
    resourceType: 'Organization',
    id: input.id,
    identifier: identifiers,
    active: input.active,
    type: present<fhir4.CodeableConcept>([
      codeableConcept({ system: SYSTEMS.organizationType, code: input.typeCode }),
      codeableConcept({ system: CLAIM_FILING_SYSTEM, code: input.claimFilingCode }),
    ]),
    name: input.name,
    telecom: present<fhir4.ContactPoint>([contactPoint('phone', input.phone, 'work')]),
    address: home ? [home] : undefined,
  });
}

/** Maps a FHIR R4 `Organization` back to a {@link DomainOrganization}. */
export function fromFhirOrganization(resource: fhir4.Organization): DomainOrganization {
  const domain: DomainOrganization = {
    id: resource.id ?? '',
    name: resource.name ?? '',
  };
  const types = resource.type ?? [];
  for (const type of types) {
    setOptional(domain, 'typeCode', readCode(type, SYSTEMS.organizationType));
    setOptional(domain, 'claimFilingCode', readCode(type, CLAIM_FILING_SYSTEM));
  }
  setOptional(domain, 'npi', readIdentifier(resource.identifier, SYSTEMS.npi));
  setOptional(domain, 'x12PayerId', readIdentifier(resource.identifier, X12_PAYER_SYSTEM));
  setOptional(domain, 'phone', readContactPoint(resource.telecom, 'phone', 'work'));

  const home = resource.address?.[0];
  setOptional(domain, 'addressLine1', readString(home?.line?.[0]));
  setOptional(domain, 'city', readString(home?.city));
  setOptional(domain, 'state', readString(home?.state));
  setOptional(domain, 'postalCode', readString(home?.postalCode));
  setOptional(domain, 'country', readString(home?.country));
  if (typeof resource.active === 'boolean') {
    domain.active = resource.active;
  }
  return domain;
}

/**
 * A place of service, projected from the `Facility` row. Scheduling,
 * encounters and charges are all facility-scoped, so this is the resource an
 * external app needs to make sense of where care happened.
 */
export interface DomainLocation {
  id: string;
  name: string;
  /** Short code used in the UI and on printed documents. */
  code: string;
  npi?: string;
  /** CMS place-of-service code, e.g. `11` for office. */
  posCode?: string;
  managingOrganizationId?: string;
  phone?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  active?: boolean;
}

/**
 * `Facility.timezone` drives Openrunic's own rendering of schedules; FHIR
 * instants are absolute, so it has no boundary equivalent.
 */
export const LOCATION_DROPPED_FIELDS = ['tenantId', 'timezone', 'createdAt', 'updatedAt'] as const;

/** Maps a {@link DomainLocation} to a FHIR R4 `Location`. */
export function toFhirLocation(input: DomainLocation): fhir4.Location {
  const identifiers = present<fhir4.Identifier>([
    identifier({ system: FACILITY_CODE_SYSTEM, value: input.code }),
    identifier({
      system: SYSTEMS.npi,
      value: input.npi,
      typeSystem: SYSTEMS.identifierType,
      typeCode: 'NPI',
    }),
  ]);

  const status: fhir4.Location['status'] =
    input.active === undefined ? undefined : input.active ? 'active' : 'inactive';

  return compact<fhir4.Location>({
    resourceType: 'Location',
    id: input.id,
    identifier: identifiers,
    status,
    name: input.name,
    type: present<fhir4.CodeableConcept>([
      codeableConcept({ system: SYSTEMS.placeOfService, code: input.posCode }),
    ]),
    telecom: present<fhir4.ContactPoint>([contactPoint('phone', input.phone, 'work')]),
    address: address({
      line1: input.addressLine1,
      line2: input.addressLine2,
      city: input.city,
      state: input.state,
      postalCode: input.postalCode,
      country: input.country,
      use: 'work',
    }),
    managingOrganization: optionalReference('Organization', input.managingOrganizationId),
  });
}

/** Maps a FHIR R4 `Location` back to a {@link DomainLocation}. */
export function fromFhirLocation(resource: fhir4.Location): DomainLocation {
  const domain: DomainLocation = {
    id: resource.id ?? '',
    name: resource.name ?? '',
    code: readIdentifier(resource.identifier, FACILITY_CODE_SYSTEM) ?? '',
  };
  setOptional(domain, 'npi', readIdentifier(resource.identifier, SYSTEMS.npi));
  setOptional(domain, 'posCode', readCode(resource.type?.[0], SYSTEMS.placeOfService));
  setOptional(
    domain,
    'managingOrganizationId',
    referenceId(resource.managingOrganization, 'Organization')
  );
  setOptional(domain, 'phone', readContactPoint(resource.telecom, 'phone', 'work'));
  setOptional(domain, 'addressLine1', readString(resource.address?.line?.[0]));
  setOptional(domain, 'addressLine2', readString(resource.address?.line?.[1]));
  setOptional(domain, 'city', readString(resource.address?.city));
  setOptional(domain, 'state', readString(resource.address?.state));
  setOptional(domain, 'postalCode', readString(resource.address?.postalCode));
  setOptional(domain, 'country', readString(resource.address?.country));
  if (resource.status === 'active') {
    domain.active = true;
  } else if (resource.status === 'inactive' || resource.status === 'suspended') {
    domain.active = false;
  }
  return domain;
}
