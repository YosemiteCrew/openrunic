import { describe, expect, it } from 'vitest';

import { fromFhirCareTeam, toFhirCareTeam, type DomainCareTeam } from './care-team.js';
import { SYSTEMS } from './systems.js';

/**
 * Care teams, across the boundary and back.
 *
 * Almost everything here is about the member reference, because it is the one
 * field that can be wrong rather than missing. A participant carries an id and
 * a member type, and the type decides which FHIR resource type the reference
 * names. Pair them wrongly and nothing errors: the resource is valid FHIR, and
 * a client resolves a Practitioner that does not exist, or renders a patient's
 * daughter as one of their clinicians.
 */

const PATIENT = '0192f1a0-0000-7000-8000-0000000000p1';
const DOCTOR = '0192f1a0-0000-7000-8000-0000000000u1';
const DAUGHTER = '0192f1a0-0000-7000-8000-0000000000r1';

const TEAM: DomainCareTeam = {
  id: '0192f1a0-0000-7000-8000-0000000000c1',
  patientId: PATIENT,
  status: 'ACTIVE',
  name: 'Diabetes care',
  periodStart: '2026-01-05T00:00:00.000Z',
  participants: [
    {
      id: '0',
      memberType: 'USER',
      memberUserId: DOCTOR,
      roleCode: '207Q00000X',
      roleSystem: SYSTEMS.nucc,
      roleText: 'Family medicine',
    },
    {
      id: '1',
      memberType: 'RELATED_PERSON',
      memberRelatedPersonId: DAUGHTER,
      roleCode: 'DAUGHTER',
      roleSystem: SYSTEMS.roleCode,
      periodStart: '2026-02-01T00:00:00.000Z',
    },
    {
      id: '2',
      memberType: 'PATIENT',
      roleCode: '116154003',
      roleSystem: SYSTEMS.snomed,
    },
  ],
};

describe('toFhirCareTeam', () => {
  it('names each member at the resource type it is actually served as', () => {
    const references = toFhirCareTeam(TEAM).participant?.map((p) => p.member?.reference);

    expect(references).toEqual([
      `Practitioner/${DOCTOR}`,
      `RelatedPerson/${DAUGHTER}`,
      `Patient/${PATIENT}`,
    ]);
  });

  it('resolves the patient member from the subject rather than from a column', () => {
    /* There is no member column for it. The team already names its subject, so
       a second id could only agree with it or be wrong, and the row that could
       disagree does not exist. */
    const elsewhere = toFhirCareTeam({ ...TEAM, patientId: 'other-patient' });

    expect(elsewhere.participant?.[2]?.member?.reference).toBe('Patient/other-patient');
  });

  it('carries the role as a coding, not only as text', () => {
    const role = toFhirCareTeam(TEAM).participant?.[0]?.role?.[0];

    expect(role?.coding).toEqual([{ system: SYSTEMS.nucc, code: '207Q00000X' }]);
    expect(role?.text).toBe('Family medicine');
  });

  it('maps every status to its FHIR code', () => {
    const codes = (
      ['PROPOSED', 'ACTIVE', 'SUSPENDED', 'INACTIVE', 'ENTERED_IN_ERROR'] as const
    ).map((status) => toFhirCareTeam({ ...TEAM, status }).status);

    expect(codes).toEqual(['proposed', 'active', 'suspended', 'inactive', 'entered-in-error']);
  });

  it('gives a member its own period, separate from the team period', () => {
    /* A team runs from January and the daughter joined in February. One period
       for both would say the daughter has been on it since January. */
    const resource = toFhirCareTeam(TEAM);

    expect(resource.period?.start).toBe('2026-01-05T00:00:00.000Z');
    expect(resource.participant?.[1]?.period?.start).toBe('2026-02-01T00:00:00.000Z');
    expect(resource.participant?.[0]?.period).toBeUndefined();
  });

  it('serves a team with nobody on it as a team with no participants', () => {
    /* Reachable: a team is created and members are added afterwards. An empty
       participant array is the honest projection of it. */
    const resource = toFhirCareTeam({ ...TEAM, participants: [] });

    expect(resource.participant).toBeUndefined();
    expect(resource.subject?.reference).toBe(`Patient/${PATIENT}`);
  });
});

describe('round trip', () => {
  it('returns every field it was given', () => {
    expect(fromFhirCareTeam(toFhirCareTeam(TEAM))).toEqual(TEAM);
  });

  it('survives a team with nothing but a subject, a status and one member', () => {
    const bare: DomainCareTeam = {
      id: '0192f1a0-0000-7000-8000-0000000000c2',
      patientId: PATIENT,
      status: 'PROPOSED',
      participants: [
        {
          id: '0',
          memberType: 'USER',
          memberUserId: DOCTOR,
          roleCode: '163W00000X',
          roleSystem: SYSTEMS.nucc,
        },
      ],
    };

    expect(fromFhirCareTeam(toFhirCareTeam(bare))).toEqual(bare);
  });

  it('keeps the member type, not just the id', () => {
    /* The failure this guards is a reference read back at the wrong type: the
       daughter arriving as `USER` puts her id in the practitioner column, and
       the next write emits `Practitioner/{her id}`, which resolves to nobody. */
    const back = fromFhirCareTeam(toFhirCareTeam(TEAM));

    expect(back.participants.map((p) => p.memberType)).toEqual([
      'USER',
      'RELATED_PERSON',
      'PATIENT',
    ]);
    expect(back.participants[1]?.memberUserId).toBeUndefined();
  });
});

describe('fromFhirCareTeam, on input it did not write', () => {
  const foreign = (participant: fhir4.CareTeamParticipant): fhir4.CareTeam => ({
    resourceType: 'CareTeam',
    id: 'external-1',
    status: 'active',
    subject: { reference: `Patient/${PATIENT}` },
    participant: [participant],
  });

  it('drops a member type this system has no column for', () => {
    /*
     * FHIR allows an Organization member and an outside agency on a team is a
     * real arrangement, but this deployment has one Organisation row and it is
     * the practice. Keeping the display and dropping the reference would list a
     * team member nobody can contact.
     */
    const domain = fromFhirCareTeam(
      foreign({
        role: [{ coding: [{ system: SYSTEMS.nucc, code: '251E00000X' }] }],
        member: { reference: 'Organization/agency-1', display: 'County home health' },
      })
    );

    expect(domain.participants).toEqual([]);
  });

  it('drops a patient member who is not this team subject', () => {
    /*
     * Somebody else. Mapping it to PATIENT would re-emit it as the subject and
     * quietly turn one person into another, which is worse than the absence:
     * the absence is at least not a claim.
     */
    const domain = fromFhirCareTeam(
      foreign({
        role: [{ coding: [{ system: SYSTEMS.snomed, code: '116154003' }] }],
        member: { reference: 'Patient/somebody-else' },
      })
    );

    expect(domain.participants).toEqual([]);
  });

  it('keeps the patient member when it is this team subject', () => {
    /* The other half of the check above: it has to still accept the ordinary
       case, or self-management disappears from every team. */
    const domain = fromFhirCareTeam(
      foreign({
        role: [{ coding: [{ system: SYSTEMS.snomed, code: '116154003' }] }],
        member: { reference: `Patient/${PATIENT}` },
      })
    );

    expect(domain.participants).toEqual([
      { id: '0', memberType: 'PATIENT', roleCode: '116154003', roleSystem: SYSTEMS.snomed },
    ]);
  });

  it('drops a participant with no member reference at all', () => {
    /* FHIR permits `role` without `member`. A role nobody holds is not a team
       member, and rendered it is an empty row in the team list. */
    expect(
      fromFhirCareTeam(
        foreign({ role: [{ coding: [{ system: SYSTEMS.nucc, code: '207Q00000X' }] }] })
      ).participants
    ).toEqual([]);
  });

  it('drops a role coded with no system, and one with no code', () => {
    /* A code with no system is a string nobody can look up; a system with no
       code names a vocabulary and no term in it. Stored, either produces a role
       that cannot be resolved to a display anywhere. */
    const noSystem = fromFhirCareTeam(
      foreign({
        role: [{ coding: [{ code: '207Q00000X' }] }],
        member: { reference: `Practitioner/${DOCTOR}` },
      })
    );
    const noCode = fromFhirCareTeam(
      foreign({
        role: [{ coding: [{ system: SYSTEMS.nucc }] }],
        member: { reference: `Practitioner/${DOCTOR}` },
      })
    );

    expect(noSystem.participants).toEqual([]);
    expect(noCode.participants).toEqual([]);
  });

  it('numbers the participants it keeps by their position in the input', () => {
    /* A CareTeam participant is a backbone element and carries no id of its
       own, so the index is the only stable handle the mapper has. */
    const domain = fromFhirCareTeam({
      resourceType: 'CareTeam',
      status: 'active',
      subject: { reference: `Patient/${PATIENT}` },
      participant: [
        {
          role: [{ coding: [{ system: SYSTEMS.nucc, code: 'a' }] }],
          member: { reference: `Practitioner/${DOCTOR}` },
        },
        {
          role: [{ coding: [{ system: SYSTEMS.nucc, code: 'b' }] }],
          member: { reference: `Practitioner/${DOCTOR}` },
        },
      ],
    });

    expect(domain.participants.map((p) => p.id)).toEqual(['0', '1']);
  });

  it('falls back to ACTIVE for a status outside the value set', () => {
    const domain = fromFhirCareTeam({
      resourceType: 'CareTeam',
      status: 'nonsense' as fhir4.CareTeam['status'],
      subject: { reference: `Patient/${PATIENT}` },
    });

    expect(domain.status).toBe('ACTIVE');
    expect(domain.participants).toEqual([]);
  });
});
