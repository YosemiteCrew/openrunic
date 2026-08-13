import { describe, expect, it } from 'vitest';

import {
  APPOINTMENT_DROPPED_FIELDS,
  APPOINTMENT_STATUS,
  APPOINTMENT_TYPE_SYSTEM,
  ENCOUNTER_DROPPED_FIELDS,
  LOCAL_PRIORITY_EXTENSION,
  LOCAL_STATUS_EXTENSION,
  SYSTEMS,
  TASK_DROPPED_FIELDS,
  TASK_PRIORITY,
  TASK_STATUS,
  TEAM_SYSTEM,
  fromFhirAppointment,
  fromFhirEncounter,
  fromFhirTask,
  toFhirAppointment,
  toFhirEncounter,
  toFhirTask,
} from './index.js';
import type { DomainAppointment, DomainEncounter, DomainTask } from './index.js';
import { describeRoundTrips, expectDroppedFields } from './test-support/round-trip.js';

describe('appointment mapping', () => {
  const roomed: DomainAppointment = {
    id: 'apt-1',
    facilityId: 'fac-1',
    patientId: 'pat-1',
    providerId: 'u-1',
    typeCode: 'follow-up',
    typeDisplay: 'Follow up, 20 minutes',
    status: 'ROOMED',
    start: '2026-08-13T16:00:00.000Z',
    end: '2026-08-13T16:20:00.000Z',
    durationMinutes: 20,
    reasonText: 'Blood pressure check',
  };
  const cancelled: DomainAppointment = {
    id: 'apt-2',
    facilityId: 'fac-1',
    providerId: 'u-1',
    typeCode: 'new-patient',
    typeDisplay: 'New patient, 40 minutes',
    status: 'CANCELLED',
    start: '2026-08-14T15:00:00.000Z',
    end: '2026-08-14T15:40:00.000Z',
    durationMinutes: 40,
    cancelReason: 'Patient rescheduled',
  };
  const degenerate: DomainAppointment = {
    id: '',
    facilityId: '',
    providerId: '',
    typeCode: '',
    typeDisplay: '',
    status: 'BOOKED',
    start: '',
    end: '',
    durationMinutes: 0,
  };

  it('collapses front-desk states to a valid FHIR status and keeps the exact one', () => {
    const resource = toFhirAppointment(roomed);
    expect(resource.status).toBe('checked-in');
    expect(resource.extension).toStrictEqual([
      { url: LOCAL_STATUS_EXTENSION, valueCode: 'ROOMED' },
    ]);
  });

  it('adds no extension when the FHIR status already round-trips', () => {
    expect(toFhirAppointment(cancelled).extension).toBeUndefined();
  });

  it('names exactly the statuses FHIR R4 cannot express', () => {
    expect(APPOINTMENT_STATUS.lossyValues).toStrictEqual(['ROOMED', 'IN_PROGRESS', 'CHECKED_OUT']);
  });

  it('carries the appointment type as a coded concept with its display', () => {
    expect(toFhirAppointment(roomed).appointmentType).toStrictEqual({
      coding: [
        {
          system: APPOINTMENT_TYPE_SYSTEM,
          code: 'follow-up',
          display: 'Follow up, 20 minutes',
        },
      ],
    });
  });

  it('puts the patient first among the participants', () => {
    expect(toFhirAppointment(roomed).participant?.[0]).toStrictEqual({
      actor: { type: 'Patient', reference: 'Patient/pat-1' },
      status: 'accepted',
      required: 'required',
    });
  });

  it('documents the scheduling columns that stay inside Openrunic', () => {
    expectDroppedFields(roomed, APPOINTMENT_DROPPED_FIELDS);
  });

  describeRoundTrips(
    {
      resourceType: 'Appointment',
      toFhir: toFhirAppointment,
      fromFhir: fromFhirAppointment,
    },
    [
      { label: 'roomed', domain: roomed },
      { label: 'cancelled', domain: cancelled },
      { label: 'degenerate', domain: degenerate },
    ]
  );
});

describe('encounter mapping', () => {
  const full: DomainEncounter = {
    id: 'enc-1',
    facilityId: 'fac-1',
    patientId: 'pat-1',
    providerId: 'u-1',
    appointmentId: 'apt-1',
    class: 'AMBULATORY',
    status: 'COMPLETED',
    reasonCode: '1023001',
    reasonText: 'Blood pressure check',
    startedAt: '2026-08-13T16:02:00.000Z',
    endedAt: '2026-08-13T16:31:00.000Z',
  };
  const virtual: DomainEncounter = {
    id: 'enc-2',
    facilityId: 'fac-1',
    patientId: 'pat-2',
    providerId: 'u-1',
    class: 'VIRTUAL',
    status: 'IN_PROGRESS',
    startedAt: '2026-08-13T18:00:00.000Z',
  };
  const degenerate: DomainEncounter = {
    id: '',
    facilityId: '',
    patientId: '',
    providerId: '',
    class: 'AMBULATORY',
    status: 'PLANNED',
    startedAt: '',
  };

  it('maps the encounter class to a v3 ActCode coding', () => {
    expect(toFhirEncounter(full).class).toStrictEqual({ system: SYSTEMS.actCode, code: 'AMB' });
    expect(toFhirEncounter(virtual).class).toStrictEqual({ system: SYSTEMS.actCode, code: 'VR' });
  });

  it('maps on-hold to onleave and completed to finished', () => {
    expect(toFhirEncounter({ ...full, status: 'ON_HOLD' }).status).toBe('onleave');
    expect(toFhirEncounter(full).status).toBe('finished');
  });

  it('documents the encounter columns that stay inside Openrunic', () => {
    expectDroppedFields(full, ENCOUNTER_DROPPED_FIELDS);
  });

  describeRoundTrips(
    { resourceType: 'Encounter', toFhir: toFhirEncounter, fromFhir: fromFhirEncounter },
    [
      { label: 'full', domain: full },
      { label: 'virtual', domain: virtual },
      { label: 'degenerate', domain: degenerate },
    ]
  );
});

describe('task mapping', () => {
  const teamTask: DomainTask = {
    id: 'task-1',
    type: 'RESULT',
    status: 'EXPIRED',
    priority: 'LOW',
    patientId: 'pat-1',
    encounterId: 'enc-1',
    subjectType: 'DiagnosticReport',
    subjectId: 'dr-1',
    title: 'Review CBC result',
    description: 'Flagged abnormal by the lab.',
    assigneeType: 'TEAM',
    assigneeTeamKey: 'front-desk',
    dueAt: '2026-08-15T17:00:00.000Z',
  };
  const userTask: DomainTask = {
    id: 'task-2',
    type: 'COSIGN',
    status: 'DONE',
    priority: 'URGENT',
    title: 'Cosign visit note',
    assigneeType: 'USER',
    assigneeUserId: 'u-1',
    completedAt: '2026-08-13T20:00:00.000Z',
    outcome: 'Cosigned',
  };
  const degenerate: DomainTask = {
    id: '',
    type: 'GENERAL',
    status: 'OPEN',
    priority: 'NORMAL',
    title: '',
    assigneeType: 'USER',
  };

  it('keeps an expired task distinguishable from a cancelled one', () => {
    const resource = toFhirTask(teamTask);
    expect(resource.status).toBe('cancelled');
    expect(resource.extension).toContainEqual({
      url: LOCAL_STATUS_EXTENSION,
      valueCode: 'EXPIRED',
    });
    expect(toFhirTask({ ...teamTask, status: 'CANCELLED' }).extension).toStrictEqual([
      { url: LOCAL_PRIORITY_EXTENSION, valueCode: 'LOW' },
    ]);
  });

  it('names exactly the statuses and priorities FHIR R4 cannot express', () => {
    expect(TASK_STATUS.lossyValues).toStrictEqual(['EXPIRED']);
    expect(TASK_PRIORITY.lossyValues).toStrictEqual(['LOW']);
  });

  it('assigns a team pool through a logical reference', () => {
    expect(toFhirTask(teamTask).owner).toStrictEqual({
      identifier: { system: TEAM_SYSTEM, value: 'front-desk' },
    });
  });

  it('assigns a person through a literal practitioner reference', () => {
    expect(toFhirTask(userTask).owner).toStrictEqual({
      type: 'Practitioner',
      reference: 'Practitioner/u-1',
    });
  });

  it('points focus at whatever the task is about', () => {
    expect(toFhirTask(teamTask).focus).toStrictEqual({
      type: 'DiagnosticReport',
      reference: 'DiagnosticReport/dr-1',
    });
  });

  it('documents the inbox columns that stay inside Openrunic', () => {
    expectDroppedFields(teamTask, TASK_DROPPED_FIELDS);
  });

  describeRoundTrips({ resourceType: 'Task', toFhir: toFhirTask, fromFhir: fromFhirTask }, [
    { label: 'team', domain: teamTask },
    { label: 'user', domain: userTask },
    { label: 'degenerate', domain: degenerate },
  ]);
});
