import {
  ALLERGY_CATEGORIES,
  ALLERGY_CLINICAL_STATUSES,
  ALLERGY_CRITICALITIES,
  ALLERGY_TYPES,
  CONDITION_CATEGORIES,
  CONDITION_CLINICAL_STATUSES,
  CONDITION_VERIFICATION_STATUSES,
  ENCOUNTER_CLASSES,
  ENCOUNTER_STATUSES,
  IMMUNIZATION_STATUSES,
  MEDICATION_REQUEST_INTENTS,
  MEDICATION_REQUEST_STATUSES,
  MEDICATION_SOURCES,
  MEDICATION_STATEMENT_STATUSES,
  NOTE_STATES,
  OBSERVATION_CATEGORIES,
  OBSERVATION_STATUSES,
  REACTION_SEVERITIES,
  noteAddendumInput,
} from '@openrunic/database';
import { z } from 'zod';

import { readJsonObject } from '../repositories/collection.js';
import type {
  AllergyIntoleranceRow,
  AllergyListQuery,
  AllergyPatchInput,
  ClinicalNoteListQuery,
  ClinicalNotePatchInput,
  ClinicalNoteRow,
  ConditionListQuery,
  ConditionPatchInput,
  ConditionRow,
  EncounterListQuery,
  EncounterPatchInput,
  EncounterRow,
  ImmunisationListQuery,
  ImmunisationPatchInput,
  ImmunizationRow,
  MedicationRequestListQuery,
  MedicationRequestPatchInput,
  MedicationRequestRow,
  MedicationStatementListQuery,
  MedicationStatementPatchInput,
  MedicationStatementRow,
  NoteAddendumListQuery,
  NoteAddendumRow,
  ObservationListQuery,
  ObservationPatchInput,
  ObservationRow,
} from '../repositories/specs/clinical.js';

import { paginationQueryFields, sortOrderField } from './pagination.js';
import { toDateOnly } from './patients.js';

/**
 * The wire contracts for the chart.
 *
 * Three kinds of schema live here and they are not interchangeable. A **list
 * query** is a `strictObject`, so `?patinetId=...` is a 400 rather than a search
 * that quietly returns every chart in the organisation. A **patch** is written
 * here rather than imported, because the create contracts in
 * `@openrunic/database` are create-only and a patch has to be narrower than a
 * create anyway: none of them accepts a patient, an encounter or a code, since
 * moving a clinical fact to another chart is not an edit. A **DTO** is declared
 * as a schema with its TypeScript type inferred from it, so the published
 * OpenAPI document and the handler cannot describe different objects.
 *
 * No patch field accepts `null`. Clearing a clinical fact is not an edit: a fact
 * recorded in error is corrected by moving it to `ENTERED_IN_ERROR`, which keeps
 * it visible to anyone who acted on it, and erasure would not.
 */

/** Instants on the wire are ISO 8601 with an offset, in and out. */
const instantField = z.iso.datetime({ offset: true });

/** A `@db.Date` column on the wire: a bare calendar date, no time, no zone. */
const dateOnlyField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

/** A block of a note document. Its shape is the editor's, not storage's. */
const blockField = z.record(z.string(), z.unknown());

/** Reads a `YYYY-MM-DD` as UTC midnight, never as local midnight. */
function parseDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function instantOrNull(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function dateOnlyOrNull(value: Date | null): string | null {
  return value === null ? null : toDateOnly(value);
}

/**
 * Reads a block list back off its JSON column.
 *
 * The column is typed as "any JSON", because that is what the database
 * guarantees, so anything that is not a list of objects is reported as an empty
 * document rather than crashing a chart on the way out. A note whose blocks
 * were written by a future editor version is still readable; it is just not
 * renderable by this one.
 */
function toBlocks(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  const entries: readonly unknown[] = value;
  return entries
    .map((entry) => readJsonObject(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== undefined);
}

/* ------------------------------------------------------------- encounters */

export const encounterListQuerySchema = z.strictObject({
  ...paginationQueryFields,
  patientId: z.uuid().optional(),
  facilityId: z.uuid().optional(),
  providerId: z.uuid().optional(),
  status: z.enum(ENCOUNTER_STATUSES).optional(),
  /** Inclusive lower bound on `startedAt`. */
  from: instantField.optional(),
  /** Exclusive upper bound on `startedAt`, so a day is `[00:00, next 00:00)`. */
  to: instantField.optional(),
  sort: z.enum(['startedAt', 'createdAt']).default('startedAt'),
  order: sortOrderField,
});

export type EncounterListQueryInput = z.infer<typeof encounterListQuerySchema>;

export function toEncounterListQuery(input: EncounterListQueryInput): EncounterListQuery {
  return {
    page: input.page,
    pageSize: input.pageSize,
    ...(input.patientId === undefined ? {} : { patientId: input.patientId }),
    ...(input.facilityId === undefined ? {} : { facilityId: input.facilityId }),
    ...(input.providerId === undefined ? {} : { providerId: input.providerId }),
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.from === undefined ? {} : { from: new Date(input.from) }),
    ...(input.to === undefined ? {} : { to: new Date(input.to) }),
    sort: input.sort,
    order: input.order,
  };
}

/**
 * The visit patch.
 *
 * `patientId` and `facilityId` are absent: a visit recorded against the wrong
 * chart or the wrong site is corrected by ending it as `ENTERED_IN_ERROR` and
 * recording the right one, which is what a later reader has to be able to see.
 */
export const encounterPatchSchema = z
  .strictObject({
    status: z.enum(ENCOUNTER_STATUSES).optional(),
    class: z.enum(ENCOUNTER_CLASSES).optional(),
    providerId: z.uuid().optional(),
    reasonCode: z.string().min(1).max(64).optional(),
    reasonText: z.string().min(1).max(256).optional(),
    endedAt: instantField.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'the patch must change at least one field',
  });

export type EncounterPatchBody = z.infer<typeof encounterPatchSchema>;

export function toEncounterPatch(body: EncounterPatchBody): EncounterPatchInput {
  return {
    ...(body.status === undefined ? {} : { status: body.status }),
    ...(body.class === undefined ? {} : { class: body.class }),
    ...(body.providerId === undefined ? {} : { providerId: body.providerId }),
    ...(body.reasonCode === undefined ? {} : { reasonCode: body.reasonCode }),
    ...(body.reasonText === undefined ? {} : { reasonText: body.reasonText }),
    ...(body.endedAt === undefined ? {} : { endedAt: new Date(body.endedAt) }),
  };
}

export const encounterDtoSchema = z.strictObject({
  id: z.uuid(),
  facilityId: z.uuid(),
  patientId: z.uuid(),
  providerId: z.uuid(),
  appointmentId: z.uuid().nullable(),
  class: z.enum(ENCOUNTER_CLASSES),
  status: z.enum(ENCOUNTER_STATUSES),
  reasonCode: z.string().nullable(),
  reasonText: z.string().nullable(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  signedAt: z.string().nullable(),
  signedById: z.uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type EncounterDto = z.infer<typeof encounterDtoSchema>;

export function toEncounterDto(row: EncounterRow): EncounterDto {
  return {
    id: row.id,
    facilityId: row.facilityId,
    patientId: row.patientId,
    providerId: row.providerId,
    appointmentId: row.appointmentId,
    class: row.class,
    status: row.status,
    reasonCode: row.reasonCode,
    reasonText: row.reasonText,
    startedAt: row.startedAt.toISOString(),
    endedAt: instantOrNull(row.endedAt),
    signedAt: instantOrNull(row.signedAt),
    signedById: row.signedById,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/* ---------------------------------------------------------- clinical notes */

export const noteListQuerySchema = z.strictObject({
  ...paginationQueryFields,
  patientId: z.uuid().optional(),
  encounterId: z.uuid().optional(),
  authorId: z.uuid().optional(),
  state: z.enum(NOTE_STATES).optional(),
  sort: z.enum(['createdAt', 'signedAt']).default('createdAt'),
  order: sortOrderField,
});

export type NoteListQueryInput = z.infer<typeof noteListQuerySchema>;

export function toNoteListQuery(input: NoteListQueryInput): ClinicalNoteListQuery {
  return {
    page: input.page,
    pageSize: input.pageSize,
    ...(input.patientId === undefined ? {} : { patientId: input.patientId }),
    ...(input.encounterId === undefined ? {} : { encounterId: input.encounterId }),
    ...(input.authorId === undefined ? {} : { authorId: input.authorId }),
    ...(input.state === undefined ? {} : { state: input.state }),
    sort: input.sort,
    order: input.order,
  };
}

/**
 * The note patch.
 *
 * `state` is here and `SIGNED` is not reachable through it: signing stamps a
 * signature and a lock, so it goes through its own route. What this schema
 * cannot express, the route refuses.
 */
export const notePatchSchema = z
  .strictObject({
    title: z.string().min(1).max(256).optional(),
    blocks: z.array(blockField).max(500).optional(),
    state: z.enum(NOTE_STATES).optional(),
    cosignerId: z.uuid().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'the patch must change at least one field',
  });

export type NotePatchBody = z.infer<typeof notePatchSchema>;

export function toNotePatch(body: NotePatchBody): ClinicalNotePatchInput {
  return {
    ...(body.title === undefined ? {} : { title: body.title }),
    ...(body.blocks === undefined ? {} : { blocks: [...body.blocks] }),
    ...(body.state === undefined ? {} : { state: body.state }),
    ...(body.cosignerId === undefined ? {} : { cosignerId: body.cosignerId }),
  };
}

export const noteDtoSchema = z.strictObject({
  id: z.uuid(),
  patientId: z.uuid(),
  encounterId: z.uuid(),
  authorId: z.uuid(),
  title: z.string(),
  blocks: z.array(blockField),
  state: z.enum(NOTE_STATES),
  cosignerId: z.uuid().nullable(),
  cosignedAt: z.string().nullable(),
  signedAt: z.string().nullable(),
  signedById: z.uuid().nullable(),
  lockedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type NoteDto = z.infer<typeof noteDtoSchema>;

export function toNoteDto(row: ClinicalNoteRow): NoteDto {
  return {
    id: row.id,
    patientId: row.patientId,
    encounterId: row.encounterId,
    authorId: row.authorId,
    title: row.title,
    blocks: toBlocks(row.blocks),
    state: row.state,
    cosignerId: row.cosignerId,
    cosignedAt: instantOrNull(row.cosignedAt),
    signedAt: instantOrNull(row.signedAt),
    signedById: row.signedById,
    lockedAt: instantOrNull(row.lockedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/* ------------------------------------------------------------ note addenda */

/**
 * The addendum list is nested under its note, so it carries no note filter: the
 * path already named one, and a second way to say it is a second way to
 * disagree. Order is a real parameter and defaults to ascending, because an
 * addendum trail reads oldest first.
 */
export const noteAddendumListQuerySchema = z.strictObject({
  ...paginationQueryFields,
  sort: z.enum(['createdAt']).default('createdAt'),
  order: sortOrderField,
});

export type NoteAddendumListQueryInput = z.infer<typeof noteAddendumListQuerySchema>;

export function toNoteAddendumListQuery(
  input: NoteAddendumListQueryInput,
  noteId: string
): NoteAddendumListQuery {
  return {
    page: input.page,
    pageSize: input.pageSize,
    noteId,
    sort: input.sort,
    order: input.order,
  };
}

/**
 * The write contract minus the note, which the path already named, and minus the
 * author, which the token already names.
 *
 * An addendum's author is a claim about a person, exactly like a signature, and
 * it is attached to an amendment of a locked clinical record. A client that
 * could supply it could file a correction in a colleague's name, which is worse
 * than an unattributed one: it is attributed to the wrong clinician and reads as
 * theirs forever after. The route stamps it from the verified principal.
 */
export const noteAddendumBodySchema = noteAddendumInput.omit({ noteId: true, authorId: true });

export type NoteAddendumBody = z.infer<typeof noteAddendumBodySchema>;

export const noteAddendumDtoSchema = z.strictObject({
  id: z.uuid(),
  noteId: z.uuid(),
  authorId: z.uuid(),
  blocks: z.array(blockField),
  reason: z.string().nullable(),
  signedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type NoteAddendumDto = z.infer<typeof noteAddendumDtoSchema>;

export function toNoteAddendumDto(row: NoteAddendumRow): NoteAddendumDto {
  return {
    id: row.id,
    noteId: row.noteId,
    authorId: row.authorId,
    blocks: toBlocks(row.blocks),
    reason: row.reason,
    signedAt: instantOrNull(row.signedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/* ---------------------------------------------------------------- problems */

export const problemListQuerySchema = z.strictObject({
  ...paginationQueryFields,
  patientId: z.uuid().optional(),
  encounterId: z.uuid().optional(),
  category: z.enum(CONDITION_CATEGORIES).optional(),
  clinicalStatus: z.enum(CONDITION_CLINICAL_STATUSES).optional(),
  code: z.string().min(1).max(64).optional(),
  sort: z.enum(['recordedAt', 'createdAt']).default('recordedAt'),
  order: sortOrderField,
});

export type ProblemListQueryInput = z.infer<typeof problemListQuerySchema>;

export function toProblemListQuery(input: ProblemListQueryInput): ConditionListQuery {
  return {
    page: input.page,
    pageSize: input.pageSize,
    ...(input.patientId === undefined ? {} : { patientId: input.patientId }),
    ...(input.encounterId === undefined ? {} : { encounterId: input.encounterId }),
    ...(input.category === undefined ? {} : { category: input.category }),
    ...(input.clinicalStatus === undefined ? {} : { clinicalStatus: input.clinicalStatus }),
    ...(input.code === undefined ? {} : { code: input.code }),
    sort: input.sort,
    order: input.order,
  };
}

export const problemPatchSchema = z
  .strictObject({
    category: z.enum(CONDITION_CATEGORIES).optional(),
    display: z.string().min(1).max(512).optional(),
    clinicalStatus: z.enum(CONDITION_CLINICAL_STATUSES).optional(),
    verificationStatus: z.enum(CONDITION_VERIFICATION_STATUSES).optional(),
    abatementDate: dateOnlyField.optional(),
    severityCode: z.string().min(1).max(64).optional(),
    bodySiteCode: z.string().min(1).max(64).optional(),
    note: z.string().min(1).max(20_000).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'the patch must change at least one field',
  });

export type ProblemPatchBody = z.infer<typeof problemPatchSchema>;

export function toProblemPatch(body: ProblemPatchBody): ConditionPatchInput {
  return {
    ...(body.category === undefined ? {} : { category: body.category }),
    ...(body.display === undefined ? {} : { display: body.display }),
    ...(body.clinicalStatus === undefined ? {} : { clinicalStatus: body.clinicalStatus }),
    ...(body.verificationStatus === undefined
      ? {}
      : { verificationStatus: body.verificationStatus }),
    ...(body.abatementDate === undefined
      ? {}
      : { abatementDate: parseDateOnly(body.abatementDate) }),
    ...(body.severityCode === undefined ? {} : { severityCode: body.severityCode }),
    ...(body.bodySiteCode === undefined ? {} : { bodySiteCode: body.bodySiteCode }),
    ...(body.note === undefined ? {} : { note: body.note }),
  };
}

export const problemDtoSchema = z.strictObject({
  id: z.uuid(),
  patientId: z.uuid(),
  encounterId: z.uuid().nullable(),
  category: z.enum(CONDITION_CATEGORIES),
  code: z.string(),
  codeSystem: z.string(),
  display: z.string(),
  snomedCode: z.string().nullable(),
  clinicalStatus: z.enum(CONDITION_CLINICAL_STATUSES),
  verificationStatus: z.enum(CONDITION_VERIFICATION_STATUSES),
  /** `YYYY-MM-DD`. An onset has a day, not an instant. */
  onsetDate: z.string().nullable(),
  abatementDate: z.string().nullable(),
  severityCode: z.string().nullable(),
  bodySiteCode: z.string().nullable(),
  note: z.string().nullable(),
  recordedAt: z.string(),
  recordedById: z.uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ProblemDto = z.infer<typeof problemDtoSchema>;

export function toProblemDto(row: ConditionRow): ProblemDto {
  return {
    id: row.id,
    patientId: row.patientId,
    encounterId: row.encounterId,
    category: row.category,
    code: row.code,
    codeSystem: row.codeSystem,
    display: row.display,
    snomedCode: row.snomedCode,
    clinicalStatus: row.clinicalStatus,
    verificationStatus: row.verificationStatus,
    onsetDate: dateOnlyOrNull(row.onsetDate),
    abatementDate: dateOnlyOrNull(row.abatementDate),
    severityCode: row.severityCode,
    bodySiteCode: row.bodySiteCode,
    note: row.note,
    recordedAt: row.recordedAt.toISOString(),
    recordedById: row.recordedById,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/* ---------------------------------------------------- medication statements */

export const medicationStatementListQuerySchema = z.strictObject({
  ...paginationQueryFields,
  patientId: z.uuid().optional(),
  encounterId: z.uuid().optional(),
  status: z.enum(MEDICATION_STATEMENT_STATUSES).optional(),
  sort: z.enum(['reportedAt', 'createdAt']).default('reportedAt'),
  order: sortOrderField,
});

export type MedicationStatementListQueryInput = z.infer<typeof medicationStatementListQuerySchema>;

export function toMedicationStatementListQuery(
  input: MedicationStatementListQueryInput
): MedicationStatementListQuery {
  return {
    page: input.page,
    pageSize: input.pageSize,
    ...(input.patientId === undefined ? {} : { patientId: input.patientId }),
    ...(input.encounterId === undefined ? {} : { encounterId: input.encounterId }),
    ...(input.status === undefined ? {} : { status: input.status }),
    sort: input.sort,
    order: input.order,
  };
}

export const medicationStatementPatchSchema = z
  .strictObject({
    status: z.enum(MEDICATION_STATEMENT_STATUSES).optional(),
    source: z.enum(MEDICATION_SOURCES).optional(),
    display: z.string().min(1).max(512).optional(),
    sigText: z.string().min(1).max(256).optional(),
    effectiveEnd: dateOnlyField.optional(),
    note: z.string().min(1).max(20_000).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'the patch must change at least one field',
  });

export type MedicationStatementPatchBody = z.infer<typeof medicationStatementPatchSchema>;

export function toMedicationStatementPatch(
  body: MedicationStatementPatchBody
): MedicationStatementPatchInput {
  return {
    ...(body.status === undefined ? {} : { status: body.status }),
    ...(body.source === undefined ? {} : { source: body.source }),
    ...(body.display === undefined ? {} : { display: body.display }),
    ...(body.sigText === undefined ? {} : { sigText: body.sigText }),
    ...(body.effectiveEnd === undefined ? {} : { effectiveEnd: parseDateOnly(body.effectiveEnd) }),
    ...(body.note === undefined ? {} : { note: body.note }),
  };
}

export const medicationStatementDtoSchema = z.strictObject({
  id: z.uuid(),
  patientId: z.uuid(),
  encounterId: z.uuid().nullable(),
  rxnormCode: z.string().nullable(),
  display: z.string(),
  sigText: z.string().nullable(),
  status: z.enum(MEDICATION_STATEMENT_STATUSES),
  source: z.enum(MEDICATION_SOURCES),
  effectiveStart: z.string().nullable(),
  effectiveEnd: z.string().nullable(),
  reportedAt: z.string(),
  note: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type MedicationStatementDto = z.infer<typeof medicationStatementDtoSchema>;

export function toMedicationStatementDto(row: MedicationStatementRow): MedicationStatementDto {
  return {
    id: row.id,
    patientId: row.patientId,
    encounterId: row.encounterId,
    rxnormCode: row.rxnormCode,
    display: row.display,
    sigText: row.sigText,
    status: row.status,
    source: row.source,
    effectiveStart: dateOnlyOrNull(row.effectiveStart),
    effectiveEnd: dateOnlyOrNull(row.effectiveEnd),
    reportedAt: row.reportedAt.toISOString(),
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/* ------------------------------------------------------------ prescriptions */

export const prescriptionListQuerySchema = z.strictObject({
  ...paginationQueryFields,
  patientId: z.uuid().optional(),
  encounterId: z.uuid().optional(),
  prescriberId: z.uuid().optional(),
  status: z.enum(MEDICATION_REQUEST_STATUSES).optional(),
  sort: z.enum(['writtenAt', 'createdAt']).default('writtenAt'),
  order: sortOrderField,
});

export type PrescriptionListQueryInput = z.infer<typeof prescriptionListQuerySchema>;

export function toPrescriptionListQuery(
  input: PrescriptionListQueryInput
): MedicationRequestListQuery {
  return {
    page: input.page,
    pageSize: input.pageSize,
    ...(input.patientId === undefined ? {} : { patientId: input.patientId }),
    ...(input.encounterId === undefined ? {} : { encounterId: input.encounterId }),
    ...(input.prescriberId === undefined ? {} : { prescriberId: input.prescriberId }),
    ...(input.status === undefined ? {} : { status: input.status }),
    sort: input.sort,
    order: input.order,
  };
}

/**
 * The prescription patch. It cannot carry a status: signing, transmitting and
 * cancelling each stamp or check something a bare status write would skip, so
 * each one has a route of its own.
 */
export const prescriptionPatchSchema = z
  .strictObject({
    display: z.string().min(1).max(512).optional(),
    sigText: z.string().min(1).max(256).optional(),
    quantity: z.number().positive().finite().optional(),
    quantityUnit: z.string().min(1).max(32).optional(),
    refills: z.int().min(0).max(99).optional(),
    daysSupply: z.int().positive().max(365).optional(),
    dispenseAsWritten: z.boolean().optional(),
    pharmacyName: z.string().min(1).max(256).optional(),
    pharmacyNcpdpId: z.string().min(1).max(32).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'the patch must change at least one field',
  });

export type PrescriptionPatchBody = z.infer<typeof prescriptionPatchSchema>;

export function toPrescriptionPatch(body: PrescriptionPatchBody): MedicationRequestPatchInput {
  return {
    ...(body.display === undefined ? {} : { display: body.display }),
    ...(body.sigText === undefined ? {} : { sigText: body.sigText }),
    ...(body.quantity === undefined ? {} : { quantity: body.quantity }),
    ...(body.quantityUnit === undefined ? {} : { quantityUnit: body.quantityUnit }),
    ...(body.refills === undefined ? {} : { refills: body.refills }),
    ...(body.daysSupply === undefined ? {} : { daysSupply: body.daysSupply }),
    ...(body.dispenseAsWritten === undefined ? {} : { dispenseAsWritten: body.dispenseAsWritten }),
    ...(body.pharmacyName === undefined ? {} : { pharmacyName: body.pharmacyName }),
    ...(body.pharmacyNcpdpId === undefined ? {} : { pharmacyNcpdpId: body.pharmacyNcpdpId }),
  };
}

export const prescriptionDtoSchema = z.strictObject({
  id: z.uuid(),
  patientId: z.uuid(),
  encounterId: z.uuid().nullable(),
  prescriberId: z.uuid(),
  rxnormCode: z.string().nullable(),
  ndcCode: z.string().nullable(),
  display: z.string(),
  sig: blockField,
  sigText: z.string(),
  quantity: z.number(),
  quantityUnit: z.string(),
  refills: z.int(),
  daysSupply: z.int().nullable(),
  dispenseAsWritten: z.boolean(),
  controlledSchedule: z.string().nullable(),
  pharmacyName: z.string().nullable(),
  pharmacyNcpdpId: z.string().nullable(),
  status: z.enum(MEDICATION_REQUEST_STATUSES),
  intent: z.enum(MEDICATION_REQUEST_INTENTS),
  erxRef: z.string().nullable(),
  writtenAt: z.string(),
  transmittedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type PrescriptionDto = z.infer<typeof prescriptionDtoSchema>;

export function toPrescriptionDto(row: MedicationRequestRow): PrescriptionDto {
  return {
    id: row.id,
    patientId: row.patientId,
    encounterId: row.encounterId,
    prescriberId: row.prescriberId,
    rxnormCode: row.rxnormCode,
    ndcCode: row.ndcCode,
    display: row.display,
    sig: readJsonObject(row.sig) ?? {},
    sigText: row.sigText,
    // A decimal column, already flattened to a number by the row layer: a
    // dispensed quantity is a lab-scale value, never money.
    quantity: row.quantity,
    quantityUnit: row.quantityUnit,
    refills: row.refills,
    daysSupply: row.daysSupply,
    dispenseAsWritten: row.dispenseAsWritten,
    controlledSchedule: row.controlledSchedule,
    pharmacyName: row.pharmacyName,
    pharmacyNcpdpId: row.pharmacyNcpdpId,
    status: row.status,
    intent: row.intent,
    erxRef: row.erxRef,
    writtenAt: row.writtenAt.toISOString(),
    transmittedAt: instantOrNull(row.transmittedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/* --------------------------------------------------------------- allergies */

export const allergyListQuerySchema = z.strictObject({
  ...paginationQueryFields,
  patientId: z.uuid().optional(),
  clinicalStatus: z.enum(ALLERGY_CLINICAL_STATUSES).optional(),
  criticality: z.enum(ALLERGY_CRITICALITIES).optional(),
  sort: z.enum(['recordedAt', 'createdAt']).default('recordedAt'),
  order: sortOrderField,
});

export type AllergyListQueryInput = z.infer<typeof allergyListQuerySchema>;

export function toAllergyListQuery(input: AllergyListQueryInput): AllergyListQuery {
  return {
    page: input.page,
    pageSize: input.pageSize,
    ...(input.patientId === undefined ? {} : { patientId: input.patientId }),
    ...(input.clinicalStatus === undefined ? {} : { clinicalStatus: input.clinicalStatus }),
    ...(input.criticality === undefined ? {} : { criticality: input.criticality }),
    sort: input.sort,
    order: input.order,
  };
}

/**
 * The allergy patch. The substance is not in it: an allergy recorded against
 * the wrong substance is a different allergy, and rewriting the old row would
 * silently change what every past prescription was checked against.
 */
export const allergyPatchSchema = z
  .strictObject({
    clinicalStatus: z.enum(ALLERGY_CLINICAL_STATUSES).optional(),
    criticality: z.enum(ALLERGY_CRITICALITIES).optional(),
    category: z.enum(ALLERGY_CATEGORIES).optional(),
    severity: z.enum(REACTION_SEVERITIES).optional(),
    reactionCodes: z.array(z.string().min(1).max(64)).max(64).optional(),
    reactionText: z.string().min(1).max(256).optional(),
    note: z.string().min(1).max(20_000).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'the patch must change at least one field',
  });

export type AllergyPatchBody = z.infer<typeof allergyPatchSchema>;

export function toAllergyPatch(body: AllergyPatchBody): AllergyPatchInput {
  return {
    ...(body.clinicalStatus === undefined ? {} : { clinicalStatus: body.clinicalStatus }),
    ...(body.criticality === undefined ? {} : { criticality: body.criticality }),
    ...(body.category === undefined ? {} : { category: body.category }),
    ...(body.severity === undefined ? {} : { severity: body.severity }),
    ...(body.reactionCodes === undefined ? {} : { reactionCodes: [...body.reactionCodes] }),
    ...(body.reactionText === undefined ? {} : { reactionText: body.reactionText }),
    ...(body.note === undefined ? {} : { note: body.note }),
  };
}

export const allergyDtoSchema = z.strictObject({
  id: z.uuid(),
  patientId: z.uuid(),
  type: z.enum(ALLERGY_TYPES),
  category: z.enum(ALLERGY_CATEGORIES),
  criticality: z.enum(ALLERGY_CRITICALITIES),
  clinicalStatus: z.enum(ALLERGY_CLINICAL_STATUSES),
  substanceCode: z.string().nullable(),
  substanceCodeSystem: z.string().nullable(),
  substanceDisplay: z.string(),
  reactionCodes: z.array(z.string()),
  reactionText: z.string().nullable(),
  severity: z.enum(REACTION_SEVERITIES).nullable(),
  onsetDate: z.string().nullable(),
  note: z.string().nullable(),
  recordedAt: z.string(),
  recordedById: z.uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type AllergyDto = z.infer<typeof allergyDtoSchema>;

export function toAllergyDto(row: AllergyIntoleranceRow): AllergyDto {
  return {
    id: row.id,
    patientId: row.patientId,
    type: row.type,
    category: row.category,
    criticality: row.criticality,
    clinicalStatus: row.clinicalStatus,
    substanceCode: row.substanceCode,
    substanceCodeSystem: row.substanceCodeSystem,
    substanceDisplay: row.substanceDisplay,
    reactionCodes: [...row.reactionCodes],
    reactionText: row.reactionText,
    severity: row.severity,
    onsetDate: dateOnlyOrNull(row.onsetDate),
    note: row.note,
    recordedAt: row.recordedAt.toISOString(),
    recordedById: row.recordedById,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/* ----------------------------------------------------------- immunisations */

export const immunisationListQuerySchema = z.strictObject({
  ...paginationQueryFields,
  patientId: z.uuid().optional(),
  encounterId: z.uuid().optional(),
  cvxCode: z.string().min(1).max(64).optional(),
  /** Inclusive lower bound on `administeredAt`. */
  from: instantField.optional(),
  /** Exclusive upper bound on `administeredAt`. */
  to: instantField.optional(),
  sort: z.enum(['administeredAt', 'createdAt']).default('administeredAt'),
  order: sortOrderField,
});

export type ImmunisationListQueryInput = z.infer<typeof immunisationListQuerySchema>;

export function toImmunisationListQuery(input: ImmunisationListQueryInput): ImmunisationListQuery {
  return {
    page: input.page,
    pageSize: input.pageSize,
    ...(input.patientId === undefined ? {} : { patientId: input.patientId }),
    ...(input.encounterId === undefined ? {} : { encounterId: input.encounterId }),
    ...(input.cvxCode === undefined ? {} : { cvxCode: input.cvxCode }),
    ...(input.from === undefined ? {} : { from: new Date(input.from) }),
    ...(input.to === undefined ? {} : { to: new Date(input.to) }),
    sort: input.sort,
    order: input.order,
  };
}

export const immunisationPatchSchema = z
  .strictObject({
    status: z.enum(IMMUNIZATION_STATUSES).optional(),
    lotNumber: z.string().min(1).max(64).optional(),
    expirationDate: dateOnlyField.optional(),
    siteCode: z.string().min(1).max(64).optional(),
    routeCode: z.string().min(1).max(64).optional(),
    refusalReasonCode: z.string().min(1).max(64).optional(),
    reportedToRegistryAt: instantField.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'the patch must change at least one field',
  });

export type ImmunisationPatchBody = z.infer<typeof immunisationPatchSchema>;

export function toImmunisationPatch(body: ImmunisationPatchBody): ImmunisationPatchInput {
  return {
    ...(body.status === undefined ? {} : { status: body.status }),
    ...(body.lotNumber === undefined ? {} : { lotNumber: body.lotNumber }),
    ...(body.expirationDate === undefined
      ? {}
      : { expirationDate: parseDateOnly(body.expirationDate) }),
    ...(body.siteCode === undefined ? {} : { siteCode: body.siteCode }),
    ...(body.routeCode === undefined ? {} : { routeCode: body.routeCode }),
    ...(body.refusalReasonCode === undefined ? {} : { refusalReasonCode: body.refusalReasonCode }),
    ...(body.reportedToRegistryAt === undefined
      ? {}
      : { reportedToRegistryAt: new Date(body.reportedToRegistryAt) }),
  };
}

export const immunisationDtoSchema = z.strictObject({
  id: z.uuid(),
  patientId: z.uuid(),
  encounterId: z.uuid().nullable(),
  status: z.enum(IMMUNIZATION_STATUSES),
  cvxCode: z.string(),
  mvxCode: z.string().nullable(),
  ndcCode: z.string().nullable(),
  display: z.string(),
  lotNumber: z.string().nullable(),
  expirationDate: z.string().nullable(),
  siteCode: z.string().nullable(),
  routeCode: z.string().nullable(),
  doseQuantity: z.number().nullable(),
  doseUnit: z.string().nullable(),
  administeredAt: z.string(),
  administeredById: z.uuid().nullable(),
  visDate: z.string().nullable(),
  refusalReasonCode: z.string().nullable(),
  reportedToRegistryAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ImmunisationDto = z.infer<typeof immunisationDtoSchema>;

export function toImmunisationDto(row: ImmunizationRow): ImmunisationDto {
  return {
    id: row.id,
    patientId: row.patientId,
    encounterId: row.encounterId,
    status: row.status,
    cvxCode: row.cvxCode,
    mvxCode: row.mvxCode,
    ndcCode: row.ndcCode,
    display: row.display,
    lotNumber: row.lotNumber,
    expirationDate: dateOnlyOrNull(row.expirationDate),
    siteCode: row.siteCode,
    routeCode: row.routeCode,
    doseQuantity: row.doseQuantity,
    doseUnit: row.doseUnit,
    administeredAt: row.administeredAt.toISOString(),
    administeredById: row.administeredById,
    visDate: dateOnlyOrNull(row.visDate),
    refusalReasonCode: row.refusalReasonCode,
    reportedToRegistryAt: instantOrNull(row.reportedToRegistryAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/* ------------------------------------------------------------ observations */

export const observationListQuerySchema = z.strictObject({
  ...paginationQueryFields,
  patientId: z.uuid().optional(),
  encounterId: z.uuid().optional(),
  category: z.enum(OBSERVATION_CATEGORIES).optional(),
  code: z.string().min(1).max(64).optional(),
  loincCode: z.string().min(1).max(64).optional(),
  /** Inclusive lower bound on `effectiveAt`. */
  from: instantField.optional(),
  /** Exclusive upper bound on `effectiveAt`. */
  to: instantField.optional(),
  sort: z.enum(['effectiveAt', 'createdAt']).default('effectiveAt'),
  order: sortOrderField,
});

export type ObservationListQueryInput = z.infer<typeof observationListQuerySchema>;

export function toObservationListQuery(input: ObservationListQueryInput): ObservationListQuery {
  return {
    page: input.page,
    pageSize: input.pageSize,
    ...(input.patientId === undefined ? {} : { patientId: input.patientId }),
    ...(input.encounterId === undefined ? {} : { encounterId: input.encounterId }),
    ...(input.category === undefined ? {} : { category: input.category }),
    ...(input.code === undefined ? {} : { code: input.code }),
    ...(input.loincCode === undefined ? {} : { loincCode: input.loincCode }),
    ...(input.from === undefined ? {} : { from: new Date(input.from) }),
    ...(input.to === undefined ? {} : { to: new Date(input.to) }),
    sort: input.sort,
    order: input.order,
  };
}

/**
 * The observation patch. `status` is a plain column here: the correction path a
 * result takes once a laboratory has reported it belongs with results, and the
 * only correction this surface performs is `ENTERED_IN_ERROR`.
 */
export const observationPatchSchema = z
  .strictObject({
    status: z.enum(OBSERVATION_STATUSES).optional(),
    valueNumber: z.number().finite().optional(),
    valueText: z.string().min(1).max(256).optional(),
    valueCode: z.string().min(1).max(64).optional(),
    valueBoolean: z.boolean().optional(),
    unit: z.string().min(1).max(32).optional(),
    referenceLow: z.number().finite().optional(),
    referenceHigh: z.number().finite().optional(),
    interpretationCode: z.string().min(1).max(64).optional(),
    issuedAt: instantField.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'the patch must change at least one field',
  })
  .refine(
    (value) =>
      value.referenceLow === undefined ||
      value.referenceHigh === undefined ||
      value.referenceHigh >= value.referenceLow,
    { message: 'referenceHigh must not be below referenceLow', path: ['referenceHigh'] }
  );

export type ObservationPatchBody = z.infer<typeof observationPatchSchema>;

export function toObservationPatch(body: ObservationPatchBody): ObservationPatchInput {
  return {
    ...(body.status === undefined ? {} : { status: body.status }),
    ...(body.valueNumber === undefined ? {} : { valueNumber: body.valueNumber }),
    ...(body.valueText === undefined ? {} : { valueText: body.valueText }),
    ...(body.valueCode === undefined ? {} : { valueCode: body.valueCode }),
    ...(body.valueBoolean === undefined ? {} : { valueBoolean: body.valueBoolean }),
    ...(body.unit === undefined ? {} : { unit: body.unit }),
    ...(body.referenceLow === undefined ? {} : { referenceLow: body.referenceLow }),
    ...(body.referenceHigh === undefined ? {} : { referenceHigh: body.referenceHigh }),
    ...(body.interpretationCode === undefined
      ? {}
      : { interpretationCode: body.interpretationCode }),
    ...(body.issuedAt === undefined ? {} : { issuedAt: new Date(body.issuedAt) }),
  };
}

export const observationDtoSchema = z.strictObject({
  id: z.uuid(),
  patientId: z.uuid(),
  encounterId: z.uuid().nullable(),
  category: z.enum(OBSERVATION_CATEGORIES),
  status: z.enum(OBSERVATION_STATUSES),
  loincCode: z.string().nullable(),
  code: z.string(),
  codeSystem: z.string(),
  display: z.string(),
  valueNumber: z.number().nullable(),
  valueText: z.string().nullable(),
  valueCode: z.string().nullable(),
  valueBoolean: z.boolean().nullable(),
  unit: z.string().nullable(),
  referenceLow: z.number().nullable(),
  referenceHigh: z.number().nullable(),
  interpretationCode: z.string().nullable(),
  bodySiteCode: z.string().nullable(),
  effectiveAt: z.string(),
  issuedAt: z.string().nullable(),
  performerId: z.uuid().nullable(),
  formSubmissionId: z.uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ObservationDto = z.infer<typeof observationDtoSchema>;

export function toObservationDto(row: ObservationRow): ObservationDto {
  return {
    id: row.id,
    patientId: row.patientId,
    encounterId: row.encounterId,
    category: row.category,
    status: row.status,
    loincCode: row.loincCode,
    code: row.code,
    codeSystem: row.codeSystem,
    display: row.display,
    valueNumber: row.valueNumber,
    valueText: row.valueText,
    valueCode: row.valueCode,
    valueBoolean: row.valueBoolean,
    unit: row.unit,
    referenceLow: row.referenceLow,
    referenceHigh: row.referenceHigh,
    interpretationCode: row.interpretationCode,
    bodySiteCode: row.bodySiteCode,
    effectiveAt: row.effectiveAt.toISOString(),
    issuedAt: instantOrNull(row.issuedAt),
    performerId: row.performerId,
    formSubmissionId: row.formSubmissionId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
