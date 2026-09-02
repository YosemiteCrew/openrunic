/// <reference types="fhir" preserve="true" />

import { enumMapping } from './enum-mapping.js';
import { compact, period, present, readString, setOptional } from './primitives.js';
import { fhirReference, referenceId, referenceType } from './reference.js';

/**
 * Who is looking after a patient, and in what capacity.
 *
 * Not derivable from the rows that already exist, which is why it is a resource
 * with a table behind it. An encounter names the provider who saw the patient
 * once; a referral names one hand-off. Neither answers "who is on this
 * patient's team right now", which is what a receiving system asks and what a
 * care manager asks every morning.
 *
 * ## The member is a choice of three, and the choice is the whole design
 *
 * A participant is a clinician here, somebody related to the patient, or the
 * patient. Each maps to a different FHIR resource type, so the member type
 * decides both which column carries the id and which type the reference names.
 * Getting that pairing wrong does not produce an error: it produces a
 * `Practitioner/{id}` that resolves to nothing, or a daughter served as a
 * clinician, and a client believes both.
 */

export type DomainCareTeamStatus =
  'PROPOSED' | 'ACTIVE' | 'SUSPENDED' | 'INACTIVE' | 'ENTERED_IN_ERROR';

export type DomainCareTeamMemberType = 'USER' | 'RELATED_PERSON' | 'PATIENT';

export const CARE_TEAM_STATUS = enumMapping<
  DomainCareTeamStatus,
  NonNullable<fhir4.CareTeam['status']>
>({
  map: {
    PROPOSED: 'proposed',
    ACTIVE: 'active',
    SUSPENDED: 'suspended',
    INACTIVE: 'inactive',
    ENTERED_IN_ERROR: 'entered-in-error',
  },
  fallback: 'ACTIVE',
});

/** The FHIR resource type each member kind is served as. */
const MEMBER_RESOURCE_TYPE: Record<DomainCareTeamMemberType, string> = {
  USER: 'Practitioner',
  RELATED_PERSON: 'RelatedPerson',
  PATIENT: 'Patient',
};

export interface DomainCareTeamParticipant {
  id: string;
  memberType: DomainCareTeamMemberType;
  /** Set when, and only when, the member type is `USER`. */
  memberUserId?: string;
  /** Set when, and only when, the member type is `RELATED_PERSON`. */
  memberRelatedPersonId?: string;
  /** The role held on this team. Coded, so a string. */
  roleCode: string;
  roleSystem: string;
  roleText?: string;
  periodStart?: string;
  periodEnd?: string;
}

export interface DomainCareTeam {
  id: string;
  patientId: string;
  status: DomainCareTeamStatus;
  name?: string;
  periodStart?: string;
  periodEnd?: string;
  participants: readonly DomainCareTeamParticipant[];
}

/**
 * The id this participant points at, given the team it is on.
 *
 * `PATIENT` resolves to the team's subject rather than to a column, because the
 * team already names it and a second id could only agree or be wrong.
 */
function memberId(participant: DomainCareTeamParticipant, subjectId: string): string | undefined {
  if (participant.memberType === 'USER') return participant.memberUserId;
  if (participant.memberType === 'RELATED_PERSON') return participant.memberRelatedPersonId;
  return subjectId;
}

function participantResource(
  participant: DomainCareTeamParticipant,
  subjectId: string
): fhir4.CareTeamParticipant | undefined {
  const id = memberId(participant, subjectId);
  /* A participant with no member is dropped rather than emitted bare. FHIR
     allows `role` without `member`, but a role nobody holds is not a team
     member: a client rendering the team would show an empty row. The database
     check constraint makes this unreachable from a stored row. */
  if (id === undefined) return undefined;

  return compact<fhir4.CareTeamParticipant>({
    /* The row's own id, carried on the backbone element. Without it a round
       trip through FHIR replaces every participant id with its position, so
       reordering the list silently reassigns identities and a patch aimed at
       one member lands on another. */
    id: participant.id,
    role: [
      {
        coding: [{ system: participant.roleSystem, code: participant.roleCode }],
        text: participant.roleText,
      },
    ],
    member: fhirReference(MEMBER_RESOURCE_TYPE[participant.memberType], id),
    period: period(participant.periodStart, participant.periodEnd),
  });
}

/** Maps a {@link DomainCareTeam} to a FHIR R4 `CareTeam`. */
export function toFhirCareTeam(input: DomainCareTeam): fhir4.CareTeam {
  return compact<fhir4.CareTeam>({
    resourceType: 'CareTeam',
    id: input.id,
    status: CARE_TEAM_STATUS.toFhir(input.status),
    name: input.name,
    subject: fhirReference('Patient', input.patientId),
    period: period(input.periodStart, input.periodEnd),
    participant: present(
      input.participants.map((participant) => participantResource(participant, input.patientId))
    ),
  });
}

/**
 * Reads one participant back, or nothing when this system cannot hold it.
 *
 * Two shapes are refused, and both are refused rather than approximated.
 *
 * A member of a type with no column here - FHIR also allows an `Organization`,
 * and an outside agency on a patient's team is a real arrangement - has nowhere
 * to go. Keeping the display text and dropping the reference would list a team
 * member nobody can contact.
 *
 * A `Patient` member that is not this team's subject is somebody else. Mapping
 * it to `PATIENT` would re-emit it as the subject, quietly turning one person
 * into another; that is worse than the row being absent, because the absence is
 * at least not a claim.
 */
function participantFromFhir(
  participant: fhir4.CareTeamParticipant,
  subjectId: string,
  index: number
): DomainCareTeamParticipant | undefined {
  const type = referenceType(participant.member);
  const id = referenceId(participant.member);
  if (id === undefined) return undefined;

  const role = participant.role?.[0];
  const coding = role?.coding?.[0];
  const roleCode = readString(coding?.code);
  const roleSystem = readString(coding?.system);
  /* Both, or neither. A code with no system is a string nobody can look up, and
     a system with no code names a vocabulary and no term in it. */
  if (roleCode === undefined || roleSystem === undefined) return undefined;

  const base = {
    /*
     * The element's own id when it has one, and its position when it does not.
     *
     * A backbone element may carry an `id`, and this mapper writes the row's
     * there, so anything it produced comes back with the real identity. Foreign
     * input often omits it, and the index is then the only stable handle there
     * is - stable within one read, which is all a caller can use it for.
     */
    id: readString(participant.id) ?? `${index}`,
    roleCode,
    roleSystem,
  };

  if (type === 'Practitioner') {
    const domain: DomainCareTeamParticipant = { ...base, memberType: 'USER', memberUserId: id };
    return withRoleDetail(domain, role, participant);
  }
  if (type === 'RelatedPerson') {
    const domain: DomainCareTeamParticipant = {
      ...base,
      memberType: 'RELATED_PERSON',
      memberRelatedPersonId: id,
    };
    return withRoleDetail(domain, role, participant);
  }
  if (type === 'Patient' && id === subjectId) {
    return withRoleDetail({ ...base, memberType: 'PATIENT' }, role, participant);
  }
  return undefined;
}

function withRoleDetail(
  domain: DomainCareTeamParticipant,
  role: fhir4.CodeableConcept | undefined,
  participant: fhir4.CareTeamParticipant
): DomainCareTeamParticipant {
  setOptional(domain, 'roleText', readString(role?.text));
  setOptional(domain, 'periodStart', readString(participant.period?.start));
  setOptional(domain, 'periodEnd', readString(participant.period?.end));
  return domain;
}

/** Maps a FHIR R4 `CareTeam` back to a {@link DomainCareTeam}. */
export function fromFhirCareTeam(resource: fhir4.CareTeam): DomainCareTeam {
  const patientId = referenceId(resource.subject, 'Patient') ?? '';

  const domain: DomainCareTeam = {
    id: resource.id ?? '',
    patientId,
    status: CARE_TEAM_STATUS.fromFhir(resource.status),
    participants: present(
      (resource.participant ?? []).map((participant, index) =>
        participantFromFhir(participant, patientId, index)
      )
    ),
  };

  setOptional(domain, 'name', readString(resource.name));
  setOptional(domain, 'periodStart', readString(resource.period?.start));
  setOptional(domain, 'periodEnd', readString(resource.period?.end));
  return domain;
}
