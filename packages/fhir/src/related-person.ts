/// <reference types="fhir" preserve="true" />

import {
  address,
  codeableConcept,
  compact,
  contactPoint,
  humanName,
  present,
  readCode,
  readConceptText,
  readContactPoint,
  readString,
  setOptional,
} from './primitives.js';
import { fhirReference, referenceId } from './reference.js';
import { SYSTEMS } from './systems.js';

/**
 * The people around a patient: a mother, a guardian, an emergency contact, the
 * person who holds portal access on a child's behalf.
 *
 * The row already carried all of this and none of it was reachable through the
 * API, which mattered more than an ordinary gap: `ConsentGrant` points at a
 * `RelatedPerson`, so a client could be told a consent was granted to somebody
 * it had no way to resolve. US Core requires the resource for the same reason.
 *
 * The three booleans are the part worth reading carefully. FHIR has no field
 * for "is the guardian" or "is the emergency contact"; both are relationship
 * codings, and `relationship` is 0..* precisely so a person can be a mother and
 * a guardian at once. So they map to additional entries in `relationship`
 * rather than to extensions, which is what lets an ordinary US Core client see
 * them without knowing anything about this implementation. `isPortalProxy` has
 * no published code that means it, so it is the one that becomes an extension
 * rather than being forced into a coding that would be read as something else.
 *
 * ## Where the row and FHIR disagree, and which one wins
 *
 * The row splits one code system into a single `relationshipCode` plus two
 * booleans, and nothing stops that code from itself being `GUARD` or `ECON`.
 * When it is, the row can say two contradictory things at once: relationship
 * `ECON`, `isEmergencyContact` false.
 *
 * FHIR cannot represent that contradiction and should not. The coding set is
 * the truth here, so a person whose recorded relationship is `ECON` comes back
 * with `isEmergencyContact` true. That is the round trip normalising the row
 * rather than losing part of it, and it is the only reading that leaves the
 * resource and the row saying the same thing. The alternative, filtering role
 * codes out of the primary lookup, was tried first and was worse: it returned
 * an empty relationship for a person who had one.
 *
 * The primary relationship is `relationship[0]`, so order carries meaning.
 * `toFhirRelatedPerson` always writes the recorded code first.
 */

/** `RelatedPerson.isPortalProxy`, which no published value set expresses. */
export const PORTAL_PROXY_EXTENSION =
  'https://openrunic.org/fhir/StructureDefinition/related-person-portal-proxy';

/**
 * v3 RoleCode values for the two roles the row carries as booleans.
 *
 * `GUARD` is the guardian role. `ECON` is emergency contact. Both are in the
 * same code system as `relationshipCode` itself, so a client reading
 * `relationship` sees one homogeneous list rather than a primary coding plus
 * two it has to special-case.
 */
const GUARDIAN_CODE = 'GUARD';
const EMERGENCY_CONTACT_CODE = 'ECON';

export interface DomainRelatedPerson {
  id: string;
  patientId: string;
  /** HL7 v3 RoleCode, for example `MTH` or `GUARD`. */
  relationshipCode: string;
  relationshipText?: string;
  givenName: string;
  familyName: string;
  phone?: string;
  email?: string;
  addressLine1?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  /*
   * Required, not optional, and that is the fix for a real asymmetry. These
   * three are NOT NULL on the row, so a domain object that omits one describes
   * a record the database cannot hold. While they were optional the round trip
   * was not identity: absence wrote no coding, and reading a resource with no
   * coding can only answer false, so an omitted flag came back as `false` and
   * `toEqual` had no way to call that correct.
   */
  isGuardian: boolean;
  isEmergencyContact: boolean;
  isPortalProxy: boolean;
  active?: boolean;
}

/** Maps a {@link DomainRelatedPerson} to a FHIR R4 `RelatedPerson`. */
export function toFhirRelatedPerson(input: DomainRelatedPerson): fhir4.RelatedPerson {
  const home = address({
    line1: input.addressLine1,
    city: input.city,
    state: input.state,
    postalCode: input.postalCode,
    country: input.country,
    use: 'home',
  });

  /*
   * The recorded relationship first, because a reader taking `relationship[0]`
   * must get the one the practice typed, and because the reverse mapper reads
   * it positionally.
   *
   * A role is skipped when it is already the recorded code. Writing `GUARD`
   * twice for a guardian recorded as `GUARD` says nothing extra and would give
   * a client a duplicate to explain.
   */
  const roleFor = (code: string, held: boolean): fhir4.CodeableConcept | undefined =>
    held && input.relationshipCode !== code
      ? codeableConcept({ system: SYSTEMS.roleCode, code })
      : undefined;

  const relationship = present<fhir4.CodeableConcept>([
    codeableConcept({
      system: SYSTEMS.roleCode,
      code: input.relationshipCode,
      text: input.relationshipText,
    }),
    roleFor(GUARDIAN_CODE, input.isGuardian),
    roleFor(EMERGENCY_CONTACT_CODE, input.isEmergencyContact),
  ]);

  return compact<fhir4.RelatedPerson>({
    resourceType: 'RelatedPerson',
    id: input.id,
    active: input.active,
    patient: fhirReference('Patient', input.patientId),
    relationship: relationship.length > 0 ? relationship : undefined,
    name: present<fhir4.HumanName>([
      humanName({ given: [input.givenName], family: input.familyName, use: 'official' }),
    ]),
    /* No `use`. The row stores one phone and one email with nothing saying
       whether either is a home, work or mobile number, and publishing `home`
       would be this mapper inventing a classification the practice never
       recorded. The reader below matches on system alone for the same reason,
       which also lets it read another system's `mobile` or `work` entry. */
    telecom: present<fhir4.ContactPoint>([
      contactPoint('phone', input.phone),
      contactPoint('email', input.email),
    ]),
    address: home ? [home] : undefined,
    extension: input.isPortalProxy
      ? [{ url: PORTAL_PROXY_EXTENSION, valueBoolean: true }]
      : undefined,
  });
}

/** True when any relationship coding carries `code` in the RoleCode system. */
function hasRole(
  relationship: readonly fhir4.CodeableConcept[] | undefined,
  code: string
): boolean {
  return (relationship ?? []).some((concept) => readCode(concept, SYSTEMS.roleCode) === code);
}

/** Maps a FHIR R4 `RelatedPerson` back to a {@link DomainRelatedPerson}. */
export function fromFhirRelatedPerson(resource: fhir4.RelatedPerson): DomainRelatedPerson {
  const relationship = resource.relationship ?? [];
  /* First coding wins, which is the contract the writer upholds. See the note
     on ordering at the top of this file for why it is not a search. */
  const primary = relationship[0];

  const name = resource.name?.[0];
  const relationshipSet = relationship;
  const domain: DomainRelatedPerson = {
    id: resource.id ?? '',
    patientId: referenceId(resource.patient, 'Patient') ?? '',
    relationshipCode: readCode(primary, SYSTEMS.roleCode) ?? '',
    givenName: readString(name?.given?.[0]) ?? '',
    familyName: readString(name?.family) ?? '',
    /*
     * Always written, because the field is always present. The lookup runs over
     * every coding including the first, so a person recorded as `GUARD` comes
     * back a guardian.
     */
    isGuardian: hasRole(relationshipSet, GUARDIAN_CODE),
    isEmergencyContact: hasRole(relationshipSet, EMERGENCY_CONTACT_CODE),
    isPortalProxy: (resource.extension ?? []).some(
      (entry) => entry.url === PORTAL_PROXY_EXTENSION && entry.valueBoolean === true
    ),
  };

  setOptional(domain, 'relationshipText', readConceptText(primary));
  setOptional(domain, 'phone', readContactPoint(resource.telecom, 'phone'));
  setOptional(domain, 'email', readContactPoint(resource.telecom, 'email'));

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
