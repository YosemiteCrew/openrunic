import { z } from 'zod';

import {
  ABNORMAL_FLAGS,
  DIAGNOSTIC_REPORT_STATUSES,
  DOCUMENT_SOURCES,
  DOCUMENT_STATUSES,
  OBSERVATION_STATUSES,
  ORDER_PRIORITIES,
  SENSITIVITY_CLASSES,
  SERVICE_REQUEST_CATEGORIES,
  SERVICE_REQUEST_INTENTS,
  SERVICE_REQUEST_STATUSES,
  SPECIMEN_STATUSES,
  TASK_ASSIGNEE_TYPES,
  TASK_PRIORITIES,
  TASK_SLA_STATES,
  TASK_STATUSES,
  TASK_TYPES,
} from '../enums.js';
import {
  code,
  codeList,
  codeSystem,
  display,
  jsonObject,
  longText,
  shortText,
  timestamp,
  uuid,
} from './common.js';

/**
 * Order aggregate: the order, what was collected for it, what came back, the
 * document it arrived as, and the inbox task it generates.
 */

export const serviceRequestInput = z.strictObject({
  patientId: uuid,
  encounterId: uuid.optional(),
  orderedById: uuid,
  category: z.enum(SERVICE_REQUEST_CATEGORIES).optional(),
  status: z.enum(SERVICE_REQUEST_STATUSES).optional(),
  intent: z.enum(SERVICE_REQUEST_INTENTS).optional(),
  priority: z.enum(ORDER_PRIORITIES).optional(),
  code,
  codeSystem,
  display,
  specimenTypeCode: code.optional(),
  /** ICD-10-CM codes justifying medical necessity. */
  reasonCodes: codeList.optional(),
  /** Ask-at-order-entry answers, keyed by the compendium item's question ids. */
  aoeAnswers: jsonObject.optional(),
  note: longText.optional(),
  requisitionNumber: z.string().min(1).max(64).optional(),
  performingLabName: shortText.optional(),
  scheduledFor: timestamp.optional(),
});

export const specimenInput = z
  .strictObject({
    patientId: uuid,
    serviceRequestId: uuid.optional(),
    status: z.enum(SPECIMEN_STATUSES).optional(),
    accessionNumber: z.string().min(1).max(64).optional(),
    typeCode: code,
    typeDisplay: display,
    collectionMethodCode: code.optional(),
    bodySiteCode: code.optional(),
    collectedAt: timestamp.optional(),
    collectedById: uuid.optional(),
    receivedAt: timestamp.optional(),
    containerType: shortText.optional(),
    volumeValue: z.number().positive().finite().optional(),
    volumeUnit: z.string().min(1).max(32).optional(),
    rejectionReason: shortText.optional(),
    note: longText.optional(),
  })
  .refine((value) => value.status !== 'UNSATISFACTORY' || value.rejectionReason !== undefined, {
    message: 'an unsatisfactory specimen must record why it was rejected',
    path: ['rejectionReason'],
  })
  .refine(
    (value) => !value.collectedAt || !value.receivedAt || value.receivedAt >= value.collectedAt,
    {
      message: 'receivedAt must not precede collectedAt',
      path: ['receivedAt'],
    }
  );

export const resultObservationInput = z.strictObject({
  sequence: z.int().nonnegative(),
  status: z.enum(OBSERVATION_STATUSES).optional(),
  loincCode: code.optional(),
  code,
  codeSystem: codeSystem.optional(),
  display,
  valueNumber: z.number().finite().optional(),
  valueText: shortText.optional(),
  valueCode: code.optional(),
  unit: z.string().min(1).max(32).optional(),
  referenceLow: z.number().finite().optional(),
  referenceHigh: z.number().finite().optional(),
  referenceRangeText: shortText.optional(),
  interpretationCode: code.optional(),
  abnormalFlag: z.enum(ABNORMAL_FLAGS).optional(),
  effectiveAt: timestamp,
});

export const diagnosticReportInput = z.strictObject({
  patientId: uuid,
  encounterId: uuid.optional(),
  serviceRequestId: uuid.optional(),
  specimenId: uuid.optional(),
  status: z.enum(DIAGNOSTIC_REPORT_STATUSES).optional(),
  category: z.enum(SERVICE_REQUEST_CATEGORIES).optional(),
  code,
  codeSystem: codeSystem.optional(),
  display,
  performingLabName: shortText.optional(),
  abnormalFlag: z.enum(ABNORMAL_FLAGS).optional(),
  narrative: longText.optional(),
  rawStorageKey: z.string().min(1).max(1024).optional(),
  effectiveAt: timestamp.optional(),
  issuedAt: timestamp.optional(),
  /** Discrete analytes, written with the report in one transaction. */
  results: z.array(resultObservationInput).max(500).optional(),
});

export const documentInput = z.strictObject({
  patientId: uuid.optional(),
  encounterId: uuid.optional(),
  category: code,
  title: shortText,
  storageKey: z.string().min(1).max(1024),
  contentType: z.string().min(1).max(128),
  /** Lowercase hex SHA-256 of the stored bytes; the integrity check on restore. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  byteSize: z.int().positive(),
  source: z.enum(DOCUMENT_SOURCES).optional(),
  status: z.enum(DOCUMENT_STATUSES).optional(),
  sensitivityClass: z.enum(SENSITIVITY_CLASSES).optional(),
  receivedAt: timestamp.optional(),
  expiresAt: timestamp.optional(),
});

export const taskInput = z
  .strictObject({
    type: z.enum(TASK_TYPES),
    status: z.enum(TASK_STATUSES).optional(),
    priority: z.enum(TASK_PRIORITIES).optional(),
    patientId: uuid.optional(),
    encounterId: uuid.optional(),
    subjectType: z.string().min(1).max(64).optional(),
    subjectId: uuid.optional(),
    title: shortText,
    description: longText.optional(),
    assigneeType: z.enum(TASK_ASSIGNEE_TYPES),
    assigneeUserId: uuid.optional(),
    assigneeTeamKey: z.string().min(1).max(64).optional(),
    dueAt: timestamp.optional(),
    slaState: z.enum(TASK_SLA_STATES).optional(),
    expiresAt: timestamp.optional(),
    /** Domain event id; makes routing idempotent under at-least-once delivery. */
    sourceEventId: z.string().min(1).max(128).optional(),
  })
  // Exactly one assignee, matching the column pair on the model. A task with
  // both, or with neither, would silently vanish from every inbox filter.
  .refine(
    (value) =>
      value.assigneeType === 'USER'
        ? value.assigneeUserId !== undefined && value.assigneeTeamKey === undefined
        : value.assigneeTeamKey !== undefined && value.assigneeUserId === undefined,
    { message: 'assigneeType must match exactly one of assigneeUserId or assigneeTeamKey' }
  );

export type ServiceRequestInput = z.infer<typeof serviceRequestInput>;
export type SpecimenInput = z.infer<typeof specimenInput>;
export type ResultObservationInput = z.infer<typeof resultObservationInput>;
export type DiagnosticReportInput = z.infer<typeof diagnosticReportInput>;
export type DocumentInput = z.infer<typeof documentInput>;
export type TaskInput = z.infer<typeof taskInput>;
