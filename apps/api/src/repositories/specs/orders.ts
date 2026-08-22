import type {
  ABNORMAL_FLAGS,
  DIAGNOSTIC_REPORT_STATUSES,
  DiagnosticReportInput,
  DOCUMENT_SOURCES,
  DOCUMENT_STATUSES,
  DocumentInput,
  MESSAGE_SENDER_TYPES,
  OBSERVATION_STATUSES,
  ORDER_PRIORITIES,
  ResultObservationInput,
  SENSITIVITY_CLASSES,
  SERVICE_REQUEST_CATEGORIES,
  SERVICE_REQUEST_INTENTS,
  SERVICE_REQUEST_STATUSES,
  ServiceRequestInput,
  SPECIMEN_STATUSES,
  SpecimenInput,
  TASK_ASSIGNEE_TYPES,
  TASK_PRIORITIES,
  TASK_SLA_STATES,
  TASK_STATUSES,
  TASK_TYPES,
  TaskInput,
  THREAD_KINDS,
} from '@openrunic/database';

import {
  childBatch,
  comparable,
  inWindow,
  jsonColumn,
  windowFilter,
  type BaseQuery,
  type ChildBatch,
  type CollectionSpec,
  type RowContext,
  type Writable,
} from '../collection.js';
import type { ScopedRow } from '../rows.js';
import type { ImagingStudyStatus } from '../types.js';

/**
 * Orders, results and the worklists they feed.
 *
 * The through-line of this file is that an order is a state machine and
 * everything downstream of it is evidence: a specimen is what was collected for
 * one, a report is what came back, a document is the form it arrived on, and a
 * task is the piece of work the arrival created. So the specs here carry more
 * status columns than the registration aggregates do, and none of those columns
 * is patchable through the plain amend route - the transitions live in
 * `routes/orders.ts`, where the table that governs them can be read as data.
 *
 * The composite one is {@link diagnosticReportSpec}. A report's discrete
 * analytes are written with it, in its transaction, because a report whose
 * analytes arrive in a second request is a report whose totals lie for as long
 * as the gap lasts.
 */

/* ------------------------------------------------------------- shared types */

export type ServiceRequestStatus = (typeof SERVICE_REQUEST_STATUSES)[number];
export type ServiceRequestCategory = (typeof SERVICE_REQUEST_CATEGORIES)[number];
export type ServiceRequestIntent = (typeof SERVICE_REQUEST_INTENTS)[number];
export type OrderPriority = (typeof ORDER_PRIORITIES)[number];
export type SpecimenStatus = (typeof SPECIMEN_STATUSES)[number];
export type DiagnosticReportStatus = (typeof DIAGNOSTIC_REPORT_STATUSES)[number];
export type ObservationStatus = (typeof OBSERVATION_STATUSES)[number];
export type AbnormalFlag = (typeof ABNORMAL_FLAGS)[number];
export type DocumentSource = (typeof DOCUMENT_SOURCES)[number];
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];
export type OrderSensitivityClass = (typeof SENSITIVITY_CLASSES)[number];
export type TaskType = (typeof TASK_TYPES)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export type TaskAssigneeType = (typeof TASK_ASSIGNEE_TYPES)[number];
export type TaskSlaState = (typeof TASK_SLA_STATES)[number];
export type ThreadKind = (typeof THREAD_KINDS)[number];
export type MessageSenderType = (typeof MESSAGE_SENDER_TYPES)[number];

/** The stored rows, as the API reads them. */
export type ServiceRequestRow = ScopedRow<'ServiceRequest'>;
export type SpecimenRow = ScopedRow<'Specimen'>;
export type DiagnosticReportRow = ScopedRow<'DiagnosticReport'>;
export type ResultObservationRow = ScopedRow<'ResultObservation'>;
export type DocumentRow = ScopedRow<'Document'>;
export type TaskRow = ScopedRow<'Task'>;
export type MessageThreadRow = ScopedRow<'MessageThread'>;
export type MessageRow = ScopedRow<'Message'>;

/**
 * Column defaults, mirrored by hand from `schema.prisma`.
 *
 * Postgres applies these at runtime; the in-memory repository has no Postgres,
 * so it applies them from here. Keeping one copy per column is what stops the
 * test suite from passing against defaults the database does not actually have.
 * Only the defaults a create can reach are listed: a column whose write
 * contract makes the field mandatory never falls back to one.
 */
const ORDER_DEFAULTS = {
  serviceRequest: {
    category: 'LAB',
    status: 'DRAFT',
    intent: 'ORDER',
    priority: 'ROUTINE',
  },
  specimen: { status: 'AVAILABLE' },
  diagnosticReport: {
    status: 'FINAL',
    category: 'LAB',
    codeSystem: 'http://loinc.org',
    abnormalFlag: 'NORMAL',
  },
  resultObservation: {
    status: 'FINAL',
    codeSystem: 'http://loinc.org',
    abnormalFlag: 'NORMAL',
  },
  document: { source: 'UPLOAD', status: 'INBOX', sensitivityClass: 'NORMAL' },
  task: { status: 'OPEN', priority: 'NORMAL', slaState: 'OK' },
  messageThread: { kind: 'STAFF' },
  message: { senderType: 'USER' },
} as const;

/**
 * A filter that matches no row.
 *
 * The natural keys below are conditional: a specimen with no accession number
 * and a task with no source event cannot collide with anything, because each
 * unique index covers a nullable column and Postgres treats NULLs as distinct.
 * Filtering on `null` instead would find the other rows that also left the
 * column empty and report a duplicate the database would happily have
 * accepted, so the no-key case has to ask for nothing at all.
 */
function matchesNothing(): { in: string[] } {
  return { in: [] };
}

/**
 * The status metadata every stateful aggregate puts on its write event.
 *
 * A create records the state a record was born in; an amendment records the
 * move only when there was one, so the audit trail reads as a list of
 * transitions rather than a list of saves.
 */
function statusMetadata(
  status: string,
  before: { status: string } | null
): Record<string, unknown> {
  if (before === null) return { status };
  return before.status === status ? {} : { statusFrom: before.status, statusTo: status };
}

/* -------------------------------------------------------------------- orders */

export interface ServiceRequestListQuery extends BaseQuery {
  patientId?: string;
  encounterId?: string;
  status?: ServiceRequestStatus;
  category?: ServiceRequestCategory;
  priority?: OrderPriority;
  orderedById?: string;
  /** Inclusive lower bound on `requestedAt`. */
  from?: Date;
  /** Exclusive upper bound on `requestedAt`. */
  to?: Date;
  sort: 'requestedAt' | 'scheduledFor' | 'createdAt';
}

/**
 * Fields an order amendment may change.
 *
 * `status` and `transmittedAt` are here for the transition handlers and are
 * absent from the HTTP patch contract: an order's state moves through
 * `/sign`, `/transmit` and `/cancel`, which is where the table that governs
 * those moves is written down.
 */
export interface ServiceRequestPatchInput {
  status?: ServiceRequestStatus;
  priority?: OrderPriority;
  specimenTypeCode?: string;
  reasonCodes?: readonly string[];
  aoeAnswers?: Record<string, unknown>;
  note?: string;
  requisitionNumber?: string;
  performingLabName?: string;
  scheduledFor?: Date;
  transmittedAt?: Date;
}

export const serviceRequestSpec: CollectionSpec<
  'ServiceRequest',
  ServiceRequestInput,
  ServiceRequestPatchInput,
  ServiceRequestListQuery
> = {
  model: 'ServiceRequest',
  targetType: 'ServiceRequest',
  action: 'order',
  patientColumn: 'patientId',
  encounterColumn: 'encounterId',
  compartment: { column: 'patientId' },

  newRow(input: ServiceRequestInput, context: RowContext): Writable<'ServiceRequest'> {
    return {
      patientId: input.patientId,
      encounterId: input.encounterId ?? null,
      orderedById: input.orderedById,
      category: input.category ?? ORDER_DEFAULTS.serviceRequest.category,
      status: input.status ?? ORDER_DEFAULTS.serviceRequest.status,
      intent: input.intent ?? ORDER_DEFAULTS.serviceRequest.intent,
      priority: input.priority ?? ORDER_DEFAULTS.serviceRequest.priority,
      code: input.code,
      codeSystem: input.codeSystem,
      display: input.display,
      specimenTypeCode: input.specimenTypeCode ?? null,
      reasonCodes: [...(input.reasonCodes ?? [])],
      aoeAnswers: jsonColumn(input.aoeAnswers),
      note: input.note ?? null,
      requisitionNumber: input.requisitionNumber ?? null,
      performingLabName: input.performingLabName ?? null,
      // The labs adapter owns this column; an order is never created with one.
      labRef: null,
      requestedAt: context.now,
      scheduledFor: input.scheduledFor ?? null,
      transmittedAt: null,
    };
  },

  patchData(patch: ServiceRequestPatchInput): Partial<Writable<'ServiceRequest'>> {
    // Every present key is a key the client asked to change; an absent key must
    // stay absent, because writing null for it would turn "not mentioned" into
    // "clear this column". The two repeating columns are rebuilt rather than
    // copied: a caller's array is its own, and the row must not alias it.
    const { reasonCodes, aoeAnswers, ...rest } = patch;
    const data: Partial<Writable<'ServiceRequest'>> = Object.fromEntries(
      Object.entries(rest).filter(([, value]) => value !== undefined)
    );
    if (reasonCodes !== undefined) data.reasonCodes = [...reasonCodes];
    if (aoeAnswers !== undefined) data.aoeAnswers = jsonColumn(aoeAnswers);
    return data;
  },

  matches(row: ServiceRequestRow, query: ServiceRequestListQuery): boolean {
    if (query.patientId !== undefined && row.patientId !== query.patientId) return false;
    if (query.encounterId !== undefined && row.encounterId !== query.encounterId) return false;
    if (query.status !== undefined && row.status !== query.status) return false;
    if (query.category !== undefined && row.category !== query.category) return false;
    if (query.priority !== undefined && row.priority !== query.priority) return false;
    if (query.orderedById !== undefined && row.orderedById !== query.orderedById) return false;
    return inWindow(row.requestedAt, query.from, query.to);
  },

  where(query: ServiceRequestListQuery) {
    const requestedAt = windowFilter(query.from, query.to);
    return {
      ...(query.patientId === undefined ? {} : { patientId: query.patientId }),
      ...(query.encounterId === undefined ? {} : { encounterId: query.encounterId }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.category === undefined ? {} : { category: query.category }),
      ...(query.priority === undefined ? {} : { priority: query.priority }),
      ...(query.orderedById === undefined ? {} : { orderedById: query.orderedById }),
      ...(requestedAt === undefined ? {} : { requestedAt }),
    };
  },

  sortValue(row: ServiceRequestRow, sort: ServiceRequestListQuery['sort']): number | string {
    if (sort === 'createdAt') return row.createdAt.getTime();
    if (sort === 'scheduledFor') return comparable(row.scheduledFor);
    return row.requestedAt.getTime();
  },

  orderBy(query: ServiceRequestListQuery) {
    const { order } = query;
    if (query.sort === 'createdAt') return [{ createdAt: order }, { id: 'asc' as const }];
    if (query.sort === 'scheduledFor') return [{ scheduledFor: order }, { id: 'asc' as const }];
    return [{ requestedAt: order }, { id: 'asc' as const }];
  },

  writeMetadata(row: ServiceRequestRow, before: ServiceRequestRow | null): Record<string, unknown> {
    return { code: row.code, ...statusMetadata(row.status, before) };
  },
};

/* ----------------------------------------------------------------- specimens */

export interface SpecimenListQuery extends BaseQuery {
  patientId?: string;
  serviceRequestId?: string;
  status?: SpecimenStatus;
  accessionNumber?: string;
  sort: 'collectedAt' | 'createdAt';
}

/** Fields a specimen amendment may change. `receivedAt` belongs to `/receive`. */
export interface SpecimenPatchInput {
  status?: SpecimenStatus;
  accessionNumber?: string;
  collectionMethodCode?: string;
  bodySiteCode?: string;
  collectedAt?: Date;
  collectedById?: string;
  receivedAt?: Date;
  containerType?: string;
  volumeValue?: number;
  volumeUnit?: string;
  rejectionReason?: string;
  note?: string;
}

export const specimenSpec: CollectionSpec<
  'Specimen',
  SpecimenInput,
  SpecimenPatchInput,
  SpecimenListQuery
> = {
  model: 'Specimen',
  targetType: 'Specimen',
  action: 'specimen',
  patientColumn: 'patientId',
  compartment: { column: 'patientId' },

  newRow(input: SpecimenInput): Writable<'Specimen'> {
    return {
      patientId: input.patientId,
      serviceRequestId: input.serviceRequestId ?? null,
      status: input.status ?? ORDER_DEFAULTS.specimen.status,
      accessionNumber: input.accessionNumber ?? null,
      typeCode: input.typeCode,
      typeDisplay: input.typeDisplay,
      collectionMethodCode: input.collectionMethodCode ?? null,
      bodySiteCode: input.bodySiteCode ?? null,
      collectedAt: input.collectedAt ?? null,
      collectedById: input.collectedById ?? null,
      receivedAt: input.receivedAt ?? null,
      containerType: input.containerType ?? null,
      volumeValue: input.volumeValue ?? null,
      volumeUnit: input.volumeUnit ?? null,
      rejectionReason: input.rejectionReason ?? null,
      note: input.note ?? null,
    };
  },

  patchData(patch: SpecimenPatchInput): Partial<Writable<'Specimen'>> {
    return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
  },

  matches(row: SpecimenRow, query: SpecimenListQuery): boolean {
    if (query.patientId !== undefined && row.patientId !== query.patientId) return false;
    if (query.serviceRequestId !== undefined && row.serviceRequestId !== query.serviceRequestId) {
      return false;
    }
    if (query.status !== undefined && row.status !== query.status) return false;
    return query.accessionNumber === undefined || row.accessionNumber === query.accessionNumber;
  },

  where(query: SpecimenListQuery) {
    return {
      ...(query.patientId === undefined ? {} : { patientId: query.patientId }),
      ...(query.serviceRequestId === undefined ? {} : { serviceRequestId: query.serviceRequestId }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.accessionNumber === undefined ? {} : { accessionNumber: query.accessionNumber }),
    };
  },

  sortValue(row: SpecimenRow, sort: SpecimenListQuery['sort']): number | string {
    return sort === 'createdAt' ? row.createdAt.getTime() : comparable(row.collectedAt);
  },

  orderBy(query: SpecimenListQuery) {
    if (query.sort === 'createdAt') return [{ createdAt: query.order }, { id: 'asc' as const }];
    return [{ collectedAt: query.order }, { id: 'asc' as const }];
  },

  writeMetadata(row: SpecimenRow, before: SpecimenRow | null): Record<string, unknown> {
    return statusMetadata(row.status, before);
  },

  /**
   * `@@unique([tenantId, accessionNumber])`. An accession number is what a lab
   * and a chart agree a tube is, so two rows claiming the same one is a
   * mis-labelling incident rather than a save to retry.
   */
  uniqueBy: {
    where: (input: SpecimenInput) => ({
      accessionNumber: input.accessionNumber ?? matchesNothing(),
    }),
    matches: (row: SpecimenRow, input: SpecimenInput) =>
      input.accessionNumber !== undefined && row.accessionNumber === input.accessionNumber,
    message: (input: SpecimenInput) =>
      `A specimen with accession number ${input.accessionNumber ?? ''} already exists.`,
  },
};

/* ------------------------------------------------------------------- reports */

export interface DiagnosticReportListQuery extends BaseQuery {
  patientId?: string;
  encounterId?: string;
  serviceRequestId?: string;
  status?: DiagnosticReportStatus;
  category?: ServiceRequestCategory;
  abnormalFlag?: AbnormalFlag;
  /** True selects the reports somebody has signed off, false the sign-off queue. */
  reviewed?: boolean;
  /** Inclusive lower bound on `issuedAt`. */
  from?: Date;
  /** Exclusive upper bound on `issuedAt`. */
  to?: Date;
  sort: 'issuedAt' | 'effectiveAt' | 'createdAt';
}

/** Fields a report amendment may change. `/review` owns the sign-off columns. */
export interface DiagnosticReportPatchInput {
  status?: DiagnosticReportStatus;
  category?: ServiceRequestCategory;
  display?: string;
  performingLabName?: string;
  abnormalFlag?: AbnormalFlag;
  narrative?: string;
  rawStorageKey?: string;
  effectiveAt?: Date;
  reviewedAt?: Date;
  reviewedById?: string;
}

export const diagnosticReportSpec: CollectionSpec<
  'DiagnosticReport',
  DiagnosticReportInput,
  DiagnosticReportPatchInput,
  DiagnosticReportListQuery
> = {
  model: 'DiagnosticReport',
  targetType: 'DiagnosticReport',
  action: 'result',
  patientColumn: 'patientId',
  encounterColumn: 'encounterId',
  compartment: { column: 'patientId' },

  newRow(input: DiagnosticReportInput, context: RowContext): Writable<'DiagnosticReport'> {
    return {
      patientId: input.patientId,
      encounterId: input.encounterId ?? null,
      serviceRequestId: input.serviceRequestId ?? null,
      specimenId: input.specimenId ?? null,
      status: input.status ?? ORDER_DEFAULTS.diagnosticReport.status,
      category: input.category ?? ORDER_DEFAULTS.diagnosticReport.category,
      code: input.code,
      codeSystem: input.codeSystem ?? ORDER_DEFAULTS.diagnosticReport.codeSystem,
      display: input.display,
      performingLabName: input.performingLabName ?? null,
      abnormalFlag: input.abnormalFlag ?? ORDER_DEFAULTS.diagnosticReport.abnormalFlag,
      narrative: input.narrative ?? null,
      rawStorageKey: input.rawStorageKey ?? null,
      effectiveAt: input.effectiveAt ?? null,
      issuedAt: input.issuedAt ?? context.now,
      reviewedById: null,
      reviewedAt: null,
    };
  },

  /**
   * The analytes, written with the report rather than after it.
   *
   * A report is a container: its abnormal flag, its panel and its narrative all
   * describe values that live in these rows. Writing them in the report's
   * transaction is what makes the container true the moment it exists, instead
   * of true once a second request happens to arrive.
   */
  childRows(
    input: DiagnosticReportInput,
    parent: DiagnosticReportRow,
    context: RowContext
  ): ChildBatch[] {
    const results = input.results ?? [];
    if (results.length === 0) return [];
    return [
      childBatch(
        'ResultObservation',
        results.map((result) => ({
          id: context.nextId(),
          ...observationColumns(result, parent.id, parent.patientId),
        }))
      ),
    ];
  },

  patchData(patch: DiagnosticReportPatchInput): Partial<Writable<'DiagnosticReport'>> {
    return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
  },

  matches(row: DiagnosticReportRow, query: DiagnosticReportListQuery): boolean {
    if (query.patientId !== undefined && row.patientId !== query.patientId) return false;
    if (query.encounterId !== undefined && row.encounterId !== query.encounterId) return false;
    if (query.serviceRequestId !== undefined && row.serviceRequestId !== query.serviceRequestId) {
      return false;
    }
    if (query.status !== undefined && row.status !== query.status) return false;
    if (query.category !== undefined && row.category !== query.category) return false;
    if (query.abnormalFlag !== undefined && row.abnormalFlag !== query.abnormalFlag) return false;
    if (query.reviewed !== undefined && (row.reviewedAt !== null) !== query.reviewed) return false;
    return inWindow(row.issuedAt, query.from, query.to);
  },

  where(query: DiagnosticReportListQuery) {
    const issuedAt = windowFilter(query.from, query.to);
    return {
      ...(query.patientId === undefined ? {} : { patientId: query.patientId }),
      ...(query.encounterId === undefined ? {} : { encounterId: query.encounterId }),
      ...(query.serviceRequestId === undefined ? {} : { serviceRequestId: query.serviceRequestId }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.category === undefined ? {} : { category: query.category }),
      ...(query.abnormalFlag === undefined ? {} : { abnormalFlag: query.abnormalFlag }),
      ...(query.reviewed === undefined
        ? {}
        : { reviewedAt: query.reviewed ? { not: null } : null }),
      ...(issuedAt === undefined ? {} : { issuedAt }),
    };
  },

  sortValue(row: DiagnosticReportRow, sort: DiagnosticReportListQuery['sort']): number | string {
    if (sort === 'createdAt') return row.createdAt.getTime();
    if (sort === 'effectiveAt') return comparable(row.effectiveAt);
    return row.issuedAt.getTime();
  },

  orderBy(query: DiagnosticReportListQuery) {
    const { order } = query;
    if (query.sort === 'createdAt') return [{ createdAt: order }, { id: 'asc' as const }];
    if (query.sort === 'effectiveAt') return [{ effectiveAt: order }, { id: 'asc' as const }];
    return [{ issuedAt: order }, { id: 'asc' as const }];
  },

  writeMetadata(
    row: DiagnosticReportRow,
    before: DiagnosticReportRow | null
  ): Record<string, unknown> {
    // The abnormal flag rides along on every result event because it is the
    // field an after-hours review of the audit log is actually looking for.
    return { abnormalFlag: row.abnormalFlag, ...statusMetadata(row.status, before) };
  },
};

/* ------------------------------------------------------- result observations */

/**
 * An analyte, as the repository takes it.
 *
 * The two columns the write contract omits are the ones a caller must never
 * choose: an observation belongs to the report it arrived in and to that
 * report's chart, and both are read off the parent rather than the request.
 */
export interface ResultObservationCreateInput extends ResultObservationInput {
  diagnosticReportId: string;
  patientId: string;
}

export interface ResultObservationListQuery extends BaseQuery {
  diagnosticReportId?: string;
  patientId?: string;
  loincCode?: string;
  abnormalFlag?: AbnormalFlag;
  sort: 'sequence' | 'effectiveAt' | 'createdAt';
}

export interface ResultObservationPatchInput {
  status?: ObservationStatus;
  interpretationCode?: string;
  abnormalFlag?: AbnormalFlag;
  referenceRangeText?: string;
}

/** The analyte columns, shared by the nested write and the standalone one. */
function observationColumns(
  input: ResultObservationInput,
  diagnosticReportId: string,
  patientId: string
): Writable<'ResultObservation'> {
  return {
    diagnosticReportId,
    patientId,
    status: input.status ?? ORDER_DEFAULTS.resultObservation.status,
    sequence: input.sequence,
    loincCode: input.loincCode ?? null,
    code: input.code,
    codeSystem: input.codeSystem ?? ORDER_DEFAULTS.resultObservation.codeSystem,
    display: input.display,
    valueNumber: input.valueNumber ?? null,
    valueText: input.valueText ?? null,
    valueCode: input.valueCode ?? null,
    unit: input.unit ?? null,
    referenceLow: input.referenceLow ?? null,
    referenceHigh: input.referenceHigh ?? null,
    referenceRangeText: input.referenceRangeText ?? null,
    interpretationCode: input.interpretationCode ?? null,
    abnormalFlag: input.abnormalFlag ?? ORDER_DEFAULTS.resultObservation.abnormalFlag,
    effectiveAt: input.effectiveAt,
  };
}

export const resultObservationSpec: CollectionSpec<
  'ResultObservation',
  ResultObservationCreateInput,
  ResultObservationPatchInput,
  ResultObservationListQuery
> = {
  model: 'ResultObservation',
  targetType: 'ResultObservation',
  action: 'resultObservation',
  patientColumn: 'patientId',
  compartment: { column: 'patientId' },

  newRow(input: ResultObservationCreateInput): Writable<'ResultObservation'> {
    return observationColumns(input, input.diagnosticReportId, input.patientId);
  },

  patchData(patch: ResultObservationPatchInput): Partial<Writable<'ResultObservation'>> {
    return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
  },

  matches(row: ResultObservationRow, query: ResultObservationListQuery): boolean {
    if (
      query.diagnosticReportId !== undefined &&
      row.diagnosticReportId !== query.diagnosticReportId
    ) {
      return false;
    }
    if (query.patientId !== undefined && row.patientId !== query.patientId) return false;
    if (query.loincCode !== undefined && row.loincCode !== query.loincCode) return false;
    return query.abnormalFlag === undefined || row.abnormalFlag === query.abnormalFlag;
  },

  where(query: ResultObservationListQuery) {
    return {
      ...(query.diagnosticReportId === undefined
        ? {}
        : { diagnosticReportId: query.diagnosticReportId }),
      ...(query.patientId === undefined ? {} : { patientId: query.patientId }),
      ...(query.loincCode === undefined ? {} : { loincCode: query.loincCode }),
      ...(query.abnormalFlag === undefined ? {} : { abnormalFlag: query.abnormalFlag }),
    };
  },

  sortValue(row: ResultObservationRow, sort: ResultObservationListQuery['sort']): number | string {
    if (sort === 'createdAt') return row.createdAt.getTime();
    if (sort === 'effectiveAt') return row.effectiveAt.getTime();
    return row.sequence;
  },

  orderBy(query: ResultObservationListQuery) {
    const { order } = query;
    if (query.sort === 'createdAt') return [{ createdAt: order }, { id: 'asc' as const }];
    if (query.sort === 'effectiveAt') return [{ effectiveAt: order }, { id: 'asc' as const }];
    return [{ sequence: order }, { id: 'asc' as const }];
  },
};

/* ----------------------------------------------------------------- documents */

export interface DocumentListQuery extends BaseQuery {
  patientId?: string;
  encounterId?: string;
  status?: DocumentStatus;
  category?: string;
  source?: DocumentSource;
  /** Exact digest of the stored bytes. Answers "has this arrived before". */
  sha256?: string;
  /** Inclusive lower bound on `receivedAt`. */
  from?: Date;
  /** Exclusive upper bound on `receivedAt`. */
  to?: Date;
  sort: 'receivedAt' | 'title' | 'createdAt';
}

/** Fields a document amendment may change. `/file` owns the filing columns. */
export interface DocumentPatchInput {
  patientId?: string;
  encounterId?: string;
  category?: string;
  title?: string;
  status?: DocumentStatus;
  sensitivityClass?: OrderSensitivityClass;
  expiresAt?: Date;
  filedAt?: Date;
  filedById?: string;
  supersededById?: string;
  errorReason?: string;
}

export const documentSpec: CollectionSpec<
  'Document',
  DocumentInput,
  DocumentPatchInput,
  DocumentListQuery
> = {
  model: 'Document',
  targetType: 'Document',
  action: 'document',
  patientColumn: 'patientId',
  encounterColumn: 'encounterId',
  compartment: { column: 'patientId' },

  newRow(input: DocumentInput, context: RowContext): Writable<'Document'> {
    return {
      patientId: input.patientId ?? null,
      encounterId: input.encounterId ?? null,
      category: input.category,
      title: input.title,
      storageKey: input.storageKey,
      contentType: input.contentType,
      sha256: input.sha256,
      byteSize: input.byteSize,
      source: input.source ?? ORDER_DEFAULTS.document.source,
      status: input.status ?? ORDER_DEFAULTS.document.status,
      sensitivityClass: input.sensitivityClass ?? ORDER_DEFAULTS.document.sensitivityClass,
      receivedAt: input.receivedAt ?? context.now,
      // Filing, supersession and rejection are all decisions somebody makes
      // after the bytes arrive. A document that has just landed carries none of
      // them, whatever the caller supplied.
      filedAt: null,
      filedById: null,
      supersededById: null,
      errorReason: null,
      expiresAt: input.expiresAt ?? null,
    };
  },

  patchData(patch: DocumentPatchInput): Partial<Writable<'Document'>> {
    return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
  },

  matches(row: DocumentRow, query: DocumentListQuery): boolean {
    if (query.patientId !== undefined && row.patientId !== query.patientId) return false;
    if (query.encounterId !== undefined && row.encounterId !== query.encounterId) return false;
    if (query.status !== undefined && row.status !== query.status) return false;
    if (query.category !== undefined && row.category !== query.category) return false;
    if (query.source !== undefined && row.source !== query.source) return false;
    if (query.sha256 !== undefined && row.sha256 !== query.sha256) return false;
    return inWindow(row.receivedAt, query.from, query.to);
  },

  where(query: DocumentListQuery) {
    const receivedAt = windowFilter(query.from, query.to);
    return {
      ...(query.patientId === undefined ? {} : { patientId: query.patientId }),
      ...(query.encounterId === undefined ? {} : { encounterId: query.encounterId }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.category === undefined ? {} : { category: query.category }),
      ...(query.source === undefined ? {} : { source: query.source }),
      ...(query.sha256 === undefined ? {} : { sha256: query.sha256 }),
      ...(receivedAt === undefined ? {} : { receivedAt }),
    };
  },

  sortValue(row: DocumentRow, sort: DocumentListQuery['sort']): number | string {
    if (sort === 'createdAt') return row.createdAt.getTime();
    if (sort === 'title') return row.title;
    return row.receivedAt.getTime();
  },

  orderBy(query: DocumentListQuery) {
    const { order } = query;
    if (query.sort === 'createdAt') return [{ createdAt: order }, { id: 'asc' as const }];
    if (query.sort === 'title') return [{ title: order }, { id: 'asc' as const }];
    return [{ receivedAt: order }, { id: 'asc' as const }];
  },

  writeMetadata(row: DocumentRow, before: DocumentRow | null): Record<string, unknown> {
    return { category: row.category, ...statusMetadata(row.status, before) };
  },
};

/* --------------------------------------------------------------------- tasks */

export interface TaskListQuery extends BaseQuery {
  type?: TaskType;
  status?: TaskStatus;
  priority?: TaskPriority;
  patientId?: string;
  assigneeUserId?: string;
  assigneeTeamKey?: string;
  slaState?: TaskSlaState;
  /** Inclusive lower bound on `dueAt`. */
  from?: Date;
  /** Exclusive upper bound on `dueAt`. */
  to?: Date;
  sort: 'dueAt' | 'priority' | 'createdAt';
}

/** Fields a task amendment may change. `/complete` and `/cancel` own the rest. */
export interface TaskPatchInput {
  status?: TaskStatus;
  priority?: TaskPriority;
  title?: string;
  description?: string;
  assigneeType?: TaskAssigneeType;
  assigneeUserId?: string;
  assigneeTeamKey?: string;
  dueAt?: Date;
  slaState?: TaskSlaState;
  expiresAt?: Date;
  completedAt?: Date;
  completedById?: string;
  outcome?: string;
}

export const taskSpec: CollectionSpec<'Task', TaskInput, TaskPatchInput, TaskListQuery> = {
  model: 'Task',
  targetType: 'Task',
  action: 'task',
  patientColumn: 'patientId',
  encounterColumn: 'encounterId',
  compartment: { column: 'patientId' },

  newRow(input: TaskInput): Writable<'Task'> {
    return {
      type: input.type,
      status: input.status ?? ORDER_DEFAULTS.task.status,
      priority: input.priority ?? ORDER_DEFAULTS.task.priority,
      patientId: input.patientId ?? null,
      encounterId: input.encounterId ?? null,
      subjectType: input.subjectType ?? null,
      subjectId: input.subjectId ?? null,
      title: input.title,
      description: input.description ?? null,
      assigneeType: input.assigneeType,
      assigneeUserId: input.assigneeUserId ?? null,
      assigneeTeamKey: input.assigneeTeamKey ?? null,
      dueAt: input.dueAt ?? null,
      slaState: input.slaState ?? ORDER_DEFAULTS.task.slaState,
      expiresAt: input.expiresAt ?? null,
      sourceEventId: input.sourceEventId ?? null,
      completedAt: null,
      completedById: null,
      outcome: null,
    };
  },

  patchData(patch: TaskPatchInput): Partial<Writable<'Task'>> {
    const data: Partial<Writable<'Task'>> = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined)
    );
    // Reassignment moves a task rather than giving it a second owner, so naming
    // an assignee type clears the column the other type uses. The model expects
    // exactly one of the pair to be populated, and a task with both would
    // silently appear in two inboxes.
    if (patch.assigneeType === 'USER') data.assigneeTeamKey = null;
    if (patch.assigneeType === 'TEAM') data.assigneeUserId = null;
    return data;
  },

  matches(row: TaskRow, query: TaskListQuery): boolean {
    if (query.type !== undefined && row.type !== query.type) return false;
    if (query.status !== undefined && row.status !== query.status) return false;
    if (query.priority !== undefined && row.priority !== query.priority) return false;
    if (query.patientId !== undefined && row.patientId !== query.patientId) return false;
    if (query.assigneeUserId !== undefined && row.assigneeUserId !== query.assigneeUserId) {
      return false;
    }
    if (query.assigneeTeamKey !== undefined && row.assigneeTeamKey !== query.assigneeTeamKey) {
      return false;
    }
    if (query.slaState !== undefined && row.slaState !== query.slaState) return false;
    return inWindow(row.dueAt, query.from, query.to);
  },

  where(query: TaskListQuery) {
    const dueAt = windowFilter(query.from, query.to);
    return {
      ...(query.type === undefined ? {} : { type: query.type }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.priority === undefined ? {} : { priority: query.priority }),
      ...(query.patientId === undefined ? {} : { patientId: query.patientId }),
      ...(query.assigneeUserId === undefined ? {} : { assigneeUserId: query.assigneeUserId }),
      ...(query.assigneeTeamKey === undefined ? {} : { assigneeTeamKey: query.assigneeTeamKey }),
      ...(query.slaState === undefined ? {} : { slaState: query.slaState }),
      ...(dueAt === undefined ? {} : { dueAt }),
    };
  },

  sortValue(row: TaskRow, sort: TaskListQuery['sort']): number | string {
    if (sort === 'createdAt') return row.createdAt.getTime();
    if (sort === 'priority') return row.priority;
    // A task with no due date is not the most urgent one, so an absent due date
    // sorts last ascending rather than first.
    return comparable(row.dueAt);
  },

  orderBy(query: TaskListQuery) {
    const { order } = query;
    if (query.sort === 'createdAt') return [{ createdAt: order }, { id: 'asc' as const }];
    if (query.sort === 'priority') return [{ priority: order }, { id: 'asc' as const }];
    return [{ dueAt: order }, { id: 'asc' as const }];
  },

  writeMetadata(row: TaskRow, before: TaskRow | null): Record<string, unknown> {
    return { type: row.type, ...statusMetadata(row.status, before) };
  },

  /**
   * `@@unique([tenantId, sourceEventId, type])`. This is what makes inbox
   * routing idempotent: a domain event delivered twice produces one task, so a
   * retry in the interface engine does not become a second thing for somebody
   * to close.
   */
  uniqueBy: {
    where: (input: TaskInput) =>
      input.sourceEventId === undefined
        ? { sourceEventId: matchesNothing() }
        : { sourceEventId: input.sourceEventId, type: input.type },
    matches: (row: TaskRow, input: TaskInput) =>
      input.sourceEventId !== undefined &&
      row.sourceEventId === input.sourceEventId &&
      row.type === input.type,
    message: (input: TaskInput) =>
      `A ${input.type} task already exists for source event ${input.sourceEventId ?? ''}.`,
  },
};

/* ---------------------------------------------------------- message threads */

export interface MessageThreadCreateInput {
  kind?: ThreadKind;
  patientId?: string;
  subject: string;
}

export interface MessageThreadListQuery extends BaseQuery {
  kind?: ThreadKind;
  patientId?: string;
  /** True selects threads still open, false the ones somebody has closed. */
  open?: boolean;
  sort: 'lastMessageAt' | 'subject' | 'createdAt';
}

/** Fields a thread amendment may change. `/close` owns `closedAt`. */
export interface MessageThreadPatchInput {
  kind?: ThreadKind;
  subject?: string;
  lastMessageAt?: Date;
  closedAt?: Date;
}

export const messageThreadSpec: CollectionSpec<
  'MessageThread',
  MessageThreadCreateInput,
  MessageThreadPatchInput,
  MessageThreadListQuery
> = {
  model: 'MessageThread',
  targetType: 'MessageThread',
  action: 'messageThread',
  patientColumn: 'patientId',
  // A staff thread carries no chart at all, and its `patientId` is null. That
  // is still the right compartment column: a portal token narrows to its own
  // chart, and a row with no chart is not in it.
  compartment: { column: 'patientId' },

  newRow(input: MessageThreadCreateInput): Writable<'MessageThread'> {
    return {
      kind: input.kind ?? ORDER_DEFAULTS.messageThread.kind,
      patientId: input.patientId ?? null,
      subject: input.subject,
      lastMessageAt: null,
      closedAt: null,
    };
  },

  patchData(patch: MessageThreadPatchInput): Partial<Writable<'MessageThread'>> {
    return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
  },

  matches(row: MessageThreadRow, query: MessageThreadListQuery): boolean {
    if (query.kind !== undefined && row.kind !== query.kind) return false;
    if (query.patientId !== undefined && row.patientId !== query.patientId) return false;
    return query.open === undefined || (row.closedAt === null) === query.open;
  },

  where(query: MessageThreadListQuery) {
    return {
      ...(query.kind === undefined ? {} : { kind: query.kind }),
      ...(query.patientId === undefined ? {} : { patientId: query.patientId }),
      ...(query.open === undefined ? {} : { closedAt: query.open ? null : { not: null } }),
    };
  },

  sortValue(row: MessageThreadRow, sort: MessageThreadListQuery['sort']): number | string {
    if (sort === 'createdAt') return row.createdAt.getTime();
    if (sort === 'subject') return row.subject;
    return comparable(row.lastMessageAt);
  },

  orderBy(query: MessageThreadListQuery) {
    const { order } = query;
    if (query.sort === 'createdAt') return [{ createdAt: order }, { id: 'asc' as const }];
    if (query.sort === 'subject') return [{ subject: order }, { id: 'asc' as const }];
    return [{ lastMessageAt: order }, { id: 'asc' as const }];
  },

  writeMetadata(row: MessageThreadRow): Record<string, unknown> {
    return { kind: row.kind };
  },
};

/* ------------------------------------------------------------------ messages */

export interface MessageCreateInput {
  threadId: string;
  senderType: MessageSenderType;
  senderUserId?: string;
  senderPatientId?: string;
  body: string;
}

export interface MessageListQuery extends BaseQuery {
  threadId?: string;
  senderUserId?: string;
  /** True selects the messages somebody has opened, false the unread ones. */
  read?: boolean;
  sort: 'sentAt' | 'createdAt';
}

export interface MessagePatchInput {
  body?: string;
  readAt?: Date;
}

export const messageSpec: CollectionSpec<
  'Message',
  MessageCreateInput,
  MessagePatchInput,
  MessageListQuery
> = {
  model: 'Message',
  targetType: 'Message',
  action: 'message',
  // No `patientColumn`: `senderPatientId` names who wrote a message, not the
  // chart it belongs to, and stamping it on the audit event would file a
  // patient's reply under their own chart while filing the clinician's reply
  // under nothing.
  //
  // A message reaches a chart only through its thread, which is a join this
  // layer does not perform, so a compartment-restricted principal is refused
  // the table wholesale rather than served one nobody narrowed. Threads are
  // narrowed properly, and the nested route below reads through one.
  compartment: 'closed',

  newRow(input: MessageCreateInput, context: RowContext): Writable<'Message'> {
    return {
      threadId: input.threadId,
      senderType: input.senderType,
      senderUserId: input.senderUserId ?? null,
      senderPatientId: input.senderPatientId ?? null,
      body: input.body,
      sentAt: context.now,
      readAt: null,
    };
  },

  patchData(patch: MessagePatchInput): Partial<Writable<'Message'>> {
    return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
  },

  matches(row: MessageRow, query: MessageListQuery): boolean {
    if (query.threadId !== undefined && row.threadId !== query.threadId) return false;
    if (query.senderUserId !== undefined && row.senderUserId !== query.senderUserId) return false;
    return query.read === undefined || (row.readAt !== null) === query.read;
  },

  where(query: MessageListQuery) {
    return {
      ...(query.threadId === undefined ? {} : { threadId: query.threadId }),
      ...(query.senderUserId === undefined ? {} : { senderUserId: query.senderUserId }),
      ...(query.read === undefined ? {} : { readAt: query.read ? { not: null } : null }),
    };
  },

  sortValue(row: MessageRow, sort: MessageListQuery['sort']): number {
    return sort === 'createdAt' ? row.createdAt.getTime() : row.sentAt.getTime();
  },

  orderBy(query: MessageListQuery) {
    if (query.sort === 'createdAt') return [{ createdAt: query.order }, { id: 'asc' as const }];
    return [{ sentAt: query.order }, { id: 'asc' as const }];
  },
};

/* ----------------------------------------------------------------- imaging */

export interface ImagingStudyListQuery extends BaseQuery {
  patientId?: string;
  encounterId?: string;
  serviceRequestId?: string;
  accessionNumber?: string;
  studyInstanceUid?: string;
  status?: ImagingStudyStatus;
  /** Inclusive lower bound on `startedAt`. */
  from?: Date;
  /** Exclusive upper bound on `startedAt`. */
  to?: Date;
  sort: 'startedAt' | 'createdAt';
}

export interface ImagingStudyCreateInput {
  patientId: string;
  encounterId?: string;
  serviceRequestId?: string;
  studyInstanceUid: string;
  accessionNumber?: string;
  modalities: string[];
  description?: string;
  status?: ImagingStudyStatus;
  startedAt: Date;
  numberOfSeries?: number;
  numberOfInstances?: number;
  retrieveUrl?: string;
}

/**
 * What may be corrected after a study is recorded.
 *
 * Not `studyInstanceUid`: it identifies the study, and rewriting it points this
 * record at a different one while the report that cited it carries on citing
 * this row. Not `patientId` either, for the same reason a document is refiled
 * rather than repointed - moving a study between charts is an act somebody
 * should have to do deliberately, and it is not this.
 */
export interface ImagingStudyPatchInput {
  encounterId?: string;
  serviceRequestId?: string;
  diagnosticReportId?: string;
  accessionNumber?: string;
  modalities?: string[];
  description?: string;
  status?: ImagingStudyStatus;
  numberOfSeries?: number;
  numberOfInstances?: number;
  retrieveUrl?: string;
}

export const imagingStudySpec: CollectionSpec<
  'ImagingStudy',
  ImagingStudyCreateInput,
  ImagingStudyPatchInput,
  ImagingStudyListQuery
> = {
  model: 'ImagingStudy',
  targetType: 'ImagingStudy',
  action: 'result',
  patientColumn: 'patientId',
  encounterColumn: 'encounterId',
  compartment: { column: 'patientId' },

  newRow(input: ImagingStudyCreateInput): Writable<'ImagingStudy'> {
    return {
      patientId: input.patientId,
      encounterId: input.encounterId ?? null,
      serviceRequestId: input.serviceRequestId ?? null,
      // Set when the radiologist's report exists, never at creation: a study
      // arriving from a modality has not been read yet.
      diagnosticReportId: null,
      studyInstanceUid: input.studyInstanceUid,
      accessionNumber: input.accessionNumber ?? null,
      modalities: input.modalities,
      description: input.description ?? null,
      status: input.status ?? 'AVAILABLE',
      startedAt: input.startedAt,
      numberOfSeries: input.numberOfSeries ?? 0,
      numberOfInstances: input.numberOfInstances ?? 0,
      retrieveUrl: input.retrieveUrl ?? null,
    };
  },

  patchData(patch: ImagingStudyPatchInput): Partial<Writable<'ImagingStudy'>> {
    return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
  },

  matches(row: ScopedRow<'ImagingStudy'>, query: ImagingStudyListQuery): boolean {
    if (query.patientId !== undefined && row.patientId !== query.patientId) return false;
    if (query.encounterId !== undefined && row.encounterId !== query.encounterId) return false;
    if (query.serviceRequestId !== undefined && row.serviceRequestId !== query.serviceRequestId) {
      return false;
    }
    if (query.accessionNumber !== undefined && row.accessionNumber !== query.accessionNumber) {
      return false;
    }
    if (query.studyInstanceUid !== undefined && row.studyInstanceUid !== query.studyInstanceUid) {
      return false;
    }
    if (query.status !== undefined && row.status !== query.status) return false;
    return inWindow(row.startedAt, query.from, query.to);
  },

  where(query: ImagingStudyListQuery) {
    const startedAt = windowFilter(query.from, query.to);
    return {
      ...(query.patientId === undefined ? {} : { patientId: query.patientId }),
      ...(query.encounterId === undefined ? {} : { encounterId: query.encounterId }),
      ...(query.serviceRequestId === undefined ? {} : { serviceRequestId: query.serviceRequestId }),
      ...(query.accessionNumber === undefined ? {} : { accessionNumber: query.accessionNumber }),
      ...(query.studyInstanceUid === undefined ? {} : { studyInstanceUid: query.studyInstanceUid }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(startedAt === undefined ? {} : { startedAt }),
    };
  },

  sortValue(row: ScopedRow<'ImagingStudy'>, sort: ImagingStudyListQuery['sort']): number {
    if (sort === 'createdAt') return row.createdAt.getTime();
    return row.startedAt.getTime();
  },

  orderBy(query: ImagingStudyListQuery) {
    const { order } = query;
    if (query.sort === 'createdAt') return [{ createdAt: order }, { id: 'asc' as const }];
    return [{ startedAt: order }, { id: 'asc' as const }];
  },
};

export const orderSpecs = {
  imagingStudies: imagingStudySpec,
  orders: serviceRequestSpec,
  specimens: specimenSpec,
  reports: diagnosticReportSpec,
  resultObservations: resultObservationSpec,
  documents: documentSpec,
  tasks: taskSpec,
  messageThreads: messageThreadSpec,
  messages: messageSpec,
} as const;
