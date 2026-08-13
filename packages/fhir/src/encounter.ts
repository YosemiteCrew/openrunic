/// <reference types="fhir" preserve="true" />

import { enumMapping } from './enum-mapping.js';
import {
  codeableConcept,
  compact,
  period,
  present,
  readCode,
  readString,
  setOptional,
} from './primitives.js';
import { fhirReference, referenceId } from './reference.js';
import { SYSTEMS } from './systems.js';

/** Ambulatory only by product scope; inpatient classes are out of scope. */
export type DomainEncounterClass = 'AMBULATORY' | 'VIRTUAL' | 'HOME' | 'FIELD' | 'EMERGENCY';

export type DomainEncounterStatus =
  'PLANNED' | 'IN_PROGRESS' | 'ON_HOLD' | 'COMPLETED' | 'CANCELLED' | 'ENTERED_IN_ERROR';

const ENCOUNTER_CLASS = enumMapping<DomainEncounterClass, string>({
  map: {
    AMBULATORY: 'AMB',
    VIRTUAL: 'VR',
    HOME: 'HH',
    FIELD: 'FLD',
    EMERGENCY: 'EMER',
  },
  fallback: 'AMBULATORY',
});

const ENCOUNTER_STATUS = enumMapping<DomainEncounterStatus, fhir4.Encounter['status']>({
  map: {
    PLANNED: 'planned',
    IN_PROGRESS: 'in-progress',
    ON_HOLD: 'onleave',
    COMPLETED: 'finished',
    CANCELLED: 'cancelled',
    ENTERED_IN_ERROR: 'entered-in-error',
  },
  fallback: 'PLANNED',
});

/** A visit. Created automatically on check-in from the appointment. */
export interface DomainEncounter {
  id: string;
  facilityId: string;
  patientId: string;
  providerId: string;
  appointmentId?: string;
  class: DomainEncounterClass;
  status: DomainEncounterStatus;
  /** Chief complaint / visit reason code. */
  reasonCode?: string;
  reasonText?: string;
  /** ISO 8601 instant. */
  startedAt: string;
  /** ISO 8601 instant. */
  endedAt?: string;
}

/**
 * Note-signing state lives on `ClinicalNote`, which serializes as a
 * DocumentReference rather than through the Encounter, so the encounter-level
 * signature stamps have no boundary equivalent.
 */
export const ENCOUNTER_DROPPED_FIELDS = [
  'tenantId',
  'signedAt',
  'signedById',
  'createdAt',
  'updatedAt',
] as const;

/** Maps a {@link DomainEncounter} to a FHIR R4 `Encounter`. */
export function toFhirEncounter(input: DomainEncounter): fhir4.Encounter {
  return compact<fhir4.Encounter>({
    resourceType: 'Encounter',
    id: input.id,
    status: ENCOUNTER_STATUS.toFhir(input.status),
    class: {
      system: SYSTEMS.actCode,
      code: ENCOUNTER_CLASS.toFhir(input.class),
    },
    subject: fhirReference('Patient', input.patientId),
    participant: [{ individual: fhirReference('Practitioner', input.providerId) }],
    appointment:
      input.appointmentId === undefined || input.appointmentId === ''
        ? undefined
        : [fhirReference('Appointment', input.appointmentId)],
    period: period(input.startedAt, input.endedAt),
    reasonCode: present<fhir4.CodeableConcept>([
      codeableConcept({ code: input.reasonCode, text: input.reasonText }),
    ]),
    location: [{ location: fhirReference('Location', input.facilityId) }],
  });
}

/** Maps a FHIR R4 `Encounter` back to a {@link DomainEncounter}. */
export function fromFhirEncounter(resource: fhir4.Encounter): DomainEncounter {
  const reason = resource.reasonCode?.[0];
  const domain: DomainEncounter = {
    id: resource.id ?? '',
    facilityId: referenceId(resource.location?.[0]?.location, 'Location') ?? '',
    patientId: referenceId(resource.subject, 'Patient') ?? '',
    providerId: referenceId(resource.participant?.[0]?.individual, 'Practitioner') ?? '',
    class: ENCOUNTER_CLASS.fromFhir(resource.class?.code),
    status: ENCOUNTER_STATUS.fromFhir(resource.status),
    startedAt: resource.period?.start ?? '',
  };
  setOptional(domain, 'appointmentId', referenceId(resource.appointment?.[0], 'Appointment'));
  setOptional(domain, 'reasonCode', readCode(reason));
  setOptional(domain, 'reasonText', readString(reason?.text));
  setOptional(domain, 'endedAt', readString(resource.period?.end));
  return domain;
}
