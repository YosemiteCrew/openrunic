import { describe, expect, it } from 'vitest';

import {
  fromFhirRelatedPerson,
  PORTAL_PROXY_EXTENSION,
  toFhirRelatedPerson,
  type DomainRelatedPerson,
} from './related-person.js';
import { SYSTEMS } from './systems.js';

/**
 * The people around a patient, across the boundary and back.
 *
 * The interesting half is the three booleans. Two of them have no field in
 * FHIR and become relationship codings; the third has no published code and
 * becomes an extension. Each of those is a place a value can be dropped or
 * quietly turned into a different claim, so each is asserted in both
 * directions rather than only on the way out.
 */

const MOTHER: DomainRelatedPerson = {
  id: '0192f1a0-0000-7000-8000-0000000000r1',
  patientId: '0192f1a0-0000-7000-8000-0000000000p1',
  relationshipCode: 'MTH',
  relationshipText: 'Mother',
  givenName: 'Marisol',
  familyName: 'Verificada',
  phone: '+1 555 0142 118',
  email: 'marisol@example.invalid',
  addressLine1: '14 Rowan Street',
  city: 'Birchwood',
  state: 'OR',
  postalCode: '97205',
  country: 'US',
  isGuardian: true,
  isEmergencyContact: true,
  isPortalProxy: true,
  active: true,
};

describe('toFhirRelatedPerson', () => {
  it('points at the patient it belongs to', () => {
    const resource = toFhirRelatedPerson(MOTHER);

    expect(resource.resourceType).toBe('RelatedPerson');
    expect(resource.patient.reference).toBe(`Patient/${MOTHER.patientId}`);
  });

  it('carries the recorded relationship first, so relationship[0] is what the practice typed', () => {
    /*
     * A client that reads only the first coding is the common case, and it has
     * to get `MTH` rather than whichever role marker happened to be appended.
     */
    const resource = toFhirRelatedPerson(MOTHER);

    expect(resource.relationship?.[0]?.coding?.[0]).toMatchObject({
      system: SYSTEMS.roleCode,
      code: 'MTH',
    });
    expect(resource.relationship?.[0]?.text).toBe('Mother');
  });

  it('says guardian and emergency contact in the code system a US Core client already reads', () => {
    /*
     * These are booleans on the row and codings in FHIR. Put in an extension
     * instead, a conformant client would see a mother and no indication she is
     * also the guardian, which is exactly the fact a clinician needs.
     */
    const codes = (toFhirRelatedPerson(MOTHER).relationship ?? []).map(
      (concept) => concept.coding?.[0]?.code
    );

    expect(codes).toEqual(['MTH', 'GUARD', 'ECON']);
  });

  it('omits a role the person does not hold rather than sending it false', () => {
    const codes = (
      toFhirRelatedPerson({ ...MOTHER, isGuardian: false, isEmergencyContact: false })
        .relationship ?? []
    ).map((concept) => concept.coding?.[0]?.code);

    expect(codes).toEqual(['MTH']);
  });

  it('carries portal proxy as an extension, because no published code means it', () => {
    const resource = toFhirRelatedPerson(MOTHER);

    expect(resource.extension).toEqual([{ url: PORTAL_PROXY_EXTENSION, valueBoolean: true }]);
    expect(toFhirRelatedPerson({ ...MOTHER, isPortalProxy: false }).extension).toBeUndefined();
  });

  it('carries the name, both contact points and the address', () => {
    const resource = toFhirRelatedPerson(MOTHER);

    expect(resource.name?.[0]).toMatchObject({ family: 'Verificada', given: ['Marisol'] });
    /* No `use`. The row records one phone and one email and says nothing about
       whether either is a home, work or mobile number, so publishing a use
       would be this mapper making that up. */
    expect(resource.telecom).toEqual([
      { system: 'phone', value: '+1 555 0142 118' },
      { system: 'email', value: 'marisol@example.invalid' },
    ]);
    expect(resource.address?.[0]).toMatchObject({ city: 'Birchwood', postalCode: '97205' });
  });
});

describe('round trip', () => {
  it('returns every field it was given', () => {
    expect(fromFhirRelatedPerson(toFhirRelatedPerson(MOTHER))).toEqual(MOTHER);
  });

  it("takes the primary relationship from the first coding, which is the writer's contract", () => {
    /*
     * Order carries meaning here, so it is asserted rather than assumed. A
     * reader of `relationship[0]` and this mapper have to agree about which
     * entry is the recorded relationship, and `toFhirRelatedPerson` putting it
     * first is the whole of that agreement.
     */
    const resource = toFhirRelatedPerson(MOTHER);

    expect(resource.relationship?.[0]?.coding?.[0]?.code).toBe('MTH');
    expect(fromFhirRelatedPerson(resource).relationshipCode).toBe('MTH');
  });

  it('answers false rather than absent for a role the resource does not carry', () => {
    /* An absent flag and a false one are the same to `toEqual` and different to
       a caller writing the row back. */
    const domain = fromFhirRelatedPerson(
      toFhirRelatedPerson({ ...MOTHER, isGuardian: false, isPortalProxy: false })
    );

    expect(domain.isGuardian).toBe(false);
    expect(domain.isPortalProxy).toBe(false);
    expect(domain.isEmergencyContact).toBe(true);
  });

  it('survives a person with nothing but a name and a relationship', () => {
    const bare: DomainRelatedPerson = {
      id: '0192f1a0-0000-7000-8000-0000000000r2',
      patientId: MOTHER.patientId,
      relationshipCode: 'FTH',
      givenName: 'Tobias',
      familyName: 'Assertson',
      isGuardian: false,
      isEmergencyContact: false,
      isPortalProxy: false,
    };

    expect(fromFhirRelatedPerson(toFhirRelatedPerson(bare))).toEqual(bare);
  });

  it('normalises a row that says emergency contact and not an emergency contact', () => {
    /*
     * The row can hold a contradiction the resource cannot: relationship `ECON`
     * with `isEmergencyContact` false. FHIR has one code system for both facts,
     * so the coding set decides, and this comes back true.
     *
     * That is deliberate, and it is the second design this file had. Filtering
     * role codes out of the primary lookup kept the boolean but returned an
     * empty relationship for somebody who plainly had one, which is a worse
     * answer to give a client than a corrected flag.
     */
    const contradictory: DomainRelatedPerson = {
      id: '0192f1a0-0000-7000-8000-0000000000r3',
      patientId: MOTHER.patientId,
      relationshipCode: 'ECON',
      givenName: 'Adia',
      familyName: 'Nwosu',
      isGuardian: false,
      isEmergencyContact: false,
      isPortalProxy: false,
    };

    const round = fromFhirRelatedPerson(toFhirRelatedPerson(contradictory));

    expect(round.relationshipCode).toBe('ECON');
    expect(round.isEmergencyContact).toBe(true);
  });

  it('writes a role once when it is also the recorded relationship', () => {
    /* A guardian recorded as GUARD is one coding, not the same coding twice. */
    const guardian = { ...MOTHER, relationshipCode: 'GUARD', isEmergencyContact: false };
    const codes = (toFhirRelatedPerson(guardian).relationship ?? []).map(
      (concept) => concept.coding?.[0]?.code
    );

    expect(codes).toEqual(['GUARD']);
    expect(fromFhirRelatedPerson(toFhirRelatedPerson(guardian)).isGuardian).toBe(true);
  });
});

describe('telecom, which the row does not classify', () => {
  it('reads a contact point another system marked mobile or work', () => {
    /*
     * The reader matches on system alone. Requiring `home` would silently drop
     * the phone number of every `RelatedPerson` written by a system that did
     * record a use, which is most of them.
     */
    const domain = fromFhirRelatedPerson({
      resourceType: 'RelatedPerson',
      patient: { reference: 'Patient/p-1' },
      relationship: [{ coding: [{ system: SYSTEMS.roleCode, code: 'MTH' }] }],
      name: [{ family: 'Verificada', given: ['Marisol'] }],
      telecom: [
        { system: 'phone', value: '+1 555 0142 900', use: 'mobile' },
        { system: 'email', value: 'work@example.invalid', use: 'work' },
      ],
    });

    expect(domain.phone).toBe('+1 555 0142 900');
    expect(domain.email).toBe('work@example.invalid');
  });
});

describe('fromFhirRelatedPerson, on input it did not write', () => {
  it('reads a resource whose only relationship is the emergency contact role', () => {
    /* Another system's `RelatedPerson` need not carry a relationship beyond the
       role, and that is a complete statement rather than a missing one. */
    const domain = fromFhirRelatedPerson({
      resourceType: 'RelatedPerson',
      id: 'external-1',
      patient: { reference: 'Patient/p-1' },
      relationship: [{ coding: [{ system: SYSTEMS.roleCode, code: 'ECON' }] }],
      name: [{ family: 'Nwosu', given: ['Adia'] }],
    });

    expect(domain.relationshipCode).toBe('ECON');
    expect(domain.isEmergencyContact).toBe(true);
    expect(domain.familyName).toBe('Nwosu');
  });

  it('ignores a coding from a system that is not RoleCode', () => {
    const domain = fromFhirRelatedPerson({
      resourceType: 'RelatedPerson',
      patient: { reference: 'Patient/p-1' },
      relationship: [{ coding: [{ system: 'http://example.invalid/roles', code: 'GUARD' }] }],
      name: [{ family: 'Assertson', given: ['Kai'] }],
    });

    expect(domain.relationshipCode).toBe('');
    expect(domain.isGuardian).toBe(false);
  });
});
