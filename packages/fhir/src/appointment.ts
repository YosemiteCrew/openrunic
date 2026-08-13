/// <reference types="fhir" preserve="true" />

import { enumMapping } from './enum-mapping.js';
import { localStatusExtension, openrunicCodeSystem, readLocalStatus } from './extensions.js';
import {
  codeableConcept,
  compact,
  present,
  readCode,
  readCodeDisplay,
  readConceptText,
  readString,
  setOptional,
} from './primitives.js';
import { fhirReference, referenceId } from './reference.js';

/** Code system for the tenant's configured appointment types. */
export const APPOINTMENT_TYPE_SYSTEM = openrunicCodeSystem('appointment-type');

/**
 * One status model shared by the schedule and the Flow Board. FHIR R4 has
 * codes for most of it, but not for the front-desk states between arrival and
 * departure, so `ROOMED`, `IN_PROGRESS` and `CHECKED_OUT` also travel in the
 * local-status extension.
 */
export type DomainAppointmentStatus =
  | 'PROPOSED'
  | 'PENDING'
  | 'BOOKED'
  | 'ARRIVED'
  | 'CHECKED_IN'
  | 'ROOMED'
  | 'IN_PROGRESS'
  | 'CHECKED_OUT'
  | 'FULFILLED'
  | 'CANCELLED'
  | 'NOSHOW'
  | 'ENTERED_IN_ERROR';

export const APPOINTMENT_STATUS = enumMapping<DomainAppointmentStatus, fhir4.Appointment['status']>(
  {
    map: {
      PROPOSED: 'proposed',
      PENDING: 'pending',
      BOOKED: 'booked',
      ARRIVED: 'arrived',
      CHECKED_IN: 'checked-in',
      ROOMED: 'checked-in',
      IN_PROGRESS: 'checked-in',
      CHECKED_OUT: 'fulfilled',
      FULFILLED: 'fulfilled',
      CANCELLED: 'cancelled',
      NOSHOW: 'noshow',
      ENTERED_IN_ERROR: 'entered-in-error',
    },
    canonical: { 'checked-in': 'CHECKED_IN', fulfilled: 'FULFILLED' },
    fallback: 'BOOKED',
  }
);

/** A booked slot. */
export interface DomainAppointment {
  id: string;
  facilityId: string;
  patientId?: string;
  providerId: string;
  /** Appointment type code from the tenant's configured catalogue. */
  typeCode: string;
  typeDisplay: string;
  status: DomainAppointmentStatus;
  /** ISO 8601 instant. */
  start: string;
  /** ISO 8601 instant. */
  end: string;
  durationMinutes: number;
  reasonText?: string;
  cancelReason?: string;
}

/**
 * Scheduling machinery that stays inside Openrunic. R4 has no recurrence model
 * (R5 added one), no room element, and no notion of which surface booked the
 * slot; `checkedInAt` is derivable from the appointment's status history.
 */
export const APPOINTMENT_DROPPED_FIELDS = [
  'tenantId',
  'room',
  'recurrenceGroupId',
  'recurrenceRule',
  'createdVia',
  'checkedInAt',
  'createdById',
  'createdAt',
  'updatedAt',
] as const;

/** Maps a {@link DomainAppointment} to a FHIR R4 `Appointment`. */
export function toFhirAppointment(input: DomainAppointment): fhir4.Appointment {
  const participants: fhir4.AppointmentParticipant[] = [
    { actor: fhirReference('Practitioner', input.providerId), status: 'accepted' },
    { actor: fhirReference('Location', input.facilityId), status: 'accepted' },
  ];
  if (input.patientId !== undefined && input.patientId !== '') {
    participants.unshift({
      actor: fhirReference('Patient', input.patientId),
      status: 'accepted',
      required: 'required',
    });
  }

  return compact<fhir4.Appointment>({
    resourceType: 'Appointment',
    id: input.id,
    extension: present<fhir4.Extension>([localStatusExtension(APPOINTMENT_STATUS, input.status)]),
    status: APPOINTMENT_STATUS.toFhir(input.status),
    cancelationReason: codeableConcept({ text: input.cancelReason }),
    appointmentType: codeableConcept({
      system: APPOINTMENT_TYPE_SYSTEM,
      code: input.typeCode,
      display: input.typeDisplay,
    }),
    description: input.reasonText,
    start: input.start,
    end: input.end,
    minutesDuration: input.durationMinutes,
    participant: participants,
  });
}

function actorId(
  participants: fhir4.AppointmentParticipant[] | undefined,
  resourceType: string
): string | undefined {
  for (const participant of participants ?? []) {
    const id = referenceId(participant.actor, resourceType);
    if (id !== undefined) {
      return id;
    }
  }
  return undefined;
}

/** Maps a FHIR R4 `Appointment` back to a {@link DomainAppointment}. */
export function fromFhirAppointment(resource: fhir4.Appointment): DomainAppointment {
  const domain: DomainAppointment = {
    id: resource.id ?? '',
    facilityId: actorId(resource.participant, 'Location') ?? '',
    providerId: actorId(resource.participant, 'Practitioner') ?? '',
    typeCode: readCode(resource.appointmentType, APPOINTMENT_TYPE_SYSTEM) ?? '',
    typeDisplay: readCodeDisplay(resource.appointmentType, APPOINTMENT_TYPE_SYSTEM) ?? '',
    status: readLocalStatus(APPOINTMENT_STATUS, resource.extension, resource.status),
    start: resource.start ?? '',
    end: resource.end ?? '',
    durationMinutes: resource.minutesDuration ?? 0,
  };
  setOptional(domain, 'patientId', actorId(resource.participant, 'Patient'));
  setOptional(domain, 'reasonText', readString(resource.description));
  setOptional(domain, 'cancelReason', readConceptText(resource.cancelationReason));
  return domain;
}
