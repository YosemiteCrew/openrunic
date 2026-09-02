import { z } from 'zod';

import {
  ALLERGY_CATEGORIES,
  ALLERGY_CLINICAL_STATUSES,
  ALLERGY_CRITICALITIES,
  ALLERGY_TYPES,
  APPOINTMENT_CREATED_VIA,
  APPOINTMENT_STATUSES,
  CONDITION_CATEGORIES,
  PROCEDURE_STATUSES,
  CONDITION_CLINICAL_STATUSES,
  CONDITION_VERIFICATION_STATUSES,
  ENCOUNTER_CLASSES,
  ENCOUNTER_STATUSES,
  IMMUNIZATION_STATUSES,
  REFERRAL_PRIORITIES,
  MEDICATION_REQUEST_INTENTS,
  MEDICATION_REQUEST_STATUSES,
  MEDICATION_SOURCES,
  MEDICATION_STATEMENT_STATUSES,
  NOTE_STATES,
  OBSERVATION_CATEGORIES,
  OBSERVATION_STATUSES,
  REACTION_SEVERITIES,
} from '../enums.js';
import {
  code,
  codeList,
  codeSystem,
  display,
  jsonObject,
  localDate,
  longText,
  shortText,
  timestamp,
  uuid,
} from './common.js';

/**
 * Encounter aggregate: the visit and everything documented inside it - the
 * appointment it came from, the note, and the clinical facts recorded against
 * the chart during the visit.
 */

export const appointmentCreateInput = z
  .strictObject({
    facilityId: uuid,
    patientId: uuid.optional(),
    providerId: uuid,
    typeCode: code,
    typeDisplay: display,
    status: z.enum(APPOINTMENT_STATUSES).optional(),
    start: timestamp,
    end: timestamp,
    durationMinutes: z.int().positive().max(1440),
    room: shortText.optional(),
    reasonText: shortText.optional(),
    recurrenceGroupId: uuid.optional(),
    recurrenceRule: jsonObject.optional(),
    createdVia: z.enum(APPOINTMENT_CREATED_VIA).optional(),
  })
  .refine((value) => value.end > value.start, {
    message: 'end must be after start',
    path: ['end'],
  });

export const appointmentStatusChangeInput = z.strictObject({
  appointmentId: uuid,
  status: z.enum(APPOINTMENT_STATUSES),
  occurredAt: timestamp.optional(),
  room: shortText.optional(),
  note: shortText.optional(),
});

export const encounterCreateInput = z
  .strictObject({
    facilityId: uuid,
    patientId: uuid,
    providerId: uuid,
    appointmentId: uuid.optional(),
    class: z.enum(ENCOUNTER_CLASSES).optional(),
    status: z.enum(ENCOUNTER_STATUSES).optional(),
    reasonCode: code.optional(),
    reasonText: shortText.optional(),
    startedAt: timestamp,
    endedAt: timestamp.optional(),
  })
  .refine((value) => !value.endedAt || value.endedAt >= value.startedAt, {
    message: 'endedAt must not precede startedAt',
    path: ['endedAt'],
  });

export const clinicalNoteInput = z.strictObject({
  patientId: uuid,
  encounterId: uuid,
  authorId: uuid,
  title: shortText,
  /** The block document. Its shape is owned by the note editor, not by storage. */
  blocks: z.array(jsonObject).max(500),
  state: z.enum(NOTE_STATES).optional(),
  cosignerId: uuid.optional(),
});

export const noteAddendumInput = z.strictObject({
  noteId: uuid,
  authorId: uuid,
  blocks: z.array(jsonObject).max(500),
  reason: shortText.optional(),
});

export const procedureInput = z
  .strictObject({
    patientId: uuid,
    encounterId: uuid.optional(),
    code,
    codeSystem: codeSystem.optional(),
    display,
    snomedCode: code.optional(),
    status: z.enum(PROCEDURE_STATUSES).optional(),
    performedStart: z.coerce.date(),
    performedEnd: z.coerce.date().optional(),
    bodySiteCode: code.optional(),
    outcomeCode: code.optional(),
    notDoneReason: longText.optional(),
    note: longText.optional(),
    performedById: uuid.optional(),
    recordedById: uuid.optional(),
  })
  .refine((value) => !value.performedEnd || value.performedEnd >= value.performedStart, {
    message: 'performedEnd must not precede performedStart',
    path: ['performedEnd'],
  })
  /*
   * A reason belongs to the status that needs one. Attached to a COMPLETED
   * procedure it reads as a reason it was done, which is a different field and
   * a different clinical claim.
   */
  .refine((value) => value.notDoneReason === undefined || value.status === 'NOT_DONE', {
    message: 'notDoneReason is only meaningful when status is NOT_DONE',
    path: ['notDoneReason'],
  });

export const conditionInput = z
  .strictObject({
    patientId: uuid,
    encounterId: uuid.optional(),
    category: z.enum(CONDITION_CATEGORIES).optional(),
    code,
    codeSystem: codeSystem.optional(),
    display,
    snomedCode: code.optional(),
    clinicalStatus: z.enum(CONDITION_CLINICAL_STATUSES).optional(),
    verificationStatus: z.enum(CONDITION_VERIFICATION_STATUSES).optional(),
    onsetDate: localDate.optional(),
    abatementDate: localDate.optional(),
    severityCode: code.optional(),
    bodySiteCode: code.optional(),
    note: longText.optional(),
  })
  .refine(
    (value) => !value.onsetDate || !value.abatementDate || value.abatementDate >= value.onsetDate,
    {
      message: 'abatementDate must not precede onsetDate',
      path: ['abatementDate'],
    }
  );

export const allergyIntoleranceInput = z.strictObject({
  patientId: uuid,
  type: z.enum(ALLERGY_TYPES).optional(),
  category: z.enum(ALLERGY_CATEGORIES).optional(),
  criticality: z.enum(ALLERGY_CRITICALITIES).optional(),
  clinicalStatus: z.enum(ALLERGY_CLINICAL_STATUSES).optional(),
  substanceCode: code.optional(),
  substanceCodeSystem: codeSystem.optional(),
  substanceDisplay: display,
  reactionCodes: codeList.optional(),
  reactionText: shortText.optional(),
  severity: z.enum(REACTION_SEVERITIES).optional(),
  onsetDate: localDate.optional(),
  note: longText.optional(),
});

export const medicationStatementInput = z.strictObject({
  patientId: uuid,
  encounterId: uuid.optional(),
  rxnormCode: code.optional(),
  display,
  sigText: shortText.optional(),
  status: z.enum(MEDICATION_STATEMENT_STATUSES).optional(),
  source: z.enum(MEDICATION_SOURCES).optional(),
  effectiveStart: localDate.optional(),
  effectiveEnd: localDate.optional(),
  note: longText.optional(),
});

export const medicationRequestInput = z.strictObject({
  patientId: uuid,
  encounterId: uuid.optional(),
  prescriberId: uuid,
  rxnormCode: code.optional(),
  ndcCode: code.optional(),
  display,
  /** Structured sig from the sig builder; `sigText` is its rendered form. */
  sig: jsonObject.optional(),
  sigText: shortText,
  quantity: z.number().positive().finite(),
  quantityUnit: z.string().min(1).max(32),
  refills: z.int().min(0).max(99),
  daysSupply: z.int().positive().max(365).optional(),
  dispenseAsWritten: z.boolean().optional(),
  /** DEA schedule, jurisdictional, so a string rather than an enum. */
  controlledSchedule: z.enum(['2', '3', '4', '5']).optional(),
  pharmacyName: shortText.optional(),
  pharmacyNcpdpId: z.string().min(1).max(32).optional(),
  status: z.enum(MEDICATION_REQUEST_STATUSES).optional(),
  intent: z.enum(MEDICATION_REQUEST_INTENTS).optional(),
});

export const immunizationInput = z.strictObject({
  patientId: uuid,
  encounterId: uuid.optional(),
  status: z.enum(IMMUNIZATION_STATUSES).optional(),
  cvxCode: code,
  mvxCode: code.optional(),
  ndcCode: code.optional(),
  display,
  lotNumber: z.string().min(1).max(64).optional(),
  expirationDate: localDate.optional(),
  siteCode: code.optional(),
  routeCode: code.optional(),
  doseQuantity: z.number().positive().finite().optional(),
  doseUnit: z.string().min(1).max(32).optional(),
  administeredAt: timestamp,
  administeredById: uuid.optional(),
  visDate: localDate.optional(),
  refusalReasonCode: code.optional(),
});

/**
 * A new referral.
 *
 * `status` is deliberately absent: a referral is born a draft and reaches every
 * other status through a transition that stamps its own timestamp. Letting a
 * caller create one already SENT would produce a referral nobody can say when
 * they sent.
 */
export const referralInput = z.strictObject({
  patientId: uuid,
  encounterId: uuid.optional(),
  referredById: uuid,
  priority: z.enum(REFERRAL_PRIORITIES).optional(),
  specialtyCode: code,
  specialtyDisplay: display,
  receivingPractice: z.string().min(1).max(200),
  receivingNpi: z
    .string()
    .regex(/^\d{10}$/, 'An NPI is ten digits.')
    .optional(),
  receivingPhone: z.string().min(1).max(32).optional(),
  reasonCodes: z.array(code).max(12).optional(),
  reasonText: z.string().min(1).max(2000).optional(),
  note: z.string().min(1).max(2000).optional(),
  authorisationNumber: z.string().min(1).max(64).optional(),
});

export const observationInput = z
  .strictObject({
    patientId: uuid,
    encounterId: uuid.optional(),
    category: z.enum(OBSERVATION_CATEGORIES).optional(),
    status: z.enum(OBSERVATION_STATUSES).optional(),
    loincCode: code.optional(),
    code,
    codeSystem: codeSystem.optional(),
    display,
    valueNumber: z.number().finite().optional(),
    valueText: shortText.optional(),
    valueCode: code.optional(),
    valueBoolean: z.boolean().optional(),
    /** UCUM unit. Required whenever a numeric value is present. */
    unit: z.string().min(1).max(32).optional(),
    referenceLow: z.number().finite().optional(),
    referenceHigh: z.number().finite().optional(),
    interpretationCode: code.optional(),
    bodySiteCode: code.optional(),
    effectiveAt: timestamp,
    issuedAt: timestamp.optional(),
    performerId: uuid.optional(),
    formSubmissionId: uuid.optional(),
  })
  .refine(
    (value) =>
      value.valueNumber !== undefined ||
      value.valueText !== undefined ||
      value.valueCode !== undefined ||
      value.valueBoolean !== undefined,
    { message: 'an observation must carry a value', path: ['valueNumber'] }
  )
  .refine((value) => value.valueNumber === undefined || value.unit !== undefined, {
    message: 'a numeric observation must carry a UCUM unit',
    path: ['unit'],
  })
  .refine(
    (value) =>
      value.referenceLow === undefined ||
      value.referenceHigh === undefined ||
      value.referenceHigh >= value.referenceLow,
    { message: 'referenceHigh must not be below referenceLow', path: ['referenceHigh'] }
  );

export type AppointmentCreateInput = z.infer<typeof appointmentCreateInput>;
export type AppointmentStatusChangeInput = z.infer<typeof appointmentStatusChangeInput>;
export type EncounterCreateInput = z.infer<typeof encounterCreateInput>;
export type ClinicalNoteInput = z.infer<typeof clinicalNoteInput>;
export type NoteAddendumInput = z.infer<typeof noteAddendumInput>;
export type ConditionInput = z.infer<typeof conditionInput>;
export type ProcedureInput = z.infer<typeof procedureInput>;
export type AllergyIntoleranceInput = z.infer<typeof allergyIntoleranceInput>;
export type MedicationStatementInput = z.infer<typeof medicationStatementInput>;
export type MedicationRequestInput = z.infer<typeof medicationRequestInput>;
export type ImmunizationInput = z.infer<typeof immunizationInput>;
export type ReferralInput = z.infer<typeof referralInput>;
export type ObservationInput = z.infer<typeof observationInput>;
