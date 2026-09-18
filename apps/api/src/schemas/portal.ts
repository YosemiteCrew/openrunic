import { z } from 'zod';

export const portalMoneySchema = z.strictObject({
  amountMinor: z.int(),
  currency: z.string().length(3),
});

export const portalPatientSchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  mrn: z.string(),
  dateOfBirth: z.string(),
});

export type PortalPatient = z.infer<typeof portalPatientSchema>;

export const portalAppointmentSchema = z.strictObject({
  id: z.uuid(),
  startsAt: z.string(),
  durationMinutes: z.int().positive(),
  reason: z.string(),
  clinician: z.string().nullable(),
  department: z.string().nullable(),
  mode: z.enum(['video', 'in-person']).nullable(),
  location: z.string().nullable(),
  joinUrl: z.string().nullable(),
  directionsUrl: z.string().nullable(),
  cancelledReason: z.string().nullable(),
  cancellationSupported: z.boolean(),
  rescheduleSupported: z.boolean(),
});

export const portalAppointmentsSchema = z.strictObject({
  upcoming: z.array(portalAppointmentSchema),
  past: z.array(portalAppointmentSchema),
  requestsSupported: z.boolean(),
});

export const portalBalanceSchema = z.strictObject({
  outstanding: portalMoneySchema.nullable(),
  dueOn: z.string().nullable(),
  statementCount: z.int().nonnegative(),
});

export const portalActionItemSchema = z.strictObject({
  id: z.string(),
  title: z.string(),
  detail: z.string(),
  href: z.string(),
  actionLabel: z.string(),
});

export const portalHomeSchema = z.strictObject({
  patient: portalPatientSchema,
  nextAppointment: portalAppointmentSchema.nullable(),
  balance: portalBalanceSchema,
  unreadMessages: z.int().nonnegative(),
  actionItems: z.array(portalActionItemSchema),
  appointmentRequestsSupported: z.boolean(),
});

const portalTermFields = {
  id: z.uuid(),
  plain: z.string().nullable(),
} as const;

export const portalProblemSchema = z.strictObject({
  ...portalTermFields,
  term: z.string(),
  code: z.string(),
  recordedOn: z.string(),
  status: z.enum(['active', 'recurrence', 'relapse', 'inactive', 'remission', 'resolved']),
});

export const portalMedicationSchema = z.strictObject({
  ...portalTermFields,
  name: z.string(),
  strength: z.number().nullable(),
  unit: z.string().nullable(),
  instruction: z.string().nullable(),
  prescribedBy: z.string().nullable(),
  startedOn: z.string(),
});

export const portalAllergySchema = z.strictObject({
  ...portalTermFields,
  substance: z.string(),
  reaction: z.string().nullable(),
  severity: z.enum(['mild', 'moderate', 'severe']).nullable(),
  recordedOn: z.string(),
});

export const portalImmunisationSchema = z.strictObject({
  ...portalTermFields,
  vaccine: z.string(),
  givenOn: z.string(),
  doseLabel: z.string().nullable(),
});

export const portalDocumentSchema = z.strictObject({
  ...portalTermFields,
  title: z.string(),
  addedOn: z.string(),
  format: z.string(),
});

export const portalResultSchema = z.strictObject({
  ...portalTermFields,
  name: z.string(),
  value: z.number(),
  unit: z.string(),
  referenceRange: z.string(),
  range: z.enum(['in-range', 'out-of-range', 'unknown']),
  takenOn: z.string(),
});

export const portalHealthRecordSchema = z.strictObject({
  problems: z.array(portalProblemSchema),
  medications: z.array(portalMedicationSchema),
  allergies: z.array(portalAllergySchema),
  immunisations: z.array(portalImmunisationSchema),
  documents: z.array(portalDocumentSchema),
  results: z.array(portalResultSchema),
});

export const portalMessageSchema = z.strictObject({
  id: z.uuid(),
  author: z.enum(['patient', 'care-team']),
  authorName: z.string().nullable(),
  sentAt: z.string(),
  body: z.string(),
});

export const portalMessageThreadSchema = z.strictObject({
  id: z.uuid(),
  subject: z.string(),
  correspondent: z.string().nullable(),
  lastMessageAt: z.string(),
  unread: z.boolean(),
  replySupported: z.boolean(),
  messages: z.array(portalMessageSchema),
});

export const portalMessageReplySchema = z.strictObject({
  body: z.string().trim().min(1).max(10_000),
});

export const portalFormQuestionSchema = z.strictObject({
  id: z.string(),
  prompt: z.string(),
  help: z.string().optional(),
  kind: z.enum(['single-choice', 'yes-no', 'text']),
  options: z.array(z.string()).optional(),
});

export const portalFormTaskSchema = z.strictObject({
  id: z.uuid(),
  title: z.string(),
  purpose: z.string(),
  dueOn: z.string().nullable(),
  status: z.enum(['not-started', 'in-progress', 'submitted']),
  questions: z.array(portalFormQuestionSchema),
  answers: z.record(z.string(), z.string()),
  editable: z.boolean(),
});

export const portalStatementLineSchema = z.strictObject({
  id: z.string(),
  description: z.string(),
  code: z.string(),
  quantity: z.number(),
  amount: portalMoneySchema,
});

export const portalStatementSchema = z.strictObject({
  id: z.uuid(),
  reference: z.string(),
  issuedOn: z.string(),
  dueOn: z.string().nullable(),
  status: z.enum(['due', 'paid', 'credit']),
  total: portalMoneySchema.nullable(),
  balance: portalMoneySchema,
  lines: z.array(portalStatementLineSchema),
  detailsAvailable: z.boolean(),
  paymentAvailable: z.boolean(),
});
