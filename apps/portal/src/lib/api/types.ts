/**
 * What the portal reads, in the shapes a patient screen wants.
 *
 * These are portal view models, not FHIR resources. The API boundary speaks FHIR R4; the
 * adapters in `mock.ts` and `http.ts` flatten it into the plain, already-glossed records
 * below so no screen has to reach into a CodeableConcept to draw a row.
 *
 * Two rules run through every clinical type here:
 *  - a coded term always travels with `plain`, the plain-language gloss shown beside it;
 *  - a measured value always travels with its `unit` and a labelled `range` state, so a
 *    number is never presented bare.
 */

/** Money is integer minor units plus its ISO 4217 code; never a float. */
export interface Money {
  /** Minor units. Negative means the account is in credit. */
  amountMinor: number;
  /** ISO 4217 code, e.g. 'GBP'. */
  currency: string;
}

/** Range verdict for a measured value. `unknown` means no range was supplied. */
export type RangeState = 'in-range' | 'out-of-range' | 'unknown';

export interface Patient {
  id: string;
  name: string;
  /** Medical record number, shown so a patient can quote it on the phone. */
  mrn: string;
  dateOfBirth: string;
}

export type AppointmentMode = 'video' | 'in-person';

export interface Appointment {
  id: string;
  /** ISO 8601 instant. Formatted for display in `lib/format.ts`, never here. */
  startsAt: string;
  durationMinutes: number;
  /** Plain reason for the visit, in the patient's words. */
  reason: string;
  clinician: string;
  department: string;
  mode: AppointmentMode;
  /** Where to go, for an in-person visit. */
  location?: string;
  /** Link to the video room, for a video visit. */
  joinUrl?: string;
  /** Link to directions, for an in-person visit. */
  directionsUrl?: string;
  /** Only set once an appointment has been cancelled. */
  cancelledReason?: string;
}

export interface Appointments {
  upcoming: Appointment[];
  past: Appointment[];
}

/**
 * A patient asking for a slot. Requests are never bookings: the practice confirms them by
 * message, so the portal must not imply anything is settled until it is.
 */
export interface AppointmentRequest {
  /** Why the patient wants to be seen, in their own words. */
  reason: string;
  /** When they can come, in their own words, e.g. 'Weekday mornings'. */
  preferredTimes: string;
  /** Set when the request replaces an existing appointment rather than adding one. */
  rescheduleOf?: string;
}

export interface Balance {
  outstanding: Money;
  /** ISO date the balance is due, or null when nothing is outstanding. */
  dueOn: string | null;
  statementCount: number;
}

/** Something the patient has to do, surfaced on the home screen. */
export interface ActionItem {
  id: string;
  title: string;
  /** One line saying what it is and what happens when it is done. */
  detail: string;
  /** Where the action is completed. */
  href: string;
  actionLabel: string;
}

export interface HomeSummary {
  patient: Patient;
  nextAppointment: Appointment | null;
  balance: Balance;
  unreadMessages: number;
  actionItems: ActionItem[];
}

export interface Problem {
  id: string;
  /** The clinical term as recorded, e.g. 'Hypothyroidism'. */
  term: string;
  /** Coding system reference, e.g. 'E03.9'. */
  code: string;
  /** Plain-language gloss shown beside the term, e.g. 'Underactive thyroid'. */
  plain: string;
  recordedOn: string;
  /** 'Being treated' / 'Resolved' - already plain, shown as a labelled badge. */
  status: string;
}

export interface Medication {
  id: string;
  name: string;
  plain: string;
  /** Numeric strength, kept apart from its unit so the unit is always rendered. */
  strength: number;
  unit: string;
  /** How to take it, in plain words. */
  instruction: string;
  prescribedBy: string;
  startedOn: string;
}

export interface Allergy {
  id: string;
  substance: string;
  plain: string;
  reaction: string;
  /** 'Severe' / 'Mild' - plain already, shown as a labelled badge. */
  severity: string;
  recordedOn: string;
}

export interface Immunisation {
  id: string;
  vaccine: string;
  plain: string;
  givenOn: string;
  doseLabel: string;
}

export interface ClinicalDocument {
  id: string;
  title: string;
  plain: string;
  addedOn: string;
  /** Human-sized description of the file, e.g. 'PDF, 2 pages'. */
  format: string;
}

/** A measured result. Never rendered without its unit and its labelled range state. */
export interface Result {
  id: string;
  name: string;
  plain: string;
  value: number;
  unit: string;
  /** The reference range as text, e.g. '0.4 to 4.0'. Empty when none was supplied. */
  referenceRange: string;
  range: RangeState;
  /** The range verdict in words: 'In range' / 'Above the usual range'. */
  rangeLabel: string;
  takenOn: string;
}

export interface HealthRecord {
  problems: Problem[];
  medications: Medication[];
  allergies: Allergy[];
  immunisations: Immunisation[];
  documents: ClinicalDocument[];
  results: Result[];
}

export type MessageAuthor = 'patient' | 'care-team';

export interface Message {
  id: string;
  author: MessageAuthor;
  authorName: string;
  sentAt: string;
  body: string;
}

export interface MessageThread {
  id: string;
  subject: string;
  /** Who at the practice the thread is with. */
  correspondent: string;
  lastMessageAt: string;
  unread: boolean;
  messages: Message[];
}

export type FormStatus = 'not-started' | 'in-progress' | 'submitted';

export type QuestionKind = 'single-choice' | 'yes-no' | 'text';

export interface FormQuestion {
  id: string;
  prompt: string;
  /** Quiet helper line under the prompt. */
  help?: string;
  kind: QuestionKind;
  /** Choices for 'single-choice'; ignored by the other kinds. */
  options?: string[];
}

export interface FormTask {
  id: string;
  title: string;
  /** What the form is for, in one plain sentence. */
  purpose: string;
  dueOn: string;
  status: FormStatus;
  questions: FormQuestion[];
  /** Answers already saved, keyed by question id. Resume reads from here. */
  answers: Record<string, string>;
}

export interface StatementLine {
  id: string;
  /** Plain-language description of the charge, not a billing code. */
  description: string;
  /** The billing code, shown quietly beside the description. */
  code: string;
  quantity: number;
  amount: Money;
}

export type StatementStatus = 'due' | 'paid' | 'credit';

export interface Statement {
  id: string;
  reference: string;
  issuedOn: string;
  dueOn: string;
  status: StatementStatus;
  total: Money;
  /** What is still owed. Negative means the account is in credit. */
  balance: Money;
  lines: StatementLine[];
}

export interface Receipt {
  id: string;
  statementId: string;
  paidOn: string;
  amount: Money;
  /** Last four digits only; the portal never holds a full card number. */
  cardLast4: string;
}

/**
 * Everything a screen may ask for. One interface so a screen can be handed a stub in a
 * test without knowing whether the real thing talks to a mock or to the API.
 */
export interface PortalApi {
  /** Whose record this is. Read by the shell to name the account on screen. */
  getPatient(): Promise<Patient>;
  getHome(): Promise<HomeSummary>;
  getHealthRecord(): Promise<HealthRecord>;
  getThreads(): Promise<MessageThread[]>;
  sendMessage(threadId: string, body: string): Promise<Message>;
  getAppointments(): Promise<Appointments>;
  requestAppointment(request: AppointmentRequest): Promise<void>;
  cancelAppointment(id: string): Promise<void>;
  getForms(): Promise<FormTask[]>;
  saveForm(id: string, answers: Record<string, string>): Promise<void>;
  submitForm(id: string, answers: Record<string, string>): Promise<void>;
  getStatements(): Promise<Statement[]>;
  payStatement(id: string): Promise<Receipt>;
}
