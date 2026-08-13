/**
 * The chart aggregate, as the screens read it.
 *
 * These are view shapes rather than wire shapes. `apps/api` serves every
 * aggregate a chart shows - allergies, problems, medications, results,
 * documents and notes each have a segment - and `./live.ts` composes the visit
 * list and the note itself out of encounters, notes and the staff directory.
 * The rest are not mapped into these types yet, which is why the chart tabs
 * report them as absent rather than as empty. So this file is the contract the
 * chart screens were built against; as each mapping is written the shape here
 * stops needing to differ from the wire and moves to `../types.ts` beside
 * `Patient` and `Appointment`, and nothing in the screens changes.
 *
 * Every enum here mirrors an enum that already exists in `@openrunic/database`,
 * uppercase and underscored, so `formatEnumLabel` renders it and no screen ever
 * hard-codes a display string for a state.
 */

/* -------------------------------------------------------------------------- */
/* Allergies                                                                   */
/* -------------------------------------------------------------------------- */

export const ALLERGY_SEVERITIES = ['SEVERE', 'MODERATE', 'MILD'] as const;

export type AllergySeverity = (typeof ALLERGY_SEVERITIES)[number];

export type AllergyCategory = 'DRUG' | 'FOOD' | 'ENVIRONMENT';

export interface Allergy {
  id: string;
  /** Plain name first: "Penicillin", never "PCN". */
  allergen: string;
  category: AllergyCategory;
  /** What happened: "Hives and facial swelling". */
  reaction: string;
  severity: AllergySeverity;
  /** ISO date the allergy was recorded. */
  notedOn: string;
  /** Who said so: "Patient reported", "Reconciled from discharge summary". */
  source: string;
}

/**
 * The three-state allergy record.
 *
 * `NO_KNOWN_ALLERGIES` is an affirmed clinical fact with a date on it.
 * `NOT_RECORDED` is an absence of information. Collapsing the two is the defect
 * this type exists to prevent: an empty list must never read as "safe".
 */
export type AllergyRecordState = 'RECORDED' | 'NO_KNOWN_ALLERGIES' | 'NOT_RECORDED';

export interface AllergyRecord {
  state: AllergyRecordState;
  /** ISO date the "no known allergies" statement was affirmed. */
  affirmedOn: string | null;
  entries: Allergy[];
}

/* -------------------------------------------------------------------------- */
/* Problems, medications, care gaps                                            */
/* -------------------------------------------------------------------------- */

export type ProblemStatus = 'ACTIVE' | 'CHRONIC' | 'RESOLVED';

export interface Problem {
  id: string;
  /** Plain name first, code second. */
  name: string;
  code: string;
  codeSystem: 'ICD-10' | 'SNOMED CT';
  status: ProblemStatus;
  /** ISO date. */
  onsetOn: string;
  /** ISO date of the last visit that addressed it, or null. */
  lastAddressedOn: string | null;
}

export type MedicationStatus = 'ACTIVE' | 'DISCONTINUED';

export type MedicationSource = 'PRESCRIBED_HERE' | 'PATIENT_REPORTED' | 'RECONCILED';

export interface Medication {
  id: string;
  drug: string;
  /** Plain language, as the patient would be told it: "Take 1 tablet by mouth each morning". */
  sig: string;
  prescriber: string;
  status: MedicationStatus;
  source: MedicationSource;
  /** ISO date. */
  startedOn: string;
  /** ISO date, set only once discontinued. */
  stoppedOn: string | null;
  refillsRemaining: number | null;
}

export interface CareGap {
  id: string;
  /** "Blood pressure check due". A fact, not an instruction. */
  label: string;
  /** ISO date it is due, or null when it is already overdue with no target. */
  dueOn: string | null;
}

/* -------------------------------------------------------------------------- */
/* Visits and notes                                                            */
/* -------------------------------------------------------------------------- */

/** The note lifecycle. `NONE` means the visit never carried a note. */
export const NOTE_STATES = ['NONE', 'DRAFT', 'UNSIGNED', 'COSIGN_PENDING', 'SIGNED'] as const;

export type NoteState = (typeof NOTE_STATES)[number];

export interface Visit {
  id: string;
  /** The note for this visit, when one exists: the link target for `/encounters/<id>`. */
  encounterId: string | null;
  /** ISO date. */
  date: string;
  /** "Follow-up", "Annual physical". Display text, from the appointment type. */
  type: string;
  providerName: string;
  reason: string;
  noteState: NoteState;
}

/* -------------------------------------------------------------------------- */
/* Results, documents, care team                                               */
/* -------------------------------------------------------------------------- */

export interface ResultObservation {
  id: string;
  /** The panel it arrived in: "Full blood count". */
  panel: string;
  analyte: string;
  /** LOINC, rendered mono beside the analyte. */
  code: string;
  value: number | null;
  unit: string;
  referenceLow: number | null;
  referenceHigh: number | null;
  /** ISO instant the specimen was collected. */
  collectedAt: string;
  /** True once a provider has signed it off. */
  reviewed: boolean;
}

export interface ChartDocument {
  id: string;
  name: string;
  category: string;
  /** ISO date. */
  receivedOn: string;
  source: string;
  /** ISO date, when the document expires (insurance card, consent). */
  expiresOn: string | null;
}

export type CareTeamRelationship = 'PRIMARY' | 'CARE_TEAM' | 'EXTERNAL';

export interface CareTeamMember {
  id: string;
  name: string;
  /** "Family medicine", "Medical assistant", "Cardiology". */
  role: string;
  relationship: CareTeamRelationship;
  /** A phone number or a practice name. Never an email that could be mistaken for real. */
  contact: string;
}

/* -------------------------------------------------------------------------- */
/* The aggregate                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Everything the chart rail and the six chart tabs read, in one payload.
 *
 * One request rather than six, because the rail is present on every chart
 * screen and a rail that arrives in six pieces flickers through six layouts.
 */
export interface ChartSummary {
  patientId: string;
  allergies: AllergyRecord;
  problems: Problem[];
  medications: Medication[];
  careGaps: CareGap[];
  visits: Visit[];
  results: ResultObservation[];
  documents: ChartDocument[];
  careTeam: CareTeamMember[];
  /** Patient responsibility in major units. Positive means the patient owes. */
  balanceDue: number;
}

/* -------------------------------------------------------------------------- */
/* The note                                                                    */
/* -------------------------------------------------------------------------- */

/** The four SOAP blocks, in the order they are documented. */
export const NOTE_SECTION_KEYS = ['subjective', 'objective', 'assessment', 'plan'] as const;

export type NoteSectionKey = (typeof NOTE_SECTION_KEYS)[number];

/** What a committed command block wrote besides narrative. */
export type EmittedItemKind = 'ORDER' | 'PRESCRIPTION' | 'PROBLEM' | 'FOLLOW_UP';

export interface EmittedItem {
  id: string;
  kind: EmittedItemKind;
  /** "CBC with differential", "Lisinopril 10 mg". */
  label: string;
}

export interface NoteSection {
  key: NoteSectionKey;
  /** "Subjective". Sentence case, the block's own heading. */
  label: string;
  /** One line of what belongs in the block. Shown under the label, never as a placeholder. */
  hint: string;
  text: string;
  /** Structured data this block wrote. Rendered as chips under the text. */
  emitted: EmittedItem[];
}

export interface NoteSignature {
  signerName: string;
  /** "MD", "DO", "NP". */
  credential: string;
  /** ISO instant. */
  signedAt: string;
  /** The one sentence the signer attests to. */
  attestation: string;
  /**
   * A short fingerprint of the note's text, rendered mono.
   *
   * Of the text as it currently reads, computed on this side. It is not proof
   * that the text is the text that was signed: nothing on the wire carries the
   * hash taken at signing time, so there is nothing here to compare it with.
   * See `contentHash` in `./signature.ts` for what would make it proof.
   */
  fingerprint: string;
}

export interface Addendum {
  id: string;
  authorName: string;
  credential: string;
  /** ISO instant. */
  addedAt: string;
  text: string;
}

export interface EncounterNote {
  id: string;
  patientId: string;
  /** "Follow-up". The visit type, in the glossary's word. */
  visitType: string;
  /** ISO date of the visit. */
  visitDate: string;
  providerName: string;
  providerCredential: string;
  reason: string;
  state: NoteState;
  sections: NoteSection[];
  signature: NoteSignature | null;
  addenda: Addendum[];
}

/**
 * One entry in the slash-command menu.
 *
 * A command inserts narrative AND emits structured data, which is the whole
 * point of the block editor: the clinician writes once and the chart gains a
 * coded order rather than a sentence about one.
 */
export interface SlashCommand {
  /** Typed after the slash: "prescribe". */
  id: string;
  label: string;
  /** "Documentation", "Orders", "Plan". Groups the menu. */
  group: string;
  /** Lucide slug. */
  icon: string;
  /** What the block will read after insertion. Previewed in the menu. */
  insertText: string;
  /** What the block will write to the chart, if anything. */
  emits: Omit<EmittedItem, 'id'> | null;
}
