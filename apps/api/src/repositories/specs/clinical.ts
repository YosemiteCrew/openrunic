import type {
  AllergyIntoleranceInput,
  ClinicalNoteInput,
  ConditionInput,
  ProcedureInput,
  EncounterCreateInput,
  ImmunizationInput,
  ReferralInput,
  MedicationRequestInput,
  MedicationStatementInput,
  NoteAddendumInput,
  ObservationInput,
} from '@openrunic/database';

import {
  inWindow,
  jsonColumn,
  windowFilter,
  type BaseQuery,
  type CollectionSpec,
  type RowContext,
  type Writable,
} from '../collection.js';
import type { Row, ScopedRow } from '../rows.js';

/**
 * The chart: the visit and everything documented against it.
 *
 * Nine aggregates that a clinician thinks of as one screen - the visit, its
 * note, the problem list, the medication list, allergies, immunisations and the
 * flowsheet - and every one of them is reached through exactly one patient.
 * That is why all but one narrow a patient-scoped token on `patientId`; the
 * exception is the note addendum, which reaches a chart only through the note
 * it hangs off.
 *
 * What is deliberately absent is the state machines. A spec says what a row is
 * and how a query narrows the table; which moves are legal - a note that may be
 * signed, a prescription that may be transmitted - lives in `routes/clinical.ts`
 * next to the handlers that refuse them, because a transition rule hidden in a
 * data-access layer is a transition rule nobody reviewing the endpoint will
 * read.
 */

/* ------------------------------------------------------------------- types */

/**
 * The closed value sets, taken from the columns they are written to rather than
 * restated from the enum tuples. A column and its value set cannot drift apart
 * when one is defined as the other.
 */
export type EncounterClass = Row<'Encounter'>['class'];
export type EncounterStatus = Row<'Encounter'>['status'];
export type NoteState = Row<'ClinicalNote'>['state'];
export type ConditionCategory = Row<'Condition'>['category'];
export type ProcedureStatus = Row<'Procedure'>['status'];
export type ConditionClinicalStatus = Row<'Condition'>['clinicalStatus'];
export type ConditionVerificationStatus = Row<'Condition'>['verificationStatus'];
export type MedicationStatementStatus = Row<'MedicationStatement'>['status'];
export type MedicationSource = Row<'MedicationStatement'>['source'];
export type MedicationRequestStatus = Row<'MedicationRequest'>['status'];
export type MedicationRequestIntent = Row<'MedicationRequest'>['intent'];
export type AllergyType = Row<'AllergyIntolerance'>['type'];
export type AllergyCategory = Row<'AllergyIntolerance'>['category'];
export type AllergyCriticality = Row<'AllergyIntolerance'>['criticality'];
export type AllergyClinicalStatus = Row<'AllergyIntolerance'>['clinicalStatus'];
export type ReactionSeverity = NonNullable<Row<'AllergyIntolerance'>['severity']>;
export type ImmunizationStatus = Row<'Immunization'>['status'];
export type ReferralStatus = Row<'Referral'>['status'];
export type ReferralPriority = Row<'Referral'>['priority'];
export type ObservationCategory = Row<'Observation'>['category'];
export type ObservationStatus = Row<'Observation'>['status'];

/** The stored rows, as the API reads them. */
export type EncounterRow = ScopedRow<'Encounter'>;
export type ClinicalNoteRow = ScopedRow<'ClinicalNote'>;
export type NoteAddendumRow = ScopedRow<'NoteAddendum'>;
export type ConditionRow = ScopedRow<'Condition'>;
export type MedicationStatementRow = ScopedRow<'MedicationStatement'>;
export type MedicationRequestRow = ScopedRow<'MedicationRequest'>;
export type AllergyIntoleranceRow = ScopedRow<'AllergyIntolerance'>;
export type ImmunizationRow = ScopedRow<'Immunization'>;
export type ObservationRow = ScopedRow<'Observation'>;

/* ---------------------------------------------------------------- defaults */

/**
 * Column defaults, mirrored by hand from `schema.prisma`.
 *
 * Postgres applies these at runtime; the in-memory repository has no Postgres,
 * so it applies them from here. `repositories/defaults.ts` holds the same mirror
 * for the core aggregates, and the reason for keeping one copy is the same:
 * without it the suite passes against defaults the database does not have.
 */
const ENCOUNTER_DEFAULTS: { class: EncounterClass; status: EncounterStatus } = {
  class: 'AMBULATORY',
  status: 'PLANNED',
};

const NOTE_DEFAULTS: { state: NoteState } = { state: 'DRAFT' };

const CONDITION_DEFAULTS: {
  category: ConditionCategory;
  codeSystem: string;
  clinicalStatus: ConditionClinicalStatus;
  verificationStatus: ConditionVerificationStatus;
} = {
  category: 'PROBLEM_LIST_ITEM',
  codeSystem: 'http://hl7.org/fhir/sid/icd-10-cm',
  clinicalStatus: 'ACTIVE',
  verificationStatus: 'CONFIRMED',
};

const MEDICATION_STATEMENT_DEFAULTS: {
  status: MedicationStatementStatus;
  source: MedicationSource;
} = { status: 'ACTIVE', source: 'REPORTED' };

const MEDICATION_REQUEST_DEFAULTS: {
  sig: Record<string, unknown>;
  refills: number;
  dispenseAsWritten: boolean;
  status: MedicationRequestStatus;
  intent: MedicationRequestIntent;
} = { sig: {}, refills: 0, dispenseAsWritten: false, status: 'DRAFT', intent: 'ORDER' };

const ALLERGY_DEFAULTS: {
  type: AllergyType;
  category: AllergyCategory;
  criticality: AllergyCriticality;
  clinicalStatus: AllergyClinicalStatus;
} = {
  type: 'ALLERGY',
  category: 'MEDICATION',
  criticality: 'UNABLE_TO_ASSESS',
  clinicalStatus: 'ACTIVE',
};

const IMMUNISATION_DEFAULTS: { status: ImmunizationStatus } = { status: 'COMPLETED' };

const OBSERVATION_DEFAULTS: {
  category: ObservationCategory;
  status: ObservationStatus;
  codeSystem: string;
} = { category: 'VITAL_SIGNS', status: 'FINAL', codeSystem: 'http://loinc.org' };

/**
 * A block list as its column holds it.
 *
 * The write contracts validate a block as "an object of anything", which is
 * `Record<string, unknown>`, while the row type says `JsonValue`. The two
 * describe the same bytes and neither is a subtype of the other, so the
 * conversion happens once here, exactly as {@link jsonColumn} does it for a
 * single object.
 */
function jsonBlocks(blocks: readonly Record<string, unknown>[]): Row<'ClinicalNote'>['blocks'] {
  return [...blocks] as Row<'ClinicalNote'>['blocks'];
}

/* ------------------------------------------------------------- encounters */

export interface EncounterListQuery extends BaseQuery {
  patientId?: string;
  facilityId?: string;
  providerId?: string;
  status?: EncounterStatus;
  /** Inclusive lower bound on `startedAt`. */
  from?: Date;
  /** Exclusive upper bound on `startedAt`. */
  to?: Date;
  sort: 'startedAt' | 'createdAt';
}

/**
 * What an amendment may change, plus the one field only the sign route sets.
 *
 * `signedById` is not on the wire patch schema and never will be: a client that
 * could name the signer could attest to a visit in someone else's name. The
 * route reads it off the verified principal, and the store stamps the instant,
 * so a signature is always "who the token said, when the write happened".
 */
export interface EncounterPatchInput {
  status?: EncounterStatus;
  class?: EncounterClass;
  providerId?: string;
  reasonCode?: string;
  reasonText?: string;
  endedAt?: Date;
  /** Set only by `POST /encounters/{id}/sign`. */
  signedById?: string;
}

export const encounterSpec: CollectionSpec<
  'Encounter',
  EncounterCreateInput,
  EncounterPatchInput,
  EncounterListQuery
> = {
  model: 'Encounter',
  targetType: 'Encounter',
  action: 'encounter',
  patientColumn: 'patientId',
  facilityColumn: 'facilityId',
  facilityScoped: true,
  compartment: { column: 'patientId' },

  // `Encounter.appointmentId` is unique in the schema and is deliberately not
  // declared as a `uniqueBy` here: the column is nullable, and `uniqueBy` cannot
  // say "only when present", so the Prisma probe would become
  // `{ appointmentId: undefined }`, which matches every row rather than none.
  newRow(input: EncounterCreateInput): Writable<'Encounter'> {
    return {
      facilityId: input.facilityId,
      patientId: input.patientId,
      providerId: input.providerId,
      appointmentId: input.appointmentId ?? null,
      class: input.class ?? ENCOUNTER_DEFAULTS.class,
      status: input.status ?? ENCOUNTER_DEFAULTS.status,
      reasonCode: input.reasonCode ?? null,
      reasonText: input.reasonText ?? null,
      startedAt: input.startedAt,
      endedAt: input.endedAt ?? null,
      // A visit is signed through its own route and never at creation: there is
      // nothing to attest to before it has been documented.
      signedAt: null,
      signedById: null,
    };
  },

  patchData(
    patch: EncounterPatchInput,
    before: ScopedRow<'Encounter'>,
    context: RowContext
  ): Partial<Writable<'Encounter'>> {
    return {
      ...(patch.status === undefined ? {} : { status: patch.status }),
      ...(patch.class === undefined ? {} : { class: patch.class }),
      ...(patch.providerId === undefined ? {} : { providerId: patch.providerId }),
      ...(patch.reasonCode === undefined ? {} : { reasonCode: patch.reasonCode }),
      ...(patch.reasonText === undefined ? {} : { reasonText: patch.reasonText }),
      ...(patch.endedAt === undefined ? {} : { endedAt: patch.endedAt }),
      // Stamped from the request's clock, so the signature and the `updatedAt`
      // it lands with name the same instant.
      ...(patch.signedById === undefined
        ? {}
        : { signedAt: context.now, signedById: patch.signedById }),
    };
  },

  matches(row: ScopedRow<'Encounter'>, query: EncounterListQuery): boolean {
    if (query.patientId !== undefined && row.patientId !== query.patientId) return false;
    if (query.facilityId !== undefined && row.facilityId !== query.facilityId) return false;
    if (query.providerId !== undefined && row.providerId !== query.providerId) return false;
    if (query.status !== undefined && row.status !== query.status) return false;
    return inWindow(row.startedAt, query.from, query.to);
  },

  where(query: EncounterListQuery) {
    const startedAt = windowFilter(query.from, query.to);
    return {
      ...(query.patientId === undefined ? {} : { patientId: query.patientId }),
      ...(query.facilityId === undefined ? {} : { facilityId: query.facilityId }),
      ...(query.providerId === undefined ? {} : { providerId: query.providerId }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(startedAt === undefined ? {} : { startedAt }),
    };
  },

  sortValue(row: ScopedRow<'Encounter'>, sort: EncounterListQuery['sort']): number {
    return sort === 'createdAt' ? row.createdAt.getTime() : row.startedAt.getTime();
  },

  orderBy(query: EncounterListQuery) {
    if (query.sort === 'createdAt') return [{ createdAt: query.order }, { id: 'asc' as const }];
    return [{ startedAt: query.order }, { id: 'asc' as const }];
  },

  writeMetadata(
    row: ScopedRow<'Encounter'>,
    before: ScopedRow<'Encounter'> | null
  ): Record<string, unknown> {
    if (before === null) return { status: row.status, class: row.class };
    if (before.signedAt === null && row.signedAt !== null) return { signed: true };
    return before.status === row.status ? {} : { statusFrom: before.status, statusTo: row.status };
  },
};

/* ------------------------------------------------------------ clinical notes */

export interface ClinicalNoteListQuery extends BaseQuery {
  patientId?: string;
  encounterId?: string;
  authorId?: string;
  state?: NoteState;
  sort: 'createdAt' | 'signedAt';
}

/**
 * What an amendment may change on a note.
 *
 * `signedById` is the sign route's, for the same reason as on a visit. `state`
 * is here because a draft still moves between drafting states; the moves that
 * write a signature or an addendum are not reachable through it.
 */
export interface ClinicalNotePatchInput {
  title?: string;
  blocks?: Record<string, unknown>[];
  state?: NoteState;
  cosignerId?: string;
  /** Set only by `POST /notes/{id}/sign`. */
  signedById?: string;
}

export const clinicalNoteSpec: CollectionSpec<
  'ClinicalNote',
  ClinicalNoteInput,
  ClinicalNotePatchInput,
  ClinicalNoteListQuery
> = {
  model: 'ClinicalNote',
  targetType: 'ClinicalNote',
  action: 'note',
  patientColumn: 'patientId',
  encounterColumn: 'encounterId',
  compartment: { column: 'patientId' },

  newRow(input: ClinicalNoteInput): Writable<'ClinicalNote'> {
    return {
      patientId: input.patientId,
      encounterId: input.encounterId,
      authorId: input.authorId,
      title: input.title,
      // The column defaults to `[]`, which this contract never relies on: a
      // block list is required, so an empty note is an explicit empty note.
      blocks: jsonBlocks(input.blocks),
      state: input.state ?? NOTE_DEFAULTS.state,
      cosignerId: input.cosignerId ?? null,
      cosignedAt: null,
      signedAt: null,
      signedById: null,
      lockedAt: null,
    };
  },

  patchData(
    patch: ClinicalNotePatchInput,
    before: ScopedRow<'ClinicalNote'>,
    context: RowContext
  ): Partial<Writable<'ClinicalNote'>> {
    const data: Partial<Writable<'ClinicalNote'>> = {
      ...(patch.title === undefined ? {} : { title: patch.title }),
      ...(patch.blocks === undefined ? {} : { blocks: jsonBlocks(patch.blocks) }),
      ...(patch.state === undefined ? {} : { state: patch.state }),
      ...(patch.cosignerId === undefined ? {} : { cosignerId: patch.cosignerId }),
    };

    if (patch.signedById !== undefined) {
      data.state = 'SIGNED';
      data.signedAt = context.now;
      data.signedById = patch.signedById;
      // Locked with the signature rather than by a later job: a note that is
      // signed but not yet locked is still editable, and that window is exactly
      // what an addendum exists to make unnecessary.
      data.lockedAt = context.now;
    }
    return data;
  },

  matches(row: ScopedRow<'ClinicalNote'>, query: ClinicalNoteListQuery): boolean {
    if (query.patientId !== undefined && row.patientId !== query.patientId) return false;
    if (query.encounterId !== undefined && row.encounterId !== query.encounterId) return false;
    if (query.authorId !== undefined && row.authorId !== query.authorId) return false;
    return query.state === undefined || row.state === query.state;
  },

  where(query: ClinicalNoteListQuery) {
    return {
      ...(query.patientId === undefined ? {} : { patientId: query.patientId }),
      ...(query.encounterId === undefined ? {} : { encounterId: query.encounterId }),
      ...(query.authorId === undefined ? {} : { authorId: query.authorId }),
      ...(query.state === undefined ? {} : { state: query.state }),
    };
  },

  sortValue(row: ScopedRow<'ClinicalNote'>, sort: ClinicalNoteListQuery['sort']): number {
    // An unsigned note sorts last ascending, which is what the signing debt
    // board wants: a note with no signature is not the oldest signed one.
    if (sort === 'signedAt') return row.signedAt?.getTime() ?? Number.POSITIVE_INFINITY;
    return row.createdAt.getTime();
  },

  orderBy(query: ClinicalNoteListQuery) {
    if (query.sort === 'signedAt') return [{ signedAt: query.order }, { id: 'asc' as const }];
    return [{ createdAt: query.order }, { id: 'asc' as const }];
  },

  writeMetadata(
    row: ScopedRow<'ClinicalNote'>,
    before: ScopedRow<'ClinicalNote'> | null
  ): Record<string, unknown> {
    if (before === null) return { state: row.state };
    return before.state === row.state ? {} : { stateFrom: before.state, stateTo: row.state };
  },
};

/* ------------------------------------------------------------ note addenda */

export interface NoteAddendumListQuery extends BaseQuery {
  noteId?: string;
  authorId?: string;
  sort: 'createdAt';
}

export const noteAddendumSpec: CollectionSpec<
  'NoteAddendum',
  NoteAddendumInput,
  never,
  NoteAddendumListQuery
> = {
  model: 'NoteAddendum',
  targetType: 'NoteAddendum',
  action: 'note.addendum',
  /**
   * The only aggregate on this chart with no patient column. An addendum names
   * its note and nothing else, so narrowing it to a compartment would take a
   * join this layer does not perform; a patient-scoped token is therefore
   * refused the table outright rather than served one nobody narrowed. The
   * portal reads addenda through the note, which is narrowed.
   */
  compartment: 'closed',

  newRow(input: NoteAddendumInput, context): Writable<'NoteAddendum'> {
    return {
      noteId: input.noteId,
      authorId: input.authorId,
      blocks: jsonBlocks(input.blocks),
      reason: input.reason ?? null,
      // An addendum may only be written against a signed note, so it is signed
      // as it is written. There is no draft state for one: an unsigned addendum
      // to a signed note would just be an edit under another name.
      signedAt: context.now,
    };
  },

  /**
   * An addendum is not amendable. It exists because the note it hangs off was
   * not, and a correction to a correction is another addendum.
   */
  patchData(): Partial<Writable<'NoteAddendum'>> {
    return {};
  },

  matches(row: ScopedRow<'NoteAddendum'>, query: NoteAddendumListQuery): boolean {
    if (query.noteId !== undefined && row.noteId !== query.noteId) return false;
    return query.authorId === undefined || row.authorId === query.authorId;
  },

  where(query: NoteAddendumListQuery) {
    return {
      ...(query.noteId === undefined ? {} : { noteId: query.noteId }),
      ...(query.authorId === undefined ? {} : { authorId: query.authorId }),
    };
  },

  sortValue(row: ScopedRow<'NoteAddendum'>): number {
    return row.createdAt.getTime();
  },

  orderBy(query: NoteAddendumListQuery) {
    return [{ createdAt: query.order }, { id: 'asc' as const }];
  },
};

/* --------------------------------------------------------------- problems */

export interface ConditionListQuery extends BaseQuery {
  patientId?: string;
  encounterId?: string;
  category?: ConditionCategory;
  clinicalStatus?: ConditionClinicalStatus;
  code?: string;
  sort: 'recordedAt' | 'createdAt';
}

export interface ConditionPatchInput {
  category?: ConditionCategory;
  display?: string;
  clinicalStatus?: ConditionClinicalStatus;
  verificationStatus?: ConditionVerificationStatus;
  abatementDate?: Date;
  severityCode?: string;
  bodySiteCode?: string;
  note?: string;
}

/**
 * Procedures performed, which no other collection records.
 *
 * `ServiceRequest` holds what was asked for and `ChargeItem` what is billed, so
 * a procedure carried out and not billed - most of a clinical day - lives only
 * here.
 */
export interface ProcedureListQuery extends BaseQuery {
  patientId?: string;
  encounterId?: string;
  status?: ProcedureStatus;
  code?: string;
  sort: 'performedStart' | 'createdAt';
}

export type ProcedurePatchInput = Partial<Omit<ProcedureInput, 'patientId'>>;

/**
 * CPT rather than SNOMED CT, because that is what a US practice codes a
 * procedure in and what the charge beside it carries. The SNOMED equivalent US
 * Core prefers has its own column rather than overwriting this one.
 */
const PROCEDURE_DEFAULTS: { codeSystem: string; status: ProcedureStatus } = {
  codeSystem: 'http://www.ama-assn.org/go/cpt',
  status: 'COMPLETED',
};

export const procedureSpec: CollectionSpec<
  'Procedure',
  ProcedureInput,
  ProcedurePatchInput,
  ProcedureListQuery
> = {
  model: 'Procedure',
  targetType: 'Procedure',
  action: 'procedure',
  patientColumn: 'patientId',
  encounterColumn: 'encounterId',
  compartment: { column: 'patientId' },

  newRow(input: ProcedureInput, context): Writable<'Procedure'> {
    return {
      patientId: input.patientId,
      encounterId: input.encounterId ?? null,
      code: input.code,
      codeSystem: input.codeSystem ?? PROCEDURE_DEFAULTS.codeSystem,
      display: input.display,
      snomedCode: input.snomedCode ?? null,
      status: input.status ?? PROCEDURE_DEFAULTS.status,
      performedStart: input.performedStart,
      performedEnd: input.performedEnd ?? null,
      bodySiteCode: input.bodySiteCode ?? null,
      outcomeCode: input.outcomeCode ?? null,
      notDoneReason: input.notDoneReason ?? null,
      note: input.note ?? null,
      performedById: input.performedById ?? null,
      recordedAt: context.now,
      recordedById: input.recordedById ?? null,
    };
  },

  patchData(patch: ProcedurePatchInput): Partial<Writable<'Procedure'>> {
    return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
  },

  matches(row: ScopedRow<'Procedure'>, query: ProcedureListQuery): boolean {
    if (query.patientId !== undefined && row.patientId !== query.patientId) return false;
    if (query.encounterId !== undefined && row.encounterId !== query.encounterId) return false;
    if (query.status !== undefined && row.status !== query.status) return false;
    return query.code === undefined || row.code === query.code;
  },

  where(query: ProcedureListQuery) {
    return {
      ...(query.patientId === undefined ? {} : { patientId: query.patientId }),
      ...(query.encounterId === undefined ? {} : { encounterId: query.encounterId }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.code === undefined ? {} : { code: query.code }),
    };
  },

  sortValue(row: ScopedRow<'Procedure'>, sort: ProcedureListQuery['sort']): number {
    return sort === 'createdAt' ? row.createdAt.getTime() : row.performedStart.getTime();
  },

  orderBy(query: ProcedureListQuery) {
    const { order } = query;
    if (query.sort === 'createdAt') return [{ createdAt: order }, { id: 'asc' as const }];
    return [{ performedStart: order }, { id: 'asc' as const }];
  },
};

export const conditionSpec: CollectionSpec<
  'Condition',
  ConditionInput,
  ConditionPatchInput,
  ConditionListQuery
> = {
  model: 'Condition',
  targetType: 'Condition',
  action: 'condition',
  patientColumn: 'patientId',
  encounterColumn: 'encounterId',
  compartment: { column: 'patientId' },

  newRow(input: ConditionInput, context): Writable<'Condition'> {
    return {
      patientId: input.patientId,
      encounterId: input.encounterId ?? null,
      category: input.category ?? CONDITION_DEFAULTS.category,
      code: input.code,
      codeSystem: input.codeSystem ?? CONDITION_DEFAULTS.codeSystem,
      display: input.display,
      snomedCode: input.snomedCode ?? null,
      clinicalStatus: input.clinicalStatus ?? CONDITION_DEFAULTS.clinicalStatus,
      verificationStatus: input.verificationStatus ?? CONDITION_DEFAULTS.verificationStatus,
      onsetDate: input.onsetDate ?? null,
      abatementDate: input.abatementDate ?? null,
      severityCode: input.severityCode ?? null,
      bodySiteCode: input.bodySiteCode ?? null,
      note: input.note ?? null,
      recordedAt: context.now,
      // Who recorded it is on the write event rather than on the row: the write
      // contract carries no recorder, and inventing one from the token would
      // make the column disagree with the audit trail for imports and merges.
      recordedById: null,
    };
  },

  patchData(patch: ConditionPatchInput): Partial<Writable<'Condition'>> {
    return {
      ...(patch.category === undefined ? {} : { category: patch.category }),
      ...(patch.display === undefined ? {} : { display: patch.display }),
      ...(patch.clinicalStatus === undefined ? {} : { clinicalStatus: patch.clinicalStatus }),
      ...(patch.verificationStatus === undefined
        ? {}
        : { verificationStatus: patch.verificationStatus }),
      ...(patch.abatementDate === undefined ? {} : { abatementDate: patch.abatementDate }),
      ...(patch.severityCode === undefined ? {} : { severityCode: patch.severityCode }),
      ...(patch.bodySiteCode === undefined ? {} : { bodySiteCode: patch.bodySiteCode }),
      ...(patch.note === undefined ? {} : { note: patch.note }),
    };
  },

  matches(row: ScopedRow<'Condition'>, query: ConditionListQuery): boolean {
    if (query.patientId !== undefined && row.patientId !== query.patientId) return false;
    if (query.encounterId !== undefined && row.encounterId !== query.encounterId) return false;
    if (query.category !== undefined && row.category !== query.category) return false;
    if (query.clinicalStatus !== undefined && row.clinicalStatus !== query.clinicalStatus) {
      return false;
    }
    return query.code === undefined || row.code === query.code;
  },

  where(query: ConditionListQuery) {
    return {
      ...(query.patientId === undefined ? {} : { patientId: query.patientId }),
      ...(query.encounterId === undefined ? {} : { encounterId: query.encounterId }),
      ...(query.category === undefined ? {} : { category: query.category }),
      ...(query.clinicalStatus === undefined ? {} : { clinicalStatus: query.clinicalStatus }),
      ...(query.code === undefined ? {} : { code: query.code }),
    };
  },

  sortValue(row: ScopedRow<'Condition'>, sort: ConditionListQuery['sort']): number {
    return sort === 'createdAt' ? row.createdAt.getTime() : row.recordedAt.getTime();
  },

  orderBy(query: ConditionListQuery) {
    if (query.sort === 'createdAt') return [{ createdAt: query.order }, { id: 'asc' as const }];
    return [{ recordedAt: query.order }, { id: 'asc' as const }];
  },
};

/* --------------------------------------------------- medication statements */

export interface MedicationStatementListQuery extends BaseQuery {
  patientId?: string;
  encounterId?: string;
  status?: MedicationStatementStatus;
  sort: 'reportedAt' | 'createdAt';
}

export interface MedicationStatementPatchInput {
  status?: MedicationStatementStatus;
  source?: MedicationSource;
  display?: string;
  sigText?: string;
  effectiveEnd?: Date;
  note?: string;
}

export const medicationStatementSpec: CollectionSpec<
  'MedicationStatement',
  MedicationStatementInput,
  MedicationStatementPatchInput,
  MedicationStatementListQuery
> = {
  model: 'MedicationStatement',
  targetType: 'MedicationStatement',
  action: 'medication.statement',
  patientColumn: 'patientId',
  encounterColumn: 'encounterId',
  compartment: { column: 'patientId' },

  newRow(input: MedicationStatementInput, context): Writable<'MedicationStatement'> {
    return {
      patientId: input.patientId,
      encounterId: input.encounterId ?? null,
      rxnormCode: input.rxnormCode ?? null,
      display: input.display,
      sigText: input.sigText ?? null,
      status: input.status ?? MEDICATION_STATEMENT_DEFAULTS.status,
      source: input.source ?? MEDICATION_STATEMENT_DEFAULTS.source,
      effectiveStart: input.effectiveStart ?? null,
      effectiveEnd: input.effectiveEnd ?? null,
      reportedAt: context.now,
      note: input.note ?? null,
    };
  },

  patchData(patch: MedicationStatementPatchInput): Partial<Writable<'MedicationStatement'>> {
    return {
      ...(patch.status === undefined ? {} : { status: patch.status }),
      ...(patch.source === undefined ? {} : { source: patch.source }),
      ...(patch.display === undefined ? {} : { display: patch.display }),
      ...(patch.sigText === undefined ? {} : { sigText: patch.sigText }),
      ...(patch.effectiveEnd === undefined ? {} : { effectiveEnd: patch.effectiveEnd }),
      ...(patch.note === undefined ? {} : { note: patch.note }),
    };
  },

  matches(row: ScopedRow<'MedicationStatement'>, query: MedicationStatementListQuery): boolean {
    if (query.patientId !== undefined && row.patientId !== query.patientId) return false;
    if (query.encounterId !== undefined && row.encounterId !== query.encounterId) return false;
    return query.status === undefined || row.status === query.status;
  },

  where(query: MedicationStatementListQuery) {
    return {
      ...(query.patientId === undefined ? {} : { patientId: query.patientId }),
      ...(query.encounterId === undefined ? {} : { encounterId: query.encounterId }),
      ...(query.status === undefined ? {} : { status: query.status }),
    };
  },

  sortValue(
    row: ScopedRow<'MedicationStatement'>,
    sort: MedicationStatementListQuery['sort']
  ): number {
    return sort === 'createdAt' ? row.createdAt.getTime() : row.reportedAt.getTime();
  },

  orderBy(query: MedicationStatementListQuery) {
    if (query.sort === 'createdAt') return [{ createdAt: query.order }, { id: 'asc' as const }];
    return [{ reportedAt: query.order }, { id: 'asc' as const }];
  },
};

/* -------------------------------------------------------- prescriptions */

export interface MedicationRequestListQuery extends BaseQuery {
  patientId?: string;
  encounterId?: string;
  prescriberId?: string;
  status?: MedicationRequestStatus;
  sort: 'writtenAt' | 'createdAt';
}

/**
 * What an amendment may change on a prescription.
 *
 * `status` is absent from the wire schema and present here: the three moves a
 * prescription makes - signed, transmitted, cancelled - each have a route,
 * because each one has to stamp something or check something that a bare status
 * write would skip.
 */
export interface MedicationRequestPatchInput {
  display?: string;
  sigText?: string;
  quantity?: number;
  quantityUnit?: string;
  refills?: number;
  daysSupply?: number;
  dispenseAsWritten?: boolean;
  pharmacyName?: string;
  pharmacyNcpdpId?: string;
  /** Set only by the sign, transmit and cancel routes. */
  status?: MedicationRequestStatus;
}

export const medicationRequestSpec: CollectionSpec<
  'MedicationRequest',
  MedicationRequestInput,
  MedicationRequestPatchInput,
  MedicationRequestListQuery
> = {
  model: 'MedicationRequest',
  targetType: 'MedicationRequest',
  action: 'medication.request',
  patientColumn: 'patientId',
  encounterColumn: 'encounterId',
  compartment: { column: 'patientId' },

  newRow(input: MedicationRequestInput, context): Writable<'MedicationRequest'> {
    return {
      patientId: input.patientId,
      encounterId: input.encounterId ?? null,
      prescriberId: input.prescriberId,
      rxnormCode: input.rxnormCode ?? null,
      ndcCode: input.ndcCode ?? null,
      display: input.display,
      sig: jsonColumn(input.sig ?? MEDICATION_REQUEST_DEFAULTS.sig),
      sigText: input.sigText,
      quantity: input.quantity,
      quantityUnit: input.quantityUnit,
      refills: input.refills,
      daysSupply: input.daysSupply ?? null,
      dispenseAsWritten: input.dispenseAsWritten ?? MEDICATION_REQUEST_DEFAULTS.dispenseAsWritten,
      controlledSchedule: input.controlledSchedule ?? null,
      pharmacyName: input.pharmacyName ?? null,
      pharmacyNcpdpId: input.pharmacyNcpdpId ?? null,
      status: input.status ?? MEDICATION_REQUEST_DEFAULTS.status,
      intent: input.intent ?? MEDICATION_REQUEST_DEFAULTS.intent,
      // The adapter's reference and the transmission stamp are written when the
      // prescription actually leaves, which is the transmit route's job.
      erxRef: null,
      writtenAt: context.now,
      transmittedAt: null,
    };
  },

  patchData(
    patch: MedicationRequestPatchInput,
    before: ScopedRow<'MedicationRequest'>,
    context: RowContext
  ): Partial<Writable<'MedicationRequest'>> {
    const data: Partial<Writable<'MedicationRequest'>> = {
      ...(patch.display === undefined ? {} : { display: patch.display }),
      ...(patch.sigText === undefined ? {} : { sigText: patch.sigText }),
      ...(patch.quantity === undefined ? {} : { quantity: patch.quantity }),
      ...(patch.quantityUnit === undefined ? {} : { quantityUnit: patch.quantityUnit }),
      ...(patch.refills === undefined ? {} : { refills: patch.refills }),
      ...(patch.daysSupply === undefined ? {} : { daysSupply: patch.daysSupply }),
      ...(patch.dispenseAsWritten === undefined
        ? {}
        : { dispenseAsWritten: patch.dispenseAsWritten }),
      ...(patch.pharmacyName === undefined ? {} : { pharmacyName: patch.pharmacyName }),
      ...(patch.pharmacyNcpdpId === undefined ? {} : { pharmacyNcpdpId: patch.pharmacyNcpdpId }),
      ...(patch.status === undefined ? {} : { status: patch.status }),
    };

    // Stamped where the status is set rather than by a later job, so "when did
    // this leave for the pharmacy" is answerable from the row that says it did.
    if (patch.status === 'TRANSMITTED' && before.transmittedAt === null) {
      data.transmittedAt = context.now;
    }
    return data;
  },

  matches(row: ScopedRow<'MedicationRequest'>, query: MedicationRequestListQuery): boolean {
    if (query.patientId !== undefined && row.patientId !== query.patientId) return false;
    if (query.encounterId !== undefined && row.encounterId !== query.encounterId) return false;
    if (query.prescriberId !== undefined && row.prescriberId !== query.prescriberId) return false;
    return query.status === undefined || row.status === query.status;
  },

  where(query: MedicationRequestListQuery) {
    return {
      ...(query.patientId === undefined ? {} : { patientId: query.patientId }),
      ...(query.encounterId === undefined ? {} : { encounterId: query.encounterId }),
      ...(query.prescriberId === undefined ? {} : { prescriberId: query.prescriberId }),
      ...(query.status === undefined ? {} : { status: query.status }),
    };
  },

  sortValue(row: ScopedRow<'MedicationRequest'>, sort: MedicationRequestListQuery['sort']): number {
    return sort === 'createdAt' ? row.createdAt.getTime() : row.writtenAt.getTime();
  },

  orderBy(query: MedicationRequestListQuery) {
    if (query.sort === 'createdAt') return [{ createdAt: query.order }, { id: 'asc' as const }];
    return [{ writtenAt: query.order }, { id: 'asc' as const }];
  },

  writeMetadata(
    row: ScopedRow<'MedicationRequest'>,
    before: ScopedRow<'MedicationRequest'> | null
  ): Record<string, unknown> {
    if (before === null) return { status: row.status, intent: row.intent };
    return before.status === row.status ? {} : { statusFrom: before.status, statusTo: row.status };
  },
};

/* -------------------------------------------------------------- allergies */

export interface AllergyListQuery extends BaseQuery {
  patientId?: string;
  clinicalStatus?: AllergyClinicalStatus;
  criticality?: AllergyCriticality;
  sort: 'recordedAt' | 'createdAt';
}

export interface AllergyPatchInput {
  clinicalStatus?: AllergyClinicalStatus;
  criticality?: AllergyCriticality;
  category?: AllergyCategory;
  severity?: ReactionSeverity;
  reactionCodes?: string[];
  reactionText?: string;
  note?: string;
}

export const allergySpec: CollectionSpec<
  'AllergyIntolerance',
  AllergyIntoleranceInput,
  AllergyPatchInput,
  AllergyListQuery
> = {
  model: 'AllergyIntolerance',
  targetType: 'AllergyIntolerance',
  action: 'allergy',
  patientColumn: 'patientId',
  compartment: { column: 'patientId' },

  newRow(input: AllergyIntoleranceInput, context): Writable<'AllergyIntolerance'> {
    return {
      patientId: input.patientId,
      type: input.type ?? ALLERGY_DEFAULTS.type,
      category: input.category ?? ALLERGY_DEFAULTS.category,
      criticality: input.criticality ?? ALLERGY_DEFAULTS.criticality,
      clinicalStatus: input.clinicalStatus ?? ALLERGY_DEFAULTS.clinicalStatus,
      substanceCode: input.substanceCode ?? null,
      substanceCodeSystem: input.substanceCodeSystem ?? null,
      substanceDisplay: input.substanceDisplay,
      reactionCodes: [...(input.reactionCodes ?? [])],
      reactionText: input.reactionText ?? null,
      // Severity has no default in the schema: an unrecorded reaction severity
      // is not a mild one.
      severity: input.severity ?? null,
      onsetDate: input.onsetDate ?? null,
      note: input.note ?? null,
      recordedAt: context.now,
      recordedById: null,
    };
  },

  patchData(patch: AllergyPatchInput): Partial<Writable<'AllergyIntolerance'>> {
    return {
      ...(patch.clinicalStatus === undefined ? {} : { clinicalStatus: patch.clinicalStatus }),
      ...(patch.criticality === undefined ? {} : { criticality: patch.criticality }),
      ...(patch.category === undefined ? {} : { category: patch.category }),
      ...(patch.severity === undefined ? {} : { severity: patch.severity }),
      ...(patch.reactionCodes === undefined ? {} : { reactionCodes: [...patch.reactionCodes] }),
      ...(patch.reactionText === undefined ? {} : { reactionText: patch.reactionText }),
      ...(patch.note === undefined ? {} : { note: patch.note }),
    };
  },

  matches(row: ScopedRow<'AllergyIntolerance'>, query: AllergyListQuery): boolean {
    if (query.patientId !== undefined && row.patientId !== query.patientId) return false;
    if (query.clinicalStatus !== undefined && row.clinicalStatus !== query.clinicalStatus) {
      return false;
    }
    return query.criticality === undefined || row.criticality === query.criticality;
  },

  where(query: AllergyListQuery) {
    return {
      ...(query.patientId === undefined ? {} : { patientId: query.patientId }),
      ...(query.clinicalStatus === undefined ? {} : { clinicalStatus: query.clinicalStatus }),
      ...(query.criticality === undefined ? {} : { criticality: query.criticality }),
    };
  },

  sortValue(row: ScopedRow<'AllergyIntolerance'>, sort: AllergyListQuery['sort']): number {
    return sort === 'createdAt' ? row.createdAt.getTime() : row.recordedAt.getTime();
  },

  orderBy(query: AllergyListQuery) {
    if (query.sort === 'createdAt') return [{ createdAt: query.order }, { id: 'asc' as const }];
    return [{ recordedAt: query.order }, { id: 'asc' as const }];
  },
};

/* ---------------------------------------------------------- immunisations */

export interface ImmunisationListQuery extends BaseQuery {
  patientId?: string;
  encounterId?: string;
  cvxCode?: string;
  /** Inclusive lower bound on `administeredAt`. */
  from?: Date;
  /** Exclusive upper bound on `administeredAt`. */
  to?: Date;
  sort: 'administeredAt' | 'createdAt';
}

export interface ImmunisationPatchInput {
  status?: ImmunizationStatus;
  lotNumber?: string;
  expirationDate?: Date;
  siteCode?: string;
  routeCode?: string;
  refusalReasonCode?: string;
  /** Stamped when the dose has been reported to the jurisdiction's registry. */
  reportedToRegistryAt?: Date;
}

export const immunisationSpec: CollectionSpec<
  'Immunization',
  ImmunizationInput,
  ImmunisationPatchInput,
  ImmunisationListQuery
> = {
  // The model keeps FHIR's spelling; the API path and this key keep the
  // product's. Both are deliberate, and this is the one line where they meet.
  model: 'Immunization',
  targetType: 'Immunization',
  action: 'immunisation',
  patientColumn: 'patientId',
  encounterColumn: 'encounterId',
  compartment: { column: 'patientId' },

  newRow(input: ImmunizationInput): Writable<'Immunization'> {
    return {
      patientId: input.patientId,
      encounterId: input.encounterId ?? null,
      status: input.status ?? IMMUNISATION_DEFAULTS.status,
      cvxCode: input.cvxCode,
      mvxCode: input.mvxCode ?? null,
      ndcCode: input.ndcCode ?? null,
      display: input.display,
      lotNumber: input.lotNumber ?? null,
      expirationDate: input.expirationDate ?? null,
      siteCode: input.siteCode ?? null,
      routeCode: input.routeCode ?? null,
      doseQuantity: input.doseQuantity ?? null,
      doseUnit: input.doseUnit ?? null,
      administeredAt: input.administeredAt,
      administeredById: input.administeredById ?? null,
      visDate: input.visDate ?? null,
      refusalReasonCode: input.refusalReasonCode ?? null,
      // Reporting is an outbound job's stamp, not something a dose is born with.
      reportedToRegistryAt: null,
    };
  },

  patchData(patch: ImmunisationPatchInput): Partial<Writable<'Immunization'>> {
    return {
      ...(patch.status === undefined ? {} : { status: patch.status }),
      ...(patch.lotNumber === undefined ? {} : { lotNumber: patch.lotNumber }),
      ...(patch.expirationDate === undefined ? {} : { expirationDate: patch.expirationDate }),
      ...(patch.siteCode === undefined ? {} : { siteCode: patch.siteCode }),
      ...(patch.routeCode === undefined ? {} : { routeCode: patch.routeCode }),
      ...(patch.refusalReasonCode === undefined
        ? {}
        : { refusalReasonCode: patch.refusalReasonCode }),
      ...(patch.reportedToRegistryAt === undefined
        ? {}
        : { reportedToRegistryAt: patch.reportedToRegistryAt }),
    };
  },

  matches(row: ScopedRow<'Immunization'>, query: ImmunisationListQuery): boolean {
    if (query.patientId !== undefined && row.patientId !== query.patientId) return false;
    if (query.encounterId !== undefined && row.encounterId !== query.encounterId) return false;
    if (query.cvxCode !== undefined && row.cvxCode !== query.cvxCode) return false;
    return inWindow(row.administeredAt, query.from, query.to);
  },

  where(query: ImmunisationListQuery) {
    const administeredAt = windowFilter(query.from, query.to);
    return {
      ...(query.patientId === undefined ? {} : { patientId: query.patientId }),
      ...(query.encounterId === undefined ? {} : { encounterId: query.encounterId }),
      ...(query.cvxCode === undefined ? {} : { cvxCode: query.cvxCode }),
      ...(administeredAt === undefined ? {} : { administeredAt }),
    };
  },

  sortValue(row: ScopedRow<'Immunization'>, sort: ImmunisationListQuery['sort']): number {
    return sort === 'createdAt' ? row.createdAt.getTime() : row.administeredAt.getTime();
  },

  orderBy(query: ImmunisationListQuery) {
    if (query.sort === 'createdAt') return [{ createdAt: query.order }, { id: 'asc' as const }];
    return [{ administeredAt: query.order }, { id: 'asc' as const }];
  },
};

/* ------------------------------------------------------------ observations */

export interface ObservationListQuery extends BaseQuery {
  patientId?: string;
  encounterId?: string;
  category?: ObservationCategory;
  code?: string;
  loincCode?: string;
  /** Inclusive lower bound on `effectiveAt`. */
  from?: Date;
  /** Exclusive upper bound on `effectiveAt`. */
  to?: Date;
  sort: 'effectiveAt' | 'createdAt';
}

export interface ObservationPatchInput {
  status?: ObservationStatus;
  valueNumber?: number;
  valueText?: string;
  valueCode?: string;
  valueBoolean?: boolean;
  unit?: string;
  referenceLow?: number;
  referenceHigh?: number;
  interpretationCode?: string;
  issuedAt?: Date;
}

export const observationSpec: CollectionSpec<
  'Observation',
  ObservationInput,
  ObservationPatchInput,
  ObservationListQuery
> = {
  model: 'Observation',
  targetType: 'Observation',
  action: 'observation',
  patientColumn: 'patientId',
  encounterColumn: 'encounterId',
  compartment: { column: 'patientId' },

  newRow(input: ObservationInput): Writable<'Observation'> {
    return {
      patientId: input.patientId,
      encounterId: input.encounterId ?? null,
      category: input.category ?? OBSERVATION_DEFAULTS.category,
      status: input.status ?? OBSERVATION_DEFAULTS.status,
      loincCode: input.loincCode ?? null,
      code: input.code,
      codeSystem: input.codeSystem ?? OBSERVATION_DEFAULTS.codeSystem,
      display: input.display,
      valueNumber: input.valueNumber ?? null,
      valueText: input.valueText ?? null,
      valueCode: input.valueCode ?? null,
      valueBoolean: input.valueBoolean ?? null,
      unit: input.unit ?? null,
      referenceLow: input.referenceLow ?? null,
      referenceHigh: input.referenceHigh ?? null,
      interpretationCode: input.interpretationCode ?? null,
      bodySiteCode: input.bodySiteCode ?? null,
      effectiveAt: input.effectiveAt,
      issuedAt: input.issuedAt ?? null,
      performerId: input.performerId ?? null,
      formSubmissionId: input.formSubmissionId ?? null,
    };
  },

  patchData(patch: ObservationPatchInput): Partial<Writable<'Observation'>> {
    return {
      ...(patch.status === undefined ? {} : { status: patch.status }),
      ...(patch.valueNumber === undefined ? {} : { valueNumber: patch.valueNumber }),
      ...(patch.valueText === undefined ? {} : { valueText: patch.valueText }),
      ...(patch.valueCode === undefined ? {} : { valueCode: patch.valueCode }),
      ...(patch.valueBoolean === undefined ? {} : { valueBoolean: patch.valueBoolean }),
      ...(patch.unit === undefined ? {} : { unit: patch.unit }),
      ...(patch.referenceLow === undefined ? {} : { referenceLow: patch.referenceLow }),
      ...(patch.referenceHigh === undefined ? {} : { referenceHigh: patch.referenceHigh }),
      ...(patch.interpretationCode === undefined
        ? {}
        : { interpretationCode: patch.interpretationCode }),
      ...(patch.issuedAt === undefined ? {} : { issuedAt: patch.issuedAt }),
    };
  },

  matches(row: ScopedRow<'Observation'>, query: ObservationListQuery): boolean {
    if (query.patientId !== undefined && row.patientId !== query.patientId) return false;
    if (query.encounterId !== undefined && row.encounterId !== query.encounterId) return false;
    if (query.category !== undefined && row.category !== query.category) return false;
    if (query.code !== undefined && row.code !== query.code) return false;
    if (query.loincCode !== undefined && row.loincCode !== query.loincCode) return false;
    return inWindow(row.effectiveAt, query.from, query.to);
  },

  where(query: ObservationListQuery) {
    const effectiveAt = windowFilter(query.from, query.to);
    return {
      ...(query.patientId === undefined ? {} : { patientId: query.patientId }),
      ...(query.encounterId === undefined ? {} : { encounterId: query.encounterId }),
      ...(query.category === undefined ? {} : { category: query.category }),
      ...(query.code === undefined ? {} : { code: query.code }),
      ...(query.loincCode === undefined ? {} : { loincCode: query.loincCode }),
      ...(effectiveAt === undefined ? {} : { effectiveAt }),
    };
  },

  sortValue(row: ScopedRow<'Observation'>, sort: ObservationListQuery['sort']): number {
    return sort === 'createdAt' ? row.createdAt.getTime() : row.effectiveAt.getTime();
  },

  orderBy(query: ObservationListQuery) {
    if (query.sort === 'createdAt') return [{ createdAt: query.order }, { id: 'asc' as const }];
    return [{ effectiveAt: query.order }, { id: 'asc' as const }];
  },
};

/* --------------------------------------------------------------- referrals */

export interface ReferralListQuery extends BaseQuery {
  patientId?: string;
  encounterId?: string;
  referredById?: string;
  status?: ReferralStatus;
  priority?: ReferralPriority;
  specialtyCode?: string;
  /**
   * The tray filter: referrals that have been sent and have not closed.
   *
   * A named flag rather than a status list the caller assembles, because "still
   * open" is a clinical question with one right answer and every caller
   * assembling their own list is how two screens come to disagree about how many
   * referrals are outstanding.
   */
  openOnly?: boolean;
  /** Inclusive lower bound on `createdAt`. */
  from?: Date;
  /** Exclusive upper bound on `createdAt`. */
  to?: Date;
  sort: 'createdAt' | 'sentAt' | 'priority';
}

export interface ReferralPatchInput {
  status?: ReferralStatus;
  /** Server-stamped when the referral is sent; never accepted from a caller. */
  sentAt?: Date;
  priority?: ReferralPriority;
  receivingPractice?: string;
  receivingNpi?: string | null;
  receivingPhone?: string | null;
  reasonCodes?: string[];
  reasonText?: string | null;
  note?: string | null;
  authorisationNumber?: string | null;
  scheduledFor?: Date | null;
  seenAt?: Date | null;
  reportReceivedAt?: Date | null;
  reportDocumentId?: string | null;
  declinedReason?: string | null;
}

/**
 * A referral is open once it has been sent and until somebody has both seen the
 * patient and sent a report back. The two terminal-but-not-closed statuses -
 * declined and cancelled - are out, because nothing further is owed on them.
 */
export const OPEN_REFERRAL_STATUSES: readonly ReferralStatus[] = [
  'SENT',
  'ACCEPTED',
  'SCHEDULED',
  'SEEN',
];

/** Ordering for the tray, most urgent first. */
const PRIORITY_RANK: Readonly<Record<ReferralPriority, number>> = {
  ASAP: 0,
  URGENT: 1,
  ROUTINE: 2,
};

/**
 * The statuses a referral query accepts, as one set.
 *
 * `status` names one; `openOnly` names the outstanding tray. Both used to write
 * the same `where` key from two spreads, so with both set the second won at
 * construction and the explicit status simply vanished from the Postgres query
 * while `matches` went on ANDing them. `?status=DECLINED&openOnly=true`
 * returned nothing in memory, where every test runs, and the entire open tray
 * from the database.
 *
 * Resolving them here means both ports read one decision. `undefined` is no
 * status filter; an empty array is one that matches nothing, which is the
 * honest answer for a status that is not open being asked for inside the open
 * tray.
 *
 * This is the ONLY place either port reads the status decision from, and it has
 * to stay that way. `matches` used to keep a scalar `row.status === query.status`
 * test alongside this one. That was inert - the two agreed on all 270
 * combinations - but it meant `matches` narrowed on something `where` did not,
 * so any future widening here would have split the ports again while the scalar
 * quietly held the memory side together. One decision, read twice.
 */
function referralStatuses(query: ReferralListQuery): readonly ReferralStatus[] | undefined {
  const open = query.openOnly === true ? OPEN_REFERRAL_STATUSES : undefined;
  const { status } = query;
  if (open === undefined) return status === undefined ? undefined : [status];
  if (status === undefined) return open;
  return open.includes(status) ? [status] : [];
}

export const referralSpec: CollectionSpec<
  'Referral',
  ReferralInput,
  ReferralPatchInput,
  ReferralListQuery
> = {
  model: 'Referral',
  targetType: 'Referral',
  action: 'referral',
  patientColumn: 'patientId',
  encounterColumn: 'encounterId',
  compartment: { column: 'patientId' },

  newRow(input: ReferralInput): Writable<'Referral'> {
    return {
      patientId: input.patientId,
      encounterId: input.encounterId ?? null,
      referredById: input.referredById,
      // A referral is born a draft even when the caller means to send it
      // immediately. Sending is a transition with its own timestamp, and one
      // that starts in SENT would be a referral with no record of when.
      status: 'DRAFT',
      priority: input.priority ?? 'ROUTINE',
      specialtyCode: input.specialtyCode,
      specialtyDisplay: input.specialtyDisplay,
      receivingPractice: input.receivingPractice,
      receivingNpi: input.receivingNpi ?? null,
      receivingPhone: input.receivingPhone ?? null,
      reasonCodes: input.reasonCodes ?? [],
      reasonText: input.reasonText ?? null,
      note: input.note ?? null,
      authorisationNumber: input.authorisationNumber ?? null,
      // Every one of these is a fact about the world that has not happened yet.
      sentAt: null,
      scheduledFor: null,
      seenAt: null,
      reportReceivedAt: null,
      reportDocumentId: null,
      declinedReason: null,
    };
  },

  patchData(patch: ReferralPatchInput): Partial<Writable<'Referral'>> {
    return {
      ...(patch.status === undefined ? {} : { status: patch.status }),
      ...(patch.sentAt === undefined ? {} : { sentAt: patch.sentAt }),
      ...(patch.priority === undefined ? {} : { priority: patch.priority }),
      ...(patch.receivingPractice === undefined
        ? {}
        : { receivingPractice: patch.receivingPractice }),
      ...(patch.receivingNpi === undefined ? {} : { receivingNpi: patch.receivingNpi }),
      ...(patch.receivingPhone === undefined ? {} : { receivingPhone: patch.receivingPhone }),
      ...(patch.reasonCodes === undefined ? {} : { reasonCodes: patch.reasonCodes }),
      ...(patch.reasonText === undefined ? {} : { reasonText: patch.reasonText }),
      ...(patch.note === undefined ? {} : { note: patch.note }),
      ...(patch.authorisationNumber === undefined
        ? {}
        : { authorisationNumber: patch.authorisationNumber }),
      ...(patch.scheduledFor === undefined ? {} : { scheduledFor: patch.scheduledFor }),
      ...(patch.seenAt === undefined ? {} : { seenAt: patch.seenAt }),
      ...(patch.reportReceivedAt === undefined ? {} : { reportReceivedAt: patch.reportReceivedAt }),
      ...(patch.reportDocumentId === undefined ? {} : { reportDocumentId: patch.reportDocumentId }),
      ...(patch.declinedReason === undefined ? {} : { declinedReason: patch.declinedReason }),
    };
  },

  matches(row: ScopedRow<'Referral'>, query: ReferralListQuery): boolean {
    if (query.patientId !== undefined && row.patientId !== query.patientId) return false;
    if (query.encounterId !== undefined && row.encounterId !== query.encounterId) return false;
    if (query.referredById !== undefined && row.referredById !== query.referredById) return false;
    if (query.priority !== undefined && row.priority !== query.priority) return false;
    if (query.specialtyCode !== undefined && row.specialtyCode !== query.specialtyCode) {
      return false;
    }
    const wanted = referralStatuses(query);
    if (wanted !== undefined && !wanted.includes(row.status)) return false;
    return inWindow(row.createdAt, query.from, query.to);
  },

  where(query: ReferralListQuery) {
    const createdAt = windowFilter(query.from, query.to);
    const wanted = referralStatuses(query);
    return {
      ...(query.patientId === undefined ? {} : { patientId: query.patientId }),
      ...(query.encounterId === undefined ? {} : { encounterId: query.encounterId }),
      ...(query.referredById === undefined ? {} : { referredById: query.referredById }),
      ...(wanted === undefined ? {} : { status: { in: [...wanted] } }),
      ...(query.priority === undefined ? {} : { priority: query.priority }),
      ...(query.specialtyCode === undefined ? {} : { specialtyCode: query.specialtyCode }),
      ...(createdAt === undefined ? {} : { createdAt }),
    };
  },

  sortValue(row: ScopedRow<'Referral'>, sort: ReferralListQuery['sort']): number {
    if (sort === 'priority') return PRIORITY_RANK[row.priority];
    // An unsent referral sorts as if it were sent at the epoch, which puts the
    // drafts together at one end rather than scattering them through the tray.
    if (sort === 'sentAt') return row.sentAt?.getTime() ?? 0;
    return row.createdAt.getTime();
  },

  orderBy(query: ReferralListQuery) {
    if (query.sort === 'priority') return [{ priority: query.order }, { id: 'asc' as const }];
    if (query.sort === 'sentAt') return [{ sentAt: query.order }, { id: 'asc' as const }];
    return [{ createdAt: query.order }, { id: 'asc' as const }];
  },
};

export const clinicalSpecs = {
  encounters: encounterSpec,
  notes: clinicalNoteSpec,
  noteAddenda: noteAddendumSpec,
  problems: conditionSpec,
  procedures: procedureSpec,
  medicationStatements: medicationStatementSpec,
  prescriptions: medicationRequestSpec,
  allergies: allergySpec,
  immunisations: immunisationSpec,
  observations: observationSpec,
  referrals: referralSpec,
} as const;
