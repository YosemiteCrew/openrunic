/// <reference types="fhir" preserve="true" />

import { enumMapping } from './enum-mapping.js';
import {
  LOCAL_PRIORITY_EXTENSION,
  localStatusExtension,
  openrunicCodeSystem,
  readLocalStatus,
} from './extensions.js';
import {
  annotations,
  codeableConcept,
  compact,
  present,
  readAnnotation,
  readCode,
  readConceptText,
  readString,
  setOptional,
} from './primitives.js';
import { fhirReference, optionalReference, referenceId, referenceType } from './reference.js';

/** Code system for the typed inbox's streams. */
export const TASK_TYPE_SYSTEM = openrunicCodeSystem('task-type');

/** Namespace for team pools, which are configuration keys rather than rows. */
export const TEAM_SYSTEM = 'https://openrunic.org/fhir/sid/team';

export type DomainTaskType =
  | 'RESULT'
  | 'MESSAGE'
  | 'REFILL'
  | 'COSIGN'
  | 'DOCUMENT'
  | 'FAX'
  | 'PRIOR_AUTH'
  | 'CLAIM_EXCEPTION'
  | 'GENERAL';

export type DomainTaskStatus =
  'OPEN' | 'IN_PROGRESS' | 'ON_HOLD' | 'DONE' | 'CANCELLED' | 'EXPIRED';

export type DomainTaskPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

export type DomainTaskAssigneeType = 'USER' | 'TEAM';

const TASK_TYPES: readonly DomainTaskType[] = [
  'RESULT',
  'MESSAGE',
  'REFILL',
  'COSIGN',
  'DOCUMENT',
  'FAX',
  'PRIOR_AUTH',
  'CLAIM_EXCEPTION',
  'GENERAL',
];

export const TASK_STATUS = enumMapping<DomainTaskStatus, fhir4.Task['status']>({
  map: {
    OPEN: 'ready',
    IN_PROGRESS: 'in-progress',
    ON_HOLD: 'on-hold',
    DONE: 'completed',
    CANCELLED: 'cancelled',
    EXPIRED: 'cancelled',
  },
  canonical: { cancelled: 'CANCELLED' },
  fallback: 'OPEN',
});

export const TASK_PRIORITY = enumMapping<DomainTaskPriority, NonNullable<fhir4.Task['priority']>>({
  map: { LOW: 'routine', NORMAL: 'routine', HIGH: 'urgent', URGENT: 'stat' },
  canonical: { routine: 'NORMAL' },
  fallback: 'NORMAL',
});

/** One item of work in the typed inbox. */
export interface DomainTask {
  id: string;
  type: DomainTaskType;
  status: DomainTaskStatus;
  priority: DomainTaskPriority;
  patientId?: string;
  encounterId?: string;
  /** Model name of the thing the task is about, e.g. `DiagnosticReport`. */
  subjectType?: string;
  subjectId?: string;
  title: string;
  description?: string;
  assigneeType: DomainTaskAssigneeType;
  assigneeUserId?: string;
  assigneeTeamKey?: string;
  /** ISO 8601 instant. */
  dueAt?: string;
  /** ISO 8601 instant. */
  completedAt?: string;
  outcome?: string;
}

/**
 * Inbox machinery that stays inside Openrunic. `slaState` is derived from
 * `dueAt` by the SLA worker, `expiresAt` drives the FYI auto-close, and
 * `sourceEventId` is the idempotency key that makes event routing safe under
 * at-least-once delivery.
 */
export const TASK_DROPPED_FIELDS = [
  'tenantId',
  'slaState',
  'expiresAt',
  'sourceEventId',
  'completedById',
  'createdAt',
  'updatedAt',
] as const;

function owner(input: DomainTask): fhir4.Reference | undefined {
  if (input.assigneeType === 'TEAM') {
    return input.assigneeTeamKey === undefined || input.assigneeTeamKey === ''
      ? undefined
      : { identifier: { system: TEAM_SYSTEM, value: input.assigneeTeamKey } };
  }
  return optionalReference('Practitioner', input.assigneeUserId);
}

/** Maps a {@link DomainTask} to a FHIR R4 `Task`. */
export function toFhirTask(input: DomainTask): fhir4.Task {
  const focus =
    input.subjectType === undefined || input.subjectType === ''
      ? undefined
      : input.subjectId === undefined || input.subjectId === ''
        ? { type: input.subjectType }
        : fhirReference(input.subjectType, input.subjectId);

  return compact<fhir4.Task>({
    resourceType: 'Task',
    id: input.id,
    extension: present<fhir4.Extension>([
      localStatusExtension(TASK_STATUS, input.status),
      localStatusExtension(TASK_PRIORITY, input.priority, LOCAL_PRIORITY_EXTENSION),
    ]),
    status: TASK_STATUS.toFhir(input.status),
    statusReason: codeableConcept({ text: input.outcome }),
    intent: 'order',
    priority: TASK_PRIORITY.toFhir(input.priority),
    code: codeableConcept({ system: TASK_TYPE_SYSTEM, code: input.type }),
    description: input.title,
    focus,
    for: optionalReference('Patient', input.patientId),
    encounter: optionalReference('Encounter', input.encounterId),
    executionPeriod:
      input.completedAt === undefined || input.completedAt === ''
        ? undefined
        : { end: input.completedAt },
    owner: owner(input),
    restriction:
      input.dueAt === undefined || input.dueAt === ''
        ? undefined
        : { period: { end: input.dueAt } },
    note: annotations(input.description),
  });
}

/** Maps a FHIR R4 `Task` back to a {@link DomainTask}. */
export function fromFhirTask(resource: fhir4.Task): DomainTask {
  const code = readCode(resource.code, TASK_TYPE_SYSTEM);
  const ownerUserId = referenceId(resource.owner, 'Practitioner');
  const teamKey =
    resource.owner?.identifier?.system === TEAM_SYSTEM
      ? readString(resource.owner.identifier.value)
      : undefined;

  const domain: DomainTask = {
    id: resource.id ?? '',
    type: TASK_TYPES.find((value) => value === code) ?? 'GENERAL',
    status: readLocalStatus(TASK_STATUS, resource.extension, resource.status),
    priority: readLocalStatus(
      TASK_PRIORITY,
      resource.extension,
      resource.priority,
      LOCAL_PRIORITY_EXTENSION
    ),
    title: resource.description ?? '',
    assigneeType: teamKey === undefined ? 'USER' : 'TEAM',
  };
  setOptional(domain, 'patientId', referenceId(resource.for, 'Patient'));
  setOptional(domain, 'encounterId', referenceId(resource.encounter, 'Encounter'));
  setOptional(domain, 'subjectType', referenceType(resource.focus));
  setOptional(domain, 'subjectId', referenceId(resource.focus));
  setOptional(domain, 'description', readAnnotation(resource.note));
  setOptional(domain, 'assigneeUserId', ownerUserId);
  setOptional(domain, 'assigneeTeamKey', teamKey);
  setOptional(domain, 'dueAt', readString(resource.restriction?.period?.end));
  setOptional(domain, 'completedAt', readString(resource.executionPeriod?.end));
  setOptional(domain, 'outcome', readConceptText(resource.statusReason));
  return domain;
}
