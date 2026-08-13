import {
  ABNORMAL_FLAGS,
  DIAGNOSTIC_REPORT_STATUSES,
  DOCUMENT_SOURCES,
  DOCUMENT_STATUSES,
  MESSAGE_SENDER_TYPES,
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
  THREAD_KINDS,
} from '@openrunic/database';
import { z } from 'zod';

import { readJsonObject } from '../repositories/collection.js';
import type {
  DiagnosticReportListQuery,
  DiagnosticReportPatchInput,
  DiagnosticReportRow,
  DocumentListQuery,
  DocumentPatchInput,
  DocumentRow,
  MessageListQuery,
  MessageRow,
  MessageThreadCreateInput,
  MessageThreadListQuery,
  MessageThreadPatchInput,
  MessageThreadRow,
  ResultObservationListQuery,
  ResultObservationRow,
  ServiceRequestListQuery,
  ServiceRequestPatchInput,
  ServiceRequestRow,
  SpecimenListQuery,
  SpecimenPatchInput,
  SpecimenRow,
  TaskListQuery,
  TaskPatchInput,
  TaskRow,
} from '../repositories/specs/orders.js';

import { paginationQueryFields, sortOrderField } from './pagination.js';

/**
 * The wire contracts for orders, results and the worklists.
 *
 * Two conventions carried over from the patient and appointment schemas. Every
 * list query is a `strictObject`, so a mistyped filter name is a 400 rather
 * than a search that quietly ignored it and returned the whole table. And every
 * DTO is declared as a schema with its TypeScript type inferred from it, so the
 * published OpenAPI document and the handler's return type cannot describe
 * different objects.
 *
 * The patch contracts are deliberately narrower than the create contracts.
 * Nothing that a state transition owns - an order's status, a specimen's
 * rejection, a document's filing, a task's completion - is reachable through
 * the plain amend route, because a status that two code paths can set is a
 * status whose history nobody can reconstruct.
 *
 * The type aliases come from `repositories/specs/orders.js` rather than from
 * `repositories/types.js`: that module re-exports the core aggregates' query
 * types by hand, and this workstream does not own it.
 */

/** A boolean carried in a query string, where everything is a string. */
const booleanFlag = z.enum(['true', 'false']).optional();

function flag(value: 'true' | 'false' | undefined): boolean | undefined {
  return value === undefined ? undefined : value === 'true';
}

/** An instant column on the wire. Absent stays absent, never becomes the epoch. */
function isoOrNull(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

/** The window every dated list accepts: `from` inclusive, `to` exclusive. */
const windowQueryFields = {
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
};

function windowOf(input: { from?: string; to?: string }): { from?: Date; to?: Date } {
  return {
    ...(input.from === undefined ? {} : { from: new Date(input.from) }),
    ...(input.to === undefined ? {} : { to: new Date(input.to) }),
  };
}

/**
 * The body of a transition that carries no payload.
 *
 * Declared rather than skipped so that a client which sends a field the route
 * does not read - a status, a note, a timestamp it hoped would be honoured -
 * finds out immediately instead of believing it was applied.
 */
export const emptyBodySchema = z.strictObject({});

export type EmptyBody = z.infer<typeof emptyBodySchema>;

/* -------------------------------------------------------------------- orders */

export const serviceRequestListQuerySchema = z.strictObject({
  ...paginationQueryFields,
  ...windowQueryFields,
  patientId: z.uuid().optional(),
  encounterId: z.uuid().optional(),
  status: z.enum(SERVICE_REQUEST_STATUSES).optional(),
  category: z.enum(SERVICE_REQUEST_CATEGORIES).optional(),
  priority: z.enum(ORDER_PRIORITIES).optional(),
  orderedById: z.uuid().optional(),
  sort: z.enum(['requestedAt', 'scheduledFor', 'createdAt']).default('requestedAt'),
  order: sortOrderField,
});

export type ServiceRequestListQueryInput = z.infer<typeof serviceRequestListQuerySchema>;

export function toServiceRequestListQuery(
  input: ServiceRequestListQueryInput
): ServiceRequestListQuery {
  return {
    page: input.page,
    pageSize: input.pageSize,
    ...windowOf(input),
    ...(input.patientId === undefined ? {} : { patientId: input.patientId }),
    ...(input.encounterId === undefined ? {} : { encounterId: input.encounterId }),
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.category === undefined ? {} : { category: input.category }),
    ...(input.priority === undefined ? {} : { priority: input.priority }),
    ...(input.orderedById === undefined ? {} : { orderedById: input.orderedById }),
    sort: input.sort,
    order: input.order,
  };
}

/**
 * The order amend contract.
 *
 * `status` is absent on purpose: an order moves through `/sign`, `/transmit`
 * and `/cancel`, which is where the transition table lives. A PATCH that could
 * set `TRANSMITTED` would be a way to claim a lab received an order nobody
 * sent.
 */
export const serviceRequestPatchSchema = z
  .strictObject({
    priority: z.enum(ORDER_PRIORITIES).optional(),
    specimenTypeCode: z.string().min(1).max(64).optional(),
    reasonCodes: z.array(z.string().min(1).max(64)).max(64).optional(),
    aoeAnswers: z.record(z.string(), z.unknown()).optional(),
    note: z.string().min(1).max(20_000).optional(),
    requisitionNumber: z.string().min(1).max(64).optional(),
    performingLabName: z.string().min(1).max(256).optional(),
    scheduledFor: z.iso.datetime({ offset: true }).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'the patch must change at least one field',
  });

export type ServiceRequestPatchBody = z.infer<typeof serviceRequestPatchSchema>;

export function toServiceRequestPatchInput(
  body: ServiceRequestPatchBody
): ServiceRequestPatchInput {
  return {
    ...(body.priority === undefined ? {} : { priority: body.priority }),
    ...(body.specimenTypeCode === undefined ? {} : { specimenTypeCode: body.specimenTypeCode }),
    ...(body.reasonCodes === undefined ? {} : { reasonCodes: body.reasonCodes }),
    ...(body.aoeAnswers === undefined ? {} : { aoeAnswers: body.aoeAnswers }),
    ...(body.note === undefined ? {} : { note: body.note }),
    ...(body.requisitionNumber === undefined ? {} : { requisitionNumber: body.requisitionNumber }),
    ...(body.performingLabName === undefined ? {} : { performingLabName: body.performingLabName }),
    ...(body.scheduledFor === undefined ? {} : { scheduledFor: new Date(body.scheduledFor) }),
  };
}

export const serviceRequestDtoSchema = z.strictObject({
  id: z.uuid(),
  patientId: z.uuid(),
  encounterId: z.uuid().nullable(),
  orderedById: z.uuid(),
  category: z.enum(SERVICE_REQUEST_CATEGORIES),
  status: z.enum(SERVICE_REQUEST_STATUSES),
  intent: z.enum(SERVICE_REQUEST_INTENTS),
  priority: z.enum(ORDER_PRIORITIES),
  code: z.string(),
  codeSystem: z.string(),
  display: z.string(),
  specimenTypeCode: z.string().nullable(),
  reasonCodes: z.array(z.string()),
  aoeAnswers: z.record(z.string(), z.unknown()).nullable(),
  note: z.string().nullable(),
  requisitionNumber: z.string().nullable(),
  performingLabName: z.string().nullable(),
  /** Opaque reference from the labs adapter. Never PHI, and never client-set. */
  labRef: z.string().nullable(),
  requestedAt: z.string(),
  scheduledFor: z.string().nullable(),
  transmittedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ServiceRequestDto = z.infer<typeof serviceRequestDtoSchema>;

export function toServiceRequestDto(row: ServiceRequestRow): ServiceRequestDto {
  return {
    id: row.id,
    patientId: row.patientId,
    encounterId: row.encounterId,
    orderedById: row.orderedById,
    category: row.category,
    status: row.status,
    intent: row.intent,
    priority: row.priority,
    code: row.code,
    codeSystem: row.codeSystem,
    display: row.display,
    specimenTypeCode: row.specimenTypeCode,
    reasonCodes: [...row.reasonCodes],
    aoeAnswers: readJsonObject(row.aoeAnswers) ?? null,
    note: row.note,
    requisitionNumber: row.requisitionNumber,
    performingLabName: row.performingLabName,
    labRef: row.labRef,
    requestedAt: row.requestedAt.toISOString(),
    scheduledFor: isoOrNull(row.scheduledFor),
    transmittedAt: isoOrNull(row.transmittedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/* ----------------------------------------------------------------- specimens */

export const specimenListQuerySchema = z.strictObject({
  ...paginationQueryFields,
  patientId: z.uuid().optional(),
  serviceRequestId: z.uuid().optional(),
  status: z.enum(SPECIMEN_STATUSES).optional(),
  accessionNumber: z.string().min(1).max(64).optional(),
  sort: z.enum(['collectedAt', 'createdAt']).default('collectedAt'),
  order: sortOrderField,
});

export type SpecimenListQueryInput = z.infer<typeof specimenListQuerySchema>;

export function toSpecimenListQuery(input: SpecimenListQueryInput): SpecimenListQuery {
  return {
    page: input.page,
    pageSize: input.pageSize,
    ...(input.patientId === undefined ? {} : { patientId: input.patientId }),
    ...(input.serviceRequestId === undefined ? {} : { serviceRequestId: input.serviceRequestId }),
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.accessionNumber === undefined ? {} : { accessionNumber: input.accessionNumber }),
    sort: input.sort,
    order: input.order,
  };
}

/** The specimen amend contract. `status` and `receivedAt` belong to the routes. */
export const specimenPatchSchema = z
  .strictObject({
    accessionNumber: z.string().min(1).max(64).optional(),
    collectionMethodCode: z.string().min(1).max(64).optional(),
    bodySiteCode: z.string().min(1).max(64).optional(),
    collectedAt: z.iso.datetime({ offset: true }).optional(),
    collectedById: z.uuid().optional(),
    containerType: z.string().min(1).max(256).optional(),
    volumeValue: z.number().positive().finite().optional(),
    volumeUnit: z.string().min(1).max(32).optional(),
    note: z.string().min(1).max(20_000).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'the patch must change at least one field',
  });

export type SpecimenPatchBody = z.infer<typeof specimenPatchSchema>;

export function toSpecimenPatchInput(body: SpecimenPatchBody): SpecimenPatchInput {
  return {
    ...(body.accessionNumber === undefined ? {} : { accessionNumber: body.accessionNumber }),
    ...(body.collectionMethodCode === undefined
      ? {}
      : { collectionMethodCode: body.collectionMethodCode }),
    ...(body.bodySiteCode === undefined ? {} : { bodySiteCode: body.bodySiteCode }),
    ...(body.collectedAt === undefined ? {} : { collectedAt: new Date(body.collectedAt) }),
    ...(body.collectedById === undefined ? {} : { collectedById: body.collectedById }),
    ...(body.containerType === undefined ? {} : { containerType: body.containerType }),
    ...(body.volumeValue === undefined ? {} : { volumeValue: body.volumeValue }),
    ...(body.volumeUnit === undefined ? {} : { volumeUnit: body.volumeUnit }),
    ...(body.note === undefined ? {} : { note: body.note }),
  };
}

/**
 * The rejection body, mirroring the refinement in `specimenInput`: a specimen
 * cannot be marked unsatisfactory without recording why, because "rejected" on
 * its own tells the collecting clinician nothing about what to do differently.
 */
export const specimenRejectSchema = z.strictObject({
  rejectionReason: z.string().min(1).max(256),
});

export type SpecimenRejectBody = z.infer<typeof specimenRejectSchema>;

export const specimenDtoSchema = z.strictObject({
  id: z.uuid(),
  patientId: z.uuid(),
  serviceRequestId: z.uuid().nullable(),
  status: z.enum(SPECIMEN_STATUSES),
  accessionNumber: z.string().nullable(),
  typeCode: z.string(),
  typeDisplay: z.string(),
  collectionMethodCode: z.string().nullable(),
  bodySiteCode: z.string().nullable(),
  collectedAt: z.string().nullable(),
  collectedById: z.uuid().nullable(),
  receivedAt: z.string().nullable(),
  containerType: z.string().nullable(),
  volumeValue: z.number().nullable(),
  volumeUnit: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type SpecimenDto = z.infer<typeof specimenDtoSchema>;

export function toSpecimenDto(row: SpecimenRow): SpecimenDto {
  return {
    id: row.id,
    patientId: row.patientId,
    serviceRequestId: row.serviceRequestId,
    status: row.status,
    accessionNumber: row.accessionNumber,
    typeCode: row.typeCode,
    typeDisplay: row.typeDisplay,
    collectionMethodCode: row.collectionMethodCode,
    bodySiteCode: row.bodySiteCode,
    collectedAt: isoOrNull(row.collectedAt),
    collectedById: row.collectedById,
    receivedAt: isoOrNull(row.receivedAt),
    containerType: row.containerType,
    // Already a number: `Row` flattens Decimal columns at the storage boundary.
    volumeValue: row.volumeValue,
    volumeUnit: row.volumeUnit,
    rejectionReason: row.rejectionReason,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/* ------------------------------------------------------------------- reports */

export const diagnosticReportListQuerySchema = z.strictObject({
  ...paginationQueryFields,
  ...windowQueryFields,
  patientId: z.uuid().optional(),
  encounterId: z.uuid().optional(),
  serviceRequestId: z.uuid().optional(),
  status: z.enum(DIAGNOSTIC_REPORT_STATUSES).optional(),
  category: z.enum(SERVICE_REQUEST_CATEGORIES).optional(),
  abnormalFlag: z.enum(ABNORMAL_FLAGS).optional(),
  /** `false` is the sign-off queue: results nobody has acted on yet. */
  reviewed: booleanFlag,
  sort: z.enum(['issuedAt', 'effectiveAt', 'createdAt']).default('issuedAt'),
  order: sortOrderField,
});

export type DiagnosticReportListQueryInput = z.infer<typeof diagnosticReportListQuerySchema>;

export function toDiagnosticReportListQuery(
  input: DiagnosticReportListQueryInput
): DiagnosticReportListQuery {
  const reviewed = flag(input.reviewed);
  return {
    page: input.page,
    pageSize: input.pageSize,
    ...windowOf(input),
    ...(input.patientId === undefined ? {} : { patientId: input.patientId }),
    ...(input.encounterId === undefined ? {} : { encounterId: input.encounterId }),
    ...(input.serviceRequestId === undefined ? {} : { serviceRequestId: input.serviceRequestId }),
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.category === undefined ? {} : { category: input.category }),
    ...(input.abnormalFlag === undefined ? {} : { abnormalFlag: input.abnormalFlag }),
    ...(reviewed === undefined ? {} : { reviewed }),
    sort: input.sort,
    order: input.order,
  };
}

/**
 * The report amend contract.
 *
 * `status` is patchable here, unlike an order's, because a report's statuses
 * are a correction vocabulary rather than a workflow: amending a FINAL report
 * to CORRECTED is the lab telling the chart something changed, and there is no
 * sequence of buttons that has to happen first. The sign-off columns are not
 * here; `/review` owns them.
 */
export const diagnosticReportPatchSchema = z
  .strictObject({
    status: z.enum(DIAGNOSTIC_REPORT_STATUSES).optional(),
    category: z.enum(SERVICE_REQUEST_CATEGORIES).optional(),
    display: z.string().min(1).max(512).optional(),
    performingLabName: z.string().min(1).max(256).optional(),
    abnormalFlag: z.enum(ABNORMAL_FLAGS).optional(),
    narrative: z.string().min(1).max(20_000).optional(),
    rawStorageKey: z.string().min(1).max(1024).optional(),
    effectiveAt: z.iso.datetime({ offset: true }).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'the patch must change at least one field',
  });

export type DiagnosticReportPatchBody = z.infer<typeof diagnosticReportPatchSchema>;

export function toDiagnosticReportPatchInput(
  body: DiagnosticReportPatchBody
): DiagnosticReportPatchInput {
  return {
    ...(body.status === undefined ? {} : { status: body.status }),
    ...(body.category === undefined ? {} : { category: body.category }),
    ...(body.display === undefined ? {} : { display: body.display }),
    ...(body.performingLabName === undefined ? {} : { performingLabName: body.performingLabName }),
    ...(body.abnormalFlag === undefined ? {} : { abnormalFlag: body.abnormalFlag }),
    ...(body.narrative === undefined ? {} : { narrative: body.narrative }),
    ...(body.rawStorageKey === undefined ? {} : { rawStorageKey: body.rawStorageKey }),
    ...(body.effectiveAt === undefined ? {} : { effectiveAt: new Date(body.effectiveAt) }),
  };
}

export const diagnosticReportDtoSchema = z.strictObject({
  id: z.uuid(),
  patientId: z.uuid(),
  encounterId: z.uuid().nullable(),
  serviceRequestId: z.uuid().nullable(),
  specimenId: z.uuid().nullable(),
  status: z.enum(DIAGNOSTIC_REPORT_STATUSES),
  category: z.enum(SERVICE_REQUEST_CATEGORIES),
  code: z.string(),
  codeSystem: z.string(),
  display: z.string(),
  performingLabName: z.string().nullable(),
  abnormalFlag: z.enum(ABNORMAL_FLAGS),
  narrative: z.string().nullable(),
  rawStorageKey: z.string().nullable(),
  effectiveAt: z.string().nullable(),
  issuedAt: z.string(),
  reviewedById: z.uuid().nullable(),
  reviewedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type DiagnosticReportDto = z.infer<typeof diagnosticReportDtoSchema>;

export function toDiagnosticReportDto(row: DiagnosticReportRow): DiagnosticReportDto {
  return {
    id: row.id,
    patientId: row.patientId,
    encounterId: row.encounterId,
    serviceRequestId: row.serviceRequestId,
    specimenId: row.specimenId,
    status: row.status,
    category: row.category,
    code: row.code,
    codeSystem: row.codeSystem,
    display: row.display,
    performingLabName: row.performingLabName,
    abnormalFlag: row.abnormalFlag,
    narrative: row.narrative,
    rawStorageKey: row.rawStorageKey,
    effectiveAt: isoOrNull(row.effectiveAt),
    issuedAt: row.issuedAt.toISOString(),
    reviewedById: row.reviewedById,
    reviewedAt: isoOrNull(row.reviewedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/* ------------------------------------------------------- result observations */

export const resultObservationListQuerySchema = z.strictObject({
  ...paginationQueryFields,
  sort: z.enum(['sequence', 'effectiveAt', 'createdAt']).default('sequence'),
  order: sortOrderField,
});

export type ResultObservationListQueryInput = z.infer<typeof resultObservationListQuerySchema>;

/** The analytes of one report, which is the only way this collection is read. */
export function toResultObservationListQuery(
  input: ResultObservationListQueryInput,
  diagnosticReportId: string
): ResultObservationListQuery {
  return {
    page: input.page,
    pageSize: input.pageSize,
    diagnosticReportId,
    sort: input.sort,
    order: input.order,
  };
}

export const resultObservationDtoSchema = z.strictObject({
  id: z.uuid(),
  diagnosticReportId: z.uuid(),
  patientId: z.uuid(),
  status: z.enum(OBSERVATION_STATUSES),
  sequence: z.int(),
  loincCode: z.string().nullable(),
  code: z.string(),
  codeSystem: z.string(),
  display: z.string(),
  valueNumber: z.number().nullable(),
  valueText: z.string().nullable(),
  valueCode: z.string().nullable(),
  unit: z.string().nullable(),
  referenceLow: z.number().nullable(),
  referenceHigh: z.number().nullable(),
  referenceRangeText: z.string().nullable(),
  interpretationCode: z.string().nullable(),
  abnormalFlag: z.enum(ABNORMAL_FLAGS),
  effectiveAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ResultObservationDto = z.infer<typeof resultObservationDtoSchema>;

export function toResultObservationDto(row: ResultObservationRow): ResultObservationDto {
  return {
    id: row.id,
    diagnosticReportId: row.diagnosticReportId,
    patientId: row.patientId,
    status: row.status,
    sequence: row.sequence,
    loincCode: row.loincCode,
    code: row.code,
    codeSystem: row.codeSystem,
    display: row.display,
    valueNumber: row.valueNumber,
    valueText: row.valueText,
    valueCode: row.valueCode,
    unit: row.unit,
    referenceLow: row.referenceLow,
    referenceHigh: row.referenceHigh,
    referenceRangeText: row.referenceRangeText,
    interpretationCode: row.interpretationCode,
    abnormalFlag: row.abnormalFlag,
    effectiveAt: row.effectiveAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/* ----------------------------------------------------------------- documents */

export const documentListQuerySchema = z.strictObject({
  ...paginationQueryFields,
  ...windowQueryFields,
  patientId: z.uuid().optional(),
  encounterId: z.uuid().optional(),
  status: z.enum(DOCUMENT_STATUSES).optional(),
  category: z.string().min(1).max(64).optional(),
  source: z.enum(DOCUMENT_SOURCES).optional(),
  sort: z.enum(['receivedAt', 'title', 'createdAt']).default('receivedAt'),
  order: sortOrderField,
});

export type DocumentListQueryInput = z.infer<typeof documentListQuerySchema>;

export function toDocumentListQuery(input: DocumentListQueryInput): DocumentListQuery {
  return {
    page: input.page,
    pageSize: input.pageSize,
    ...windowOf(input),
    ...(input.patientId === undefined ? {} : { patientId: input.patientId }),
    ...(input.encounterId === undefined ? {} : { encounterId: input.encounterId }),
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.category === undefined ? {} : { category: input.category }),
    ...(input.source === undefined ? {} : { source: input.source }),
    sort: input.sort,
    order: input.order,
  };
}

/**
 * The document amend contract.
 *
 * Attaching an unfiled fax to a chart is the whole of triage, so `patientId`
 * and `encounterId` are patchable here. The bytes are not: `storageKey`,
 * `sha256` and `byteSize` describe an object that already exists, and letting
 * a client rewrite them would break the integrity check on restore.
 */
export const documentPatchSchema = z
  .strictObject({
    patientId: z.uuid().optional(),
    encounterId: z.uuid().optional(),
    category: z.string().min(1).max(64).optional(),
    title: z.string().min(1).max(256).optional(),
    sensitivityClass: z.enum(SENSITIVITY_CLASSES).optional(),
    expiresAt: z.iso.datetime({ offset: true }).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'the patch must change at least one field',
  });

export type DocumentPatchBody = z.infer<typeof documentPatchSchema>;

export function toDocumentPatchInput(body: DocumentPatchBody): DocumentPatchInput {
  return {
    ...(body.patientId === undefined ? {} : { patientId: body.patientId }),
    ...(body.encounterId === undefined ? {} : { encounterId: body.encounterId }),
    ...(body.category === undefined ? {} : { category: body.category }),
    ...(body.title === undefined ? {} : { title: body.title }),
    ...(body.sensitivityClass === undefined ? {} : { sensitivityClass: body.sensitivityClass }),
    ...(body.expiresAt === undefined ? {} : { expiresAt: new Date(body.expiresAt) }),
  };
}

export const documentDtoSchema = z.strictObject({
  id: z.uuid(),
  patientId: z.uuid().nullable(),
  encounterId: z.uuid().nullable(),
  category: z.string(),
  title: z.string(),
  /** Object-storage key. The bytes themselves never travel through this API. */
  storageKey: z.string(),
  contentType: z.string(),
  sha256: z.string(),
  byteSize: z.int(),
  source: z.enum(DOCUMENT_SOURCES),
  status: z.enum(DOCUMENT_STATUSES),
  sensitivityClass: z.enum(SENSITIVITY_CLASSES),
  receivedAt: z.string(),
  filedAt: z.string().nullable(),
  filedById: z.uuid().nullable(),
  expiresAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type DocumentDto = z.infer<typeof documentDtoSchema>;

export function toDocumentDto(row: DocumentRow): DocumentDto {
  return {
    id: row.id,
    patientId: row.patientId,
    encounterId: row.encounterId,
    category: row.category,
    title: row.title,
    storageKey: row.storageKey,
    contentType: row.contentType,
    sha256: row.sha256,
    byteSize: row.byteSize,
    source: row.source,
    status: row.status,
    sensitivityClass: row.sensitivityClass,
    receivedAt: row.receivedAt.toISOString(),
    filedAt: isoOrNull(row.filedAt),
    filedById: row.filedById,
    expiresAt: isoOrNull(row.expiresAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/* --------------------------------------------------------------------- tasks */

export const taskListQuerySchema = z.strictObject({
  ...paginationQueryFields,
  ...windowQueryFields,
  type: z.enum(TASK_TYPES).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  patientId: z.uuid().optional(),
  assigneeUserId: z.uuid().optional(),
  assigneeTeamKey: z.string().min(1).max(64).optional(),
  slaState: z.enum(TASK_SLA_STATES).optional(),
  sort: z.enum(['dueAt', 'priority', 'createdAt']).default('dueAt'),
  order: sortOrderField,
});

export type TaskListQueryInput = z.infer<typeof taskListQuerySchema>;

export function toTaskListQuery(input: TaskListQueryInput): TaskListQuery {
  return {
    page: input.page,
    pageSize: input.pageSize,
    ...windowOf(input),
    ...(input.type === undefined ? {} : { type: input.type }),
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.priority === undefined ? {} : { priority: input.priority }),
    ...(input.patientId === undefined ? {} : { patientId: input.patientId }),
    ...(input.assigneeUserId === undefined ? {} : { assigneeUserId: input.assigneeUserId }),
    ...(input.assigneeTeamKey === undefined ? {} : { assigneeTeamKey: input.assigneeTeamKey }),
    ...(input.slaState === undefined ? {} : { slaState: input.slaState }),
    sort: input.sort,
    order: input.order,
  };
}

/**
 * The task amend contract: reassignment, re-prioritisation and rescheduling.
 *
 * The refinement is the model's own rule restated at the boundary. A task with
 * both an assignee user and an assignee team, or with neither, disappears from
 * every inbox filter, and the moment that can happen is the moment somebody
 * reassigns one.
 */
export const taskPatchSchema = z
  .strictObject({
    priority: z.enum(TASK_PRIORITIES).optional(),
    title: z.string().min(1).max(256).optional(),
    description: z.string().min(1).max(20_000).optional(),
    assigneeType: z.enum(TASK_ASSIGNEE_TYPES).optional(),
    assigneeUserId: z.uuid().optional(),
    assigneeTeamKey: z.string().min(1).max(64).optional(),
    dueAt: z.iso.datetime({ offset: true }).optional(),
    slaState: z.enum(TASK_SLA_STATES).optional(),
    expiresAt: z.iso.datetime({ offset: true }).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'the patch must change at least one field',
  })
  .refine(
    (value) =>
      value.assigneeType === undefined ||
      (value.assigneeType === 'USER'
        ? value.assigneeUserId !== undefined
        : value.assigneeTeamKey !== undefined),
    { message: 'reassigning must name the assignee the new type uses' }
  );

export type TaskPatchBody = z.infer<typeof taskPatchSchema>;

export function toTaskPatchInput(body: TaskPatchBody): TaskPatchInput {
  return {
    ...(body.priority === undefined ? {} : { priority: body.priority }),
    ...(body.title === undefined ? {} : { title: body.title }),
    ...(body.description === undefined ? {} : { description: body.description }),
    ...(body.assigneeType === undefined ? {} : { assigneeType: body.assigneeType }),
    ...(body.assigneeUserId === undefined ? {} : { assigneeUserId: body.assigneeUserId }),
    ...(body.assigneeTeamKey === undefined ? {} : { assigneeTeamKey: body.assigneeTeamKey }),
    ...(body.dueAt === undefined ? {} : { dueAt: new Date(body.dueAt) }),
    ...(body.slaState === undefined ? {} : { slaState: body.slaState }),
    ...(body.expiresAt === undefined ? {} : { expiresAt: new Date(body.expiresAt) }),
  };
}

/** What closing a task records. The outcome is what the next reader wants. */
export const taskCompleteSchema = z.strictObject({
  outcome: z.string().min(1).max(256).optional(),
});

export type TaskCompleteBody = z.infer<typeof taskCompleteSchema>;

export const taskDtoSchema = z.strictObject({
  id: z.uuid(),
  type: z.enum(TASK_TYPES),
  status: z.enum(TASK_STATUSES),
  priority: z.enum(TASK_PRIORITIES),
  patientId: z.uuid().nullable(),
  encounterId: z.uuid().nullable(),
  subjectType: z.string().nullable(),
  subjectId: z.uuid().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  assigneeType: z.enum(TASK_ASSIGNEE_TYPES),
  assigneeUserId: z.uuid().nullable(),
  assigneeTeamKey: z.string().nullable(),
  dueAt: z.string().nullable(),
  slaState: z.enum(TASK_SLA_STATES),
  expiresAt: z.string().nullable(),
  sourceEventId: z.string().nullable(),
  completedAt: z.string().nullable(),
  completedById: z.uuid().nullable(),
  outcome: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type TaskDto = z.infer<typeof taskDtoSchema>;

export function toTaskDto(row: TaskRow): TaskDto {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    priority: row.priority,
    patientId: row.patientId,
    encounterId: row.encounterId,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    title: row.title,
    description: row.description,
    assigneeType: row.assigneeType,
    assigneeUserId: row.assigneeUserId,
    assigneeTeamKey: row.assigneeTeamKey,
    dueAt: isoOrNull(row.dueAt),
    slaState: row.slaState,
    expiresAt: isoOrNull(row.expiresAt),
    sourceEventId: row.sourceEventId,
    completedAt: isoOrNull(row.completedAt),
    completedById: row.completedById,
    outcome: row.outcome,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/* ---------------------------------------------------------- message threads */

/**
 * The thread create contract.
 *
 * `MessageThread` has no schema in `@openrunic/database`, so it is written
 * here to the same conventions: a `strictObject`, no `id`, no `tenantId`, no
 * timestamps, and closed value sets taken from the package's exported tuples
 * rather than restated as string literals.
 *
 * The refinement is what keeps the portal honest. A `PATIENT` thread that
 * names no patient is a conversation about a chart that nobody can file, and
 * the portal would never find it again.
 */
export const messageThreadCreateSchema = z
  .strictObject({
    kind: z.enum(THREAD_KINDS).optional(),
    patientId: z.uuid().optional(),
    subject: z.string().min(1).max(256),
  })
  .refine((value) => value.kind !== 'PATIENT' || value.patientId !== undefined, {
    message: 'a patient thread must name the chart it belongs to',
    path: ['patientId'],
  });

export type MessageThreadCreateBody = z.infer<typeof messageThreadCreateSchema>;

export function toMessageThreadCreateInput(
  body: MessageThreadCreateBody
): MessageThreadCreateInput {
  return {
    ...(body.kind === undefined ? {} : { kind: body.kind }),
    ...(body.patientId === undefined ? {} : { patientId: body.patientId }),
    subject: body.subject,
  };
}

export const messageThreadListQuerySchema = z.strictObject({
  ...paginationQueryFields,
  kind: z.enum(THREAD_KINDS).optional(),
  patientId: z.uuid().optional(),
  /** `true` is the working inbox; `false` is the archive. */
  open: booleanFlag,
  sort: z.enum(['lastMessageAt', 'subject', 'createdAt']).default('lastMessageAt'),
  order: sortOrderField,
});

export type MessageThreadListQueryInput = z.infer<typeof messageThreadListQuerySchema>;

export function toMessageThreadListQuery(
  input: MessageThreadListQueryInput
): MessageThreadListQuery {
  const open = flag(input.open);
  return {
    page: input.page,
    pageSize: input.pageSize,
    ...(input.kind === undefined ? {} : { kind: input.kind }),
    ...(input.patientId === undefined ? {} : { patientId: input.patientId }),
    ...(open === undefined ? {} : { open }),
    sort: input.sort,
    order: input.order,
  };
}

/** The thread amend contract. `/close` owns `closedAt`; posting owns the rest. */
export const messageThreadPatchSchema = z
  .strictObject({
    kind: z.enum(THREAD_KINDS).optional(),
    subject: z.string().min(1).max(256).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'the patch must change at least one field',
  });

export type MessageThreadPatchBody = z.infer<typeof messageThreadPatchSchema>;

export function toMessageThreadPatchInput(body: MessageThreadPatchBody): MessageThreadPatchInput {
  return {
    ...(body.kind === undefined ? {} : { kind: body.kind }),
    ...(body.subject === undefined ? {} : { subject: body.subject }),
  };
}

export const messageThreadDtoSchema = z.strictObject({
  id: z.uuid(),
  kind: z.enum(THREAD_KINDS),
  patientId: z.uuid().nullable(),
  subject: z.string(),
  lastMessageAt: z.string().nullable(),
  closedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type MessageThreadDto = z.infer<typeof messageThreadDtoSchema>;

export function toMessageThreadDto(row: MessageThreadRow): MessageThreadDto {
  return {
    id: row.id,
    kind: row.kind,
    patientId: row.patientId,
    subject: row.subject,
    lastMessageAt: isoOrNull(row.lastMessageAt),
    closedAt: isoOrNull(row.closedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/* ------------------------------------------------------------------ messages */

/**
 * Posting to a thread.
 *
 * The body is the only thing a client supplies: the sender is read off the
 * verified principal, never off the request, because a message whose author a
 * client could choose is a message the audit trail cannot attribute.
 */
export const messagePostSchema = z.strictObject({
  body: z.string().min(1).max(20_000),
});

export type MessagePostBody = z.infer<typeof messagePostSchema>;

export const messageListQuerySchema = z.strictObject({
  ...paginationQueryFields,
  sort: z.enum(['sentAt', 'createdAt']).default('sentAt'),
  order: sortOrderField,
});

export type MessageListQueryInput = z.infer<typeof messageListQuerySchema>;

/** One thread's messages, which is the only way this collection is read. */
export function toMessageListQuery(
  input: MessageListQueryInput,
  threadId: string
): MessageListQuery {
  return {
    page: input.page,
    pageSize: input.pageSize,
    threadId,
    sort: input.sort,
    order: input.order,
  };
}

export const messageDtoSchema = z.strictObject({
  id: z.uuid(),
  threadId: z.uuid(),
  senderType: z.enum(MESSAGE_SENDER_TYPES),
  senderUserId: z.uuid().nullable(),
  senderPatientId: z.uuid().nullable(),
  body: z.string(),
  sentAt: z.string(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type MessageDto = z.infer<typeof messageDtoSchema>;

export function toMessageDto(row: MessageRow): MessageDto {
  return {
    id: row.id,
    threadId: row.threadId,
    senderType: row.senderType,
    senderUserId: row.senderUserId,
    senderPatientId: row.senderPatientId,
    body: row.body,
    sentAt: row.sentAt.toISOString(),
    readAt: isoOrNull(row.readAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
